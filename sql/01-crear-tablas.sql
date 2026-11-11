-- =====================================================================================
-- VEKTORA · sql/01-crear-tablas.sql
-- =====================================================================================
-- ARCHIVO GENERADO por `npm run sql:build` a partir de db/. NO EDITAR A MANO:
-- cambiá el archivo de db/ correspondiente y volvé a generar.
--
-- Crea el esquema completo: plataforma (auth, roles), 14 tablas, triggers, índices,
-- políticas RLS y las funciones de cada fase.
--
-- Idempotente: se puede ejecutar más de una vez sobre la misma base.
-- Fuentes, en orden:
--   · db/00_plataforma.sql
--   · db/schema.sql
--   · db/migrations/0002_planner.sql
--   · db/migrations/0003_provider_onboarding.sql
--   · db/migrations/0004_matching.sql
--   · db/migrations/0005_qa.sql
--   · db/migrations/0007_escalada.sql
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/00_plataforma.sql
set search_path = public, extensions;

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/schema.sql
set search_path = public, extensions;

-- =====================================================================================
-- VEKTORA · FASE 1 — Modelo de datos
-- =====================================================================================
-- Destino: Supabase (PostgreSQL 16 + pgvector). Ejecutar en el SQL Editor.
--
-- PROCEDENCIA: este archivo NO está deducido de la documentación. Se reconstruyó el
-- 2026-09-14 a partir del volcado de catálogos de la base realmente desplegada
-- (pg_type, information_schema.columns, pg_constraint, pg_indexes, pg_policies,
-- pg_trigger, pg_get_functiondef). Cuerpos de función y políticas son literales.
--
-- ORDEN DE DESPLIEGUE
--   1. db/schema.sql                   <- este archivo
--   2. db/migrations/0002_planner.sql
--   3. db/seeds/01_skills.sql
--
-- IDEMPOTENTE: todo `create` lleva `if not exists`, las funciones son `create or replace`,
-- los triggers y las políticas se eliminan antes de crearse.
--
-- MODELO DE SEGURIDAD
--   · RLS activo en las 14 tablas. Ausencia de política = denegación.
--   · Ninguna política concede INSERT/UPDATE sobre `ai_runs`, `reputation_events` ni
--     `audit_logs`: esas tablas solo las escribe `service_role`, que bypassea RLS. Es la
--     identidad de los agentes autónomos.
--   · Los helpers son SECURITY DEFINER para evitar recursión de políticas.
-- =====================================================================================


-- =====================================================================================
-- 00 · EXTENSIONES
-- =====================================================================================

create schema if not exists extensions;

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "vector"    with schema extensions;
create extension if not exists "citext"    with schema extensions;

set search_path = public, extensions;


-- =====================================================================================
-- 01 · TIPOS ENUM DEL DOMINIO (14)
-- =====================================================================================
-- `create type` no admite `if not exists`: cada uno va en un bloque que ignora
-- `duplicate_object`. Eso es lo que hace el archivo reaplicable.

