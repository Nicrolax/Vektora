-- =====================================================================================
-- VEKTORA · FASE 8 — Verificación de los reintentos del juez
-- =====================================================================================
-- Sobre base LOCAL desechable. Requiere db/00_plataforma.sql + schema + 0002..0012.
--
-- Lo que se prueba: que diez entregables que fallan siempre no tapen a uno nuevo, que cada
-- fallo espere más que el anterior sin abandonarse nunca, que un turno abandonado cuente
-- como fallo y que un ensayo no cuente.
--
-- Cada comprobación avisa con WARNING 'FALLO: …' (el CI los busca) o NOTICE 'OK: …'.
-- =====================================================================================
\set ON_ERROR_STOP on
\pset pager off
set search_path = public, extensions;

\echo '=== Preparación: diez entregables viejos que fallan siempre y uno nuevo'
insert into auth.users (id, email) values
  ('55550000-0000-0000-0000-000000000001', 'cliente@reintentos.test'),
  ('55550000-0000-0000-0000-000000000002', 'proveedor@reintentos.test');

insert into public.provider_profiles (user_id, headline, is_active, reputation_score)
values ('55550000-0000-0000-0000-000000000002', 'Proveedor reintentos', true, 10);

insert into public.projects (id, owner_id, title, objective, budget_total, status)
values ('55551000-0000-0000-0000-000000000001', '55550000-0000-0000-0000-000000000001',
        'Proyecto reintentos', 'Objetivo de prueba para los reintentos del juez', 1100, 'active');

-- Tareas T-01..T-11, todas entregadas por el mismo proveedor.
insert into public.project_tasks (id, project_id, code, title, description,
       acceptance_criteria, required_skills, estimated_hours, budget, status, assignee_id)
