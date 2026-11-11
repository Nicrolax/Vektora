# CLAUDE.md — VEKTORA

Guía para Claude Code en este repositorio. Leela entera antes de tocar código.

## Qué es

VEKTORA es una plataforma **autónoma** de resultados: una persona describe un objetivo en
lenguaje natural y el sistema lo convierte en un grafo de tareas (DAG), adjudica cada tarea a
un proveedor (matching híbrido), evalúa lo entregado con un juez de IA y mueve reputación.
**Ninguna persona decide nada en el ciclo.**

Las 7 fases están **completas** (planificar → adjudicar → entregar → juzgar → propagar, con UI,
cuotas, observabilidad y guía de despliegue). El trabajo ahora es mantenimiento, correcciones,
documentación para la entrega y preparación de la demo.

## Reglas del proyecto (no negociables)

1. **100 % autónomo.** Ningún camino puede depender de una persona que no existe.
2. **100 % free tier, sin tarjeta.** PostgreSQL (Docker / Aiven), Render, GitHub (Actions +
   ghcr.io), minikube, Groq, Google AI Studio. Nada de pago.
3. **Sin mocks falsos.** Todo código debe ser real y ejecutable. Los dobles de prueba viven
   solo en `tests/`.
4. **Arquitectura por dominios bajo `lib/`** (ver abajo).
5. **Trabajar por bloques y detenerse.** Al terminar un cambio, resumir qué se hizo y cómo se
   verificó, y **esperar confirmación** antes de seguir con lo siguiente.

### El defecto que hay que buscar siempre

> **Cualquier salida que asuma una persona que no existe es un punto muerto.**

Apareció cuatro veces: un criterio de aceptación que pedía la firma del cliente (FASE 3), un
umbral de adjudicación inalcanzable (FASE 4), cerrar una tarea con un solo veredicto no
determinista (FASE 5) y una tarea esperando para siempre un candidato mejor (FASE 7).
**Ninguno lanza un error.** Antes de dar por bueno un cambio, preguntate: ¿hay algún estado
del que el sistema no salga solo?

## Stack

- Next.js 16 (App Router, Server Actions, TypeScript estricto)
- Tailwind CSS con primitivas propias (`components/ui/primitivas.tsx`, `app/globals.css`); sin librería de componentes ni de íconos
- PostgreSQL 16 + pgvector con `pg` (antes Supabase): RLS estricto vía `asUser`, login propio
  con BCrypt + cookie JWT HS256, sondeo cada 15 s en vez de Realtime
- Despliegue: Docker + compose (Nivel 1), Aiven + Render (Nivel 2), minikube (Nivel 3)
- IA: Groq → Google AI Studio (Gemini) con fallback automático; embeddings
  `gemini-embedding-001` a **1536** dimensiones
- Zod estricto en todas las fronteras
- Vitest

## Comandos

```bash
npm run dev              # http://localhost:3000
npm run typecheck        # tsc --noEmit (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax)
npm test                 # Vitest
npm run verify           # typecheck + test — correr SIEMPRE antes de dar algo por terminado
npm run build            # next build

npm run db:check         # tablas, columnas, RPC, catálogo y VEKTORA_OWNER_ID contra la base real
npm run db:evidencia     # SELECT de la conexión (ssl, TLS) y últimas cuentas, sin mostrar el host
npm run ai:check         # configuración, generación estructurada, fallback forzado y embeddings

# Ciclo autónomo desde la línea de comandos
npm run plan -- "<objetivo>" [presupuesto]
npm run provider:add -- <perfil.json>
npm run skills:embed
npm run skills:calibrate
npm run match -- <task_id> [--assign|--dry-run|--manual]
npm run deliver -- <task_id> <archivo.json|.md>    # sin args: lista tareas asignadas con sus IDs de criterio
npm run qa -- <deliverable_id> [--dry-run|--task|--all]

# Base de datos
npm run sql:build        # regenera sql/ desde db/ (sql:check en verify)
npm run sql:aplicar      # ejecuta sql/ contra la base de DB_* (Aiven)
npm run cuenta:admin     # ADMIN_EMAIL=… ADMIN_PASSWORD=… crea o asciende un admin
npm run test:integracion # VEKTORA_TEST_DB=1 + DB_*: pruebas contra PostgreSQL real

# Agentes (en dev NO hay planificador: en producción los dispara GitHub Actions)
npm run cron             # dispara emparejar y evaluar
npm run cron emparejar
npm run cron evaluar
```