do $$ begin
  create type user_role as enum ('client', 'provider', 'both', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type account_status as enum ('active', 'suspended', 'banned', 'deleted');
exception when duplicate_object then null; end $$;

-- Quién ejecuta una acción. `ai_agent` es un actor de primera clase: el sistema es
-- autónomo y la mayoría de las escrituras no vienen de una persona.
do $$ begin
  create type actor_type as enum ('user', 'ai_agent', 'system', 'service');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum
    ('draft', 'planning', 'planned', 'active', 'paused', 'completed', 'cancelled', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_visibility as enum ('private', 'public');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum (
    'blocked', 'ready', 'open', 'matching', 'assigned', 'in_progress',
    'submitted', 'in_review', 'revision_requested', 'approved', 'cancelled', 'failed'
  );
exception when duplicate_object then null; end $$;

-- Semántica de la arista del DAG. El planificador solo emite `finish_to_start`; los otros
-- tres quedan disponibles para planificación temporal fina.
do $$ begin
  create type dependency_type as enum
    ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish');
exception when duplicate_object then null; end $$;

do $$ begin
  create type application_status as enum
    ('pending', 'shortlisted', 'accepted', 'rejected', 'withdrawn', 'expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type qa_status as enum
    ('pending', 'running', 'approved', 'rejected', 'revision_requested', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type review_source as enum ('human', 'ai_judge', 'system');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reputation_event_type as enum (
    'onboarding_bonus', 'deliverable_approved', 'deliverable_rejected',
    'task_completed', 'task_failed', 'review_received', 'deadline_met',
    'deadline_missed', 'evidence_verified', 'evidence_disputed', 'manual_adjustment'
  );
exception when duplicate_object then null; end $$;

-- ATENCIÓN: estos tres ENUM están replicados como literales en lib/ai/types.ts.
-- Añadir una etiqueta aquí obliga a añadirla allí, o la telemetría fallará al insertar
-- con "invalid input value for enum".
do $$ begin
  create type ai_provider as enum ('groq', 'google', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_operation as enum (
    'project_planning', 'task_decomposition', 'embedding', 'matching',
    'qa_judge', 'schema_repair', 'summarization', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_run_status as enum (
    'pending', 'success', 'invalid_output', 'repaired', 'failed', 'timeout', 'rate_limited'
  );
exception when duplicate_object then null; end $$;


-- =====================================================================================
-- 02 · UTILIDADES COMUNES
-- =====================================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

-- `reputation_events` y `audit_logs` son el libro mayor del sistema: si se pudieran editar,
-- la reputación dejaría de ser reconstruible y perdería su valor como mecanismo de confianza.
create or replace function public.forbid_mutation()
returns trigger
language plpgsql
as $function$
begin
  raise exception 'VEKTORA/SEC: la tabla % es append-only (operación % rechazada)',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$function$;


-- =====================================================================================
-- 03 · TABLAS (14)
-- =====================================================================================

-- --- 03.1 Identidad -------------------------------------------------------------------
-- `public.users` es la proyección de `auth.users`. El resto del esquema referencia ESTA
-- tabla y nunca `auth.users` directamente.
create table if not exists public.users (
  id            uuid primary key default uuid_generate_v4()
                  references auth.users (id) on delete cascade,
  email         citext,
  role          user_role      not null default 'both',
  status        account_status not null default 'active',
  -- Un agente autónomo también es una cuenta: puede ser dueño de proyectos y recibir
  -- reputación. Este flag lo distingue de una persona.
  is_agent      boolean not null default false,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- El nombre y los datos de presentación viven aquí, NO en `users`: `users` es identidad y
-- autorización, `profiles` es contenido editable por la persona.
create table if not exists public.profiles (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null unique references public.users (id) on delete cascade,
  full_name    text,
  display_name text,
  avatar_url   text,
  bio          text,
  country_code char(2),
  timezone     text  not null default 'UTC',
  locale       text  not null default 'es',
  website_url  text,
  links        jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_bio_len check (bio is null or char_length(bio) <= 4000)
);

-- Perfil de ejecución. `reputation_score`, `tasks_completed`, `tasks_failed` y `avg_rating`
-- son PROYECCIONES materializadas por trigger desde `reputation_events` y `reviews`.
create table if not exists public.provider_profiles (
  id                      uuid primary key default uuid_generate_v4(),
  user_id                 uuid not null unique references public.users (id) on delete cascade,
  headline                text,
  summary                 text,
  seniority               text,
  hourly_rate_usd         numeric(10, 2),
  min_task_budget_usd     numeric(12, 2),
  availability_hours_week integer,
  languages               text[] not null default '{}'::text[],
  timezone                text,
  is_active               boolean not null default true,
  -- Consentimiento explícito a la asignación automática: sin esto, un sistema sin humanos
  -- estaría adjudicando trabajo a quien no lo pidió.
  accepts_auto_assign     boolean not null default true,
  reputation_score        numeric(8, 3) not null default 0,
  tasks_completed         integer not null default 0,
  tasks_failed            integer not null default 0,
  avg_rating              numeric(4, 2),
  on_time_rate            numeric(5, 4),
  -- 1536 dimensiones: gemini-embedding-001 recortado por MRL y renormalizado L2.
  -- Cambiar el tamaño obliga a cambiar AI_EMBEDDING_DIMENSIONS y a reconstruir el HNSW.
  embedding               vector(1536),
  embedding_model         text,
  embedding_updated_at    timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint provider_hourly_rate_pos
    check (hourly_rate_usd is null or hourly_rate_usd >= 0),
  constraint provider_avail_range
    check (availability_hours_week is null
           or (availability_hours_week >= 0 and availability_hours_week <= 168)),
  constraint provider_avg_rating_range
    check (avg_rating is null or (avg_rating >= 0 and avg_rating <= 5)),
  constraint provider_on_time_range
    check (on_time_rate is null or (on_time_rate >= 0 and on_time_rate <= 1))
);

-- --- 03.2 Catálogo de skills ----------------------------------------------------------
-- `slug` es citext: el planificador normaliza a minúsculas, pero un slug con mayúsculas
-- no debe duplicar la fila.
create table if not exists public.skills (
  id          uuid primary key default uuid_generate_v4(),
  slug        citext not null unique,
  name        text   not null,
  category    text,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.provider_skills (
  id                  uuid primary key default uuid_generate_v4(),
  provider_profile_id uuid not null references public.provider_profiles (id) on delete cascade,
  skill_id            uuid not null references public.skills (id) on delete cascade,
  level               smallint not null default 3,
  years_experience    numeric(4, 1),
  is_verified         boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint provider_skills_unique unique (provider_profile_id, skill_id),
  constraint provider_skills_level_range check (level >= 1 and level <= 5),
  constraint provider_skills_years_pos
    check (years_experience is null or years_experience >= 0)
);

-- --- 03.3 Proyectos y tareas ----------------------------------------------------------
create table if not exists public.projects (
  id                uuid primary key default uuid_generate_v4(),
  owner_id          uuid not null references public.users (id) on delete cascade,
  title             text not null,
  objective         text not null,
  description       text,
  status            project_status     not null default 'draft',
  visibility        project_visibility not null default 'private',
  currency          char(3) not null default 'USD',
  budget_total      numeric(14, 2),
  deadline          timestamptz,
  acceptance_policy jsonb not null default '{}'::jsonb,
  -- Traza del ProjectPlanner: versión, resumen, estadísticas del DAG y CORRECCIONES
  -- automáticas aplicadas. Es el registro de auditoría de un sistema sin humanos.
  planner_metadata  jsonb not null default '{}'::jsonb,
  dag_generated_at  timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint projects_title_len
    check (char_length(title) >= 3 and char_length(title) <= 200),
  constraint projects_objective_len
    check (char_length(objective) >= 10 and char_length(objective) <= 8000),
  constraint projects_budget_pos check (budget_total is null or budget_total >= 0)
);

create table if not exists public.project_tasks (
  id                   uuid primary key default uuid_generate_v4(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  parent_task_id       uuid references public.project_tasks (id) on delete set null,
  code                 text not null,
  title                text not null,
  description          text,
  acceptance_criteria  jsonb  not null default '[]'::jsonb,
  required_skills      text[] not null default '{}'::text[],
  status               task_status not null default 'blocked',
  priority             smallint not null default 3,
  order_index          integer  not null default 0,
  depth                smallint not null default 0,
  estimated_hours      numeric(8, 2),
  budget               numeric(12, 2),
  assignee_id          uuid references public.users (id) on delete set null,
  assigned_at          timestamptz,
  due_at               timestamptz,
  started_at           timestamptz,
  completed_at         timestamptz,
  embedding            vector(1536),
  embedding_model      text,
  embedding_updated_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- El código identifica la tarea dentro del proyecto: es la clave que usa el planificador.
  constraint project_tasks_code_unique unique (project_id, code),
  constraint project_tasks_title_len
    check (char_length(title) >= 3 and char_length(title) <= 300),
  constraint project_tasks_priority_range check (priority >= 1 and priority <= 5),
  constraint project_tasks_hours_pos
    check (estimated_hours is null or estimated_hours >= 0),
  constraint project_tasks_budget_pos check (budget is null or budget >= 0),
  constraint project_tasks_criteria_is_array
    check (jsonb_typeof(acceptance_criteria) = 'array'),
  constraint project_tasks_no_self_parent
    check (parent_task_id is null or parent_task_id <> id)
);

-- Aristas del DAG: `task_id` NO puede empezar hasta que `depends_on_task_id` se satisfaga.
-- No hay `project_id` aquí: la pertenencia se deriva de `project_tasks` y el trigger
-- `prevent_dag_cycles` comprueba que ambos extremos sean del mismo proyecto.
create table if not exists public.task_dependencies (
  id                 uuid primary key default uuid_generate_v4(),
  task_id            uuid not null references public.project_tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.project_tasks (id) on delete cascade,
  dependency_type    dependency_type not null default 'finish_to_start',
  lag_hours          numeric(8, 2) not null default 0,
  created_by         actor_type not null default 'ai_agent',
  created_at         timestamptz not null default now(),
  constraint task_dependencies_unique unique (task_id, depends_on_task_id),
  constraint task_dependencies_no_self check (task_id <> depends_on_task_id)
);

-- --- 03.4 Observabilidad de la IA -----------------------------------------------------
-- Contrato con lib/ai/telemetry.ts: `start()` inserta en `pending` y `finish()` cierra la
-- fila. Una corrida colgada queda como `pending` con `finished_at` nulo — esa es
-- exactamente la señal que quiere la FASE 7.
create table if not exists public.ai_runs (
  id                uuid primary key default uuid_generate_v4(),
  operation         ai_operation  not null,
  provider          ai_provider   not null,
  model             text          not null,
  status            ai_run_status not null default 'pending',
  attempt           smallint      not null default 1,
  -- Proveedor cuyo turno se agotó antes de este intento: hace visible la cadena de
  -- fallback en una consulta simple.
  fell_back_from    ai_provider,
  parent_run_id     uuid references public.ai_runs (id) on delete set null,
  user_id           uuid references public.users (id) on delete set null,
  project_id        uuid references public.projects (id) on delete set null,
  task_id           uuid references public.project_tasks (id) on delete set null,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  latency_ms        integer,
  cost_usd          numeric(12, 6) not null default 0,
  request_payload   jsonb not null default '{}'::jsonb,
  response_payload  jsonb not null default '{}'::jsonb,
  zod_errors        jsonb,
  error_message     text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  constraint ai_runs_attempt_pos check (attempt >= 1),
  constraint ai_runs_tokens_pos
    check (coalesce(prompt_tokens, 0) >= 0 and coalesce(completion_tokens, 0) >= 0),
  constraint ai_runs_no_self_parent check (parent_run_id is null or parent_run_id <> id)
);

-- --- 03.5 Asignación, entrega y revisión ----------------------------------------------
create table if not exists public.task_applications (
  id                uuid primary key default uuid_generate_v4(),
  task_id           uuid not null references public.project_tasks (id) on delete cascade,
  provider_id       uuid not null references public.users (id) on delete cascade,
  cover_letter      text,
  proposed_price    numeric(12, 2),
  proposed_hours    numeric(8, 2),
  status            application_status not null default 'pending',
  -- Desglose del matching híbrido de la FASE 4. Se guarda cada componente y no solo el
  -- total: sin ellos no se puede explicar ni auditar una asignación automática.
  vector_score      numeric(6, 5),
  skill_score       numeric(6, 5),
  reputation_score  numeric(6, 5),
  match_score       numeric(6, 5),
  match_explanation jsonb not null default '{}'::jsonb,
  is_auto_generated boolean not null default false,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint task_applications_unique unique (task_id, provider_id),
  constraint task_applications_price_pos
    check (proposed_price is null or proposed_price >= 0),
  constraint task_applications_vector_range
    check (vector_score is null or (vector_score >= 0 and vector_score <= 1)),
  constraint task_applications_skill_range
    check (skill_score is null or (skill_score >= 0 and skill_score <= 1)),
  constraint task_applications_reputation_range
    check (reputation_score is null or (reputation_score >= 0 and reputation_score <= 1)),
  constraint task_applications_match_range
    check (match_score is null or (match_score >= 0 and match_score <= 1))
);

-- `version` se asigna sola (`set_deliverable_version`): basta insertar sin ella.
-- `evidence` es lo que evalúa el AI Judge de la FASE 5; `qa_*` guarda su veredicto.
create table if not exists public.deliverables (
  id                  uuid primary key default uuid_generate_v4(),
  task_id             uuid not null references public.project_tasks (id) on delete cascade,
  provider_id         uuid not null references public.users (id) on delete cascade,
  version             integer not null default 1,
  summary             text,
  content             text,
  artifacts           jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '{}'::jsonb,
  qa_status           qa_status not null default 'pending',
  qa_score            numeric(5, 2),
  qa_feedback         jsonb not null default '{}'::jsonb,
  qa_criteria_results jsonb not null default '[]'::jsonb,
  -- Corrida del AI Judge que emitió el veredicto sobre este entregable.
  qa_run_id           uuid references public.ai_runs (id) on delete set null,
  qa_evaluated_at     timestamptz,
  submitted_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deliverables_version_unique unique (task_id, version),
  constraint deliverables_version_pos check (version >= 1),
  constraint deliverables_artifacts_is_array check (jsonb_typeof(artifacts) = 'array'),
  constraint deliverables_qa_score_range
    check (qa_score is null or (qa_score >= 0 and qa_score <= 100))
);

create table if not exists public.reviews (
  id                  uuid primary key default uuid_generate_v4(),
  task_id             uuid not null references public.project_tasks (id) on delete cascade,
  deliverable_id      uuid references public.deliverables (id) on delete set null,
  reviewer_id         uuid references public.users (id) on delete set null,
  reviewee_id         uuid not null references public.users (id) on delete cascade,
  source              review_source not null default 'ai_judge',
  rating              numeric(3, 2) not null,
  quality_score       numeric(3, 2),
  communication_score numeric(3, 2),
  timeliness_score    numeric(3, 2),
  comment             text,
  is_public           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint reviews_rating_range check (rating >= 0 and rating <= 5),
  constraint reviews_quality_range
    check (quality_score is null or (quality_score >= 0 and quality_score <= 5)),
  constraint reviews_comm_range
    check (communication_score is null or (communication_score >= 0 and communication_score <= 5)),
  constraint reviews_time_range
    check (timeliness_score is null or (timeliness_score >= 0 and timeliness_score <= 5)),
  -- Una reseña humana necesita firmante; la del AI Judge no tiene `reviewer_id`.
  constraint reviews_human_has_reviewer
    check (source <> 'human' or reviewer_id is not null),
  constraint reviews_no_self check (reviewer_id is null or reviewer_id <> reviewee_id)
);

-- Libro mayor de reputación: APPEND-ONLY. Cualquier puntuación mostrada debe poder
-- reconstruirse sumando estos eventos (delta * weight).
create table if not exists public.reputation_events (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references public.users (id) on delete cascade,
  event_type     reputation_event_type not null,
  delta          numeric(8, 3) not null,
  weight         numeric(6, 3) not null default 1,
  reason         text,
  task_id        uuid references public.project_tasks (id) on delete set null,
  deliverable_id uuid references public.deliverables (id) on delete set null,
  review_id      uuid references public.reviews (id) on delete set null,
  actor_type     actor_type not null default 'ai_agent',
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  constraint reputation_events_delta_range check (delta >= -100 and delta <= 100)
);

-- --- 03.6 Auditoría --------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default uuid_generate_v4(),
  actor_id    uuid references public.users (id) on delete set null,
  actor_type  actor_type not null default 'user',
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  project_id  uuid references public.projects (id) on delete set null,
  changes     jsonb not null default '{}'::jsonb,
  metadata    jsonb not null default '{}'::jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);


-- =====================================================================================
-- 04 · INTEGRIDAD DEL GRAFO
-- =====================================================================================

-- Valida, en este orden: auto-dependencia, pertenencia al MISMO proyecto y aciclicidad.
--
-- Es SECURITY DEFINER a propósito: con RLS activo, un recorrido con los privilegios del
-- invocante vería solo un subgrafo y podría declarar acíclico un grafo que no lo es.
--
-- Lanza SQLSTATE 23514 con la ruta del ciclo. El ProjectPlanner de la FASE 3 lo captura,
-- rompe el ciclo y reintenta UNA vez.
create or replace function public.prevent_dag_cycles()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task_project      uuid;
  v_depends_project   uuid;
  v_cycle_path        uuid[];
  v_old_edge_id       uuid;
begin
  -- En UPDATE, la arista vieja debe ignorarse: será reemplazada por la nueva.
  -- OLD solo se toca dentro de esta guarda para no depender del comportamiento
  -- de OLD en triggers de INSERT.
  if tg_op = 'UPDATE' then
    v_old_edge_id := old.id;
  end if;

  -- 1) Auto-dependencia
  if new.task_id = new.depends_on_task_id then
    raise exception
      'VEKTORA/DAG: una tarea no puede depender de sí misma (task_id=%)', new.task_id
      using errcode = '23514';
  end if;

  -- 2) Coherencia de proyecto
  select project_id into v_task_project
  from public.project_tasks where id = new.task_id;

  select project_id into v_depends_project
  from public.project_tasks where id = new.depends_on_task_id;

  if v_task_project is null or v_depends_project is null then
    raise exception
      'VEKTORA/DAG: tarea inexistente (task_id=%, depends_on_task_id=%)',
      new.task_id, new.depends_on_task_id
      using errcode = '23503';
  end if;

  if v_task_project <> v_depends_project then
    raise exception
      'VEKTORA/DAG: las dependencias deben pertenecer al mismo proyecto (% <> %)',
      v_task_project, v_depends_project
      using errcode = '23514';
  end if;

  -- 3) Detección de ciclo
  -- Se recorre la cadena de dependencias existente partiendo de depends_on_task_id.
  -- Si en ese recorrido aparece task_id, la arista candidata cerraría el ciclo.
  -- `path` NO incluye task_id: así el nodo objetivo es alcanzable una única vez, y el
  -- filtro anti-repetición sigue garantizando terminación ante ciclos preexistentes.
  with recursive upstream as (
    select
      new.depends_on_task_id            as node,
      array[new.depends_on_task_id]     as path
    union all
    select
      d.depends_on_task_id,
      u.path || d.depends_on_task_id
    from public.task_dependencies d
    join upstream u on d.task_id = u.node
    where not d.depends_on_task_id = any (u.path)   -- corta ciclos preexistentes
      and array_length(u.path, 1) < 1000            -- cota dura de seguridad
      and (v_old_edge_id is null or d.id <> v_old_edge_id)
  )
  select array[new.task_id] || u.path into v_cycle_path
  from upstream u
  where u.node = new.task_id
  limit 1;

  if v_cycle_path is not null then
    raise exception
      'VEKTORA/DAG: la dependencia % -> % cierra un ciclo. Ruta detectada: %',
      new.task_id, new.depends_on_task_id, v_cycle_path
      using errcode = '23514',
            hint = 'Elimine una arista intermedia o replanifique el subgrafo afectado.';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_prevent_dag_cycles on public.task_dependencies;
create trigger trg_prevent_dag_cycles
  before insert or update of task_id, depends_on_task_id on public.task_dependencies
  for each row execute function public.prevent_dag_cycles();

-- La jerarquía `parent_task_id` es un árbol aparte del DAG de dependencias, y también
-- puede ciclar. Se recorre iterativamente con cota dura.
create or replace function public.prevent_task_parent_cycles()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_node  uuid := new.parent_task_id;
  v_depth integer := 0;
begin
  if new.parent_task_id is null then
    return new;
  end if;

  if new.parent_task_id = new.id then
    raise exception 'VEKTORA/DAG: una tarea no puede ser su propio padre (id=%)', new.id
      using errcode = '23514';
  end if;

  while v_node is not null and v_depth < 1000 loop
    if v_node = new.id then
      raise exception
        'VEKTORA/DAG: el reparentado de la tarea % cierra un ciclo jerárquico', new.id
        using errcode = '23514';
    end if;
    select parent_task_id into v_node from public.project_tasks where id = v_node;
    v_depth := v_depth + 1;
  end loop;

  return new;
end;
$function$;

drop trigger if exists trg_prevent_task_parent_cycles on public.project_tasks;
create trigger trg_prevent_task_parent_cycles
  before insert or update of parent_task_id on public.project_tasks
  for each row execute function public.prevent_task_parent_cycles();


-- =====================================================================================
-- 05 · TRIGGERS DE INTEGRIDAD Y AUTOMATIZACIÓN
-- =====================================================================================

-- --- 05.1 updated_at ------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'users', 'profiles', 'provider_profiles', 'projects', 'project_tasks',
    'task_applications', 'deliverables', 'reviews'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', v_table);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at()',
      v_table
    );
  end loop;
end $$;

-- --- 05.2 Tablas append-only ------------------------------------------------------------
drop trigger if exists trg_reputation_events_immutable on public.reputation_events;
create trigger trg_reputation_events_immutable
  before delete or update on public.reputation_events
  for each row execute function public.forbid_mutation();

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before delete or update on public.audit_logs
  for each row execute function public.forbid_mutation();

-- --- 05.3 Versionado automático de entregables -------------------------------------------
create or replace function public.set_deliverable_version()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.version is null or new.version <= 1 then
    select coalesce(max(d.version), 0) + 1 into new.version
    from public.deliverables d
    where d.task_id = new.task_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_deliverables_version on public.deliverables;
create trigger trg_deliverables_version
  before insert on public.deliverables
  for each row execute function public.set_deliverable_version();

-- --- 05.4 Escritura restringida por columna -----------------------------------------------
-- RLS es por FILA, no por columna: sin esto, un usuario con permiso legítimo de UPDATE
-- sobre su propia fila de `users` podría ponerse `role = 'admin'`.
create or replace function public.enforce_user_self_update_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- auth.uid() es null para service_role/agentes internos: esos sí pueden cambiar el rol.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'VEKTORA/SEC: el rol de la cuenta no puede modificarse por el propio usuario'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    raise exception 'VEKTORA/SEC: el estado de la cuenta no puede modificarse por el propio usuario'
      using errcode = '42501';
  end if;

  if new.is_agent is distinct from old.is_agent then
    raise exception 'VEKTORA/SEC: el flag is_agent es de administración'
      using errcode = '42501';
  end if;

  new.id := old.id;
  return new;
end;
$function$;

drop trigger if exists trg_users_self_update_scope on public.users;
create trigger trg_users_self_update_scope
  before update on public.users
  for each row execute function public.enforce_user_self_update_scope();

-- El proveedor asignado solo mueve el avance de SU tarea: ni el alcance, ni el
-- presupuesto, ni a quién está asignada.
create or replace function public.enforce_task_assignee_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if auth.uid() is null then
    return new;  -- agentes autónomos / service_role
  end if;

  -- Dueño del proyecto y admin tienen control total.
  if public.is_admin() or exists (
    select 1 from public.projects p where p.id = old.project_id and p.owner_id = auth.uid()
  ) then
    return new;
  end if;

  if old.assignee_id is distinct from auth.uid() then
    raise exception 'VEKTORA/SEC: sin permiso para modificar la tarea %', old.id
      using errcode = '42501';
  end if;

  -- Campos inmutables para el asignado.
  if (new.project_id, new.code, new.title, new.description, new.acceptance_criteria,
      new.required_skills, new.budget, new.assignee_id, new.due_at, new.priority,
      new.parent_task_id, new.order_index)
     is distinct from
     (old.project_id, old.code, old.title, old.description, old.acceptance_criteria,
      old.required_skills, old.budget, old.assignee_id, old.due_at, old.priority,
      old.parent_task_id, old.order_index)
  then
    raise exception
      'VEKTORA/SEC: el proveedor asignado solo puede actualizar status, started_at y completed_at'
      using errcode = '42501';
  end if;

  if new.status not in ('in_progress', 'submitted', 'assigned') then
    raise exception 'VEKTORA/SEC: transición de estado % no permitida al proveedor', new.status
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_task_assignee_scope on public.project_tasks;
create trigger trg_task_assignee_scope
  before update on public.project_tasks
  for each row execute function public.enforce_task_assignee_scope();

-- --- 05.5 Proyección de reputación --------------------------------------------------------
-- `provider_profiles.reputation_score` / `tasks_completed` / `tasks_failed` se derivan del
-- libro mayor. `greatest(0, …)` evita que la reputación se vuelva negativa.
create or replace function public.apply_reputation_event()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.provider_profiles pp
     set reputation_score = greatest(0, pp.reputation_score + (new.delta * new.weight)),
         tasks_completed  = pp.tasks_completed
                            + case when new.event_type = 'task_completed' then 1 else 0 end,
         tasks_failed     = pp.tasks_failed
                            + case when new.event_type = 'task_failed' then 1 else 0 end,
         updated_at       = now()
   where pp.user_id = new.user_id;

  return new;
end;
$function$;

drop trigger if exists trg_apply_reputation_event on public.reputation_events;
create trigger trg_apply_reputation_event
  after insert on public.reputation_events
  for each row execute function public.apply_reputation_event();

create or replace function public.refresh_provider_rating()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    v_user := old.reviewee_id;
  else
    v_user := new.reviewee_id;
  end if;

  update public.provider_profiles pp
     set avg_rating = sub.avg_rating,
         updated_at = now()
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating
      from public.reviews r
      where r.reviewee_id = v_user
    ) sub
   where pp.user_id = v_user;

  return null;
end;
$function$;

drop trigger if exists trg_refresh_provider_rating on public.reviews;
create trigger trg_refresh_provider_rating
  after insert or delete or update of rating on public.reviews
  for each row execute function public.refresh_provider_rating();


-- =====================================================================================
-- 06 · BOOTSTRAP DE CUENTAS (auth.users -> public.users + profiles)
-- =====================================================================================
-- Sin esto, `projects.owner_id` nunca tendría a quién apuntar: `auth.users` la escribe
-- GoTrue, no la aplicación.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.users (id, email, role)
  values (
    new.id,
    new.email,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'both')
  )
  on conflict (id) do nothing;

  insert into public.profiles (user_id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$function$;

do $$
begin
  drop trigger if exists trg_auth_user_created on auth.users;
  create trigger trg_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();
exception
  when insufficient_privilege then
    raise notice
      'VEKTORA: sin privilegio para crear el trigger sobre auth.users; créalo desde el '
      'dashboard de Supabase o ejecuta este bloque como superusuario';
end $$;


-- =====================================================================================
-- 07 · ÍNDICES
-- =====================================================================================
-- PostgreSQL NO indexa las claves foráneas automáticamente: sin estos índices, cada
-- `delete` en cascada hace un seq scan de la tabla hija.

-- --- 07.1 Identidad y catálogo ----------------------------------------------------------
-- Único parcial: `users.email` es nullable (una cuenta de agente puede no tener correo),
-- y un UNIQUE normal permitiría un solo NULL en algunos motores. Parcial es explícito.
create unique index if not exists idx_users_email
  on public.users (email) where email is not null;
create index if not exists idx_users_role    on public.users (role);
create index if not exists idx_users_status  on public.users (status);
create index if not exists idx_profiles_country on public.profiles (country_code);
create index if not exists idx_skills_category  on public.skills (category) where is_active;

-- --- 07.2 Proveedores ---------------------------------------------------------------------
create index if not exists idx_provider_profiles_active_reputation
  on public.provider_profiles (is_active, reputation_score desc);
create index if not exists idx_provider_profiles_rate
  on public.provider_profiles (hourly_rate_usd) where is_active;
create index if not exists idx_provider_profiles_languages
  on public.provider_profiles using gin (languages);
create index if not exists idx_provider_skills_provider
  on public.provider_skills (provider_profile_id);
create index if not exists idx_provider_skills_skill
  on public.provider_skills (skill_id);

-- --- 07.3 Proyectos y tareas --------------------------------------------------------------
create index if not exists idx_projects_owner  on public.projects (owner_id);
create index if not exists idx_projects_status on public.projects (status);
create index if not exists idx_projects_deadline
  on public.projects (deadline) where deadline is not null;
create index if not exists idx_projects_visibility_status
  on public.projects (visibility, status) where visibility = 'public';

create index if not exists idx_project_tasks_project on public.project_tasks (project_id);
create index if not exists idx_project_tasks_status  on public.project_tasks (status);
create index if not exists idx_project_tasks_project_status_order
  on public.project_tasks (project_id, status, order_index);
create index if not exists idx_project_tasks_parent
  on public.project_tasks (parent_task_id) where parent_task_id is not null;
create index if not exists idx_project_tasks_assignee
  on public.project_tasks (assignee_id) where assignee_id is not null;
create index if not exists idx_project_tasks_due_at
  on public.project_tasks (due_at) where due_at is not null;
-- Cola de trabajo del motor de matching (FASE 4): una fracción diminuta de la tabla.
create index if not exists idx_project_tasks_open_queue
  on public.project_tasks (created_at)
  where status in ('ready', 'open', 'matching');
create index if not exists idx_project_tasks_required_skills
  on public.project_tasks using gin (required_skills);

create index if not exists idx_task_dependencies_task
  on public.task_dependencies (task_id);
create index if not exists idx_task_dependencies_depends_on
  on public.task_dependencies (depends_on_task_id);

-- --- 07.4 Asignación, entrega y revisión ----------------------------------------------------
create index if not exists idx_task_applications_task     on public.task_applications (task_id);
create index if not exists idx_task_applications_provider on public.task_applications (provider_id);
create index if not exists idx_task_applications_status   on public.task_applications (status);
create index if not exists idx_task_applications_ranking
  on public.task_applications (task_id, match_score desc nulls last);

create index if not exists idx_deliverables_task      on public.deliverables (task_id);
create index if not exists idx_deliverables_provider  on public.deliverables (provider_id);
create index if not exists idx_deliverables_qa_status on public.deliverables (qa_status);
create index if not exists idx_deliverables_qa_run
  on public.deliverables (qa_run_id) where qa_run_id is not null;
-- Cola del AI Judge (FASE 5), en orden de llegada.
create index if not exists idx_deliverables_qa_queue
  on public.deliverables (submitted_at) where qa_status in ('pending', 'running');

create index if not exists idx_reviews_task    on public.reviews (task_id);
create index if not exists idx_reviews_reviewee on public.reviews (reviewee_id);
create index if not exists idx_reviews_reviewer
  on public.reviews (reviewer_id) where reviewer_id is not null;
create index if not exists idx_reviews_deliverable
  on public.reviews (deliverable_id) where deliverable_id is not null;
-- Una persona reseña una vez por tarea; el AI Judge una vez por (tarea, evaluado, fuente).
create unique index if not exists reviews_unique_human
  on public.reviews (task_id, reviewer_id, reviewee_id) where reviewer_id is not null;
create unique index if not exists reviews_unique_machine
  on public.reviews (task_id, reviewee_id, source) where reviewer_id is null;

create index if not exists idx_reputation_events_user
  on public.reputation_events (user_id, created_at desc);
create index if not exists idx_reputation_events_type
  on public.reputation_events (event_type);
create index if not exists idx_reputation_events_task
  on public.reputation_events (task_id) where task_id is not null;
create index if not exists idx_reputation_events_deliverable
  on public.reputation_events (deliverable_id) where deliverable_id is not null;
create index if not exists idx_reputation_events_review
  on public.reputation_events (review_id) where review_id is not null;

-- --- 07.5 Observabilidad --------------------------------------------------------------------
create index if not exists idx_ai_runs_operation_status
  on public.ai_runs (operation, status, started_at desc);
create index if not exists idx_ai_runs_parent
  on public.ai_runs (parent_run_id) where parent_run_id is not null;
create index if not exists idx_ai_runs_user
  on public.ai_runs (user_id) where user_id is not null;
create index if not exists idx_ai_runs_project
  on public.ai_runs (project_id) where project_id is not null;
create index if not exists idx_ai_runs_task
  on public.ai_runs (task_id) where task_id is not null;
-- Corridas que cedieron el turno: mide la salud real del proveedor primario.
create index if not exists idx_ai_runs_fallback
  on public.ai_runs (provider, started_at desc) where fell_back_from is not null;

create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_id) where actor_id is not null;
create index if not exists idx_audit_logs_project
  on public.audit_logs (project_id) where project_id is not null;
create index if not exists idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_created on public.audit_logs (created_at desc);

-- --- 07.6 Índices vectoriales (FASE 4) --------------------------------------------------------
-- HNSW con `vector_cosine_ops`, PARCIALES sobre `embedding is not null`.
--
-- IMPORTANTE para la FASE 4: para que el planificador use estos índices, la consulta debe
-- incluir el mismo predicado (`where embedding is not null`) y ordenar por `<=>`.
-- Cualquier otra forma de escribir la distancia provoca un seq scan de toda la tabla.
--
-- HNSW y no IVFFlat: IVFFlat necesita datos previos para entrenar las listas y
-- reconstrucción periódica según crece el corpus. HNSW no necesita entrenamiento, que es
-- el comportamiento correcto con una tabla que empieza vacía.
create index if not exists idx_provider_profiles_embedding_hnsw
  on public.provider_profiles using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;

create index if not exists idx_project_tasks_embedding_hnsw
  on public.project_tasks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;


-- =====================================================================================
-- 08 · AUTORIZACIÓN Y RLS
-- =====================================================================================
-- Regla base: RLS activo en las 14 tablas y AUSENCIA DE POLÍTICA = DENEGACIÓN.
--
-- Los helpers son SECURITY DEFINER porque una política que consulta una tabla que a su vez
-- tiene RLS provoca recursión infinita de políticas.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin' and u.status = 'active'
  );
$function$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = auth.uid()
  );
