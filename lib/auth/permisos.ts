/**
 * VEKTORA — Roles y permisos (requisito R3).
 *
 * Cuatro roles, los del ENUM `user_role` de la base:
 *
 *   · `client`    publica proyectos y sigue su avance.
 *   · `provider`  ofrece su trabajo, recibe tareas y entrega.
 *   · `both`      las dos cosas (el valor por defecto de una cuenta nueva).
 *   · `admin`     todo lo anterior, más gestionar cuentas y el catálogo de skills.
 *
 * Esta tabla es la ÚNICA fuente de verdad del lado de la aplicación: las páginas la
 * consultan con `requirePermiso()` y las acciones con `exigirPermiso()`. La base lo
 * refuerza por su cuenta con RLS (`is_admin()`, `owner_id = auth.uid()`…): si un día la
 * aplicación se equivocara, la base igual no dejaría leer datos ajenos.
 *
 * Es código PURO (sin base ni Next), así se prueba entero en `tests/permisos.test.ts`.
 */

import type { UserRole } from '@/lib/db/types';

export const ROLES: readonly UserRole[] = ['client', 'provider', 'both', 'admin'];

/** Roles que una persona puede elegir al registrarse. `admin` NUNCA se elige: se otorga. */
export const ROLES_REGISTRABLES: readonly UserRole[] = ['client', 'provider', 'both'];

export type Permiso =
  | 'proyectos:crear'
  | 'proyectos:gestionar'
  | 'proveedor:perfil'
  | 'trabajo:entregar'
  | 'tareas:buscar'
  | 'reportes:ver'
  | 'admin:cuentas'
  | 'admin:skills';

const CLIENTE: readonly Permiso[] = ['proyectos:crear', 'proyectos:gestionar'];
const PROVEEDOR: readonly Permiso[] = ['proveedor:perfil', 'trabajo:entregar'];
const COMUNES: readonly Permiso[] = ['tareas:buscar', 'reportes:ver'];

export const PERMISOS_POR_ROL: Readonly<Record<UserRole, ReadonlySet<Permiso>>> = {
  client: new Set([...CLIENTE, ...COMUNES]),
  provider: new Set([...PROVEEDOR, ...COMUNES]),
  both: new Set([...CLIENTE, ...PROVEEDOR, ...COMUNES]),
  admin: new Set([...CLIENTE, ...PROVEEDOR, ...COMUNES, 'admin:cuentas', 'admin:skills']),
};

export function tienePermiso(rol: UserRole, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol]?.has(permiso) ?? false;
}

export function esRol(valor: unknown): valor is UserRole {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor);
}

export const NOMBRE_ROL: Readonly<Record<UserRole, string>> = {
  client: 'Cliente',
  provider: 'Proveedor',
  both: 'Cliente y proveedor',
  admin: 'Administración',
};

/** Qué necesita alguien para hacer algo que su rol no permite: va en el mensaje de error. */
export const MOTIVO_PERMISO: Readonly<Record<Permiso, string>> = {
  'proyectos:crear': 'Para crear proyectos tu cuenta tiene que tener el rol de cliente.',
  'proyectos:gestionar': 'Para gestionar proyectos tu cuenta tiene que tener el rol de cliente.',
  'proveedor:perfil': 'Para ofrecer tu trabajo tu cuenta tiene que tener el rol de proveedor.',
  'trabajo:entregar': 'Para entregar trabajo tu cuenta tiene que tener el rol de proveedor.',
  'tareas:buscar': 'Tu cuenta no puede buscar tareas.',
  'reportes:ver': 'Tu cuenta no puede ver reportes.',
  'admin:cuentas': 'Solo la administración puede gestionar cuentas.',
  'admin:skills': 'Solo la administración puede gestionar el catálogo de skills.',
};
