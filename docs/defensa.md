# Guía para la defensa

Para que **cualquiera de los cuatro** pueda mostrar el sistema y explicar cualquier archivo.
Los números de línea corresponden a la rama `main` al cierre del examen (fase 6).

---

## 1. Guion de la demo (≈ 10 minutos)

**Antes de empezar (15 minutos antes):**

1. Abrir <https://vektora.onrender.com/health> hasta ver `{"estado":"ok",…,"base":"ok"}`. El
   plan gratis de Render duerme el servicio y tarda cerca de un minuto en despertar.
2. En la consola de Aiven, comprobar que el servicio PostgreSQL esté **Running**; si está
   apagado por inactividad, encenderlo (*Power on*).
3. Tener abiertas tres pestañas: la app, el *Query editor* de Aiven y el repositorio en
   GitHub (pestaña *Actions*).

| # | Qué se muestra | Cómo | Qué decir |
|---|---|---|---|
| 1 | HTTPS | El candado en `https://vektora.onrender.com`. `http://` redirige solo | Render pone el certificado; la app además manda HSTS |
| 2 | Login y roles (R3) | Entrar con `cliente@vektora.test` / `Demo-Vektora-2026` | La contraseña se compara con un hash BCrypt de coste 12; la sesión es una cookie `httpOnly` firmada |
| 3 | El grafo | Panel → proyecto del consultorio odontológico | El sistema descompuso el objetivo en tareas con dependencias; los agentes adjudican y evalúan solos |
| 4 | Búsqueda y reporte (R6) | *Buscar* con filtros; *Reportes* | Consulta con filtros dinámicos, siempre parametrizada; reporte con `COUNT`, `SUM`, `AVG` y `GROUP BY` |
| 5 | **Alta de un dato** | Salir → *Crear una cuenta* con un correo nuevo, rol proveedor | Es un INSERT parametrizado en `auth.users` con el hash BCrypt; un trigger crea en la misma sentencia la fila de `public.users` y el perfil (todo o nada) |
| 6 | **El dato en Aiven** | En el *Query editor*: la consulta A de abajo | La fila que se acaba de crear desde la app, leída directo en la base de la nube |
| 7 | Permisos | Con la cuenta nueva, abrir la URL de un proyecto privado ajeno | Responde como si no existiera: RLS en la base, no solo en la interfaz |
| 8 | Entrega transaccional (R7) | Con la proveedora que tenga una tarea asignada (*Mi trabajo*), entregar | Bloquea la tarea, inserta el entregable, cambia el estado y audita: todo o nada |
| 9 | Autonomía | GitHub → *Actions* → *Agentes* | Cada 10–15 minutos GitHub llama a la app para emparejar y evaluar. Nadie aprueba nada |
| 10 | Seguridad | GitHub → *Security* y `docs/informe-seguridad.md` | Cinco análisis, con lo que encontraron y cómo se corrigió |

**Consulta A — la cuenta recién creada:**

```sql
select u.email, u.role, u.created_at
from public.users u
order by u.created_at desc
limit 3;
```

**Consulta B — la última entrega (si se hizo el paso 8):**

```sql
select t.code, t.status as estado_tarea, d.version, d.qa_status, d.submitted_at
from public.deliverables d
join public.project_tasks t on t.id = d.task_id
order by d.submitted_at desc
limit 3;
```

**Plan B si algo falla en vivo:**

| Problema | Qué hacer |
|---|---|
| Render no despierta | Mostrar la app local: `docker compose up -d` y <http://localhost:3000> (mismo código, misma imagen) |
| Aiven apagado o sin red | Igual que arriba; la base local se carga sola con `sql/` |
| Sin internet | Docker local o minikube (`kubectl get pods,svc`), más las capturas de `guia-despliegue.md` |
| Los agentes no corrieron | `npm run cron` desde una PC con el `.env` de Aiven, o *Actions → Agentes → Run workflow* |

---

## 2. Recorrido R1–R12 con archivo y línea

