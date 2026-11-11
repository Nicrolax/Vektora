/**
 * VEKTORA — Entrega de trabajo: la transacción sobre varias tablas (requisito R7).
 *
 * Entregar toca TRES tablas y tiene que ser todo o nada:
 *
 *   1. `project_tasks`  — se bloquea la fila (`SELECT … FOR UPDATE`) y se comprueba que la
 *                         persona sea la proveedora adjudicada y que la tarea admita entregas.
 *   2. `deliverables`   — se inserta el entregable (la versión la asigna un trigger).
 *   3. `project_tasks`  — la tarea pasa a `submitted` (entra en la cola del juez).
 *   4. `audit_logs`     — queda registrado quién entregó qué y cuándo.
 *
 * Si cualquier paso falla (la tarea cambió de estado en el medio, se cayó la conexión, una
 * restricción de la base rechaza un dato), `transaction()` hace ROLLBACK y no queda NADA:
 * ni un entregable huérfano sin tarea en `submitted`, ni una tarea en `submitted` sin
 * entregable. Si todo sale bien, COMMIT.
 *
 * El `FOR UPDATE` evita la carrera de dos pestañas entregando a la vez: la segunda espera a
 * que termine la primera y entonces ve la tarea ya en `submitted`.
 */

import { getDb, json, type Consultor, type Db } from '@/lib/db';
import { ConflictoError, PermisoDenegadoError, RecursoNoEncontradoError, ValidacionError } from '@/lib/errores';

/** Estados desde los que se puede entregar. */
export const ESTADOS_ENTREGABLES = ['assigned', 'in_progress', 'revision_requested'] as const;

export interface TareaBloqueada {
  id: string;
  projectId: string;
  assigneeId: string | null;
  status: string;
  criterios: string[];
}

export interface NuevaEntrega {
  taskId: string;
  summary: string;
  content: string;
  /** Evidencia por criterio: `{ "AC-1": "…", "AC-2": "…" }`. */
  evidence: Record<string, string>;
}

export interface EntregaRegistrada {
  deliverableId: string;
  version: number;
  projectId: string;
}

/** DAO de la entrega: cada método recibe la conexión de la transacción en curso. */
export interface EntregasRepository {
  bloquearTarea(tx: Consultor, taskId: string): Promise<TareaBloqueada | null>;
  insertarEntregable(tx: Consultor, providerId: string, entrega: NuevaEntrega): Promise<{ id: string; version: number }>;
  marcarEntregada(tx: Consultor, taskId: string): Promise<number>;
  registrarAuditoria(
    tx: Consultor,
    datos: { actorId: string; projectId: string; deliverableId: string; taskId: string; version: number },
  ): Promise<void>;
}

export class PostgresEntregasRepository implements EntregasRepository {
  async bloquearTarea(tx: Consultor, taskId: string): Promise<TareaBloqueada | null> {
    const fila = await tx.one<{
      id: string;
      project_id: string;
      assignee_id: string | null;
      status: string;
      criterios: string[] | null;
    }>(
      `select id, project_id, assignee_id, status,
              array(select c ->> 'id' from jsonb_array_elements(acceptance_criteria) c
                     where c ->> 'id' is not null) as criterios
         from public.project_tasks
        where id = $1
        for update`,
      [taskId],
    );
    if (fila === null) return null;
    return {
      id: fila.id,
      projectId: fila.project_id,
      assigneeId: fila.assignee_id,
      status: fila.status,
      criterios: fila.criterios ?? [],
    };
  }

  async insertarEntregable(
    tx: Consultor,
    providerId: string,
    entrega: NuevaEntrega,
  ): Promise<{ id: string; version: number }> {
    const fila = await tx.one<{ id: string; version: number }>(
      `insert into public.deliverables (task_id, provider_id, summary, content, artifacts, evidence)
       values ($1, $2, $3, $4, '[]'::jsonb, $5::jsonb)
       returning id, version`,
      [entrega.taskId, providerId, entrega.summary, entrega.content, json(entrega.evidence)],
    );
    if (fila === null) throw new Error('el insert del entregable no devolvió fila');
    return fila;
  }

  async marcarEntregada(tx: Consultor, taskId: string): Promise<number> {
    return tx.execute(
      `update public.project_tasks
          set status = 'submitted', started_at = coalesce(started_at, now())
        where id = $1 and status = any($2::public.task_status[])`,
      [taskId, ESTADOS_ENTREGABLES],
    );
  }

  async registrarAuditoria(
    tx: Consultor,
    datos: { actorId: string; projectId: string; deliverableId: string; taskId: string; version: number },
  ): Promise<void> {
    await tx.execute(
      `insert into public.audit_logs (actor_id, actor_type, action, entity_type, entity_id, project_id, changes)
       values ($1, 'user', 'deliverable.submitted', 'deliverable', $2, $3, $4::jsonb)`,
      [
        datos.actorId,
        datos.deliverableId,
        datos.projectId,
        json({ task_id: datos.taskId, version: datos.version, task_status: 'submitted' }),
      ],
    );
  }
}

export class EntregasService {
  constructor(
    private readonly db: Db = getDb(),
    private readonly repo: EntregasRepository = new PostgresEntregasRepository(),
  ) {}

  /** Criterios de la tarea a los que les falta evidencia (para avisar antes de entregar). */
  static faltantes(criterios: readonly string[], evidencia: Record<string, string>): string[] {
    return criterios.filter((id) => (evidencia[id] ?? '').trim() === '');
  }

  async entregar(providerId: string, entrega: NuevaEntrega): Promise<EntregaRegistrada> {
    if (entrega.summary.trim().length < 10) {
      throw new ValidacionError('El resumen necesita al menos 10 caracteres.', 'summary');
    }
    if (entrega.content.trim() === '') {
      throw new ValidacionError('Hace falta entregar algo: el evaluador no aprueba nada sin evidencia.', 'content');
    }

    return this.db.transaction(async (tx) => {
      const tarea = await this.repo.bloquearTarea(tx, entrega.taskId);
      if (tarea === null) throw new RecursoNoEncontradoError('La tarea no existe.');
      // La comprobación que de verdad protege: tener sesión no alcanza.
      if (tarea.assigneeId !== providerId) {
        throw new PermisoDenegadoError('Esta tarea está adjudicada a otro proveedor.');
      }
      if (!(ESTADOS_ENTREGABLES as readonly string[]).includes(tarea.status)) {
        throw new ConflictoError(
          tarea.status === 'submitted' || tarea.status === 'in_review'
            ? 'Ya entregaste esta tarea: esperá el veredicto del evaluador.'
            : 'La tarea no está en un estado que admita entregas.',
        );
      }

      const evidencia: Record<string, string> = {};
      for (const id of tarea.criterios) {
        const texto = entrega.evidence[id]?.trim();
        if (texto !== undefined && texto !== '') evidencia[id] = texto;
      }

      const entregable = await this.repo.insertarEntregable(tx, providerId, { ...entrega, evidence: evidencia });
      const cambiadas = await this.repo.marcarEntregada(tx, tarea.id);
      if (cambiadas !== 1) {
        // Lanzar acá deshace también el INSERT de arriba: ROLLBACK.
        throw new ConflictoError('La tarea cambió de estado mientras entregabas. Recargá la página.');
      }
      await this.repo.registrarAuditoria(tx, {
        actorId: providerId,
        projectId: tarea.projectId,
        deliverableId: entregable.id,
        taskId: tarea.id,
        version: entregable.version,
      });

      return { deliverableId: entregable.id, version: entregable.version, projectId: tarea.projectId };
    });
  }
}
