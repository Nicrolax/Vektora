-- =====================================================================================
-- VEKTORA · FASE 8 — Verificación de plazos de entrega y reapertura de tareas
-- =====================================================================================
-- Sobre base LOCAL desechable. Requiere db/00_plataforma.sql + schema + 0002..0010.
--
-- Lo que se prueba: que una tarea adjudicada a alguien que no entrega, o que el juez dio por
-- fallida, vuelva sola al mercado; que no vuelva a quien ya la tuvo; que un pedido de
-- cambios abra un plazo nuevo; y que, agotadas las reasignaciones, el proyecto falle en vez
-- de quedar esperando.
--
-- Cada comprobación avisa con WARNING 'FALLO: …' (el CI los busca) o NOTICE 'OK: …'.
-- =====================================================================================
\set ON_ERROR_STOP on
\pset pager off
set search_path = public, extensions;

\echo '=== Preparación: T-01 adjudicada a A (B y C perdieron), T-02 depende de ella'
insert into auth.users (id, email) values
  ('77770000-0000-0000-0000-000000000001', 'cliente@plazo.test'),
  ('77770000-0000-0000-0000-00000000000a', 'a@plazo.test'),
  ('77770000-0000-0000-0000-00000000000b', 'b@plazo.test'),
  ('77770000-0000-0000-0000-00000000000c', 'c@plazo.test');

insert into public.provider_profiles (user_id, headline, is_active, accepts_auto_assign, reputation_score)
values
  ('77770000-0000-0000-0000-00000000000a', 'Proveedor A', true, true, 20),
  ('77770000-0000-0000-0000-00000000000b', 'Proveedor B', true, true, 20),
  ('77770000-0000-0000-0000-00000000000c', 'Proveedor C', true, true, 20);

insert into public.projects (id, owner_id, title, objective, budget_total, status)
values ('77771000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-000000000001',
        'Proyecto plazos', 'Objetivo de prueba para plazos de entrega y reapertura', 600, 'active');

insert into public.project_tasks (id, project_id, code, title, description, acceptance_criteria,
       required_skills, estimated_hours, budget, status, assignee_id, assigned_at)
values
  ('77772000-0000-0000-0000-000000000001', '77771000-0000-0000-0000-000000000001',
   'T-01', 'Tarea con plazo', 'Descripción',
   '[{"id":"AC-1","criterion":"Hay un informe","verification":"Se lee el informe"}]'::jsonb,
   array['seo'], 8, 300, 'assigned', '77770000-0000-0000-0000-00000000000a', now()),
  ('77772000-0000-0000-0000-000000000002', '77771000-0000-0000-0000-000000000001',
   'T-02', 'Tarea dependiente', 'Descripción', '[]'::jsonb,
   array['seo'], 8, 300, 'blocked', null, null);

insert into public.task_dependencies (task_id, depends_on_task_id)
values ('77772000-0000-0000-0000-000000000002', '77772000-0000-0000-0000-000000000001');

insert into public.task_applications (task_id, provider_id, status, is_auto_generated, match_score, decided_at)
values
  ('77772000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-00000000000a', 'accepted', true, 0.8, now()),
  ('77772000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-00000000000b', 'rejected', true, 0.7, now()),
  ('77772000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-00000000000c', 'rejected', true, 0.6, now());

-- Atajos para no repetir ids: el vigilante con ventana de 48 h, tope de 2 y multa de 8.
create or replace function pg_temp.recuperar(p_ventana numeric default 48, p_tope integer default 2)
returns jsonb language sql as $$
  select public.recover_stalled_task(
    p_task_id => '77772000-0000-0000-0000-000000000001', p_window_hours => p_ventana,
    p_max_reassignments => p_tope, p_deadline_penalty => 8);
$$;
create or replace function pg_temp.tarea() returns public.project_tasks
language sql as $$
  select * from public.project_tasks where id = '77772000-0000-0000-0000-000000000001';
