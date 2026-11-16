/**
 * VEKTORA · FASE 8 — Vigilante de tareas adjudicadas.
 *
 * El emparejador sabe sacar una tarea del mercado; esto es lo que la DEVUELVE cuando quien
 * la recibió no va a terminarla:
 *
 *   · la tarea quedó `failed` (el juez agotó los intentos de ese proveedor), o
 *   · venció el plazo de entrega y no hay nada entregado esperando veredicto.
 *
 * En los dos casos la tarea vuelve a `ready` para otro proveedor. Agotadas las
 * reasignaciones, el proyecto pasa a `failed`: un final que el sistema alcanza solo.
 *
 * No guarda estado propio: en cada corrida mira lo que hay y actúa. Si una corrida se corta
 * a la mitad, la siguiente retoma sin nada que reparar.
 *
 * El reparto es el de siempre: `deadlines.ts` decide la ventana (política, pura), y la
 * base decide si el plazo venció y cambia el estado, todo con la tarea bloqueada
 * (`recover_stalled_task`), para que un veredicto que llega a la vez no se cuele en medio.
 */

import { toNumber, type Consultor } from '@/lib/db';
import type { PgNumeric } from '@/lib/db/types';
import { errorMessage } from '@/lib/ai/errors';
import { getMatchingConfig, type MatchingConfig } from './config';
import { deliveryWindowHours } from './deadlines';

export type RecoveryAction = 'none' | 'deadline_set' | 'reopened' | 'project_failed';

export interface WatchedTask {
  id: string;
  code: string;
  projectTitle: string;
  status: string;
  estimatedHours: number | null;
}

export interface RecoveryResult {
  action: RecoveryAction;
  reason: string | null;
  dueAt: string | null;
  reassignments: number | null;
}

export interface WatchdogRepository {
  /** Tareas fallidas o con el reloj de entrega corriendo, en proyectos en curso. */
  listWatched(limit: number): Promise<WatchedTask[]>;
  recover(params: {
    taskId: string;
    windowHours: number;
    maxReassignments: number;
    deadlinePenalty: number;
  }): Promise<RecoveryResult>;
}

export interface TaskCheck {
  taskId: string;
  code: string;
  projectTitle: string;
  action: RecoveryAction;
  reason: string | null;
  dueAt: string | null;
  /** Fallo NUESTRO al revisar esta tarea. No cambia nada: se reintenta en la próxima corrida. */
  error: string | null;
}

export interface SweepResult {
  checked: number;
  reopened: number;
  projectsFailed: number;
  errors: number;
  /** Solo lo que cambió o falló: fijar un plazo es el caso normal y no aporta a la traza. */
  detail: TaskCheck[];
}

export interface TaskWatchdogOptions {
  repository: WatchdogRepository;
  config?: MatchingConfig;
}

export class TaskWatchdog {
  private readonly repository: WatchdogRepository;
  private readonly config: MatchingConfig;

  constructor(options: TaskWatchdogOptions) {
    this.repository = options.repository;
    this.config = options.config ?? getMatchingConfig();
  }

  /** Revisa una tarea: fija su plazo o la devuelve al mercado. */
  async check(task: Pick<WatchedTask, 'id' | 'estimatedHours'>): Promise<RecoveryResult> {
    return this.repository.recover({
      taskId: task.id,
      windowHours: deliveryWindowHours(task.estimatedHours, this.config),
      maxReassignments: this.config.maxReassignments,
      deadlinePenalty: this.config.deadlineMissedDelta,
    });
  }

  /**
   * Revisa todas las tareas vigiladas. Un fallo en una no detiene a las demás: que la base
   * tropiece con una tarea no puede dejar a las otras esperando a un proveedor ausente.
   */
  async sweep(limit: number): Promise<SweepResult> {
    const tasks = await this.repository.listWatched(limit);
    const result: SweepResult = {
      checked: tasks.length,
      reopened: 0,
      projectsFailed: 0,
      errors: 0,
      detail: [],
    };

    for (const task of tasks) {
      const base = { taskId: task.id, code: task.code, projectTitle: task.projectTitle };
      try {
        const recovery = await this.check(task);
        if (recovery.action === 'reopened') result.reopened += 1;
        if (recovery.action === 'project_failed') result.projectsFailed += 1;
        if (recovery.action === 'reopened' || recovery.action === 'project_failed') {
          result.detail.push({
            ...base,
            action: recovery.action,
            reason: recovery.reason,
            dueAt: recovery.dueAt,
            error: null,
          });
        }
      } catch (error) {
        result.errors += 1;
        result.detail.push({
          ...base,
          action: 'none',
          reason: null,
          dueAt: null,
          error: errorMessage(error),
        });
      }
    }

    return result;
  }
}

const ACTIONS: readonly RecoveryAction[] = ['none', 'deadline_set', 'reopened', 'project_failed'];

/** Implementación sobre PostgreSQL, con la identidad de los agentes. */
export class PostgresWatchdogRepository implements WatchdogRepository {
  constructor(private readonly db: Consultor) {}

  async listWatched(limit: number): Promise<WatchedTask[]> {
    const filas = await this.db.query<{
      id: string;
      code: string;
      proyecto: string;
      status: string;
      estimated_hours: PgNumeric | null;
    }>(
      // Primero las fallidas (ya se sabe que hay que actuar), luego las que todavía no
      // tienen plazo escrito y después las de plazo más próximo.
      `select t.id, t.code, p.title as proyecto, t.status, t.estimated_hours
         from public.project_tasks t
         join public.projects p on p.id = t.project_id
        where p.status in ('planned', 'active')
          and (t.status = 'failed'
               or (t.assignee_id is not null
                   and t.status in ('assigned', 'in_progress', 'revision_requested')))
        order by (t.status = 'failed') desc, t.due_at asc nulls first
        limit $1`,
      [limit],
    );
    return filas.map((fila) => ({
      id: fila.id,
      code: fila.code,
      projectTitle: fila.proyecto,
      status: fila.status,
      estimatedHours: toNumber(fila.estimated_hours),
    }));
  }

  async recover(params: {
    taskId: string;
    windowHours: number;
    maxReassignments: number;
    deadlinePenalty: number;
  }): Promise<RecoveryResult> {
    const fila = await this.db.one<{ r: Record<string, unknown> | null }>(
      `select public.recover_stalled_task(
                p_task_id           => $1::uuid,
                p_window_hours      => $2::numeric,
                p_max_reassignments => $3::integer,
                p_deadline_penalty  => $4::numeric) as r`,
      [params.taskId, params.windowHours, params.maxReassignments, params.deadlinePenalty],
    );
    const payload = fila?.r ?? {};
    const action = payload['action'];
    return {
      action: ACTIONS.includes(action as RecoveryAction) ? (action as RecoveryAction) : 'none',
      reason: typeof payload['reason'] === 'string' ? payload['reason'] : null,
      dueAt: typeof payload['due_at'] === 'string' ? payload['due_at'] : null,
      reassignments:
        typeof payload['reassignments'] === 'number' ? payload['reassignments'] : null,
    };
  }
}
