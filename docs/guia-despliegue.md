# Guía de despliegue de VEKTORA

Cómo levantar VEKTORA desde cero en los tres niveles del examen, usando **solo servicios
gratuitos y sin tarjeta de crédito**. Está escrita para que otro grupo la pueda seguir sin
ayuda: cada paso dice qué hacer, qué se tiene que ver y qué hacer si no se ve.

| Nivel | Qué se despliega | Dónde | Estado |
|---|---|---|---|
| 1 | App + base en contenedores; imagen en ghcr.io | Tu PC con Docker | ✅ esta guía |
| 2 | Base en **Aiven** (SSL) + app en **Render** (HTTPS) | Nube | ✅ esta guía |
| 3 | App + base en **Kubernetes** | minikube en tu PC | ✅ esta guía |

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

### 3.1 Qué hay en el repositorio

| Archivo | Qué hace |
|---|---|
| `render.yaml` | *Blueprint*: un servicio web `vektora` construido **desde el `Dockerfile`**, plan **free**, health check en `/health`. Los valores secretos llevan `sync: false`: Render los pide en el panel y nunca están en el repo. |
| `scripts/render-env.ts` | `npm run render:env` arma `.env.render` (ignorado por Git) con la conexión a Aiven ya probada y un `AUTH_SECRET` / `CRON_SECRET` **nuevos de producción**, sin imprimir valores. |
| `.github/workflows/agentes.yml` | El «reloj» de los agentes (ver 3.4). |

### 3.2 Crear el servicio (gratis, sin tarjeta)

1. `npm run render:env -- --ia ruta/a/tu/.env.local` (el `--ia` es opcional: copia
   `GROQ_API_KEY` y `GOOGLE_AI_API_KEY` si las tenés).
2. Entrar a <https://dashboard.render.com> con **GitHub**.
3. **New → Blueprint** → *Public Git Repository* →
   `https://github.com/Nicrolax/_JBDPA_Grupo_1` → **Continue**. (El repo es público, así que
   no hace falta darle a Render acceso a la cuenta de GitHub.)
4. *Blueprint Name*: `vektora`. Render muestra «Create web service vektora» y una fila por
   cada variable `sync: false`. Completar con los valores de `.env.render`: `DB_HOST`,
   `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_CA` (el certificado tal cual),
   `AUTH_SECRET`, `CRON_SECRET` y, opcionalmente, las dos claves de IA.
5. **Deploy Blueprint**. Render construye la imagen del `Dockerfile` (varios minutos la
   primera vez), la arranca y espera a que `/health` dé 200 antes de mandarle tráfico.

La URL queda en **`https://vektora.onrender.com`**, con certificado HTTPS automático.

### 3.3 Comprobar

```bash
curl https://vektora.onrender.com/health
# {"estado":"ok","app":"ok","base":"ok","configuracion":"ok",...}

curl -I http://vektora.onrender.com/health      # 301 → https:// (Render fuerza HTTPS)
curl -I https://vektora.onrender.com/panel      # 307 → /entrar (sin sesión no se entra)
curl -X POST https://vektora.onrender.com/api/cron/emparejar   # 401 sin CRON_SECRET
```

Entrar con `cliente@vektora.test` / `Demo-Vektora-2026`. Como Render manda
`x-forwarded-proto: https`, la cookie de sesión sale con `Secure` además de `HttpOnly` y
`SameSite=Lax` (en el navegador: herramientas de desarrollo → Application → Cookies →
`vektora_sesion`).

📷 **Captura 6** — la app en `https://vektora.onrender.com` con el candado de HTTPS visible.

### 3.4 Agentes autónomos con GitHub Actions

El plan gratis de Render no tiene tareas programadas. El workflow **Agentes** hace de reloj:
llama por HTTPS a `/api/cron/emparejar` (cada 15 min) y `/api/cron/evaluar` (cada 10 min)
con la cabecera `Authorization: Bearer <CRON_SECRET>`.

En GitHub → *Settings → Secrets and variables → Actions*:

- **Variable** `APP_URL` = `https://vektora.onrender.com`
- **Secreto** `CRON_SECRET` = el mismo valor que en Render (está en `.env.render`)

