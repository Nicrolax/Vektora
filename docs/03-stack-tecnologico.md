# Stack tecnológico

Cada tecnología va acompañada del motivo concreto por el que se eligió. Fuente de verdad:
`package.json`, `Dockerfile`, `docker-compose.yml`, `render.yaml` y `k8s/` del repositorio.
Todo es gratuito y sin tarjeta de crédito.

## Lenguaje y ejecución

| Tecnología | Versión | Por qué se eligió |
|---|---|---|
| **TypeScript** | 7.0 | El dominio es un grafo con invariantes (aciclicidad, presupuestos que suman exacto, estados de tarea). El tipado estático permite expresar esos contratos y que el compilador los verifique. Se usa en modo `strict` más `noUncheckedIndexedAccess` y `exactOptionalPropertyTypes`: acceder a `array[i]` obliga a tratar el `undefined`, que es la fuente habitual de errores al recorrer grafos. |
| **Node.js** | 22 (`node:22-alpine`) | Runtime del servidor. Aporta `fetch` y `crypto` nativos, así que no hacen falta un cliente HTTP ni una librería de JWT. |
| **tsx** | 4.23 | Ejecuta TypeScript sin paso de compilación para los guiones de operación (`scripts/`). |

## Framework y presentación

| Tecnología | Versión | Por qué se eligió |
|---|---|---|
| **Next.js** (App Router) | 16.4 | Un solo proyecto para interfaz y servidor. Los **Server Actions** (`app/acciones/`) son los únicos puntos de escritura: corren en el servidor, así que la conexión a la base y las claves de IA nunca llegan al navegador. Los **Route Handlers** dan `/health` y los puntos de entrada de los agentes (`/api/cron/*`). Compila en modo `standalone` para una imagen Docker chica. |
| **React** | 19.3 | Modelo de componentes de la interfaz; es el que Next.js integra. Escapa todo texto por defecto (defensa contra XSS). |
| **Tailwind CSS** | 4.3 | Estilos por utilidades, sin hojas de estilo separadas que se desincronizan del marcado. |
| **Componentes propios** | — | `components/ui/primitivas.tsx` y las clases de `app/globals.css` (`.tarjeta`, `.boton`, `.campo`…). Para una interfaz de este tamaño, un puñado de primitivas propias es menos código que mantener que una librería de componentes, y queda entero bajo el análisis estático. El logo y el grafo de tareas son SVG dibujados por el propio código (`components/grafo/`). |

## Persistencia y acceso a datos

| Tecnología | Versión | Por qué se eligió |
|---|---|---|
| **PostgreSQL** | 16 (local, minikube) · 18 (Aiven) | El modelo es relacional con integridad fuerte: claves foráneas, restricciones CHECK y **disparadores** que impiden estados imposibles —como un ciclo en el grafo de tareas— aunque el código de aplicación falle. **Row Level Security** en las 14 tablas: cada persona ve lo suyo aunque una consulta tuviera un error. |
| **pgvector** | — | Búsqueda por similitud semántica (matching de tareas con proveedores) dentro de la misma base que los datos relacionales, con índices HNSW y distancia coseno. Una base vectorial aparte obligaría a sincronizar dos fuentes. |
| **pg** (node-postgres) | 8.23 | Cliente de PostgreSQL. Se envuelve en `lib/db/client.ts`, que expone **solo** consultas parametrizadas (`$1, $2…`, el equivalente a `PreparedStatement`), `transaction()` con commit/rollback y `asUser()`, que aplica RLS como la persona que hace el pedido. |
| **bcryptjs** | 3.0 | Hash de contraseñas con BCrypt coste 12, en JavaScript puro: no necesita compilar módulos nativos dentro de la imagen Docker. |
| **dotenv** | 18.0 | Carga `.env` en los guiones de línea de comandos (Next lo hace solo en la app). |

## Validación e inteligencia artificial

