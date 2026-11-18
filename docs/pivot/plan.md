# Plan de acción del pivot: enterprise cerrado con modelos propios

**Estado:** propuesta de trabajo, no forma parte de lo evaluado por la materia. La versión
entregable queda congelada en el tag `entrega-utu-v1` y el pivot avanza en la rama `pivot`.
Cómo se trabaja: [`README.md`](README.md). Estado de cada tarea: [`tablero.md`](tablero.md).

## Punto de partida

| Restricción | Valor |
|---|---|
| Equipo | 4 personas × 4 h/semana = 16 h/semana (~400 h en 6 meses) |
| Presupuesto | USD 0, sin tarjeta de crédito |
| Persona jurídica | No |
| Contactos en empresas | Ninguno |

Decisiones tomadas:

1. Sin APIs de IA de terceros. Groq y Gemini se eliminan.
2. Enterprise cerrado: tenant = empresa, solo sus empleados, el jefe supervisa.
3. El dataset del producto tiene que ser de una empresa real.
4. AWS es la plataforma objetivo. Render y Aiven quedan como transición.

### Lo que no cierra y cómo se resolvió

| Problema | Por qué | Decisión |
|---|---|---|
| Horas | El plan completo suma ~1.130 h y hay ~400 | Se ejecuta solo la versión recortada de abajo |
| AWS sin tarjeta | Learner Lab bloquea IAM y datos de clientes. Educate no da créditos. Activate y el free tier piden cuenta con tarjeta (*a confirmar*) | En enterprise la cuenta de producción es **del cliente**. Se entrega un módulo Terraform verificado sin cuenta (`terraform test` + `mock_provider` + `checkov`). El `apply` espera a un piloto o créditos |
| Dataset real | Depende del calendario. En frío: 2–5 % responde. Con presentación cálida: 40–60 % | Canal cálido primero: profesores, egresados, convenios, URUCON. Corte en la semana 12 |
| "Modelo propio" | Una pyme da volumen para un ranker (≥1.000 pares tarea-persona), rara vez para el planner (≥300 épicas con dependencias) | Ranker y embeddings propios primero. Planner y juez: modelo abierto + gramática + few-shot |
| Autonomía vs. ley laboral | Ley 18.331, art. 16 (decisiones automatizadas sobre rendimiento laboral) y AI Act, Anexo III (alto riesgo). **Consultar abogado** | La IA propone y el jefe veta dentro de un plazo. Si no responde, se aplica la propuesta (sin punto muerto). Lo que evalúa a una persona se explica, se puede apelar y nunca sanciona automáticamente |

Trampas técnicas a tener en cuenta:

- **Licencias:** Qwen2.5-3B no es Apache (licencia de investigación). Usar Qwen3-1.7B (Apache-2.0, verificar la ficha).
- **Umbrales:** cambiar de embeddings anula los umbrales medidos (0.95, 0.73/0.89, 0.50). Hay que recalibrar.
- **Columnas vectoriales:** `vector(1536)` está en `db/migrations/0003_provider_onboarding.sql` y `0004_matching.sql`.
- **Demo:** Render free (512 MB) no puede correr un modelo. La inferencia de la demo puede correr dentro del runner de GitHub Actions, donde ya corren los agentes.

## Roles

| Persona | Rol | Es dueña de |
|---|---|---|
| **A** | IA / ML | `lib/ai`, `lib/planner`, `lib/qa`, modelos y evaluación |
| **B** | Plataforma | `lib/db`, migraciones, RLS, Docker, Terraform y CI |
| **C** | Datos y legal | Especificación del dataset, importador, seudonimizador y plantillas legales |
| **D** | Comercial e integración | Contactos, reuniones y one-pager. Dirige la sincronización semanal |

**Reparto semanal:** 3,5 h de tarea + 0,5 h de sincronización por persona. Una tarea sin su
"terminado cuando" cumplido no está terminada.

**Checklist de la sincronización (30 min):**

- [ ] `npm run verify` en verde en la rama del pivot.
- [ ] Lo de cada uno funciona junto con lo de los demás ("integrado" no es "terminé mi parte").
- [ ] ¿Algún cambio crea un estado del que el sistema no sale solo?
- [ ] ¿Qué bloquea la semana siguiente?

## Semana 0 (sin horas)

- [ ] Completar [`semana-0.md`](semana-0.md): quién es A–D, hardware por máquina, si hay
  menores de edad, si el repo es público o privado, si la institución es miembro de AWS Academy.
- [ ] Tag `entrega-utu-v1` sobre `main`, commit `2db583e` (la versión que evalúa la materia).
- [ ] Rama `pivot` creada y CI corriendo sobre ella (ver [`README.md`](README.md)).

## Fase 1 (S1–S4): inferencia local + kit de datos + primeros contactos

