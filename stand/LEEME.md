# Stand de URUCON Juniors — tablet

`tablet.html` es lo que corre en la tablet del stand (Samsung Galaxy Tab A8, en horizontal).
Es **un solo archivo que funciona sin internet**: se abre desde la memoria de la tablet, no
descarga nada, no guarda nada y no pide ningún dato a quien juega. La tablet puede estar en
modo avión todo el evento.

- **Sin nadie tocándola:** una animación en bucle del ciclo de VEKTORA (planifica →
  adjudica → revisa → listo), con el botón «Tocá para jugar».
- **Al tocarla:** «Sé el juez». Tres entregas para evaluar criterio por criterio (cumple /
  no cumple / falta evidencia) y comparar con el juez de VEKTORA. Al final, el puntaje y un
  QR a la demo (`https://vektora.onrender.com`): ese lo abre cada visitante en su celular,
  con sus datos; la tablet no lo necesita.
- **Vuelve sola al inicio** si nadie la toca: 45 s en la explicación, 75 s en un caso, 40 s
  en el resultado.

Los casos son de ejemplo, resueltos con las reglas reales del juez (`lib/qa/policy.ts`):
se aprueba solo si se cumplen todos los criterios, si falta evidencia se pide en vez de
castigar, y un primer intento nunca se rechaza. Se editan en el arreglo `CASOS`, al
principio del `<script>`.

## 1. Pasar el archivo a la tablet (sin internet)

No hace falta descargarlo de ningún lado: se **copia** desde la PC. En la PC está en
`stand\tablet.html`, dentro de la carpeta del repositorio. Cualquiera de estas formas
funciona sin internet:

- **Cable USB (la más simple).** Conectar la tablet a la PC. En la tablet, en el aviso que
  aparece, elegir **Transferir archivos**. En la PC, abrir el Explorador → *Galaxy Tab A8* →
  almacenamiento interno → carpeta **Download**, y arrastrar `tablet.html` ahí.
- **Quick Share** (de Samsung): desde la PC o desde un celular Samsung, compartir el archivo
  con la tablet. Usa wifi directo y Bluetooth entre los equipos, no internet.
- **Bluetooth** desde la PC: clic derecho sobre el archivo → *Enviar a* → *Dispositivo
  Bluetooth*. En la tablet queda en *Download* (o en la carpeta *Bluetooth*).
- **Tarjeta microSD**: copiar el archivo a la tarjeta desde la PC y ponerla en la tablet.

## 2. Abrirlo

1. App **Mis archivos** → *Almacenamiento interno* → *Download* (o donde haya quedado).
2. Tocar `tablet.html` y, en *Abrir con*, elegir **Chrome** → *Siempre*.
   - **No** elegir «Visor HTML» u otro visor: no ejecuta el juego.
   - Escribir la ruta `file:///…` en la barra de Chrome suele dar «acceso denegado» en las
     versiones nuevas de Android: hay que abrirlo desde *Mis archivos*.
3. **Tocar la pantalla una vez**: pasa a pantalla completa.

## 3. Dejarla lista para el stand

- **Que nadie pueda salir: fijar la ventana.**
  1. *Ajustes* → *Pantalla* → *Barra de navegación* → elegir **Botones** (con gestos,
     soltar la fijación es más confuso).
  2. *Ajustes* → *Seguridad y privacidad* → *Otros ajustes de seguridad* → **Fijar
     ventanas** → activarlo. Adentro, activar también **Pedir PIN/patrón para desfijar**
     (si la tablet no tiene bloqueo de pantalla, primero hay que ponerle uno).
  3. Con la página abierta en Chrome y en pantalla completa, tocar el botón **Recientes**
     (las tres rayas verticales, abajo a la izquierda).
  4. En la tarjeta de Chrome, tocar el **ícono de Chrome** de arriba → **Fijar esta app**.
  5. Tocar la tarjeta para volver a la página.
  6. **Para soltarla** al final: mantener apretados **Atrás** y **Recientes** a la vez, y
     poner el PIN.

  La página ayuda: cualquier toque la vuelve a pantalla completa, y **Atrás no la cierra**
  (solo vuelve a la portada), así que nadie termina en otra pestaña de Chrome.
- **Que la pantalla no se apague.** *Ajustes* → *Pantalla* → *Tiempo de espera de la
  pantalla* → el máximo. Mejor todavía, con la tablet enchufada: *Opciones de
  desarrollador* → **Pantalla activa**.
- **Horizontal** con la rotación bloqueada, **enchufada** y con el **brillo alto**.
- Si algo se traba, recargar la página vuelve todo al inicio (sin internet también).
- Para que el QR funcione bien, **abrir `vektora.onrender.com` desde un celular un rato
  antes**: Render en el plan gratis se duerme y tarda en despertar.
