# Informe de seguridad — VEKTORA (SSDLC)

Materia: Programación Avanzada (UTU) · Examen de despliegue, Fase 5
Fecha de los análisis: 11 de noviembre de 2026 · Rama: `main`

> «Los hallazgos no restan puntos; la falta de explicación, sí.» Por eso cada análisis
> muestra lo que encontró **antes** de corregir, qué se hizo y lo que queda **después**,
> con un enlace a la ejecución que lo prueba.

## Resumen

| Análisis | Tipo | Herramienta | Antes | Después |
|---|---|---|---|---|
| Dependencias | SCA | `npm audit` + Dependabot | 1 crítica, 3 altas, 2 moderadas | **0** |
| Código | SAST | CodeQL (`security-extended`) + SonarLint | 3 altas | **0** |
| Imagen Docker | Contenedor | Trivy | 2 críticas, 12 altas, 17 medias | **0** |
| Aplicación desplegada | DAST | OWASP ZAP baseline | 3 medias, 7 bajas, 5 informativas | **0 bajas**; 3 medias justificadas |
| Secretos | Historial | gitleaks | 3 (falsos positivos) | **0** |

Los cinco corren solos en GitHub Actions (salvo ZAP, que se lanza a mano):

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `.github/workflows/seguridad.yml` | push a `main`, lunes, a mano | gitleaks, `npm audit` (falla con altas/críticas), Trivy sobre la imagen publicada |
| `.github/workflows/codeql.yml` | push a `main`, miércoles, a mano | CodeQL; resultados en *Security → Code scanning* |
| `.github/workflows/imagen.yml` | push a `main` | Trivy **bloquea** la publicación si hay altas o críticas con parche |
| `.github/workflows/zap.yml` | a mano | ZAP baseline contra `https://vektora.onrender.com` (URL fija) |
| `.github/dependabot.yml` | semanal | PRs de actualización de npm, acciones y la imagen base |

---

## 1. SCA — dependencias (`npm audit` + Dependabot)

**Alcance:** las 7 dependencias directas de producción y 10 de desarrollo, con todo su árbol
(`package-lock.json`).

