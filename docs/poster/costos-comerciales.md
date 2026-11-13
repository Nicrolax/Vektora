# Costo de una versión comercial de VEKTORA

Respaldo de la cifra que aparece en el póster de URUCON Juniors 2026 (sección 5,
«Conclusiones y próximos pasos»).

**Consultado el 13 de noviembre de 2026.**

## Resumen

| | Prototipo actual | Comercial mínimo | Comercial de producción |
|---|---|---|---|
| Aplicación (Render) | US$ 0 (Free) | US$ 32 | US$ 50 |
| Base de datos (Aiven PostgreSQL) | US$ 0 (Free) | US$ 12 | US$ 75 |
| Dominio propio | — | ≈ US$ 1 | ≈ US$ 1 |
| IA (Groq + Gemini) | US$ 0 (free tier) | centavos por proyecto | centavos por proyecto |
| **Total por mes** | **US$ 0** | **≈ US$ 45** | **≈ US$ 126** |

El póster decía «unos US$ 100 por mes más el uso de IA». **La cifra no estaba bien.** Con los
precios de hoy, una instalación comercial cuesta **entre US$ 45 y US$ 126 por mes** de
infraestructura, según si la base de datos tiene recursos dedicados. El póster se corrigió en
ese sentido.

## Detalle por servicio

### Render (aplicación Next.js en Docker)

Desde abril de 2026, Render cobra un plan por *workspace* y, aparte, cada servicio según su
tamaño de instancia.

| Concepto | Precio | Por qué |
|---|---|---|
| Workspace **Pro** | US$ 25 / mes | Un equipo de cuatro personas. El plan Hobby es para una sola persona |
| Instancia **Starter** (512 MB, 0,5 CPU) | US$ 7 / mes | Escenario mínimo. Sin la pausa por inactividad del plan Free |
| Instancia **Standard** (2 GB, 1 CPU) | US$ 25 / mes | Escenario de producción. `next build` en modo `standalone` entra con margen |

Mínimo: 25 + 7 = **US$ 32**. Producción: 25 + 25 = **US$ 50**.

Algunas fuentes todavía muestran el modelo anterior a abril de 2026: US$ 19 o US$ 29 **por
usuario**. Con ese modelo, cuatro personas costarían más, no menos.

### Aiven for PostgreSQL (con pgvector)

| Plan | Precio | Uso |
|---|---|---|
| Free | US$ 0 | El que usa el prototipo |
| Developer | US$ 5 / mes | Desarrollo. No sirve para producción |
| Hobbyist | desde US$ 12 / mes | Escenario mínimo |
| **Startup-4** (1 CPU, 4 GB RAM, 50 GB SSD) | US$ 75 / mes | Escenario de producción, con copias de seguridad y recursos dedicados |

### IA

Los modelos son los que el código usa por defecto (`lib/ai/config.ts`).

| Modelo | Proveedor | Entrada / salida por millón de tokens |
|---|---|---|
| `openai/gpt-oss-120b` | Groq (principal) | US$ 0,15 / US$ 0,60 |
| `gemini-3.6-flash` | Google AI Studio (respaldo) | US$ 0,75 / US$ 3,75 * |
| `gemini-embedding-001` | Google AI Studio | US$ 0,15 la entrada; la salida no se cobra |

\* Para Gemini 3.6 Flash, varias fuentes dan US$ 1,50 / US$ 7,50 y otras US$ 0,75 / US$ 3,75,
que sería el precio después de una rebaja de agosto de 2026. Igual es solo el respaldo: se
usa cuando Groq falla.

**Orden de magnitud por proyecto.** Supongamos un objetivo dividido en 6 tareas: un plan
(≈ 5 000 tokens de entrada y 3 000 de salida) y dos evaluaciones del juez por tarea (≈ 4 000
y 1 000 cada una). Eso suma unos 53 000 tokens de entrada y 15 000 de salida. Con
`gpt-oss-120b` cuesta **menos de US$ 0,02**. Los tokens por llamada son una suposición, no
una medición. Para medirlos, hay que sumar `ai_runs` en la base desplegada. Igual, el costo
de IA es despreciable frente a la infraestructura, aun si fuera diez veces mayor.

### Otros

- **Dominio `.com`:** unos US$ 10 por año de renovación, ≈ US$ 1 por mes. El primer año suele
  costar menos por promociones.
- **GitHub Actions** (dispara los agentes cada 10 y 15 minutos, en `.github/workflows/agentes.yml`):
  gratis e ilimitado en un repositorio público, y el del proyecto (`Nicrolax/Vektora`) lo
  es. Si algún día pasara a privado, el plan Free incluye 2 000 minutos por mes en Linux y
  el excedente cuesta US$ 0,002 por minuto: los alrededor de 7 000 disparos por mes
  costarían unos US$ 10. Para no depender de eso, el planificador se puede pasar a un
  *cron job* de Render.

## Cómo se verificó y qué falta

Desde el entorno donde se armó este documento no se pudo entrar a las páginas oficiales.
`render.com`, `aiven.io` y `groq.com` estaban bloqueados por la red. Los precios salen de
búsquedas web del 13 de noviembre de 2026, que en su mayoría citan agregadores de precios.
Cuando dos fuentes no coincidían, quedó anotado arriba.

**Antes de citar las cifras como definitivas**, alguien del equipo tiene que confirmarlas en:

- https://render.com/pricing
- https://aiven.io/pricing?product=pg
- https://groq.com/pricing
- https://ai.google.dev/gemini-api/docs/pricing
- https://docs.github.com/en/billing/concepts/product-billing/github-actions

Fuentes consultadas:

- Render: [bex.co: «Render repriced twice in one week»](https://bex.co/blog/2026/09/04/render-price-changes-cost-sheet), [Kuberns: Render pricing guide](https://kuberns.com/blogs/render-pricing/), [budgetforge.dev: Render pricing 2026](https://www.budgetforge.dev/tools/render-pricing-2026)
- Aiven: [blog de Aiven: planes de PostgreSQL](https://aiven.io/blog/bigger-faster-cheaper-aiven-postgresql), [frontdeskreview: Aiven pricing 2026](https://frontdeskreview.com/software/managed-postgres/aiven/), [hoststack.dev: managed Postgres en Europa](https://hoststack.dev/blog/managed-postgresql-europe-buyers-guide)
- Groq: [morphllm: Groq pricing 2026](https://www.morphllm.com/groq-pricing), [CloudZero: Groq pricing](https://www.cloudzero.com/blog/groq-pricing/)
- Gemini: [apidog: Gemini 3.6 Flash pricing](https://apidog.com/blog/gemini-3-6-flash-pricing/), [pricepertoken: Gemini 3.6 Flash](https://pricepertoken.com/pricing-page/model/google-gemini-3.6-flash), [LiteLLM: gemini-embedding-001](https://models.litellm.ai/models/gemini-embedding-001)
- GitHub Actions: [documentación de facturación de GitHub](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- Dominios: [domainoffer.net: precios de .com](https://domainoffer.net/tld/com)

---

**Uso de IA y autoría.** Este documento se elaboró con asistencia de Claude (Anthropic). Las
decisiones, la revisión y la verificación son de los autores. Constancia formal en
[`../11-declaracion-de-uso-de-ia.md`](../11-declaracion-de-uso-de-ia.md).