$function$;

-- Un postulante también puede leer el proyecto: sin eso no podría evaluar a qué se postula.
create or replace function public.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (
        p.owner_id = auth.uid()
        or p.visibility = 'public'
        or exists (
          select 1 from public.project_tasks t
          where t.project_id = p.id and t.assignee_id = auth.uid()
        )
        or exists (
          select 1
          from public.task_applications a
          join public.project_tasks t on t.id = a.task_id
          where t.project_id = p.id and a.provider_id = auth.uid()
        )
      )
  );
$function$;

create or replace function public.can_read_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.project_tasks t
    where t.id = p_task_id
      and (t.assignee_id = auth.uid() or public.can_read_project(t.project_id))
  );
$function$;

create or replace function public.is_task_owner(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.project_tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id and p.owner_id = auth.uid()
  );
$function$;

create or replace function public.is_task_assignee(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.project_tasks t
    where t.id = p_task_id and t.assignee_id = auth.uid()
  );
$function$;

create or replace function public.owns_provider_profile(p_provider_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.provider_profiles pp
    where pp.id = p_provider_profile_id and pp.user_id = auth.uid()
  );
$function$;

-- Una tarea acepta candidaturas solo mientras está abierta, sin asignar, en un proyecto
-- activo, y nadie puede postularse a su propio proyecto.
create or replace function public.task_accepts_applications(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.project_tasks t
    join public.projects p on p.id = t.project_id
    where t.id = p_task_id
      and t.status in ('ready', 'open', 'matching')
      and t.assignee_id is null
      and p.status in ('planned', 'active')
      and p.owner_id <> auth.uid()          -- nadie se postula a su propio proyecto
  );
$function$;

-- --- 08.1 Activación de RLS ----------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'users', 'profiles', 'provider_profiles', 'skills', 'provider_skills',
    'projects', 'project_tasks', 'task_dependencies', 'task_applications',
    'deliverables', 'reviews', 'reputation_events', 'ai_runs', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
  end loop;
end $$;

-- --- 08.2 users -----------------------------------------------------------------------------
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = auth.uid() or is_admin());

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

drop policy if exists users_delete_admin on public.users;
create policy users_delete_admin on public.users
  for delete to authenticated
  using (is_admin());

-- --- 08.3 profiles ---------------------------------------------------------------------------
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

drop policy if exists profiles_delete_self on public.profiles;
create policy profiles_delete_self on public.profiles
  for delete to authenticated
  using (user_id = auth.uid() or is_admin());

-- --- 08.4 provider_profiles --------------------------------------------------------------------
drop policy if exists provider_profiles_select on public.provider_profiles;
create policy provider_profiles_select on public.provider_profiles
  for select to authenticated
  using (is_active or user_id = auth.uid() or is_admin());

drop policy if exists provider_profiles_insert_self on public.provider_profiles;
create policy provider_profiles_insert_self on public.provider_profiles
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists provider_profiles_update_self on public.provider_profiles;
create policy provider_profiles_update_self on public.provider_profiles
  for update to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

drop policy if exists provider_profiles_delete_self on public.provider_profiles;
create policy provider_profiles_delete_self on public.provider_profiles
  for delete to authenticated
  using (user_id = auth.uid() or is_admin());

-- --- 08.5 skills y provider_skills ----------------------------------------------------------------
drop policy if exists skills_select_all on public.skills;
create policy skills_select_all on public.skills
  for select to anon, authenticated
  using (is_active or is_admin());

drop policy if exists skills_write_admin on public.skills;
create policy skills_write_admin on public.skills
  for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists provider_skills_select on public.provider_skills;
create policy provider_skills_select on public.provider_skills
  for select to authenticated
  using (
    owns_provider_profile(provider_profile_id)
    or exists (
      select 1 from public.provider_profiles pp
      where pp.id = provider_skills.provider_profile_id and pp.is_active
    )
    or is_admin()
  );

