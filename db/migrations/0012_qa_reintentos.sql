-- =========================================================================================
-- VEKTORA · FASE 8 — La cola del juez: un entregable que falla no tapa a los demás
-- =========================================================================================
-- Depende de: db/schema.sql y las migraciones 0002 a 0011.
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- Reemplaza `claim_deliverable_for_qa` y `pending_qa_deliverables` de la 0008. Va DESPUÉS de
-- la 0008 siempre: reaplicar solo la 0008 devolvería las versiones sin espera.
--
-- EL PROBLEMA. Un entregable que el juez no pudo evaluar (modelo caído, salida inválida, un
-- juicio cortado a los 300 s) vuelve a la cola como `error` y se reintenta en la corrida
-- siguiente, sin espera ni orden por fallos. La cola se recorre del más antiguo al más
-- reciente y toma diez por corrida: diez entregables viejos que fallan SIEMPRE ocupan los
-- diez huecos en cada corrida, y lo que se entrega después no se evalúa nunca. No lanza
-- ningún error: solo gasta una llamada al modelo por entregable cada diez minutos y deja al
-- resto de las tareas esperando.
--
-- LO QUE CAMBIA.
--   · Cada fallo suma uno a `qa_error_count` y fija `qa_retry_at`: la cola no vuelve a
--     ofrecer el entregable hasta entonces. La espera crece (5, 10, 20… minutos) hasta un
--     techo de 6 horas; nunca se abandona, así que una avería pasajera se cura sola.
--   · La cola ordena por fallos y después por antigüedad (la misma regla que la 0009 le
--     dio al emparejador): lo que nunca falló pasa delante de lo que ya falló cinco veces.
--     Filtrar por la espera no alcanza: diez errores viejos que vencen a la vez volverían a
--     llenar los diez huecos.
--   · Un turno abandonado también es un fallo. Un juicio que siempre muere al corte de 300 s
--     no llega nunca a soltar el turno, así que solo la toma puede contarlo.
--   · Se guarda el CÓDIGO de cada fallo (`rate_limit`, `invalid_output`, `abandoned`…).
--
-- La espera es solo de la cola: `npm run qa -- <id>` puede forzar un reintento cuando quiera.
-- Cuenta TODO fallo, también una caída de la IA: tras una caída larga, lo que esperaba puede
-- tardar hasta 6 horas en volver. El techo no está medido.
--
-- LA SALIDA. La espera evita que un entregable que nunca se puede juzgar tape la cola, pero
-- no le da salida: su tarea quedaría en `submitted` para siempre. `give_up_deliverable_qa`
-- se la da, sin convertir nuestra avería en un veredicto:
--   · Solo cuentan los fallos en los que el modelo RESPONDIÓ y la respuesta no sirvió
--     (salida inválida, cortada, bloqueada…) o el juicio murió a mitad. Una caída, una cuota
--     agotada o un error de la base no cuentan nunca: los decide `lib/qa` (`qa_unjudgeable`).
--   · La primera vez, la versión se DEVUELVE al proveedor: la tarea pasa a
--     `revision_requested` con un plazo nuevo, sin reseña, sin reputación y sin contar como
--     intento. La segunda vez del mismo proveedor en la misma tarea, la tarea pasa a
--     `failed` y la 0010 la devuelve al mercado, también sin multa.
--   · Para no expulsar entregables en masa cuando el modelo empieza a responder mal para
--     TODOS, hace falta evidencia de que el juez funciona: otro entregable recibió un
--     veredicto del modelo después de que este empezara a fallar. Sin esa evidencia se
--     espera, hasta un plazo de dispensa (en una instalación sin movimiento no llegaría nunca).
-- =========================================================================================

set search_path = public, extensions;


-- =========================================================================================
-- 01 · Contador de fallos y próxima vez que la cola lo ofrece
-- =========================================================================================
alter table public.deliverables
  add column if not exists qa_error_count integer not null default 0,
  add column if not exists qa_retry_at timestamptz,
  add column if not exists qa_unjudgeable_count integer not null default 0,
  add column if not exists qa_unjudgeable_since timestamptz,
  add column if not exists qa_given_up_at timestamptz;

