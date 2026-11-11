/**
 * VEKTORA — Comprobación de la base de datos.
 *
 *   npm run db:check
 *
 * Verifica, SIN ESCRIBIR NADA, que la base apuntada por `DB_*` tiene lo que el código
 * necesita: conexión (y si va cifrada con SSL), extensiones, la plataforma de
 * `db/00_plataforma.sql` (auth.users, auth.uid(), roles y la membresía que permite
 * `SET ROLE authenticated`), tablas, columnas, funciones, RLS y datos mínimos.
 *
 * Sirve igual contra el contenedor del compose, contra Aiven o contra la base de minikube.
 * Existe porque el modo de fallo más caro del proyecto es descubrir que falta una columna a
 * mitad de un plan ya generado: para entonces ya se pagó la llamada al modelo.
 */

import '@/lib/env';

import { errorMessage } from '@/lib/ai/errors';
import { cargarDbConfig, cerrarDb, describirDbConfig, getDb, type Db } from '@/lib/db';

const TABLES = [
  'users',
  'profiles',
  'provider_profiles',
  'skills',
  'provider_skills',
  'projects',
  'project_tasks',
  'task_dependencies',
  'task_applications',
  'deliverables',
  'reviews',
  'reputation_events',
  'ai_runs',
  'audit_logs',
  'skill_aliases',
  'usage_events',
] as const;

/** Las 14 tablas del modelo original tienen RLS obligatorio. */
const RLS_TABLES = TABLES.slice(0, 14);

/** Columnas que el código escribe explícitamente. Si falta una, el insert revienta. */
const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  ai_runs: [
    'operation', 'provider', 'model', 'status', 'attempt', 'fell_back_from', 'parent_run_id',
    'user_id', 'project_id', 'task_id', 'request_payload', 'response_payload', 'zod_errors',
    'error_message', 'prompt_tokens', 'completion_tokens', 'total_tokens', 'latency_ms',
    'cost_usd', 'started_at', 'finished_at',
  ],
  projects: [
    'owner_id', 'title', 'objective', 'description', 'status', 'visibility', 'currency',
    'budget_total', 'deadline', 'acceptance_policy', 'planner_metadata',
  ],
  project_tasks: [
    'project_id', 'code', 'title', 'description', 'acceptance_criteria', 'required_skills',
    'estimated_hours', 'budget', 'priority', 'order_index', 'depth', 'status', 'assignee_id',
    'embedding', 'embedding_model', 'embedding_updated_at',
    // FASE 7 (0007): el emparejador lo lee en cada ronda para decidir si escala.
    'matching_rounds',
  ],
  skills: ['slug', 'name', 'category', 'is_active', 'embedding', 'embedding_model'],
  // Lo que escribe el AI Judge. Si falta una, el veredicto revienta DESPUÉS de haber
  // pagado la llamada al modelo.
  deliverables: [
    'task_id', 'provider_id', 'version', 'summary', 'content', 'artifacts', 'evidence',
    'qa_status', 'qa_score', 'qa_feedback', 'qa_criteria_results', 'qa_run_id',
    'qa_evaluated_at', 'submitted_at',
  ],
  reviews: ['task_id', 'deliverable_id', 'reviewer_id', 'reviewee_id', 'source', 'rating'],
  reputation_events: ['user_id', 'event_type', 'delta', 'weight', 'task_id', 'deliverable_id'],
  skill_aliases: ['alias', 'skill_id', 'similarity', 'source'],
  users: ['id', 'email', 'role', 'status', 'is_agent', 'last_seen_at'],
  audit_logs: ['actor_id', 'actor_type', 'action', 'entity_type', 'entity_id', 'project_id', 'changes'],
};

/** Funciones de cada fase que el código invoca. */
const FUNCTIONS = [
  'apply_project_plan', 'register_skills', 'project_dag', 'refresh_task_readiness',
  'normalize_skill_slug', 'resolve_or_create_skill', 'upsert_provider_profile', 'set_provider_skills',
  'match_task_candidates', 'apply_task_matches', 'accept_task_application', 'skill_similarity_pairs',
  'claim_deliverable_for_qa', 'release_deliverable_qa', 'apply_qa_verdict', 'pending_qa_deliverables',
  'bump_matching_round', 'consume_quota', 'quota_usage', 'is_admin',
] as const;

