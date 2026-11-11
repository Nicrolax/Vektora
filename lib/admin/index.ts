/**
 * VEKTORA — Administración: cuentas y catálogo de skills (CRUD, requisito R2).
 *
 * Solo la cuenta con rol `admin` llega acá (`exigirPermiso('admin:…')` en la acción). Y aun
 * así, las escrituras sobre `public.users` y `public.skills` corren con `asUser(admin)`: las
 * políticas `users_update_self`, `users_delete_admin` y `skills_write_admin` vuelven a
 * comprobar `is_admin()` en la base. Si un día la aplicación dejara pasar a alguien que no
 * es admin, la base igual afectaría 0 filas.
 *
 * Reglas que protegen a la instalación de quedarse sin salida:
 *   · Nadie puede quitarse a sí mismo el rol de admin, suspenderse ni borrarse: si fuera el
 *     único admin, nadie podría volver a gestionar cuentas.
 *   · Borrar algo con historial de reputación falla por diseño (es append-only). Se explica
 *     qué hacer en su lugar: suspender la cuenta o desactivar la skill.
 */

import { getDb, type Db } from '@/lib/db';
import type { AccountStatus, UserRole } from '@/lib/db/types';
import { ConflictoError, DatabaseError, RecursoNoEncontradoError, ValidacionError } from '@/lib/errores';
import { esHistorialInmutable } from '@/lib/proyectos';

export const ESTADOS_CUENTA: readonly AccountStatus[] = ['active', 'suspended'];
export const ROLES_ASIGNABLES: readonly UserRole[] = ['client', 'provider', 'both', 'admin'];

