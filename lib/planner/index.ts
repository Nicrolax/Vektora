/**
 * VEKTORA · FASE 3 — API pública del ProjectPlanner.
 *
 *   import { createProjectPlanner } from '@/lib/planner';
 *
 *   const result = await createProjectPlanner().planProject({
 *     create: { ownerId, objective: 'Micrositio de captación…', budgetTotal: 3000 },
 *   });
 *
 * Sin argumentos usa el repositorio PostgreSQL con la identidad de los agentes. Inyectando
 * `repository` (y opcionalmente `ai` / `embeddings`) se prueba todo el planificador sin
 * red ni base de datos.
 */

import { getDb } from '@/lib/db';
import { ProjectPlanner, type ProjectPlannerOptions } from './planner';
import { PostgresPlannerRepository } from './repository';

// --- Orquestador ---------------------------------------------------------------------
export { PlannerError, ProjectPlanner, normalizeSkillSlugs, renderTaskForEmbedding, residualCycles } from './planner';
export type {
  PlannerCorrection,
  PlanProjectInput,
  PlanProjectResult,
  ProjectPlannerOptions,
} from './planner';

// --- Álgebra de grafos (pura) --------------------------------------------------------
export {
  breakCycles,
  computeDepths,
  criticalPath,
  describeDag,
  executionLevels,
  findCycles,
  findDuplicateCodes,
  findReferenceProblems,
  formatCycle,
  isAcyclic,
  leafCodes,
  pruneInvalidReferences,
  rootCodes,
  toEdges,
  topologicalSort,
} from './dag';
export type {
  BrokenEdge,
  CriticalPath,
  CycleBreakResult,
  DagEdge,
  DagNode,
  DagStats,
  ReferenceProblem,
  TopologicalResult,
} from './dag';

// --- Contrato del plan ---------------------------------------------------------------
export {
  AcceptanceCriterionSchema,
  BUDGET_SHARE_TOLERANCE,
  MAX_TASKS,
  MIN_TASKS,
  PlanTaskSchema,
  ProjectPlanSchema,
  ProjectPlanShapeSchema,
  SKILL_SLUG_RE,
  TASK_CODE_RE,
} from './schemas';
export type {
  AcceptanceCriterion,
  PlanTask,
  ProjectPlan,
  ProjectPlanShape,
} from './schemas';

// --- Prompts y presupuesto -----------------------------------------------------------
export { PLANNER_SYSTEM_PROMPT, renderGraphHintPrompt, renderPlannerPrompt } from './prompts';
export type { PlannerPromptInput, SkillCatalogEntry } from './prompts';
export { allocateBudget, normalizeShares } from './budget';
export type { BudgetAllocation, BudgetSlice } from './budget';

// --- Repositorio ---------------------------------------------------------------------
export { PlannerRepositoryError, PostgresPlannerRepository } from './repository';
export type {
  ApplyPlanResult,
  CreateProjectInput,
  PersistableEdge,
  PersistableTask,
  PlannerRepository,
  ProjectRecord,
  TaskEmbedding,
} from './repository';

/**
 * Construye un planificador listo para usar.
 * Sin `repository` se usa PostgreSQL como dueño de las tablas, que es la identidad con la
 * que corren los agentes autónomos.
 */
export function createProjectPlanner(
  options: Partial<ProjectPlannerOptions> = {},
): ProjectPlanner {
  const repository = options.repository ?? new PostgresPlannerRepository(getDb());
  return new ProjectPlanner({
    repository,
    ...(options.ai === undefined ? {} : { ai: options.ai }),
    ...(options.embeddings === undefined ? {} : { embeddings: options.embeddings }),
  });
}