Si algo «no aparece» en desarrollo, lo primero es comprobar si alguien disparó a los agentes.

## Arquitectura: patrón `lib/`

`services/` y `features/` son rutas **obsoletas**. Si aparecen en documentación antigua, la
ruta real es `lib/<dominio>/`.

```
lib/
  env.ts            Carga .env / .env.local para procesos fuera de Next.js (scripts)
  ai/               Cliente de IA único, proveedores, embeddings, telemetría (ai_runs)
  planner/          Objetivo → DAG (dag.ts es álgebra de grafos PURA)
  providers/        Alta de proveedores y resolución semántica de skills
  matching/         Recuperación vectorial + ranking determinista
  qa/               AI Judge (policy.ts es PURO y decide; el modelo solo opina por criterio)
  cuotas/           Límites de uso
  validacion/       Filtros de contenido PUROS (correo, texto sustantivo, presupuesto)
  cron/             Autorización de los disparadores
  db/               client.ts (query/transaction/asUser) · config.ts (DB_*) · types.ts
  auth/             password (bcrypt) · token (JWT) · permisos · servicio · session
  errores/          VektoraError y mensajeParaUsuario() — único camino de un error a la UI
  consultas/        lecturas de las páginas (asUser), búsqueda y reporte
  proyectos/ entregas/ admin/   servicios de escritura (CRUD, transacción de entrega)
app/                Rutas (en español): entrar, (app)/panel, proyectos, tareas, proveedor, trabajo
app/acciones/       Server Actions: proyectos, proveedor, entregas (únicos puntos de escritura)
app/api/cron/       emparejar y evaluar (los dispara GitHub Actions; en dev, npm run cron)
app/health/         /health: 200 si app y base responden
components/         grafo/, ui/, estados.ts (traducción ÚNICA estado → etiqueta + color)
db/                 schema.sql, migrations/0002–0007, seeds/, verify/
scripts/            CLIs del ciclo autónomo
tests/              Vitest
docs/               Documentación evaluable
```

### Reglas de import

1. **Alias `@/` siempre.** Nunca `../../lib/...`.
2. **Solo por el índice público del dominio**: `@/lib/ai`, `@/lib/planner`, `@/lib/matching`…
   Importar un archivo interno de otro dominio es lo que produjo la deriva anterior.
3. **Un único cliente de IA**: `getAiClient()` de `@/lib/ai`. Nadie habla con Groq ni con
   Gemini directamente. La capa usa `fetch` sobre `lib/ai/providers/http.ts` a propósito (no
   la SDK de Google): una sola política de timeout, reintentos y telemetría.
4. **Una sola puerta a la base, dos identidades** (`@/lib/db`):

   | Llamada | Identidad | RLS |
   |---|---|---|
   | `getDb().query(sql, [params])` | dueño de las tablas (agentes, login, telemetría) | no aplica |
   | `getDb().asUser(userId, (tx) => …)` | la persona (`SET LOCAL ROLE authenticated`) | aplica |
   | `getDb().transaction((tx) => …)` | dueño, con BEGIN/COMMIT/ROLLBACK | no aplica |

   Siempre `$1, $2…` (nunca concatenar valores). `jsonb` se pasa con `json(valor)` y se
   castea (`$1::jsonb`); funciones SQL con notación nombrada (`p_x => $1`). Las páginas leen
   SOLO con `lib/consultas` (asUser). `pg` es solo servidor.

### Patrón de cada dominio

