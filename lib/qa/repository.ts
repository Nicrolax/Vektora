/**
 * VEKTORA · FASE 5 — Acceso a datos del AI Judge.
 *
 * Mismo patrón que planner, providers y matching: el dominio habla con esta interfaz, así
 * la política —que es donde el juez puede equivocarse— se prueba sin base de datos.
 *
 * Las cuatro operaciones son RPC y no consultas sueltas por una razón concreta: tomar el
 * turno y escribir el veredicto tienen que ser atómicos. Cada función SQL corre entera en una
 * sola transacción del servidor: hacerlo con consultas sueltas desde aquí dejaría ventanas en
 * las que dos jueces juzgan lo mismo o una tarea queda aprobada sin reseña.
 */

import { json, toNumber, type Consultor } from '@/lib/db';
import type { PgNumeric } from '@/lib/db/types';
import { DatabaseError } from '@/lib/errores';
import type { QaOutcome, ReputationDelta, TaskOutcome } from './policy';

export interface QaClaim {
  deliverable: {
    id: string;
    taskId: string;
    providerId: string;
    version: number;
    summary: string | null;
    content: string | null;
    artifacts: unknown[];
    evidence: Record<string, unknown>;
    submittedAt: string;
  };
  task: {
    id: string;
    projectId: string;
    code: string;
    title: string;
    description: string | null;
    acceptanceCriteria: unknown;
    requiredSkills: string[];
    status: string;
    assigneeId: string | null;
    budget: number | null;
    estimatedHours: number | null;
  };
  project: { id: string; title: string; objective: string };
  previousStatus: string;
  previousRejections: number;
}

export interface QaClaimResult {
  claimed: boolean;
  reason: string | null;
  qaStatus: string | null;
  claim: QaClaim | null;
}

export interface ApplyVerdictInput {
  deliverableId: string;
  qaStatus: QaOutcome;
  taskStatus: TaskOutcome;
  score: number;
  rating: number;
  qualityScore: number | null;
  feedback: Record<string, unknown>;
  criteriaResults: unknown[];
  runId: string | null;
  comment: string | null;
  reputation: readonly ReputationDelta[];
}

export interface ApplyVerdictResult {
  applied: boolean;
  reason: string | null;
  reviewId: string | null;
  reputationWritten: number;
  reputationSkipped: string[];
}

export interface PendingDeliverable {
  deliverableId: string;
  taskId: string;
  projectId: string;
  taskCode: string;
  taskTitle: string;
  providerId: string;
  version: number;
  qaStatus: string;
  submittedAt: string;
  criteriaCount: number;
}

/**
 * Estados a los que se puede devolver un turno tomado. No incluye los terminales: soltar un
 * entregable como `approved` sin pasar por `apply_qa_verdict` lo dejaría aprobado sin reseña
 * ni reputación, que es un estado del que nadie se recupera solo.
 */
export type QaReleaseStatus = 'pending' | 'revision_requested' | 'error';

export interface QaRepository {
  claim(deliverableId: string): Promise<QaClaimResult>;
  release(deliverableId: string, status: QaReleaseStatus, error: string | null): Promise<boolean>;
  applyVerdict(input: ApplyVerdictInput): Promise<ApplyVerdictResult>;
  pending(limit: number): Promise<PendingDeliverable[]>;
  /** Último entregable juzgable de una tarea; `npm run qa -- --task <id>` lo usa. */
  latestDeliverableForTask(taskId: string): Promise<string | null>;
}

/**
 * Fallo de persistencia del juez. Hereda de `DatabaseError`: conserva el SQLSTATE y nunca
 * muestra el texto de la base a la persona.
 */
export class QaRepositoryError extends DatabaseError {
  override readonly codigo: string = 'qa_repositorio';
}

