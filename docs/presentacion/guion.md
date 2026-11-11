# Guion de la presentación — VEKTORA

Qué decir en cada diapositiva, con palabras simples. Acompaña a
[`presentacion-vektora.pdf`](presentacion-vektora.pdf) (18 diapositivas), que recorre la
propuesta del examen punto por punto: los seis criterios de evaluación, R1 a R12, los tres
niveles de despliegue, la seguridad, los entregables y la lista de control.

## 1. VEKTORA

Presentarse. Somos el grupo 1. Nuestro proyecto del año es VEKTORA. El examen pedía desplegarlo usando solo servicios gratuitos, en tres niveles, y revisar su seguridad. En esta presentación vamos punto por punto de la propuesta y mostramos cómo cumplimos cada uno y dónde está la prueba.

## 2. Ninguna persona decide nada en el ciclo.

Esta es la decisión que define el proyecto. Las plataformas actuales usan la IA para sugerir, pero una persona confirma todo. Nosotros fuimos más allá: el sistema decide solo. ¿Por qué? Porque si dejás la salida «que decida una persona», todos los casos difíciles terminan ahí y el sistema nunca aprende a resolverlos. A cambio, todo queda explicado en la base de datos: por qué se eligió a alguien, por qué se aprobó algo.

## 3. Seis pasos, una sola persona al principio

Este es el recorrido completo. La persona solo interviene en el paso 1. Desde ahí, una IA divide el objetivo en tareas, el sistema dibuja el orden, el matching elige quién hace cada tarea, el proveedor entrega, y otra IA revisa requisito por requisito. Si aprueba, las tareas que esperaban se desbloquean solas y el ciclo sigue. Lo que empuja el ciclo es un reloj: GitHub Actions llama a la app cada 10 y 15 minutos.

## 4. Los seis criterios, uno por uno

Esta es la tabla de evaluación de la propuesta, de 100 puntos. Todo está hecho y funcionando. Lo único pendiente son algunas capturas de pantalla de la guía de despliegue que se sacan en una PC con Docker y en la consola de Aiven. Las vamos a ver al final, en la lista de control.

## 5. La misma que pedía la propuesta

Este es el diagrama de la propuesta con nuestro proyecto. El usuario entra por HTTPS a la app, que corre en un contenedor Docker en Render. La app habla con la base en Aiven por una conexión cifrada SSL. El código está en GitHub: Render despliega desde ahí, y GitHub Actions publica la imagen en ghcr.io. Esa misma imagen es la que usa minikube en el nivel 3, y la que levanta docker compose en una PC en el nivel 1. GitHub Actions además corre las pruebas y los análisis en cada cambio. Los diagramas detallados están en docs/diagramas.

## 6. Datos, CRUD, usuarios y capas

R1: la base tiene 14 tablas con claves primarias y foráneas. Un proyecto tiene muchas tareas, eso es 1 a N. Un proveedor tiene muchas habilidades y una habilidad la tienen muchos proveedores, eso es N a M con una tabla intermedia. R2: proyectos, cuentas y habilidades tienen alta, baja, modificación y consulta. R3: las contraseñas se guardan con BCrypt y hay cuatro roles con permisos distintos. R4: la presentación llama a servicios, los servicios a un DAO definido por una interfaz, y la implementación de PostgreSQL es la que toca la base. Los números de línea exactos están en docs/defensa.md, sección 2.

## 7. Objetos, consultas y errores

R5: tenemos una clase abstracta VektoraError de la que heredan los errores de validación y de base de datos. Y una interfaz LlmProvider con dos implementaciones, Groq y Gemini: si una falla, se usa la otra. R6: la página Buscar filtra por texto, estado, habilidad y presupuesto, con JOIN a proyectos; la página Reportes usa COUNT, SUM, AVG y GROUP BY. R7: al entregar un trabajo se bloquea la tarea, se guarda el entregable, se cambia el estado y se anota en auditoría: si algo falla, rollback y no queda nada a medias. Hay una prueba que lo demuestra. R8: todas las entradas se validan con Zod, hay excepciones propias, y la persona nunca ve un error interno.

## 8. Seguridad, configuración y estado

R9: ninguna consulta se arma pegando texto. Siempre se usan marcadores $1, $2 y los datos viajan aparte, que es lo mismo que PreparedStatement en Java. Hay una prueba que intenta una inyección SQL y falla. R10: los datos de conexión se leen de variables de entorno; por eso la misma imagen funciona en compose, en Render y en Kubernetes. R11: los dos scripts de la carpeta sql crean las tablas y cargan más de 20 registros; se pueden correr dos veces sin romper nada. R12: la ruta /health responde 200 si la app y la base andan; la usan Docker, Render y Kubernetes.

## 9. Todo en contenedores Docker

El nivel 1 es obligatorio. El Dockerfile tiene tres etapas: instala, compila y arma una imagen final chica, sin el código fuente, que corre con un usuario sin permisos de administrador. El docker-compose levanta la base y la app; la base se carga sola con los scripts de la carpeta sql, y la app espera a que la base esté sana. Las contraseñas van en .env, que está en .gitignore, y en el repositorio solo está .env.example con los nombres. La imagen está publicada en ghcr.io, y el workflow Imagen la prueba con compose y la escanea con Trivy antes de publicarla.

## 10. Base en Aiven, app en Render

