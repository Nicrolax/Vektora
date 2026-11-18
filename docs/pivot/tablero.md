# Tablero del pivot

Una línea por tarea del [`plan.md`](plan.md). El detalle, la dependencia y el
"terminado cuando" de cada una están en el plan.

**Cómo se usa:** quien termina una tarea la marca `[x]` **en el mismo PR** que la cierra y
agrega el número de PR. Si se bloquea, la marca `[!]` con el motivo en una línea.

## Semana 0

- [ ] Completar `semana-0.md` — Todos
- [ ] Tag `entrega-utu-v1` sobre `main` (commit `2db583e`)
- [ ] Rama `pivot` creada, CI corriendo sobre ella

## Fase 1: inferencia local + kit de datos + primeros contactos

**S1**
- [ ] A · Benchmark de Qwen3-1.7B GGUF en local → `modelo/benchmark.md`
- [x] B · Servicio `inferencia` (llama.cpp) en compose, `/health` 200 → `plataforma/inferencia.md`
- [ ] C · Especificación del dataset v0 → `dataset/especificacion.md`
- [ ] D · 40 contactos cálidos (fuera del repo) + 3 pedidos de presentación

**S2**
- [ ] A · Proveedor `local` en `lib/ai/providers`, `ai:check` en verde
- [ ] B · Red cerrada de prueba (`internal: true`)
- [ ] C · Plantilla CSV + ejemplo público NO PRODUCTIVO
- [ ] D · 10 mensajes + one-pager v0

**S3**
- [ ] A · Planner con gramática + fallback determinista (50/50 DAG válidos)
- [ ] B · Eliminar Groq y Gemini, `verify` en verde
- [ ] C · `scripts/seudonimizar.ts` offline con test
- [ ] D · 10 contactos más + guion de reunión

**S4**
- [ ] A · Embeddings locales (e5-small, 384 dims)
- [ ] B · Migración `0013`: `vector(1536)` → `vector(384)`
- [ ] C · Plantillas legales v0 (NDA + acuerdo de datos)
- [ ] D · Meta: 25 contactos, ≥3 reuniones agendadas

## Fase 2: enterprise mínimo + validación de datos + reuniones

**S5**
- [ ] A · Re-embeber y recalibrar umbrales
- [ ] B · Migración `0014`: tenants, membresías, 5 roles, RLS por tenant
- [ ] C · Validador del dataset ("alcanza / no alcanza")
- [ ] D · Primeras reuniones, ajustar mensaje

**S6**
- [ ] A · Juez local (chequeos deterministas + modelo)
- [ ] B · Tests de fuga entre tenants
- [ ] C · Importador CSV → tablas
- [ ] D · Meta: ≥3 reuniones hechas

**S7**
- [ ] A · Harness de evaluación (`npm run eval`)
- [ ] B · Veto con plazo (si vence, se aplica)
- [ ] C · Matriz de permisos + aviso de transparencia
- [ ] D · Propuesta de piloto (1 página)

**S8**
- [ ] A · Ranker LightGBM sobre datos públicos
- [ ] B · UI del jefe: aprobar/vetar + auditoría
- [ ] C · Guía "qué exportar en 1–2 h"
- [ ] D · Meta: ≥6 reuniones, 1 empresa en negociación

## Fase 3: instalable cerrado + AWS sin cuenta + corte

**S9**
- [ ] A · Modelos empaquetados con SHA256 en Releases
- [ ] B · `docker-compose.onprem.yml` sin salida
- [ ] C · Checklist Ley 18.331
- [ ] D · One-pager v1 + guion de demo

**S10**
- [ ] A · Modo degradado sin modelo
- [ ] B · Test e2e con egreso bloqueado en CI
- [ ] C · Imágenes firmadas (cosign) + SBOM
- [ ] D · Envío de plantillas legales a la empresa

**S11**
- [ ] A · Terraform de inferencia
- [ ] B · Terraform red/RDS/ECS con `terraform test` + `checkov`
- [ ] C · Paquete de actualización offline
- [ ] D · Material URUCON + data room mínimo

**S12**
- [ ] Todos · Instalación limpia sin red en menos de 1 h
- [ ] Todos · Decisión de corte comercial