drop policy if exists provider_skills_insert_own on public.provider_skills;
create policy provider_skills_insert_own on public.provider_skills
  for insert to authenticated with check (owns_provider_profile(provider_profile_id));

drop policy if exists provider_skills_update_own on public.provider_skills;
create policy provider_skills_update_own on public.provider_skills
  for update to authenticated
  using (owns_provider_profile(provider_profile_id))
  with check (owns_provider_profile(provider_profile_id));

drop policy if exists provider_skills_delete_own on public.provider_skills;
create policy provider_skills_delete_own on public.provider_skills
  for delete to authenticated using (owns_provider_profile(provider_profile_id));

-- --- 08.6 projects -----------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (owner_id = auth.uid() or can_read_project(id) or is_admin());

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
  for insert to authenticated with check (owner_id = auth.uid());

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
  for update to authenticated
  using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
  for delete to authenticated using (owner_id = auth.uid() or is_admin());

-- --- 08.7 project_tasks ------------------------------------------------------------------------
drop policy if exists project_tasks_select on public.project_tasks;
create policy project_tasks_select on public.project_tasks
  for select to authenticated
  using (assignee_id = auth.uid() or can_read_project(project_id) or is_admin());

drop policy if exists project_tasks_insert_owner on public.project_tasks;
create policy project_tasks_insert_owner on public.project_tasks
  for insert to authenticated with check (is_project_owner(project_id));

-- El asignado entra aquí, pero `enforce_task_assignee_scope` limita QUÉ columnas puede
-- tocar: RLS es por fila, no por columna.
drop policy if exists project_tasks_update on public.project_tasks;
create policy project_tasks_update on public.project_tasks
  for update to authenticated
  using (is_project_owner(project_id) or assignee_id = auth.uid() or is_admin())
  with check (is_project_owner(project_id) or assignee_id = auth.uid() or is_admin());

drop policy if exists project_tasks_delete_owner on public.project_tasks;
create policy project_tasks_delete_owner on public.project_tasks
  for delete to authenticated using (is_project_owner(project_id) or is_admin());

-- --- 08.8 task_dependencies -----------------------------------------------------------------------
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies
  for select to authenticated using (can_read_task(task_id) or is_admin());

-- Se exige ser dueño de AMBOS extremos: si no, se podría enganchar una tarea ajena al
-- propio grafo y bloquearla.
drop policy if exists task_dependencies_insert_owner on public.task_dependencies;
create policy task_dependencies_insert_owner on public.task_dependencies
  for insert to authenticated
  with check (is_task_owner(task_id) and is_task_owner(depends_on_task_id));

drop policy if exists task_dependencies_update_owner on public.task_dependencies;
create policy task_dependencies_update_owner on public.task_dependencies
  for update to authenticated
  using (is_task_owner(task_id))
  with check (is_task_owner(task_id) and is_task_owner(depends_on_task_id));

drop policy if exists task_dependencies_delete_owner on public.task_dependencies;
create policy task_dependencies_delete_owner on public.task_dependencies
  for delete to authenticated using (is_task_owner(task_id) or is_admin());

-- --- 08.9 task_applications --------------------------------------------------------------------------
drop policy if exists task_applications_select on public.task_applications;
create policy task_applications_select on public.task_applications
  for select to authenticated
  using (provider_id = auth.uid() or is_task_owner(task_id) or is_admin());

drop policy if exists task_applications_insert_self on public.task_applications;
create policy task_applications_insert_self on public.task_applications
  for insert to authenticated
  with check (provider_id = auth.uid() and task_accepts_applications(task_id));

drop policy if exists task_applications_update on public.task_applications;
create policy task_applications_update on public.task_applications
  for update to authenticated
  using (provider_id = auth.uid() or is_task_owner(task_id) or is_admin())
  with check (provider_id = auth.uid() or is_task_owner(task_id) or is_admin());

drop policy if exists task_applications_delete_self on public.task_applications;
create policy task_applications_delete_self on public.task_applications
  for delete to authenticated using (provider_id = auth.uid() or is_admin());

-- --- 08.10 deliverables -----------------------------------------------------------------------------
drop policy if exists deliverables_select on public.deliverables;
create policy deliverables_select on public.deliverables
  for select to authenticated
  using (provider_id = auth.uid() or is_task_owner(task_id) or is_admin());

drop policy if exists deliverables_insert_assignee on public.deliverables;
create policy deliverables_insert_assignee on public.deliverables
  for insert to authenticated
  with check (provider_id = auth.uid() and is_task_assignee(task_id));

-- El proveedor solo puede reeditar mientras el AI Judge no lo haya juzgado (o pidió cambios).
drop policy if exists deliverables_update on public.deliverables;
create policy deliverables_update on public.deliverables
  for update to authenticated
  using (
    (provider_id = auth.uid()
      and qa_status in ('pending', 'revision_requested', 'error'))
    or is_task_owner(task_id) or is_admin()
  )
  with check (
    (provider_id = auth.uid()
      and qa_status in ('pending', 'revision_requested', 'error'))
    or is_task_owner(task_id) or is_admin()
  );

drop policy if exists deliverables_delete_admin on public.deliverables;
create policy deliverables_delete_admin on public.deliverables
  for delete to authenticated using (is_admin());

-- --- 08.11 reviews ------------------------------------------------------------------------------------
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated
  using (
    (is_public and can_read_task(task_id))
    or reviewer_id = auth.uid()
    or reviewee_id = auth.uid()
    or is_task_owner(task_id)
    or is_admin()
  );

-- Una persona solo firma su propia reseña y no puede autoevaluarse. El AI Judge entra por
-- `service_role`, que bypassea RLS.
drop policy if exists reviews_insert_participant on public.reviews;
create policy reviews_insert_participant on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and source = 'human'
    and reviewee_id <> auth.uid()
    and (is_task_owner(task_id) or is_task_assignee(task_id))
  );

drop policy if exists reviews_update_own on public.reviews;
create policy reviews_update_own on public.reviews
  for update to authenticated
  using (reviewer_id = auth.uid() or is_admin())
  with check (reviewer_id = auth.uid() or is_admin());

drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews
  for delete to authenticated using (reviewer_id = auth.uid() or is_admin());

-- --- 08.12 reputation_events, ai_runs y audit_logs ----------------------------------------------------
-- Las tres son de SOLO LECTURA para el tráfico de PostgREST: no hay política de INSERT,
-- UPDATE ni DELETE. Solo escribe `service_role`, que bypassea RLS.

drop policy if exists reputation_events_select_own on public.reputation_events;
create policy reputation_events_select_own on public.reputation_events
  for select to authenticated using (user_id = auth.uid() or is_admin());

-- Los payloads pueden contener el objetivo del cliente: solo el dueño del proyecto.
drop policy if exists ai_runs_select_own on public.ai_runs;
create policy ai_runs_select_own on public.ai_runs
  for select to authenticated
  using (
    user_id = auth.uid()
    or (project_id is not null and is_project_owner(project_id))
    or is_admin()
  );

drop policy if exists audit_logs_select_own on public.audit_logs;
create policy audit_logs_select_own on public.audit_logs
  for select to authenticated
  using (
    actor_id = auth.uid()
    or (project_id is not null and is_project_owner(project_id))
    or is_admin()
  );


-- =====================================================================================
-- 09 · PRIVILEGIOS POR ROL
-- =====================================================================================
-- Trampa de PostgreSQL: toda función nueva recibe EXECUTE para PUBLIC. `revoke ... from
-- anon` NO cierra nada, porque `anon` lo hereda igualmente de PUBLIC. Hay que revocar de
-- PUBLIC y luego conceder explícitamente.

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'is_project_owner(uuid)', 'can_read_project(uuid)', 'can_read_task(uuid)',
    'is_task_owner(uuid)', 'is_task_assignee(uuid)', 'owns_provider_profile(uuid)',
    'task_accepts_applications(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', v_function);
    execute format(
      'grant execute on function public.%s to authenticated, service_role', v_function);
  end loop;
end $$;

-- `is_admin()` CONSERVA el EXECUTE de `anon` a propósito.
--
-- Una política RLS que invoca una función exige que el ROL EVALUADO tenga EXECUTE sobre
-- ella. `skills_select_all` es `to anon, authenticated` e invoca `is_admin()`: al
-- revocarlo de `anon`, TODA lectura de `public.skills` falla con "permission denied for
-- function is_admin". Es inocuo mantenerlo: con `anon`, `auth.uid()` es NULL y devuelve false.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- Las funciones de trigger no se invocan directamente: nadie necesita EXECUTE.
do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'set_updated_at()', 'forbid_mutation()', 'set_deliverable_version()',
    'prevent_dag_cycles()', 'prevent_task_parent_cycles()', 'apply_reputation_event()',
    'refresh_provider_rating()', 'enforce_user_self_update_scope()',
    'enforce_task_assignee_scope()', 'handle_new_auth_user()'
  ] loop
    execute format('revoke all on function public.%s from public', v_function);
    execute format('grant execute on function public.%s to service_role', v_function);
  end loop;
end $$;


-- =====================================================================================
-- FIN — db/schema.sql
-- Siguiente: db/migrations/0002_planner.sql, y luego db/seeds/01_skills.sql
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/migrations/0002_planner.sql
set search_path = public, extensions;

-- =====================================================================================
-- VEKTORA · FASE 3 — Migración del ProjectPlanner
-- =====================================================================================
-- Aplicar DESPUÉS de db/schema.sql. Idempotente: reaplicarla no tiene efecto.
--
-- PROCEDENCIA: reconstruida el 2026-09-14 desde `pg_get_functiondef` de la base realmente
-- desplegada. Los cuerpos de función son literales, no una reinterpretación.
--
-- Contenido:
--   01 · `refresh_task_readiness` — motor de avance blocked <-> ready
--   02 · `propagate_task_readiness` + trigger
--   03 · `apply_project_plan` — persistencia transaccional del DAG en UNA llamada
--   04 · `register_skills` — el catálogo crece solo (requisito de autonomía)
--   05 · `project_dag` — lectura del grafo completo como JSON
--   06 · Endurecimiento de privilegios
-- =====================================================================================

set search_path = public, extensions;


-- =====================================================================================
-- 01 · refresh_task_readiness — el motor de avance del DAG
-- =====================================================================================
-- `blocked -> ready` cuando TODAS las dependencias están `approved`, y el camino inverso
-- si una se reabre por revisión. Es lo que hace que el proyecto avance solo.
--
-- Solo toca tareas en `blocked` o `ready`: una tarea `assigned` o `in_progress` no vuelve
-- atrás por este mecanismo.

create or replace function public.refresh_task_readiness(p_project_id uuid default null::uuid)
returns integer
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_changed integer := 0;
begin
  with candidate as (
    select
      t.id,
      t.status,
      count(d.depends_on_task_id)                                              as total_deps,
      count(*) filter (where upstream.status = 'approved')                      as satisfied_deps
    from public.project_tasks t
    left join public.task_dependencies d on d.task_id = t.id
    left join public.project_tasks upstream on upstream.id = d.depends_on_task_id
    where (p_project_id is null or t.project_id = p_project_id)
      and t.status in ('blocked', 'ready')
    group by t.id, t.status
  ),
  target as (
    select
      id,
      status,
      case when total_deps = satisfied_deps then 'ready'::public.task_status
           else 'blocked'::public.task_status end as next_status
    from candidate
  )
  update public.project_tasks t
     set status = target.next_status,
         updated_at = now()
    from target
   where t.id = target.id
     and t.status <> target.next_status;

  get diagnostics v_changed = row_count;
  return v_changed;
end;
$function$;

comment on function public.refresh_task_readiness(uuid) is
  'blocked <-> ready según el estado de las dependencias. Devuelve cuántas tareas cambió.';


-- =====================================================================================
-- 02 · Propagación automática
-- =====================================================================================

create or replace function public.propagate_task_readiness()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  perform public.refresh_task_readiness(new.project_id);
  return null;
end;
$function$;

-- El filtro del WHEN es lo que evita la recursión: la función nunca escribe `approved`,
-- así que sus propias actualizaciones no vuelven a disparar el trigger.
drop trigger if exists trg_propagate_task_readiness on public.project_tasks;
create trigger trg_propagate_task_readiness
  after update of status on public.project_tasks
  for each row
  when (new.status is distinct from old.status
        and (new.status = 'approved' or old.status = 'approved'))
  execute function public.propagate_task_readiness();


-- =====================================================================================
-- 03 · apply_project_plan — persistencia transaccional del plan
-- =====================================================================================
-- Por qué una RPC y no N llamadas desde el cliente: supabase-js NO tiene transacciones
-- multi-sentencia. Persistir N tareas y M aristas por separado costaría 2+N+M idas y
-- vueltas y, si algo fallara a mitad, dejaría un DAG parcial en la base.
--
-- SECURITY INVOKER (el modo por defecto) a propósito: `service_role` bypassea RLS (es el
-- ProjectPlanner autónomo), pero un usuario autenticado queda sujeto a las políticas y por
-- tanto NO puede plantar un plan en un proyecto ajeno.
--
-- SEMÁNTICA DE REPLANIFICACIÓN
--   · El plan nuevo es autoritativo: SUSTITUYE todas las aristas del proyecto.
--   · Las tareas con proveedor asignado o con entregables NO se borran. Es deliberado:
--     un replan automático no destruye trabajo ya pagado.
--
-- Entrada:
--   p_tasks        : [{code,title,description,acceptance_criteria,required_skills,
--                      estimated_hours,budget,priority,order_index,depth,status}, …]
--   p_dependencies : [{task_code, depends_on_code, dependency_type?}, …]
-- Salida: {project_id, task_count, inserted_tasks, edge_count, task_ids:{code -> uuid}}

