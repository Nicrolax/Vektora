# Servicio `inferencia` (S1 · B)

llama.cpp sirviendo un modelo GGUF local dentro del compose. Es la base de la regla
"sin APIs de IA externas": el modelo es un archivo y, una vez bajado, todo funciona sin
internet.

## Cómo se usa

Requiere el `.env` completo, igual que el resto del compose: el compose valida las
variables de la base aunque solo se levante la inferencia.

```bash
npm run modelo:bajar
```

```bash
docker compose up -d --wait inferencia
```

```bash
curl http://127.0.0.1:8080/health
```

```bash
docker compose --profile ia down
```

- **Bajar:** `npm run modelo:bajar` deja `modelos/Qwen3-1.7B-Q4_K_M.gguf` (~1,3 GB) con el SHA256 verificado.
- **Comprobar:** `/health` responde 503 mientras carga el modelo y 200 cuando está listo.
- **Apagar:** el servicio tiene el perfil `ia`, y sin `--profile ia` el `down` no lo baja.
- **Catálogo:** `npm run modelo:bajar -- --lista` muestra los modelos disponibles. `prueba` es uno de 1 MB para pruebas de humo.
- **Otro modelo:** se elige con `INFERENCIA_MODELO` en `.env`, siempre un archivo dentro de `modelos/`.
- **Detrás de un proxy:** el `fetch` de Node no lo usa por defecto. Correr la descarga con `NODE_USE_ENV_PROXY=1`.

## Decisiones

| Decisión | Por qué |
|---|---|
| Imagen oficial `ghcr.io/ggml-org/llama.cpp:server-b11870`, fijada por **digest** | El tag solo no garantiza los mismos bytes. La b11870 es del 2026-10-25 |
| Perfil `ia` | `docker compose up` a secas sigue levantando solo db + app: quien no bajó el modelo no se rompe |
| Sin `depends_on` desde `app` | Cuando la app la use (S2 · A), tiene que degradar si la inferencia no responde, no esperarla para siempre |
| Usuario `65534` (nobody), raíz de solo lectura, sin capacidades, `no-new-privileges` | Endurecimiento sin costo. El modelo se monta en solo lectura |
| Puerto solo en `127.0.0.1` | La app lo alcanza por la red interna (`http://inferencia:8080`). No queda expuesto a la red local |
| Revisión exacta y SHA256 en `scripts/modelo-bajar.ts` | Nada se usa sin verificar. Si el archivo cambia en origen, la descarga falla y lo borra |
| `LLAMA_ARG_ALIAS=vektora-local` | El nombre que verá `lib/ai` no depende del archivo |
| Mensaje propio si falta el modelo | llama-server falla con un error poco claro. El nuestro dice qué hacer |

## Medición de referencia (no es el benchmark de S1 · A)

En el contenedor de desarrollo de la nube (4 vCPU, 16 GB, sin GPU), con el modelo por
defecto y contexto 8192:

| Métrica | Valor |
|---|---|
| De `up` a `/health` 200 | ~6 s |
| Generación | ~18,7 tok/s |
| RAM del contenedor | ~2,0 GB |
| Respuesta a un pedido de "3 tareas en JSON" | JSON válido en ~7,5 s |

El benchmark que vale es el de S1 · A, en las máquinas del equipo
(`docs/pivot/modelo/benchmark.md`).

## CI

El job `inferencia` de `ci.yml` baja el modelo de prueba, levanta el servicio con
`--wait`, exige `/health` 200 y una respuesta de `/completion`. Comprueba que el servicio
arranca y responde, no la calidad del modelo.

## Licencias

| Modelo | Licencia |
|---|---|
| Qwen3-1.7B | Apache-2.0, según las fichas de `Qwen/Qwen3-1.7B` y `ggml-org/Qwen3-1.7B-GGUF` |
| `prueba` (stories260K) | Solo para pruebas. Su repositorio no declara licencia (proyecto llama2.c, MIT, *a confirmar*) |
