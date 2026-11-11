# Guía de despliegue de VEKTORA

Cómo levantar VEKTORA desde cero en los tres niveles del examen, usando **solo servicios
gratuitos y sin tarjeta de crédito**. Está escrita para que otro grupo la pueda seguir sin
ayuda: cada paso dice qué hacer, qué se tiene que ver y qué hacer si no se ve.

| Nivel | Qué se despliega | Dónde | Estado |
|---|---|---|---|
| 1 | App + base en contenedores; imagen en ghcr.io | Tu PC con Docker | ✅ esta guía |
| 2 | Base en **Aiven** (SSL) + app en **Render** (HTTPS) | Nube | ✅ base · Render: próxima fase |
| 3 | App + base en **Kubernetes** | minikube en tu PC | próxima fase |

> **Credenciales.** Ningún archivo del repositorio tiene contraseñas. Los valores reales van
> en `.env` (ignorado por Git y por Docker), en el panel de Render o en un Secret de
> Kubernetes. Si en algún paso te encontrás pegando una contraseña en un archivo que se
> sube a GitHub, frená: es un error.

---

## 0. Requisitos

| Herramienta | Para qué | Cómo comprobarlo |
|---|---|---|
| Git | clonar el repo | `git --version` |
| Docker Desktop (Windows/macOS) o Docker Engine (Linux) | Nivel 1 | `docker --version` y `docker compose version` |
| Node.js 22 (opcional) | correr scripts sin Docker | `node --version` |

En **Windows**, Docker Desktop necesita WSL 2. Si no lo tenés: PowerShell como
administrador → `wsl --install` → reiniciar → instalar Docker Desktop desde
<https://www.docker.com/products/docker-desktop/> (gratis para uso educativo) → abrirlo y
esperar a que diga *Engine running*.

```bash
git clone https://github.com/Nicrolax/_JBDPA_Grupo_1.git vektora
cd vektora
```

---

## 1. Nivel 1 — Docker y docker compose

### 1.1 Qué hay en el repositorio

| Archivo | Qué hace |
|---|---|
| `Dockerfile` | Imagen en 3 etapas (`deps` → `build` → `runner`). La final es `node:22-alpine` con el servidor `standalone` de Next, **sin código fuente ni devDependencies**, corre como el usuario `vektora` (**uid 1001, no root**) y tiene `HEALTHCHECK` contra `/health`. |
| `.dockerignore` | Deja afuera de la imagen `.env`, `.git`, `node_modules`, `docs`, `k8s`, certificados. |
| `docker-compose.yml` | Dos servicios: `db` (`pgvector/pgvector:pg16`) y `app` (la imagen del Dockerfile). La base se carga sola con `sql/` la primera vez. La app espera a que la base esté sana. |
| `.env.example` | Los NOMBRES de todas las variables, sin valores. |
| `sql/01-crear-tablas.sql` | Esquema completo (plataforma `auth`, 16 tablas, triggers, índices, RLS, funciones). |
| `sql/02-datos-prueba.sql` | 30 skills + datos de la demo (6 cuentas, 2 proyectos, 8 tareas…). |

### 1.2 Configurar `.env`

```bash
cp .env.example .env
```

Completar como mínimo:

| Variable | Valor |
|---|---|
| `POSTGRES_DB` | `vektora` |
| `POSTGRES_USER` | `vektora` |
| `POSTGRES_PASSWORD` | una contraseña inventada (no la reutilices en otro lado) |
| `AUTH_SECRET` | 64 caracteres al azar: `openssl rand -hex 32` |
| `CRON_SECRET` | otro valor al azar: `openssl rand -hex 24` |
| `GROQ_API_KEY`, `GOOGLE_AI_API_KEY` | opcionales: sin ellas no se pueden crear proyectos nuevos, pero la demo funciona |

Sin `openssl` (Windows): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Los `DB_*` de `.env` **no se usan** con compose: el compose los fija al contenedor `db`
(`DB_HOST=db`, `DB_SSL=disable`). Así el mismo `.env` puede tener los datos de Aiven para el
Nivel 2.

### 1.3 Levantar

```bash
docker compose up --build -d
docker compose ps
```

La primera vez tarda unos minutos (descarga imágenes y compila Next). Se tiene que ver:

```
NAME             SERVICE   STATUS
vektora-db-1     db        Up (healthy)
vektora-app-1    app       Up (healthy)
```

📷 **Captura 1** — `docker compose up` terminado y `docker compose ps` con los dos servicios
`healthy`.

### 1.4 Comprobar

```bash
curl http://localhost:3000/health
# {"estado":"ok","app":"ok","base":"ok","configuracion":"ok","ms":4}

docker compose exec app id -u
# 1001   ← el proceso NO corre como root

docker compose exec db psql -U vektora -d vektora -c "select count(*) from public.project_tasks"
# 8
```

