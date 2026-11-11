/**
 * VEKTORA — Guardián de sesión (capa de presentación ↔ servicio).
 *
 * Toda página protegida y toda acción de servidor pasa por aquí antes de operar. Las
 * acciones de servidor son puntos de entrada HTTP como cualquier otro: sin esta
 * comprobación, bastaría conocer su identificador para invocarlas.
 *
 * Cómo se resuelve «quién sos» en cada petición:
 *   1. Se lee la cookie `vektora_sesion` y se verifica la firma del token (HS256).
 *   2. Con el `sub` del token se lee la cuenta de la base: rol y estado ACTUALES. Si la
 *      cuenta se suspendió o cambió de rol, vale desde la próxima petición.
 *
 * La autorización FINA —qué proyecto puede ver cada uno— no vive acá sino en RLS: las
 * páginas leen con `getDb().asUser(id, …)`.
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { getDb } from '@/lib/db';
import type { AccountStatus, UserRole } from '@/lib/db/types';
import { AuthError, PermisoDenegadoError } from '@/lib/errores';
import { NOMBRE_COOKIE, debeSerSegura, opcionesCookie } from './cookie';
import { MOTIVO_PERMISO, tienePermiso, type Permiso } from './permisos';
import { PostgresCuentasRepository } from './repository';
import { emitirToken, secretoDeSesion, verificarToken } from './token';

export { AuthError };

export interface SessionUser {
  id: string;
  email: string | null;
  role: UserRole;
  status: AccountStatus;
  nombre: string | null;
}

/** Usuario de la sesión, o `null` si no hay ninguna válida. No redirige. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // `cookies()` PRIMERO: es lo que marca la página como dinámica. Al revés, Next intenta
  // prerenderizarla en el build, donde no hay entorno, y la compilación falla.
  const almacen = await cookies();
  const token = almacen.get(NOMBRE_COOKIE)?.value;
  if (token === undefined || token === '') return null;

  let secreto: string;
  try {
    secreto = secretoDeSesion();
  } catch {
    return null;
  }
  const contenido = verificarToken(token, secreto);
  if (contenido === null) return null;

  try {
    const cuenta = await new PostgresCuentasRepository(getDb()).buscarPorId(contenido.sub);
    if (cuenta === null || cuenta.status !== 'active') return null;
    return cuenta;
  } catch (error) {
    // Sin base no hay forma de confirmar la cuenta: se trata como «sin sesión» y la página
    // de acceso lo explica, en vez de mostrar un error interno.
    console.error('[vektora/auth] no se pudo leer la cuenta de la sesión', error);
    return null;
  }
}

/** Usuario de la sesión. Si no hay, lleva a la pantalla de acceso. Para páginas. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user === null) redirect('/entrar');
  return user;
}

/**
 * Usuario de la sesión con un permiso concreto. Sin sesión → `/entrar`; con sesión pero
 * sin el permiso → `/panel` con el motivo. Para páginas.
 */
export async function requirePermiso(permiso: Permiso): Promise<SessionUser> {
  const user = await requireUser();
  if (!tienePermiso(user.role, permiso)) {
    redirect(`/panel?aviso=${encodeURIComponent(MOTIVO_PERMISO[permiso])}` as Route);
  }
  return user;
}

/**
 * Usuario de la sesión. Si no hay, LANZA en vez de redirigir. Es la variante para acciones
 * de servidor: una redirección dentro de un `try` se trata como error y el formulario
 * parecería no hacer nada.
 */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user === null) throw new AuthError('Tu sesión venció. Volvé a entrar para continuar.');
  return user;
}

/** Como `requireUserOrThrow`, y además exige un permiso. Para acciones de servidor. */
export async function exigirPermiso(permiso: Permiso): Promise<SessionUser> {
  const user = await requireUserOrThrow();
  if (!tienePermiso(user.role, permiso)) throw new PermisoDenegadoError(MOTIVO_PERMISO[permiso]);
  return user;
}

/** Emite el token y escribe la cookie. Solo desde una acción de servidor o una ruta. */
export async function abrirSesion(userId: string): Promise<void> {
  const almacen = await cookies();
  const cabeceras = await headers();
  const segura = debeSerSegura(cabeceras.get('x-forwarded-proto'));
  almacen.set(NOMBRE_COOKIE, emitirToken(userId, secretoDeSesion()), opcionesCookie(segura));
}

export async function cerrarSesionActual(): Promise<void> {
  const almacen = await cookies();
  almacen.delete(NOMBRE_COOKIE);
}