En el nivel 2 la base está en Aiven, que es PostgreSQL en la nube gratis. Los mismos scripts de la carpeta sql se ejecutaron contra Aiven. La app se conecta con variables de entorno y por SSL: además de cifrar, verifica con el certificado de Aiven que el servidor sea el verdadero. La app está en Render, que la construye desde nuestro Dockerfile; las contraseñas se cargan en el panel de Render, nunca en el repositorio. La prueba en vivo es crear una cuenta en la app y verla con un SELECT en la consola de Aiven.

## 11. App y base orquestadas en minikube

En el nivel 3 corremos todo en Kubernetes con minikube. Hay un Deployment para la app y otro para la base, cada uno con su imagen, variables y límites de CPU y memoria. Los Services les dan una dirección: la base solo se ve desde adentro del clúster, y la app se abre en el puerto 30080. Las contraseñas están en un Secret, que se genera con npm run k8s:secreto y no se sube; el resto de la configuración está en un ConfigMap. La readiness probe no le manda tráfico a la app hasta que /health responde; la liveness probe la reinicia si deja de responder. Además la base tiene un volumen para no perder los datos.

## 12. Pedían 3 análisis: hicimos los 4, y uno más

La propuesta pedía al menos tres de los cuatro análisis. Hicimos los cuatro y además buscamos contraseñas olvidadas en el historial. SCA revisa las librerías: había 6 problemas, uno crítico, y quedaron en 0. SAST revisa nuestro código: CodeQL marcó 3 problemas altos y los corregimos. SonarLint también se corre en VS Code; falta agregar su captura al informe. Trivy revisa la imagen de Docker: de 31 a 0. ZAP prueba la web publicada, y solo contra nuestra propia URL como pide la propuesta: quedan 3 avisos medios que están justificados en el informe. gitleaks marcó 3 cosas que eran ejemplos, no contraseñas reales. Los hallazgos no restan puntos: lo que importa es explicarlos, y eso está en el informe.

## 13. Los cuatro puntos, cumplidos

La propuesta pedía un hardening mínimo de cuatro puntos y están los cuatro. Primero, ninguna contraseña en el código, el Dockerfile ni el historial de Git, y gitleaks lo comprueba en cada cambio. Segundo, el contenedor no corre como administrador sino como un usuario común, vektora, número 1001. Tercero, la conexión a Aiven es solo por SSL y además se verifica el certificado. Cuarto, las contraseñas con BCrypt y las consultas preparadas. Además, a partir de lo que encontró ZAP agregamos cabeceras de seguridad como CSP y HSTS, en next.config.ts.

## 14. El repositorio, como lo pedía la propuesta

La propuesta pedía una estructura mínima del repositorio y la tenemos completa. La única diferencia es src: Next.js obliga a usar carpetas con nombre fijo, así que el código está en app, lib y components, y eso está explicado en el README. La carpeta k8s tiene los manifiestos de la app y de la base, el ejemplo del Secret y el ConfigMap. En docs están la guía de despliegue paso a paso, el informe de seguridad y los diagramas, y además la guía para la defensa y una guía en palabras simples. El README tiene la tabla de R1 a R12 con dónde está cada uno.

## 15. Dónde estamos, punto por punto

Esta es la lista de control del anexo de la propuesta. Diez de los doce puntos están hechos. Los dos que faltan no son de código: que otro grupo pruebe nuestra guía de despliegue, y que todos ensayemos para poder explicar cualquier archivo. También faltan algunas capturas de pantalla en la guía, que se sacan con Docker Desktop en una PC y en la consola de Aiven.

## 16. Lo que vamos a mostrar

Esto sigue el orden de la defensa oral que pide la propuesta. Antes de empezar, 15 minutos antes: abrir vektora.onrender.com/health, porque Render gratis se duerme y tarda un minuto en despertar, y comprobar en la consola de Aiven que la base esté encendida. Cuenta de prueba: cliente@vektora.test con la contraseña Demo-Vektora-2026. La consulta para Aiven es la «consulta A» de docs/defensa.md. Si algo falla en vivo, plan B: la app local con docker compose up.

## 17. Sus límites, y cómo los manejamos

La propuesta avisaba de los límites de los planes gratis. Render se apaga a los 15 minutos sin uso, así que abrimos /health antes de la defensa. Render gratis no tiene tareas programadas, entonces usamos GitHub Actions como reloj para que los agentes trabajen solos. Aiven apaga la base si no se usa: se enciende desde la consola. Kubernetes en la nube cuesta, así que usamos minikube en la PC, y GitHub lo prueba en un clúster kind. Y como la IA gratis tiene cortes, usamos dos proveedores. Todo costó cero.

## 18. ¿Preguntas?

Cerrar agradeciendo. Si preguntan algo que no sabemos, se puede decir «eso está en la documentación, en la carpeta docs», y buscarlo. La guía docs/12-que-hicimos-y-por-que.md tiene respuestas cortas a las preguntas más probables.

---

**Uso de IA y autoría.** Este documento y la presentación se elaboraron con asistencia de
Claude (Anthropic). Las decisiones de diseño, la revisión y la verificación son de los
autores, que asumen la responsabilidad sobre su contenido. Constancia formal en
[`../11-declaracion-de-uso-de-ia.md`](../11-declaracion-de-uso-de-ia.md).
