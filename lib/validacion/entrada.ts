/**
 * VEKTORA · FASE 7 — Validación de entrada reforzada. Módulo PURO.
 *
 * Los esquemas de las fases anteriores comprueban tipos y longitudes. Esto comprueba lo que
 * pasa ese filtro teniendo forma válida: un objetivo de 60 caracteres que es la misma
 * palabra repetida, un correo de dominio desechable, un presupuesto de un céntimo.
 *
 * Importa porque cada proyecto creado cuesta una llamada a un modelo. Un objetivo sin
 * contenido no produce un plan malo: produce un plan inventado, porque el modelo rellena
 * el vacío, y eso se paga igual.
 *
 * Todo devuelve mensajes en segunda persona y explicando QUÉ hacer. Un «entrada inválida»
 * deja a la persona adivinando.
 */

/** Dominios de correo temporal más comunes. No es exhaustivo ni pretende serlo. */
const DOMINIOS_DESECHABLES = new Set([
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.info',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'sharklasers.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mintemail.com',
  'mohmal.com',
  'spamgourmet.com',
  'tempr.email',
  'emailondeck.com',
  'moakt.com',
]);

/** Dominios de ejemplo reservados por la norma: nunca reciben correo de verdad. */
const DOMINIOS_RESERVADOS = new Set(['example.com', 'example.org', 'example.net', 'test.com']);

export interface Veredicto {
  valido: boolean;
  motivo: string | null;
}

const BIEN: Veredicto = { valido: true, motivo: null };

const mal = (motivo: string): Veredicto => ({ valido: false, motivo });

// -----------------------------------------------------------------------------------------
// Correo
// -----------------------------------------------------------------------------------------

export interface OpcionesCorreo {
  /** Rechaza dominios de correo temporal. */
  bloquearDesechables?: boolean;
  /** Rechaza los dominios reservados para documentación (example.com y compañía). */
  bloquearReservados?: boolean;
}

export function validarCorreo(correo: string, opciones: OpcionesCorreo = {}): Veredicto {
  const limpio = correo.trim().toLowerCase();

  // Comprobación estructural propia y no una expresión regular monstruosa: las que
  // pretenden implementar el RFC entero son ilegibles y fallan igual en los casos raros.
  const partes = limpio.split('@');
  if (partes.length !== 2) return mal('El correo tiene que llevar una sola arroba.');

  const [usuario, dominio] = partes as [string, string];
  if (usuario.length === 0) return mal('Falta la parte del correo anterior a la arroba.');
  if (usuario.length > 64) return mal('La parte anterior a la arroba es demasiado larga.');
  if (dominio.length === 0) return mal('Falta el dominio después de la arroba.');
  if (!dominio.includes('.')) return mal('El dominio del correo parece incompleto.');
  if (dominio.startsWith('.') || dominio.endsWith('.')) return mal('El dominio no es válido.');
  if (dominio.includes('..')) return mal('El dominio no es válido.');
  if (/\s/.test(limpio)) return mal('El correo no puede llevar espacios.');

  const extension = dominio.slice(dominio.lastIndexOf('.') + 1);
  if (extension.length < 2 || !/^[a-z]+$/.test(extension)) {
    return mal('La terminación del dominio no es válida.');
  }

  if (opciones.bloquearReservados === true && DOMINIOS_RESERVADOS.has(dominio)) {
    return mal(
      'Ese dominio está reservado para ejemplos y no recibe correo. Usá una dirección real.',
    );
  }

  if (opciones.bloquearDesechables === true && DOMINIOS_DESECHABLES.has(dominio)) {
    return mal(
      'No aceptamos correos temporales. Necesitamos poder avisarte del veredicto de tus ' +
        'entregas y de las tareas que se te adjudiquen.',
    );
  }

  return BIEN;
}

// -----------------------------------------------------------------------------------------
// Texto con contenido real
// -----------------------------------------------------------------------------------------

/** Proporción de caracteres distintos sobre el total. Texto real ronda 0.25 o más. */
export function diversidadLexica(texto: string): number {
  const limpio = texto.toLowerCase().replace(/\s+/g, '');
  if (limpio.length === 0) return 0;
  return new Set(limpio).size / limpio.length;
}

/** Palabras distintas sobre palabras totales. «hola hola hola» da 0.33. */
export function diversidadDePalabras(texto: string): number {
  const palabras = texto.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (palabras.length === 0) return 0;
  return new Set(palabras).size / palabras.length;
}

export interface OpcionesTexto {
  minPalabras?: number;
  minPalabrasDistintas?: number;
}

/**
 * ¿Este texto dice algo?
 *
 * Los tres filtros atrapan cosas distintas: el teclado aporreado («asdfasdf») falla por
 * diversidad de caracteres; la palabra repetida («proyecto proyecto proyecto») falla por
 * diversidad de palabras; y «necesito ayuda» falla por número de palabras. Un objetivo
 * real pasa los tres sin enterarse.
 */