$$;
create or replace function pg_temp.candidatura(p_letra text) returns public.application_status
language sql as $$
  select status from public.task_applications
   where task_id = '77772000-0000-0000-0000-000000000001'
     and provider_id = ('77770000-0000-0000-0000-00000000000' || p_letra)::uuid;
$$;


\echo ''
\echo '=== 1. Con el plazo vigente solo se escribe due_at'
do $$
declare
  v jsonb := pg_temp.recuperar();
  t public.project_tasks := pg_temp.tarea();
begin
  if v ->> 'action' <> 'deadline_set' or t.assignee_id is null
     or t.due_at is null or abs(extract(epoch from (t.due_at - t.assigned_at)) - 48 * 3600) > 1 then
    raise warning 'FALLO: con el plazo vigente se esperaba deadline_set y due_at = adjudicación + 48 h (%)', v;
  else
    raise notice 'OK: plazo escrito a 48 h de la adjudicación, la tarea sigue con su proveedor';
  end if;
end $$;


\echo ''
\echo '=== 2. Entregada y esperando veredicto: el reloj NO corre'
update public.project_tasks set status = 'submitted', assigned_at = now() - interval '30 days'
 where id = '77772000-0000-0000-0000-000000000001';
do $$
declare
  v jsonb := pg_temp.recuperar();
begin
  if v ->> 'action' <> 'none' or (pg_temp.tarea()).assignee_id is null then
    raise warning 'FALLO: se le quitó la tarea a un proveedor que ya entregó (%)', v;
  else
    raise notice 'OK: una tarea entregada no vence: ahí quien debe algo es el evaluador';
  end if;
end $$;


\echo ''
\echo '=== 3. Plazo vencido: vuelve al mercado y se cobra el incumplimiento UNA vez'
update public.project_tasks set status = 'assigned', assigned_at = now() - interval '3 days'
 where id = '77772000-0000-0000-0000-000000000001';
do $$
declare
  v jsonb := pg_temp.recuperar();
  t public.project_tasks := pg_temp.tarea();
  v_eventos integer;
  v_reputacion numeric;
  v_auditoria integer;
begin
  if v ->> 'action' <> 'reopened' or t.status <> 'ready' or t.assignee_id is not null
     or t.reassignments <> 1 or t.due_at is not null or t.matching_rounds <> 0 then
    raise warning 'FALLO: una tarea vencida debía volver a ready, sin proveedor y con 1 reasignación (%)', v;
  else
    raise notice 'OK: tarea vencida de vuelta en ready (%)', v ->> 'reason';
  end if;

  if pg_temp.candidatura('a') <> 'expired' or pg_temp.candidatura('b') <> 'pending'
     or pg_temp.candidatura('c') <> 'pending' then
    raise warning 'FALLO: candidaturas tras reabrir: A=%, B=%, C=% (se esperaba expired, pending, pending)',
      pg_temp.candidatura('a'), pg_temp.candidatura('b'), pg_temp.candidatura('c');
  else
    raise notice 'OK: la candidatura de A vence y las de B y C vuelven a competir';
  end if;

  select count(*) into v_eventos from public.reputation_events
   where task_id = t.id and event_type = 'deadline_missed'
     and user_id = '77770000-0000-0000-0000-00000000000a';
  select reputation_score into v_reputacion from public.provider_profiles
   where user_id = '77770000-0000-0000-0000-00000000000a';
  if v_eventos <> 1 or v_reputacion <> 12 then
    raise warning 'FALLO: se esperaba 1 evento deadline_missed y reputación 20 - 8 = 12 (hay % y %)', v_eventos, v_reputacion;
  else
    raise notice 'OK: plazo incumplido cobrado una vez (reputación 20 -> 12)';
  end if;

  select count(*) into v_auditoria from public.audit_logs
   where entity_id = t.id and action = 'task.reopened';
  if v_auditoria <> 1 then
    raise warning 'FALLO: la reapertura no quedó en audit_logs';
  else
    raise notice 'OK: la reapertura queda explicada en audit_logs';
  end if;