create or replace function public.apply_project_plan(
  p_project_id       uuid,
  p_tasks            jsonb,
  p_dependencies     jsonb default '[]'::jsonb,
  p_planner_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_owner        uuid;
  v_task_count   integer;
  v_edge_count   integer;
  v_code_count   integer;
  v_ids          jsonb;
begin
  if p_project_id is null then
    raise exception 'VEKTORA/PLANNER: p_project_id es obligatorio' using errcode = '22004';
  end if;

  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'VEKTORA/PLANNER: p_tasks debe ser un arreglo JSON no vacío'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_dependencies) <> 'array' then
    raise exception 'VEKTORA/PLANNER: p_dependencies debe ser un arreglo JSON'
      using errcode = '22023';
  end if;

  -- El proyecto tiene que existir Y ser visible para el invocante. Con RLS activo, un
  -- usuario sin acceso simplemente no lo encuentra.
  select owner_id into v_owner from public.projects where id = p_project_id;
  if v_owner is null then
    raise exception 'VEKTORA/PLANNER: proyecto % inexistente o sin acceso', p_project_id
      using errcode = '42501';
  end if;

  -- Códigos duplicados: se detecta aquí además de en Zod porque esta RPC también puede
  -- invocarse desde fuera del planificador.
  select count(distinct t->>'code'), count(*)
    into v_code_count, v_task_count
  from jsonb_array_elements(p_tasks) t;

  if v_code_count <> v_task_count then
    raise exception 'VEKTORA/PLANNER: hay códigos de tarea duplicados en p_tasks'
      using errcode = '23505';
  end if;

  -- Replanificación: se borra el DAG anterior. ON DELETE CASCADE de task_dependencies se
  -- encarga de las aristas. Se conservan las tareas ya asignadas o entregadas para no
  -- destruir trabajo en curso.
  delete from public.project_tasks t
   where t.project_id = p_project_id
     and t.assignee_id is null
     and t.status in ('blocked', 'ready', 'open', 'matching', 'cancelled', 'failed')
     and not exists (select 1 from public.deliverables d where d.task_id = t.id);

  -- --- Tareas ---
  insert into public.project_tasks (
    project_id, code, title, description, acceptance_criteria, required_skills,
    estimated_hours, budget, priority, order_index, depth, status
  )
  select
    p_project_id,
    t->>'code',
    t->>'title',
    nullif(t->>'description', ''),
    coalesce(t->'acceptance_criteria', '[]'::jsonb),
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(t->'required_skills')),
      '{}'::text[]
    ),
    nullif(t->>'estimated_hours', '')::numeric,
    nullif(t->>'budget', '')::numeric,
    coalesce(nullif(t->>'priority', '')::smallint, 3),
    coalesce(nullif(t->>'order_index', '')::integer, 0),
    coalesce(nullif(t->>'depth', '')::smallint, 0),
    coalesce(nullif(t->>'status', '')::public.task_status, 'blocked')
  from jsonb_array_elements(p_tasks) t
  on conflict (project_id, code) do update
    set title               = excluded.title,
        description         = excluded.description,
        acceptance_criteria = excluded.acceptance_criteria,
        required_skills     = excluded.required_skills,
        estimated_hours     = excluded.estimated_hours,
        budget              = excluded.budget,
        priority            = excluded.priority,
        order_index         = excluded.order_index,
        depth               = excluded.depth,
        updated_at          = now();

  -- --- Aristas ---
  -- Se reemplazan todas las del proyecto: el DAG nuevo manda.
  delete from public.task_dependencies d
   where d.task_id in (select id from public.project_tasks where project_id = p_project_id);

  insert into public.task_dependencies (task_id, depends_on_task_id, dependency_type, created_by)
  select
    child.id,
    parent.id,
    coalesce(nullif(e->>'dependency_type', '')::public.dependency_type, 'finish_to_start'),
    'ai_agent'
  from jsonb_array_elements(p_dependencies) e
  join public.project_tasks child
    on child.project_id = p_project_id and child.code = e->>'task_code'
  join public.project_tasks parent
    on parent.project_id = p_project_id and parent.code = e->>'depends_on_code'
  on conflict (task_id, depends_on_task_id) do nothing;

  select count(*) into v_edge_count
  from public.task_dependencies d
  join public.project_tasks t on t.id = d.task_id
  where t.project_id = p_project_id;

  -- --- Proyecto ---
  update public.projects
     set status           = case when status in ('draft', 'planning') then 'planned'
                                else status end,
         planner_metadata = coalesce(p_planner_metadata, '{}'::jsonb),
         dag_generated_at = now(),
         updated_at       = now()
   where id = p_project_id;

  -- Coherencia final: nadie debe quedar en 'blocked' sin dependencias.
  perform public.refresh_task_readiness(p_project_id);

  select jsonb_object_agg(code, id) into v_ids
  from public.project_tasks where project_id = p_project_id;

  return jsonb_build_object(
    'project_id', p_project_id,
    'task_count', (select count(*) from public.project_tasks where project_id = p_project_id),
    'inserted_tasks', v_task_count,
    'edge_count', v_edge_count,
    'task_ids', coalesce(v_ids, '{}'::jsonb)
  );
end;
$function$;

comment on function public.apply_project_plan(uuid, jsonb, jsonb, jsonb) is
  'Persiste un plan completo (tareas + aristas + metadatos) de forma atómica.';


-- =====================================================================================
-- 04 · register_skills — el catálogo crece solo
-- =====================================================================================
-- Requisito de autonomía: si el planificador necesita una skill que no está en el
-- catálogo, la añade en categoría `auto` en vez de esperar a que alguien la dé de alta.
-- Que esto falle no invalida un plan: `project_tasks.required_skills` es `text[]` y no
-- tiene FK contra `skills`.

create or replace function public.register_skills(p_slugs text[])
returns integer
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_inserted integer := 0;
begin
  if p_slugs is null or array_length(p_slugs, 1) is null then
    return 0;
  end if;

  insert into public.skills (slug, name, category)
  select distinct
    s,
    initcap(replace(s, '-', ' ')),
    'auto'
  from unnest(p_slugs) s
  where s is not null and s <> ''
  on conflict (slug) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$function$;

comment on function public.register_skills(text[]) is
  'Da de alta slugs de skill desconocidos en categoría auto. Idempotente.';


-- =====================================================================================
-- 05 · project_dag — lectura del grafo completo
-- =====================================================================================
-- Es una FUNCIÓN, no una vista: devuelve el grafo entero de un proyecto en UN jsonb
-- (tareas + aristas por código), que es lo que necesita el visualizador de la FASE 6 sin
-- hacer dos consultas y unirlas en el cliente.
--
--   select public.project_dag('<uuid>');
--   supabase.rpc('project_dag', { p_project_id: id })

create or replace function public.project_dag(p_project_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select jsonb_build_object(
    'project_id', p_project_id,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'code', t.code,
               'title', t.title,
               'status', t.status,
               'priority', t.priority,
               'depth', t.depth,
               'order_index', t.order_index,
               'estimated_hours', t.estimated_hours,
               'budget', t.budget,
               'required_skills', t.required_skills,
               'assignee_id', t.assignee_id,
               'has_embedding', t.embedding is not null
             ) order by t.order_index, t.code)
      from public.project_tasks t
      where t.project_id = p_project_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'task_code', child.code,
               'depends_on_code', parent.code,
               'dependency_type', d.dependency_type
             ) order by child.code, parent.code)
      from public.task_dependencies d
      join public.project_tasks child on child.id = d.task_id
      join public.project_tasks parent on parent.id = d.depends_on_task_id
      where child.project_id = p_project_id
    ), '[]'::jsonb)
  );
$function$;

comment on function public.project_dag(uuid) is
  'Grafo completo del proyecto como jsonb. STABLE y sin SECURITY DEFINER: respeta RLS.';


-- =====================================================================================
-- 06 · ENDURECIMIENTO DE PRIVILEGIOS
-- =====================================================================================
-- PostgreSQL concede EXECUTE a PUBLIC en toda función nueva, así que `revoke ... from
-- anon` no cierra nada: `anon` lo hereda de PUBLIC igualmente. Sin estas líneas, un
-- cliente con la clave anónima podía invocar `apply_project_plan` directamente.
--
-- `apply_project_plan` y `project_dag` respetan RLS (no son SECURITY DEFINER), así que
-- aunque se llamen no filtran nada; aun así no hay razón para exponer la superficie.
-- `refresh_task_readiness` y `register_skills` escriben, y quedan solo para service_role.

revoke all on function public.apply_project_plan(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_project_plan(uuid, jsonb, jsonb, jsonb)
  to authenticated, service_role;

revoke all on function public.project_dag(uuid) from public;
grant execute on function public.project_dag(uuid) to authenticated, service_role;

revoke all on function public.refresh_task_readiness(uuid) from public;
grant execute on function public.refresh_task_readiness(uuid) to service_role;

revoke all on function public.register_skills(text[]) from public;
grant execute on function public.register_skills(text[]) to service_role;

revoke all on function public.propagate_task_readiness() from public;
grant execute on function public.propagate_task_readiness() to service_role;


-- =====================================================================================
-- FIN — db/migrations/0002_planner.sql
-- Siguiente: db/seeds/01_skills.sql   ·   Verificación: npm run db:check
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/migrations/0003_provider_onboarding.sql
set search_path = public, extensions;

-- =====================================================================================
-- VEKTORA · FASE 3.5 — Onboarding de proveedores y catálogo vivo de skills
-- =====================================================================================
-- Aplicar DESPUÉS de db/migrations/0002_planner.sql. Idempotente.
--
-- PROBLEMA QUE RESUELVE
-- --------------------
-- Los proveedores se registran solos y declaran sus propias skills. Si cada uno inventa el
-- slug, el vocabulario se dispersa: `react`, `reactjs`, `react-18` y `React.js` son cuatro
-- filas distintas para la misma competencia. El planificador pide `react` en
-- `required_skills` y tres de cada cuatro proveedores dejan de ser emparejables — no por
-- falta de competencia, sino por ortografía. Con 500 proveedores el motor de la FASE 4
-- devuelve listas vacías y nadie entiende por qué.
--
-- SOLUCIÓN: NORMALIZACIÓN SEMÁNTICA
-- ---------------------------------
-- Se vectoriza el slug propuesto y se compara con el catálogo por distancia coseno. Si se
-- parece lo suficiente a una skill existente, se MAPEA a ella y el mapeo queda registrado
-- en `skill_aliases` para que la próxima vez sea una búsqueda exacta y gratis. Solo un
-- concepto genuinamente nuevo crea fila.
--
-- El vocabulario crece solo, sin moderación humana (regla 1 del proyecto), pero CONVERGE
-- en vez de dispersarse.
--
-- Contenido:
--   01 · `skills.embedding` + índice HNSW
--   02 · `skill_aliases` (traza auditable de cada mapeo)
--   03 · `normalize_skill_slug` — normalización léxica, la primera barrera
--   04 · `resolve_or_create_skill` — exacta -> alias -> semántica -> creación
--   05 · `upsert_provider_profile` y `set_provider_skills`
--   06 · RLS y privilegios
-- =====================================================================================

set search_path = public, extensions;


-- =====================================================================================
-- 01 · Vectorización del catálogo
-- =====================================================================================
-- Mismo tamaño y mismo modelo que `project_tasks.embedding` y
-- `provider_profiles.embedding`: los tres espacios tienen que ser comparables.

alter table public.skills
  add column if not exists embedding            vector(1536),
  add column if not exists embedding_model      text,
  add column if not exists embedding_updated_at timestamptz;

-- Parcial, como los otros dos: la consulta de resolución debe incluir
-- `where embedding is not null` y ordenar por `<=>` o no se usará el índice.
create index if not exists idx_skills_embedding_hnsw
  on public.skills using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where embedding is not null;


-- =====================================================================================
-- 02 · skill_aliases — memoria de los mapeos
-- =====================================================================================
-- Dos funciones: que la segunda vez que alguien escriba `reactjs` la resolución sea una
-- búsqueda exacta (sin gastar un embedding del free tier), y que cada decisión automática
-- quede auditada. En un sistema sin humanos, "por qué se mapeó esto así" tiene que poder
-- responderse.

create table if not exists public.skill_aliases (
  id         uuid primary key default uuid_generate_v4(),
  alias      citext not null unique,
  skill_id   uuid   not null references public.skills (id) on delete cascade,
  /** Similitud coseno que justificó el mapeo. NULL si fue un alias declarado a mano. */
  similarity numeric(6, 5),
  source     actor_type not null default 'ai_agent',
  created_at timestamptz not null default now(),
  constraint skill_aliases_similarity_range
    check (similarity is null or (similarity >= 0 and similarity <= 1))
);

create index if not exists idx_skill_aliases_skill on public.skill_aliases (skill_id);


-- =====================================================================================
-- 03 · normalize_skill_slug — la barrera barata
-- =====================================================================================
-- `React 18` y `react-18` tienen que colapsar ANTES de gastar un embedding. Esta función
-- resuelve la mayoría de los casos sin tocar la red.

create or replace function public.normalize_skill_slug(p_raw text)
returns text
language sql
immutable
as $function$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_raw, ''))), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g'
      ),
      '^-|-$', '', 'g'
    ),
    ''
  );
$function$;

comment on function public.normalize_skill_slug(text) is
  'Slug canónico: minúsculas, separadores colapsados a un guion, sin guiones al borde.';


-- =====================================================================================
-- 04 · resolve_or_create_skill — el corazón del catálogo vivo
-- =====================================================================================
-- Cascada de cuatro pasos, de más barato a más caro:
--   1. coincidencia EXACTA de slug        -> `exact`
--   2. alias ya registrado                -> `alias`
--   3. vecino más cercano sobre el umbral -> `semantic`  (y se guarda el alias)
--   4. nada se parece                     -> `created`   (categoría `auto`)
--
-- SECURITY DEFINER a propósito: un proveedor autenticado NO tiene INSERT sobre
-- `public.skills` (lo impide `skills_write_admin`), y no debe tenerlo — podría escribir
-- cualquier cosa en el catálogo. Pero sí puede ampliarlo A TRAVÉS DE ESTA FUNCIÓN, que
-- normaliza, deduplica y deja traza. Es la diferencia entre dar permiso y dar un camino.
--
-- `p_embedding` viaja como TEXTO (el literal de pgvector) porque PostgREST no sabe
-- serializar el tipo `vector`. Si llega NULL se salta el paso semántico: el sistema
-- degrada a exacto+alias+creación en vez de fallar.

