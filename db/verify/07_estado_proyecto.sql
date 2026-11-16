-- =====================================================================================
-- VEKTORA · FASE 8 — Verificación del estado automático del proyecto
-- =====================================================================================
-- Sobre base LOCAL desechable. Requiere db/00_plataforma.sql + schema + 0002..0009.
--
-- Lo que se prueba: que el proyecto pase solo a `active` y a `completed` siguiendo a sus
-- tareas, que no pise lo que decidió la persona (pausar, cancelar) y que ningún rol de
-- cliente pueda cerrarlo a mano.
--
-- Cada comprobación avisa con WARNING 'FALLO: …' (el CI los busca) o NOTICE 'OK: …'.
-- =====================================================================================
\set ON_ERROR_STOP on
\pset pager off
set search_path = public, extensions;

\echo '=== Preparación: proyecto planificado con dos tareas y un proveedor'
insert into auth.users (id, email) values
  ('99990000-0000-0000-0000-000000000001', 'cliente@estado.test'),
  ('99990000-0000-0000-0000-000000000002', 'proveedor@estado.test');

insert into public.projects (id, owner_id, title, objective, budget_total, status)
values ('99991000-0000-0000-0000-000000000001', '99990000-0000-0000-0000-000000000001',
        'Proyecto estado', 'Objetivo de prueba para el estado automático del proyecto', 600, 'planned');

insert into public.project_tasks (id, project_id, code, title, description,
       required_skills, estimated_hours, budget, status)
values
  ('99992000-0000-0000-0000-000000000001', '99991000-0000-0000-0000-000000000001',
   'T-01', 'Primera tarea', 'Descripción', array['seo'], 5, 300, 'ready'),
  ('99992000-0000-0000-0000-000000000002', '99991000-0000-0000-0000-000000000001',
   'T-02', 'Segunda tarea', 'Descripción', array['seo'], 5, 300, 'ready');

-- Estado del proyecto de esta prueba, para no repetir el id en cada bloque.
create or replace function pg_temp.estado() returns public.project_status
language sql as $$
  select status from public.projects where id = '99991000-0000-0000-0000-000000000001';
$$;


\echo ''
\echo '=== 1. Sin trabajo empezado, el proyecto sigue planned'
do $$
begin
  if pg_temp.estado() <> 'planned' then
    raise warning 'FALLO: un proyecto sin trabajo empezado dejó de estar planned (%)', pg_temp.estado();
  else
    raise notice 'OK: planned mientras nadie tiene trabajo';
  end if;
end $$;


\echo ''
\echo '=== 2. La primera adjudicación lo pasa a active y fecha el inicio'
update public.project_tasks
   set assignee_id = '99990000-0000-0000-0000-000000000002', status = 'assigned'
 where id = '99992000-0000-0000-0000-000000000001';
do $$
declare
  v_iniciado boolean;
begin
  select started_at is not null into v_iniciado
    from public.projects where id = '99991000-0000-0000-0000-000000000001';
  if pg_temp.estado() <> 'active' or not v_iniciado then
    raise warning 'FALLO: tras adjudicar una tarea se esperaba active con started_at (%)', pg_temp.estado();
  else
    raise notice 'OK: active al adjudicarse la primera tarea';
  end if;
end $$;


\echo ''
\echo '=== 3. Con una tarea aprobada y otra pendiente NO se completa'
update public.project_tasks set status = 'approved'
 where id = '99992000-0000-0000-0000-000000000001';
do $$
begin
  if pg_temp.estado() <> 'active' then
    raise warning 'FALLO: el proyecto se cerró con tareas pendientes (%)', pg_temp.estado();
  else
    raise notice 'OK: sigue active mientras quede una tarea sin aprobar';
  end if;
end $$;


\echo ''
\echo '=== 4. Pausado por la persona: las tareas avanzan pero el estado no se pisa'
update public.projects set status = 'paused'
 where id = '99991000-0000-0000-0000-000000000001';
update public.project_tasks
   set assignee_id = '99990000-0000-0000-0000-000000000002', status = 'approved'
 where id = '99992000-0000-0000-0000-000000000002';