comment on column public.deliverables.qa_unjudgeable_count is
  'Fallos del juez atribuibles a ESTE entregable (el modelo respondió algo inutilizable o el '
  'juicio murió a mitad). Las averías nuestras no cuentan. Decide cuándo darlo por no evaluable.';
comment on column public.deliverables.qa_unjudgeable_since is
  'Primer fallo atribuible al entregable: desde ahí se busca evidencia de que el juez funciona.';
comment on column public.deliverables.qa_given_up_at is
  'El juez dejó de intentar evaluar esta versión (give_up_deliverable_qa). Sale de la cola, '
  'no se puede volver a tomar y no cuenta como intento del proveedor.';

comment on column public.deliverables.qa_error_count is
  'Veces que el juez no pudo terminar de evaluar este entregable (error o turno abandonado). '
  'Ordena la cola: lo que menos falló pasa primero.';
comment on column public.deliverables.qa_retry_at is
  'Antes de este momento la cola no vuelve a ofrecer un entregable en error. Lo fija '
  'fail_deliverable_qa con qa_retry_delay.';

-- Espera tras el fallo número `n`: 5 min × 2^(n-1), con techo de 6 horas. Como
-- `qa_claim_timeout`, es ritmo de reintento y no política de veredicto, y vive en una
-- función para que la toma, el fallo y la cola no puedan discrepar.
create or replace function public.qa_retry_delay(p_errors integer)
returns interval
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select case
    when coalesce(p_errors, 0) <= 0 then interval '0'
    -- 2^7 × 5 min ya pasa de 6 h: se corta el exponente antes para no desbordar.
    else least(interval '5 minutes' * power(2, least(p_errors, 8) - 1), interval '6 hours')
  end;
$function$;

-- La cola filtra por esta columna en cada corrida.
create index if not exists idx_deliverables_qa_reintento
  on public.deliverables (qa_status, qa_retry_at)
  where qa_status in ('pending', 'error', 'running');


