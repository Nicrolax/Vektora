# VEKTORA

Plataforma autónoma de resultados: una persona describe un objetivo, el sistema lo
descompone en un grafo de tareas (DAG) con IA, adjudica cada tarea a un proveedor (matching
híbrido con pgvector + reputación), un juez de IA evalúa lo entregado criterio por criterio y
mueve reputación. **Ninguna persona decide nada en el ciclo.**

Proyecto del año de **Programación Avanzada (UTU)** — Nicolás Bentancour, Agustín Perdomo,
Matías Piñeyro y Thiago Rodríguez. Stack: Next.js 16 + TypeScript estricto + PostgreSQL 16 con
pgvector, todo en servicios gratuitos.

| Entorno | Base | App |
|---|---|---|
| Local (Nivel 1) | contenedor `pgvector/pgvector:pg16` | `docker compose up` |
| Nube (Nivel 2) | **Aiven** PostgreSQL, conexión **SSL** | **Render** (Docker), **HTTPS**: <https://vektora.onrender.com> |
| Taller (Nivel 3) | Deployment + PVC en **minikube** | Deployment + Service en minikube |

Guía paso a paso: [`docs/guia-despliegue.md`](docs/guia-despliegue.md) · Seguridad:
[`docs/informe-seguridad.md`](docs/informe-seguridad.md) · Diagramas:
[`docs/diagramas/`](docs/diagramas/) · Defensa: [`docs/defensa.md`](docs/defensa.md) ·
Para entenderlo desde cero: [`docs/12-que-hicimos-y-por-que.md`](docs/12-que-hicimos-y-por-que.md).

---

## Arranque rápido (Docker)

```bash
cp .env.example .env            # completar POSTGRES_*, AUTH_SECRET y CRON_SECRET
docker compose up --build -d    # base + app; la base se carga sola con sql/
docker compose ps               # db y app "healthy"
```

Abrir <http://localhost:3000> y entrar con una cuenta de prueba (contraseña **pública**
`Demo-Vektora-2026`, solo existe en los datos de prueba):

| Cuenta | Rol | Para mostrar |
|---|---|---|
| `cliente@vektora.test` | cliente | proyecto demo con su grafo, búsqueda, reportes, gestionar proyecto |
| `sofia.diseno@vektora.test` | proveedora | tiene **T-02 asignada**: la entrega transaccional |
| `ambos@vektora.test` | cliente y proveedor | dueño del proyecto público de recetas |
| `lucia.frontend@`, `diego.backend@`, `martin.qa@vektora.test` | proveedores | candidatos del matching |

La cuenta **admin** no está en los datos (su contraseña no puede ser pública). Se crea así:

```bash
ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD='<12+ caracteres>' npm run cuenta:admin
```

Sin Docker: `npm ci`, un PostgreSQL 16 con pgvector, los `DB_*` en `.env`,
`npm run sql:aplicar` y `npm run dev`.

## Requisitos del examen (R1–R12)