end $$;


\echo ''
\echo '=== 4. Quien dejó vencer la tarea no vuelve a recibirla'
do $$
declare
  v_a boolean;
  v_b boolean;
begin
  select bool_or(user_id = '77770000-0000-0000-0000-00000000000a'),
         bool_or(user_id = '77770000-0000-0000-0000-00000000000b')
    into v_a, v_b
    from public.match_task_candidates(
      p_task_id => '77772000-0000-0000-0000-000000000001', p_limit => 50, p_require_auto_assign => true);
  if coalesce(v_a, false) or not coalesce(v_b, false) then
    raise warning 'FALLO: candidatos de la tarea reabierta: A=% (debe ser falso), B=% (debe ser verdadero)', v_a, v_b;
  else
    raise notice 'OK: A queda fuera de los candidatos y B sigue dentro';
  end if;
end $$;


\echo ''
\echo '=== 5. El intento del juez se cuenta por proveedor, y un pedido de cambios abre plazo nuevo'
-- A había dejado una entrega; B recibe la tarea y entrega la suya (versión 2 de la tarea).
insert into public.deliverables (task_id, provider_id, summary, content, evidence, qa_status, qa_evaluated_at)
values ('77772000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-00000000000a',
        'Entrega de A', 'Contenido de A', '{}'::jsonb, 'revision_requested', now() - interval '5 days');
select public.accept_task_application(
  (select id from public.task_applications
    where task_id = '77772000-0000-0000-0000-000000000001'
      and provider_id = '77770000-0000-0000-0000-00000000000b')) is not null as adjudicada_a_b;
insert into public.deliverables (id, task_id, provider_id, summary, content, evidence)
values ('77773000-0000-0000-0000-00000000000b', '77772000-0000-0000-0000-000000000001',
        '77770000-0000-0000-0000-00000000000b', 'Entrega de B', 'Contenido de B', '{"AC-1":"informe"}'::jsonb);
update public.project_tasks set status = 'submitted', assigned_at = now() - interval '10 days'
 where id = '77772000-0000-0000-0000-000000000001';
do $$
declare
  v_toma jsonb := public.claim_deliverable_for_qa('77773000-0000-0000-0000-00000000000b');
  v      jsonb;
  t      public.project_tasks;
begin
  if (v_toma -> 'deliverable' ->> 'version')::int <> 2 or (v_toma -> 'deliverable' ->> 'attempt')::int <> 1 then
    raise warning 'FALLO: la primera entrega de B debía ser versión 2 e intento 1 (%)', v_toma -> 'deliverable';
  else
    raise notice 'OK: versión 2 de la tarea, intento 1 del proveedor';
  end if;

  perform public.apply_qa_verdict(
    p_deliverable_id      => '77773000-0000-0000-0000-00000000000b',
    p_qa_status           => 'revision_requested',
    p_qa_score            => 0,
    p_qa_feedback         => '{}'::jsonb,
    p_qa_criteria_results => '[]'::jsonb,
    p_task_status         => 'revision_requested',
    p_rating              => 0);

  -- Adjudicada hace 10 días con una ventana de 48 h: sin la referencia del veredicto, vencida.
  v := pg_temp.recuperar();
  t := pg_temp.tarea();
  if v ->> 'action' <> 'deadline_set' or t.assignee_id <> '77770000-0000-0000-0000-00000000000b'
     or t.due_at < now() + interval '47 hours' then
    raise warning 'FALLO: un pedido de cambios recién emitido debía abrir un plazo nuevo de 48 h (%)', v;
  else
    raise notice 'OK: el plazo se cuenta desde el pedido de cambios, no desde la adjudicación';
  end if;
end $$;