create or replace function public.resolve_or_create_skill(
  p_slug      text,
  p_name      text    default null,
  p_embedding text    default null,
  p_threshold numeric default 0.82
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_slug       text;
  v_skill      public.skills%rowtype;
  v_similarity numeric;
  v_vector     vector(1536);
  -- El vecino semántico se recoge en escalares y no en el %rowtype: PL/pgSQL no admite
  -- una variable de registro dentro de un INTO con varios destinos (SQLSTATE 42601), y la
  -- consulta necesita traer la similitud calculada junto a las columnas.
  v_near_id       uuid;
  v_near_slug     citext;
  v_near_name     text;
  v_near_category text;
begin
  v_slug := public.normalize_skill_slug(p_slug);
  if v_slug is null then
    raise exception 'VEKTORA/SKILLS: el slug propuesto queda vacío tras normalizar (%)', p_slug
      using errcode = '22023';
  end if;

  -- 1) Coincidencia exacta.
  select * into v_skill from public.skills where slug = v_slug limit 1;
  if found then
    return jsonb_build_object(
      'skill_id', v_skill.id, 'slug', v_skill.slug::text, 'name', v_skill.name,
      'category', v_skill.category, 'match', 'exact', 'similarity', 1.0
    );
  end if;

  -- 2) Alias ya conocido: la segunda vez que alguien escribe `reactjs` no cuesta nada.
  select s.* into v_skill
  from public.skill_aliases a
  join public.skills s on s.id = a.skill_id
  where a.alias = v_slug
  limit 1;
  if found then
    return jsonb_build_object(
      'skill_id', v_skill.id, 'slug', v_skill.slug::text, 'name', v_skill.name,
      'category', v_skill.category, 'match', 'alias', 'similarity', null
    );
  end if;

  -- 3) Vecino más cercano por distancia coseno.
  if p_embedding is not null and btrim(p_embedding) <> '' then
    begin
      v_vector := p_embedding::vector(1536);
    exception when others then
      raise exception 'VEKTORA/SKILLS: p_embedding no es un literal vector(1536) válido'
        using errcode = '22023';
    end;

    select s.id, s.slug, s.name, s.category, 1 - (s.embedding <=> v_vector)
      into v_near_id, v_near_slug, v_near_name, v_near_category, v_similarity
    from public.skills s
    where s.embedding is not null
      and s.is_active
    order by s.embedding <=> v_vector
    limit 1;

    if v_near_id is not null and v_similarity >= p_threshold then
      insert into public.skill_aliases (alias, skill_id, similarity)
      values (v_slug, v_near_id, round(v_similarity, 5))
      on conflict (alias) do nothing;

      return jsonb_build_object(
        'skill_id', v_near_id, 'slug', v_near_slug::text, 'name', v_near_name,
        'category', v_near_category, 'match', 'semantic',
        'similarity', round(v_similarity, 5)
      );
    end if;
  end if;

  -- 4) Concepto nuevo de verdad.
  insert into public.skills (slug, name, category, embedding)
  values (
    v_slug,
    coalesce(nullif(btrim(p_name), ''), initcap(replace(v_slug, '-', ' '))),
    'auto',
    v_vector
  )
  on conflict (slug) do update set name = excluded.name   -- carrera entre dos altas
  returning * into v_skill;

  return jsonb_build_object(
    'skill_id', v_skill.id, 'slug', v_skill.slug::text, 'name', v_skill.name,
    'category', v_skill.category, 'match', 'created',
    'similarity', case when v_similarity is null then null else round(v_similarity, 5) end
  );
end;
$function$;

comment on function public.resolve_or_create_skill(text, text, text, numeric) is
  'Resuelve un slug propuesto contra el catálogo: exacta -> alias -> semántica -> creación.';


-- =====================================================================================
-- 05 · Alta y actualización del proveedor
-- =====================================================================================

-- SECURITY INVOKER (por defecto): `service_role` pasa por encima de RLS, pero un usuario
-- autenticado queda sujeto a `provider_profiles_insert_self` / `_update_self`, así que no
-- puede crear ni tocar el perfil de otro. Cuando llegue la UI de la FASE 6, la misma
-- función sirve sin cambiar una línea.
create or replace function public.upsert_provider_profile(
  p_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'VEKTORA/PROVIDER: p_user_id es obligatorio' using errcode = '22004';
  end if;

  insert into public.provider_profiles as pp (
    user_id, headline, summary, seniority, hourly_rate_usd, min_task_budget_usd,
    availability_hours_week, languages, timezone, is_active, accepts_auto_assign
  )
  values (
    p_user_id,
    nullif(btrim(coalesce(p_payload ->> 'headline', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'summary', '')), ''),
    nullif(btrim(coalesce(p_payload ->> 'seniority', '')), ''),
    nullif(p_payload ->> 'hourly_rate_usd', '')::numeric,
    nullif(p_payload ->> 'min_task_budget_usd', '')::numeric,
    nullif(p_payload ->> 'availability_hours_week', '')::integer,
    coalesce(
      (select array_agg(value::text) from jsonb_array_elements_text(p_payload -> 'languages')),
      '{}'::text[]
    ),
    nullif(btrim(coalesce(p_payload ->> 'timezone', '')), ''),
    coalesce(nullif(p_payload ->> 'is_active', '')::boolean, true),
    coalesce(nullif(p_payload ->> 'accepts_auto_assign', '')::boolean, true)
  )
  on conflict (user_id) do update
    -- `coalesce(excluded.x, pp.x)`: un campo ausente en el payload NO borra lo que ya
    -- había. Una actualización parcial no debe vaciar el perfil.
    set headline                = coalesce(excluded.headline, pp.headline),
        summary                 = coalesce(excluded.summary, pp.summary),
        seniority               = coalesce(excluded.seniority, pp.seniority),
        hourly_rate_usd         = coalesce(excluded.hourly_rate_usd, pp.hourly_rate_usd),
        min_task_budget_usd     = coalesce(excluded.min_task_budget_usd, pp.min_task_budget_usd),
        availability_hours_week = coalesce(excluded.availability_hours_week,
                                           pp.availability_hours_week),
        languages               = case when array_length(excluded.languages, 1) is null
                                       then pp.languages else excluded.languages end,
        timezone                = coalesce(excluded.timezone, pp.timezone),
        is_active               = excluded.is_active,
        accepts_auto_assign     = excluded.accepts_auto_assign,
        updated_at              = now()
  returning pp.id into v_id;

  return v_id;
end;
$function$;

comment on function public.upsert_provider_profile(uuid, jsonb) is
  'Alta o actualización parcial del perfil de proveedor. Respeta RLS (SECURITY INVOKER).';


-- Reemplaza el conjunto de skills del proveedor. Es un `set`, no un `add`: quitar una
-- skill del payload la desvincula, que es la semántica que espera un formulario de perfil.
create or replace function public.set_provider_skills(
  p_provider_profile_id uuid,
  p_skills              jsonb
)
returns integer
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_count integer := 0;
  v_ids   uuid[];
begin
  if jsonb_typeof(coalesce(p_skills, '[]'::jsonb)) <> 'array' then
    raise exception 'VEKTORA/PROVIDER: p_skills debe ser un arreglo JSON' using errcode = '22023';
  end if;

  select array_agg((s ->> 'skill_id')::uuid)
    into v_ids
  from jsonb_array_elements(p_skills) s
  where s ->> 'skill_id' is not null;

  delete from public.provider_skills ps
   where ps.provider_profile_id = p_provider_profile_id
     and (v_ids is null or not (ps.skill_id = any (v_ids)));

  insert into public.provider_skills (provider_profile_id, skill_id, level, years_experience)
  select
    p_provider_profile_id,
    (s ->> 'skill_id')::uuid,
    coalesce(nullif(s ->> 'level', '')::smallint, 3),
    nullif(s ->> 'years_experience', '')::numeric
  from jsonb_array_elements(coalesce(p_skills, '[]'::jsonb)) s
  where s ->> 'skill_id' is not null
  on conflict (provider_profile_id, skill_id) do update
    set level            = excluded.level,
        years_experience = excluded.years_experience;

  select count(*) into v_count
  from public.provider_skills
  where provider_profile_id = p_provider_profile_id;

  return v_count;
end;
$function$;

comment on function public.set_provider_skills(uuid, jsonb) is
  'Reemplaza el conjunto de skills del proveedor. Respeta RLS (SECURITY INVOKER).';


-- =====================================================================================
-- 06 · RLS Y PRIVILEGIOS
-- =====================================================================================

alter table public.skill_aliases enable row level security;

-- Lectura pública: saber que `reactjs` apunta a `react` no revela nada y hace explicable
-- el comportamiento del matching. Escritura, solo por `resolve_or_create_skill`.
drop policy if exists skill_aliases_select_all on public.skill_aliases;
create policy skill_aliases_select_all on public.skill_aliases
  for select to anon, authenticated using (true);

grant select on public.skill_aliases to anon, authenticated;
grant all    on public.skill_aliases to service_role;

-- Misma trampa de siempre: toda función nueva nace con EXECUTE para PUBLIC, así que hay
-- que revocar de PUBLIC y conceder explícitamente.
revoke all on function public.normalize_skill_slug(text) from public;
grant execute on function public.normalize_skill_slug(text)
  to anon, authenticated, service_role;

revoke all on function public.resolve_or_create_skill(text, text, text, numeric) from public;
grant execute on function public.resolve_or_create_skill(text, text, text, numeric)
  to authenticated, service_role;

revoke all on function public.upsert_provider_profile(uuid, jsonb) from public;
grant execute on function public.upsert_provider_profile(uuid, jsonb)
  to authenticated, service_role;

revoke all on function public.set_provider_skills(uuid, jsonb) from public;
grant execute on function public.set_provider_skills(uuid, jsonb)
  to authenticated, service_role;


-- =====================================================================================
-- FIN — db/migrations/0003_provider_onboarding.sql
--
-- Después de aplicarla, vectorizar el catálogo una vez:
--     npm run skills:embed
-- Sin eso, el paso 3 (semántico) se salta y la resolución degrada a exacta + alias.
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/migrations/0004_matching.sql
set search_path = public, extensions;

-- =====================================================================================
-- VEKTORA · FASE 4 — Motor de matching híbrido
-- =====================================================================================
-- Aplicar DESPUÉS de db/migrations/0003_provider_onboarding.sql. Idempotente.
--
-- REPARTO DE RESPONSABILIDADES
-- ---------------------------
-- La base hace lo que SOLO la base puede hacer: la búsqueda aproximada de vecinos sobre
-- `provider_profiles.embedding` con el índice HNSW. Nada más.
--
-- El peso de cada componente, la fórmula del `match_score` y la explicación viven en
-- TypeScript (`lib/matching/scoring.ts`), porque son POLÍTICA: cambian con el producto y
-- hay que poder probarlas exhaustivamente sin base de datos. Enterrar la fórmula en una
-- función SQL la volvería intocable y no testeable.
--
-- Contenido:
--   01 · `match_task_candidates` — recuperación de candidatos (ANN + filtros duros)
--   02 · `apply_task_matches`    — persistencia atómica en `task_applications`
--   03 · `accept_task_application` — adjudicación atómica
--   04 · Privilegios
-- =====================================================================================

set search_path = public, extensions;


-- =====================================================================================
-- 01 · match_task_candidates — recuperación
-- =====================================================================================
-- Devuelve los candidatos con TODO lo que el ranking necesita, sin puntuar nada.
--
-- Dos ramas unidas:
--   A) Vecinos por embedding. El `order by embedding <=> …` con `where embedding is not
--      null` es exactamente la forma que exige el índice HNSW parcial; cualquier otra
--      escritura de la distancia provoca un seq scan de toda la tabla. Se sobre-recupera
--      (`p_limit * 4`) ANTES de aplicar los filtros duros, porque el índice ordena por
--      distancia y no sabe nada de disponibilidad ni de presupuesto.
--   B) Proveedores SIN embedding. Entran igual, con `vector_similarity` nula, para que el
--      ranking determinista pueda considerarlos. Sin esta rama, un proveedor recién dado
--      de alta cuya vectorización falló sería invisible para siempre.
--
-- Filtros DUROS (no son puntuación, son elegibilidad):
--   · perfil activo
--   · `accepts_auto_assign` cuando el matching es automático — consentimiento explícito
--   · el dueño del proyecto no puede ser proveedor de su propia tarea
--   · `min_task_budget_usd` por encima del presupuesto de la tarea: no le interesa
--   · quien ya tiene una candidatura resuelta (aceptada, rechazada o retirada) no vuelve
--     a proponerse; las `pending` sí se refrescan

create or replace function public.match_task_candidates(
  p_task_id             uuid,
  p_limit               integer default 20,
  p_require_auto_assign boolean default true
)
returns table (
  provider_profile_id     uuid,
  user_id                 uuid,
  headline                text,
  seniority               text,
  hourly_rate_usd         numeric,
  min_task_budget_usd     numeric,
  availability_hours_week integer,
  reputation_score        numeric,
  tasks_completed         integer,
  tasks_failed            integer,
  avg_rating              numeric,
  on_time_rate            numeric,
  accepts_auto_assign     boolean,
  vector_similarity       numeric,
  skill_slugs             text[],
  skill_levels            integer[]
)
language plpgsql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_task_embedding vector(1536);
  v_project_owner  uuid;
  v_budget         numeric;
  v_overfetch      integer := greatest(p_limit * 4, 40);
