# Modelo de datos (entidad-relación)

Las 15 tablas de `sql/01-crear-tablas.sql`: 14 del modelo en `public` más `auth.users`. Se
muestran las claves y las columnas que importan para entender el sistema. La fuente de verdad
es la base: `npm run db:check` la compara con lo que espera el código.

```mermaid
erDiagram
    AUTH_USERS ||--|| USERS : "es"
    USERS ||--o| PROFILES : "tiene"
    USERS ||--o| PROVIDER_PROFILES : "puede ser proveedor"
    PROVIDER_PROFILES ||--o{ PROVIDER_SKILLS : "declara"
    SKILLS ||--o{ PROVIDER_SKILLS : "aparece en"
    SKILLS ||--o{ SKILL_ALIASES : "se escribe también"
    USERS ||--o{ PROJECTS : "es dueño de"
    PROJECTS ||--|{ PROJECT_TASKS : "se descompone en"
    PROJECT_TASKS ||--o{ TASK_DEPENDENCIES : "depende de"
    PROJECT_TASKS ||--o{ TASK_DEPENDENCIES : "es requisito de"
    PROJECT_TASKS ||--o{ TASK_APPLICATIONS : "recibe"
    USERS ||--o{ TASK_APPLICATIONS : "postula (proveedor)"
    USERS ||--o{ PROJECT_TASKS : "tiene asignada"
    PROJECT_TASKS ||--o{ DELIVERABLES : "recibe versiones"
    USERS ||--o{ DELIVERABLES : "entrega"
    AI_RUNS |o--o{ DELIVERABLES : "juzga"
    DELIVERABLES |o--o| REVIEWS : "origina"
    USERS ||--o{ REPUTATION_EVENTS : "acumula"
    REVIEWS |o--o{ REPUTATION_EVENTS : "justifica"
    USERS ||--o{ AUDIT_LOGS : "actúa"
    PROJECTS |o--o{ AUDIT_LOGS : "registra"
    USERS ||--o{ USAGE_EVENTS : "consume"
    USERS |o--o{ AI_RUNS : "dispara"

    AUTH_USERS {
        uuid id PK
        text email UK
        text password_hash "bcrypt $2b$12$"
    }
    USERS {
        uuid id PK "FK auth.users"
        citext email UK
        user_role role "client, provider, both, admin"
        account_status status
        boolean is_agent
    }
    PROFILES {
        uuid id PK
        uuid user_id FK "UK"
        text display_name
    }
    PROVIDER_PROFILES {
        uuid id PK
        uuid user_id FK "UK"
        text headline
        numeric hourly_rate_usd
        numeric reputation_score
        vector embedding "1536 dimensiones"
    }
    SKILLS {
        uuid id PK
        citext slug UK
        text name
    }
    PROVIDER_SKILLS {
        uuid id PK
        uuid provider_profile_id FK
        uuid skill_id FK
        smallint level
    }
    SKILL_ALIASES {
        uuid id PK
        citext alias UK
        uuid skill_id FK
    }
    PROJECTS {
        uuid id PK
        uuid owner_id FK
        text title
        text objective
        project_status status
        project_visibility visibility
        numeric budget_total
    }
    PROJECT_TASKS {
        uuid id PK
        uuid project_id FK
        text code "UK por proyecto: T-01…"
        task_status status
        jsonb acceptance_criteria
        numeric budget
        uuid assignee_id FK
        vector embedding
        integer matching_rounds
    }
    TASK_DEPENDENCIES {
        uuid id PK
        uuid task_id FK
        uuid depends_on_task_id FK
    }
    TASK_APPLICATIONS {
        uuid id PK
        uuid task_id FK
        uuid provider_id FK
        application_status status
        numeric match_score
        jsonb match_explanation
    }
    DELIVERABLES {
        uuid id PK
        uuid task_id FK
        uuid provider_id FK
        integer version "UK por tarea"
        qa_status qa_status
        numeric qa_score
        jsonb qa_criteria_results
        uuid qa_run_id FK
    }
    REVIEWS {
        uuid id PK
        uuid deliverable_id FK
        uuid reviewer_id FK
        uuid reviewee_id FK
        review_source source
        numeric rating
    }
    REPUTATION_EVENTS {
        uuid id PK
        uuid user_id FK
        numeric delta
        numeric weight
        uuid review_id FK "append-only"
    }
    AI_RUNS {
        uuid id PK
        ai_operation operation
        ai_provider provider
        ai_run_status status
        integer total_tokens
        uuid parent_run_id FK
    }
    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        text action
        text entity_type
        uuid entity_id
        uuid project_id FK
    }
    USAGE_EVENTS {
        uuid id PK
        uuid user_id FK
        text action
    }
```

## Relaciones que pide la consigna (R1)

| Tipo | Ejemplo | Cómo se implementa |
|---|---|---|
| 1:N | `users` → `projects` → `project_tasks` | `projects.owner_id`, `project_tasks.project_id` |
| N:M | proveedores ↔ skills | Tabla puente `provider_skills`, `unique (provider_profile_id, skill_id)` |
| N:M | tarea ↔ tarea (el **DAG**) | `task_dependencies`; un trigger impide cerrar un ciclo |
| N:M | proveedor ↔ tarea | `task_applications`, `unique (task_id, provider_id)` |
| 1:1 | `auth.users` ↔ `public.users` | Misma `id`; la contraseña vive solo en `auth.users` |

## Reglas que protege la base (aunque el código fallara)

- **Sin ciclos en el grafo:** trigger `prevent_dag_cycles` en `task_dependencies`.
- **Reputación append-only:** un trigger rechaza `UPDATE` y `DELETE` en `reputation_events`;
  las correcciones se agregan como un evento contrario.
- **Versiones de entregables:** `unique (task_id, version)`; la versión la pone un trigger.
- **RLS en las 14 tablas** con 47 políticas: cada persona ve lo suyo y lo público.
