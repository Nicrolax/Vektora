# =====================================================================================
# VEKTORA — Imagen de la aplicación (Nivel 1)
# =====================================================================================
# Tres etapas: la imagen final NO lleva el código fuente, ni las devDependencies, ni las
# herramientas de compilación. Solo el servidor `standalone` que genera Next.
#
#   deps   → instala dependencias exactas (npm ci, con caché de capas)
#   build  → compila Next en modo `standalone` (next.config.ts)
#   runner → node:22-alpine + el resultado, como usuario SIN privilegios (uid 1001)
#
# Sin credenciales: ningún ARG ni ENV de este archivo lleva un secreto. Todo dato de
# conexión llega en tiempo de ejecución por variables de entorno (R10): `env_file` en el
# compose, el panel de Render, o un Secret de Kubernetes.
# =====================================================================================

ARG NODE_VERSION=22-alpine

# --- 1 · Dependencias ------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# Solo los manifiestos: mientras no cambien, Docker reutiliza esta capa y no reinstala.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- 2 · Compilación -------------------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- 3 · Ejecución ---------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

# Vincula el paquete de ghcr.io con el repositorio (aparece en su página y hereda permisos).
LABEL org.opencontainers.image.source="https://github.com/Nicrolax/_JBDPA_Grupo_1"       org.opencontainers.image.title="VEKTORA"       org.opencontainers.image.description="Plataforma autónoma de resultados (Next.js + PostgreSQL)"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Parches de seguridad del sistema base (lo que Trivy marcaría) y un usuario propio.
RUN apk upgrade --no-cache \
 && addgroup -S -g 1001 vektora \
 && adduser -S -u 1001 -G vektora -h /app vektora

# `standalone` trae server.js y el node_modules mínimo; los estáticos van aparte.
COPY --from=build --chown=vektora:vektora /app/.next/standalone ./
COPY --from=build --chown=vektora:vektora /app/.next/static ./.next/static

# Contenedor NO root: si alguien lograra ejecutar código dentro de la app, no tendría
# permisos de administrador sobre el contenedor.
USER vektora

EXPOSE 3000

# Docker marca el contenedor como «unhealthy» si /health no da 200 (app viva + base OK).
# `wget` viene en alpine (busybox): no hace falta instalar curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

# Render y Kubernetes pueden cambiar PORT: server.js lo respeta.
CMD ["node", "server.js"]