select ('55552000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '55551000-0000-0000-0000-000000000001', 'T-' || lpad(n::text, 2, '0'),
       'Tarea ' || n, 'Tarea de reintentos',
       '[{"id":"AC-1","criterion":"Existe","verification":"Se abre"}]'::jsonb,
       array['technical-writing'], 4, 100, 'submitted', '55550000-0000-0000-0000-000000000002'
  from generate_series(1, 11) n;

-- T-01..T-10: entregados hace días y con tres fallos ya, la espera vencida. T-11: nuevo.
insert into public.deliverables (id, task_id, provider_id, summary, content, evidence,
       submitted_at, qa_status, qa_error_count, qa_retry_at)
select ('55553000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       ('55552000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '55550000-0000-0000-0000-000000000002', 'Entrega ' || n, 'Contenido', '{"AC-1":"ok"}'::jsonb,
       case when n <= 10 then now() - interval '3 days' + n * interval '1 minute' else now() end,
       case when n <= 10 then 'error'::public.qa_status else 'pending'::public.qa_status end,
       case when n <= 10 then 3 else 0 end,
       case when n <= 10 then now() - interval '1 minute' end
  from generate_series(1, 11) n;

-- Atajos.
create or replace function pg_temp.d(n integer) returns uuid language sql as $$
  select ('55553000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$$;
create or replace function pg_temp.en_cola(n integer, p_limite integer default 50)
returns boolean language sql as $$
  select exists (select 1 from public.pending_qa_deliverables(p_limite)
                  where deliverable_id = pg_temp.d(n));
$$;


\echo ''
\echo '=== 1. Diez entregables que fallan siempre no tapan a uno nuevo'
-- Se mira solo este proyecto: en CI todos los archivos de db/verify comparten una base, y lo
-- que otros dejan en la cola (sin fallos y más antiguo) iría legítimamente delante.
do $$
declare
  v_primero uuid;
  v_en_cola integer;
begin
  select c.deliverable_id, count(*) over ()
    into v_primero, v_en_cola
    from public.pending_qa_deliverables(1000)
         with ordinality as c(deliverable_id, task_id, project_id, task_code, task_title,
                              provider_id, version, qa_status, submitted_at, criteria_count, orden)
   where c.project_id = '55551000-0000-0000-0000-000000000001'
   order by c.orden
   limit 1;
  if v_en_cola is distinct from 11 then
    raise warning 'FALLO: se esperaban los 11 entregables del proyecto en la cola y hay %', v_en_cola;
  elsif v_primero <> pg_temp.d(11) then
    raise warning 'FALLO: el entregable que nunca falló no va delante de los que ya fallaron (va %)', v_primero;
  else
    raise notice 'OK: lo que nunca falló pasa delante de diez entregables más viejos que ya fallaron tres veces';
  end if;
end $$;


\echo ''
\echo '=== 2. Un fallo saca al entregable de la cola por 5 minutos y guarda el motivo'
do $$
declare
  v_r     jsonb;
  v_fila  record;
begin
  -- T-11 no había fallado nunca: su primer fallo espera 5 minutos.
  perform public.claim_deliverable_for_qa(pg_temp.d(11));
  v_r := public.fail_deliverable_qa(pg_temp.d(11), 'Groq respondió 429', 'rate_limit', false);
  select qa_status, qa_error_count, qa_unjudgeable_count, qa_retry_at - now() as espera, qa_feedback
    into v_fila from public.deliverables where id = pg_temp.d(11);

  if not (v_r ->> 'released')::boolean or v_fila.qa_status <> 'error' or v_fila.qa_error_count <> 1 then
    raise warning 'FALLO: el fallo no se registró (%, %, %)', v_r, v_fila.qa_status, v_fila.qa_error_count;
  elsif v_fila.qa_unjudgeable_count <> 0 then
    raise warning 'FALLO: una cuota agotada (avería nuestra) contó contra el entregable';
  elsif v_fila.espera not between interval '4 minutes' and interval '6 minutes' then
    raise warning 'FALLO: la primera espera debería ser de 5 minutos y es %', v_fila.espera;
  elsif v_fila.qa_feedback ->> 'last_error_code' <> 'rate_limit' then
    raise warning 'FALLO: no se guardó el código del fallo (%)', v_fila.qa_feedback;
  elsif pg_temp.en_cola(11) then
    raise warning 'FALLO: el entregable volvió a la cola antes de su hora';
  else
    raise notice 'OK: primer fallo = 5 minutos fuera de la cola, con el código guardado';
  end if;
end $$;


\echo ''
\echo '=== 3. La espera crece con cada fallo, con techo, y nunca se abandona'
do $$
declare
  v_espera interval;
begin
  -- T-01 ya tenía 3 fallos: el cuarto espera 5 × 2^3 = 40 minutos.
  perform public.claim_deliverable_for_qa(pg_temp.d(1));
  perform public.fail_deliverable_qa(pg_temp.d(1), 'salida inválida', 'invalid_output', true);
  select qa_retry_at - now() into v_espera from public.deliverables where id = pg_temp.d(1);

  if v_espera not between interval '39 minutes' and interval '41 minutes' then
    raise warning 'FALLO: el cuarto fallo debería esperar 40 minutos y espera %', v_espera;
  elsif public.qa_retry_delay(50) <> interval '6 hours' or public.qa_retry_delay(0) <> interval '0' then
    raise warning 'FALLO: la espera no tiene el techo de 6 h o no es cero sin fallos';
  else
    raise notice 'OK: 5, 10, 20, 40… minutos, con techo de 6 horas';
  end if;

  -- Vencida la espera, vuelve: no hay un número de fallos que lo saque para siempre.
  update public.deliverables set qa_retry_at = now() - interval '1 second', qa_error_count = 40
   where id = pg_temp.d(1);
  if not pg_temp.en_cola(1) then
    raise warning 'FALLO: un entregable con 40 fallos y la espera vencida no vuelve a la cola';
  else
    raise notice 'OK: con la espera vencida vuelve a la cola, falle las veces que falle';
  end if;
end $$;


\echo ''
\echo '=== 4. La espera es solo de la cola: forzar el reintento a mano sigue funcionando'
do $$
declare
  v_toma jsonb;
begin
  -- T-11 sigue con su espera de 5 minutos por delante.
  v_toma := public.claim_deliverable_for_qa(pg_temp.d(11));
  if not (v_toma ->> 'claimed')::boolean then
    raise warning 'FALLO: la espera impide forzar el reintento (%)', v_toma ->> 'reason';
  elsif (v_toma ->> 'qa_errors')::integer <> 1 then
    raise warning 'FALLO: la toma no informa los fallos previos (%)', v_toma ->> 'qa_errors';
  elsif (v_toma -> 'deliverable' ->> 'attempt')::integer <> 1 then
    raise warning 'FALLO: la toma perdió el intento por proveedor de la 0008';
  else
    raise notice 'OK: npm run qa -- <id> puede tomarlo aunque la cola lo esté haciendo esperar';
  end if;
end $$;


\echo ''
\echo '=== 5. Un ensayo devuelto a pending no cuenta como fallo ni espera'
do $$
declare
  v_errores integer;
begin
  -- T-11 quedó tomado en el paso 4: se suelta como lo haría un --dry-run.
  perform public.release_deliverable_qa(pg_temp.d(11), 'pending', null);
  select qa_error_count into v_errores from public.deliverables where id = pg_temp.d(11);
  if v_errores <> 1 then
    raise warning 'FALLO: el ensayo cambió el contador de fallos (%)', v_errores;
  elsif not pg_temp.en_cola(11) then
    raise warning 'FALLO: un entregable pending quedó fuera de la cola por la espera de su toma';
  else
    raise notice 'OK: el ensayo no suma fallos y el entregable vuelve a la cola enseguida';
  end if;
end $$;


\echo ''
\echo '=== 6. Un turno abandonado cuenta como fallo y no se retoma antes de su hora'
do $$
declare
  v_toma jsonb;
  v_fila record;
begin
  -- T-02 se toma; el proceso «muere» (nadie suelta el turno) y pasa el plazo del turno.
  perform public.claim_deliverable_for_qa(pg_temp.d(2));
  update public.deliverables set qa_claimed_at = now() - interval '20 minutes'
   where id = pg_temp.d(2);

  -- Con 3 fallos, el turno espera 15 min + 20 min desde la toma: a los 20 todavía no vuelve.
  if pg_temp.en_cola(2) then
    raise warning 'FALLO: un turno abandonado de algo que ya falló vuelve sin esperar';
  else
    raise notice 'OK: el turno abandonado espera el plazo del turno más su espera';
  end if;

  update public.deliverables set qa_claimed_at = now() - interval '36 minutes' where id = pg_temp.d(2);
  if not pg_temp.en_cola(2) then
    raise warning 'FALLO: vencida la espera, el turno abandonado no vuelve a la cola';
  end if;

  v_toma := public.claim_deliverable_for_qa(pg_temp.d(2));
  select qa_error_count, qa_unjudgeable_count, qa_feedback ->> 'last_error_code' as codigo
    into v_fila from public.deliverables where id = pg_temp.d(2);
  if not (v_toma ->> 'reclaimed')::boolean or v_fila.qa_error_count <> 4 or v_fila.codigo <> 'abandoned' then
    raise warning 'FALLO: retomar un turno abandonado no lo contó como fallo (%, %, %)',
      v_toma ->> 'reclaimed', v_fila.qa_error_count, v_fila.codigo;
  elsif v_fila.qa_unjudgeable_count <> 1 or (v_toma ->> 'qa_unjudgeable')::integer <> 1 then
    raise warning 'FALLO: el turno abandonado no contó contra el entregable: un juicio que siempre muere no tendría salida';
  else
    raise notice 'OK: el juicio que murió cuenta como fallo atribuible, con código abandoned';
  end if;
end $$;


\echo ''
\echo '=== 7. Soltar como fallo algo que no está tomado no cambia nada'
do $$
declare
  v_r       jsonb;
  v_errores integer;
begin
  v_r := public.fail_deliverable_qa(pg_temp.d(3), 'tarde', 'timeout', false);
  select qa_error_count into v_errores from public.deliverables where id = pg_temp.d(3);
  if (v_r ->> 'released')::boolean or v_errores <> 3 then
    raise warning 'FALLO: fail_deliverable_qa contó un fallo sobre un turno que no estaba tomado';
  else
    raise notice 'OK: sin turno tomado no se cuenta nada';
  end if;
end $$;


\echo ''
\echo '=== 8. Ningún rol de cliente puede tocar los turnos'
do $$
begin
  if has_function_privilege('anon', 'public.fail_deliverable_qa(uuid, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.fail_deliverable_qa(uuid, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.qa_retry_delay(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_deliverable_for_qa(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.pending_qa_deliverables(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.give_up_deliverable_qa(uuid, numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.give_up_deliverable_qa(uuid, numeric)', 'EXECUTE')
  then
    raise warning 'FALLO: un rol de cliente tiene EXECUTE sobre las funciones del juez';
  else
    raise notice 'OK: anon y authenticated no pueden tomar, soltar ni ver la cola';
  end if;
end $$;

\echo ''
\echo '=== 9. Una avería nuestra nunca lleva a la salida'
do $$
declare
  v_r jsonb;
begin
  -- T-04: diez caídas de cuota seguidas. Ninguna es culpa del entregable.
  for i in 1..10 loop
    perform public.claim_deliverable_for_qa(pg_temp.d(4));
    perform public.fail_deliverable_qa(pg_temp.d(4), '429', 'rate_limit', false);
  end loop;
  perform public.claim_deliverable_for_qa(pg_temp.d(4));
  v_r := public.give_up_deliverable_qa(pg_temp.d(4), 0);
  if (v_r ->> 'given_up')::boolean
     or (select qa_unjudgeable_count from public.deliverables where id = pg_temp.d(4)) <> 0 then
    raise warning 'FALLO: caídas de cuota sacaron al entregable de la cola (%)', v_r;
  else
    raise notice 'OK: diez caídas de cuota no cuentan contra el entregable ni permiten darlo por perdido';
  end if;
  -- Se devuelve el turno para que T-04 quede como estaba.
  perform public.release_deliverable_qa(pg_temp.d(4), 'error', null);
end $$;


\echo ''
\echo '=== 10. Sin evidencia de que el juez funciona, se espera; la dispensa por tiempo la reemplaza'
-- T-05: la tarea se adjudicó hace 30 días, para comprobar después que el plazo se renueva.
update public.project_tasks set assigned_at = now() - interval '30 days'
 where id = '55552000-0000-0000-0000-000000000005';
do $$
declare
  v_r jsonb;
begin
  perform public.claim_deliverable_for_qa(pg_temp.d(5));
  perform public.fail_deliverable_qa(pg_temp.d(5), 'JSON cortado', 'truncated', true);
  v_r := public.give_up_deliverable_qa(pg_temp.d(5), 48);
  if (v_r ->> 'given_up')::boolean or not coalesce((v_r ->> 'held')::boolean, false) then
    raise warning 'FALLO: sin evidencia ni dispensa se dio por perdido igual (%)', v_r;
  else
    raise notice 'OK: sin otro veredicto del modelo desde el primer fallo, se sigue reintentando';
  end if;
end $$;

-- Pasaron 49 horas desde el primer fallo atribuible y nadie más recibió veredicto.
update public.deliverables set qa_unjudgeable_since = now() - interval '49 hours'
 where id = pg_temp.d(5);
do $$
declare
  v_r     jsonb;
  v_tarea public.task_status;
  v_del   record;
  v_toma  jsonb;
begin
  v_r := public.give_up_deliverable_qa(pg_temp.d(5), 48);
  select status into v_tarea from public.project_tasks where id = '55552000-0000-0000-0000-000000000005';
  select qa_status, qa_given_up_at, qa_evaluated_at, qa_feedback ->> 'summary' as resumen
    into v_del from public.deliverables where id = pg_temp.d(5);
  v_toma := public.claim_deliverable_for_qa(pg_temp.d(5));

  -- Corrido solo, el motivo es la dispensa. En CI la base es compartida y otros archivos ya
  -- juzgaron entregables en estas 49 h: entonces el motivo es la evidencia, y también vale.
  if not (v_r ->> 'given_up')::boolean or v_r ->> 'action' <> 'returned'
     or not ((v_r ->> 'waived')::boolean or (v_r ->> 'evidence')::boolean) then
    raise warning 'FALLO: con la dispensa vencida no se devolvió la versión (%)', v_r;
  elsif v_tarea <> 'revision_requested' or v_del.qa_given_up_at is null or v_del.resumen is null then
    raise warning 'FALLO: la devolución no dejó la tarea para entregar de nuevo (%, %)', v_tarea, v_del.resumen;
  elsif pg_temp.en_cola(5) or (v_toma ->> 'claimed')::boolean then
    raise warning 'FALLO: una versión dada por no evaluable sigue en la cola o se puede tomar';
  elsif exists (select 1 from public.reputation_events where deliverable_id = pg_temp.d(5))
     or exists (select 1 from public.reviews where deliverable_id = pg_temp.d(5)) then
    raise warning 'FALLO: la devolución escribió reseña o reputación: nuestra avería se volvió veredicto';
  elsif not exists (select 1 from public.audit_logs
                     where action = 'qa.unjudgeable_returned' and entity_id = pg_temp.d(5)) then
    raise warning 'FALLO: la devolución no quedó auditada';
  else
    raise notice 'OK: la versión se devuelve (motivo: %): revision_requested, sin reseña ni reputación, auditado',
      case when (v_r ->> 'waived')::boolean then 'dispensa por tiempo' else 'evidencia' end;
  end if;
end $$;


\echo ''
\echo '=== 11. Devolver abre un plazo nuevo: el proveedor no queda vencido al instante'
do $$
declare
  v_r jsonb;
begin
  -- Adjudicada hace 30 días con una ventana de 48 h: sin el plazo nuevo, ya estaría vencida.
  v_r := public.recover_stalled_task('55552000-0000-0000-0000-000000000005', 48, 2, 8);
  if v_r ->> 'action' in ('reopened', 'project_failed')
     or exists (select 1 from public.reputation_events
                 where task_id = '55552000-0000-0000-0000-000000000005' and event_type = 'deadline_missed') then
    raise warning 'FALLO: tras devolver la versión, la 0010 dio la tarea por vencida (%)', v_r;
  else
    raise notice 'OK: el plazo corre desde la devolución (%)', v_r ->> 'action';
  end if;
end $$;


\echo ''
\echo '=== 12. La versión siguiente es el intento 1: la devuelta no cuenta'
insert into public.deliverables (id, task_id, provider_id, summary, content, evidence, version)
values ('55553000-0000-0000-0000-000000000105', '55552000-0000-0000-0000-000000000005',
        '55550000-0000-0000-0000-000000000002', 'Entrega 5 v2', 'Más breve', '{"AC-1":"ok"}'::jsonb, 2);
update public.project_tasks set status = 'submitted' where id = '55552000-0000-0000-0000-000000000005';
do $$
declare
  v_toma jsonb;
begin
  v_toma := public.claim_deliverable_for_qa('55553000-0000-0000-0000-000000000105');
  if not (v_toma ->> 'claimed')::boolean or (v_toma -> 'deliverable' ->> 'attempt')::integer <> 1 then
    raise warning 'FALLO: la versión nueva no es el intento 1 (%)', v_toma -> 'deliverable' ->> 'attempt';
  else
    raise notice 'OK: la versión devuelta no cuenta como intento del proveedor';
  end if;
end $$;


\echo ''
\echo '=== 13. Con evidencia, la segunda vez del mismo proveedor la tarea vuelve al mercado'
-- La v2 también falla por salida inválida desde hace una hora...
update public.deliverables
   set qa_status = 'error', qa_unjudgeable_count = 5, qa_unjudgeable_since = now() - interval '1 hour'
 where id = '55553000-0000-0000-0000-000000000105';
-- ...y mientras tanto el modelo SÍ juzgó otro entregable (T-06): el juez funciona.
do $$
begin
  perform public.claim_deliverable_for_qa(pg_temp.d(6));
  perform public.apply_qa_verdict(
    p_deliverable_id      => pg_temp.d(6),
    p_qa_status           => 'approved',
    p_qa_score            => 100,
    p_qa_feedback         => '{"summary":"Cumple","skippedAi":false}'::jsonb,
    p_qa_criteria_results => '[{"id":"AC-1","verdict":"pass"}]'::jsonb,
    p_task_status         => 'approved',
    p_rating              => 5);
end $$;
do $$
declare
  v_r     jsonb;
  v_tarea public.task_status;
  v_reabre jsonb;
begin
  -- Sin dispensa (1000 h): solo la evidencia puede habilitarlo.
  v_r := public.give_up_deliverable_qa('55553000-0000-0000-0000-000000000105', 1000);
  select status into v_tarea from public.project_tasks where id = '55552000-0000-0000-0000-000000000005';
  if not (v_r ->> 'given_up')::boolean or v_r ->> 'action' <> 'failed' or not (v_r ->> 'evidence')::boolean then
    raise warning 'FALLO: la segunda versión no evaluable no llevó la tarea a failed (%)', v_r;
  elsif v_tarea <> 'failed' then
    raise warning 'FALLO: la tarea quedó en % en vez de failed', v_tarea;
  else
    raise notice 'OK: segunda vez del mismo proveedor = tarea failed, habilitado por la evidencia';
  end if;

  -- La 0010 la devuelve al mercado, sin multa para quien entregó.
  v_reabre := public.recover_stalled_task('55552000-0000-0000-0000-000000000005', 48, 2, 8);
  if v_reabre ->> 'action' <> 'reopened'
     or exists (select 1 from public.reputation_events
                 where user_id = '55550000-0000-0000-0000-000000000002'
                   and task_id = '55552000-0000-0000-0000-000000000005') then
    raise warning 'FALLO: la tarea no volvió al mercado o se le cobró algo al proveedor (%)', v_reabre;
  else
    raise notice 'OK: la 0010 la reabre con una reasignación más y sin reputación descontada';
  end if;
end $$;


\echo ''
\echo '=== 14. No actúa sobre una tarea que ya no espera esa entrega'
update public.deliverables set qa_status = 'error', qa_unjudgeable_count = 9,
       qa_unjudgeable_since = now() - interval '100 hours'
 where id = pg_temp.d(7);
update public.project_tasks set status = 'cancelled' where id = '55552000-0000-0000-0000-000000000007';
do $$
declare
  v_r jsonb := public.give_up_deliverable_qa(pg_temp.d(7), 1);
begin
  if (v_r ->> 'given_up')::boolean
     or (select status from public.project_tasks where id = '55552000-0000-0000-0000-000000000007') <> 'cancelled' then
    raise warning 'FALLO: se tocó una tarea cancelada (%)', v_r;
  else
    raise notice 'OK: si la tarea ya no espera la entrega, no se toca nada';
  end if;
end $$;

\echo ''
\echo '=== 15. El proveedor no puede reeditar una versión dada por no evaluable'
do $$
declare
  v_politica record;
begin
  select qual, with_check into v_politica
    from pg_policies
   where schemaname = 'public' and tablename = 'deliverables' and policyname = 'deliverables_update';
  if v_politica.qual is null
     or position('qa_given_up_at' in v_politica.qual) = 0
     or position('qa_given_up_at' in v_politica.with_check) = 0 then
    raise warning 'FALLO: la política de edición no protege qa_given_up_at: el proveedor podría devolver la versión a la cola';
  else
    raise notice 'OK: deliverables_update excluye las versiones dadas por no evaluables';
  end if;
end $$;

\echo ''
\echo '=== FASE 8 (reintentos del juez) verificada ==='
