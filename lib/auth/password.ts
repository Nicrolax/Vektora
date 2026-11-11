/**
 * VEKTORA — Contraseñas con BCrypt (requisito R3).
 *
 * Se usa `bcryptjs`, la implementación en JavaScript puro de BCrypt: el mismo algoritmo y
 * el mismo formato de hash (`$2b$12$…`) que la librería nativa, pero sin compilar nada al
 * instalar. Eso importa en la imagen `node:22-alpine`, donde un módulo nativo obligaría a
 * meter compiladores en la etapa de build.
 *
 * Coste 12 = 2^12 rondas: ~250 ms por verificación. Suficientemente lento para que probar
 * contraseñas por fuerza bruta sea caro, suficientemente rápido para que nadie lo note al
 * entrar. BCrypt además mete una sal aleatoria en cada hash: la misma contraseña nunca da
 * dos veces el mismo resultado.
 */

import bcrypt from 'bcryptjs';
import { ValidacionError } from '@/lib/errores';

export const COSTE_BCRYPT = 12;
export const LARGO_MINIMO = 8;
/** BCrypt solo mira los primeros 72 bytes: más que eso daría una falsa sensación de seguridad. */
export const LARGO_MAXIMO = 72;

/**
 * Hash con el que se compara cuando el correo NO existe. Sin esto, «correo inexistente»
 * respondería en 1 ms y «contraseña incorrecta» en 250 ms, y midiendo el tiempo se podría
 * averiguar qué correos están registrados. Es el hash de un texto aleatorio que nadie conoce.
 */
const HASH_SENUELO = '$2b$12$hXQJtoJzv7c4Pd11IQBt7uWvaSfb0iGnglxXuGyoQzWpNqG1KbAxi';

export function validarContrasena(contrasena: string): void {
  if (contrasena.length < LARGO_MINIMO) {
    throw new ValidacionError(
      `La contraseña necesita al menos ${LARGO_MINIMO} caracteres.`,
      'password',
    );
  }
  if (Buffer.byteLength(contrasena, 'utf8') > LARGO_MAXIMO) {
    throw new ValidacionError(
      `La contraseña puede tener como máximo ${LARGO_MAXIMO} bytes. Usá una más corta.`,
      'password',
    );
  }
}

export async function hashearContrasena(
  contrasena: string,
  coste: number = COSTE_BCRYPT,
): Promise<string> {
  validarContrasena(contrasena);
  return bcrypt.hash(contrasena, coste);
}

/** Compara en tiempo constante. Con `hash === null` compara contra el señuelo y da `false`. */
export async function verificarContrasena(
  contrasena: string,
  hash: string | null,
): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(contrasena, HASH_SENUELO);
    return false;
  }
  try {
    return await bcrypt.compare(contrasena, hash);
  } catch {
    // Un hash corrupto en la base no puede abrir la puerta.
    return false;
  }
}

/** Coste con el que se generó un hash (para detectar hashes viejos y rehacerlos). */
export function costeDe(hash: string): number | null {
  try {
    return bcrypt.getRounds(hash);
  } catch {
    return null;
  }
}
