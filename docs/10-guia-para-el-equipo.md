# Cómo funciona VEKTORA — guía para el equipo

Esta guía está escrita para quien no tocó el código. Explica qué hace el sistema, qué hace
cada parte y cómo se prueba. Sin tecnicismos.

## Qué es VEKTORA

Una plataforma que **coordina proyectos de trabajo sin que ninguna persona los gestione**.

Normalmente, cuando un cliente contrata un trabajo, hay alguien en el medio: un jefe de
proyecto que divide la tarea, busca quién la hace, revisa lo entregado y aprueba. VEKTORA
hace todo eso solo. No hay panel donde alguien apruebe nada, porque no hay nadie.

## El recorrido completo

Seis pasos. Entre el primero y el último no interviene ninguna persona.

**1. Alguien escribe qué quiere.** Una frase y un presupuesto. Por ejemplo: *"una guía de
estilo de marca para una cafetería de especialidad"*, 800 dólares.

**2. El sistema lo parte en tareas.** Una inteligencia artificial lee ese objetivo y arma una
lista de tareas concretas: investigar el mercado, diseñar el logo, definir la tipografía, y
así. Además descubre qué depende de qué — no se puede diseñar el logo antes de decidir el
posicionamiento — y reparte el presupuesto entre todas.

**3. Se dibuja el orden de ejecución.** Ese mapa de "esto va antes que aquello" se llama
**grafo**. Es lo que se ve en pantalla: cada tarea es una caja, las flechas indican qué
espera a qué, y la columna en la que cae cada caja es el momento real en que se va a hacer.
Las tareas que no dependen de nada arrancan disponibles; el resto quedan bloqueadas.

**4. El sistema busca quién hace cada tarea.** Compara la tarea con el perfil de cada
proveedor registrado y le da un puntaje que mezcla tres cosas: cuánto se parece el trabajo a
lo que esa persona sabe hacer, cuántas de las habilidades pedidas tiene, y su reputación
acumulada. Si alguien supera el umbral, le adjudica la tarea. Solo.

**5. El proveedor entrega.** Sube su trabajo junto con la evidencia de que cumple cada
requisito.

**6. Otra inteligencia artificial lo evalúa.** Compara lo entregado contra los requisitos que
se habían escrito *antes* de que nadie trabajara, uno por uno, y cita la parte exacta que
demuestra cada uno. Si aprueba, **las tareas que dependían de esta se desbloquean solas** y
el ciclo vuelve a empezar con ellas.

Ese último paso es el corazón del proyecto: el trabajo avanza sin que nadie apriete nada.

## Qué hace cada parte del código

| Carpeta | En palabras simples |
|---|---|
| `app/` | Todo lo que se ve en el navegador: las pantallas, los formularios, los botones |
| `components/` | Piezas visuales reutilizables. Acá vive el dibujo del grafo |
| `lib/ai/` | El traductor con las inteligencias artificiales. Si una falla, cambia a la otra sola |
| `lib/planner/` | Convierte el objetivo escrito en la lista de tareas y su orden |
| `lib/matching/` | Decide quién hace cada tarea |
| `lib/qa/` | Evalúa los entregables y decide si se aprueban |
| `lib/cuotas/` | Pone topes de uso para que nadie agote los servicios gratuitos |
| `lib/validacion/` | Rechaza entradas sin sentido: correos falsos, textos vacíos, presupuestos imposibles |
| `db/` | La base de datos: cómo se guarda todo y quién puede ver qué |
| `docs/` | La documentación del proyecto (esta guía incluida) |
| `scripts/` | Herramientas para probar cosas desde la terminal sin abrir el navegador |
| `lib/db/` | La única puerta a la base de datos: consultas parametrizadas, transacciones y permisos por persona |
| `lib/auth/` | El inicio de sesión: contraseñas con BCrypt, la cookie de sesión y qué puede hacer cada rol |
| `sql/` | Los dos scripts que crean la base y cargan los datos de prueba (se generan desde `db/`) |
| `k8s/` | Los archivos para correr todo en Kubernetes (minikube) |
| `tests/` | 371 pruebas automáticas que verifican que nada se rompa, más 16 contra una base real |

