-- =====================================================================================
-- VEKTORA · FASE 8 — Verificación de la cola del juez
-- =====================================================================================
-- Sobre base LOCAL desechable. Requiere db/00_plataforma.sql + schema + 0002..0008.
--
-- Lo que se prueba aquí es que el juez no pueda quedarse dando vueltas sobre un entregable
-- que ya tiene veredicto, que una versión vieja no pueda deshacer una tarea aprobada, y que
-- un turno tomado por un proceso que murió vuelva solo a la cola.
--
-- Cada comprobación avisa con WARNING 'FALLO: …' (el CI los busca) o NOTICE 'OK: …'.
-- =====================================================================================
\set ON_ERROR_STOP on
\pset pager off
set search_path = public, extensions;

\echo '=== Preparación: T-01 entregada, T-02 depende de ella, T-03 suelta'
insert into auth.users (id, email) values
  ('88880000-0000-0000-0000-000000000001', 'cliente@cola.test'),
  ('88880000-0000-0000-0000-000000000002', 'proveedor@cola.test');

insert into public.provider_profiles (user_id, headline, is_active, reputation_score)
values ('88880000-0000-0000-0000-000000000002', 'Proveedor cola', true, 10);

insert into public.projects (id, owner_id, title, objective, budget_total, status)
values ('88881000-0000-0000-0000-000000000001', '88880000-0000-0000-0000-000000000001',
        'Proyecto cola', 'Objetivo de prueba para la cola del juez automático', 900, 'active');

insert into public.project_tasks (id, project_id, code, title, description,
       acceptance_criteria, required_skills, estimated_hours, budget, status, assignee_id)
values
  ('88882000-0000-0000-0000-000000000001', '88881000-0000-0000-0000-000000000001',
   'T-01', 'Redactar el informe', 'Informe inicial',
   '[{"id":"AC-1","criterion":"Incluye conclusiones","verification":"Se leen las conclusiones"}]'::jsonb,
   array['technical-writing'], 8, 300, 'submitted', '88880000-0000-0000-0000-000000000002'),
  ('88882000-0000-0000-0000-000000000002', '88881000-0000-0000-0000-000000000001',
   'T-02', 'Presentar el informe', 'Depende del informe',
   '[{"id":"AC-1","criterion":"Hay una presentación","verification":"Se abre la presentación"}]'::jsonb,
   array['technical-writing'], 8, 300, 'blocked', null),
  ('88882000-0000-0000-0000-000000000003', '88881000-0000-0000-0000-000000000001',
   'T-03', 'Traducir el informe', 'Tarea independiente',
   '[{"id":"AC-1","criterion":"Está en inglés","verification":"Se lee el texto"}]'::jsonb,
   array['technical-writing'], 8, 300, 'submitted', '88880000-0000-0000-0000-000000000002');

insert into public.task_dependencies (task_id, depends_on_task_id)
values ('88882000-0000-0000-0000-000000000002', '88882000-0000-0000-0000-000000000001');

insert into public.deliverables (id, task_id, provider_id, summary, content, evidence)
values
  ('88883000-0000-0000-0000-000000000001', '88882000-0000-0000-0000-000000000001',
   '88880000-0000-0000-0000-000000000002', 'Informe v1', 'Sin conclusiones todavía.',
   '{"AC-1":"pendiente"}'::jsonb),
  ('88883000-0000-0000-0000-000000000003', '88882000-0000-0000-0000-000000000003',
   '88880000-0000-0000-0000-000000000002', 'Traducción v1', 'Texto traducido.',
   '{"AC-1":"todo el documento"}'::jsonb);


\echo ''
\echo '=== 1. Un entregable con revisión pedida SALE de la cola y no se vuelve a tomar'
do $$
declare
  v_en_cola boolean;
  v_toma    jsonb;
begin
  perform public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000001');
  perform public.apply_qa_verdict(
    p_deliverable_id      => '88883000-0000-0000-0000-000000000001',
    p_qa_status           => 'revision_requested',
    p_qa_score            => 0,
    p_qa_feedback         => '{"summary":"Faltan las conclusiones"}'::jsonb,
    p_qa_criteria_results => '[{"id":"AC-1","verdict":"fail"}]'::jsonb,
    p_task_status         => 'revision_requested',
    p_rating              => 0);

  select exists (select 1 from public.pending_qa_deliverables(50)
                  where deliverable_id = '88883000-0000-0000-0000-000000000001')
    into v_en_cola;
  if v_en_cola then
    raise warning 'FALLO: un entregable con revisión pedida sigue en la cola del juez';
  else
    raise notice 'OK: la revisión pedida no vuelve a la cola';
  end if;

  v_toma := public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000001');
  if (v_toma ->> 'claimed')::boolean then
    raise warning 'FALLO: se volvió a tomar un entregable que ya tiene veredicto';
  else
    raise notice 'OK: no se retoma (%)', v_toma ->> 'reason';
  end if;