let failures = 0;
let warnings = 0;
const ok = (message: string): void => console.log(`   ✓ ${message}`);
const info = (message: string): void => console.log(`   · ${message}`);
function warn(message: string): void {
  warnings += 1;
  console.log(`   ! ${message}`);
}
function fail(message: string): void {
  failures += 1;
  console.log(`   ✗ ${message}`);
}
function header(title: string): void {
  console.log(`\n▸ ${title}`);
}

async function checkConexion(db: Db): Promise<boolean> {
  header('Conexión');
  const config = cargarDbConfig();
  info(describirDbConfig(config));
  try {
    const fila = await db.one<{ version: string; usuario: string; base: string }>(
      `select current_setting('server_version') as version, current_user as usuario, current_database() as base`,
    );
    ok(`PostgreSQL ${fila?.version ?? '?'} · usuario ${fila?.usuario ?? '?'} · base ${fila?.base ?? '?'}`);
  } catch (error) {
    fail(`no se pudo conectar -> ${errorMessage(error)}`);
    return false;
  }

  const cifrada = await db.usaSsl();
  if (cifrada) {
    ok('conexión cifrada con SSL');
    if (config.sslCa === undefined) {
      warn('DB_SSL_CA vacío: el canal va cifrado pero no se verifica el certificado del servidor. Pegá el CA de Aiven.');
    } else {
      ok('certificado del servidor verificado contra DB_SSL_CA');
    }
  } else if (config.ssl === 'disable') {
    info('sin SSL (DB_SSL=disable): correcto SOLO en la red interna de Docker o del clúster');
  } else {
    fail('DB_SSL=require pero la conexión NO va cifrada');
  }
  return true;
}

async function checkExtensiones(db: Db): Promise<void> {
  header('Extensiones');
  const filas = await db.query<{ extname: string; extversion: string; esquema: string }>(
    `select e.extname, e.extversion, n.nspname as esquema
       from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname in ('vector', 'uuid-ossp', 'citext')`,
  );
  for (const nombre of ['vector', 'uuid-ossp', 'citext']) {
    const fila = filas.find((f) => f.extname === nombre);
    if (fila === undefined) fail(`falta la extensión ${nombre} (corré npm run sql:aplicar)`);
    else ok(`${nombre} ${fila.extversion} en el esquema ${fila.esquema}`);
  }
}

async function checkPlataforma(db: Db): Promise<void> {
  header('Plataforma (db/00_plataforma.sql)');
  const fila = await db.one<{ tabla: boolean; hash: boolean; uid: boolean }>(
    `select to_regclass('auth.users') is not null as tabla,
            exists(select 1 from information_schema.columns
                    where table_schema = 'auth' and table_name = 'users' and column_name = 'password_hash') as hash,
            to_regprocedure('auth.uid()') is not null as uid`,
  );
  if (fila?.tabla === true) ok('auth.users'); else fail('falta auth.users');
  if (fila?.hash === true) ok('auth.users.password_hash (BCrypt)'); else fail('falta auth.users.password_hash');
  if (fila?.uid === true) ok('auth.uid()'); else fail('falta auth.uid()');

  const roles = await db.query<{ rolname: string; miembro: boolean }>(
    `select r.rolname, pg_has_role(current_user, r.oid, 'MEMBER') as miembro
       from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role')`,
  );
  for (const nombre of ['anon', 'authenticated', 'service_role']) {
    const rol = roles.find((r) => r.rolname === nombre);
    if (rol === undefined) fail(`falta el rol ${nombre}`);
    else if (nombre !== 'service_role' && !rol.miembro) {
      fail(`el usuario de conexión no es miembro de ${nombre}: ejecutá «grant ${nombre} to <usuario>» como dueño del rol`);
    } else ok(`rol ${nombre}${nombre === 'service_role' ? '' : ' (el usuario de conexión puede usarlo)'}`);
  }

  // La prueba de verdad: lo mismo que hace `asUser` en cada página.
  try {
    const visto = await db.asUser('00000000-0000-4000-8000-00000000ffff', (tx) =>
      tx.one<{ rol: string; uid: string | null }>('select current_user as rol, auth.uid()::text as uid'),
    );
    if (visto?.rol === 'authenticated' && visto.uid !== null) ok('SET LOCAL ROLE authenticated + auth.uid() funcionan');
    else fail(`asUser no cambió de identidad (rol ${visto?.rol ?? '?'})`);
  } catch (error) {
    fail(`asUser falla -> ${errorMessage(error)}`);
  }
}

