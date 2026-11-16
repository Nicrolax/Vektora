-- =========================================================================================
-- VEKTORA · FASE 8 — Tope global de las acciones que gastan IA
-- =========================================================================================
-- Depende de: db/schema.sql y las migraciones 0002 a 0010 (usa `usage_events` de la 0007).
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- La cuota de la 0007 es POR USUARIO, y el registro es abierto: crear cuentas nuevas la
-- esquiva entera. Con cinco proyectos por cuenta y por día, diez cuentas descartables ya
-- son cincuenta planificaciones, y la cuota gratuita de IA es una sola para toda la
-- instalación. Cuando se agota, el sistema deja de planificar para todos.
--
-- Este tope cuenta las MISMAS filas de `usage_events`, pero de todas las cuentas juntas.
-- Se aplica solo a lo que dispara una persona (crear un proyecto, guardar el perfil de
-- proveedor). Los agentes autónomos —el emparejador, el juez— NO pasan por aquí: un tope
-- que los frenara dejaría que una sola persona congelara el ciclo de todas las demás.
--
-- Va en una función NUEVA y no como parámetro opcional de `consume_quota`: agregarle un
-- parámetro crearía una segunda versión de la función, la 0007 recrea la de cuatro en cada
-- reaplicación, y la llamada con notación nombrada pasaría a ser ambigua. Como
-- `consumirCuota` deja pasar la acción cuando la base falla, el resultado sería que todas
-- las cuotas se apagan sin ningún aviso.
-- =========================================================================================

set search_path = public, extensions;


-- =========================================================================================
-- 01 · consume_capped_quota — cuota por persona y tope global, en una sola transacción
-- =========================================================================================
-- Igual que `consume_quota`, con una condición más: si `p_global_limit` no es nulo, la
-- suma de TODAS las cuentas en la ventana tampoco puede alcanzarlo. Un rechazo, por
-- cualquiera de los dos límites, no consume nada.
--
--   · `p_limit <= 0`         la acción está deshabilitada (la convención de la 0007).
--   · `p_global_limit` nulo  sin tope global.
--   · `p_global_limit <= 0`  también deshabilitada: cero nunca significa «sin límite».
--
-- Devuelve el mismo objeto que `consume_quota`, más `alcance` ('usuario' o 'global') cuando
-- rechaza, para que la aplicación diga cuál de los dos se alcanzó.
create or replace function public.consume_capped_quota(
  p_user_id       uuid,
  p_action        text,
  p_limit         integer,
  p_global_limit  integer,
  p_window_hours  numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_desde   timestamptz := now() - make_interval(secs => p_window_hours * 3600);
  v_usados  integer;
  v_global  integer;
  v_proximo timestamptz;
begin
  if p_limit <= 0 or (p_global_limit is not null and p_global_limit <= 0) then
    return jsonb_build_object('permitido', false, 'usados', 0, 'limite', p_limit,
                              'alcance', case when p_limit <= 0 then 'usuario' else 'global' end,
                              'motivo', 'la acción está deshabilitada por configuración');
  end if;

  -- Un candado por ACCIÓN, que dura lo que la transacción. Serializa a todos los que
  -- quieren consumir esta acción a la vez: sin él, dos cuentas distintas podrían pasar las
  -- dos el tope global con el último hueco. No bloquea otras acciones ni a los agentes.
  perform pg_advisory_xact_lock(hashtext('vektora.cuota.' || p_action));

  if p_global_limit is not null then
    select count(*) into v_global
      from public.usage_events
     where action = p_action and created_at >= v_desde;

    if v_global >= p_global_limit then
      select min(created_at) + make_interval(secs => p_window_hours * 3600)
        into v_proximo
        from public.usage_events
       where action = p_action and created_at >= v_desde;

      return jsonb_build_object(
        'permitido', false,
        'usados', v_global,
        'limite', p_global_limit,
        'alcance', 'global',
        'disponible_en', v_proximo,
        'motivo', 'tope global agotado'
      );
    end if;
  end if;

  select count(*) into v_usados
    from public.usage_events
   where user_id = p_user_id and action = p_action and created_at >= v_desde;

  if v_usados >= p_limit then
    select min(created_at) + make_interval(secs => p_window_hours * 3600)
      into v_proximo
      from public.usage_events
     where user_id = p_user_id and action = p_action and created_at >= v_desde;

    return jsonb_build_object(
      'permitido', false,
      'usados', v_usados,
      'limite', p_limit,
      'alcance', 'usuario',
      'disponible_en', v_proximo,
      'motivo', 'cuota agotada'
    );
  end if;

  insert into public.usage_events (user_id, action) values (p_user_id, p_action);

  return jsonb_build_object(
    'permitido', true,
    'usados', v_usados + 1,
    'limite', p_limit,
    'restantes', p_limit - v_usados - 1
  );
end;
$function$;

comment on function public.consume_capped_quota(uuid, text, integer, integer, numeric) is
  'Cuota por persona más tope global de todas las cuentas, atómicos. Un rechazo no consume. '
  'Solo para acciones que dispara una persona: los agentes autónomos no pasan por aquí.';

-- Índice para contar por acción sin mirar a quién pertenece (el de la 0007 empieza por
-- user_id y no sirve para la suma global).
create index if not exists idx_usage_events_accion_ventana
  on public.usage_events (action, created_at desc);


-- =========================================================================================
-- 02 · Privilegios
-- =========================================================================================
-- Como `consume_quota`: la invoca la aplicación con la identidad de los agentes, y ningún
-- rol de cliente puede fabricarse huecos.
revoke all on function public.consume_capped_quota(uuid, text, integer, integer, numeric) from public;
revoke all on function public.consume_capped_quota(uuid, text, integer, integer, numeric)
  from anon, authenticated;


-- =========================================================================================
-- FIN — db/migrations/0011_tope_global.sql
-- Verificación: db/verify/09_tope_global.sql
-- =========================================================================================
