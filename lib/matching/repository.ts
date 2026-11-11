/**
 * VEKTORA · FASE 4 — Acceso a datos del motor de matching.
 *
 * Mismo patrón que planner y providers: el dominio habla con esta interfaz, así el ranking
 * —que es donde el motor puede equivocarse— se prueba sin base de datos.
 */

import { json, toNumber, type Consultor } from '@/lib/db';
import type { PgNumeric } from '@/lib/db/types';
import { DatabaseError } from '@/lib/errores';
import type { MatchCandidate, ScoredCandidate } from './scoring';

export interface MatchTaskRecord {
  id: string;
  projectId: string;
  ownerId: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  requiredSkills: string[];
  acceptanceCriteria: unknown[];
  estimatedHours: number | null;
  budget: number | null;
  assigneeId: string | null;
  hasEmbedding: boolean;
  /** Veces que ya se buscó proveedor para esta tarea sin llegar a adjudicarla. */
  matchingRounds: number;
}

export interface ApplyMatchesResult {
  taskId: string;
  written: number;
  totalApplications: number;
}

export interface AcceptResult {
  taskId: string;
  applicationId: string;
  providerId: string;
}

export interface MatchingRepository {
  loadTask(taskId: string): Promise<MatchTaskRecord | null>;
  saveTaskEmbedding(taskId: string, vector: string, model: string): Promise<boolean>;
  fetchCandidates(params: {
    taskId: string;
    limit: number;
    requireAutoAssign: boolean;
  }): Promise<MatchCandidate[]>;
  applyMatches(taskId: string, matches: readonly ScoredCandidate[]): Promise<ApplyMatchesResult>;
  /** Suma una ronda de búsqueda sin adjudicación. Devuelve el total tras sumarla. */
  bumpMatchingRound(taskId: string): Promise<number>;
  findApplicationId(taskId: string, providerId: string): Promise<string | null>;
  acceptApplication(applicationId: string): Promise<AcceptResult>;
}

/**
 * Fallo de persistencia del motor de matching. Hereda de `DatabaseError`: conserva el
 * SQLSTATE y nunca muestra el texto de la base a la persona.
 */
export class MatchingRepositoryError extends DatabaseError {
  override readonly codigo: string = 'matching_repositorio';

  /** `true` cuando otra adjudicación ganó la carrera por la misma tarea. */
  get isAlreadyAssigned(): boolean {
    return this.sqlstate === '23505';
  }
}

function fail(action: string, error: unknown): never {
  if (error instanceof DatabaseError) {
    throw new MatchingRepositoryError(
      `VEKTORA/MATCH: ${action} falló -> ${error.message}`,
      error.sqlstate,
      error.details,
      { cause: error },
    );
  }
  throw error;
}

/** Fila cruda de `match_task_candidates`. `numeric` llega como string desde `pg`. */
interface CandidateRow {
  provider_profile_id: string;
  user_id: string;
  headline: string | null;
  seniority: string | null;
  hourly_rate_usd: PgNumeric | null;
  min_task_budget_usd: PgNumeric | null;
  availability_hours_week: number | null;
  reputation_score: PgNumeric;
  tasks_completed: number;
  tasks_failed: number;
  avg_rating: PgNumeric | null;
  on_time_rate: PgNumeric | null;
  accepts_auto_assign: boolean;
  vector_similarity: PgNumeric | null;
  skill_slugs: string[] | null;
  skill_levels: number[] | null;
}

function toCandidate(row: CandidateRow): MatchCandidate {
  const slugs = row.skill_slugs ?? [];
  const levels = row.skill_levels ?? [];
  return {
    providerProfileId: row.provider_profile_id,
    userId: row.user_id,
    headline: row.headline,
    seniority: row.seniority,
    hourlyRateUsd: toNumber(row.hourly_rate_usd),
    minTaskBudgetUsd: toNumber(row.min_task_budget_usd),
    availabilityHoursWeek: row.availability_hours_week,
    reputationScore: toNumber(row.reputation_score) ?? 0,
    tasksCompleted: row.tasks_completed ?? 0,
    tasksFailed: row.tasks_failed ?? 0,
    avgRating: toNumber(row.avg_rating),
    onTimeRate: toNumber(row.on_time_rate),
    acceptsAutoAssign: row.accepts_auto_assign,
    vectorSimilarity: toNumber(row.vector_similarity),
    skills: slugs.map((slug, index) => ({ slug, level: levels[index] ?? 3 })),
  };
}

interface TaskRow {
  id: string;
  project_id: string;
  owner_id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  required_skills: string[] | null;
  acceptance_criteria: unknown;
  estimated_hours: PgNumeric | null;
  budget: PgNumeric | null;
  assignee_id: string | null;
  has_embedding: boolean;
  matching_rounds: number | null;
}

/** Implementación sobre PostgreSQL. Todas las consultas son parametrizadas (R9). */
export class PostgresMatchingRepository implements MatchingRepository {
  constructor(private readonly db: Consultor) {}

