/**
 * VEKTORA — Token de sesión: JWT firmado con HMAC-SHA256 (HS256).
 *
 * Implementado con `node:crypto` y sin dependencias, porque son 60 líneas y así cada
 * integrante del equipo puede explicarlas en la defensa:
 *
 *   token = base64url(cabecera) . base64url(contenido) . base64url(HMAC(secreto, a.b))
 *
 * El contenido NO está cifrado (cualquiera puede leerlo), está FIRMADO: si alguien cambia
 * el `sub` para hacerse pasar por otra cuenta, la firma deja de coincidir y el token se
 * rechaza. Por eso el secreto (`AUTH_SECRET`) nunca sale del servidor.
 *
 * El rol NO viaja en el token: se lee de la base en cada petición. Así, suspender una
 * cuenta o quitarle el rol de admin tiene efecto inmediato, sin esperar a que caduque.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { ConfiguracionError } from '@/lib/errores';

export const DURACION_SESION_SEGUNDOS = 60 * 60 * 12;
export const LARGO_MINIMO_SECRETO = 32;

export interface ContenidoToken {
  /** id de la cuenta (uuid). */
  sub: string;
  /** Emitido, en segundos desde 1970. */
  iat: number;
  /** Vence, en segundos desde 1970. */
  exp: number;
}

function base64url(datos: Buffer | string): string {
  return Buffer.from(datos).toString('base64url');
}

function firmar(datos: string, secreto: string): string {
  return createHmac('sha256', secreto).update(datos).digest('base64url');
}

/** Lee `AUTH_SECRET` y exige un mínimo de 32 caracteres. */
export function secretoDeSesion(env: Record<string, string | undefined> = process.env): string {
  const secreto = env['AUTH_SECRET']?.trim() ?? '';
  if (secreto.length < LARGO_MINIMO_SECRETO) {
    throw new ConfiguracionError(
      `AUTH_SECRET falta o tiene menos de ${LARGO_MINIMO_SECRETO} caracteres. ` +
        'Generalo con: openssl rand -hex 32',
    );
  }
  return secreto;
}

const CABECERA = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export function emitirToken(
  userId: string,
  secreto: string,
  ahora: number = Math.floor(Date.now() / 1000),
  duracion: number = DURACION_SESION_SEGUNDOS,
): string {
  const contenido: ContenidoToken = { sub: userId, iat: ahora, exp: ahora + duracion };
  const cuerpo = `${CABECERA}.${base64url(JSON.stringify(contenido))}`;
  return `${cuerpo}.${firmar(cuerpo, secreto)}`;
}

/** Devuelve el contenido si la firma es válida y no venció; si no, `null`. Nunca lanza. */
export function verificarToken(
  token: string,
  secreto: string,
  ahora: number = Math.floor(Date.now() / 1000),
): ContenidoToken | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabecera, contenido, firma] = partes as [string, string, string];

  // Solo se acepta EXACTAMENTE la cabecera que emitimos. Esto cierra el ataque clásico de
  // `alg: none`, en el que el atacante declara que el token no necesita firma.
  if (cabecera !== CABECERA) return null;

  const esperada = Buffer.from(firmar(`${cabecera}.${contenido}`, secreto));
  const recibida = Buffer.from(firma);
  // Comparación en tiempo constante: `===` cortaría en el primer carácter distinto, y
  // midiendo el tiempo se podría reconstruir la firma byte a byte.
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;

  let datos: unknown;
  try {
    datos = JSON.parse(Buffer.from(contenido, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof datos !== 'object' || datos === null) return null;
  const { sub, iat, exp } = datos as Record<string, unknown>;
  if (typeof sub !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') return null;
  if (exp <= ahora) return null;
  return { sub, iat, exp };
}
