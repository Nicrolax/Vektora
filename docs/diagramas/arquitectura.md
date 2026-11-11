# Arquitectura de despliegue

Quién habla con quién, por qué protocolo y con qué credencial, en los tres entornos.

## Producción (Nivel 2): Render + Aiven

```mermaid
flowchart LR
    usuario(["Persona<br/>navegador"])

    subgraph render["Render · plan gratis · Oregon"]
        direction TB
        cf["Proxy de Render<br/>TLS · :443<br/>http → https 301"]
        app["Contenedor VEKTORA<br/>node server.js · uid 1001<br/>Next.js 16 standalone"]
        cf -->|"HTTP interno<br/>x-forwarded-proto: https"| app
    end

    subgraph aiven["Aiven · plan gratis"]
        pg[("PostgreSQL 18<br/>+ pgvector<br/>RLS · 47 políticas")]
    end

    subgraph ia["Proveedores de IA"]
        groq["Groq<br/>openai/gpt-oss-120b"]
        gem["Google AI Studio<br/>gemini-3.6-flash<br/>gemini-embedding-001"]
    end

    subgraph gh["GitHub"]
        reloj["Actions · Agentes<br/>emparejar cada 15 min<br/>evaluar cada 10 min"]
    end

    usuario -->|"HTTPS :443<br/>cookie vektora_sesion<br/>httpOnly · Secure · SameSite=Lax"| cf
    app -->|"TCP + TLS · SSL verificado con la CA de Aiven<br/>DB_* desde el panel de Render"| pg
    app -->|"HTTPS :443 · Bearer"| groq
    app -->|"HTTPS :443 · x-goog-api-key"| gem
    groq -.->|"si falla o se agota la cuota"| gem
    reloj -->|"HTTPS :443 · POST /api/cron/*<br/>Authorization: Bearer CRON_SECRET"| cf
```

| Origen | Destino | Protocolo | Credencial | Dónde vive |
|---|---|---|---|---|
| Navegador | Render | HTTPS (TLS de Render) | Cookie de sesión (JWT HS256) | Navegador; la firma con `AUTH_SECRET` |
| App | Aiven | PostgreSQL sobre TLS, verificando la CA | `DB_USER` / `DB_PASSWORD` | Panel de Render (`sync: false`) |
| App | Groq / Google | HTTPS | `GROQ_API_KEY` / `GOOGLE_AI_API_KEY` | Panel de Render |
| GitHub Actions | `/api/cron/emparejar`, `/api/cron/evaluar` | HTTPS | `CRON_SECRET` | Secret del repositorio |
| Render | `/health` | HTTP interno | — | `healthCheckPath` en `render.yaml` |

**La base nunca se expone a internet sin TLS**, y la app no tiene credenciales escritas: todo
llega por variables de entorno (R10).

## Local (Nivel 1): docker compose

```mermaid
flowchart LR
    nav(["Navegador"]) -->|"http://localhost:3000"| appc
    subgraph compose["docker compose · red interna del proyecto"]
        appc["app<br/>ghcr.io/nicrolax/vektora:local<br/>HEALTHCHECK /health"]
        dbc[("db<br/>pgvector/pgvector:pg16<br/>volumen datos")]
        init["sql/01-crear-tablas.sql<br/>sql/02-datos-prueba.sql"]
        appc -->|"TCP :5432 · DB_SSL=disable<br/>red interna"| dbc
        init -.->|"/docker-entrypoint-initdb.d<br/>solo con el volumen vacío"| dbc
    end
```

## Taller (Nivel 3): minikube

```mermaid
flowchart LR
    nav(["Navegador"]) -->|"http://IP-de-minikube:30080"| svcapp
    subgraph k8s["minikube · namespace default"]
        svcapp["Service vektora-app<br/>NodePort 30080 → 3000"]
        app["Deployment vektora-app<br/>ghcr.io/nicrolax/vektora:latest<br/>probes en /health · uid 1001<br/>readOnlyRootFilesystem"]
        svcdb["Service vektora-db<br/>ClusterIP :5432"]
        db["Deployment vektora-db<br/>pgvector/pgvector:pg16<br/>probes pg_isready"]
        pvc[("PVC vektora-db-datos<br/>1 Gi")]
        cm["ConfigMap vektora-config<br/>DB_HOST, DB_PORT, DB_SSL…"]
        sec["Secret vektora-secret<br/>contraseñas, AUTH_SECRET…"]
        sql["ConfigMap vektora-sql<br/>scripts de sql/"]
        svcapp --> app
        app -->|"TCP :5432"| svcdb --> db
        db --- pvc
        cm -.->|envFrom| app
        sec -.->|envFrom| app
        sec -.->|POSTGRES_*| db
        sql -.->|initdb| db
    end
    ghcr[("ghcr.io")] -.->|"imagen pública"| app
```

La base del clúster solo es alcanzable desde adentro (`ClusterIP`); hacia afuera se publica
únicamente la app.
