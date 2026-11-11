/**
 * VEKTORA — Gestión de proyectos (CRUD, requisito R2; capas DAO/servicio, R4).
 *
 *   Crear      → lo hace el ProjectPlanner (`lib/planner`): el objetivo se convierte en un
 *                grafo de tareas con IA. Este servicio no lo duplica.
 *   Leer       → `lib/consultas` (siempre como la persona, con RLS).
 *   Actualizar → título, descripción y visibilidad; pausar, reanudar o cancelar.
 *   Eliminar   → borra el proyecto y, en cascada, sus tareas.
 *
 * Actualizar y eliminar corren con `asUser`: la política RLS `projects_update_own` /
 * `projects_delete_own` (dueño o admin) es la que decide. Si la persona no es la dueña, la
 * base afecta 0 filas y el servicio responde «no encontrado», sin revelar si existe.
 *
 * Borrar puede fallar por diseño: `reputation_events` y `audit_logs` son append-only, y si
 * alguna tarea ya movió reputación, la cascada intentaría modificarlos. En vez del error
 * crudo de la base, se explica qué hacer: cancelar el proyecto, que conserva el historial.
 */

import { getDb, type Consultor, type Db } from '@/lib/db';
import type { ProjectStatus, ProjectVisibility } from '@/lib/db/types';
import { ConflictoError, DatabaseError, RecursoNoEncontradoError, ValidacionError } from '@/lib/errores';

export interface CambiosProyecto {
  title: string;
  description: string | null;
  visibility: ProjectVisibility;
}

/** Transiciones que la persona puede pedir. El resto las decide el sistema. */
export const TRANSICIONES: Readonly<Record<'pausar' | 'reanudar' | 'cancelar', { desde: ProjectStatus[]; hacia: ProjectStatus }>> = {
  pausar: { desde: ['planned', 'active'], hacia: 'paused' },
  reanudar: { desde: ['paused'], hacia: 'active' },
  cancelar: { desde: ['draft', 'planning', 'planned', 'active', 'paused', 'failed'], hacia: 'cancelled' },
};

export type AccionEstado = keyof typeof TRANSICIONES;

export interface ProyectosDao {
  actualizar(tx: Consultor, id: string, cambios: CambiosProyecto): Promise<number>;
  cambiarEstado(tx: Consultor, id: string, desde: readonly ProjectStatus[], hacia: ProjectStatus): Promise<number>;
  existe(tx: Consultor, id: string): Promise<boolean>;
  eliminar(tx: Consultor, id: string): Promise<number>;
}

export class PostgresProyectosDao implements ProyectosDao {
  async actualizar(tx: Consultor, id: string, cambios: CambiosProyecto): Promise<number> {
    return tx.execute(
      `update public.projects
          set title = $2, description = $3, visibility = $4::public.project_visibility
        where id = $1`,
      [id, cambios.title, cambios.description, cambios.visibility],
    );
  }

  async cambiarEstado(
    tx: Consultor,
    id: string,
    desde: readonly ProjectStatus[],
    hacia: ProjectStatus,
  ): Promise<number> {
    return tx.execute(
      `update public.projects
          set status = $3::public.project_status,
              completed_at = case when $3::public.project_status = 'cancelled' then now() else completed_at end
        where id = $1 and status = any($2::public.project_status[])`,
      [id, desde, hacia],
    );
  }

  async existe(tx: Consultor, id: string): Promise<boolean> {
    return (await tx.one('select 1 from public.projects where id = $1', [id])) !== null;
  }

  async eliminar(tx: Consultor, id: string): Promise<number> {
    return tx.execute('delete from public.projects where id = $1', [id]);
  }
}

/**
 * `true` si el error es el trigger `forbid_mutation` (SQLSTATE 42501, «append-only»): una
 * cascada intentó tocar `reputation_events` o `audit_logs`.
 */
export function esHistorialInmutable(error: unknown): boolean {
  return error instanceof DatabaseError && error.sqlstate === '42501' && error.message.includes('append-only');
}

export function validarCambios(entrada: { title: unknown; description: unknown; visibility: unknown }): CambiosProyecto {
  const title = typeof entrada.title === 'string' ? entrada.title.trim() : '';
  if (title.length < 3 || title.length > 200) {
    throw new ValidacionError('El título tiene que tener entre 3 y 200 caracteres.', 'title');
  }
  const descripcion = typeof entrada.description === 'string' ? entrada.description.trim() : '';
  if (descripcion.length > 4000) {
    throw new ValidacionError('La descripción puede tener como máximo 4000 caracteres.', 'description');
  }
  if (entrada.visibility !== 'private' && entrada.visibility !== 'public') {
    throw new ValidacionError('Elegí si el proyecto es privado o público.', 'visibility');
  }
  return { title, description: descripcion === '' ? null : descripcion, visibility: entrada.visibility };
}

export class ProyectosService {
  constructor(
    private readonly db: Db = getDb(),
    private readonly dao: ProyectosDao = new PostgresProyectosDao(),
  ) {}

  async actualizar(userId: string, projectId: string, cambios: CambiosProyecto): Promise<void> {
    const afectadas = await this.db.asUser(userId, (tx) => this.dao.actualizar(tx, projectId, cambios));
    if (afectadas === 0) throw new RecursoNoEncontradoError('El proyecto no existe o no es tuyo.');
  }

  async cambiarEstado(userId: string, projectId: string, accion: AccionEstado): Promise<ProjectStatus> {
    const transicion = TRANSICIONES[accion];
    return this.db.asUser(userId, async (tx) => {
      const afectadas = await this.dao.cambiarEstado(tx, projectId, transicion.desde, transicion.hacia);
      if (afectadas === 1) return transicion.hacia;
      if (!(await this.dao.existe(tx, projectId))) {
        throw new RecursoNoEncontradoError('El proyecto no existe o no es tuyo.');
      }
      throw new ConflictoError(`El proyecto no se puede ${accion} en su estado actual.`);
    });
  }

  async eliminar(userId: string, projectId: string): Promise<void> {
    let afectadas: number;
    try {
      afectadas = await this.db.asUser(userId, (tx) => this.dao.eliminar(tx, projectId));
    } catch (error) {
      if (esHistorialInmutable(error)) {
        throw new ConflictoError(
          'Este proyecto ya tiene historial de reputación o auditoría, que no se puede borrar. ' +
            'Cancelalo en lugar de eliminarlo: deja de avanzar y conserva el historial.',
        );
      }
      throw error;
    }
    if (afectadas === 0) throw new RecursoNoEncontradoError('El proyecto no existe o no es tuyo.');
  }
}
