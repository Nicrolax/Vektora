-- =========================================================================================
-- VEKTORA · FASE 8 — El proyecto avanza y se cierra solo
-- =========================================================================================
-- Depende de: db/schema.sql y las migraciones 0002 a 0008.
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- Resuelve otra forma del mismo defecto: `projects.status` tenía los valores `active` y
-- `completed`, pero NADIE los escribía. `apply_project_plan` deja el proyecto en `planned`
-- y ahí se quedaba, con todas sus tareas aprobadas: el sistema entregaba el resultado y no
-- se enteraba. Cerrarlo habría exigido que una persona lo marcara a mano, y aquí no hay
-- ninguna.
--
-- La regla, derivada SOLO del estado de las tareas:
--
--   · todas las tareas no canceladas están `approved`  → `completed`
--   · alguna tarea ya tiene proveedor o veredicto      → `active`
--   · si no                                            → se deja como está
--
-- Solo se tocan los estados que decide el sistema (`planned`, `active`, `completed`).
-- `paused` y `cancelled` los eligió la persona dueña, y `draft` / `planning` / `failed` son
-- del planificador: ninguno se pisa desde aquí.
-- =========================================================================================

set search_path = public, extensions;


-- =========================================================================================
-- 01 · refresh_project_status — el estado del proyecto a partir de sus tareas
-- =========================================================================================
create or replace function public.refresh_project_status(p_project_id uuid)
returns public.project_status
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actual    public.project_status;
  v_nuevo     public.project_status;
  v_vigentes  integer;
  v_aprobadas integer;
  v_iniciado  boolean;
begin
  -- `for update`: dos tareas del mismo proyecto que cambian a la vez recalculan en fila,
  -- no cada una con una foto vieja de la otra.
  select p.status into v_actual
    from public.projects p
   where p.id = p_project_id
   for update;

  if not found then
    return null;  -- el proyecto se está borrando: la cascada llega aquí sin fila
  end if;

  if v_actual not in ('planned', 'active', 'completed') then
    return v_actual;
  end if;

  select count(*) filter (where t.status <> 'cancelled'),
         count(*) filter (where t.status = 'approved'),
         coalesce(bool_or(
           t.assignee_id is not null
           or t.status in ('assigned', 'in_progress', 'submitted', 'in_review',
                           'revision_requested', 'approved', 'failed')
         ), false)
    into v_vigentes, v_aprobadas, v_iniciado
    from public.project_tasks t
   where t.project_id = p_project_id;

  v_nuevo := case
    when v_vigentes > 0 and v_aprobadas = v_vigentes then 'completed'
    when v_iniciado                                  then 'active'
    -- Un proyecto completado al que se le agregan tareas (replanificación) se reabre: si
    -- siguiera `completed`, el emparejador las ignoraría para siempre.
    when v_actual = 'completed'                      then 'planned'
    else v_actual
  end;

  if v_nuevo is distinct from v_actual then
    update public.projects p
       set status       = v_nuevo,
           started_at   = case when v_nuevo in ('active', 'completed')
                               then coalesce(p.started_at, now())
                               else p.started_at end,
           completed_at = case when v_nuevo = 'completed' then now() else null end,
           updated_at   = now()
     where p.id = p_project_id;
  end if;

  return v_nuevo;
end;
$function$;

comment on function public.refresh_project_status(uuid) is
  'planned / active / completed según el estado de las tareas. No toca paused, cancelled, '
  'draft, planning ni failed. Devuelve el estado resultante.';


-- =========================================================================================
-- 02 · Disparadores
-- =========================================================================================
-- Sobre las tareas: cualquier cambio de estado o de proveedor, y también altas y bajas (una
-- replanificación agrega y quita tareas).
create or replace function public.propagate_project_status()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- En un DELETE no hay fila nueva; en un INSERT no hay fila vieja.
  if tg_op = 'DELETE' then
    perform public.refresh_project_status(old.project_id);
  else
    perform public.refresh_project_status(new.project_id);
  end if;
  return null;
end;
$function$;

drop trigger if exists trg_propagate_project_status on public.project_tasks;
create trigger trg_propagate_project_status
  after insert or delete or update of status, assignee_id on public.project_tasks
  for each row execute function public.propagate_project_status();

-- Sobre el proyecto: cuando vuelve a un estado que decide el sistema. El caso que importa
-- es reanudar un proyecto pausado cuyas tareas se aprobaron durante la pausa: sin esto
-- quedaría `active` para siempre, porque ya no hay ninguna tarea que vaya a cambiar.
create or replace function public.recheck_project_status()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform public.refresh_project_status(new.id);
  return null;
end;
$function$;

drop trigger if exists trg_recheck_project_status on public.projects;
create trigger trg_recheck_project_status
  after update of status on public.projects
  for each row
  when (new.status is distinct from old.status and new.status in ('planned', 'active'))
  execute function public.recheck_project_status();


-- =========================================================================================
-- 03 · Poner al día lo que ya existe
-- =========================================================================================
-- Los proyectos desplegados antes de esta migración quedaron en `planned` aunque tengan
-- trabajo en curso o todo aprobado. Reaplicar esto sobre una base al día no cambia nada.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id from public.projects p where p.status in ('planned', 'active', 'completed')
  loop
    perform public.refresh_project_status(v_id);
  end loop;
end $$;


-- =========================================================================================
-- 04 · Privilegios
-- =========================================================================================
-- Las tres funciones nacen con EXECUTE para PUBLIC. Los disparadores no lo necesitan (el
-- permiso se comprueba al crearlos) y ningún rol de cliente debe poder cerrar un proyecto
-- llamando a la función a mano.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.refresh_project_status(uuid)',
    'public.propagate_project_status()',
    'public.recheck_project_status()'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated', v_fn);
  end loop;
end $$;


-- =========================================================================================
-- FIN — db/migrations/0009_estado_proyecto.sql
-- Verificación: db/verify/07_estado_proyecto.sql
-- =========================================================================================