Para dispararlo a mano (útil en la defensa): *Actions → Agentes → Run workflow*. La
respuesta muestra qué tareas se adjudicaron y qué entregas evaluó el juez.

### 3.5 Límites del plan gratis

- Render **se duerme tras 15 min sin tráfico** y tarda ~1 min en despertar: abrir la URL un
  par de minutos antes de la defensa. El workflow de agentes, al dispararse, lo despierta.
- 750 horas por mes de instancia: alcanzan para un servicio encendido todo el mes.
- Aiven Free también se apaga si no se usa: si `/health` da `"base":"sin respuesta"`,
  encenderlo desde la consola de Aiven (**Power on**).

### 3.6 Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| El deploy queda en *Deploy failed* con `/health` en 503 | Falta `AUTH_SECRET` o un `DB_*` | Render → servicio → **Environment**, completar y *Save, rebuild and deploy* |
| `/health` da `"base":"sin respuesta"` | Aiven apagado o datos de conexión mal copiados | Encender Aiven; revisar `DB_HOST`, `DB_PORT`, `DB_PASSWORD` |
| `self-signed certificate in certificate chain` en los logs | `DB_SSL_CA` vacío o incompleto | Pegar el certificado entero, de `-----BEGIN` a `-----END-----` |
| Entrar no deja sesión | Se abrió por `http://` | Usar siempre `https://` (Render redirige solo) |
| El workflow Agentes termina con «Faltan la variable APP_URL o el secreto CRON_SECRET» | No se cargaron en GitHub | Ver 3.4 |
| El workflow da 401 | El `CRON_SECRET` de GitHub no es igual al de Render | Copiar el mismo valor en los dos lados |

## 4. Nivel 3 — Kubernetes (minikube)

La app **y la base** corren dentro del clúster. Decisión: la base va dentro de Kubernetes
(con un volumen persistente) para que el taller sea autónomo y no dependa de internet ni de
Aiven. En Render se usa Aiven; el código es exactamente el mismo, solo cambian las variables.

### 4.1 Qué hay en `k8s/`

| Archivo | Contenido |
|---|---|
| `app-deployment.yaml` | Imagen `ghcr.io/nicrolax/vektora:latest`; `envFrom` ConfigMap + Secret; `requests` 250m/256Mi, `limits` 1 CPU/512Mi; `readinessProbe` y `livenessProbe` HTTP en `/health`; `runAsNonRoot` (uid 1001), sin escalada de privilegios, `readOnlyRootFilesystem` |
| `app-service.yaml` | `NodePort` 30080 → 3000 |
| `db-deployment.yaml` | `pgvector/pgvector:pg16` con `PersistentVolumeClaim` de 1 Gi; `requests`/`limits`; probes `exec: pg_isready`; los scripts de `sql/` montados en `/docker-entrypoint-initdb.d` |
| `db-service.yaml` | `ClusterIP` `vektora-db` (la base no se expone fuera del clúster) |
| `configmap.yaml` | Configuración no secreta: `DB_HOST=vektora-db`, `DB_PORT`, `DB_NAME`, `DB_SSL=disable`, `PORT`… |
| `secret.yaml.example` | Los nombres de los secretos con valores de ejemplo. El real, `k8s/secret.yaml`, está en `.gitignore` |
| `kustomization.yaml` | `kubectl apply -k k8s/` aplica todo |

### 4.2 Instalar minikube y kubectl (gratis)

- **kubectl**: `winget install -e --id Kubernetes.kubectl` (Windows) o
  <https://kubernetes.io/docs/tasks/tools/>.
- **minikube**: <https://minikube.sigs.k8s.io/docs/start/>. En Windows, si el instalador pide
  administrador, alcanza con bajar `minikube-windows-amd64.exe` de
  <https://github.com/kubernetes/minikube/releases/latest>, renombrarlo a `minikube.exe` y
  dejarlo en una carpeta del `PATH`.
- Un *driver*: con Docker Desktop, `--driver=docker`; sin Docker, **VirtualBox** (gratis):
  `--driver=virtualbox`. En Windows con Hyper-V activo, agregar `--no-vtx-check`.