`schemas.ts` (Zod) · `config.ts` (umbrales desde entorno, validados con Zod) ·
`repository.ts` (interfaz + implementación `Postgres*`) · orquestador · `index.ts` con
`create<Algo>()`. La **política** (pesos, umbrales, veredictos) vive en TypeScript puro y
testeable; SQL hace solo lo que solo SQL puede hacer (vecinos vectoriales, atomicidad, RLS).

## Base de datos

- **La base desplegada es la fuente de verdad.** Si código y documentación discrepan sobre un
  identificador, se consulta la base (`db/dump-schema.sql`). Reconstruir SQL desde descripciones
  ya rompió la base una vez.
- Orden de despliegue: `db/schema.sql` → `db/migrations/0002` … `0007` → `db/seeds/`.
- Toda migración es **idempotente** y empieza con `set search_path = public, extensions;`
  (sin eso `uuid_generate_v4()` no se resuelve).
- `db/00_plataforma.sql` reemplaza a Supabase (esquema `auth`, `auth.users.password_hash`,
  `auth.uid()`, roles). `sql/` es GENERADO desde `db/`: no editarlo a mano.
- Toda función nueva: `REVOKE ... FROM PUBLIC` y luego `GRANT` explícito. `REVOKE FROM anon`
  solo no cierra nada.
- Una política RLS que llama a una función exige EXECUTE para el **rol evaluado**
  (`is_admin()` conserva EXECUTE para `anon` por eso).
- `reputation_events` es **append-only**: nunca UPDATE ni DELETE; las correcciones se añaden
  como evento contrario.
- Las RPC multi-paso (`apply_project_plan`, `apply_qa_verdict`, `accept_task_application`…)
  son atómicas en el servidor. No partirlas en varias llamadas.
- Nombres reales que la documentación vieja tenía mal: `task_dependencies.depends_on_task_id`,
  `reputation_events.user_id`, `provider_profiles.hourly_rate_usd`, `deliverables.qa_status`,
  `reviews.source`, `audit_logs.entity_type/entity_id`, `project_dag(uuid)` es **función**.
  `ai_run_status` no tiene `cancelled` (sí `timeout`); la operación del juez es `qa_judge`.
- Verificación de comportamiento SQL: `db/verify/` (arnés `00_harness` + archivos 01–05) sobre
  una base local desechable. **No escribir SQL sin ejecutarlo.**

## Variables de entorno relevantes

Ver `.env.example` / `lib/*/config.ts` para la lista completa. Las que tienen historia:

| Variable | Valor | Por qué |
|---|---|---|
| `AI_PROVIDER_ORDER` | `groq,google` | Solo entran proveedores con clave |
| `VEKTORA_OWNER_ID` | uuid | `npm run plan` lo valida contra `public.users` antes de gastar cuota |
| `CRON_SECRET` | secreto | Sin él los crons responden 503 (la puerta se cierra, no se abre) |
| `VEKTORA_SKILL_MATCH_THRESHOLD` | 0.95 | Medido: 0 de 435 pares distintos se fusionan |
| `VEKTORA_MATCH_VECTOR_FLOOR` / `_CEILING` | 0.73 / 0.89 | Medidos sobre tarea-vs-perfil, por extremos |
| `VEKTORA_MATCH_AUTO_ASSIGN_MIN` | 0.50 | Derivado del techo de un proveedor nuevo |
| `VEKTORA_MATCH_ESCALATE_AFTER_ROUNDS` | 4 | Rondas, no tiempo, para poder demostrarlo |
| `VEKTORA_QA_MIN_ATTEMPTS_BEFORE_REJECT` | 2 | Un solo veredicto no puede cerrar una tarea |

Los umbrales son **medidos, no puestos a ojo**. No cambiarlos sin volver a medir
(`npm run skills:calibrate`) y sin revisar las pruebas que los fijan.

## Convenciones de código

- TypeScript estricto sin `any`. `exactOptionalPropertyTypes` está activo: no asignar
  `undefined` a opcionales.