export function validarTextoSustantivo(texto: string, opciones: OpcionesTexto = {}): Veredicto {
  const limpio = texto.trim();
  const minPalabras = opciones.minPalabras ?? 6;
  const minDistintas = opciones.minPalabrasDistintas ?? 5;

  const palabras = limpio.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (palabras.length < minPalabras) {
    return mal(
      `Contá un poco más: hacen falta al menos ${minPalabras} palabras para que el ` +
        'planificador entienda qué querés conseguir.',
    );
  }

  const distintas = new Set(palabras.map((palabra) => palabra.toLowerCase())).size;
  if (distintas < minDistintas) {
    return mal('El texto repite siempre lo mismo. Describí el resultado que buscás.');
  }

  if (diversidadLexica(limpio) < 0.12) {
    return mal('Eso no parece texto. Escribí con tus palabras qué necesitás.');
  }

  if (diversidadDePalabras(limpio) < 0.3) {
    return mal('El texto repite demasiado las mismas palabras. Contalo con más detalle.');
  }

  // Un solo carácter repetido muchas veces seguidas: «holaaaaaaaaaaa».
  if (/(.)\1{7,}/u.test(limpio)) {
    return mal('Hay un carácter repetido muchas veces. Revisá lo que escribiste.');
  }

  return BIEN;
}

// -----------------------------------------------------------------------------------------
// Presupuesto
// -----------------------------------------------------------------------------------------

export interface OpcionesPresupuesto {
  minimo?: number;
  maximo?: number;
}

/**
 * El mínimo no es arbitrario: el plan se reparte entre 2 y 24 tareas, así que con un
 * presupuesto ínfimo hay tareas de céntimos, y ningún proveedor con un mínimo por tarea
 * razonable pasaría el filtro. El proyecto nacería imposible de adjudicar.
 */
export function validarPresupuesto(valor: unknown, opciones: OpcionesPresupuesto = {}): Veredicto {
  const minimo = opciones.minimo ?? 50;
  const maximo = opciones.maximo ?? 1_000_000;

  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    return mal('El presupuesto tiene que ser un número.');
  }
  if (valor <= 0) return mal('El presupuesto tiene que ser mayor que cero.');
  if (valor < minimo) {
    return mal(
      `El presupuesto mínimo es ${minimo} USD. Por debajo de eso, el reparto entre tareas ` +
        'deja importes que ningún proveedor va a aceptar y el proyecto nace sin salida.',
    );
  }
  if (valor > maximo) {
    return mal(`El presupuesto máximo admitido es ${maximo.toLocaleString('es-UY')} USD.`);
  }
  // Más de dos decimales en dinero suele ser un error de tecleo, no una intención.
  if (Math.round(valor * 100) !== Number((valor * 100).toFixed(4))) {
    return mal('El presupuesto no puede tener más de dos decimales.');
  }

  return BIEN;
}

// --- Contraseñas ---------------------------------------------------------------------------

/** Las que primero se prueban en un ataque de diccionario. No es exhaustivo ni pretende serlo. */
const CONTRASENAS_COMUNES = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'contraseña',
  'contrasena',
  'qwertyui',
  'qwerty123',
  'iloveyou',
  'abc12345',
  '11111111',
  '00000000',
  'asdfghjk',
  'vektora1',
  'vektora123',
]);

export const NIVELES_CONTRASENA = ['Muy débil', 'Débil', 'Aceptable', 'Buena', 'Fuerte'] as const;

/** Nivel mínimo para crear una cuenta (índice en `NIVELES_CONTRASENA`). */
export const NIVEL_MINIMO_CONTRASENA = 2;

export interface FuerzaContrasena {
  /** 0 a 4, índice en `NIVELES_CONTRASENA`. */
  nivel: number;
  etiqueta: (typeof NIVELES_CONTRASENA)[number];
  /** Qué hacer para subir de nivel, o `null` si ya es fuerte. */
  consejo: string | null;
}

/**
 * Fuerza de una contraseña. La usan el medidor del formulario (mientras se escribe) y el
 * servicio de alta (que rechaza por debajo de `NIVEL_MINIMO_CONTRASENA`): la misma regla en
 * los dos lados, así lo que el medidor aprueba el servidor no lo rechaza.
 *
 * ponytail: heurística de largo + variedad + lista corta de comunes. Si hiciera falta medir
 * entropía real, zxcvbn; pesa ~400 kB y para este umbral no cambia el resultado.
 */
export function evaluarContrasena(contrasena: string, correo = ''): FuerzaContrasena {
  const largo = [...contrasena].length;
  const clases = [/[a-zñ]/, /[A-ZÑ]/, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(contrasena)).length;
  const usuario = correo.split('@')[0]?.toLowerCase() ?? '';

  const trivial =
    CONTRASENAS_COMUNES.has(contrasena.toLowerCase()) ||
    /^(.)\1*$/.test(contrasena) ||
    (usuario.length >= 4 && contrasena.toLowerCase().includes(usuario));

  let nivel = 0;
  if (!trivial) {
    if (largo >= 8) nivel += 1;
    if (largo >= 12) nivel += 1;
    if (clases >= 3) nivel += 1;
    if (largo >= 16 || (largo >= 10 && clases === 4)) nivel += 1;
  }
  nivel = Math.min(nivel, 4);

  let consejo: string | null = null;
  if (trivial) consejo = 'Es demasiado fácil de adivinar: no uses tu correo, secuencias ni palabras comunes.';
  else if (largo < 8) consejo = 'Usá al menos 8 caracteres.';
  else if (largo < 12) consejo = 'Alargala a 12 caracteres o más.';
  else if (clases < 3) consejo = 'Mezclá mayúsculas, números o símbolos.';
  else if (nivel < 4) consejo = 'Una frase de varias palabras la vuelve todavía más fuerte.';

  return { nivel, etiqueta: NIVELES_CONTRASENA[nivel] ?? 'Muy débil', consejo };
}