| | Requisito | Dónde está |
|---|---|---|
| **R1** | ≥ 4 entidades con PK/FK, 1:N y N:M | `db/schema.sql`: 14 tablas. 1:N `users → projects → project_tasks`. N:M `provider_profiles ↔ skills` (`provider_skills`), tarea ↔ tarea (`task_dependencies`, el DAG), proveedor ↔ tarea (`task_applications`) |
| **R2** | CRUD en ≥ 3 entidades | **Proyectos**: crear (`app/acciones/proyectos.ts` → planificador), leer, editar/pausar/cancelar/eliminar (`lib/proyectos`, `/proyectos/[id]/gestionar`). **Cuentas**: alta (`/entrar`), listar, cambiar rol, suspender, borrar (`lib/admin`, `/admin/cuentas`). **Skills**: alta, listar, editar, borrar (`/admin/skills`). **Perfil de proveedor**: alta y edición (`/proveedor/alta`) |
| **R3** | Login, hash BCrypt, ≥ 2 roles | `lib/auth/password.ts` (bcrypt coste 12), `lib/auth/servicio.ts`, `lib/auth/token.ts` (cookie JWT HS256 `httpOnly`), roles `client`/`provider`/`both`/`admin` en `lib/auth/permisos.ts`; páginas con `requirePermiso()`, acciones con `exigirPermiso()`; la base lo refuerza con RLS |
| **R4** | Capas modelo / DAO / servicio / presentación con interfaces | Modelo: `lib/db/types.ts` y esquemas Zod. DAO: interfaces `*Repository`/`*Dao` con su implementación `Postgres*` (`lib/planner/repository.ts`, `lib/auth/repository.ts`, `lib/entregas`, `lib/proyectos`…) y `lib/consultas`. Servicio: `AuthService`, `ProyectosService`, `EntregasService`, `AdminService`, `ProjectPlanner`, `TaskMatcher`, `QaJudge`. Presentación: `app/` |
| **R5** | Herencia + interfaz con 2 implementaciones | Herencia: `VektoraError` (abstracta) ← `ValidacionError`, `DatabaseError` ← `PlannerRepositoryError`… (`lib/errores`). Interfaces: `LlmProvider` → `GroqProvider`, `GeminiProvider`; `TelemetrySink` → `PostgresTelemetrySink`, `NullTelemetrySink`, `InMemoryTelemetrySink`; cada `*Repository` → Postgres + en memoria (pruebas) |
| **R6** | Búsqueda con filtros + JOIN + reporte COUNT/SUM/AVG + GROUP BY | `lib/consultas/busqueda.ts` (`/buscar`: texto, estado, skill, rango de presupuesto, sin asignar; JOIN a proyectos y perfiles). `lib/consultas/reporte.ts` (`/reportes`: por proyecto, por estado, por proveedor) |
| **R7** | Transacción sobre ≥ 2 tablas con commit y rollback | `lib/db/client.ts` → `transaction()`. `lib/entregas` → entregar = `SELECT … FOR UPDATE` + INSERT `deliverables` + UPDATE `project_tasks` + INSERT `audit_logs`, todo o nada. Probado en `tests/integracion/base.test.ts` (rollback ante falla) |
| **R8** | Validaciones, excepción propia, sin errores internos visibles | Zod + validaciones de dominio (`lib/validacion`, `validar*`). `lib/errores`: `mensajeParaUsuario()` es el único camino de un error a la interfaz; los internos se registran y la persona ve un mensaje genérico |
| **R9** | Consultas preparadas | `lib/db/client.ts`: la ÚNICA forma de ejecutar SQL es `query(texto, [parámetros])` con `$1, $2…` (equivalente a `PreparedStatement`). Probado con un intento de inyección en las pruebas de integración |
| **R10** | Conexión por variables de entorno | `lib/db/config.ts`: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`, `DB_SSL_CA`, `DB_POOL_MAX` |
| **R11** | Script de tablas + script con ≥ 20 registros | `sql/01-crear-tablas.sql` y `sql/02-datos-prueba.sql` (generados desde `db/` con `npm run sql:build`; 30 skills, 6 cuentas, 2 proyectos, 8 tareas, 7 dependencias, candidaturas, entrega, reputación) |
| **R12** | `/health` | `app/health/route.ts`: 200 si la app y la base (`select 1` < 3 s) responden, 503 si no |

## Estructura del repositorio

La consigna pide el código en `src/`. En Next.js el código vive en carpetas con nombre fijo,
así que **`src/` equivale a `app/` + `lib/` + `components/`**:

```
app/          presentación: páginas, Server Actions (app/acciones), /health, /api
lib/          dominio, servicios y acceso a datos (uno por carpeta, ver «Arquitectura»)
components/   componentes de interfaz
db/           SQL fuente, por fase (00_plataforma, schema, migrations, seeds, verify)
sql/          01-crear-tablas.sql y 02-datos-prueba.sql (GENERADOS desde db/)
scripts/      CLIs: sql:aplicar, db:check, cuenta:admin, el ciclo autónomo…
tests/        Vitest: unitarias y tests/integracion (contra PostgreSQL real)
Dockerfile · docker-compose.yml · .env.example
k8s/          manifiestos de Kubernetes (Nivel 3, fase 4 del examen)
docs/         guía de despliegue, informe de seguridad, diagramas, defensa y documentos 01–11
.github/      CI, imagen en ghcr.io, agentes, Kubernetes (kind), seguridad, CodeQL, ZAP, Dependabot
```

## La base de datos

La base es PostgreSQL común (antes de la versión 0.4 era Supabase). Lo que Supabase daba
hecho lo crea `db/00_plataforma.sql`: el esquema `auth` con `auth.users.password_hash`,
`auth.uid()` y los roles `anon` / `authenticated` / `service_role`.

- **Dos identidades.** La app se conecta como el dueño de las tablas: así operan los agentes
  autónomos, el login y la telemetría. Para leer como una persona, `getDb().asUser(id, …)`
  abre una transacción con `SET LOCAL ROLE authenticated` y fija `request.jwt.claim.sub`:
  `auth.uid()` vale ese id y las 47 políticas RLS se aplican igual que antes.
- **Orden de los scripts.** `00_plataforma → schema → 0002 … 0005, 0007 → seeds/01_skills →
  seeds/02_datos_demo`. Ya están concatenados en `sql/` (`npm run sql:build`; `sql:check`
  falla en CI si alguien los editó a mano). Todos son idempotentes.
- **Comprobación.** `npm run db:check` revisa la conexión (y si va por SSL), extensiones,
  plataforma, tablas, columnas, funciones, RLS y datos. `db/verify/` prueba el
  comportamiento del SQL (DAG, ciclos, matching, juez, cuotas, RLS) y corre en CI.

---

## Arquitectura

Todo el código de dominio vive bajo `lib/`, y se importa con el alias `@/`. Ningún módulo
importa archivos internos de otro dominio: se importa desde el índice público (`@/lib/ai`,
`@/lib/planner`, `@/lib/db`).

```
lib/
  env.ts                     Carga de .env / .env.local para procesos que no son Next.js
  ai/                        FASE 2 — capa de abstracción de IA
    index.ts                 API pública
    ai-client.ts             Orquestador: fallback, reintentos, auto-reparación Zod
    config.ts                Entorno validado con Zod estricto, perezoso y memorizado
    types.ts                 Tipos compartidos; los literales replican los ENUM de la base
    errors.ts                Taxonomía de errores con `retryable` y mapeo a ai_run_status
    json.ts                  Extracción tolerante de JSON de la salida del modelo
    schema.ts                Zod -> JSON Schema -> Schema de Google; prompts de reparación
    pricing.ts               Estimación de cost_usd (0 en free tier, tabla extensible)
    embedding-models.ts      Registro de capacidades de los modelos de embedding
    embeddings.ts            Servicio de embeddings + utilidades de pgvector
    telemetry.ts             Sinks de ai_runs: PostgreSQL / null / en memoria
    providers/
      index.ts               Construcción de la cadena de fallback
      http.ts                fetch con timeout, señal combinada y traducción de estado
      groq.ts                Adaptador Groq (/chat/completions)
      gemini.ts              Adaptador de generación Gemini (:generateContent)
      gemini-embeddings.ts   Adaptador de embeddings (:embedContent)
  planner/                   FASE 3 — ProjectPlanner
    index.ts                 API pública + createProjectPlanner()
    planner.ts               Orquestación completa objetivo -> DAG persistido
    dag.ts                   Álgebra de grafos PURA
    schemas.ts               Contrato Zod del plan, con los invariantes del DAG dentro
    prompts.ts               System prompt, catálogo de skills y refuerzo de grafo
    budget.ts                Reparto por resto mayor, exacto al céntimo
    repository.ts            Interfaz de datos (DAO) + implementación PostgreSQL
  providers/                 FASE 3.5 — onboarding y catálogo vivo de skills
    index.ts                 API pública + createProviderOnboarding()
    provider.ts              Alta completa: cuenta, perfiles, skills, vectorización
    skills.ts                Resolución en cascada: exacta -> alias -> semántica -> creación
    schemas.ts               Contrato Zod del alta
    repository.ts            Interfaz de datos (DAO) + implementación PostgreSQL
  matching/                  FASE 4 — motor de matching híbrido
    index.ts                 API pública + createTaskMatcher()
    matcher.ts               Orquestación: vectorizar, recuperar, puntuar, persistir, adjudicar
    scoring.ts               Ranking PURO: vector + skills + reputación
    config.ts                Pesos y umbrales validados con Zod
    repository.ts            Interfaz de datos (DAO) + implementación PostgreSQL
  qa/                        FASE 5 — agente autónomo de QA (AI Judge)
    index.ts                 API pública + createQaJudge()
    judge.ts                 Orquestación: tomar turno, evaluar, decidir, persistir
    policy.ts                Veredicto PURO: criterios -> estado, nota, reputación
    schemas.ts               Contrato Zod construido con los criterios REALES de la tarea
    prompts.ts               Prompt del juez, sin identidad ni reputación del proveedor
    config.ts                Umbrales y deltas validados con Zod
    repository.ts            Interfaz de datos (DAO) + implementación PostgreSQL
  db/                        0.4 — acceso a PostgreSQL (R7, R9, R10)
    client.ts                query() parametrizada, transaction(), asUser() con RLS
    config.ts                DB_* desde el entorno, SSL con el CA de Aiven
    types.ts                 Contratos de fila de db/schema.sql
  auth/                      0.4 — login propio (R3)
    password.ts              BCrypt coste 12
    token.ts                 Cookie de sesión: JWT HS256 con node:crypto
    cookie.ts                httpOnly, SameSite=Lax, Secure detrás de HTTPS
    permisos.ts              Tabla rol -> permisos
    repository.ts            DAO de cuentas (auth.users + public.users)
    servicio.ts              AuthService: entrar, registrarse, asegurarAdmin
    session.ts               requireUser / requirePermiso / exigirPermiso
  errores/                   0.4 — jerarquía de excepciones y mensajeParaUsuario() (R5, R8)
  consultas/                 0.4 — lecturas de las páginas con RLS, búsqueda y reporte (R6)
  proyectos/                 0.4 — ProyectosService: editar, estado, eliminar (R2)
  entregas/                  0.4 — EntregasService: la transacción de la entrega (R7)
  admin/                     0.4 — AdminService: cuentas y catálogo de skills (R2)
  cron/autorizacion.ts       FASE 6 — secreto de los trabajos programados
  cuotas/index.ts            FASE 7 — límites de uso por usuario
  validacion/entrada.ts      FASE 7 — correos, textos y presupuestos con contenido real