### 1.5 La app guarda y lee de la base (evidencia del Nivel 1)

1. Abrir <http://localhost:3000> → entrar con `sofia.diseno@vektora.test` / `Demo-Vektora-2026`
   (contraseña pública de los datos de prueba).
2. **Mi trabajo** → tarea **T-02** → **Entregar**. Completar resumen, contenido y la evidencia
   de cada criterio → **Entregar para evaluación**. La tarea pasa a *entregada*.
3. Ver el dato en la base:

```bash
docker compose exec db psql -U vektora -d vektora -c \
  "select d.version, d.summary, t.code, t.status, a.action
     from deliverables d
     join project_tasks t on t.id = d.task_id
     join audit_logs a on a.entity_id = d.id
    order by d.submitted_at desc limit 1"
```

Las tres tablas (`deliverables`, `project_tasks`, `audit_logs`) se escribieron en **una sola
transacción** (requisito R7).

📷 **Captura 2** — la app en el navegador con la tarea entregada.
📷 **Captura 3** — el `select` anterior mostrando la fila creada desde la app.

### 1.6 Cuenta de administración (opcional)

La imagen no lleva los scripts de desarrollo (es mínima a propósito). Con Node instalado en
la PC (`npm ci` una vez), apuntando al puerto que el compose publica en `127.0.0.1`:

```bash
DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=vektora DB_USER=vektora DB_PASSWORD='<la del .env>' DB_SSL=disable \
ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD='al-menos-12-caracteres' npm run cuenta:admin
```

### 1.7 Imagen en GitHub Container Registry (ghcr.io)

No hay que hacer nada a mano: el workflow `.github/workflows/imagen.yml` corre en cada push
a `main`. Construye la imagen, **la prueba con docker compose** (health 200, 8 tareas, uid ≠ 0,
sin cabecera `X-Powered-By`) y solo si todo pasa la publica como:

- `ghcr.io/nicrolax/vektora:latest`
- `ghcr.io/nicrolax/vektora:sha-<commit>`

Se autentica con el `GITHUB_TOKEN` automático de Actions: no hay ninguna contraseña guardada.

**Una sola vez**, después del primer push: GitHub → perfil → **Packages** → `vektora` →
**Package settings** → **Change visibility** → **Public**. Así Render y minikube la
descargan sin credenciales.

```bash
docker pull ghcr.io/nicrolax/vektora:latest
```

📷 **Captura 4** — la página del paquete en GitHub con las etiquetas `latest` y `sha-…`.

### 1.8 Apagar y empezar de cero

```bash
docker compose down        # apaga, conserva los datos (volumen `datos`)
docker compose down -v     # apaga y BORRA la base: la próxima vez se recarga desde sql/
docker compose logs -f app # ver qué pasa
```

### 1.9 Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `Definí POSTGRES_DB en .env` | Falta `.env` o la variable | `cp .env.example .env` y completarlo |
| `app` queda `unhealthy` y `/health` da `"configuracion":"incompleta"` | `AUTH_SECRET` vacío o corto | Poner 64 caracteres al azar y `docker compose up -d` |
| `/health` da `"base":"sin respuesta"` | La base todavía arranca o la contraseña cambió | `docker compose logs db`. Si cambiaste `POSTGRES_PASSWORD` después de crear el volumen: `docker compose down -v` |
| Los datos de prueba no aparecen | El volumen ya existía (los scripts de `sql/` solo corren con la base VACÍA) | `docker compose down -v && docker compose up -d` |
| `port is already allocated` (5432 o 3000) | Hay otro PostgreSQL o app usando el puerto | `DB_PUERTO_LOCAL=5433` en `.env` para la base; para la app, frenar lo que use el 3000 |
| Entro y me devuelve a `/entrar` | Abriste por `https://` o con otra IP | Usar `http://localhost:3000` (la cookie `Secure` solo se activa detrás de HTTPS) |
| Crear proyecto da «La inteligencia artificial no está configurada» | Faltan las claves de IA | Completar `GROQ_API_KEY` y/o `GOOGLE_AI_API_KEY`. La demo funciona sin ellas |

---

## 2. Nivel 2 — Base en Aiven (PostgreSQL con SSL)

### 2.1 Crear el servicio (gratis, sin tarjeta)

1. Registrarse en <https://console.aiven.io/signup> (con GitHub o Google es lo más rápido).
2. **Create service → PostgreSQL**. Aiven propone un plan *Developer* que usa créditos de
   prueba y después cuesta USD 5 por mes: **no elegirlo**. Ir a **Customize plan and cloud**
   y en *Service tier* marcar **Free** («Free forever, $0»). El plan queda `Free-1-1gb`
   (1 CPU, 1 GB de RAM, 1 GB de disco) y la nube «North America» (el plan gratis no permite
   elegir región).
