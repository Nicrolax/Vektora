/**
 * VEKTORA — Servicio de autenticación (capa de servicio).
 *
 * Reglas de negocio del acceso, sin saber nada de cookies ni de HTTP:
 *
 *   · El mensaje de «correo o contraseña incorrectos» es el MISMO en los dos casos:
 *     distinguirlos permitiría averiguar qué correos están registrados.
 *   · Una cuenta suspendida no entra, aunque la contraseña sea correcta.
 *   · Al registrarse se elige rol entre cliente, proveedor o ambos. `admin` nunca se
 *     elige: se otorga con `npm run cuenta:admin`.
 *   · Si un hash quedó con un coste menor al actual, se rehace al entrar (la persona no
 *     se entera y la base se actualiza sola).
 */

import { AuthError, ConflictoError, DatabaseError, ValidacionError } from '@/lib/errores';
import type { UserRole } from '@/lib/db/types';
import { COSTE_BCRYPT, costeDe, hashearContrasena, verificarContrasena } from './password';
import { ROLES_REGISTRABLES } from './permisos';
import type { CuentasRepository } from './repository';

export interface UsuarioAutenticado {
  id: string;
  email: string;
  role: UserRole;
}

export const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos.';

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarCorreo(email: string): string {
  const limpio = email.trim().toLowerCase();
  if (limpio === '' || limpio.length > 254 || !CORREO_RE.test(limpio)) {
    throw new ValidacionError('Escribí un correo válido, por ejemplo nombre@dominio.com.', 'email');
  }
  return limpio;
}

export class AuthService {
  constructor(
    private readonly cuentas: CuentasRepository,
    private readonly coste: number = COSTE_BCRYPT,
  ) {}

  async iniciarSesion(email: string, contrasena: string): Promise<UsuarioAutenticado> {
    let correo: string;
    try {
      correo = normalizarCorreo(email);
    } catch {
      throw new AuthError(MENSAJE_CREDENCIALES);
    }

    const cuenta = await this.cuentas.buscarConHashPorCorreo(correo);
    // Se compara SIEMPRE, exista o no la cuenta, para que el tiempo de respuesta no revele nada.
    const valida = await verificarContrasena(contrasena, cuenta?.passwordHash ?? null);
    if (cuenta === null || !valida) throw new AuthError(MENSAJE_CREDENCIALES);

    if (cuenta.status !== 'active') {
      throw new AuthError(
        'Tu cuenta está suspendida. Escribile a la administración para reactivarla.',
      );
    }

    const costeActual = cuenta.passwordHash === null ? null : costeDe(cuenta.passwordHash);
    if (costeActual !== null && costeActual < this.coste) {
      await this.cuentas.cambiarHash(cuenta.id, await hashearContrasena(contrasena, this.coste));
    }
    await this.cuentas.registrarAcceso(cuenta.id);

    return { id: cuenta.id, email: cuenta.email, role: cuenta.role };
  }

  async registrar(datos: {
    email: string;
    contrasena: string;
    role: UserRole;
    nombre?: string | null;
  }): Promise<UsuarioAutenticado> {
    const correo = normalizarCorreo(datos.email);
    if (!ROLES_REGISTRABLES.includes(datos.role)) {
      throw new ValidacionError('Elegí si querés publicar proyectos, ofrecer tu trabajo o ambas.', 'role');
    }
    const nombre = datos.nombre?.trim() || null;
    if (nombre !== null && nombre.length > 120) {
      throw new ValidacionError('El nombre puede tener como máximo 120 caracteres.', 'nombre');
    }

    const hash = await hashearContrasena(datos.contrasena, this.coste);
    try {
      const id = await this.cuentas.crear({ email: correo, passwordHash: hash, role: datos.role, nombre });
      return { id, email: correo, role: datos.role };
    } catch (error) {
      if (error instanceof DatabaseError && error.sqlstate === '23505') {
        throw new ConflictoError('Ya hay una cuenta con ese correo. Entrá con tu contraseña.');
      }
      throw error;
    }
  }

  /** Crea o asciende una cuenta de administración (lo usa `npm run cuenta:admin`). */
  async asegurarAdmin(email: string, contrasena: string): Promise<{ id: string; creada: boolean }> {
    const correo = normalizarCorreo(email);
    if (contrasena.length < 12) {
      throw new ValidacionError('La contraseña de administración necesita al menos 12 caracteres.');
    }
    const hash = await hashearContrasena(contrasena, this.coste);
    const existente = await this.cuentas.buscarConHashPorCorreo(correo);
    if (existente !== null) {
      await this.cuentas.cambiarHash(existente.id, hash);
      await this.cuentas.cambiarRol(existente.id, 'admin');
      return { id: existente.id, creada: false };
    }
    const id = await this.cuentas.crear({ email: correo, passwordHash: hash, role: 'admin', nombre: 'Administración' });
    return { id, creada: true };
  }
}