| Req. | Qué pide | Dónde mostrarlo | Frase para explicarlo |
|---|---|---|---|
| **R1** | ≥ 4 entidades, PK/FK, 1:N y N:M | `db/schema.sql:263` (`projects`), `:290` (`project_tasks`), `:248` (`provider_skills`, N:M), `:332` (`task_dependencies`, el DAG), `:380` (`task_applications`). Diagrama: `docs/diagramas/modelo-de-datos.md` | «14 tablas. Proyecto → tareas es 1:N; proveedor ↔ skill y tarea ↔ tarea son N:M con tabla puente.» |
| **R2** | CRUD en ≥ 3 entidades | Proyectos: `app/acciones/proyectos.ts:45` (crear), `:98` (editar), `:119` (estado), `:139` (eliminar). Cuentas: `lib/admin/index.ts:77` (listar), `:118` (rol), `:145` (borrar). Skills: `lib/admin/index.ts:169`, `:200`, `:234` | «Proyectos, cuentas, skills y perfil de proveedor tienen alta, lectura, edición y baja.» |
| **R3** | Login, BCrypt, ≥ 2 roles | `lib/auth/password.ts:18` (coste 12), `:54` (verificar, con hash señuelo en `:59`); `lib/auth/token.ts:54` (JWT HS256), `:83` (`timingSafeEqual`); `lib/auth/permisos.ts:40` (permisos por rol); `lib/auth/session.ts:78` y `:98` | «Cuatro roles. Las páginas usan `requirePermiso` y las acciones `exigirPermiso`; la base vuelve a comprobar con RLS.» |
| **R4** | Capas con interfaces | Interfaz `lib/auth/repository.ts:39` → `PostgresCuentasRepository :48`; `lib/proyectos/index.ts:38` → `:45`; servicio `lib/proyectos/index.ts:102`. Diagrama: `docs/diagramas/capas.md` | «Presentación (`app/`) → servicio → DAO (interfaz + `Postgres*`) → `lib/db`.» |
| **R5** | Herencia + interfaz con 2 implementaciones | `lib/errores/index.ts:32` (`VektoraError`, abstracta) y sus subclases `:55`–`:147`; `lib/ai/types.ts:124` (`LlmProvider`) → `lib/ai/providers/groq.ts:69` y `gemini.ts:91`; `lib/ai/telemetry.ts:44` → `:50`, `:67`, `:113` | «La IA usa Groq y, si falla, Gemini, detrás de la misma interfaz.» |
| **R6** | Búsqueda con filtros + JOIN + reporte | `lib/consultas/busqueda.ts:124` (filtros dinámicos), `:133` (ILIKE escapado), `:165` (JOIN); `lib/consultas/reporte.ts:62`–`:68` (`COUNT`, `SUM`, `AVG`, `GROUP BY`) | «El texto de la consulta solo cambia por una lista blanca; los valores van siempre como parámetros.» |
| **R7** | Transacción ≥ 2 tablas con commit/rollback | `lib/db/client.ts:176` (`transaction`), `:188` `begin`, `:191` `commit`, `:196` `rollback`; uso en `lib/entregas/index.ts:147` (`FOR UPDATE :74`, INSERT `:93`, UPDATE `:104`, auditoría `:116`). Prueba: `tests/integracion/base.test.ts:151` | «Si falla el último paso, no queda ni el entregable ni el cambio de estado.» |
| **R8** | Validaciones + excepción propia + sin errores internos | `lib/validacion/entrada.ts:63`, `:132`, `:180`; `lib/errores/index.ts:166` (`mensajeParaUsuario`) | «Ningún error interno llega a la pantalla: o es un `VektoraError` con un mensaje pensado para la persona, o un mensaje genérico.» |
| **R9** | Consultas preparadas | `lib/db/client.ts:141` (`query` con `values`); prueba de inyección `tests/integracion/base.test.ts:200` | «`'; drop table…` se busca como texto: nunca se concatena un valor.» |
| **R10** | Conexión por variables de entorno | `lib/db/config.ts:44` (esquema Zod de `DB_*`), `:73` (`cargarDbConfig`); `.env.example` | «La misma imagen corre en compose, Render y minikube; solo cambian las variables.» |
| **R11** | Script de tablas + ≥ 20 registros | `sql/01-crear-tablas.sql`, `sql/02-datos-prueba.sql` (30 skills, 6 cuentas, 2 proyectos, 8 tareas, 7 dependencias…) | «Se generan desde `db/` con `npm run sql:build`; CI comprueba que estén al día.» |
| **R12** | `/health` | `app/health/route.ts:23`; responde `:49` (200 o 503) | «200 si la app y la base responden en menos de 3 s. Lo usan Docker, Render y las probes de Kubernetes.» |

---

## 3. Preguntas probables por archivo

### `Dockerfile`

- **¿Por qué tres etapas?** Para que la imagen final no lleve el código fuente, las
  dependencias de desarrollo ni las herramientas de compilación: solo `server.js` de Next en
  modo `standalone`.
- **¿Por qué `USER vektora` (línea 63)?** Contenedor no root (uid 1001): si alguien ejecutara
  código dentro, no sería administrador.
- **¿Por qué borran npm (línea 51)?** Trivy encontró 22 vulnerabilidades solo en el npm de la
  imagen base, y en ejecución no se usa.
