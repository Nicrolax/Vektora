-- =====================================================================================
-- VEKTORA · FASE 8 — Verificación del tope global de cuotas
-- =====================================================================================
-- Sobre base LOCAL desechable. Requiere db/00_plataforma.sql + schema + 0002..0011.
--
-- Lo que se prueba: que crear cuentas nuevas no esquive el tope, que un rechazo no
-- consuma, que cero deshabilite en vez de abrir, y que la 0007 siga intacta.
--
-- Cada comprobación avisa con WARNING 'FALLO: …' (el CI los busca) o NOTICE 'OK: …'.
-- =====================================================================================
\set ON_ERROR_STOP on
\pset pager off
set search_path = public, extensions;

\echo '=== Preparación: cuatro cuentas'
insert into auth.users (id, email) values
  ('66660000-0000-0000-0000-000000000001', 'uno@tope.test'),
  ('66660000-0000-0000-0000-000000000002', 'dos@tope.test'),
  ('66660000-0000-0000-0000-000000000003', 'tres@tope.test'),
  ('66660000-0000-0000-0000-000000000004', 'cuatro@tope.test');

-- Atajo: consume un hueco de `tope_prueba` con límite 2 por persona y 3 global, 24 h.
create or replace function pg_temp.consumir(p_letra text, p_global integer default 3)
returns jsonb language sql as $$
  select public.consume_capped_quota(
    p_user_id => ('66660000-0000-0000-0000-00000000000' || p_letra)::uuid,
    p_action => 'tope_prueba', p_limit => 2, p_global_limit => p_global, p_window_hours => 24);
$$;
create or replace function pg_temp.eventos() returns integer language sql as $$
  select count(*)::integer from public.usage_events where action = 'tope_prueba';
$$;


\echo ''
\echo '=== 1. Cuentas nuevas no esquivan el tope global'
do $$
declare
  v jsonb;
begin
  perform pg_temp.consumir('1');
  perform pg_temp.consumir('2');
  perform pg_temp.consumir('3');
  -- Tres huecos usados por tres cuentas distintas: la cuarta, nueva, ya no entra.
  v := pg_temp.consumir('4');
  if (v ->> 'permitido')::boolean or v ->> 'alcance' <> 'global' then
    raise warning 'FALLO: una cuenta nueva esquivó el tope global (%)', v;
  elsif v ->> 'disponible_en' is null then
    raise warning 'FALLO: el rechazo global no dice cuándo se libera un hueco';
  else
    raise notice 'OK: la cuarta cuenta se rechaza por el tope global y se le dice cuándo';
  end if;
end $$;


\echo ''
\echo '=== 2. Un rechazo no consume nada'
do $$
begin
  perform pg_temp.consumir('4');
  perform pg_temp.consumir('1');
  if pg_temp.eventos() <> 3 then
    raise warning 'FALLO: los rechazos consumieron huecos (hay % eventos, se esperaban 3)', pg_temp.eventos();
  else
    raise notice 'OK: siguen siendo 3 eventos tras dos rechazos';
  end if;
end $$;


\echo ''
\echo '=== 3. El límite por persona sigue aplicando debajo del global'
do $$
declare
  v jsonb;
begin
  -- Con un tope global holgado (10), la cuenta 1 ya usó 1 de sus 2: entra una más y no otra.
  v := pg_temp.consumir('1', 10);
  if not (v ->> 'permitido')::boolean then
    raise warning 'FALLO: con hueco en los dos límites se rechazó (%)', v;
  end if;
  v := pg_temp.consumir('1', 10);
  if (v ->> 'permitido')::boolean or v ->> 'alcance' <> 'usuario' then
    raise warning 'FALLO: la cuenta pasó su límite personal (%)', v;
  else
    raise notice 'OK: el límite personal rechaza con alcance usuario';
  end if;
end $$;


\echo ''
\echo '=== 4. Sin tope global (nulo) solo manda el límite por persona'
do $$
declare
  v jsonb;
begin
  v := pg_temp.consumir('4', null);
  if not (v ->> 'permitido')::boolean then
    raise warning 'FALLO: sin tope global se rechazó a una cuenta con hueco propio (%)', v;
  else
    raise notice 'OK: con p_global_limit nulo no hay tope global';
  end if;
end $$;


\echo ''
\echo '=== 5. Cero deshabilita la acción, nunca la abre'
do $$
declare
  v_antes integer := pg_temp.eventos();
  v jsonb := pg_temp.consumir('2', 0);
begin
  if (v ->> 'permitido')::boolean or pg_temp.eventos() <> v_antes then
    raise warning 'FALLO: un tope global de 0 dejó pasar o consumió (%)', v;
  else
    raise notice 'OK: tope global 0 = acción deshabilitada';
  end if;
end $$;


\echo ''
\echo '=== 6. Una ventana vencida no cuenta para el tope global'
update public.usage_events set created_at = now() - interval '25 hours'
 where action = 'tope_prueba';
do $$
declare
  v jsonb := pg_temp.consumir('3');
begin
  if not (v ->> 'permitido')::boolean then
    raise warning 'FALLO: eventos de hace 25 h siguen contando para el tope global (%)', v;
  else
    raise notice 'OK: el tope global también es deslizante';
  end if;
end $$;


\echo ''
\echo '=== 7. La cuota de la 0007 sigue intacta (otra función, misma firma de siempre)'
do $$
declare
  v_firmas integer;
begin
  select count(*) into v_firmas from pg_proc
   where proname = 'consume_quota' and pronamespace = 'public'::regnamespace;
  if v_firmas <> 1 or (public.consume_quota(
        p_user_id => '66660000-0000-0000-0000-000000000001', p_action => 'otra_accion',
        p_limit => 1, p_window_hours => 24) ->> 'permitido')::boolean is not true then
    raise warning 'FALLO: consume_quota cambió de firma o dejó de funcionar (% versiones)', v_firmas;
  else
    raise notice 'OK: consume_quota tiene una sola versión y responde como antes';
  end if;
end $$;


\echo ''
\echo '=== 8. Ningún rol de cliente puede fabricarse cuota'
do $$
begin
  if has_function_privilege('anon', 'public.consume_capped_quota(uuid, text, integer, integer, numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.consume_capped_quota(uuid, text, integer, integer, numeric)', 'EXECUTE')
  then
    raise warning 'FALLO: anon o authenticated tienen EXECUTE sobre consume_capped_quota';
  else
    raise notice 'OK: consume_capped_quota no es invocable por roles de cliente';
  end if;
end $$;

\echo ''
\echo '=== FASE 8 (tope global) verificada ==='