begin
  select t.embedding, p.owner_id, t.budget
    into v_task_embedding, v_project_owner, v_budget
  from public.project_tasks t
  join public.projects p on p.id = t.project_id
  where t.id = p_task_id;

  if not found then
    raise exception 'VEKTORA/MATCH: la tarea % no existe o no es accesible', p_task_id
      using errcode = '42501';
  end if;

  return query
  with ann as (
    -- Rama A: vecinos más cercanos. Esta forma exacta es la que usa el índice HNSW.
    select
      pp.id                                as pid,
      (1 - (pp.embedding <=> v_task_embedding))::numeric as similarity
    from public.provider_profiles pp
    where pp.embedding is not null
      and v_task_embedding is not null
    order by pp.embedding <=> v_task_embedding
    limit v_overfetch
  ),
  candidates as (
    select pp.id as pid, ann.similarity
    from public.provider_profiles pp
    join ann on ann.pid = pp.id
    union
    -- Rama B: sin embedding, para que el ranking determinista pueda considerarlos.
    select pp.id, null::numeric
    from public.provider_profiles pp
    where pp.embedding is null
  )
  select
    pp.id,
    pp.user_id,
    pp.headline,
    pp.seniority,
    pp.hourly_rate_usd,
    pp.min_task_budget_usd,
    pp.availability_hours_week,
    pp.reputation_score,
    pp.tasks_completed,
    pp.tasks_failed,
    pp.avg_rating,
    pp.on_time_rate,
    pp.accepts_auto_assign,
    c.similarity,
    coalesce(agg.slugs,  '{}'::text[]),
    coalesce(agg.levels, '{}'::integer[])
  from candidates c
  join public.provider_profiles pp on pp.id = c.pid
  left join lateral (
    select
      array_agg(s.slug::text order by s.slug) as slugs,
      array_agg(ps.level::integer order by s.slug) as levels
    from public.provider_skills ps
    join public.skills s on s.id = ps.skill_id
    where ps.provider_profile_id = pp.id
  ) agg on true
  where pp.is_active
    and (not p_require_auto_assign or pp.accepts_auto_assign)
    and pp.user_id <> v_project_owner
    and (v_budget is null
         or pp.min_task_budget_usd is null
         or pp.min_task_budget_usd <= v_budget)
    and not exists (
      select 1 from public.task_applications a
      where a.task_id = p_task_id
        and a.provider_id = pp.user_id
        and a.status in ('accepted', 'rejected', 'withdrawn', 'expired')
    )
  order by c.similarity desc nulls last, pp.reputation_score desc
  limit p_limit;
end;
$function$;

comment on function public.match_task_candidates(uuid, integer, boolean) is
  'Candidatos elegibles para una tarea: ANN sobre el HNSW + filtros duros. No puntúa.';


-- =====================================================================================
-- 02 · apply_task_matches — persistencia atómica
-- =====================================================================================
-- Igual que `apply_project_plan`: supabase-js no tiene transacciones multi-sentencia, y
-- N candidaturas insertadas por separado dejarían un shortlist a medias si algo falla.
--
-- `on conflict (task_id, provider_id) do update` refresca la puntuación de una candidatura
-- pendiente en vez de duplicarla: un replan vuelve a evaluar a los mismos proveedores.
-- Las candidaturas ya resueltas NO se tocan.
--
-- Entrada: [{provider_id, vector_score, skill_score, reputation_score, match_score,
--            match_explanation}, …]

create or replace function public.apply_task_matches(
  p_task_id uuid,
  p_matches jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_task     public.project_tasks%rowtype;
  v_inserted integer := 0;
begin
  if jsonb_typeof(coalesce(p_matches, '[]'::jsonb)) <> 'array' then
    raise exception 'VEKTORA/MATCH: p_matches debe ser un arreglo JSON' using errcode = '22023';
  end if;

  select * into v_task from public.project_tasks where id = p_task_id;
  if not found then
    raise exception 'VEKTORA/MATCH: la tarea % no existe o no es accesible', p_task_id
      using errcode = '42501';
  end if;

  if v_task.assignee_id is not null then
    raise exception 'VEKTORA/MATCH: la tarea % ya está asignada', p_task_id
      using errcode = '22023';
  end if;

  insert into public.task_applications as ta (
    task_id, provider_id, status, is_auto_generated,
    vector_score, skill_score, reputation_score, match_score, match_explanation
  )
  select
    p_task_id,
    (m ->> 'provider_id')::uuid,
    'pending',
    true,
    nullif(m ->> 'vector_score', '')::numeric,
    nullif(m ->> 'skill_score', '')::numeric,
    nullif(m ->> 'reputation_score', '')::numeric,
    nullif(m ->> 'match_score', '')::numeric,
    coalesce(m -> 'match_explanation', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_matches, '[]'::jsonb)) m
  where m ->> 'provider_id' is not null
  on conflict (task_id, provider_id) do update
    set vector_score      = excluded.vector_score,
        skill_score       = excluded.skill_score,
        reputation_score  = excluded.reputation_score,
        match_score       = excluded.match_score,
        match_explanation = excluded.match_explanation,
        is_auto_generated = true,
        updated_at        = now()
    -- Una candidatura ya resuelta no se reabre por un recálculo.
    where ta.status = 'pending';

  get diagnostics v_inserted = row_count;

  -- La tarea pasa a `matching` solo si estaba esperando: no se pisa un estado avanzado.
  if v_inserted > 0 and v_task.status in ('ready', 'open') then
    update public.project_tasks
       set status = 'matching', updated_at = now()
     where id = p_task_id;
  end if;

  return jsonb_build_object(
    'task_id', p_task_id,
    'written', v_inserted,
    'total_applications', (select count(*) from public.task_applications where task_id = p_task_id)
  );
end;
$function$;

comment on function public.apply_task_matches(uuid, jsonb) is
  'Escribe el shortlist en task_applications de forma atómica. No reabre candidaturas resueltas.';


-- =====================================================================================
-- 03 · accept_task_application — adjudicación atómica
-- =====================================================================================
-- Sin esto el DAG no avanza: alguien tiene que pasar de "hay candidatos" a "esta persona
-- lo hace". Tres escrituras que deben ocurrir juntas o ninguna: la candidatura aceptada,
-- el resto rechazadas, y la tarea asignada.
--
-- `for update` sobre la tarea serializa dos adjudicaciones simultáneas: la segunda
-- encuentra `assignee_id` ya puesto y falla en vez de pisar a la primera.

create or replace function public.accept_task_application(
  p_application_id uuid
)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_app  public.task_applications%rowtype;
  v_task public.project_tasks%rowtype;
begin
  select * into v_app from public.task_applications where id = p_application_id;
  if not found then
    raise exception 'VEKTORA/MATCH: la candidatura % no existe o no es accesible', p_application_id
      using errcode = '42501';
  end if;

  select * into v_task from public.project_tasks where id = v_app.task_id for update;
  if not found then
    raise exception 'VEKTORA/MATCH: la tarea de la candidatura no existe' using errcode = '42501';
  end if;

  if v_task.assignee_id is not null then
    raise exception 'VEKTORA/MATCH: la tarea % ya está asignada a %', v_task.id, v_task.assignee_id
      using errcode = '23505';
  end if;

  update public.task_applications
     set status = 'accepted', decided_at = now(), updated_at = now()
   where id = p_application_id;

  update public.task_applications
     set status = 'rejected', decided_at = now(), updated_at = now()
   where task_id = v_app.task_id
     and id <> p_application_id
     and status in ('pending', 'shortlisted');

  update public.project_tasks
     set assignee_id = v_app.provider_id,
         status      = 'assigned',
         assigned_at = now(),
         updated_at  = now()
   where id = v_app.task_id;

  return jsonb_build_object(
    'task_id', v_app.task_id,
    'application_id', p_application_id,
    'provider_id', v_app.provider_id,
    'status', 'assigned'
  );
end;
$function$;

comment on function public.accept_task_application(uuid) is
  'Adjudica la tarea: acepta una candidatura, rechaza el resto y asigna. Todo o nada.';


-- =====================================================================================
-- 03.5 · skill_similarity_pairs — calibración del umbral semántico
-- =====================================================================================
-- Diagnóstico, no runtime. Devuelve la similitud entre pares de skills del catálogo para
-- poder ELEGIR `VEKTORA_SKILL_MATCH_THRESHOLD` y la recalibración del componente vectorial
-- con evidencia en vez de por intuición.
--
-- Hace falta porque los embeddings de `gemini-embedding-001` tienen el rango dinámico
-- comprimido: casi todo cae alto, y un umbral elegido a ojo agrupa de más o de menos sin
-- que se note hasta que el matching empieza a devolver listas vacías o absurdas.
--
-- Los embeddings ya están en la base, así que esto no gasta cuota de la API.

create or replace function public.skill_similarity_pairs(
  p_min   numeric default 0,
  p_limit integer default 200
)
returns table (slug_a text, slug_b text, similarity numeric)
language sql
stable
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select
    a.slug::text,
    b.slug::text,
    round((1 - (a.embedding <=> b.embedding))::numeric, 5)
  from public.skills a
  join public.skills b
    -- `a.slug < b.slug` evita el par consigo mismo y los duplicados simétricos.
    on a.slug < b.slug
  where a.embedding is not null
    and b.embedding is not null
    and a.is_active and b.is_active
    and (1 - (a.embedding <=> b.embedding)) >= p_min
  order by 3 desc
  limit p_limit;
$function$;

comment on function public.skill_similarity_pairs(numeric, integer) is
  'Pares de skills con su similitud coseno. Diagnóstico para calibrar umbrales.';


-- =====================================================================================
-- 04 · PRIVILEGIOS
-- =====================================================================================
-- Misma trampa de siempre: toda función nueva nace con EXECUTE para PUBLIC.
--
-- `match_task_candidates` es STABLE y sin SECURITY DEFINER: respeta RLS, así que un
-- usuario autenticado solo obtiene candidatos de una tarea que puede ver.

revoke all on function public.match_task_candidates(uuid, integer, boolean) from public;
grant execute on function public.match_task_candidates(uuid, integer, boolean)
  to authenticated, service_role;

revoke all on function public.apply_task_matches(uuid, jsonb) from public;
grant execute on function public.apply_task_matches(uuid, jsonb) to service_role;

revoke all on function public.accept_task_application(uuid) from public;
grant execute on function public.accept_task_application(uuid)
  to authenticated, service_role;

revoke all on function public.skill_similarity_pairs(numeric, integer) from public;
grant execute on function public.skill_similarity_pairs(numeric, integer)
  to authenticated, service_role;


-- =====================================================================================
-- FIN — db/migrations/0004_matching.sql
-- Verificación: db/verify/03_matching.sql   ·   Uso: npm run match -- <task_id>
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/migrations/0005_qa.sql
set search_path = public, extensions;

-- =========================================================================================
-- VEKTORA · FASE 5 — Agente autónomo de QA (AI Judge)
-- =========================================================================================
-- Depende de: db/schema.sql, db/migrations/0002_planner.sql
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- Igual que en la FASE 4, aquí vive SOLO lo que únicamente la base puede hacer:
-- tomar el turno sin carreras y escribir el veredicto entero en una transacción. El
-- criterio —qué puntuación aprueba, cuánta reputación se mueve, cuántos rechazos agotan
-- una tarea— es política de producto y vive en `lib/qa/policy.ts`, que es puro y testeable.
--
-- Tres invariantes que esta migración defiende y el código de aplicación no podría:
--
--   1. UN SOLO JUEZ POR ENTREGABLE A LA VEZ. `claim_deliverable_for_qa` toma el turno con
--      `for update` y mueve `qa_status` a 'running'. Dos procesos concurrentes no pueden
--      juzgar el mismo entregable ni cobrar dos veces la reputación.
--
--   2. UN VEREDICTO YA EMITIDO NO SE REESCRIBE. Solo se juzga desde
--      ('pending', 'revision_requested', 'error'). Un entregable 'approved' es terminal:
--      sin esto, reejecutar el juez sobre trabajo ya aprobado podría revocarlo solo porque
--      el modelo tuvo un mal día.
--
--   3. LA REPUTACIÓN NO SE COBRA DOS VECES. `reputation_events` es append-only (no se puede
--      borrar ni corregir), así que el guardia es previo: no se inserta un `event_type` que
--      ese entregable ya generó. Si un veredicto posterior contradice a otro, se AÑADE el
--      evento contrario en vez de borrar el anterior; el saldo se reconstruye sumando, que
--      es justo lo que un libro mayor debe permitir.
-- =========================================================================================

