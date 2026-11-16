-- =========================================================================================
-- VEKTORA · FASE 8 — Una tarea trabada vuelve al mercado
-- =========================================================================================
-- Depende de: db/schema.sql y las migraciones 0002 a 0009.
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- Resuelve las dos últimas formas conocidas del mismo defecto: una tarea que espera a una
-- persona que ya no va a venir.
--
--   1. UNA TAREA `failed` ERA TERMINAL. Cuando el juez agotaba los intentos de un proveedor,
--      la tarea quedaba fallida con ese proveedor asignado. Sus dependientes seguían
--      `blocked` para siempre y el proyecto, `active` para siempre: ni terminaba ni fallaba.
--
--   2. UNA TAREA ADJUDICADA QUE NADIE ENTREGA ESPERABA SIN LÍMITE. `due_at` existía pero
--      nadie lo escribía ni lo miraba. Un proveedor que acepta la adjudicación automática y
--      desaparece —o que no responde a un pedido de cambios— congelaba esa rama del DAG.
--
-- La salida es la misma en los dos casos: la tarea se le quita a ese proveedor y vuelve al
-- mercado. Y como eso tampoco puede repetirse sin fin, hay un tope: agotadas las
-- reasignaciones, el proyecto pasa a `failed`. Es un final que el sistema alcanza solo y que
-- dice la verdad: el resultado no se pudo conseguir.
--
-- Como en el resto del esquema, aquí vive solo lo que únicamente la base puede hacer: mirar
-- el estado y cambiarlo en una transacción. CUÁNTO dura un plazo, cuántas reasignaciones se
-- toleran y cuánta reputación cuesta incumplir es política y llega por parámetro desde
-- `lib/matching` (deadlines.ts y config.ts).
-- =========================================================================================

set search_path = public, extensions;


-- =========================================================================================
-- 01 · Cuántas veces volvió la tarea al mercado
-- =========================================================================================
alter table public.project_tasks
  add column if not exists reassignments integer not null default 0;

comment on column public.project_tasks.reassignments is
  'Veces que la tarea se le quitó a un proveedor (rechazo definitivo o plazo vencido) y '
  'volvió al mercado. Al llegar al tope configurado, el proyecto pasa a failed.';

comment on column public.project_tasks.due_at is
  'Plazo de entrega vigente. Lo escribe recover_stalled_task: adjudicación o último '
  'veredicto del proveedor asignado, más la ventana que decide lib/matching.';