| Tecnología | Versión | Por qué se eligió |
|---|---|---|
| **Zod** | 4.6 | Valida la salida de los modelos de lenguaje, que es texto sin garantías, y las entradas de los formularios. Los invariantes del dominio se expresan como refinamientos, de modo que un error de validación produce un mensaje accionable que se le devuelve al modelo para que se corrija solo. |
| **Groq API** | `openai/gpt-oss-120b` | Proveedor primario de generación. Free tier y latencia baja. |
| **Google AI Studio** | `gemini-3.6-flash` | Proveedor de respaldo automático ante fallo o cuota agotada del primario. |
| **Google AI Studio** | `gemini-embedding-001` | Vectorización a 1536 dimensiones para la búsqueda semántica de proveedores y tareas. |

> Los nombres de modelo son **configuración, no arquitectura**: caducan. `llama-3.3-70b-versatile`
> y `gemini-2.5-flash` se retiraron durante el desarrollo y empezaron a devolver 404. El
> sistema trata ese 404 como error de configuración y `npm run ai:models` consulta qué
> modelos admite cada clave.

## Despliegue

| Tecnología | Nivel | Por qué se eligió |
|---|---|---|
| **Docker** (multi-etapa) + **docker compose** | 1 | La misma imagen corre en la PC, en Render y en Kubernetes. Etapa final `node:22-alpine` sin npm, usuario sin privilegios (uid 1001) y `HEALTHCHECK` sobre `/health`. compose levanta la app y la base, que se carga sola con `sql/`. |
| **GitHub Container Registry** (ghcr.io) | 1 | Registro de imágenes gratuito para repos públicos; se publica desde Actions con el token de cada ejecución, sin guardar contraseñas. |
| **Aiven** PostgreSQL (plan gratis) | 2 | Base gestionada con pgvector y **conexión SSL** verificando el certificado de la CA. |
| **Render** (plan gratis) | 2 | Construye el `Dockerfile` del repositorio y lo publica con **HTTPS**. Las credenciales se cargan en su panel (`render.yaml` las declara con `sync: false`). |
| **GitHub Actions** | 2 | CI, publicación de la imagen, análisis de seguridad y el **reloj de los agentes**: llama a `/api/cron/emparejar` y `/api/cron/evaluar` cada 15 y 10 minutos. Es lo que hace que el sistema avance sin que nadie intervenga. |
| **minikube** / **kind** | 3 | Kubernetes local (minikube en la PC; kind en CI) para la app y la base, con Deployments, Services, ConfigMap, Secret, probes y un volumen persistente. |

## Pruebas, verificación y seguridad

| Tecnología | Versión | Por qué se eligió |
|---|---|---|
| **Vitest** | 5.1 | Ejecuta TypeScript nativamente y comparte la resolución de rutas del proyecto. 371 pruebas unitarias de la lógica de decisión, sin red ni base, que es donde el sistema puede equivocarse en silencio. Más 16 de integración contra un PostgreSQL real (`tests/integracion`, en CI). |
| **db/verify/** sobre PostgreSQL desechable | 16 | Las funciones SQL se prueban por comportamiento (DAG, ciclos, matching, juez, cuotas, RLS) antes de aplicarse. Corre en CI. |
| **CodeQL**, **Trivy**, **OWASP ZAP**, **gitleaks**, **npm audit**, **Dependabot** | — | Análisis SSDLC automatizados en GitHub Actions. Resultados en [`informe-seguridad.md`](informe-seguridad.md). |

## Coherencia entre lo declarado y lo implementado

Toda tecnología de esta lista aparece en `package.json`, en el `Dockerfile`, en
`docker-compose.yml`, en `render.yaml`, en `k8s/` o en `.github/workflows/`. Las versiones
de las librerías son las del `package-lock.json`.

---

**Uso de IA y autoría.** Este documento se elaboró con asistencia de Claude (Anthropic,
modelo `claude-opus-5`). Las decisiones de diseño, la revisión y la verificación son de los
autores, que asumen la responsabilidad sobre su contenido. Constancia formal en
[`11-declaracion-de-uso-de-ia.md`](11-declaracion-de-uso-de-ia.md).