async function checkEsquema(db: Db): Promise<void> {
  header('Tablas y columnas');
  const tablas = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  const existentes = new Set(tablas.map((t) => t.table_name));
  const faltan = TABLES.filter((t) => !existentes.has(t));
  if (faltan.length === 0) ok(`${TABLES.length} tablas`);
  else fail(`faltan tablas: ${faltan.join(', ')}`);

  const columnas = await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  const porTabla = new Map<string, Set<string>>();
  for (const c of columnas) {
    const set = porTabla.get(c.table_name) ?? new Set<string>();
    set.add(c.column_name);
    porTabla.set(c.table_name, set);
  }
  let faltantes = 0;
  for (const [tabla, requeridas] of Object.entries(REQUIRED_COLUMNS)) {
    const presentes = porTabla.get(tabla) ?? new Set<string>();
    const sin = requeridas.filter((c) => !presentes.has(c));
    if (sin.length > 0) {
      faltantes += sin.length;
      fail(`${tabla}: faltan ${sin.join(', ')}`);
    }
  }
  if (faltantes === 0) ok('todas las columnas que escribe el código');

  header('Funciones');
  const funciones = await db.query<{ proname: string }>(
    `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any($1::text[])`,
    [FUNCTIONS],
  );
  const hay = new Set(funciones.map((f) => f.proname));
  const sinFuncion = FUNCTIONS.filter((f) => !hay.has(f));
  if (sinFuncion.length === 0) ok(`${FUNCTIONS.length} funciones de las fases 2 a 7`);
  else fail(`faltan funciones: ${sinFuncion.join(', ')}`);

  header('Seguridad a nivel de fila (RLS)');
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any($1::text[])`,
    [RLS_TABLES],
  );
  const sinRls = RLS_TABLES.filter((t) => rls.find((r) => r.relname === t)?.relrowsecurity !== true);
  if (sinRls.length === 0) ok(`RLS activo en las ${RLS_TABLES.length} tablas del modelo`);
  else fail(`RLS desactivado en: ${sinRls.join(', ')}`);
  const politicas = await db.one<{ n: number }>(`select count(*) as n from pg_policies where schemaname = 'public'`);
  info(`${politicas?.n ?? 0} políticas`);
}

async function checkDatos(db: Db): Promise<void> {
  header('Datos');
  const fila = await db.one<{ skills: number; cuentas: number; admins: number; proyectos: number; tareas: number }>(
    `select (select count(*) from public.skills where is_active) as skills,
            (select count(*) from public.users) as cuentas,
            (select count(*) from public.users where role = 'admin' and status = 'active') as admins,
            (select count(*) from public.projects) as proyectos,
            (select count(*) from public.project_tasks) as tareas`,
  );
  if ((fila?.skills ?? 0) >= 30) ok(`${fila?.skills} skills activas en el catálogo`);
  else fail(`solo ${fila?.skills ?? 0} skills: corré npm run sql:aplicar (carga sql/02-datos-prueba.sql)`);
  info(`${fila?.cuentas ?? 0} cuentas · ${fila?.proyectos ?? 0} proyectos · ${fila?.tareas ?? 0} tareas`);
  if ((fila?.admins ?? 0) === 0) {
    warn("no hay ninguna cuenta admin activa: ADMIN_EMAIL=… ADMIN_PASSWORD='…' npm run cuenta:admin");
  } else ok(`${fila?.admins} cuenta(s) de administración`);

  const owner = process.env['VEKTORA_OWNER_ID']?.trim();
  if (owner !== undefined && owner !== '') {
    const existe = await db.one('select 1 from public.users where id::text = $1', [owner]);
    if (existe === null) fail(`VEKTORA_OWNER_ID=${owner} no existe en public.users`);
    else ok('VEKTORA_OWNER_ID existe');
  }
}

async function main(): Promise<void> {
  console.log('\n=== VEKTORA · comprobación de la base ===');
  const db = getDb();
  if (await checkConexion(db)) {
    await checkExtensiones(db);
    await checkPlataforma(db);
    await checkEsquema(db);
    await checkDatos(db);
  }
  console.log(
    `\n${failures === 0 ? '✓ Todo en orden' : `✗ ${failures} problema(s)`}` +
      `${warnings > 0 ? ` · ${warnings} aviso(s)` : ''}\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .finally(() => cerrarDb())
  .catch((error: unknown) => {
    console.error(`\nVEKTORA/DB: la comprobación falló -> ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