-- =========================================================================================
-- 02 · recover_stalled_task — fijar el plazo o devolver la tarea al mercado
-- =========================================================================================
-- Una sola función y no dos («fijar plazo» y «liberar») a propósito: la referencia del plazo
-- se lee con la fila de la tarea bloqueada, así que un veredicto que llega a la vez no puede
-- colarse entre el cálculo y la liberación.
--
-- Devuelve `action`:
--   · 'none'           nada que hacer (la tarea no está trabada, o el proyecto no está en curso)
--   · 'deadline_set'   el reloj sigue corriendo; `due_at` quedó escrito
--   · 'reopened'       se le quitó al proveedor y volvió a `ready`
--   · 'project_failed' no quedan reasignaciones: la tarea queda `failed` y el proyecto también
create or replace function public.recover_stalled_task(
  p_task_id           uuid,
  p_window_hours      numeric,
  p_max_reassignments integer,
  p_deadline_penalty  numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task      public.project_tasks%rowtype;
  v_project   public.project_status;
  v_reference timestamptz;
  v_due       timestamptz;
  v_overdue   boolean := false;
  v_reason    text;
begin
  if p_window_hours is null or p_window_hours < 0 then
    raise exception 'VEKTORA/MATCH: p_window_hours debe ser un número no negativo'
      using errcode = '22023';
  end if;
  if p_max_reassignments is null or p_max_reassignments < 0 then
    raise exception 'VEKTORA/MATCH: p_max_reassignments debe ser un entero no negativo'
      using errcode = '22023';
  end if;

  select * into v_task from public.project_tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('action', 'none', 'reason', 'la tarea no existe');
  end if;

  select p.status into v_project from public.projects p where p.id = v_task.project_id;
  if v_project not in ('planned', 'active') then
    return jsonb_build_object('action', 'none', 'reason', 'el proyecto no está en curso');
  end if;

  if v_task.assignee_id is not null
     and v_task.status in ('assigned', 'in_progress', 'revision_requested') then
    -- El reloj corre desde la adjudicación o, si ya hubo un veredicto sobre una entrega de
    -- ESTE proveedor, desde ese veredicto: un pedido de cambios abre una ventana nueva.
    -- Mientras la tarea está entregada el reloj no corre: ahí quien debe algo somos nosotros.
    select greatest(coalesce(v_task.assigned_at, v_task.updated_at), max(d.qa_evaluated_at))
      into v_reference
      from public.deliverables d
     where d.task_id = v_task.id and d.provider_id = v_task.assignee_id;

    v_due := v_reference + make_interval(secs => p_window_hours * 3600);

    if v_due >= now() then
      if v_task.due_at is distinct from v_due then
        update public.project_tasks set due_at = v_due where id = v_task.id;
      end if;
      return jsonb_build_object('action', 'deadline_set', 'due_at', v_due);
    end if;

    v_overdue := true;
    v_reason  := format('venció el plazo de entrega (%s)', to_char(v_due, 'YYYY-MM-DD HH24:MI TZ'));

    -- El plazo incumplido se cobra UNA vez por proveedor y tarea: el libro mayor es
    -- append-only, así que el guardia va antes del insert.
    if coalesce(p_deadline_penalty, 0) > 0 and not exists (
      select 1 from public.reputation_events re
       where re.task_id = v_task.id
         and re.user_id = v_task.assignee_id
         and re.event_type = 'deadline_missed'
    ) then
      insert into public.reputation_events (
        user_id, event_type, delta, weight, reason, task_id, actor_type, metadata
      )
      values (
        v_task.assignee_id, 'deadline_missed', -abs(p_deadline_penalty), 1,
        format('Tarea %s sin entregar al vencer el plazo', v_task.code),
        v_task.id, 'ai_agent',
        jsonb_build_object('due_at', v_due, 'task_status', v_task.status)
      );
    end if;

  elsif v_task.status = 'failed' then
    v_reason := 'el evaluador rechazó definitivamente la entrega';

  else
    return jsonb_build_object('action', 'none', 'reason', 'la tarea no está trabada');
  end if;

  -- --- Sin reasignaciones: el proyecto falla ---------------------------------------------
  if v_task.reassignments >= p_max_reassignments then
    update public.project_tasks
       set status = 'failed', due_at = null
     where id = v_task.id
       and (status <> 'failed' or due_at is not null);

    update public.projects
       set status = 'failed', completed_at = now(), updated_at = now()
     where id = v_task.project_id
       and status in ('planned', 'active');

    insert into public.audit_logs (actor_type, action, entity_type, entity_id, project_id, changes)
    values ('ai_agent', 'project.failed', 'project', v_task.project_id, v_task.project_id,
            jsonb_build_object(
              'task_id', v_task.id,
              'task_code', v_task.code,
              'reason', v_reason,
              'reassignments', v_task.reassignments,
              'max_reassignments', p_max_reassignments
            ));

    return jsonb_build_object(
      'action', 'project_failed',
      'reason', v_reason,
      'reassignments', v_task.reassignments,
      'overdue', v_overdue
    );
  end if;

  -- --- La tarea vuelve al mercado ---------------------------------------------------------
  -- La candidatura de quien la tenía queda `expired`: `match_task_candidates` no vuelve a
  -- proponer a un proveedor con una candidatura resuelta, así que no la recibe otra vez.
  update public.task_applications
     set status = 'expired', decided_at = now()
   where task_id = v_task.id
     and provider_id = v_task.assignee_id
     and status = 'accepted';

  -- Las demás se rechazaron solo porque otro ganó la adjudicación. Con la tarea otra vez
  -- libre vuelven a competir; sin esto el mercado de una tarea reabierta estaría vacío.
  update public.task_applications
     set status = 'pending', decided_at = null
   where task_id = v_task.id
     and status = 'rejected'
     and is_auto_generated;

  update public.project_tasks
     set assignee_id     = null,
         status          = 'ready',
         assigned_at     = null,
         started_at      = null,
         due_at          = null,
         matching_rounds = 0,
         reassignments   = reassignments + 1
   where id = v_task.id;

  insert into public.audit_logs (actor_type, action, entity_type, entity_id, project_id, changes)
  values ('ai_agent', 'task.reopened', 'project_task', v_task.id, v_task.project_id,
          jsonb_build_object(
            'previous_assignee', v_task.assignee_id,
            'previous_status', v_task.status,
            'reason', v_reason,
            'reassignments', v_task.reassignments + 1,
            'max_reassignments', p_max_reassignments
          ));

  return jsonb_build_object(
    'action', 'reopened',
    'reason', v_reason,
    'reassignments', v_task.reassignments + 1,
    'previous_assignee', v_task.assignee_id,
    'overdue', v_overdue
  );
end;
$function$;

comment on function public.recover_stalled_task(uuid, numeric, integer, numeric) is
  'Fija el plazo de una tarea adjudicada o, si venció o la tarea falló, la devuelve al '
  'mercado. Sin reasignaciones disponibles, el proyecto pasa a failed. Todo o nada.';


-- =========================================================================================
-- 03 · Privilegios
-- =========================================================================================
-- La invoca el vigilante con la identidad de los agentes. Ningún rol de cliente puede
-- quitarle una tarea a otro ni hacer fallar un proyecto.
revoke all on function public.recover_stalled_task(uuid, numeric, integer, numeric) from public;
revoke all on function public.recover_stalled_task(uuid, numeric, integer, numeric)
  from anon, authenticated;


-- =========================================================================================
-- FIN — db/migrations/0010_recuperar_tareas.sql
-- Verificación: db/verify/08_recuperar_tareas.sql
-- =========================================================================================
