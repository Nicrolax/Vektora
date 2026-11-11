/**
 * VEKTORA — Cookie de sesión (lógica pura, sin Next).
 *
 *   · `httpOnly`  — el JavaScript de la página no puede leerla: un XSS no roba la sesión.
 *   · `sameSite: 'lax'` — no viaja en peticiones POST iniciadas desde otro sitio (CSRF).
 *   · `secure`    — solo viaja por HTTPS. Se decide POR PETICIÓN según `x-forwarded-proto`:
 *       Render termina TLS y reenvía con `x-forwarded-proto: https`, así que en Render la
 *       cookie es `Secure`. En docker-compose y minikube se entra por `http://localhost`,
 *       y una cookie `Secure` el navegador la descartaría sin avisar: nadie podría entrar.
 *       `COOKIE_SECURE=true` la fuerza siempre; `COOKIE_SECURE=false` la apaga siempre.
 */

import { DURACION_SESION_SEGUNDOS } from './token';

export const NOMBRE_COOKIE = 'vektora_sesion';

export function debeSerSegura(
  protocoloReenviado: string | null,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const forzado = env['COOKIE_SECURE']?.trim().toLowerCase();
  if (forzado === 'true' || forzado === '1') return true;
  if (forzado === 'false' || forzado === '0') return false;
  // Puede venir como lista si hay varios proxies: "https, http". Manda el primero (el
  // que habló con el navegador).
  const primero = protocoloReenviado?.split(',')[0]?.trim().toLowerCase();
  return primero === 'https';
}

export interface OpcionesCookie {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

export function opcionesCookie(segura: boolean, maxAge: number = DURACION_SESION_SEGUNDOS): OpcionesCookie {
  return { httpOnly: true, sameSite: 'lax', secure: segura, path: '/', maxAge };
}