app/                         FASE 6 — interfaz web (Next.js App Router)
  entrar/                    Alta y acceso
  health/                    /health (R12)
  (app)/panel/               Proyectos del cliente
  (app)/proyectos/           Creación, visualizador del grafo y gestión (editar/eliminar)
  (app)/tareas/[id]/         Criterios, candidaturas y veredictos
  (app)/trabajo/[taskId]/    Espacio de entrega del proveedor
  (app)/proveedor/           Panel y alta de proveedor
  (app)/buscar/              Búsqueda de tareas con filtros (R6)
  (app)/reportes/            Reporte con agregaciones (R6)
  (app)/admin/               Cuentas y catálogo de skills (solo admin)
  acciones/                  Server Actions sobre los servicios de lib/
  api/cron/                  Disparadores de los agentes autónomos
  api/proyectos/[id]/firma   Sondeo de cambios del grafo (cada 15 s)

components/
  grafo/                     Visualizador SVG y disposición PURA
  ui/                        Primitivas, marca y navegación
  estados.ts                 Vocabulario visual de los estados

db/
  00_plataforma.sql          0.4 — auth.users (hash BCrypt), auth.uid(), roles
  schema.sql                 FASE 1 — 14 ENUM, 14 tablas, triggers, índices, RLS, privilegios
  migrations/0002_planner.sql  FASE 3 — apply_project_plan, refresh_task_readiness, project_dag
  migrations/0003_provider_onboarding.sql  FASE 3.5 — resolve_or_create_skill, skill_aliases
  migrations/0004_matching.sql  FASE 4 — match_task_candidates, apply_task_matches, accept_task_application
  migrations/0005_qa.sql     FASE 5 — claim_deliverable_for_qa, apply_qa_verdict, pending_qa_deliverables
  migrations/0007_escalada.sql  FASE 7 — rondas de emparejamiento y cuotas de uso
  verify/                    Verificación de comportamiento sobre base local desechable
  seeds/01_skills.sql        Catálogo semilla de skills
  seeds/02_datos_demo.sql    Cuentas, proyectos y tareas de la demo
  diagnose.sql · dump-schema.sql · dump-skills.sql   Diagnóstico (solo lectura)