  async loadTask(taskId: string): Promise<MatchTaskRecord | null> {
    let row: TaskRow | null;
    try {
      // JOIN con `projects` para conocer al dueño: el filtro duro que impide que alguien
      // se adjudique su propia tarea lo necesita.
      row = await this.db.one<TaskRow>(
        `select t.id, t.project_id, p.owner_id, t.code, t.title, t.description, t.status,
                t.required_skills, t.acceptance_criteria, t.estimated_hours, t.budget,
                t.assignee_id, (t.embedding is not null) as has_embedding, t.matching_rounds
           from public.project_tasks t
           join public.projects p on p.id = t.project_id
          where t.id = $1`,
        [taskId],
      );
    } catch (error) {
      fail('cargar la tarea', error);
    }
    if (row === null) return null;

    return {
      id: row.id,
      projectId: row.project_id,
      ownerId: row.owner_id,
      code: row.code,
      title: row.title,
      description: row.description,
      status: row.status,
      requiredSkills: Array.isArray(row.required_skills) ? row.required_skills : [],
      acceptanceCriteria: Array.isArray(row.acceptance_criteria) ? row.acceptance_criteria : [],
      estimatedHours: toNumber(row.estimated_hours),
      budget: toNumber(row.budget),
      assigneeId: row.assignee_id,
      // No se trae el vector entero: son 1536 números que no se usan del lado de la app.
      hasEmbedding: row.has_embedding,
      matchingRounds: Number(row.matching_rounds ?? 0),
    };
  }

  async saveTaskEmbedding(taskId: string, vector: string, model: string): Promise<boolean> {
    try {
      await this.db.execute(
        `update public.project_tasks
            set embedding = $2::extensions.vector, embedding_model = $3,
                embedding_updated_at = now()
          where id = $1`,
        [taskId, vector, model],
      );
      return true;
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      console.warn(`[vektora/match] no se pudo vectorizar la tarea: ${motivo}`);
      return false;
    }
  }

  async fetchCandidates(params: {
    taskId: string;
    limit: number;
    requireAutoAssign: boolean;
  }): Promise<MatchCandidate[]> {
    try {
      const filas = await this.db.query<CandidateRow>(
        `select * from public.match_task_candidates(
                  p_task_id => $1::uuid, p_limit => $2::integer, p_require_auto_assign => $3::boolean)`,
        [params.taskId, params.limit, params.requireAutoAssign],
      );
      return filas.map(toCandidate);
    } catch (error) {
      fail('recuperar candidatos', error);
    }
  }

  async applyMatches(
    taskId: string,
    matches: readonly ScoredCandidate[],
  ): Promise<ApplyMatchesResult> {
    let payload: { written?: number; total_applications?: number } = {};
    try {
      const fila = await this.db.one<{ r: typeof payload | null }>(
        'select public.apply_task_matches(p_task_id => $1::uuid, p_matches => $2::jsonb) as r',
        [
          taskId,
          json(
            matches.map((match) => ({
              provider_id: match.userId,
              vector_score: match.vectorScore,
              skill_score: match.skillScore,
              reputation_score: match.reputationScore,
              match_score: match.matchScore,
              match_explanation: match.explanation,
            })),
          ),
        ],
      );
      payload = fila?.r ?? {};
    } catch (error) {
      fail('escribir las candidaturas', error);
    }
    return {
      taskId,
      written: payload.written ?? 0,
      totalApplications: payload.total_applications ?? 0,
    };
  }

  async bumpMatchingRound(taskId: string): Promise<number> {
    try {
      const fila = await this.db.one<{ r: number | null }>(
        'select public.bump_matching_round(p_task_id => $1::uuid) as r',
        [taskId],
      );
      return Number(fila?.r ?? 0);
    } catch (error) {
      fail('registrar la ronda de emparejamiento', error);
    }
  }

  async findApplicationId(taskId: string, providerId: string): Promise<string | null> {
    try {
      const fila = await this.db.one<{ id: string }>(
        'select id from public.task_applications where task_id = $1 and provider_id = $2',
        [taskId, providerId],
      );
      return fila?.id ?? null;
    } catch (error) {
      fail('localizar la candidatura', error);
    }
  }

  async acceptApplication(applicationId: string): Promise<AcceptResult> {
    let payload: { task_id?: string; application_id?: string; provider_id?: string } = {};
    try {
      const fila = await this.db.one<{ r: typeof payload | null }>(
        'select public.accept_task_application(p_application_id => $1::uuid) as r',
        [applicationId],
      );
      payload = fila?.r ?? {};
    } catch (error) {
      fail('adjudicar la tarea', error);
    }
    return {
      taskId: payload.task_id ?? '',
      applicationId: payload.application_id ?? applicationId,
      providerId: payload.provider_id ?? '',
    };
  }
}