- **¿Hay contraseñas?** No. Ningún `ARG` ni `ENV` lleva secretos; llegan en tiempo de
  ejecución.

### `docker-compose.yml`

- **¿Cómo se carga la base?** `./sql` se monta en `/docker-entrypoint-initdb.d` (línea 30):
  PostgreSQL ejecuta esos scripts la primera vez, con el volumen vacío.
- **¿Por qué la app espera a la base?** `depends_on` con `condition: service_healthy` (línea
  58): la app arranca recién cuando `pg_isready` responde.
- **¿De dónde salen las contraseñas?** De `.env`, que está en `.gitignore`; el repo solo tiene
  `.env.example` con los nombres.

### `k8s/`

- **Deployment vs Service?** El Deployment dice qué contenedor correr y cuántas réplicas; el
  Service le da una dirección estable. La base es `ClusterIP` (solo adentro) y la app
  `NodePort` 30080.
- **ConfigMap vs Secret?** El ConfigMap lleva configuración no sensible (`DB_HOST`, `DB_SSL`);
  el Secret, contraseñas. `secret.yaml` real no se versiona: está `secret.yaml.example`.
- **¿Readiness o liveness?** Readiness (línea 49 de `app-deployment.yaml`): no le manda
  tráfico hasta que `/health` da 200. Liveness (línea 59): si deja de responder, lo reinicia.
- **¿Por qué un PVC?** Para que los datos de la base sobrevivan si el pod se reinicia.

### `render.yaml`

- **¿Qué es?** Un *Blueprint*: le dice a Render que construya el `Dockerfile`, en plan gratis,
  con `healthCheckPath: /health`. Las variables secretas están con `sync: false`: se cargan
  a mano en el panel y nunca quedan en el repo.

### `lib/db/client.ts`

- **¿Cómo evitan la inyección SQL?** La única forma de ejecutar SQL es `query(texto,
  [parámetros])` con `$1, $2…` (línea 141): el valor viaja aparte del texto.
- **¿Qué hace `asUser` (línea 209)?** Abre una transacción, cambia al rol `authenticated` y
  fija el id de la persona: así PostgreSQL aplica las políticas RLS como esa persona.
- **¿Qué pasa si una transacción falla a la mitad?** `rollback` (línea 196) y el error sigue
  hacia arriba: no queda nada a medias.

### `lib/db/config.ts`

- **¿Cómo se conecta a Aiven con SSL?** `DB_SSL=require` y el certificado de la CA en
  `DB_SSL_CA`: la conexión va cifrada y verifica que el servidor sea el de Aiven.

### `lib/auth/*`

- **¿Cómo guardan las contraseñas?** Hash BCrypt de coste 12 (`password.ts:18`): unos 250 ms
  por intento, lo que encarece la fuerza bruta.
- **¿Por qué un hash «señuelo» (`password.ts:59`)?** Si el correo no existe, igual se gasta el
  tiempo de una comparación. Así no se puede averiguar qué correos están registrados.
- **¿Qué hay en la cookie?** Un JWT HS256 con el id y el rol, firmado con `AUTH_SECRET`. Es
  `httpOnly` (el JavaScript no la lee), `SameSite=Lax` y `Secure` detrás de HTTPS
  (`cookie.ts:39`).
- **¿Dónde se decide qué puede hacer cada rol?** `permisos.ts:40`, en el servidor. Ocultar un
  botón no alcanza: lo que decide es el servidor.

### `db/00_plataforma.sql`

- **¿Qué es?** Lo que antes daba Supabase hecho: el esquema `auth` con `auth.users`
  (`password_hash` con un CHECK que exige formato BCrypt), la función `auth.uid()` y los roles
  `anon`, `authenticated` y `service_role` que usan las políticas RLS.

### `sql/`

- **¿Por qué están generados?** El SQL fuente está por fases en `db/`; `npm run sql:build` lo
  concatena en el orden correcto. `sql:check` corre en CI y falla si alguien los editó a mano.
- **¿Se pueden correr dos veces?** Sí, son idempotentes (`if not exists`, `on conflict`). CI
  los aplica dos veces seguidas para probarlo.

### `.github/workflows/`

- **`ci.yml`:** tipos, 371 pruebas, `sql/` al día y una base PostgreSQL real con las pruebas
  de integración y `db/verify`.
- **`imagen.yml`:** construye, prueba con compose, escanea con Trivy y solo entonces publica en
  ghcr.io.
- **`agentes.yml`:** el reloj. Llama a `/api/cron/emparejar` y `/api/cron/evaluar` con el
  `CRON_SECRET`.
- **`k8s.yml`:** levanta un clúster `kind` y aplica `k8s/` como en minikube.
- **`seguridad.yml`, `codeql.yml`, `zap.yml`:** los análisis del informe de seguridad.