-- =========================================================================================
-- 01 · claim_deliverable_for_qa — tomar el turno y devolver todo lo que el juez necesita
-- =========================================================================================
-- Una sola ida y vuelta: bloquea, marca 'running' y devuelve entregable + tarea + criterios
-- + proyecto. Partirlo en "leer" y luego "marcar" abriría exactamente la carrera que esta
-- función existe para cerrar.
create or replace function public.claim_deliverable_for_qa(p_deliverable_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current public.qa_status;
  v_result  jsonb;
begin
  select d.qa_status into v_current
    from public.deliverables d
   where d.id = p_deliverable_id
   for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no existe ningún entregable con ese id'
    );
  end if;

  if v_current not in ('pending', 'revision_requested', 'error') then
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
          else 'no admite juicio automático'
        end
      )
    );
  end if;

  update public.deliverables
     set qa_status  = 'running',
         updated_at = now()
   where id = p_deliverable_id;

  select jsonb_build_object(
    'claimed', true,
    'previous_status', v_current,
    'deliverable', jsonb_build_object(
      'id',           d.id,
      'task_id',      d.task_id,
      'provider_id',  d.provider_id,
      'version',      d.version,
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
    -- Rechazos previos de ESTA tarea. La política de escalado los necesita: rechazar para
    -- siempre al primer intento sería tan malo como no rechazar nunca.
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
-- 02 · release_deliverable_qa — devolver el turno sin veredicto
-- =========================================================================================
-- Cuando la IA no responde, el entregable NO se rechaza: se deja en 'error'. Rechazar a un
-- proveedor porque se cayó un proveedor de modelos sería castigarlo por nuestra
-- infraestructura, y 'error' es además uno de los estados en los que la RLS le permite
-- volver a editar y reintentar.
create or replace function public.release_deliverable_qa(
  p_deliverable_id uuid,
  p_status         public.qa_status default 'error',
  p_error          text default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows integer;
begin
  update public.deliverables d
     set qa_status  = p_status,
         qa_feedback = case
           when p_error is null then d.qa_feedback
           else d.qa_feedback || jsonb_build_object(
             'last_error', p_error,
             'last_error_at', to_jsonb(now())
           )
         end,
         updated_at = now()
   where d.id = p_deliverable_id
     and d.qa_status = 'running';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;


-- =========================================================================================
-- 03 · apply_qa_verdict — el veredicto entero, en una transacción
-- =========================================================================================
-- Escribe cinco cosas que deben ocurrir juntas o no ocurrir: el veredicto en el entregable,
-- la reseña automática, los eventos de reputación, el estado de la tarea y —vía el trigger
-- `trg_propagate_task_readiness` de la 0002— el desbloqueo de las tareas que dependían de
-- ella. Hacerlo desde el cliente serían cinco viajes sin transacción: un fallo a mitad
-- dejaría una tarea aprobada sin reseña, o reputación cobrada por trabajo no aprobado.
--
-- `p_reputation` es un array de {event_type, delta, weight, reason}. Los importes los decide
-- `lib/qa/policy.ts`: son política, no esquema.
create or replace function public.apply_qa_verdict(
  p_deliverable_id      uuid,
  p_qa_status           public.qa_status,
  p_qa_score            numeric,
  p_qa_feedback         jsonb,
  p_qa_criteria_results jsonb,
  p_task_status         public.task_status,
  p_rating              numeric,
  p_qa_run_id           uuid    default null,
  p_quality_score       numeric default null,
  p_timeliness_score    numeric default null,
  p_comment             text    default null,
  p_reputation          jsonb   default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task_id      uuid;
  v_provider_id  uuid;
  v_review_id    uuid;
  v_event        jsonb;
  v_event_type   public.reputation_event_type;
  v_written      integer := 0;
  v_skipped      text[]  := array[]::text[];
begin
  if p_qa_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'VEKTORA/QA: apply_qa_verdict no admite qa_status=%', p_qa_status
      using errcode = '22023';
  end if;

  -- Solo se aplica sobre un turno realmente tomado. Si otro proceso ya resolvió este
  -- entregable, aquí no se pisa nada: se informa y se sale.
  update public.deliverables d
     set qa_status           = p_qa_status,
         qa_score            = p_qa_score,
         qa_feedback         = coalesce(p_qa_feedback, '{}'::jsonb),
         qa_criteria_results = coalesce(p_qa_criteria_results, '[]'::jsonb),
         qa_run_id           = p_qa_run_id,
         qa_evaluated_at     = now(),
         updated_at          = now()
   where d.id = p_deliverable_id
     and d.qa_status = 'running'
  returning d.task_id, d.provider_id into v_task_id, v_provider_id;

  if v_task_id is null then
    return jsonb_build_object(
      'applied', false,
      'reason', 'el entregable no estaba en qa_status=running: otro proceso lo resolvió antes'
    );
  end if;

  -- --- Reseña automática ---------------------------------------------------------------
  -- `reviewer_id` nulo es la firma del juez automático, y el índice único parcial
  -- `reviews_unique_machine` garantiza UNA sola por (tarea, evaluado, fuente). Reevaluar un
  -- entregable posterior de la misma tarea ACTUALIZA esa reseña en vez de acumular otra.
  insert into public.reviews (
    task_id, deliverable_id, reviewer_id, reviewee_id, source,
    rating, quality_score, timeliness_score, comment, is_public
  )
  values (
    v_task_id, p_deliverable_id, null, v_provider_id, 'ai_judge',
    p_rating, p_quality_score, p_timeliness_score, p_comment, true
  )
  on conflict (task_id, reviewee_id, source) where reviewer_id is null
  do update set
    deliverable_id   = excluded.deliverable_id,
    rating           = excluded.rating,
    quality_score    = excluded.quality_score,
    timeliness_score = excluded.timeliness_score,
    comment          = excluded.comment,
    updated_at       = now()
  returning id into v_review_id;

  -- --- Reputación ----------------------------------------------------------------------
  -- Guardia de idempotencia ANTES del insert, porque después no hay vuelta atrás: la tabla
  -- es append-only y ni siquiera un superusuario puede corregir la fila.
  for v_event in select * from jsonb_array_elements(coalesce(p_reputation, '[]'::jsonb))
  loop
    v_event_type := (v_event ->> 'event_type')::public.reputation_event_type;

    if exists (
      select 1
        from public.reputation_events re
       where re.deliverable_id = p_deliverable_id
         and re.event_type = v_event_type
    ) then
      v_skipped := v_skipped || v_event_type::text;
      continue;
    end if;

    insert into public.reputation_events (
      user_id, event_type, delta, weight, reason,
      task_id, deliverable_id, review_id, actor_type, metadata
    )
    values (
      v_provider_id,
      v_event_type,
      coalesce((v_event ->> 'delta')::numeric, 0),
      coalesce((v_event ->> 'weight')::numeric, 1),
      v_event ->> 'reason',
      v_task_id,
      p_deliverable_id,
      v_review_id,
      'ai_agent',
      coalesce(v_event -> 'metadata', '{}'::jsonb)
    );
    v_written := v_written + 1;
  end loop;

  -- --- Estado de la tarea --------------------------------------------------------------
  -- Pasar a 'approved' dispara `trg_propagate_task_readiness`, que recalcula qué tareas
  -- aguas abajo quedan listas. Ahí es donde el DAG avanza solo.
  update public.project_tasks t
     set status     = p_task_status,
         updated_at = now()
   where t.id = v_task_id
     and t.status is distinct from p_task_status;

  return jsonb_build_object(
    'applied',             true,
    'deliverable_id',      p_deliverable_id,
    'task_id',             v_task_id,
    'provider_id',         v_provider_id,
    'review_id',           v_review_id,
    'qa_status',           p_qa_status,
    'task_status',         p_task_status,
    'reputation_written',  v_written,
    'reputation_skipped',  to_jsonb(v_skipped)
  );
end;
$function$;


-- =========================================================================================
-- 04 · pending_qa_deliverables — la cola del juez
-- =========================================================================================
-- Más antiguo primero: sin orden estable, un entregable desafortunado podría esperar para
-- siempre mientras llegan otros. Usa `idx_deliverables_pending` (parcial sobre
-- submitted_at where qa_status in ('pending','running')).
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
  where d.qa_status in ('pending', 'revision_requested', 'error')
  order by d.submitted_at asc
  limit greatest(1, coalesce(p_limit, 20));
$function$;


-- =========================================================================================
-- 05 · Privilegios
-- =========================================================================================
-- PostgreSQL concede EXECUTE a PUBLIC en cada función nueva, así que `revoke ... from anon`
-- no basta: hay que revocar a PUBLIC y luego conceder explícitamente. Estas cuatro las
-- ejecuta el juez con `service_role`, que no necesita GRANT porque bypassea RLS; ningún
-- rol de cliente debe poder emitir un veredicto ni mover reputación.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.claim_deliverable_for_qa(uuid)',
    'public.release_deliverable_qa(uuid, public.qa_status, text)',
    'public.apply_qa_verdict(uuid, public.qa_status, numeric, jsonb, jsonb, public.task_status, numeric, uuid, numeric, numeric, text, jsonb)',
    'public.pending_qa_deliverables(integer)'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated', v_fn);
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/migrations/0007_escalada.sql
set search_path = public, extensions;

-- =========================================================================================
-- VEKTORA · FASE 7 — Escalada del emparejamiento y cuotas de uso
-- =========================================================================================
-- Depende de: db/schema.sql y las migraciones 0002 a 0005.
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- Resuelve dos formas de romper el sistema que no producen ningún error:
--
--   1. UNA TAREA QUE NUNCA SUPERA EL UMBRAL se queda en `matching` para siempre, con una
--      candidatura pendiente que nadie puede aceptar — porque aquí no hay nadie. Todo lo
--      que dependa de ella queda bloqueado. Ocurrió de verdad: dos tareas puntuaron 0.492
--      y 0.468 contra un umbral de 0.50 y se pararon.
--
--   2. UN USUARIO SIN LÍMITE agota la cuota de IA del free tier para todos los demás.
--      Planificar un proyecto cuesta una llamada al modelo más una vectorización por
--      tarea; tres personas curiosas dejan el sistema sin servicio en una tarde.
-- =========================================================================================

-- Mismo preámbulo que `db/schema.sql`: las extensiones viven en su propio esquema, así que
-- sin esto `uuid_generate_v4()` no se resuelve.
set search_path = public, extensions;


-- =========================================================================================
-- 01 · Contador de rondas de emparejamiento
-- =========================================================================================
-- Rondas y no tiempo transcurrido, a propósito. En producción el reloj dispara cada 15
-- minutos, así que cuatro rondas es una hora; pero en una demostración basta con ejecutar
-- el disparador cuatro veces. Medido en horas, la escalada sería imposible de mostrar.
alter table public.project_tasks
  add column if not exists matching_rounds integer not null default 0;

comment on column public.project_tasks.matching_rounds is
  'Veces que el emparejador puntuó candidatos para esta tarea sin llegar a adjudicarla. '
  'Al superar el tope configurado, la política acepta al mejor candidato por encima del '
  'mínimo en lugar de dejar la tarea bloqueada para siempre.';

create index if not exists idx_project_tasks_matching_rounds
  on public.project_tasks (matching_rounds)
  where assignee_id is null;

-- La cuenta se lleva en la base y no en el cliente: dos disparadores solapados tienen que
-- ver el mismo número, y un contador en memoria se reiniciaría en cada despliegue.
create or replace function public.bump_matching_round(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rondas integer;
begin
  update public.project_tasks
     set matching_rounds = matching_rounds + 1,
         updated_at = now()
   where id = p_task_id
     and assignee_id is null
  returning matching_rounds into v_rondas;

  -- Sin fila significa que la tarea ya tiene proveedor: la ronda no cuenta.
  return coalesce(v_rondas, 0);
end;
$function$;

-- Al adjudicarse, el contador vuelve a cero. Si la tarea se reabre por una revisión, la
-- siguiente búsqueda arranca con el mercado en igualdad de condiciones.
create or replace function public.reset_matching_rounds()
returns trigger
language plpgsql
as $function$
begin
  if new.assignee_id is not null and old.assignee_id is null then
    new.matching_rounds := 0;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_reset_matching_rounds on public.project_tasks;
create trigger trg_reset_matching_rounds
  before update of assignee_id on public.project_tasks
  for each row execute function public.reset_matching_rounds();


-- =========================================================================================
-- 02 · Cuotas de uso
-- =========================================================================================
-- Ventana deslizante por usuario y acción. Se cuenta en la base porque es el único sitio
-- donde el recuento es atómico: dos peticiones simultáneas del mismo usuario no pueden
-- consumir el mismo hueco.
create table if not exists public.usage_events (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.users (id) on delete cascade,
  action     text not null,
  created_at timestamptz not null default now(),
  constraint usage_events_action_no_vacio check (length(trim(action)) > 0)
);

create index if not exists idx_usage_events_ventana
  on public.usage_events (user_id, action, created_at desc);

alter table public.usage_events enable row level security;

-- Cada quien ve su propio consumo. La escritura solo ocurre desde la función de abajo,
-- que es SECURITY DEFINER: nadie puede fabricarse huecos insertando a mano.
drop policy if exists usage_events_select_own on public.usage_events;
create policy usage_events_select_own on public.usage_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

/**
 * Comprueba y consume un hueco de cuota EN LA MISMA TRANSACCIÓN.
 *
 * Partirlo en «contar» y luego «registrar» abriría la carrera que esta función existe para
 * cerrar: dos pestañas pulsando a la vez pasarían ambas la comprobación.
 *
 * Devuelve el estado de la cuota. NO lanza: el llamador decide qué mensaje mostrar, y una
 * excepción aquí se confundiría con un fallo del sistema.
 */
create or replace function public.consume_quota(
  p_user_id       uuid,
  p_action        text,
  p_limit         integer,
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
  v_proximo timestamptz;
begin
  if p_limit <= 0 then
    return jsonb_build_object('permitido', false, 'usados', 0, 'limite', p_limit,
                              'motivo', 'la acción está deshabilitada por configuración');
  end if;

  -- `for update` sobre las filas de la ventana: serializa a los llamadores concurrentes
  -- del MISMO usuario y acción, sin bloquear a nadie más.
  perform 1
    from public.usage_events
   where user_id = p_user_id and action = p_action and created_at >= v_desde
   for update;

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

/** Consumo actual sin consumir nada. Para mostrárselo al usuario antes de que choque. */
create or replace function public.quota_usage(
  p_user_id      uuid,
  p_action       text,
  p_window_hours numeric
)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::integer
    from public.usage_events
   where user_id = p_user_id
     and action = p_action
     and created_at >= now() - make_interval(secs => p_window_hours * 3600);
$function$;


-- =========================================================================================
-- 03 · Privilegios
-- =========================================================================================
-- PostgreSQL concede EXECUTE a PUBLIC en cada función nueva, así que revocar solo a `anon`
-- no cierra nada. Estas tres las invocan los agentes con `service_role`, que no necesita
-- GRANT porque bypassea RLS; ningún rol de cliente debe poder fabricarse cuota.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.bump_matching_round(uuid)',
    'public.consume_quota(uuid, text, integer, numeric)',
    'public.quota_usage(uuid, text, numeric)'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated', v_fn);
  end loop;
end $$;