## Tres ideas que explican casi todo

**El orden de las tareas es un mapa, no una lista.** Un proyecto real no es "hacer 1, después
2, después 3": hay cosas que pueden ir en paralelo y otras que tienen que esperar. Por eso se
usa un grafo. Y cuando una tarea se aprueba, el sistema recalcula solo qué quedó disponible.

**La IA no decide si se aprueba un trabajo.** Esto es importante y suele malinterpretarse. La
IA responde preguntas chiquitas y concretas: *"¿este documento cumple el requisito 2? Mostrame
dónde"*. Con esas respuestas, un código fijo y predecible calcula la nota y el resultado. Se
hizo así porque preguntarle directamente "¿está bien?" da respuestas distintas cada vez —
lo probamos tres veces con el mismo entregable y contestó tres cosas diferentes.

**Nadie aprueba nada, y eso obliga a tener cuidado.** El error más peligroso del proyecto no
da ningún mensaje de error: es cuando el sistema queda esperando una decisión de una persona
que no existe. La tarea se queda quieta para siempre y bloquea a todas las que dependían de
ella. Nos pasó cuatro veces durante el desarrollo y las cuatro hubo que salir a buscarlas,
porque nada avisa.

## Cómo verlo funcionando

En internet, sin instalar nada: **https://vektora.onrender.com** (la primera vez puede
tardar casi un minuto: el plan gratis de Render «duerme» el servicio cuando nadie lo usa).
Se entra con `cliente@vektora.test` y la contraseña de prueba `Demo-Vektora-2026`.

Desde la computadora, con Docker Desktop instalado, dentro de la carpeta del proyecto:

```
docker compose up --build -d   # levanta la base y la aplicación en http://localhost:3000
npm run cron                    # empuja al sistema a trabajar (adjudicar y evaluar)
```

`npm run cron` existe por una razón: en internet hay un reloj (GitHub Actions) que dispara
esas dos acciones solo, cada 10 y 15 minutos. En una computadora no hay reloj, así que se le
da cuerda a mano. Es el mismo código, solo que ejecutado por nosotros en vez de por el reloj.

La guía completa, paso a paso, está en [`guia-despliegue.md`](guia-despliegue.md).

## Lo que conviene saber para defender el proyecto

- **371 pruebas automáticas** pasan en verde, más 16 contra una base de datos real y
  comprobaciones directas del SQL. GitHub las corre solo en cada cambio.
- **Todo corre en servicios gratuitos**: Aiven guarda los datos (PostgreSQL), Render sirve la
  web con HTTPS, GitHub guarda el código, la imagen Docker y hace de reloj, y Groq y Google
  proveen la inteligencia artificial.
- **Las contraseñas se guardan con BCrypt**, nunca en texto, y las consultas a la base son
  siempre parametrizadas: no se puede inyectar SQL.
- **La seguridad se revisó con cinco herramientas** (dependencias, código, imagen Docker, la
  web desplegada y secretos en el historial). Lo que encontraron y cómo se corrigió está en
  [`informe-seguridad.md`](informe-seguridad.md).
- **Los números del sistema están medidos, no inventados.** Los umbrales que deciden si se
  adjudica una tarea salieron de medir casos reales, y está documentado de dónde sale cada
  uno.
- **La documentación completa está en `docs/`**: teoría, requisitos, stack, diagramas de
  clases, casos de uso e infraestructura (01 a 07), la guía de despliegue, el informe de
  seguridad, los diagramas (`docs/diagramas/`) y la guía para la defensa (`defensa.md`).

---

**Uso de IA y autoría.** Este documento se elaboró con asistencia de Claude (Anthropic,
modelo `claude-opus-5`). Las decisiones de diseño, la revisión y la verificación son de los
autores, que asumen la responsabilidad sobre su contenido. Constancia formal en
[`11-declaracion-de-uso-de-ia.md`](11-declaracion-de-uso-de-ia.md).