| Sem | Quién | Tarea | Depende de | Terminado cuando |
|---|---|---|---|---|
| S1 | A | Bajar Qwen3-1.7B GGUF Q4_K_M (verificar licencia), levantar `llama-server` y medir | — | `docs/pivot/modelo/benchmark.md` con tok/s, RAM y latencia de un plan |
| S1 | B | Servicio `inferencia` (llama.cpp) en `docker-compose.yml`, con el modelo como volumen | — | `docker compose up inferencia` y `/health` responde 200 |
| S1 | C | Especificación del dataset v0: campos, pedido mínimo vs. ideal, qué NO pedir | — | `docs/pivot/dataset/especificacion.md` revisado por D |
| S1 | D | Lista de 40 contactos cálidos (planilla privada, **nunca en el repo**) + pedido de presentación a 3 profesores | Spec de C | 3 pedidos enviados |
| S2 | A | Proveedor `local` en `lib/ai/providers`, compatible con la API de OpenAI y montado sobre `http.ts` | S1 A+B | `npm run ai:check` pasa contra el contenedor |
| S2 | B | Red cerrada de prueba: compose con `internal: true` | S1 B | Un `curl` a internet falla desde el contenedor y uno a `inferencia` funciona |
| S2 | C | Plantilla de importación CSV + ejemplo con el Public Jira Dataset (MSR 2022, licencia *a confirmar*), marcado **NO PRODUCTIVO** | S1 C | Un CSV de 500 filas pasa el esquema Zod |
| S2 | D | 10 mensajes (email/LinkedIn) + one-pager v0 | S1 D | Enviados y registrados en el funnel |
| S3 | A | Planner con salida restringida: Zod → JSON Schema → gramática de llama.cpp. Si falla 2 veces, plantilla determinista | S2 A | 50 objetivos de prueba → 50 DAG válidos |
| S3 | B | Eliminar Groq y Gemini (código, `.env.example`, docs) | S2 A | `grep -ri "groq\|gemini" lib app scripts` vacío y `verify` en verde |
| S3 | C | `scripts/seudonimizar.ts`: HMAC-SHA256 con sal del cliente sobre personas y emails, elimina texto libre, corre offline | S2 C | Test: el CSV de salida no tiene nombres ni emails |
| S3 | D | 10 contactos más + guion de la primera reunión | — | Guion en `docs/pivot/comercial/` (sin datos personales) |
| S4 | A | Embeddings locales: multilingual-e5-small (MIT, 384 dims) servido por llama.cpp | S3 A | Embebe 100 skills y queda medida la latencia |
| S4 | B | Migración `0013`: `vector(1536)` → `vector(384)` en las columnas y funciones de 0003/0004, y `sql:build` | Dimensión definida por A | `db/verify/` en verde sobre base limpia |
| S4 | C | Plantillas legales v0: NDA mutuo + acuerdo de uso de datos (permiso de entrenamiento, prohibido el uso cruzado entre clientes, borrado, propiedad del modelo), marcadas "revisar con abogado" | S1 C | Revisadas por D y por un profesor |
| S4 | D | **Meta:** 25 contactos y ≥3 reuniones agendadas. Averiguar revisión legal gratuita (*a confirmar*) | — | Funnel actualizado |

## Fase 2 (S5–S8): enterprise mínimo + validación de datos + reuniones

| Sem | Quién | Tarea | Depende de | Terminado cuando |
|---|---|---|---|---|
| S5 | A | Re-embeber y recalibrar umbrales (`skills:calibrate`) | S4 A+B | Valores nuevos en `.env.example`, con las pruebas que los fijan actualizadas |
| S5 | B | Migración `0014`: `organizations` (tenant), membresías y roles `owner`, `jefe`, `lider`, `empleado`, `auditor`, con RLS por tenant | S4 B | `db/verify/` en verde |
| S5 | C | Validador del dataset: fechas, fuga temporal, cobertura de skills, ejemplos por clase → "alcanza / no alcanza" | S3 C | Emite el reporte sobre el dataset público |
| S5 | D | Primeras reuniones y ajuste del mensaje según las objeciones | — | Notas y objeciones registradas |
| S6 | A | Juez local: primero chequeos deterministas, después el modelo por criterio. La decisión sigue en `policy.ts` | S3 A | Pruebas de `lib/qa` en verde contra el modelo local |
| S6 | B | Tests de fuga entre tenants: un usuario de A no lee ni escribe datos de B | S5 B | `npm run test:integracion` en verde |
| S6 | C | Importador CSV → tareas, personas, skills y dependencias | S5 B+C | 500 filas importadas y consultables |
| S6 | D | **Meta:** ≥3 reuniones hechas | — | Funnel actualizado |
| S7 | A | Harness de evaluación: validez del DAG, precisión de asignación, recall@k, p95, RAM. **NO PRODUCTIVO** | S5–S6 A | `npm run eval` produce la tabla |
| S7 | B | Veto con plazo: la asignación queda `propuesta` con `vence_en`, el jefe aprueba o veta, **si vence se aplica sola** | S5 B | Test: una propuesta sin respuesta se aplica en la siguiente corrida del cron |
| S7 | C | Matriz de permisos + qué NO ve el jefe + aviso de transparencia para el empleado | S5 B | `docs/pivot/enterprise/permisos.md` |
| S7 | D | Propuesta de piloto: alcance, criterio de éxito, informe de valor | — | Documento de 1 página |
| S8 | A | Ranker LightGBM LambdaMART (CPU) sobre datos públicos, exportado a JSON | S7 A | Mejora el recall@5 frente a las reglas, o queda documentado por qué no |
| S8 | B | UI del jefe: propuestas pendientes con aprobar/vetar y registro en `audit_logs` | S7 B | Revisada en el navegador |
| S8 | C | Guía "qué exportar en 1–2 h" para Jira, Trello, Azure DevOps, Asana y planillas | S6 C | Probada con al menos un tablero de prueba |
| S8 | D | **Meta:** ≥6 reuniones y 1 empresa en negociación | — | Funnel actualizado |