scripts/
  ai-check.ts                Verificación de la capa de IA contra las APIs reales
  db-check.ts                npm run db:check — conexión, SSL, esquema, RLS y datos
  sql-build.ts               npm run sql:build / sql:check — genera sql/ desde db/
  sql-aplicar.ts             npm run sql:aplicar — carga sql/ en la base de DB_* (Aiven)
  cuenta-admin.ts            npm run cuenta:admin — crea o asciende la cuenta admin
  plan-project.ts            npm run plan -- "<objetivo>" [presupuesto]
  skills-embed.ts            Vectoriza el catálogo de skills
  provider-add.ts            npm run provider:add -- <perfil.json>
  skills-calibrate.ts        Mide la distribución real de similitudes
  match-task.ts              npm run match -- <task_id> [--assign|--dry-run|--manual]
  deliverable-submit.ts      npm run deliver -- <task_id> <archivo.json|.md>
  qa-review.ts               npm run qa -- <deliverable_id> [--dry-run|--task|--all]
  cron-local.ts              npm run cron — dispara los trabajos programados en local
  cleanup-legacy.ps1         Borrado único de los archivos huérfanos del refactor

tests/                       Suite de Vitest del núcleo (sin red, sin base de datos)
```

### Decisiones que conviene conocer antes de tocar nada

- **La cadena de fallback la dicta `AI_PROVIDER_ORDER`** (por defecto `groq,google`) y solo
  entran los proveedores con clave. Con una sola clave el sistema funciona degradado.
- **Los modelos caducan.** `llama-3.3-70b-versatile` y `gemini-2.5-flash` se retiraron en
  2026 y empezaron a devolver 404. Un 404 que menciona el modelo se trata como error de
  CONFIGURACIÓN, no como petición inválida: el mensaje dice qué hacer y la cadena cede el
  turno sin gastar intentos. `npm run ai:models` lista lo que admiten tus claves — es la
  única fuente de verdad, porque la documentación pública y lo que ve una cuenta concreta
  no siempre coinciden.
- **`retryable` decide todo.** `rate_limit` / `server` / `timeout` / `network` reintentan con
  backoff exponencial y respetan `Retry-After`; `auth` / `bad_request` / `blocked` /
  `truncated` ceden el turno al siguiente proveedor sin gastar intentos.
- **Los invariantes del DAG son refinements de Zod**, no validación posterior. Así el bucle
  de auto-reparación de la FASE 2 recibe mensajes accionables y **el propio modelo corrige
  el grafo**, sin código de reparación específico del planificador.
- **Defensa del grafo en cuatro capas**: prompt → refinements + auto-reparación → reparación
  determinista (`pruneInvalidReferences` + `breakCycles`) → trigger `prevent_dag_cycles` en
  la base. Abortar y esperar a una persona no es opción (regla 1).
- **`vector(1536)`** en `provider_profiles.embedding` y `project_tasks.embedding`. Lo produce
  `gemini-embedding-001` recortado por MRL y **renormalizado L2**, para que `<=>` de pgvector
  siga siendo distancia coseno. Los índices HNSW son **parciales**: las consultas de la
  FASE 4 deben incluir `where embedding is not null` y ordenar por `<=>` o no se usarán.
- **El dueño de las tablas no está sujeto a RLS**: es la identidad de los agentes
  autónomos. Las páginas leen con `asUser`, que sí lo está. `pg` solo existe en el servidor.
- **`reputation_events` y `audit_logs` son append-only.** La reputación mostrada tiene que
  poder reconstruirse sumando eventos (`delta * weight`), o deja de ser un mecanismo de
  confianza.
- **`project_dag` es una función, no una vista**, y `task_dependencies` usa
  `depends_on_task_id` sin `project_id`. `db/LEEME.md` recoge estas y otras trampas del
  modelo real.
- **El catálogo de skills crece solo pero converge.** Cuando un proveedor declara un slug
  desconocido, se vectoriza y se compara con el catálogo: si supera el umbral se MAPEA a la
  skill existente y el mapeo queda en `skill_aliases`; solo un concepto nuevo crea fila. Sin
  esto, `react` / `reactjs` / `react-18` serían tres skills y el matching devolvería listas
  vacías. El umbral se ajusta con `VEKTORA_SKILL_MATCH_THRESHOLD` (0.95, **medido** con
  `npm run skills:calibrate`; con 0.82 se fusionaba el 76.8% del catálogo).
- **El matching separa recuperación de política.** La base hace la búsqueda aproximada de
  vecinos (lo único que solo ella puede hacer); los pesos, la fórmula y la explicación viven
  en `lib/matching/scoring.ts`, que es puro y se prueba exhaustivamente. Enterrar la fórmula
  en SQL la volvería intocable.
- **El coseno crudo NO discrimina**: con `gemini-embedding-001` todo cae en una banda alta
  y estrecha, así que el tramo útil se reescala a [0,1] (`VEKTORA_MATCH_VECTOR_FLOOR` /
  `_CEILING`). Cuál es el tramo útil depende de QUÉ se compara: entre skills (textos de dos
  palabras) va de 0.77 a 0.92, pero entre **tarea y perfil** — que es lo que el matching
  compara de verdad — va de 0.73 a 0.86. Usar la primera ventana para la segunda dejaba a
  un candidato con cobertura de skills perfecta en 0.2557 de afinidad y su `match_score` en
  0.5563, por debajo del umbral de adjudicación: el motor ordenaba bien y no adjudicaba
  nunca. `npm run skills:calibrate` mide ambas distribuciones por separado.
- **Un proveedor sin historial recibe un prior neutro, no cero.** Penalizar la ausencia de
  historial produce arranque en frío permanente: quien nunca trabajó nunca podría trabajar.
- **`accepts_auto_assign` se comprueba dos veces**, en el filtro SQL y antes de adjudicar.
  Adjudicar trabajo a quien no lo pidió no es autonomía.
- **Ninguna tarea puede quedarse trabada.** Si tras cuatro rondas nadie supera el umbral, se
  adjudica al mejor candidato por encima del mínimo y la traza registra que fue por
  agotamiento. Sin eso, una tarea cuyo mejor candidato puntúa 0.49 contra un umbral de 0.50
  se para para siempre, y con ella todo lo que dependa de ella — porque aquí no hay nadie
  que pueda desatascarla.
- **El AI Judge no decide si se aprueba.** Emite un veredicto POR CRITERIO con la evidencia
  citada; el estado, la nota y la reputación los calcula `lib/qa/policy.ts`, que es puro.
  "¿Apruebas esto?" es un juicio global que un modelo resuelve por impresión general —
  aprueba un texto bien escrito e incompleto, o se pone severo con trabajo correcto—.
  "¿La evidencia demuestra AC-2? Cita la parte que lo prueba" es extracción, que sí hace
  bien. De paso, el umbral deja de estar enterrado en un prompt.
- **Al juez no se le dice quién entregó**: ni nombre, ni reputación, ni precio, ni cuántas
  veces lo intentó. Contarle que el proveedor tiene 5 estrellas convertiría la reputación en
  una profecía autocumplida. La escalada por intentos vive en la política, donde es una
  regla explícita y auditable.
- **Un `pass` con poca confianza no se cuenta como fallo: se degrada a "sin evidencia".**
  La diferencia entre "no lo cumple" y "no puedo comprobarlo" es la diferencia entre cerrar
  una tarea y pedir una captura más. Y la confianza nunca pondera la nota: eso sería dejar
  al modelo moverse la calificación.
- **Una avería nuestra nunca es un rechazo.** Si la IA no responde, el entregable vuelve a
  `error` —estado desde el que la RLS permite reintentar—, no a `rejected`. Cobrarle al
  proveedor nuestra caída de cuota sería el peor fallo posible de un sistema sin humanos.
- **La reputación es un libro mayor append-only**, así que el guardia contra el doble cobro
  es previo al INSERT: no se emite un `event_type` que ese entregable ya generó. Un
  veredicto posterior que contradiga a otro AÑADE el evento contrario en vez de borrar.
- **Las páginas leen como la persona.** `lib/consultas` usa `asUser`, así que todo pasa por
  las políticas de acceso: si una consulta no devuelve una fila es porque la base no deja
  verla, no porque el código se acordó de filtrar. Solo las acciones de servidor y los
  agentes operan como dueños de las tablas, y siempre tras validar la sesión y el permiso.
- **Las cuotas se cuentan en la base, no en el proceso.** Es el único sitio donde el recuento
  es atómico: dos pestañas pulsando a la vez no pueden consumir el mismo hueco. Si el
  contador falla, se PERMITE la acción — el límite protege una cuota, no custodia nada
  crítico, y dejar a la gente sin trabajar por eso sería peor que el riesgo que evita.
- **Los trabajos programados son infraestructura, no un detalle.** Sin un reloj que dispare
  el emparejamiento y la evaluación, el sistema solo avanza cuando alguien ejecuta algo, y
  eso es intervención humana disfrazada.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | `tsc --noEmit` con `strict`, `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes` |
| `npm test` | Suite de Vitest del núcleo |
| `npm run verify` | typecheck + pruebas + `sql:check` |
| `npm run test:integracion` | Pruebas contra PostgreSQL real (`VEKTORA_TEST_DB=1` y los `DB_*`) |
| `npm run sql:build` / `sql:check` | Genera `sql/` desde `db/` / falla si no está al día |
| `npm run sql:aplicar` | Ejecuta `sql/` contra la base de `DB_*` (así se carga Aiven) |
| `npm run cuenta:admin` | Crea o asciende la cuenta admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) |
| `npm run db:check` | Conexión (y SSL), extensiones, plataforma, tablas, funciones, RLS y datos |
| `npm run ai:models` | Lista los modelos que admiten tus claves y marca si el configurado ya no existe |
| `npm run ai:check` | Comprueba configuración, generación, fallback y embeddings contra las APIs reales |
| `npm run skills:embed` | Vectoriza el catálogo de skills (`--all` recalcula todo) |
| `npm run provider:add -- <perfil.json>` | Da de alta un proveedor (`--ejemplo` imprime una plantilla) |
| `npm run skills:calibrate` | Mide la distribución de similitudes y propone umbrales |
| `npm run match -- <task_id>` | Matching híbrido de una tarea (`--assign`, `--dry-run`, `--manual`) |
| `npm run deliver -- <task_id> <archivo>` | Registra un entregable para que el juez lo evalúe |
| `npm run qa -- <deliverable_id>` | Evalúa un entregable contra sus criterios (`--dry-run`, `--task`, `--all`) |
| `npm run plan -- "<objetivo>" [presupuesto]` | Planifica un proyecto real de punta a punta |
| `npm run dev` | Levanta la aplicación web en desarrollo |
| `npm run build` | Compilación de producción |
| `npm run cron` | Dispara emparejamiento y evaluación contra la app en marcha |

## Variables de entorno

Todas están en [`.env.example`](.env.example), solo con los nombres. Las obligatorias son los
`DB_*` (o los `POSTGRES_*` con docker compose), `AUTH_SECRET` (≥ 32 caracteres) y
`CRON_SECRET`. Para crear proyectos hace falta al menos una de `GROQ_API_KEY` /
`GOOGLE_AI_API_KEY`; sin ellas la demo con los datos de prueba funciona igual. Los umbrales
`VEKTORA_*` están medidos y documentados uno a uno.

`.env` **nunca** se versiona (está en `.gitignore` y en `.dockerignore`).

---

## Documentación

- [`docs/guia-despliegue.md`](docs/guia-despliegue.md) — Docker, Aiven, Render y minikube, paso a paso, con las capturas.
- [`docs/informe-seguridad.md`](docs/informe-seguridad.md) — SCA, SAST, Trivy, ZAP y gitleaks: hallazgos, correcciones y hardening.
- [`docs/diagramas/`](docs/diagramas/) — arquitectura, modelo de datos (ER), capas y flujo de despliegue.
- [`docs/defensa.md`](docs/defensa.md) — guion de la demo, R1–R12 con archivo y línea, preguntas probables.
- [`docs/00-indice.md`](docs/00-indice.md) — desarrollo teórico, requisitos, stack, diagrama de clases, casos de uso e infraestructura.

La documentación técnica de cada fase —decisiones de diseño, errores encontrados y cómo se
corrigieron— vive en el espacio de trabajo del proyecto.

---

**Uso de IA y autoría.** Este proyecto se desarrolló con asistencia de Claude (Anthropic,
modelo `claude-opus-5`). El sistema, además, utiliza modelos de lenguaje como componente
propio (Groq `openai/gpt-oss-120b` con respaldo en Google `gemini-3.6-flash`). Las decisiones
de diseño, la revisión y la verificación son de los autores, que asumen la responsabilidad
sobre el contenido. Constancia formal en
[`docs/11-declaracion-de-uso-de-ia.md`](docs/11-declaracion-de-uso-de-ia.md).