**Antes** (evidencia: [`seguridad/npm-audit-antes.txt`](seguridad/npm-audit-antes.txt) y la
ejecución [Seguridad #1](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43027272731)):

| Paquete | Versión | Severidad | Problema (resumen) | Llega a producción |
|---|---|---|---|---|
| `next` | 16.3.6 | **Crítica** | 10 avisos: ejecución remota de código sin autenticar en la optimización de imágenes con SVG y en funciones `use cache`, SSRF, envenenamiento de caché, DoS en Server Actions | Sí |
| `zod` | 4.6.4 | Alta | Agotamiento de memoria al validar colecciones enormes | Sí (valida toda entrada) |
| `source-map-js` | 1.2.1 | Alta | DoS con mapas de código manipulados | No (compilación) |
| `vite` | 8.3.0 | Alta | Ejecución de scripts entre orígenes y lectura de archivos en el servidor de desarrollo de Vitest | No (pruebas) |
| `vitest` / `@vitest/mocker` | 5.0.0 | Moderada | Inyección de código vía registro de *mocks* | No (pruebas) |

**Corrección** (commit `edd76f9`): `next` 16.4.6, `zod` 4.6.7, `react`/`react-dom` 19.3.1 (lo
que propuso Dependabot en su PR de producción), `vitest` 5.1.0 y `npm audit fix` para
`source-map-js` y `vite`. Se corrieron las 371 pruebas, el build y la app en el navegador.

**Después:** `found 0 vulnerabilities` en local y en [Seguridad #5](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43029030185). El job `dependencias` del workflow Seguridad **falla**
si vuelve a aparecer una alta o crítica, así que una dependencia vulnerable no pasa
desapercibida.

**Dependabot:** al activarlo abrió 7 PRs en minutos. Seis eran acciones de GitHub que
seguían en versiones que corren sobre Node 20, ya obsoleto: `checkout`, `setup-node` y
`upload-artifact` a v7, `codeql-action` y `login-action` a v4, y `trivy-action` a 0.36.0. Se
aplicaron en `a9786c8`. El séptimo era el grupo de npm de producción, que se aplicó en
`edd76f9`.

## 2. SAST — código fuente (CodeQL + SonarLint)

**Alcance:** todo el TypeScript del repositorio (`app/`, `lib/`, `components/`, `scripts/`),
con el conjunto de reglas `security-extended` (inyección, XSS, redirecciones abiertas,
secretos en el código, criptografía débil, carreras, etc.).

**Antes** ([CodeQL #1](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/workflows/codeql.yml)):

| # | Regla | Severidad | Archivo | Qué pasaba |
|---|---|---|---|---|
| 1 | `js/file-system-race` | Alta | `scripts/configurar-db.ts:97` | Preguntaba con `existsSync` si `.env` existía y después lo leía/escribía |
| 2 | `js/file-system-race` | Alta | `scripts/k8s-secreto.ts:61` | Igual con `k8s/secret.yaml` |
| 3 | `js/file-system-race` | Alta | `scripts/sql-build.ts:97` | Igual con `sql/*.sql` |

Entre la pregunta y la escritura el archivo puede cambiar (carrera *TOCTOU*). Por ejemplo,
otro proceso podría reemplazarlo por un enlace a otro archivo. El riesgo real es bajo
porque son scripts que corre una persona en su PC, pero dos de ellos escriben contraseñas.

**Corrección** (commit `c7782cc`):

- `k8s-secreto` crea el archivo con la bandera `wx`: la creación falla de forma **atómica**
  si ya existe. No hay hueco entre comprobar y escribir.
- `configurar-db` y `sql-build` leen directamente y tratan `ENOENT` como «no existe».
- `.env` y `k8s/secret.yaml` se escriben con permisos `0600` (solo el dueño los lee).

**Después** ([CodeQL #5](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/workflows/codeql.yml)):
las 3 alertas quedaron **cerradas como corregidas** («closed as fixed»). Hay 0 abiertas.

Lo que CodeQL **no** marcó también es un resultado: ninguna inyección SQL, porque todas las
consultas usan `$1, $2…` (R9). Tampoco XSS, porque React escapa el texto y no hay
`dangerouslySetInnerHTML`. Tampoco redirecciones abiertas ni secretos en el código.

**SonarLint:** el equipo lo corre en VS Code sobre `lib/` y `app/` (extensión gratuita
*SonarQube for IDE*) y agrega aquí sus capturas y hallazgos. 📷 **Captura S1** — panel
*Problems* de SonarLint.

## 3. Escaneo de imagen — Trivy

**Alcance:** la imagen publicada `ghcr.io/nicrolax/vektora:latest`: el sistema base
(Alpine) y todos los paquetes de Node que trae adentro.

**Antes** ([Seguridad #3](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43028286747)):
**31 vulnerabilidades** (2 críticas, 12 altas, 17 medias).

| Dónde | Cantidad | Detalle |
|---|---|---|
| Alpine 3.24.4 (sistema) | **0** | El Dockerfile ya hacía `apk upgrade` |
| `app/node_modules/next` | 9 | 2 críticas (las de `npm audit`), 2 altas, 5 medias |
| `/usr/local/lib/node_modules/npm` | 22 | `brace-expansion` (7), `ip-address` (6, una alta de SSRF), `picomatch` (2), `sigstore` (alta: acepta certificados no autorizados), `pacote`, `glob`, `minimatch`, `@sigstore/core`, `postcss-selector-parser` |

El hallazgo más interesante es que **el 70 % no era de nuestra app**. Venía del `npm`
que trae la imagen oficial `node:22-alpine`. La app en ejecución es solo `node server.js`:
nunca usa npm.

**Corrección** (commit `edd76f9`):

1. `next` actualizado (sección 1).
2. La etapa final del `Dockerfile` **borra npm, npx, corepack y yarn**. Así desaparecen sus
   22 vulnerabilidades, y si alguien lograra entrar al contenedor tampoco tendría con qué
   instalar herramientas.
3. `imagen.yml` corre Trivy **antes de publicar** (`severity: CRITICAL,HIGH`,
   `ignore-unfixed: true`, `exit-code: 1`). Una imagen con una alta o crítica corregible no
   llega a ghcr.io, ni por lo tanto a Render ni a minikube. También comprueba que la imagen
   no traiga gestores de paquetes.
4. `trivy-action` se fija por **commit** (`@ed142fd…  # v0.36.0`) y no por etiqueta. Una
   etiqueta se puede mover a otro código; un commit no. Las etiquetas de esta acción
   cambiaron de nombre durante el examen (`0.28.0` → `v0.36.0`), y esa es justo la puerta
   de un ataque a la cadena de suministro.

**Después** ([Seguridad #5](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43029030185)):
**0 vulnerabilidades** críticas, altas o medias en los 36 objetivos (Alpine y 35 paquetes de
la app). `/usr/local/lib/node_modules/npm` ya no aparece en la imagen. El control de
`imagen.yml` también pasó antes de publicar.

## 4. DAST — aplicación desplegada (OWASP ZAP)

**Alcance:** escaneo *baseline*, pasivo: navega el sitio y analiza las respuestas, no lanza
ataques. Se corrió **solo** contra nuestra URL, `https://vektora.onrender.com`. La URL está
fija en el workflow y no hay ningún campo para cambiarla: escanear sitios ajenos está
prohibido.

**Antes** ([ZAP #1](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43027354747)), con las
cabeceras que Render devolvía (ninguna de seguridad):

| Riesgo | Alerta (id) | Corrección |
|---|---|---|
| Media | Content Security Policy no definida (10038) | CSP en `next.config.ts` |
| Media | Falta cabecera anti-clickjacking (10020) | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| Media | Ausencia de tokens anti-CSRF (10202) | Justificada, ver abajo |
| Baja | Strict-Transport-Security no definida (10035) | HSTS 2 años |
| Baja | Falta X-Content-Type-Options (10021) | `nosniff` |
| Baja | Permissions-Policy no definida (10063) | cámara, micrófono, ubicación, pagos y USB apagados |
| Baja | Falta Cross-Origin-Opener/Embedder/Resource-Policy (90004) | `same-origin` / `require-corp` / `same-origin` |
| Baja | «Big Redirect» (10044) | Redirección antes de renderizar, ver abajo |
| Info. | Autenticación identificada, app moderna, contenido cacheable, atributo controlado por el usuario | Sin acción, ver abajo |

**Corrección** (commit `edd76f9`, `next.config.ts` → `headers()`):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
  frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Strict-Transport-Security: max-age=63072000; includeSubDomains
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
```

Se probó en el navegador con el build de producción: login como cliente y como
proveedora, panel, proyecto con el grafo, sondeo cada 15 s y cerrar sesión, **sin ningún
error de CSP en la consola**. `window.crossOriginIsolated` da `true`.
`tests/next-config.test.ts` fija estas cabeceras para que no se pierdan sin querer.

**«Big Redirect»:** las páginas privadas llaman a `redirect('/entrar')` cuando no hay sesión,
y Next igual manda el cascarón HTML de la página (5-6 KB) en la respuesta 307. No había
datos de usuarios, solo HTML estático, pero se corrigió igual: `next.config.ts` →
`redirects()` manda a `/entrar` **antes de renderizar** si falta la cookie `vektora_sesion`.
La respuesta pasó de 6189 B a 7 B. La comprobación real sigue en cada página
(`requireUser()`): con una cookie falsa también se redirige.

**Justificaciones (riesgo aceptado, con motivo):**

- **Tokens anti-CSRF (media):** ZAP busca un campo oculto con un token en cada `<form>`. VEKTORA
  usa **Server Actions** de Next, que ya traen la protección: el servidor rechaza cualquier
  acción cuyo `Origin` no coincida con el `Host`. Además, la cookie de sesión es
  `SameSite=Lax`, así que el navegador no la manda en un POST que venga de otro sitio. Los
  dos formularios `method="get"` (búsqueda y filtro de cuentas) solo leen. Es un falso
  positivo del escaneo pasivo.
- **`'unsafe-inline'` en la CSP:** Next inyecta scripts en línea para hidratar la página, y
  la interfaz usa `style={…}` para colores y anchos que vienen de los datos. La alternativa
  (un *nonce* por petición) obliga a renderizar todo de forma dinámica con un proxy. El
  riesgo queda acotado: React escapa todo texto, no hay `dangerouslySetInnerHTML` y CodeQL no
  encontró XSS. Como todo lo demás está restringido a `'self'`, un script inyectado no
  podría mandar datos a otro dominio (`connect-src 'self'`, `form-action 'self'`).
- **Informativas:** «Authentication Request Identified» es el login, que existe a propósito;
  «Modern Web Application» es una observación. Los recursos cacheables son los archivos
  estáticos de `/_next/static`, que son públicos e inmutables. El «atributo controlado por
  el usuario» es el texto de búsqueda que vuelve a aparecer en el campo; React lo escapa.

**Después** ([ZAP #2](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43029469233)),
con Render ya desplegado con estas correcciones:

| Riesgo | Alerta (id) | Estado |
|---|---|---|
| Media | CSP: `script-src unsafe-inline` (10055) | Aceptada (justificación arriba). Es la CSP nueva, que ZAP revisa por dentro |
| Media | CSP: `style-src unsafe-inline` (10055) | Aceptada: `style={…}` con colores y anchos de los datos; un estilo no ejecuta código |
| Media | Ausencia de tokens anti-CSRF (10202) | Falso positivo (Server Actions + `SameSite=Lax`) |
| Info. | Falta Content-Type (10019) | Son las redirecciones nuevas de 7 bytes (`/` y `/panel` → `/entrar`): no tienen cuerpo que interpretar |
| Info. | Las mismas 5 informativas de antes | Sin acción |

Se fueron **las 7 alertas bajas** y las medias de clickjacking y de CSP ausente; el
«Big Redirect» también.

## 5. Secretos en el historial — gitleaks

**Alcance:** todo el historial de `main` (`fetch-depth: 0`; 21 commits en la primera
ejecución), no solo el último commit.

**Antes** ([Seguridad #1](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43027272731)):
3 hallazgos `generic-api-key`, en `README.md` (`c132ccf`) y en `docs/guia-despliegue.md`
(`39c4251`, `c77d919`).

**Análisis:** los tres son la misma línea de ejemplo,
`ADMIN_EMAIL=admin@ejemplo.com ADMIN_PASSWORD='…' npm run cuenta:admin`. El valor era el texto
«al menos 12 caracteres» escrito con guiones: una instrucción, no una contraseña. La regla
se dispara por la forma `PASSWORD='texto-largo'`. **Falsos positivos.**

**Corrección** (commit `a9786c8`): el ejemplo ahora dice `'<12+ caracteres>'`, y las huellas
de los tres commits viejos van a `.gitleaksignore` con la justificación. No se reescribió el
historial: `main` es público y no había nada que ocultar.

**Después** ([Seguridad #5](https://github.com/Nicrolax/_JBDPA_Grupo_1/actions/runs/43029030185)):
**0 hallazgos** en 25 commits.

También se escaneó la carpeta de trabajo (`--no-git`). Las claves reales aparecen **solo** en
`.env`, `.env.render` y `k8s/secret.yaml`, y los tres están en `.gitignore` (y en
`.dockerignore`, así que tampoco entran a la imagen).

---

## 6. Hardening (lo que ya estaba y por qué)

| Medida | Dónde | Para qué |
|---|---|---|
| Contraseñas con **bcrypt**, coste 12 | `lib/auth/password.ts` | ~250 ms por intento: un ataque de fuerza bruta es carísimo |
| Hash **señuelo** cuando el correo no existe | `lib/auth/password.ts` | La respuesta tarda lo mismo: no se puede averiguar qué correos están registrados |
| **Consultas parametrizadas** siempre (`$1, $2…`) (R9) | `lib/db/client.ts`, `lib/consultas/` | Inmune a inyección SQL: el valor nunca se mezcla con el texto de la consulta |
| **RLS** en las tablas de negocio (47 políticas) y `SET LOCAL ROLE authenticated` por petición | `db/`, `lib/db/client.ts` → `asUser` | Aunque una consulta de la app tuviera un error, la base no devuelve filas de otra persona |
| Cookie `httpOnly`, `SameSite=Lax` y `Secure` por HTTPS | `lib/auth/cookie.ts` | Un XSS no puede leer la sesión; no viaja en POST de otros sitios; no viaja por http en producción |
| Token **HS256** comparado con `timingSafeEqual` | `lib/auth/token.ts` | La comparación no filtra información por el tiempo que tarda |
| Permisos por rol (cliente, proveedor, ambos, admin) en el servidor | `lib/auth/permisos.ts` | La interfaz esconde botones, pero quien decide es el servidor |
| Contenedor **no root** (uid 1001) y sin gestores de paquetes | `Dockerfile` | Si alguien ejecuta código dentro, no es administrador ni puede instalar nada |
| `readOnlyRootFilesystem`, sin escalada de privilegios | `k8s/app-deployment.yaml` | En Kubernetes ni siquiera puede escribir en el sistema de archivos |
| Conexión a Aiven **solo por SSL**, verificando la CA | `lib/db/config.ts` (`rejectUnauthorized: true` con `DB_SSL_CA`) | Cifrado, y nadie puede hacerse pasar por el servidor de la base |
| **Sin credenciales** en código, Dockerfile, manifiestos ni historial | `.gitignore`, `.dockerignore`, `secret.yaml.example`, gitleaks | Los valores reales viven en `.env` (local), en el panel de Render o en un Secret de Kubernetes |
| `/health` sin datos internos | `app/health/route.ts` | Responde `ok` / `sin respuesta`, nunca el motivo del error ni la versión |
| `X-Powered-By` apagado | `next.config.ts` | No anuncia qué framework ni qué versión usamos |
| Crons con secreto (`CRON_SECRET`) | `lib/cron/` | Sin el secreto responden 401; sin configurar, 503 (la puerta se cierra, no se abre) |
| Acciones de terceros fijadas por commit | `seguridad.yml`, `imagen.yml` | Cadena de suministro (sección 3) |

**Contraseñas de demostración públicas:** las 6 cuentas de `db/seeds/02_datos_demo.sql` usan
`Demo-Vektora-2026`, publicada a propósito para que el docente pueda probar. Es un riesgo
aceptado y acotado:

- son cuentas de datos ficticios (`@vektora.test`, un dominio reservado que no recibe correo);
- ninguna es administradora (la admin se crea aparte, con `npm run cuenta:admin` y una
  contraseña que no está en el repositorio);
- RLS limita lo que cada una ve;
- después de la evaluación se pueden borrar o cambiar sin tocar el código.

## 7. Riesgos que quedan

| Riesgo | Por qué queda | Mitigación |
|---|---|---|
| `'unsafe-inline'` en la CSP | Requisito de la hidratación de Next (sección 4) | React escapa todo; `connect-src`/`form-action` en `'self'` |
| `DB_SSL=require` **sin** `DB_SSL_CA` cifra pero no verifica el certificado | Para que funcione con proveedores que no dan la CA | En Render y en local está la CA; `npm run db:check` avisa si falta |
| Sin límite de intentos de login por IP | El plan gratis de Render no trae WAF | bcrypt coste 12 hace lento cada intento; mejora posible: contar intentos en `usage_events` como ya hace `lib/cuotas` |
| Vulnerabilidades nuevas sin parche | Aparecen cada semana | Dependabot + Seguridad los lunes + Trivy bloquea publicar |