do $$
begin
  if pg_temp.estado() <> 'paused' then
    raise warning 'FALLO: una tarea aprobada sacó al proyecto de la pausa (%)', pg_temp.estado();
  else
    raise notice 'OK: paused se respeta aunque todas las tareas estén aprobadas';
  end if;
end $$;


\echo ''
\echo '=== 5. Al reanudar, se completa solo (ya no queda ninguna tarea por cambiar)'
update public.projects set status = 'active'
 where id = '99991000-0000-0000-0000-000000000001';
do $$
declare
  v_fechado boolean;
begin
  select completed_at is not null into v_fechado
    from public.projects where id = '99991000-0000-0000-0000-000000000001';
  if pg_temp.estado() <> 'completed' or not v_fechado then
    raise warning 'FALLO: al reanudar con todo aprobado se esperaba completed con completed_at (%)', pg_temp.estado();
  else
    raise notice 'OK: completed con fecha de cierre';
  end if;
end $$;


\echo ''
\echo '=== 6. Una tarea nueva reabre el proyecto: si no, el emparejador la ignoraría'
insert into public.project_tasks (id, project_id, code, title, description,
       required_skills, estimated_hours, budget, status)
values ('99992000-0000-0000-0000-000000000003', '99991000-0000-0000-0000-000000000001',
        'T-03', 'Tarea agregada al replanificar', 'Descripción', array['seo'], 5, 100, 'ready');
do $$
declare
  v_cierre timestamptz;
begin
  select completed_at into v_cierre
    from public.projects where id = '99991000-0000-0000-0000-000000000001';
  if pg_temp.estado() <> 'active' or v_cierre is not null then
    raise warning 'FALLO: un proyecto completado con una tarea nueva debe volver a active sin fecha de cierre (%)', pg_temp.estado();
  else
    raise notice 'OK: vuelve a active y se borra la fecha de cierre';
  end if;
end $$;


\echo ''
\echo '=== 7. Una tarea cancelada no impide completar'
update public.project_tasks set status = 'cancelled'
 where id = '99992000-0000-0000-0000-000000000003';
do $$
begin
  if pg_temp.estado() <> 'completed' then
    raise warning 'FALLO: una tarea cancelada dejó el proyecto sin poder completarse (%)', pg_temp.estado();
  else
    raise notice 'OK: las canceladas no cuentan para completar';
  end if;
end $$;


\echo ''
\echo '=== 8. Cancelado por la persona: nada lo reabre'
update public.projects set status = 'cancelled'
 where id = '99991000-0000-0000-0000-000000000001';
update public.project_tasks set status = 'ready'
 where id = '99992000-0000-0000-0000-000000000003';
do $$
begin
  if pg_temp.estado() <> 'cancelled' then
    raise warning 'FALLO: un cambio de tarea reabrió un proyecto cancelado (%)', pg_temp.estado();
  else
    raise notice 'OK: cancelled es definitivo';
  end if;
end $$;


\echo ''
\echo '=== 9. Borrar el proyecto sigue funcionando con el disparador de tareas'
do $$
begin
  delete from public.projects where id = '99991000-0000-0000-0000-000000000001';
  if exists (select 1 from public.project_tasks
              where project_id = '99991000-0000-0000-0000-000000000001') then
    raise warning 'FALLO: quedaron tareas de un proyecto borrado';
  else
    raise notice 'OK: el borrado en cascada no tropieza con el disparador';
  end if;
end $$;


\echo ''
\echo '=== 10. Ningún rol de cliente puede cerrar un proyecto a mano'
do $$
begin
  if has_function_privilege('anon', 'public.refresh_project_status(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refresh_project_status(uuid)', 'EXECUTE')
  then
    raise warning 'FALLO: anon o authenticated tienen EXECUTE sobre refresh_project_status';
  else
    raise notice 'OK: refresh_project_status no es invocable por roles de cliente';
  end if;
end $$;

\echo ''
\echo '=== FASE 8 (estado del proyecto) verificada ==='
