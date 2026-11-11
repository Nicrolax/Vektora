/**
 * VEKTORA · FASE 3 — Acceso a datos del planificador (DAO).
 *
 * El planificador habla con esta interfaz, nunca con la base directamente: así su lógica
 * (que es la parte con reglas de negocio) se prueba sin base de datos, y la persistencia
 * real queda concentrada en un único sitio auditable.
 */

import { json, toNumber, type Consultor } from '@/lib/db';
import type { ApplyProjectPlanResult, ProjectRow } from '@/lib/db/types';
import { DatabaseError } from '@/lib/errores';
import type { SkillCatalogEntry } from './prompts';

export interface ProjectRecord {
  id: string;
  ownerId: string;
  title: string;
  objective: string;
  status: string;
  visibility: string;
  currency: string;
  budgetTotal: number | null;
  deadline: string | null;
}

export interface CreateProjectInput {
  ownerId: string;
  title: string;
  objective: string;
  budgetTotal?: number | null;
  currency?: string;
  deadline?: string | null;
  visibility?: 'private' | 'public';
  acceptancePolicy?: Record<string, unknown>;
}

/** Fila de `project_tasks` tal como la consume `apply_project_plan`. */
export interface PersistableTask {
  code: string;
  title: string;
  description: string;
  acceptance_criteria: unknown[];
  required_skills: string[];
  estimated_hours: number;
  budget: number | null;
  priority: number;
  order_index: number;
  depth: number;
  status: 'blocked' | 'ready';
}

/** Arista para `task_dependencies`: `task_code` depende de `depends_on_code`. */
export interface PersistableEdge {
  task_code: string;
  depends_on_code: string;
}

export interface ApplyPlanResult {
  projectId: string;
  taskCount: number;
  edgeCount: number;
  /** code -> uuid de `project_tasks`, necesario para escribir los embeddings. */
  taskIds: Record<string, string>;
}

export interface TaskEmbedding {
  taskId: string;
  vector: string;
  model: string;
}

export interface PlannerRepository {
  fetchSkillCatalog(): Promise<SkillCatalogEntry[]>;
  registerSkills(slugs: readonly string[]): Promise<number>;
  loadProject(projectId: string): Promise<ProjectRecord | null>;
  createProject(input: CreateProjectInput): Promise<ProjectRecord>;
  applyPlan(
    projectId: string,
    tasks: readonly PersistableTask[],
    edges: readonly PersistableEdge[],
    metadata: Record<string, unknown>,
  ): Promise<ApplyPlanResult>;
  saveTaskEmbeddings(entries: readonly TaskEmbedding[]): Promise<number>;
}

/**
 * Fallo de persistencia del planificador. Hereda de `DatabaseError`: conserva el SQLSTATE
 * y nunca muestra el texto de la base a la persona.
 */
export class PlannerRepositoryError extends DatabaseError {
  override readonly codigo: string = 'planner_repositorio';

  /** `true` cuando el fallo viene del trigger `prevent_dag_cycles` de la FASE 1. */
  get isDagViolation(): boolean {
    return this.sqlstate === '23514';
  }
}

/** Re-lanza un fallo de la base como error del repositorio, sin perder el SQLSTATE. */
function fail(action: string, error: unknown): never {
  if (error instanceof DatabaseError) {
    throw new PlannerRepositoryError(
      `VEKTORA/PLANNER: ${action} falló -> ${error.message}`,
      error.sqlstate,
      error.details,
      { cause: error },
    );
  }
  throw error;
}

const PROJECT_COLUMNS =
  'id, owner_id, title, objective, status, visibility, currency, budget_total, deadline';

/** Subconjunto de `ProjectRow` que pide `PROJECT_COLUMNS`. */
type ProjectSelection = Pick<
  ProjectRow,
  | 'id'
  | 'owner_id'
  | 'title'
  | 'objective'
  | 'status'
  | 'visibility'
  | 'currency'
  | 'budget_total'
  | 'deadline'
>;

function toProjectRecord(row: ProjectSelection): ProjectRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    visibility: row.visibility,
    currency: row.currency,
    // `numeric` llega como string desde `pg`: se normaliza aquí y no en el planificador,
    // que no debe conocer esa peculiaridad.
    budgetTotal: toNumber(row.budget_total),
    deadline: row.deadline,
  };
}