- Zod `strictObject` en las fronteras; las invariantes de dominio (aciclicidad, sumas de
  presupuesto, criterios sin dependencia humana) son **refinements**, para que el bucle de
  auto-reparación le devuelva al modelo un mensaje accionable. Un párrafo de prompt es una
  esperanza; un refinement es una garantía.
- Degradar, no fallar: sin embeddings → ranking determinista; sin cuota → se reintenta luego.
  Pero **una avería nuestra nunca se convierte en veredicto** contra un proveedor.
- Todo lo que el sistema decide queda explicado en la base (`match_explanation`,
  `qa_criteria_results`, `qa_feedback`, `planner_metadata.corrections`, `ai_runs`).
- Interfaz, rutas, mensajes y comentarios en **español**. Los mensajes de error dicen en
  segunda persona **qué hacer**, no solo que algo es inválido.
- Sistema visual en `app/globals.css` (`oklch`, primitivas `.tarjeta`, `.boton`, `.campo`…).
  El color de estado es un dato; el de marca es violeta-magenta, fuera de la gama de estados.
  Animaciones ≤ 260 ms y respetando `prefers-reduced-motion`. Tipografía del sistema, sin
  `next/font/google`.

### Trampas de Next 16

- `await cookies()` **antes** de leer el entorno, o Next intenta prerenderizar y falla el build.
- `typedRoutes` está activo: un `redirect` a una ruta armada con texto necesita `as Route`.
- `next build` compila en modo `standalone` (lo usa el Dockerfile) y puede tocar
  `next-env.d.ts`: si aparece modificado, `git checkout next-env.d.ts`.

## Antes de dar un cambio por terminado

1. `npm run verify` en verde (y `npm run build` si tocaste `app/`).
2. Si tocaste SQL: correr `db/verify/` sobre base limpia.
3. Si tocaste UI: revisarla en el navegador, no solo compilando (así apareció un `<form>`
   anidado que ningún compilador marcaba).
4. Preguntarte si el cambio crea un estado del que el sistema no sale solo.
5. Resumir y **esperar confirmación**.

## Git

- Remoto: `https://github.com/Nicrolax/_JBDPA_Grupo_1.git` (rama `main`).
- Commits solo cuando se pidan. Después de cada commit, **verificar leyendo de vuelta** con
  `git show` / `git diff` que el contenido es el esperado: ya hubo commits que «reportaron
  éxito» con contenido obsoleto.
- Nunca commitear `.env` ni claves (ni el CA de Aiven, ni `k8s/secret.yaml`).

## Contexto de entrega

- Materia **Programación Avanzada (UTU)**, en equipo, rúbrica de 100 puntos: informe teórico,
  documentación técnica, repositorio accesible al docente, análisis estático y prueba en vivo.
  Sin fecha fija: se presenta cuando el producto esté terminado.
- Presentación en **URUCON Juniors 2026** (jornada de pósters, material en español).
- Documentación evaluable en `docs/` (índice en `00-indice.md`): 01–07, `guia-despliegue.md`,
  `informe-seguridad.md`, `diagramas/` y `defensa.md`.

### Examen de despliegue

El plan por fases (Docker → Aiven/Render → minikube → seguridad → documentación) y su
estado están en `docs/guia-despliegue.md`. Datos de prueba: contraseña pública
`Demo-Vektora-2026` (ver `db/seeds/02_datos_demo.sql`); el admin se crea con
`npm run cuenta:admin` en cada base.

Seguridad (Fase 5): `docs/informe-seguridad.md`. Workflows `seguridad.yml` (gitleaks,
`npm audit`, Trivy), `codeql.yml`, `zap.yml` (manual, SOLO contra la URL de Render) y
Dependabot. Las cabeceras de seguridad y la redirección sin sesión viven en
`next.config.ts` y las fija `tests/next-config.test.ts`. `imagen.yml` no publica una imagen
con vulnerabilidades altas o críticas corregibles.

## Documentación de diseño

El razonamiento detallado de cada fase (decisiones, bugs encontrados, calibraciones) está en
el Project de Claude «VEKTORA». Si hay que entender **por qué** algo es como es, buscarlo ahí
antes de cambiarlo.
