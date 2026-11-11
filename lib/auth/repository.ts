/**
 * VEKTORA — DAO de cuentas (capa de acceso a datos del login).
 *
 * La contraseña vive en `auth.users.password_hash` (esquema `auth`, creado por
 * `db/00_plataforma.sql`) y la identidad con su rol en `public.users`. Al insertar en
 * `auth.users`, el trigger `handle_new_auth_user` crea la fila de `public.users` y la de
 * `public.profiles`: la cuenta nunca queda a medias aunque el proceso se corte.
 *
 * Todas las consultas son parametrizadas (R9): el correo que escribe la persona viaja como
 * `$1`, nunca pegado al SQL.
 */

import type { Consultor } from '@/lib/db';
import type { AccountStatus, UserRole } from '@/lib/db/types';

export interface CuentaConHash {
  id: string;
  email: string;
  passwordHash: string | null;
  role: UserRole;
  status: AccountStatus;
}

export interface Cuenta {
  id: string;
  email: string | null;
  role: UserRole;
  status: AccountStatus;
  nombre: string | null;
}

export interface NuevaCuenta {
  email: string;
  passwordHash: string;
  role: UserRole;
  nombre: string | null;
}

export interface CuentasRepository {
  buscarConHashPorCorreo(email: string): Promise<CuentaConHash | null>;
  buscarPorId(id: string): Promise<Cuenta | null>;
  crear(cuenta: NuevaCuenta): Promise<string>;
  cambiarHash(id: string, passwordHash: string): Promise<void>;
  cambiarRol(id: string, role: UserRole): Promise<void>;
  registrarAcceso(id: string): Promise<void>;
}

export class PostgresCuentasRepository implements CuentasRepository {
  constructor(private readonly db: Consultor) {}

  async buscarConHashPorCorreo(email: string): Promise<CuentaConHash | null> {
    // `lower(...)` en los dos lados: `auth.users.email` es texto común y la persona puede
    // escribir el correo con mayúsculas.
    const fila = await this.db.one<{
      id: string;
      email: string;
      password_hash: string | null;
      role: UserRole;
      status: AccountStatus;
    }>(
      `select a.id, a.email, a.password_hash, u.role, u.status
         from auth.users a
         join public.users u on u.id = a.id
        where lower(a.email) = lower($1)
        limit 1`,
      [email],
    );
    if (fila === null) return null;
    return {
      id: fila.id,
      email: fila.email,
      passwordHash: fila.password_hash,
      role: fila.role,
      status: fila.status,
    };
  }

  async buscarPorId(id: string): Promise<Cuenta | null> {
    const fila = await this.db.one<{
      id: string;
      email: string | null;
      role: UserRole;
      status: AccountStatus;
      nombre: string | null;
    }>(
      `select u.id, u.email::text as email, u.role, u.status,
              coalesce(p.display_name, p.full_name) as nombre
         from public.users u
         left join public.profiles p on p.user_id = u.id
        where u.id = $1`,
      [id],
    );
    return fila;
  }

  async crear(cuenta: NuevaCuenta): Promise<string> {
    const fila = await this.db.one<{ id: string }>(
      `insert into auth.users (email, password_hash, raw_user_meta_data)
       values (lower($1), $2, jsonb_build_object('role', $3::text, 'full_name', $4::text))
       returning id`,
      [cuenta.email, cuenta.passwordHash, cuenta.role, cuenta.nombre],
    );
    if (fila === null) throw new Error('insert en auth.users no devolvió id');
    return fila.id;
  }

  async cambiarHash(id: string, passwordHash: string): Promise<void> {
    await this.db.execute('update auth.users set password_hash = $2 where id = $1', [
      id,
      passwordHash,
    ]);
  }

  async cambiarRol(id: string, role: UserRole): Promise<void> {
    await this.db.execute('update public.users set role = $2::public.user_role where id = $1', [
      id,
      role,
    ]);
  }

  async registrarAcceso(id: string): Promise<void> {
    await this.db.execute('update public.users set last_seen_at = now() where id = $1', [id]);
  }
}
