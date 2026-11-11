# Capas: presentación → servicio → DAO → base (R4)

Cada capa conoce solo a la de abajo, y siempre a través de una **interfaz**. Así la lógica
se prueba con dobles en memoria (sin red ni base) y la implementación real es `Postgres*`.

```mermaid
flowchart TB
    subgraph pres["Presentación · app/"]
        direction LR
        paginas["Páginas (Server Components)<br/>panel · proyectos · tareas · proveedor<br/>buscar · reportes · admin"]
        acciones["Server Actions · app/acciones/<br/>crearProyecto · actualizarProyecto<br/>cambiarEstadoProyecto · eliminarProyecto<br/>entregarTrabajo · registrarProveedor<br/>gestionarCuenta · crearSkill · gestionarSkill<br/>iniciarSesion · registrarse · cerrarSesion"]
        rutas["Route handlers<br/>/health · /api/cron/emparejar · /api/cron/evaluar<br/>/api/proyectos/[id]/firma"]
    end

    subgraph guardia["Sesión y permisos · lib/auth/session.ts"]
        direction LR
        g1["requireUser · requirePermiso<br/>(páginas: redirigen)"]
        g2["requireUserOrThrow · exigirPermiso<br/>(acciones: lanzan PermisoDenegadoError)"]
    end

    subgraph serv["Servicio"]
        direction LR
        s1["AuthService"]
        s2["ProyectosService"]
        s3["EntregasService"]
        s4["AdminService"]
        s5["ProjectPlanner"]
        s6["TaskMatcher"]
        s7["QaJudge"]
        s8["ProviderOnboarding"]
    end

    subgraph dao["DAO · interfaz → implementación"]
        direction LR
        d1["CuentasRepository → PostgresCuentasRepository"]
        d2["ProyectosDao → PostgresProyectosDao"]
        d3["EntregasRepository → PostgresEntregasRepository"]
        d4["PlannerRepository · MatchingRepository<br/>QaRepository · ProviderRepository → Postgres*"]
        d5["lib/consultas<br/>lecturas de las páginas, búsqueda, reporte"]
    end

    subgraph db["Acceso a datos · lib/db"]
        direction LR
        q["query / one / execute<br/>siempre $1, $2… (R9)"]
        t["transaction()<br/>BEGIN · COMMIT · ROLLBACK (R7)"]
        u["asUser(id)<br/>SET LOCAL ROLE authenticated → RLS"]
    end

    pg[("PostgreSQL + pgvector<br/>RLS · triggers · funciones atómicas")]

    subgraph transv["Transversal"]
        direction TB
        err["lib/errores<br/>VektoraError y mensajeParaUsuario() (R5, R8)"]
        val["Zod + lib/validacion (R8)"]
        ia["lib/ai · AiClient<br/>Groq → Gemini"]
    end

    paginas --> g1
    acciones --> g2
    paginas -->|"lee"| d5
    g1 --> serv
    g2 --> serv
    rutas --> s6
    rutas --> s7
    serv --> dao
    s5 -.-> ia
    s7 -.-> ia
    dao --> db
    db -->|"pool pg · TLS en Aiven"| pg
    acciones -.-> err
    acciones -.-> val
```

## Un pedido de punta a punta: «entregar trabajo»

```mermaid
sequenceDiagram
    autonumber
    actor P as Proveedora
    participant A as entregarTrabajo<br/>(app/acciones/entregas.ts)
    participant S as EntregasService
    participant R as PostgresEntregasRepository
    participant D as lib/db · transaction()
    participant B as PostgreSQL

    P->>A: formulario (resumen, contenido, evidencia por criterio)
    A->>A: exigirPermiso('trabajo:entregar'), validaciones y cuota
    A->>S: entregar(providerId, entrega)
    S->>D: transaction(tx => …)
    D->>B: BEGIN
    S->>R: bloquearTarea(tx, taskId)
    R->>B: SELECT … FOR UPDATE  ($1)
    S->>S: ¿es suya? ¿assigned / in_progress / revision_requested?
    S->>R: insertarEntregable(tx, …)
    R->>B: INSERT deliverables  ($1…$n)
    S->>R: marcarEntregada(tx, taskId)
    R->>B: UPDATE project_tasks SET status = 'submitted'
    S->>R: registrarAuditoria(tx, …)
    R->>B: INSERT audit_logs
    alt todo bien
        D->>B: COMMIT
        S-->>A: EntregaRegistrada
        A-->>P: redirige a /tareas/[id]?entregado=versión
    else cualquier error
        D->>B: ROLLBACK (no queda nada a medias)
        S-->>A: VektoraError
        A-->>P: mensajeParaUsuario(error)
    end
```

Después, el workflow **Agentes** llama a `/api/cron/evaluar`: el `QaJudge` evalúa la entrega
criterio por criterio y aplica el veredicto con una sola función SQL atómica
(`apply_qa_verdict`).

## Jerarquía de errores (R5, R8)

```mermaid
classDiagram
    class VektoraError {
        <<abstract>>
        +string codigo
        +number estadoHttp
        +string mensajeUsuario
    }
    VektoraError <|-- ValidacionError
    VektoraError <|-- AuthError
    VektoraError <|-- PermisoDenegadoError
    VektoraError <|-- RecursoNoEncontradoError
    VektoraError <|-- ConflictoError
    VektoraError <|-- ConfiguracionError
    VektoraError <|-- DatabaseError
    VektoraError <|-- DominioError
    VektoraError <|-- AiError
    DatabaseError <|-- PlannerRepositoryError
    DatabaseError <|-- ProviderRepositoryError
    DatabaseError <|-- MatchingRepositoryError
    DatabaseError <|-- QaRepositoryError
    DominioError <|-- PlannerError
    DominioError <|-- ProviderError
    DominioError <|-- MatchingError
    DominioError <|-- QaError
    ConfiguracionError <|-- MatchingConfigError
    ConfiguracionError <|-- QaConfigError
    AiError <|-- AiExhaustedError
```

`mensajeParaUsuario(error)` es el **único** camino de un error a la interfaz. Un
`VektoraError` muestra su mensaje pensado para la persona. Cualquier otra cosa (un error de
`pg`, un `TypeError`) se registra en el servidor y la persona ve un mensaje genérico, sin
detalles internos.