\echo ''
\echo '=== 6. Una tarea fallida vuelve al mercado sin cobrar plazo'
update public.project_tasks set status = 'failed'
 where id = '77772000-0000-0000-0000-000000000001';
do $$
declare
  v jsonb := pg_temp.recuperar();
  t public.project_tasks := pg_temp.tarea();
  v_eventos integer;
begin
  select count(*) into v_eventos from public.reputation_events
   where task_id = t.id and event_type = 'deadline_missed'
     and user_id = '77770000-0000-0000-0000-00000000000b';
  if v ->> 'action' <> 'reopened' or t.status <> 'ready' or t.assignee_id is not null
     or t.reassignments <> 2 or v_eventos <> 0 then
    raise warning 'FALLO: una tarea fallida debía reabrirse (2 reasignaciones) sin multa de plazo (%; eventos %)', v, v_eventos;
  elsif pg_temp.candidatura('b') <> 'expired' or pg_temp.candidatura('c') <> 'pending' then
    raise warning 'FALLO: candidaturas tras la segunda reapertura: B=%, C=%', pg_temp.candidatura('b'), pg_temp.candidatura('c');
  else
    raise notice 'OK: tarea fallida de vuelta en ready; B fuera, C compite';
  end if;
end $$;


\echo ''
\echo '=== 7. Sin reasignaciones, el proyecto falla en vez de quedar esperando'
select public.accept_task_application(
  (select id from public.task_applications
    where task_id = '77772000-0000-0000-0000-000000000001'
      and provider_id = '77770000-0000-0000-0000-00000000000c')) is not null as adjudicada_a_c;
update public.project_tasks set status = 'failed'
 where id = '77772000-0000-0000-0000-000000000001';
do $$
declare
  v jsonb := pg_temp.recuperar();
  t public.project_tasks := pg_temp.tarea();
  v_proyecto  public.project_status;
  v_cerrado   boolean;
  v_auditoria integer;
  v_t02       public.task_status;
begin
  select status, completed_at is not null into v_proyecto, v_cerrado
    from public.projects where id = '77771000-0000-0000-0000-000000000001';
  select count(*) into v_auditoria from public.audit_logs
   where project_id = '77771000-0000-0000-0000-000000000001' and action = 'project.failed';
  select status into v_t02 from public.project_tasks where id = '77772000-0000-0000-0000-000000000002';

  if v ->> 'action' <> 'project_failed' or v_proyecto <> 'failed' or not v_cerrado
     or t.status <> 'failed' or v_auditoria <> 1 then
    raise warning 'FALLO: agotadas las reasignaciones se esperaba proyecto failed con fecha y auditoría (%; proyecto %)', v, v_proyecto;
  else
    raise notice 'OK: proyecto failed tras 2 reasignaciones, explicado en audit_logs';
  end if;
  if v_t02 <> 'blocked' then
    raise warning 'FALLO: la tarea dependiente cambió de estado (%)', v_t02;
  end if;
end $$;


\echo ''
\echo '=== 8. Un proyecto fallido no se vuelve a tocar'
do $$
declare
  v jsonb := pg_temp.recuperar();
begin
  if v ->> 'action' <> 'none' then
    raise warning 'FALLO: el vigilante actuó sobre un proyecto que ya falló (%)', v;
  else
    raise notice 'OK: failed es un final (%)', v ->> 'reason';
  end if;
end $$;


\echo ''
\echo '=== 9. Ningún rol de cliente puede quitarle una tarea a otro'
do $$
begin
  if has_function_privilege('anon', 'public.recover_stalled_task(uuid, numeric, integer, numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.recover_stalled_task(uuid, numeric, integer, numeric)', 'EXECUTE')
  then
    raise warning 'FALLO: anon o authenticated tienen EXECUTE sobre recover_stalled_task';
  else
    raise notice 'OK: recover_stalled_task no es invocable por roles de cliente';
  end if;
end $$;

\echo ''
\echo '=== FASE 8 (plazos y reapertura) verificada ==='
