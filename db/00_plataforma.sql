-- =====================================================================================
-- VEKTORA · 00 — Plataforma: lo que antes daba Supabase, en PostgreSQL común
-- =====================================================================================
-- Se ejecuta ANTES de db/schema.sql. Funciona igual en el contenedor del docker-compose
-- (como superusuario), en Aiven (como `avnadmin`, que NO es superusuario) y en minikube.
--
-- El esquema del proyecto se escribió para Supabase y usa tres cosas de esa plataforma.
-- Este archivo las crea para que el esquema corra sin cambios:
--
--   1. `auth.users`   — la tabla de cuentas. Acá vive el HASH BCrypt de la contraseña
--                       (`password_hash`, coste 12, lo genera lib/auth/password.ts). El
--                       trigger `handle_new_auth_user` de schema.sql la proyecta a
--                       `public.users` y `public.profiles`.
--   2. `auth.uid()`   — el id de la persona que hace la consulta. Lo lee de
--                       `request.jwt.claim.sub`, que la aplicación fija por transacción con
--                       `set_config(..., true)` (lib/db/client.ts → asUser). Las 44
--                       políticas RLS de schema.sql lo usan.
--   3. Roles          — `anon`, `authenticated` y `service_role`. La aplicación se conecta
--                       como el DUEÑO de las tablas (no lo frena RLS: es la identidad de los
--                       agentes autónomos) y, para leer como una persona, hace
--                       `SET LOCAL ROLE authenticated`. Para eso el usuario de conexión tiene
--                       que ser MIEMBRO de esos roles: es el `grant` del final.
--
-- IDEMPOTENTE: se puede ejecutar todas las veces que haga falta.
-- =====================================================================================

-- --- 1 · Esquema y tabla de cuentas ---------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  -- Hash BCrypt (`$2b$12$…`). NULL = la cuenta no puede iniciar sesión (agentes).
  password_hash      text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint auth_users_hash_bcrypt
    check (password_hash is null or password_hash ~ '^\$2[aby]\$[0-9]{2}\$.{53}$')
);

-- Por si la tabla venía de una versión anterior sin la columna.
alter table auth.users add column if not exists password_hash text;
alter table auth.users add column if not exists updated_at timestamptz not null default now();

-- Un correo, una cuenta, sin importar mayúsculas.
create unique index if not exists auth_users_email_lower_key on auth.users (lower(email));

-- --- 2 · auth.uid() ------------------------------------------------------------------
-- `nullif(..., '')`: sin identidad fijada devuelve NULL, y las políticas RLS no dejan ver
-- nada. Una sesión sin persona no ve datos de nadie.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- --- 3 · Roles -----------------------------------------------------------------------
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;

-- `service_role` se conserva porque schema.sql le concede privilegios. Crearlo con
-- BYPASSRLS exige ser superusuario (o tener BYPASSRLS): en Aiven no se puede, y se crea sin
-- él. No cambia nada: la aplicación no lo usa, opera como dueño de las tablas.
do $$
begin
  create role service_role nologin bypassrls;
exception
  when duplicate_object then null;
  when insufficient_privilege then
    begin
      create role service_role nologin;
    exception when duplicate_object then null;
    end;
end $$;

-- El usuario de conexión tiene que poder hacer `SET ROLE authenticated`. En PostgreSQL 16+
-- quien crea un rol con CREATEROLE recibe ADMIN OPTION sobre él, así que esto funciona
-- también en Aiven. Si los roles los creó OTRA cuenta, el grant falla: se avisa y
-- `npm run db:check` lo detecta antes de que la app falle con «permission denied».
do $$
begin
  execute format('grant anon, authenticated to %I', current_user);
exception
  when insufficient_privilege or invalid_grant_operation then
    raise warning
      'VEKTORA: % no puede recibir los roles anon/authenticated. Ejecutá como el dueño de esos roles: grant anon, authenticated to %;',
      current_user, current_user;
end $$;

-- --- 4 · Privilegios -----------------------------------------------------------------
-- Las personas (`authenticated`) NUNCA leen `auth.users`: ahí están los hashes. El login
-- lo hace la aplicación como dueña de la tabla.
grant usage on schema auth to anon, authenticated, service_role;
revoke all on auth.users from public, anon, authenticated;
grant select on auth.users to service_role;

revoke all on function auth.uid() from public;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- =====================================================================================
-- FIN — db/00_plataforma.sql · Siguiente: db/schema.sql
-- =====================================================================================