-- =========================================================================================
-- 02 · fail_deliverable_qa — soltar el turno CONTANDO el fallo
-- =========================================================================================
-- Función nueva y no un parámetro más en `release_deliverable_qa` (0005): con un parámetro
-- con valor por defecto, reaplicar la 0005 dejaría dos versiones y la llamada sería ambigua.
-- `release_deliverable_qa` sigue existiendo para devolver un ensayo a su estado anterior,
-- que no es un fallo y no debe contar.
--
-- `p_unjudgeable` lo decide `lib/qa` según el código: SQL no clasifica causas.
create or replace function public.fail_deliverable_qa(
  p_deliverable_id uuid,
  p_error          text,
  p_error_code     text,
  p_unjudgeable    boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_errors      integer;
  v_unjudgeable integer;
  v_retry_at    timestamptz;
begin
  update public.deliverables d
     set qa_status            = 'error',
         qa_error_count       = d.qa_error_count + 1,
         qa_retry_at          = now() + public.qa_retry_delay(d.qa_error_count + 1),
         qa_unjudgeable_count = d.qa_unjudgeable_count
                                + case when coalesce(p_unjudgeable, false) then 1 else 0 end,
         qa_unjudgeable_since = case
           when coalesce(p_unjudgeable, false) then coalesce(d.qa_unjudgeable_since, now())
           else d.qa_unjudgeable_since
         end,
         qa_feedback          = d.qa_feedback || jsonb_build_object(
           'last_error',      coalesce(p_error, 'sin detalle'),
           'last_error_code', coalesce(p_error_code, 'unexpected'),
           'last_error_at',   to_jsonb(now())
         ),
         updated_at           = now()
   where d.id = p_deliverable_id
     and d.qa_status = 'running'
  returning d.qa_error_count, d.qa_unjudgeable_count, d.qa_retry_at
       into v_errors, v_unjudgeable, v_retry_at;

  if v_errors is null then
    return jsonb_build_object(
      'released', false,
      'reason', 'el entregable no estaba en qa_status=running: otro proceso lo resolvió antes'
    );
  end if;

  return jsonb_build_object(
    'released',          true,
    'error_count',       v_errors,
    'unjudgeable_count', v_unjudgeable,
    'retry_at',          v_retry_at
  );
end;
$function$;


-- =========================================================================================
-- 03 · claim_deliverable_for_qa — la toma cuenta los turnos abandonados
-- =========================================================================================
-- Igual que en la 0008, con cuatro cambios:
--   · un turno abandonado suma un fallo, y es atribuible al entregable (un juicio que muere
--     siempre en el mismo entregable es el caso que la salida tiene que poder cerrar);
--   · un entregable dado por no evaluable NO se toma: ni la cola ni `npm run qa` pueden
--     escribir un veredicto sobre una tarea que ya se devolvió o volvió al mercado;
--   · una versión dada por no evaluable no cuenta como intento del proveedor;
--   · la respuesta informa los fallos.
-- La toma NO toca `qa_retry_at`: si este juicio también muere, la cola calcula la espera
-- desde `qa_claimed_at` (ver `pending_qa_deliverables`).
create or replace function public.claim_deliverable_for_qa(p_deliverable_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current    public.qa_status;
  v_previous   public.qa_status;
  v_task_id    uuid;
  v_version    integer;
  v_claimed_at timestamptz;
  v_errors     integer;
  v_unjudgeable integer;
  v_given_up   timestamptz;
  v_abandoned  boolean := false;
  v_result     jsonb;
begin
  select d.qa_status, d.task_id, d.version, coalesce(d.qa_claimed_at, d.updated_at),
         d.qa_error_count, d.qa_unjudgeable_count, d.qa_given_up_at
    into v_current, v_task_id, v_version, v_claimed_at, v_errors, v_unjudgeable, v_given_up
    from public.deliverables d
   where d.id = p_deliverable_id
   for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no existe ningún entregable con ese id'
    );
  end if;

  if v_given_up is not null then
    return jsonb_build_object(
      'claimed', false,
      'qa_status', v_current,
      'reason', 'el juez ya dio esta versión por no evaluable: lo que sigue es otra versión '
                'o la tarea de vuelta en el mercado'
    );
  end if;

  -- Un turno abandonado se retoma. Sin esto, el proceso que murió con el turno tomado
  -- sería el único que podía devolverlo.
  v_abandoned := v_current = 'running'
             and v_claimed_at < now() - public.qa_claim_timeout();

  if not v_abandoned and v_current not in ('pending', 'error') then
    return jsonb_build_object(
      'claimed', false,
      'qa_status', v_current,
      'reason', format(
        'el entregable está en qa_status=%s: %s',
        v_current,
        case v_current
          when 'running'  then 'otro juez lo tiene tomado ahora mismo'
          when 'approved' then 'ya fue aprobado y el veredicto es terminal'
          when 'rejected' then 'ya fue rechazado y el veredicto es terminal'
          when 'revision_requested' then
            'ya tiene veredicto; lo que sigue es una versión nueva del proveedor'
          else 'no admite juicio automático'
        end
      )
    );
  end if;

  -- Solo se juzga la última versión. Una versión superada ya no decide nada sobre la
  -- tarea: juzgarla sería gastar una llamada al modelo para, en el peor caso, pisar el
  -- estado que dejó la versión vigente.
  if exists (
    select 1 from public.deliverables n
     where n.task_id = v_task_id and n.version > v_version
  ) then
    return jsonb_build_object(
      'claimed', false,
      'qa_status', v_current,
      'reason', 'hay una versión más nueva de esta entrega: solo se juzga la última'
    );
  end if;

  -- El juicio anterior murió sin soltar el turno: es un fallo, y es el único momento en que
  -- se puede contar (nadie llegó a llamar a fail_deliverable_qa).
  if v_abandoned then
    v_errors := v_errors + 1;
    v_unjudgeable := v_unjudgeable + 1;
  end if;

  -- Un turno abandonado se informa como `pending`: es el estado al que hay que devolverlo
  -- si este juicio resulta ser un ensayo.
  v_previous := case when v_abandoned then 'pending'::public.qa_status else v_current end;

  update public.deliverables d
     set qa_status      = 'running',
         qa_claimed_at  = now(),
         qa_error_count = v_errors,
         qa_unjudgeable_count = v_unjudgeable,
         qa_unjudgeable_since = case
           when v_abandoned then coalesce(d.qa_unjudgeable_since, now())
           else d.qa_unjudgeable_since
         end,
         qa_feedback    = case
           when v_abandoned then d.qa_feedback || jsonb_build_object(
             'last_error',      'el juicio anterior se cortó sin devolver el turno',
             'last_error_code', 'abandoned',
             'last_error_at',   to_jsonb(now())
           )
           else d.qa_feedback
         end,
         updated_at     = now()
   where d.id = p_deliverable_id;

  select jsonb_build_object(
    'claimed', true,
    'previous_status', v_previous,
    'reclaimed', v_abandoned,
    'qa_errors', v_errors,
    'qa_unjudgeable', v_unjudgeable,
    'deliverable', jsonb_build_object(
      'id',           d.id,
      'task_id',      d.task_id,
      'provider_id',  d.provider_id,
      'version',      d.version,
      -- Intento de ESTE proveedor, no versión de la tarea (ver la 0008). Una versión que el
      -- juez no pudo evaluar y devolvió no es un intento: el proveedor no la pudo defender.
      'attempt',      (
        select count(*)
          from public.deliverables a
         where a.task_id = d.task_id
           and a.provider_id = d.provider_id
           and a.version <= d.version
           and a.qa_given_up_at is null
      ),
      'summary',      d.summary,
      'content',      d.content,
      'artifacts',    d.artifacts,
      'evidence',     d.evidence,
      'submitted_at', d.submitted_at
    ),
    'task', jsonb_build_object(
      'id',                  t.id,
      'project_id',          t.project_id,
      'code',                t.code,
      'title',               t.title,
      'description',         t.description,
      'acceptance_criteria', t.acceptance_criteria,
      'required_skills',     t.required_skills,
      'status',              t.status,
      'assignee_id',         t.assignee_id,
      'budget',              t.budget,
      'estimated_hours',     t.estimated_hours
    ),
    'project', jsonb_build_object(
      'id',        p.id,
      'title',     p.title,
      'objective', p.objective
    ),
    'previous_rejections', (
      select count(*)
        from public.reputation_events re
       where re.task_id = d.task_id
         and re.event_type = 'deliverable_rejected'
    )
  )
  into v_result
  from public.deliverables d
  join public.project_tasks t on t.id = d.task_id
  join public.projects      p on p.id = t.project_id
  where d.id = p_deliverable_id;

  return v_result;
end;
$function$;


-- =========================================================================================
-- 04 · pending_qa_deliverables — los que menos fallaron primero, y nadie antes de su hora
-- =========================================================================================
-- Mismas columnas que en la 0008 a propósito: cambiar el tipo de retorno obligaría a borrar
-- la función, y reaplicar sql/ entero (la 0008 antes que esta) fallaría con «cannot change
-- return type of existing function».
--
-- Un turno abandonado espera el plazo del turno MÁS la espera de los fallos que ya lleva,
-- contado desde la toma: un juicio que siempre muere al corte no se retoma cada 15 minutos.
create or replace function public.pending_qa_deliverables(p_limit integer default 20)
returns table (
  deliverable_id uuid,
  task_id        uuid,
  project_id     uuid,
  task_code      text,
  task_title     text,
  provider_id    uuid,
  version        integer,
  qa_status      public.qa_status,
  submitted_at   timestamptz,
  criteria_count integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    d.id,
    d.task_id,
    t.project_id,
    t.code,
    t.title,
    d.provider_id,
    d.version,
    d.qa_status,
    d.submitted_at,
    coalesce(jsonb_array_length(t.acceptance_criteria), 0)::integer
  from public.deliverables d
  join public.project_tasks t on t.id = d.task_id
  where (
          d.qa_status = 'pending'
          or (d.qa_status = 'error'
              and coalesce(d.qa_retry_at, '-infinity'::timestamptz) <= now())
          or (d.qa_status = 'running'
              and coalesce(d.qa_claimed_at, d.updated_at)
                  < now() - public.qa_claim_timeout() - public.qa_retry_delay(d.qa_error_count))
        )
    and d.qa_given_up_at is null
    and not exists (
      select 1 from public.deliverables n
       where n.task_id = d.task_id and n.version > d.version
    )
  order by d.qa_error_count asc, d.submitted_at asc
  limit greatest(1, coalesce(p_limit, 20));
$function$;


-- =========================================================================================
-- 05 · give_up_deliverable_qa — la salida de un entregable que no se puede juzgar
-- =========================================================================================
-- La llama `lib/qa` cuando los fallos atribuibles al entregable llegan a su máximo. Todo
-- pasa bajo el candado del entregable y de la tarea, en una transacción:
--
--   · Primera vez de este proveedor en esta tarea → DEVOLVER: la tarea pasa a
--     `revision_requested` y la versión fija `qa_evaluated_at`, así la 0010 le abre un plazo
--     nuevo en vez de darlo por vencido.
--   · Segunda vez → la tarea pasa a `failed` y la 0010 la devuelve al mercado.
--
-- No escribe reseña ni reputación (por eso no pasa por `apply_qa_verdict`): no hubo
-- veredicto. Y no actúa si la tarea ya no espera a este entregable (otro estado, otro
-- proveedor, una versión más nueva): solo lo deja como estaba.
--
-- Freno contra la expulsión en masa: si el modelo empieza a responder mal para TODOS, la
-- culpa no es de ningún entregable. Hace falta evidencia de que el juez funciona —otro
-- entregable recibió un veredicto DEL MODELO (no uno resuelto sin IA) después del primer
-- fallo de este— o que pasen `p_waiver_hours` desde ese primer fallo. Sin la dispensa, en una
-- instalación sin más entregas la evidencia no llegaría nunca: otro estado sin salida.
create or replace function public.give_up_deliverable_qa(
  p_deliverable_id uuid,
  p_waiver_hours   numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_del      public.deliverables%rowtype;
  v_task     public.project_tasks%rowtype;
  v_evidence boolean;
  v_waived   boolean;
  v_before   boolean;
  v_action   text;
  v_summary  text;
begin
  select * into v_del from public.deliverables where id = p_deliverable_id for update;
  if not found then
    return jsonb_build_object('given_up', false, 'reason', 'no existe ningún entregable con ese id');
  end if;

  if v_del.qa_given_up_at is not null then
    return jsonb_build_object('given_up', false, 'reason', 'ya se había dado por no evaluable');
  end if;
  if v_del.qa_status not in ('running', 'error') then
    return jsonb_build_object('given_up', false,
      'reason', format('el entregable está en qa_status=%s: ya tiene salida', v_del.qa_status));
  end if;
  if v_del.qa_unjudgeable_since is null then
    return jsonb_build_object('given_up', false,
      'reason', 'no tiene ningún fallo atribuible al entregable');
  end if;
  if exists (select 1 from public.deliverables n
              where n.task_id = v_del.task_id and n.version > v_del.version) then
    return jsonb_build_object('given_up', false, 'reason', 'hay una versión más nueva');
  end if;

  select * into v_task from public.project_tasks where id = v_del.task_id for update;
  if v_task.status not in ('submitted', 'in_review')
     or v_task.assignee_id is distinct from v_del.provider_id then
    return jsonb_build_object('given_up', false,
      'reason', format('la tarea ya no espera esta entrega (status=%s)', v_task.status));
  end if;

  v_evidence := exists (
    select 1 from public.deliverables o
     where o.id <> v_del.id
       and o.qa_evaluated_at > v_del.qa_unjudgeable_since
       and o.qa_status in ('approved', 'rejected', 'revision_requested')
       and o.qa_given_up_at is null
       and coalesce((o.qa_feedback ->> 'skippedAi')::boolean, false) = false
  );
  v_waived := v_del.qa_unjudgeable_since
              < now() - make_interval(secs => (coalesce(p_waiver_hours, 48) * 3600)::double precision);

  if not v_evidence and not v_waived then
    return jsonb_build_object(
      'given_up', false,
      'held', true,
      'reason', 'el juez tampoco evaluó ningún otro entregable desde que este empezó a fallar: '
                'puede ser una avería nuestra, se sigue reintentando'
    );
  end if;

  v_before := exists (
    select 1 from public.deliverables p
     where p.task_id = v_del.task_id
       and p.provider_id = v_del.provider_id
       and p.qa_given_up_at is not null
  );
  v_action := case when v_before then 'failed' else 'returned' end;
  v_summary := case
    when v_before then
      'El evaluador automático tampoco pudo evaluar esta versión. No es un rechazo y no '
      'descuenta reputación, pero la tarea vuelve al mercado para que la tome otro proveedor.'
    else
      'El evaluador automático no pudo evaluar esta versión después de varios intentos. No es '
      'un rechazo ni cuenta como intento: volvé a entregarla, si podés más breve o con la '
      'evidencia de cada criterio más clara.'
  end;

  update public.deliverables d
     set qa_status       = 'error',
         qa_given_up_at  = now(),
         qa_evaluated_at = now(),
         qa_feedback     = d.qa_feedback || jsonb_build_object(
           'summary',  v_summary,
           'given_up', v_action,
           'evidence', case when v_evidence then 'otro entregable recibió veredicto' else 'dispensa por tiempo' end
         ),
         updated_at      = now()
   where d.id = v_del.id;

  update public.project_tasks t
     set status     = case when v_before then 'failed'::public.task_status
                           else 'revision_requested'::public.task_status end,
         updated_at = now()
   where t.id = v_task.id;

  insert into public.audit_logs (actor_type, action, entity_type, entity_id, project_id, changes)
  values ('ai_agent',
          case when v_before then 'qa.unjudgeable_failed' else 'qa.unjudgeable_returned' end,
          'deliverable', v_del.id, v_task.project_id,
          jsonb_build_object(
            'task_id', v_task.id,
            'task_code', v_task.code,
            'provider_id', v_del.provider_id,
            'version', v_del.version,
            'unjudgeable_failures', v_del.qa_unjudgeable_count,
            'last_error_code', v_del.qa_feedback ->> 'last_error_code',
            'evidence', v_evidence,
            'waived', v_waived and not v_evidence
          ));

  return jsonb_build_object(
    'given_up', true,
    'action', v_action,
    'task_status', case when v_before then 'failed' else 'revision_requested' end,
    'evidence', v_evidence,
    'waived', v_waived and not v_evidence
  );
end;
$function$;


-- =========================================================================================
-- 06 · Una versión dada por no evaluable no se puede reeditar
-- =========================================================================================
-- Queda en `error`, y la política del esquema deja al proveedor editar sus entregas en
-- `error`. Sin esta condición podría borrar `qa_given_up_at`: la versión volvería a la cola
-- y un veredicto podría caer sobre una tarea que ya se devolvió o volvió al mercado. Lo que
-- sigue tras una devolución es una versión NUEVA, no editar la vieja.
drop policy if exists deliverables_update on public.deliverables;
create policy deliverables_update on public.deliverables
  for update to authenticated
  using (
    (provider_id = auth.uid()
      and qa_status in ('pending', 'revision_requested', 'error')
      and qa_given_up_at is null)
    or is_task_owner(task_id) or is_admin()
  )
  with check (
    (provider_id = auth.uid()
      and qa_status in ('pending', 'revision_requested', 'error')
      and qa_given_up_at is null)
    or is_task_owner(task_id) or is_admin()
  );


-- =========================================================================================
-- 07 · Privilegios
-- =========================================================================================
-- Las funciones nuevas nacen con EXECUTE para PUBLIC. Se revoca todo para que el archivo se
-- sostenga solo: ningún rol de cliente puede tomar turnos, soltarlos ni ver la cola.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.qa_retry_delay(integer)',
    'public.fail_deliverable_qa(uuid, text, text, boolean)',
    'public.give_up_deliverable_qa(uuid, numeric)',
    'public.claim_deliverable_for_qa(uuid)',
    'public.pending_qa_deliverables(integer)'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated', v_fn);
  end loop;
end $$;


-- =========================================================================================
-- FIN — db/migrations/0012_qa_reintentos.sql
-- Verificación: db/verify/10_qa_reintentos.sql
-- =========================================================================================
