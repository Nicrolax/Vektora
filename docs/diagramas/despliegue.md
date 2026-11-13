# Flujo de despliegue

De un `git push` a las tres puestas en marcha. Todo corre en servicios gratuitos y ninguna
contraseña viaja en el repositorio.

```mermaid
flowchart TB
    dev(["Equipo<br/>git push a main"]) --> repo[("GitHub<br/>Nicrolax/Vektora")]

    subgraph actions["GitHub Actions (en cada push)"]
        direction TB
        ci["CI<br/>typecheck · 371 pruebas · sql:check<br/>PostgreSQL 16 real: sql:aplicar ×2,<br/>db:check, integración, db/verify"]
        img["Imagen<br/>docker build → compose up<br/>/health · 8 tareas · uid ≠ 0 · cabeceras<br/>→ Trivy (bloquea altas/críticas)<br/>→ push ghcr.io"]
        seg["Seguridad<br/>gitleaks · npm audit · Trivy"]
        cql["CodeQL<br/>SAST"]
        k8s["Kubernetes<br/>clúster kind: apply -k,<br/>Running, 8 tareas, /health"]
    end

    repo --> ci & img & seg & cql
    repo -->|"si cambian k8s/ o sql/"| k8s

    ghcr[("ghcr.io/nicrolax/vektora<br/>latest · sha-xxxxxxx")]
    img -->|"solo si todo pasó"| ghcr

    subgraph n1["Nivel 1 · PC"]
        compose["docker compose up --build"]
    end
    subgraph n2["Nivel 2 · nube"]
        render["Render<br/>Manual Deploy → build del Dockerfile"]
        aiven[("Aiven PostgreSQL<br/>npm run sql:aplicar · SSL")]
        render -->|SSL| aiven
    end
    subgraph n3["Nivel 3 · taller"]
        mk["minikube<br/>kubectl apply -k k8s/"]
    end

    repo -.->|"clonar"| compose
    repo -->|"render.yaml (Blueprint)"| render
    ghcr -->|"imagen pública"| mk

    subgraph agentes["GitHub Actions · Agentes (reloj)"]
        e["emparejar · */15 min"]
        v["evaluar · 5-59/10 min"]
    end
    e & v -->|"HTTPS + CRON_SECRET"| render

    zap["ZAP (manual)<br/>baseline contra vektora.onrender.com"] -.-> render
    dep["Dependabot (lunes)<br/>PRs de npm, acciones y Docker"] -.-> repo
```

## Paso a paso

| Paso | Qué pasa | Dónde se configura |
|---|---|---|
| 1 | `git push` a `main` | — |
| 2 | **CI** compila, corre las pruebas y carga `sql/` dos veces en un PostgreSQL real (prueba que los scripts son idempotentes) | `.github/workflows/ci.yml` |
| 3 | **Imagen** construye el `Dockerfile`, la levanta con compose y la prueba. Trivy la escanea, y solo si todo pasa la publica | `.github/workflows/imagen.yml` |
| 4 | **Render** construye el mismo `Dockerfile` con *Manual Deploy → Deploy latest commit*. Las variables (`DB_*`, `AUTH_SECRET`…) están en su panel | `render.yaml` + panel de Render |
| 5 | **Aiven** guarda los datos. Los scripts se cargan una vez con `npm run sql:aplicar` desde una PC con el `.env` apuntando a Aiven | `.env` local (ignorado) |
| 6 | **minikube** descarga `ghcr.io/nicrolax/vektora:latest` y levanta la app y la base | `k8s/` + `k8s/secret.yaml` (ignorado) |
| 7 | **Agentes**: GitHub Actions llama a `/api/cron/*` con el `CRON_SECRET`. Es lo que hace avanzar el sistema sin que nadie intervenga | `.github/workflows/agentes.yml` + `vars.APP_URL` y `secrets.CRON_SECRET` |

Render no tiene despliegue automático: se creó desde la URL pública del repositorio. Por
eso, después de un push, hay que apretar *Manual Deploy*.
