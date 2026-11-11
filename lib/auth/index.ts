/**
 * VEKTORA — API pública de autenticación y autorización.
 *
 * Las funciones de sesión (`requireUser`, `exigirPermiso`…) dependen de Next y se importan
 * desde `@/lib/auth/session`. Este índice expone lo que no depende de Next, así los
 * scripts (`npm run cuenta:admin`) y las pruebas lo usan sin arrastrar `next/headers`.
 */

import { getDb } from '@/lib/db';
import { PostgresCuentasRepository } from './repository';
import { AuthService } from './servicio';

export { COSTE_BCRYPT, costeDe, hashearContrasena, validarContrasena, verificarContrasena } from './password';
export { emitirToken, secretoDeSesion, verificarToken, DURACION_SESION_SEGUNDOS } from './token';
export type { ContenidoToken } from './token';
export { NOMBRE_COOKIE, debeSerSegura, opcionesCookie } from './cookie';
export {
  MOTIVO_PERMISO,
  NOMBRE_ROL,
  PERMISOS_POR_ROL,
  ROLES,
  ROLES_REGISTRABLES,
  esRol,
  tienePermiso,
} from './permisos';
export type { Permiso } from './permisos';
export { PostgresCuentasRepository } from './repository';
export type { Cuenta, CuentaConHash, CuentasRepository, NuevaCuenta } from './repository';
export { AuthService, MENSAJE_CREDENCIALES, normalizarCorreo } from './servicio';
export type { UsuarioAutenticado } from './servicio';

export function crearAuthService(): AuthService {
  return new AuthService(new PostgresCuentasRepository(getDb()));
}
