# Pivot: VEKTORA enterprise cerrado

Todo lo del pivot vive en esta carpeta. Lo que está fuera de `docs/pivot/` es la documentación
de la materia y **no se toca** por el pivot.

| Archivo | Para qué |
|---|---|
| [`plan.md`](plan.md) | Qué se hace, por qué, en qué orden y cuándo una tarea está terminada |
| [`tablero.md`](tablero.md) | Estado de cada tarea. Se marca en el mismo PR que la termina |
| [`semana-0.md`](semana-0.md) | Datos que faltan para arrancar. Se completa una sola vez |

Cada tarea deja su resultado en una subcarpeta, que se crea cuando se necesita:

| Subcarpeta | Qué va | Dueño |
|---|---|---|
| `modelo/` | Benchmarks, licencias verificadas, resultados de evaluación | A |
| `plataforma/` | Decisiones de base, despliegue on-prem y Terraform | B |
| `dataset/` | Especificación, guías de exportación, reportes del validador | C |
| `legal/` | Plantillas (NDA, acuerdo de datos) y checklist de cumplimiento | C |
| `enterprise/` | Matriz de permisos, aviso de transparencia | C |
| `comercial/` | Guion de reunión, one-pager, propuesta de piloto. **Sin nombres ni contactos** | D |

## Ramas

```
main      ← versión de la materia (tag entrega-utu-v1). Solo correcciones de la entrega.
pivot     ← integración del pivot. CI obligatorio. Nadie empuja directo.
s1-a-benchmark, s2-b-red-cerrada, …  ← una rama por tarea, con PR hacia pivot.
```

- **Nombre de rama:** `s<semana>-<persona>-<tema>`, por ejemplo `s3-c-seudonimizador`.
- **Un PR por tarea.** La plantilla de PR pide el "terminado cuando" del plan. Si no se
  cumple, el PR no se aprueba.
- **Review cruzado:** el PR lo aprueba alguien que no lo escribió. A ↔ B, C ↔ D.
- **`main` no recibe el pivot** hasta que el equipo lo decida, para no romper la demo ni la
  entrega.

## Dónde va cada cosa (y dónde nunca)

| Qué | Dónde | ¿Se versiona? |
|---|---|---|
| Pesos de modelos (`.gguf`, `.safetensors`) | `modelos/` local · GitHub Releases con SHA256 | **No** en git |
| Datasets públicos (marcados NO PRODUCTIVO) | `datos/publicos/` | **No** |
| Exportes de una empresa | Solo en la infraestructura del cliente, o `datos/clientes/` seudonimizado | **Nunca** |
| Contactos, funnel, notas con nombres | `privado/` o una planilla fuera del repo | **Nunca** |
| Fixtures chicos y sintéticos para tests | `tests/fixtures/` | Sí |
| Estado de Terraform, `*.tfvars` | Local / backend remoto | **No** |

`.gitignore` ya bloquea `modelos/`, `datos/`, `privado/`, pesos y estado de Terraform.
gitleaks (`seguridad.yml`) sigue buscando secretos.

## Ritual semanal (30 min, lo dirige D)

1. ¿`npm run verify` está en verde en `pivot`?
2. Repasar el `tablero.md`: ¿cada tarea marcada cumple su "terminado cuando"?
3. ¿Lo de cada uno funciona junto con lo de los demás? "Integrado" no es "terminé mi parte".
4. ¿Algún cambio crea un estado del que el sistema no sale solo?
5. ¿Qué bloquea la semana siguiente? Lo que no entre en 16 h va a "NO HACER AHORA".

## Reglas que cambian con el pivot

Resumidas también en `CLAUDE.md`:

1. **Sin APIs de IA externas.** No se agrega ninguna llamada nueva a Groq ni a Gemini. La
   inferencia va a `llama-server` local, siempre a través de `getAiClient()`.
2. **"La IA propone, el jefe veta con plazo."** Si el plazo vence, se aplica la propuesta.
   Una aprobación pendiente es un estado más del que el sistema tiene que salir solo.
3. **Datos públicos = NO PRODUCTIVO.** Ningún texto, slide ni commit dice "entrenado con
   datos reales" hasta que lo sea.
4. **Cambiar de embeddings invalida los umbrales medidos.** Se recalibra antes de dar la
   tarea por terminada.
5. **Lo que evalúa a un empleado se explica y se puede apelar.** Nunca produce una sanción
   automática.