## Fase 3 (S9–S12): instalable cerrado + AWS sin cuenta + corte

| Sem | Quién | Tarea | Depende de | Terminado cuando |
|---|---|---|---|---|
| S9 | A | Empaquetar modelos: GGUF + SHA256 + manifiesto versionado, publicados en GitHub Releases | S4–S6 A | Una descarga verifica el checksum |
| S9 | B | `docker-compose.onprem.yml`: red interna, modelos locales, sin salida | S2 B, S9 A | El ciclo arranca sin red |
| S9 | C | Checklist de la Ley 18.331: el cliente es responsable del tratamiento (registra la base ante la URCDP), nosotros encargados; retención y borrado | S4 C | `docs/pivot/legal/cumplimiento.md` |
| S9 | D | One-pager v1 + guion de demo de 3 min | S8 | Ensayado frente al equipo |
| S10 | A | Modo degradado: sin modelo, el planner usa plantilla, el juez chequeos deterministas y reintento, el matching reglas | S9 A | Test con `inferencia` apagada: el ciclo termina |
| S10 | B | **Test e2e con egreso bloqueado:** plan → match → entrega → QA → propagar | S9 B | Job de CI en verde |
| S10 | C | Imágenes firmadas con cosign keyless + SBOM con syft en GitHub Actions | S9 B | `cosign verify` pasa |
| S10 | D | Negociación y envío de las plantillas legales | S4 C | Respuesta registrada |
| S11 | A | Módulo Terraform de inferencia (EC2 c7g en subred privada) + costo estimado | — | `terraform validate` en verde |
| S11 | B | Módulos Terraform de red, RDS y ECS con `terraform test` (`mock_provider`) + `checkov` en CI | — | CI en verde **sin cuenta AWS** |
| S11 | C | Paquete de actualización offline: imágenes, modelos y migraciones con verificación de firma | S10 C | Actualiza una instalación sin red |
| S11 | D | Material para URUCON + data room mínimo | — | Revisado por el equipo |
| S12 | Todos | Instalación limpia sin red en una máquina, siguiendo solo el README | Todo lo anterior | Instala en menos de 1 h, y el README queda corregido |
| S12 | Todos | **Decisión de corte comercial** | Funnel | Con socio firmado se pasa a pedir datos. Sin socio, contingencia: la institución como organización real, con consentimiento |

## Sprint 1 (primera semana)

Las cuatro tareas de S1 encajan entre sí así:

1. **A** mide el modelo en su máquina.
2. **B** lo levanta en un contenedor.
3. **C** define qué datos se piden.
4. **D** usa esa definición para hacer el pedido de presentación.

**Integrado cuando:** `docker compose up inferencia` responde, el benchmark de A coincide con
el contenedor de B, y el pedido de D cita la especificación de C.

## Metas del funnel

| Semana | Meta |
|---|---|
| S1 | 40 contactos cálidos listados, 3 pedidos de presentación |
| S4 | 25 contactos hechos, ≥3 reuniones agendadas |
| S8 | ≥6 reuniones hechas, 1 empresa en negociación |
| S12 | Corte: socio firmado o contingencia |

## NO HACER AHORA

| Qué | Lo desbloquea |
|---|---|
| Fine-tuning con datos de una empresa | Acuerdo de datos firmado + validador en "alcanza" |
| Claim de "entrenado con datos reales" | Lo anterior y el modelo evaluado con esos datos |
| Fine-tuning del planner | ≥300 épicas reales con dependencias |
| `terraform apply` en AWS | Piloto pago o créditos de AWS Activate |
| SSO (OIDC/SAML), SCIM, MFA | Un cliente que lo exija por contrato |
| Formalizar una SAS | Piloto con intención de pago o fondo que lo exija |
| ISO 27001 / SOC 2, pentest externo | Capital |
| Deck completo y modelo financiero | Socio firmado con métricas del piloto |

---

**Uso de IA y autoría.** Este documento se elaboró con asistencia de Claude (Anthropic). Las
decisiones de diseño, la revisión y la verificación son de los autores, que asumen la
responsabilidad sobre su contenido. Constancia formal en
[`11-declaracion-de-uso-de-ia.md`](../11-declaracion-de-uso-de-ia.md).
