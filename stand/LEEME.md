# Stand de URUCON Juniors — tablet

`tablet.html` es lo que corre en la tablet del stand (Samsung Galaxy Tab A8, en horizontal).
Es **un solo archivo y funciona sin internet**: no descarga nada, no guarda nada y no pide
ningún dato a quien juega.

- **Sin nadie tocándola:** una animación en bucle del ciclo de VEKTORA (planifica →
  adjudica → revisa → listo), con el botón «Tocá para jugar».
- **Al tocarla:** «Sé el juez». Tres entregas para evaluar criterio por criterio (cumple /
  no cumple / falta evidencia) y comparar con el juez de VEKTORA. Al final, el puntaje y un
  QR a la demo (`https://vektora.onrender.com`).
- **Vuelve sola al inicio** si nadie la toca: 45 s en la explicación, 75 s en un caso, 40 s
  en el resultado.

Los casos son de ejemplo, resueltos con las reglas reales del juez (`lib/qa/policy.ts`):
se aprueba solo si se cumplen todos los criterios, si falta evidencia se pide en vez de
castigar, y un primer intento nunca se rechaza. Se editan en el arreglo `CASOS`, al
principio del `<script>`.

## Ponerla en la tablet

1. **Pasar el archivo.** Con el cable USB, copiar `tablet.html` a la carpeta *Download*
   de la tablet. (También sirve mandárselo a uno mismo por Drive o por correo y
   descargarlo desde la tablet.)
2. **Abrirlo con Chrome.** App *Mis archivos* → *Descargas* → tocar `tablet.html` →
   *Abrir con Chrome*.
3. **Pantalla completa.** Se activa sola con el primer toque.
4. **Que nadie pueda salir.** *Ajustes* → *Seguridad y privacidad* → *Otros ajustes de
   seguridad* → activar **Fijar ventanas**. Después, con Chrome abierto: botón de
   *Recientes* → tocar el ícono de Chrome arriba → **Fijar esta app**. Para salir: mantener
   apretados *Atrás* y *Recientes* a la vez.
5. **Que la pantalla no se apague.** *Ajustes* → *Pantalla* → *Tiempo de espera de la
   pantalla* → el máximo. Mejor todavía, con la tablet enchufada: *Opciones de
   desarrollador* → **Pantalla activa**.
6. **Girar en horizontal** y bloquear la rotación desde el panel rápido.

## El día del evento

- **Enchufada** y con el **brillo alto**.
- La tablet no necesita internet, pero el QR lleva a la demo en Render, que en el plan
  gratis se duerme. **Abrí `vektora.onrender.com` desde un celular un rato antes** de que
  empiece la jornada, así no tarda en despertar cuando alguien escanee.
- Si algo se traba, recargar la página de Chrome vuelve todo al inicio.