function fail(action: string, error: unknown): never {
  if (error instanceof DatabaseError) {
    throw new QaRepositoryError(
      `VEKTORA/QA: ${action} -> ${error.message}`,
      error.sqlstate,
      error.details,
      { cause: error },
    );
  }
  throw error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Implementación sobre PostgreSQL. Todas las consultas son parametrizadas (R9). */
export class PostgresQaRepository implements QaRepository {
  constructor(private readonly db: Consultor) {}

  async claim(deliverableId: string): Promise<QaClaimResult> {
    let data: unknown;
    try {
      const fila = await this.db.one<{ r: unknown }>(
        'select public.claim_deliverable_for_qa(p_deliverable_id => $1::uuid) as r',
        [deliverableId],
      );
      data = fila?.r;
    } catch (error) {
      fail('no se pudo tomar el entregable', error);
    }

    const payload = asRecord(data);
    if (payload['claimed'] !== true) {
      return {
        claimed: false,
        reason: asString(payload['reason']) ?? 'la base no explicó el motivo',
        qaStatus: asString(payload['qa_status']),
        claim: null,
      };
    }

    const deliverable = asRecord(payload['deliverable']);
    const task = asRecord(payload['task']);
    const project = asRecord(payload['project']);

    return {
      claimed: true,
      reason: null,
      qaStatus: 'running',
      claim: {
        deliverable: {
          id: String(deliverable['id']),
          taskId: String(deliverable['task_id']),
          providerId: String(deliverable['provider_id']),
          version: Number(deliverable['version'] ?? 1),
          summary: asString(deliverable['summary']),
          content: asString(deliverable['content']),
          artifacts: asArray(deliverable['artifacts']),
          evidence: asRecord(deliverable['evidence']),
          submittedAt: String(deliverable['submitted_at'] ?? ''),
        },
        task: {
          id: String(task['id']),
          projectId: String(task['project_id']),
          code: String(task['code'] ?? ''),
          title: String(task['title'] ?? ''),
          description: asString(task['description']),
          acceptanceCriteria: task['acceptance_criteria'],
          requiredSkills: asArray(task['required_skills']).map((slug) => String(slug)),
          status: String(task['status'] ?? ''),
          assigneeId: asString(task['assignee_id']),
          budget: toNumber(task['budget'] as PgNumeric | null),
          estimatedHours: toNumber(task['estimated_hours'] as PgNumeric | null),
        },
        project: {
          id: String(project['id']),
          title: String(project['title'] ?? ''),
          objective: String(project['objective'] ?? ''),
        },
        previousStatus: asString(payload['previous_status']) ?? 'pending',
        previousRejections: Number(payload['previous_rejections'] ?? 0),
      },
    };
  }

  async release(
    deliverableId: string,
    status: QaReleaseStatus,
    error: string | null,
  ): Promise<boolean> {
    try {
      const fila = await this.db.one<{ r: boolean | null }>(
        `select public.release_deliverable_qa(
                  p_deliverable_id => $1::uuid, p_status => $2::public.qa_status, p_error => $3) as r`,
        [deliverableId, status, error],
      );
      return fila?.r === true;
    } catch (causa) {
      fail('no se pudo devolver el turno', causa);
    }
  }

  async applyVerdict(input: ApplyVerdictInput): Promise<ApplyVerdictResult> {
    let data: unknown;
    try {
      const fila = await this.db.one<{ r: unknown }>(
        `select public.apply_qa_verdict(
                  p_deliverable_id      => $1::uuid,
                  p_qa_status           => $2::public.qa_status,
                  p_qa_score            => $3::numeric,
                  p_qa_feedback         => $4::jsonb,
                  p_qa_criteria_results => $5::jsonb,
                  p_task_status         => $6::public.task_status,
                  p_rating              => $7::numeric,
                  p_qa_run_id           => $8::uuid,
                  p_quality_score       => $9::numeric,
                  p_timeliness_score    => null,
                  p_comment             => $10,
                  p_reputation          => $11::jsonb) as r`,
        [
          input.deliverableId,
          input.qaStatus,
          input.score,
          json(input.feedback),
          json(input.criteriaResults),
          input.taskStatus,
          input.rating,
          input.runId,
          input.qualityScore,
          input.comment,
          json(input.reputation),
        ],
      );
      data = fila?.r;
    } catch (error) {
      fail('no se pudo aplicar el veredicto', error);
    }

    const payload = asRecord(data);
    return {
      applied: payload['applied'] === true,
      reason: asString(payload['reason']),
      reviewId: asString(payload['review_id']),
      reputationWritten: Number(payload['reputation_written'] ?? 0),
      reputationSkipped: asArray(payload['reputation_skipped']).map((entry) => String(entry)),
    };
  }

  async pending(limit: number): Promise<PendingDeliverable[]> {
    let filas: Record<string, unknown>[];
    try {
      filas = await this.db.query(
        'select * from public.pending_qa_deliverables(p_limit => $1::integer)',
        [limit],
      );
    } catch (error) {
      fail('no se pudo leer la cola', error);
    }

    return filas.map((row) => ({
      deliverableId: String(row['deliverable_id']),
      taskId: String(row['task_id']),
      projectId: String(row['project_id']),
      taskCode: String(row['task_code'] ?? ''),
      taskTitle: String(row['task_title'] ?? ''),
      providerId: String(row['provider_id']),
      version: Number(row['version'] ?? 1),
      qaStatus: String(row['qa_status'] ?? ''),
      submittedAt: String(row['submitted_at'] ?? ''),
      criteriaCount: Number(row['criteria_count'] ?? 0),
    }));
  }

  async latestDeliverableForTask(taskId: string): Promise<string | null> {
    try {
      const fila = await this.db.one<{ id: string }>(
        `select id from public.deliverables
          where task_id = $1
          order by version desc
          limit 1`,
        [taskId],
      );
      return fila?.id ?? null;
    } catch (error) {
      fail('no se pudo buscar el entregable de la tarea', error);
    }
  }
}
