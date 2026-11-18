# Semana 0: datos para arrancar

Se completa **una sola vez**, en un PR hacia `pivot`. Varias decisiones del plan dependen de
estas respuestas: qué modelo entra en qué máquina, quién puede firmar, qué runner tiene CI.

## 1. Quién es quién

| Rol | Persona | Usuario de GitHub |
|---|---|---|
| A — IA / ML | | |
| B — Plataforma | | |
| C — Datos y legal | | |
| D — Comercial e integración | | |

## 2. Hardware por máquina

Define si el modelo de 1.7B corre en local y quién hace el benchmark de S1.

| Persona | CPU (modelo, núcleos) | RAM | GPU / VRAM | Sistema operativo | ¿Tiene Docker? |
|---|---|---|---|---|---|
| A | | | | | |
| B | | | | | |
| C | | | | | |
| D | | | | | |

## 3. Preguntas de sí o no

**No escribir edades ni datos personales.** Alcanza con sí o no.

| Pregunta | Respuesta | Por qué importa |
|---|---|---|
| ¿Algún integrante es menor de 18? | | Cambia quién puede firmar NDA y acuerdos, y la formalización |
| ¿El repo es público? | | Los runners de repos públicos son más grandes (inferencia en CI) |
| ¿La institución es miembro de AWS Academy? | | Habilita el Learner Lab (~USD 100, *a confirmar*) |
| ¿La rúbrica de la materia sigue abierta? | | Si sí, `main` no se toca salvo correcciones de la entrega |
| ¿Hay un profesor dispuesto a presentarnos con empresas? | | Es el canal de mayor conversión del funnel |