### `next.config.ts`

- **¿Qué cabeceras de seguridad mandan?** CSP, `X-Frame-Options: DENY`, HSTS, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy` y COOP/COEP/CORP. Salieron del escaneo de ZAP.
- **¿Por qué la CSP tiene `'unsafe-inline'`?** Next inyecta scripts en línea para hidratar la
  página. El riesgo está acotado: React escapa todo y CodeQL no encontró XSS.

### `app/health/route.ts`

- **¿Por qué no dice por qué falla?** Un endpoint público que explica el error le regala
  información a cualquiera. Responde `ok` o `sin respuesta`, nada más.

### Preguntas generales

- **¿Por qué no Supabase y Vercel, como antes?** La consigna pide una base propia con scripts
  SQL (Aiven), la app desde un Dockerfile (Render), BCrypt y consultas preparadas en nuestro
  código, y Kubernetes. Con Supabase el login y las consultas los hacía la plataforma.
- **¿Qué pasa si se cae Groq?** El cliente de IA pasa solo a Gemini. Si fallan los dos, la
  tarea se reintenta en la siguiente vuelta; una falla nuestra nunca se convierte en un
  veredicto contra un proveedor.
- **¿Cuánto cuesta?** Nada: Aiven, Render, GitHub (Actions + ghcr.io), Groq y Google AI Studio
  en planes gratis, sin tarjeta.

---

## 4. Reparto sugerido

Cada integrante domina un bloque y puede responder los otros con esta guía.

| Bloque | Archivos | Tiempo en la demo |
|---|---|---|
| Base y datos (R1, R7, R9, R11) | `db/`, `sql/`, `lib/db/`, `lib/entregas/` | Pasos 5, 6 y 8 |
| Login y seguridad (R3, R8, informe) | `lib/auth/`, `lib/errores/`, `next.config.ts`, `informe-seguridad.md` | Pasos 2, 7 y 10 |
| Despliegue (Niveles 1–3) | `Dockerfile`, `docker-compose.yml`, `render.yaml`, `k8s/`, workflows | Pasos 1 y 9, plan B |
| Dominio y arquitectura (R2, R4, R5, R6) | `lib/` por dominio, `app/acciones/`, `docs/diagramas/` | Pasos 3 y 4 |

---

## 5. Lista de control de la entrega (anexo de la consigna)

| Ítem | Estado | Evidencia |
|---|---|---|
| R1 a R12 cumplidos, con la tabla en el README | ✅ | `README.md`, sección 2 de esta guía |
| `docker compose up` funciona desde cero | ✅ en CI · ⬜ en una PC | El workflow **Imagen** lo hace en cada push con una máquina limpia. Falta la captura 1 en una PC con Docker Desktop |
| Sin contraseñas en código, Dockerfile, manifiestos ni historial | ✅ | gitleaks: 0 hallazgos en todo el historial (`informe-seguridad.md`, §5) |
| `.env.example` presente y `.env` en `.gitignore` | ✅ | `.env.example`, `.gitignore`, `.dockerignore` |
| Imagen publicada en ghcr.io (pública) | ✅ | Captura 4 |
| Conexión a Aiven por SSL | ✅ | `npm run db:check`: «conexión cifrada con SSL» y «certificado del servidor verificado contra DB_SSL_CA»; falta la captura 5 |
| URL de Render accesible por HTTPS | ✅ | Captura 6 |
| Manifiestos en `k8s/` y pods en Running | ✅ | Captura 7 y el workflow **Kubernetes** (kind) |
| Resultados de los análisis de seguridad | ✅ | `informe-seguridad.md`; falta la captura S1 de SonarLint |
| README, guía, diagramas e informe en el repo | ✅ | `README.md`, `docs/guia-despliegue.md`, `docs/diagramas/`, `docs/informe-seguridad.md` |
| Guía probada por otro grupo | ⬜ | Pasarles `docs/guia-despliegue.md` y anotar lo que les costó |
| Todos pueden explicar cada archivo | ⬜ | Repasar las secciones 2 y 3 de esta guía, cada uno su bloque (sección 4) |

**Capturas que faltan** (se agregan a `docs/capturas/` y se enlazan en la guía donde dice 📷):

- **1, 2 y 3** — necesitan Docker Desktop en una PC: `docker compose up`, la app local con una
  tarea entregada y el `select` de esa fila.
- **5** — consola de Aiven: el servicio en *Running* y el `SELECT` de la consulta A (sección
  1) con la fila creada desde la app.
- **S1** — SonarLint en VS Code sobre `lib/` y `app/`.
