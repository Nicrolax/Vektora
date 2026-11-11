# Diagramas

Todos están en Mermaid: GitHub los dibuja al abrir cada archivo, y en VS Code se ven con la
vista previa de Markdown (extensión *Markdown Preview Mermaid Support*).

| Archivo | Qué muestra |
|---|---|
| [`arquitectura.md`](arquitectura.md) | Usuario → HTTPS → Render → SSL → Aiven; IA y agentes. También compose (Nivel 1) y minikube (Nivel 3) |
| [`modelo-de-datos.md`](modelo-de-datos.md) | Entidad-relación de las 15 tablas, con las relaciones 1:N y N:M de R1 |
| [`capas.md`](capas.md) | Presentación → servicio → DAO → base (R4), la transacción de una entrega paso a paso (R7) y la jerarquía de errores (R5, R8) |
| [`despliegue.md`](despliegue.md) | Del `git push` a GitHub Actions, ghcr.io, Render, Aiven y minikube |

Los diagramas de clases de cada dominio (planificador, matching, juez, IA) están en
[`../04-diagrama-de-clases.md`](../04-diagrama-de-clases.md).