end $$;


\echo ''
\echo '=== 2. La v2 se aprueba: la tarea avanza y la v1 sigue fuera de la cola'
insert into public.deliverables (id, task_id, provider_id, summary, content, evidence)
values ('88883000-0000-0000-0000-000000000002', '88882000-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-000000000002', 'Informe v2', 'Con conclusiones.',
        '{"AC-1":"Sección 4: conclusiones"}'::jsonb);
update public.project_tasks set status = 'submitted'
 where id = '88882000-0000-0000-0000-000000000001';

do $$
declare
  v_t01     public.task_status;
  v_t02     public.task_status;
  v_en_cola integer;
begin
  perform public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000002');
  perform public.apply_qa_verdict(
    p_deliverable_id      => '88883000-0000-0000-0000-000000000002',
    p_qa_status           => 'approved',
    p_qa_score            => 100,
    p_qa_feedback         => '{"summary":"Cumple"}'::jsonb,
    p_qa_criteria_results => '[{"id":"AC-1","verdict":"pass"}]'::jsonb,
    p_task_status         => 'approved',
    p_rating              => 5);

  select status into v_t01 from public.project_tasks where id = '88882000-0000-0000-0000-000000000001';
  select status into v_t02 from public.project_tasks where id = '88882000-0000-0000-0000-000000000002';
  if v_t01 <> 'approved' or v_t02 <> 'ready' then
    raise warning 'FALLO: tras aprobar la v2 se esperaba T-01 approved y T-02 ready, hay % y %', v_t01, v_t02;
  else
    raise notice 'OK: T-01 approved, T-02 ready';
  end if;

  select count(*) into v_en_cola from public.pending_qa_deliverables(50)
   where task_id = '88882000-0000-0000-0000-000000000001';
  if v_en_cola <> 0 then
    raise warning 'FALLO: quedan % entregables de una tarea ya aprobada en la cola', v_en_cola;
  else
    raise notice 'OK: una tarea aprobada no deja nada en la cola';
  end if;
end $$;


\echo ''
\echo '=== 3. Una versión superada no se toma aunque esté pendiente'
-- Se fuerza el estado: es el dato que habría dejado una base anterior a la 0008.
update public.deliverables set qa_status = 'pending'
 where id = '88883000-0000-0000-0000-000000000001';
do $$
declare
  v_toma    jsonb;
  v_en_cola boolean;
begin
  v_toma := public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000001');
  if (v_toma ->> 'claimed')::boolean then
    raise warning 'FALLO: se tomó una versión superada por otra más nueva';
  else
    raise notice 'OK: la versión superada no se toma (%)', v_toma ->> 'reason';
  end if;

  select exists (select 1 from public.pending_qa_deliverables(50)
                  where deliverable_id = '88883000-0000-0000-0000-000000000001')
    into v_en_cola;
  if v_en_cola then
    raise warning 'FALLO: una versión superada entró a la cola';
  else
    raise notice 'OK: la versión superada tampoco entra a la cola';
  end if;
end $$;


\echo ''
\echo '=== 4. Segunda cerradura: ningún veredicto saca a una tarea de approved'
-- Se fuerza `running` para llegar a apply_qa_verdict por el único camino que queda.
update public.deliverables set qa_status = 'running'
 where id = '88883000-0000-0000-0000-000000000001';
do $$
declare
  v_veredicto jsonb;
  v_t01       public.task_status;
  v_t02       public.task_status;
begin
  v_veredicto := public.apply_qa_verdict(
    p_deliverable_id      => '88883000-0000-0000-0000-000000000001',
    p_qa_status           => 'revision_requested',
    p_qa_score            => 0,
    p_qa_feedback         => '{}'::jsonb,
    p_qa_criteria_results => '[]'::jsonb,
    p_task_status         => 'revision_requested',
    p_rating              => 0);

  select status into v_t01 from public.project_tasks where id = '88882000-0000-0000-0000-000000000001';
  select status into v_t02 from public.project_tasks where id = '88882000-0000-0000-0000-000000000002';
  if v_t01 <> 'approved' or v_t02 <> 'ready' then
    raise warning 'FALLO: el DAG retrocedió: T-01 % y T-02 %', v_t01, v_t02;
  elsif (v_veredicto ->> 'task_updated')::boolean then
    raise warning 'FALLO: apply_qa_verdict dice haber movido una tarea aprobada';
  else
    raise notice 'OK: T-01 sigue approved y T-02 sigue ready (task_updated = false)';
  end if;
