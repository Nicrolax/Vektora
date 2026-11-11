# Qué hicimos y por qué — guía para entender el proyecto desde cero

Esta guía es para cualquiera del equipo que **no escribió el código** y tiene que poder
explicarlo. No hace falta saber programar para leerla. Si una palabra suena rara, está en el
[diccionario](#3-diccionario-las-palabras-que-van-a-escuchar).

Orden recomendado: leer las secciones 1 y 2 una vez entera, aprender de memoria la sección 1
y usar las secciones 4 y 5 para practicar preguntas.

---

## 1. VEKTORA en 30 segundos

> Una persona escribe lo que quiere lograr y cuánto quiere gastar. Una inteligencia
> artificial lo divide en tareas y decide en qué orden van. El sistema elige solo quién hace
> cada tarea. Cuando alguien entrega, otra inteligencia artificial revisa si cumple lo pedido,
> requisito por requisito. Si cumple, las tareas siguientes se liberan solas. **Ninguna
> persona aprueba nada en el medio**, y cada decisión queda guardada con su explicación.

Si les piden una sola frase: *«Es una plataforma donde los proyectos se organizan, se
asignan y se revisan solos»*.

---

## 2. La historia del proyecto, en orden

El proyecto se hizo en dos grandes etapas. Primero se **construyó el producto** (fases 1 a 7)
y después se hizo el **examen de despliegue** (etapa 0 y fases 1 a 6), que pedía ponerlo a
funcionar de varias formas y revisar su seguridad.

### Etapa A — Construir el producto

| Fase | Qué se hizo | Por qué |
|---|---|---|
| 1 | **La base de datos**: 14 tablas (usuarios, proyectos, tareas, proveedores, entregas, reputación…) | Todo lo que el sistema sabe y decide tiene que quedar guardado en algún lado |
| 2 | **La conexión con la IA**: un único «traductor» que habla con Groq y, si Groq falla, pasa solo a Gemini | Si dependiéramos de una sola IA gratis, cuando se cae o se acaba la cuota se cae todo |
| 3 | **El planificador**: la IA convierte el objetivo en tareas con su orden, presupuesto y requisitos | Es el primer paso del ciclo: sin tareas no hay nada que asignar |
| 3.5 | **El alta de proveedores**: cada uno carga sus habilidades y el sistema las ordena | Para poder comparar personas con tareas hay que hablar el mismo «idioma» de habilidades |
| 4 | **El matching**: un puntaje decide quién hace cada tarea | Es la segunda decisión que el sistema toma solo |
| 5 | **La IA jueza**: revisa lo entregado contra los requisitos | Es la tercera decisión: aceptar o devolver el trabajo |
| 6 | **La página web**: pantallas, botones y el dibujo del grafo | Para que una persona pueda usar todo lo anterior sin la terminal |
| 7 | **Límites y validaciones**: topes de uso, rechazar datos sin sentido, y la «escalada» | Para que nadie gaste la cuota gratis de todos, y para que ninguna tarea quede trabada |

### Etapa B — El examen de despliegue

| Fase | Qué se hizo | Por qué |
|---|---|---|
| 0 | **Salir de Supabase**: la base pasó a ser PostgreSQL común, con login propio | Supabase hacía el login y las consultas por nosotros; el examen pedía que lo hiciéramos nosotros (contraseñas con BCrypt y consultas preparadas) |
| 1 | **Docker**: la app y la base empaquetadas; un comando las levanta | Para que funcione igual en cualquier computadora, sin instalar nada a mano |
| 2 | **Aiven**: la base en la nube, con conexión cifrada (SSL) | El examen pedía una base en la nube; Aiven es gratis y sin tarjeta |
| 3 | **Render**: la app publicada en internet con HTTPS, y GitHub Actions como reloj | Render gratis no tiene tareas programadas, así que GitHub «toca el timbre» cada 10 y 15 minutos |
| 4 | **Kubernetes**: todo corriendo en minikube | El examen pedía el tercer nivel: un clúster de contenedores |
| 5 | **Seguridad**: cinco herramientas revisaron todo; se corrigió lo que encontraron | El examen pedía analizar la seguridad y mostrar el antes y el después |
| 6 | **Documentación**: diagramas, guía de despliegue, guía para la defensa | Para que el docente (y otro grupo) pueda entender y repetir todo |

---

## 3. Diccionario: las palabras que van a escuchar

| Palabra | Qué es, en simple |
|---|---|
| **Grafo / DAG** | Un dibujo de cajas (tareas) unidas por flechas que dicen «esto va antes que aquello». *DAG* significa que nunca hay un círculo: ninguna tarea se espera a sí misma |
| **IA / modelo de lenguaje** | Un programa que lee y escribe texto. Usamos Groq y Gemini (de Google) en sus planes gratis |
| **Prompt** | Las instrucciones en texto que le mandamos a la IA |
| **Embedding** | Una lista de números que representa el *significado* de un texto. Dos textos que hablan de lo mismo tienen números parecidos |
| **pgvector** | Un agregado de PostgreSQL que busca rápido los embeddings más parecidos. Así encontramos proveedores para una tarea |
| **Base de datos / PostgreSQL** | Donde se guarda todo, en tablas (como hojas de cálculo con reglas) |
| **SQL** | El idioma para pedirle cosas a la base: «dame los proyectos de este cliente» |
| **Consulta preparada (parametrizada)** | Mandar la pregunta y los datos por separado. Así nadie puede colar una orden escondida en un dato (eso se llama *inyección SQL*) |
| **Hash / BCrypt** | Las contraseñas no se guardan, se guarda una «huella» de la que no se puede volver atrás. BCrypt es una forma lenta a propósito de calcular esa huella, para que probar contraseñas al azar cueste mucho |
| **JWT / cookie de sesión** | Un «pase» firmado que el navegador guarda al entrar, para no pedir la contraseña en cada página |
| **Roles** | Qué tipo de usuario sos: cliente, proveedor, ambos o administrador. Cada uno puede hacer cosas distintas |
| **RLS** | Reglas dentro de la base que dicen qué filas puede ver cada persona. Aunque la página fallara, la base no le muestra a nadie lo que no es suyo |
| **Transacción** | Varias operaciones que se hacen todas juntas o ninguna. Si una falla, se deshace todo (*rollback*); si salen bien, se confirma (*commit*) |
| **Docker / imagen / contenedor** | Una *imagen* es la app empaquetada con todo lo que necesita. Un *contenedor* es esa imagen funcionando. Corre igual en cualquier lado |
| **Docker Compose** | Un archivo que levanta varios contenedores juntos (la base y la app) con un solo comando |
| **ghcr.io** | El «depósito» de imágenes de GitHub. Ahí publicamos la nuestra |
| **Kubernetes / minikube / pod** | Kubernetes organiza muchos contenedores, los reinicia si fallan y los conecta. minikube es un Kubernetes chiquito para una sola computadora. Un *pod* es un contenedor (o grupo) corriendo ahí |
| **Aiven** | Empresa que nos presta, gratis, una base PostgreSQL en la nube |
| **Render** | Empresa que publica, gratis, nuestra app en internet: <https://vektora.onrender.com> |
| **HTTPS / SSL** | La conexión cifrada (el candadito del navegador). Nadie en el medio puede leer lo que viaja |
| **GitHub Actions / CI** | Robots de GitHub que, en cada cambio, compilan, corren las pruebas y revisan la seguridad. *CI* es «integración continua» |
| **Cron / el reloj** | Una tarea que se ejecuta sola cada cierto tiempo. El nuestro llama a la app para que adjudique y evalúe |
| **Variable de entorno / `.env`** | Datos de configuración (como contraseñas) que se le dan a la app *afuera* del código. El archivo `.env` nunca se sube a GitHub |
| **`/health`** | Una página que responde «todo bien» (200) si la app y la base andan, o «algo falla» (503). La usan Docker, Render y Kubernetes |
| **TypeScript** | JavaScript con tipos: el editor avisa errores antes de ejecutar |
| **Next.js** | La herramienta con la que están hechas las pantallas y el servidor |
| **Zod** | Una librería que revisa que los datos tengan la forma correcta. Si la IA devuelve algo mal armado, Zod lo detecta y se le pide que lo corrija |
| **Prueba automática (test)** | Un pequeño programa que comprueba que otra parte hace lo que debe. Tenemos 371 |

---

## 4. Por qué cada decisión

Si el docente pregunta «¿por qué hicieron X?», casi siempre la respuesta está acá.

| Decisión | Por qué |
|---|---|
| **Que ninguna persona decida en el ciclo** | Si se deja la salida «que decida una persona», todos los casos difíciles terminan ahí y el sistema nunca aprende a resolverlos. Además, el problema que atacamos es justamente el costo de esa persona |
| **La IA no decide si se aprueba un trabajo** | Le preguntamos directamente «¿está bien?» tres veces con el mismo trabajo y contestó tres cosas distintas. Ahora le hacemos preguntas chicas («¿cumple el requisito 2? ¿dónde?») y un código fijo calcula el resultado |
| **Hacen falta 2 intentos para rechazar** | Una sola respuesta de la IA puede ser mala suerte. No puede cerrar una tarea para siempre |
| **Si la IA se cae, no cuenta como rechazo** | Una falla nuestra nunca puede castigar a un proveedor |
| **Un proveedor nuevo arranca con reputación 0,5** | Si arrancara en 0, nunca ganaría su primer trabajo |
| **La escalada tras 4 rondas** | Si nadie alcanza el puntaje, la tarea esperaría para siempre a alguien mejor que quizá no existe. A las 4 rondas el puntaje mínimo baja |
| **Los números (umbrales) están medidos** | Se calcularon con casos reales (por ejemplo, 0 de 435 pares de habilidades distintas se confunden). Inventarlos daba resultados absurdos |
| **Dos IA (Groq y Gemini)** | Son gratis pero tienen cortes y límites. Si una falla, sigue la otra sin que nadie haga nada |
| **Validar las respuestas de la IA con Zod** | Pedirle algo en el prompt es una esperanza; una regla en el código es una garantía. Si la IA se equivoca, se le devuelve el error exacto para que corrija |
| **Pasar de Supabase a PostgreSQL** | El examen pedía login propio con BCrypt, consultas preparadas en nuestro código y una base que se crea con scripts SQL |
| **Docker** | La misma app corre igual en una PC, en Render y en Kubernetes. Solo cambian las variables de entorno |
| **Aiven y Render** | Gratis y sin tarjeta, que era una regla del proyecto |
| **GitHub Actions como reloj** | Render gratis no tiene tareas programadas. GitHub sí, gratis |
| **Contraseñas fuera del repositorio** | Todo lo que se sube a GitHub lo puede ver cualquiera, y queda para siempre en el historial |
| **Contenedor sin permisos de administrador** | Si alguien lograra entrar, no podría hacer casi nada |
| **Cinco herramientas de seguridad** | Cada una mira una cosa distinta: librerías, nuestro código, la imagen, la web publicada y contraseñas olvidadas |

---

## 5. Preguntas que les pueden hacer (con respuesta corta)

**¿Qué problema resuelve?**
En proyectos chicos, organizar (dividir, elegir a quién, revisar) cuesta más que hacer el
trabajo. VEKTORA hace esa organización sola.

**¿Qué pasa si la IA se equivoca?**
Para planificar, una validación revisa el plan y se lo devuelve a la IA para corregir. Para
juzgar, la IA solo responde preguntas chicas y hacen falta 2 intentos para rechazar.

**¿Qué pasa si se cae la IA?**
Pasa sola a la otra (Groq → Gemini). Si caen las dos, se reintenta en la siguiente vuelta del
reloj. Nunca cuenta como rechazo.

**¿Cómo guardan las contraseñas?**
Con BCrypt: se guarda una huella de la que no se puede volver atrás, y cada intento tarda un
cuarto de segundo para que probar contraseñas al azar sea inútil.

**¿Cómo evitan la inyección SQL?**
Todas las consultas van con los datos por separado (`$1, $2…`). Lo probamos: si alguien
escribe `'; drop table…` en el buscador, se busca como texto.

**¿Qué es una transacción y dónde la usan?**
Al entregar un trabajo se guardan cuatro cosas: se bloquea la tarea, se guarda el
entregable, se cambia el estado y se anota en la auditoría. O se hacen las cuatro o
ninguna.

**¿Quién puede ver qué?**
Lo decide el servidor según el rol, y además la base de datos tiene 47 reglas por fila (RLS).
Si alguien abre un proyecto privado ajeno, la página responde como si no existiera.

**¿Cuánto cuesta?**
Nada. Todo está en planes gratis sin tarjeta.

**¿Cómo saben que funciona?**
371 pruebas automáticas que GitHub corre solo en cada cambio, más 16 contra una base real.

**¿Por qué tres lugares de despliegue?**
Lo pedía el examen: en la PC con Docker, en la nube con Aiven y Render, y en Kubernetes con
minikube. Es la misma app en los tres.

**¿Qué no resuelve?**
Un rechazo automático no tiene apelación, un objetivo mal escrito da un plan pobre y no se
manejan pagos. Lo decimos nosotros antes de que lo pregunten.

**¿Usaron IA para programar?**
Sí, y está declarado en [`11-declaracion-de-uso-de-ia.md`](11-declaracion-de-uso-de-ia.md).
Las decisiones, la revisión y la verificación son nuestras.

Para preguntas sobre un archivo puntual («¿qué hace el Dockerfile?», «¿qué es un
ConfigMap?»), la sección 3 de [`defensa.md`](defensa.md) tiene respuestas cortas por archivo.

---

## 6. Lo que falta hacer

Ninguna de estas cosas es código; son pruebas y preparación.

- [ ] **Encender el reloj de los agentes.** En GitHub → *Actions* → *Agentes* se ve una sola
      corrida, hecha a mano. El horario automático no se activó. Ver
      [`defensa.md`](defensa.md), sección 5.
- [ ] **Capturas 1, 2 y 3** (Docker en una PC), **5** (Aiven) y **S1** (SonarLint). Qué
      mostrar en cada una está en la sección 5 de [`defensa.md`](defensa.md).
- [ ] **Que otro grupo siga** [`guia-despliegue.md`](guia-despliegue.md) y anotar dónde se
      trabó.
- [ ] **Repartirse los bloques** (sección 4 de [`defensa.md`](defensa.md)) y que cada uno
      ensaye el suyo.
- [ ] **Ensayar la demo** (sección 1 de [`defensa.md`](defensa.md)) con su plan B.

## 7. Dónde está cada cosa

| Si necesitás… | Mirá |
|---|---|
| Entender el producto en simple | [`10-guia-para-el-equipo.md`](10-guia-para-el-equipo.md) |
| Entender qué hicimos y por qué | Esta guía |
| La presentación y qué decir en cada diapositiva | [`presentacion/`](presentacion/) y su [guion](presentacion/guion.md) |
| El guion de la demo y las preguntas por archivo | [`defensa.md`](defensa.md) |
| Levantar todo paso a paso | [`guia-despliegue.md`](guia-despliegue.md) |
| Qué encontró cada herramienta de seguridad | [`informe-seguridad.md`](informe-seguridad.md) |
| Dibujos de la arquitectura y la base | [`diagramas/`](diagramas/) |
| Dónde está cada requisito R1–R12 en el código | [`../README.md`](../README.md) |

---

**Uso de IA y autoría.** Este documento se elaboró con asistencia de Claude (Anthropic). Las
decisiones de diseño, la revisión y la verificación son de los autores, que asumen la
responsabilidad sobre su contenido. Constancia formal en
[`11-declaracion-de-uso-de-ia.md`](11-declaracion-de-uso-de-ia.md).
