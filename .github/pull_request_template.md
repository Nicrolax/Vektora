## Qué cambia

<!-- Una o dos líneas. Si es una tarea del pivot: "S3 · C · Seudonimizador" -->

## Tarea del plan

- Semana y persona: <!-- S#, A/B/C/D, o "fuera del plan" -->
- Terminado cuando (copiado de docs/pivot/plan.md):
- [ ] Se cumple, y lo verifiqué así: <!-- comando, captura o test -->

## Antes de pedir review

- [ ] `npm run verify` en verde (y `npm run build` si toqué `app/`)
- [ ] Si toqué SQL: corrí `db/verify/` sobre una base limpia
- [ ] Si toqué UI: la revisé en el navegador
- [ ] ¿Este cambio crea un estado del que el sistema no sale solo? <!-- No / Sí, y se resuelve así: … -->
- [ ] No agrega llamadas a APIs de IA externas (Groq, Gemini u otras)
- [ ] No sube datos de una empresa, contactos, pesos de modelos ni secretos
- [ ] Marqué la tarea en `docs/pivot/tablero.md`

**Review:** lo aprueba alguien que no lo escribió (A ↔ B, C ↔ D).