export interface CuentaAdmin {
  id: string;
  email: string | null;
  nombre: string | null;
  role: UserRole;
  status: AccountStatus;
  proyectos: number;
  tareasAsignadas: number;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface SkillAdmin {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  isActive: boolean;
  proveedores: number;
  tareas: number;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validarSkill(entrada: { slug?: unknown; name: unknown; category: unknown }): {
  slug: string;
  name: string;
  category: string | null;
} {
  const slug = typeof entrada.slug === 'string' ? entrada.slug.trim().toLowerCase() : '';
  if (entrada.slug !== undefined && (!SLUG_RE.test(slug) || slug.length > 60)) {
    throw new ValidacionError(
      'El identificador va en minúsculas, con números y guiones (por ejemplo: diseno-ux), hasta 60 caracteres.',
      'slug',
    );
  }
  const name = typeof entrada.name === 'string' ? entrada.name.trim() : '';
  if (name.length < 2 || name.length > 80) {
    throw new ValidacionError('El nombre tiene que tener entre 2 y 80 caracteres.', 'name');
  }
  const categoria = typeof entrada.category === 'string' ? entrada.category.trim().toLowerCase() : '';
  if (categoria.length > 40) {
    throw new ValidacionError('La categoría puede tener como máximo 40 caracteres.', 'category');
  }
  return { slug, name, category: categoria === '' ? null : categoria };
}

export class AdminService {
  constructor(private readonly db: Db = getDb()) {}

  // --- Cuentas -------------------------------------------------------------------------

  async listarCuentas(adminId: string, texto: string | null): Promise<CuentaAdmin[]> {
    const filas = await this.db.asUser(adminId, (tx) =>
      tx.query<{
        id: string;
        email: string | null;
        nombre: string | null;
        role: UserRole;
        status: AccountStatus;
        proyectos: number;
        tareas_asignadas: number;
        last_seen_at: string | null;
        created_at: string;
      }>(
        `select u.id, u.email::text as email, coalesce(p.display_name, p.full_name) as nombre,
                u.role, u.status,
                (select count(*) from public.projects pr where pr.owner_id = u.id) as proyectos,
                (select count(*) from public.project_tasks t where t.assignee_id = u.id) as tareas_asignadas,
                u.last_seen_at, u.created_at
           from public.users u
           left join public.profiles p on p.user_id = u.id
          where $1::text is null
             or u.email ilike '%' || $1 || '%'
             or p.full_name ilike '%' || $1 || '%'
          order by u.role = 'admin' desc, u.created_at
          limit 200`,
        [texto],
      ),
    );
    return filas.map((f) => ({
      id: f.id,
      email: f.email,
      nombre: f.nombre,
      role: f.role,
      status: f.status,
      proyectos: f.proyectos,
      tareasAsignadas: f.tareas_asignadas,
      lastSeenAt: f.last_seen_at,
      createdAt: f.created_at,
    }));
  }

  async cambiarRol(adminId: string, cuentaId: string, role: UserRole): Promise<void> {
    if (!ROLES_ASIGNABLES.includes(role)) throw new ValidacionError('Elegí un rol de la lista.', 'role');
    if (cuentaId === adminId && role !== 'admin') {
      throw new ConflictoError('No podés quitarte a vos el rol de administración: pedíselo a otra cuenta admin.');
    }
    const afectadas = await this.db.asUser(adminId, (tx) =>
      tx.execute('update public.users set role = $2::public.user_role where id = $1', [cuentaId, role]),
    );
    if (afectadas === 0) throw new RecursoNoEncontradoError('La cuenta no existe.');
  }

  async cambiarEstado(adminId: string, cuentaId: string, status: AccountStatus): Promise<void> {
    if (!ESTADOS_CUENTA.includes(status)) throw new ValidacionError('Elegí activa o suspendida.', 'status');
    if (cuentaId === adminId && status !== 'active') {
      throw new ConflictoError('No podés suspender tu propia cuenta.');
    }
    const afectadas = await this.db.asUser(adminId, (tx) =>
      tx.execute('update public.users set status = $2::public.account_status where id = $1', [cuentaId, status]),
    );
    if (afectadas === 0) throw new RecursoNoEncontradoError('La cuenta no existe.');
  }

  /**
   * Borra la cuenta: `auth.users` y, en cascada, `public.users`, su perfil y sus proyectos.
   * `auth.users` no es accesible para `authenticated` (tiene los hashes), así que se verifica
   * primero como la persona admin que la cuenta existe y es visible, y se borra como sistema.
   */
  async eliminarCuenta(adminId: string, cuentaId: string): Promise<void> {
    if (cuentaId === adminId) throw new ConflictoError('No podés borrar tu propia cuenta.');
    const visible = await this.db.asUser(adminId, (tx) =>
      tx.one<{ es_admin: boolean }>(
        'select public.is_admin() as es_admin from public.users where id = $1',
        [cuentaId],
      ),
    );
    if (visible === null || !visible.es_admin) throw new RecursoNoEncontradoError('La cuenta no existe.');
    try {
      const afectadas = await this.db.execute('delete from auth.users where id = $1', [cuentaId]);
      if (afectadas === 0) throw new RecursoNoEncontradoError('La cuenta no existe.');
    } catch (error) {
      if (esHistorialInmutable(error)) {
        throw new ConflictoError(
          'La cuenta tiene historial de reputación o auditoría, que no se puede borrar. Suspendela en su lugar.',
        );
      }
      throw error;
    }
  }

  // --- Skills --------------------------------------------------------------------------

  async listarSkills(adminId: string): Promise<SkillAdmin[]> {
    const filas = await this.db.asUser(adminId, (tx) =>
      tx.query<{
        id: string;
        slug: string;
        name: string;
        category: string | null;
        is_active: boolean;
        proveedores: number;
        tareas: number;
      }>(
        `select s.id, s.slug::text as slug, s.name, s.category, s.is_active,
                count(distinct ps.provider_profile_id) as proveedores,
                (select count(*) from public.project_tasks t where s.slug::text = any(t.required_skills)) as tareas
           from public.skills s
           left join public.provider_skills ps on ps.skill_id = s.id
          group by s.id
          order by s.category nulls last, s.slug`,
      ),
    );
    return filas.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      category: f.category,
      isActive: f.is_active,
      proveedores: f.proveedores,
      tareas: f.tareas,
    }));
  }

  async crearSkill(adminId: string, datos: { slug: string; name: string; category: string | null }): Promise<string> {
    try {
      const fila = await this.db.asUser(adminId, (tx) =>
        tx.one<{ id: string }>(
          'insert into public.skills (slug, name, category) values ($1, $2, $3) returning id',
          [datos.slug, datos.name, datos.category],
        ),
      );
      if (fila === null) throw new RecursoNoEncontradoError('No se pudo crear la skill.');
      return fila.id;
    } catch (error) {
      if (error instanceof DatabaseError && error.sqlstate === '23505') {
        throw new ConflictoError(`Ya existe una skill con el identificador «${datos.slug}».`);
      }
      throw error;
    }
  }

  async actualizarSkill(
    adminId: string,
    skillId: string,
    datos: { name: string; category: string | null; isActive: boolean },
  ): Promise<void> {
    const afectadas = await this.db.asUser(adminId, (tx) =>
      tx.execute('update public.skills set name = $2, category = $3, is_active = $4 where id = $1', [
        skillId,
        datos.name,
        datos.category,
        datos.isActive,
      ]),
    );
    if (afectadas === 0) throw new RecursoNoEncontradoError('La skill no existe.');
  }

  async eliminarSkill(adminId: string, skillId: string): Promise<void> {
    const afectadas = await this.db.asUser(adminId, async (tx) => {
      const uso = await tx.one<{ tareas: number }>(
        `select count(*) as tareas from public.project_tasks t
          where (select slug::text from public.skills where id = $1) = any(t.required_skills)`,
        [skillId],
      );
      if ((uso?.tareas ?? 0) > 0) {
        throw new ConflictoError(
          `Hay ${uso?.tareas} tarea(s) que piden esta skill. Desactivala en lugar de borrarla: deja de ofrecerse sin romper esas tareas.`,
        );
      }
      return tx.execute('delete from public.skills where id = $1', [skillId]);
    });
    if (afectadas === 0) throw new RecursoNoEncontradoError('La skill no existe.');
  }
}
