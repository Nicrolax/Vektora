# Guía de despliegue de VEKTORA

Cómo levantar VEKTORA desde cero en los tres niveles del examen, usando **solo servicios
gratuitos y sin tarjeta de crédito**. Está escrita para que otro grupo la pueda seguir sin
ayuda: cada paso dice qué hacer, qué se tiene que ver y qué hacer si no se ve.

| Nivel | Qué se despliega | Dónde | Estado |
|---|---|---|---|
| 1 | App + base en contenedores; imagen en ghcr.io | Tu PC con Docker | ✅ esta guía |
| 2 | Base en **Aiven** (SSL) + app en **Render** (HTTPS) | Nube | próxima fase |
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

## 2. Nivel 2 — Aiven y Render

*Próxima fase del examen.* Resumen de lo que viene: base PostgreSQL gratis en Aiven, carga
con `npm run sql:aplicar` por SSL (verificando el certificado con `DB_SSL_CA`), y la app en
Render desde el `Dockerfile` con las variables en el panel y URL HTTPS.

## 3. Nivel 3 — Kubernetes (minikube)

*Próxima fase del examen.*