/** Implementación sobre PostgreSQL. Todas las consultas son parametrizadas (R9). */
export class PostgresPlannerRepository implements PlannerRepository {
  constructor(private readonly db: Consultor) {}

  async fetchSkillCatalog(): Promise<SkillCatalogEntry[]> {
    try {
      return await this.db.query<SkillCatalogEntry>(
        `select slug, name, category
           from public.skills
          where is_active
          order by category asc nulls last, slug asc`,
      );
    } catch (error) {
      fail('leer el catálogo de skills', error);
    }
  }

  async registerSkills(slugs: readonly string[]): Promise<number> {
    if (slugs.length === 0) return 0;
    try {
      const fila = await this.db.one<{ r: number | null }>(
        'select public.register_skills(p_slugs => $1::text[]) as r',
        [slugs],
      );
      return typeof fila?.r === 'number' ? fila.r : 0;
    } catch (error) {
      fail('registrar skills nuevas', error);
    }
  }

  async loadProject(projectId: string): Promise<ProjectRecord | null> {
    try {
      const fila = await this.db.one<ProjectSelection>(
        `select ${PROJECT_COLUMNS} from public.projects where id = $1`,
        [projectId],
      );
      return fila === null ? null : toProjectRecord(fila);
    } catch (error) {
      fail('cargar el proyecto', error);
    }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    let fila: ProjectSelection | null;
    try {
      fila = await this.db.one<ProjectSelection>(
        `insert into public.projects
           (owner_id, title, objective, budget_total, currency, deadline, visibility,
            acceptance_policy, status)
         values ($1, $2, $3, $4, $5, $6, $7::public.project_visibility, $8::jsonb, 'planning')
         returning ${PROJECT_COLUMNS}`,
        [
          input.ownerId,
          input.title,
          input.objective,
          input.budgetTotal ?? null,
          input.currency ?? 'USD',
          input.deadline ?? null,
          input.visibility ?? 'private',
          json(input.acceptancePolicy ?? {}),
        ],
      );
    } catch (error) {
      fail('crear el proyecto', error);
    }
    if (fila === null) {
      throw new PlannerRepositoryError('VEKTORA/PLANNER: el insert no devolvió el proyecto');
    }
    return toProjectRecord(fila);
  }

  async applyPlan(
    projectId: string,
    tasks: readonly PersistableTask[],
    edges: readonly PersistableEdge[],
    metadata: Record<string, unknown>,
  ): Promise<ApplyPlanResult> {
    let payload: Partial<ApplyProjectPlanResult> = {};
    try {
      const fila = await this.db.one<{ r: Partial<ApplyProjectPlanResult> | null }>(
        `select public.apply_project_plan(
                  p_project_id       => $1::uuid,
                  p_tasks            => $2::jsonb,
                  p_dependencies     => $3::jsonb,
                  p_planner_metadata => $4::jsonb) as r`,
        [projectId, json(tasks), json(edges), json(metadata)],
      );
      payload = fila?.r ?? {};
    } catch (error) {
      fail('aplicar el plan', error);
    }
    return {
      projectId,
      taskCount: payload.task_count ?? tasks.length,
      edgeCount: payload.edge_count ?? edges.length,
      taskIds: payload.task_ids ?? {},
    };
  }

  async saveTaskEmbeddings(entries: readonly TaskEmbedding[]): Promise<number> {
    let saved = 0;
    for (const entry of entries) {
      try {
        await this.db.execute(
          `update public.project_tasks
              set embedding = $2::extensions.vector, embedding_model = $3,
                  embedding_updated_at = now()
            where id = $1`,
          [entry.taskId, entry.vector, entry.model],
        );
        saved += 1;
      } catch (error) {
        // Un embedding que no se guarda degrada el matching de la FASE 4, pero no invalida
        // el plan: se cuenta y se reporta en el resultado en lugar de abortar.
        const motivo = error instanceof Error ? error.message : String(error);
        console.warn(`[vektora/planner] embedding de ${entry.taskId}: ${motivo}`);
      }
    }
    return saved;
  }
}