3. Nombre del servicio: `vektora-db` → **Create service**. Esperar a que pase de *Building*
   a **Running** (unos 4 minutos).

> El plan Free **se apaga solo si no se usa** durante un tiempo. Si la app o `db:check` no
> conectan, entrar a la consola y tocar **Power on**. Antes de la defensa, encenderlo con
> unos minutos de margen.

### 2.2 Datos de conexión y certificado

En la página del servicio, sección **Connection information**:

- **Service URI**: `postgres://avnadmin:<contraseña>@<host>:<puerto>/defaultdb?sslmode=require`.
  Tiene la contraseña: **no pegarla en chats, issues ni archivos del repo**.
- **CA certificate** → *Download* (`ca.pem`). Es el certificado de la autoridad de Aiven:
  con él la app verifica que del otro lado esté de verdad el servidor de Aiven (y no alguien
  en el medio).

Cargar los dos en `.env` sin escribirlos a mano:

```bash
npm run db:configurar
```

Pide la Service URI (no se ve al pegarla) y la ruta de `ca.pem`, y escribe en `.env`:
`DB_HOST`, `DB_PORT`, `DB_NAME=defaultdb`, `DB_USER=avnadmin`, `DB_PASSWORD`,
`DB_SSL=require`, `DB_SSL_CA` (el PEM en una línea) y `DB_POOL_MAX=5`. El resto de `.env`
no se toca. `.env` está en `.gitignore`.

### 2.3 Comprobar la conexión cifrada y cargar los scripts

```bash
npm run db:check        # la primera vez falla en «Extensiones» y «Tablas»: la base está vacía
npm run sql:aplicar     # ejecuta sql/01-crear-tablas.sql y sql/02-datos-prueba.sql en Aiven
npm run db:check        # ahora todo en ✓
```

`db:check` tiene que mostrar, entre otras cosas:

```
✓ conexión cifrada con SSL
✓ certificado del servidor verificado contra DB_SSL_CA
✓ rol authenticated (el usuario de conexión puede usarlo)
✓ SET LOCAL ROLE authenticated + auth.uid() funcionan
```

`sql:aplicar` se niega a ejecutar nada si la conexión no va cifrada (con `DB_SSL=require`).
En Aiven el usuario `avnadmin` **no es superusuario**: `db/00_plataforma.sql` está escrito
para eso (crea los roles y se los asigna a sí mismo; `service_role` se crea sin
`BYPASSRLS`, que la app no usa).

Crear la cuenta de administración en esta base:

```bash
ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD='al-menos-12-caracteres' npm run cuenta:admin
```

### 2.4 Evidencia: un dato creado desde la app y leído con SELECT en Aiven

1. Con el `.env` apuntando a Aiven: `npm run dev` y abrir <http://localhost:3000>.
2. Crear un dato desde la interfaz. Por ejemplo, **Crear una cuenta** nueva en `/entrar`, o
   como admin **Administración → Catálogo de skills → Nueva skill**.
3. En la consola de Aiven, servicio `vektora-db` → **Query editor** (o con cualquier
   cliente PostgreSQL usando la Service URI):

```sql
select u.email, u.role, u.created_at
  from public.users u
 order by u.created_at desc
 limit 5;
```

📷 **Captura 5** — el servicio `vektora-db` en *Running* y el `SELECT` con la fila creada
desde la app.

### 2.5 Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `db:check`: «no se pudo conectar» / timeout | El servicio Free se apagó por inactividad | Consola de Aiven → **Power on** y esperar *Running* |
| `self-signed certificate in certificate chain` | `DB_SSL_CA` vacío o de otro servicio | Volver a correr `npm run db:configurar` con el `ca.pem` de **este** servicio |
| `DB_SSL=require pero la conexión NO va cifrada` | Se puso `DB_SSL=disable` o un host equivocado | `DB_SSL=require` y el host de Aiven |
| `too many connections` | El plan Free admite pocas conexiones | Dejar `DB_POOL_MAX=5` y no correr varias copias de la app a la vez |
| `db:check`: «no es miembro de authenticated» | Los roles los creó otro usuario | Como el dueño de los roles: `grant anon, authenticated to avnadmin;` |

## 3. Nivel 2 — App en Render (HTTPS)

*Próxima fase del examen:* la app en Render desde el `Dockerfile`, con las mismas variables
en el panel *Environment* y URL HTTPS.

## 4. Nivel 3 — Kubernetes (minikube)

*Próxima fase del examen.*