```bash
minikube start --driver=virtualbox --cpus=4 --memory=6144 --no-vtx-check
kubectl get nodes          # minikube   Ready
```

### 4.3 Desplegar

```bash
npm run k8s:secreto                                 # k8s/secret.yaml con valores aleatorios
kubectl apply -f k8s/secret.yaml                    # credenciales → Secret
kubectl create configmap vektora-sql --from-file=sql/   # scripts SQL → ConfigMap (~170 KB < 1 MiB)
kubectl apply -k k8s/                               # ConfigMap, base, app y servicios
kubectl get pods,svc -w                             # esperar 1/1 Running en los dos pods
```

Sin Node: `cp k8s/secret.yaml.example k8s/secret.yaml` y reemplazar cada `CAMBIAR-…`.

La primera vez la base tarda unos segundos en cargar `sql/`; la app recién pasa a *Ready*
cuando `/health` confirma que la base responde (eso hace la `readinessProbe`).

### 4.4 Evidencia

```bash
kubectl get pods,svc
minikube service vektora-app --url        # http://<ip-de-minikube>:30080
kubectl exec deploy/vektora-db -- psql -U vektora -d vektora -c "select count(*) from public.project_tasks"
```

Abrir la URL y entrar con `cliente@vektora.test` / `Demo-Vektora-2026`. Se entra por
`http://`, por eso el ConfigMap pone `COOKIE_SECURE=false` (una cookie `Secure` el navegador la
descartaría por http).

📷 **Captura 7** — `kubectl get pods,svc` con `vektora-db` y `vektora-app` en `Running 1/1` y
los dos Services.

Comprobado en la PC del equipo (minikube v1.39, Kubernetes v1.37, VirtualBox): los dos pods
en `Running 1/1`, el PVC `Bound` de 1 Gi, 8 tareas en la base, `/health` con
`{"estado":"ok",…,"base":"ok"}`, la app corriendo como uid 1001 y el inicio de sesión con la
cuenta de prueba llevando al panel.

La misma prueba corre sola en GitHub Actions (workflow **Kubernetes**, con un clúster `kind`)
cada vez que cambia `k8s/`: comprueba pods en Running, 8 tareas en la base, `/health` 200 y
uid 1001.

### 4.5 Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `vektora-db` en `CreateContainerConfigError` | Falta el Secret o el ConfigMap `vektora-sql` | `kubectl apply -f k8s/secret.yaml` y `kubectl create configmap vektora-sql --from-file=sql/` |
| `vektora-app` en `Running 0/1` | `/health` da 503: la base todavía carga `sql/` o la contraseña no coincide | `kubectl logs deploy/vektora-db`; que `POSTGRES_PASSWORD` y `DB_PASSWORD` sean iguales |
| Datos de prueba ausentes | El PVC ya existía (los scripts solo corren con el volumen vacío) | `kubectl delete -k k8s/ && kubectl delete pvc vektora-db-datos` y volver a aplicar |
| `ImagePullBackOff` | La imagen de ghcr.io no es pública o no hay internet | Paquete `vektora` en GitHub → *Change visibility → Public* |
| minikube con VirtualBox: «VT-X/AMD-v not enabled» | Hyper-V ocupa la virtualización | `--no-vtx-check`, o usar `--driver=hyperv` desde una consola de administrador |
| minikube con VirtualBox: `VERR_INTNET_FLT_IF_NOT_FOUND` (no encuentra la red «Host-Only») | El adaptador Host-Only de VirtualBox quedó en un estado que el filtro de red no reconoce | PowerShell **como administrador**: `Get-NetAdapter \| Where InterfaceDescription -match 'VirtualBox Host-Only' \| Restart-NetAdapter`; si el filtro estuviera desactivado, `… \| Enable-NetAdapterBinding -ComponentID oracle_VBoxNetLwf`. Después `minikube delete` y `minikube start` de nuevo. Si sigue, reiniciar la PC, reinstalar VirtualBox o usar Docker Desktop (`--driver=docker`) |
| `OOMKilled` en la app | Límite de memoria chico para la carga | Subir `limits.memory` en `app-deployment.yaml` |