end $$;


\echo ''
\echo '=== 5. Un turno recién tomado NO se roba y no está en la cola'
do $$
declare
  v_toma    jsonb;
  v_en_cola boolean;
begin
  v_toma := public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000003');
  if not (v_toma ->> 'claimed')::boolean then
    raise warning 'FALLO: no se pudo tomar un entregable pendiente (%)', v_toma ->> 'reason';
  end if;

  v_toma := public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000003');
  select exists (select 1 from public.pending_qa_deliverables(50)
                  where deliverable_id = '88883000-0000-0000-0000-000000000003')
    into v_en_cola;
  if (v_toma ->> 'claimed')::boolean or v_en_cola then
    raise warning 'FALLO: un turno vigente se pudo tomar dos veces o volvió a la cola';
  else
    raise notice 'OK: el turno vigente se respeta (%)', v_toma ->> 'reason';
  end if;
end $$;


\echo ''
\echo '=== 6. Un turno ABANDONADO vuelve a la cola y se retoma'
-- El proceso que tenía el turno murió hace 16 minutos: nadie llamó a release ni a apply.
update public.deliverables set qa_claimed_at = now() - interval '16 minutes'
 where id = '88883000-0000-0000-0000-000000000003';
do $$
declare
  v_en_cola boolean;
  v_toma    jsonb;
  v_fresco  boolean;
begin
  select exists (select 1 from public.pending_qa_deliverables(50)
                  where deliverable_id = '88883000-0000-0000-0000-000000000003')
    into v_en_cola;
  if not v_en_cola then
    raise warning 'FALLO: un turno abandonado no volvió a la cola: el entregable queda bloqueado para siempre';
  else
    raise notice 'OK: el turno abandonado está en la cola';
  end if;

  v_toma := public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000003');
  if not (v_toma ->> 'claimed')::boolean then
    raise warning 'FALLO: no se pudo retomar un turno abandonado (%)', v_toma ->> 'reason';
  elsif v_toma ->> 'previous_status' <> 'pending' or not (v_toma ->> 'reclaimed')::boolean then
    raise warning 'FALLO: el turno retomado debe informar previous_status=pending y reclaimed=true';
  else
    raise notice 'OK: turno retomado, previous_status=pending';
  end if;

  select qa_claimed_at > now() - interval '1 minute' into v_fresco
    from public.deliverables where id = '88883000-0000-0000-0000-000000000003';
  if not coalesce(v_fresco, false) then
    raise warning 'FALLO: al retomar no se renovó qa_claimed_at: dos jueces podrían retomarlo a la vez';
  else
    raise notice 'OK: el turno retomado vuelve a ser exclusivo';
  end if;
end $$;


\echo ''
\echo '=== 7. Una avería nuestra (error) sigue reintentándose sola'
do $$
declare
  v_en_cola boolean;
  v_toma    jsonb;
begin
  perform public.release_deliverable_qa(
    '88883000-0000-0000-0000-000000000003', 'error', 'ambos proveedores agotados');

  select exists (select 1 from public.pending_qa_deliverables(50)
                  where deliverable_id = '88883000-0000-0000-0000-000000000003')
    into v_en_cola;
  v_toma := public.claim_deliverable_for_qa('88883000-0000-0000-0000-000000000003');
  if not v_en_cola or not (v_toma ->> 'claimed')::boolean or v_toma ->> 'previous_status' <> 'error' then
    raise warning 'FALLO: un entregable en error dejó de reintentarse';
  else
    raise notice 'OK: error vuelve a la cola y se retoma con previous_status=error';
  end if;

  -- Se deja resuelto para no ensuciar la cola de quien ejecute algo después.
  perform public.release_deliverable_qa('88883000-0000-0000-0000-000000000003', 'error', null);
end $$;


\echo ''
\echo '=== 8. Ningún rol de cliente puede tomar turnos ni leer el tope'
do $$
begin
  if has_function_privilege('anon', 'public.qa_claim_timeout()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qa_claim_timeout()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_deliverable_for_qa(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pending_qa_deliverables(integer)', 'EXECUTE')
  then
    raise warning 'FALLO: anon o authenticated tienen EXECUTE sobre la cola del juez';
  else
    raise notice 'OK: la cola del juez no es invocable por roles de cliente';
  end if;
end $$;

\echo ''
\echo '=== FASE 8 verificada ==='
