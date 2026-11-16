/**
 * VEKTORA · FASE 4 — API pública del motor de matching híbrido.
 *
 *   import { createTaskMatcher } from '@/lib/matching';
 *
 *   const result = await createTaskMatcher().matchTask({ taskId, assign: true });
 *   result.shortlist[0]?.explanation.summary
 */

import { getDb } from '@/lib/db';
import { TaskMatcher, type TaskMatcherOptions } from './matcher';
import { PostgresMatchingRepository } from './repository';
import { PostgresWatchdogRepository, TaskWatchdog, type TaskWatchdogOptions } from './watchdog';

export { MatchingError, TaskMatcher, renderTaskForMatching } from './matcher';
export type { MatchTaskInput, MatchTaskResult, TaskMatcherOptions } from './matcher';

export { MatchingRepositoryError, PostgresMatchingRepository } from './repository';
export type {
  AcceptResult,
  ApplyMatchesResult,
  MatchingRepository,
  MatchTaskRecord,
} from './repository';

export {
  ENGINE_VERSION,
  rankCandidates,
  rescaleVectorSimilarity,
  scoreCandidate,
  scoreReputation,
  scoreSkills,
} from './scoring';
export type {
  CandidateSkill,
  MatchCandidate,
  MatchExplanation,
  MatchTaskContext,
  RankingResult,
  RejectedCandidate,
  ReputationBreakdown,
  ScoredCandidate,
  SkillBreakdown,
} from './scoring';

export {
  getMatchingConfig,
  loadMatchingConfig,
  MatchingConfigError,
  MatchingConfigSchema,
  resetMatchingConfigCache,
} from './config';
export type { MatchingConfig, MatchingEnv } from './config';

export { deliveryWindowHours } from './deadlines';
export { PostgresWatchdogRepository, TaskWatchdog } from './watchdog';
export type {
  RecoveryAction,
  RecoveryResult,
  SweepResult,
  TaskCheck,
  TaskWatchdogOptions,
  WatchdogRepository,
  WatchedTask,
} from './watchdog';

/** Motor listo para usar contra PostgreSQL con la identidad de los agentes. */
export function createTaskMatcher(options: Partial<TaskMatcherOptions> = {}): TaskMatcher {
  const repository = options.repository ?? new PostgresMatchingRepository(getDb());
  return new TaskMatcher({
    repository,
    ...(options.embeddings === undefined ? {} : { embeddings: options.embeddings }),
    ...(options.config === undefined ? {} : { config: options.config }),
  });
}

/** Vigilante de tareas adjudicadas, listo para usar con la identidad de los agentes. */
export function createTaskWatchdog(options: Partial<TaskWatchdogOptions> = {}): TaskWatchdog {
  return new TaskWatchdog({
    repository: options.repository ?? new PostgresWatchdogRepository(getDb()),
    ...(options.config === undefined ? {} : { config: options.config }),
  });
}
