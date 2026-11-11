/**
 * VEKTORA · FASE 5 — API pública del AI Judge.
 *
 *   import { createQaJudge } from '@/lib/qa';
 *
 *   const result = await createQaJudge().judge({ deliverableId });
 *   result.decision?.qaStatus        // 'approved' | 'rejected' | 'revision_requested'
 *   result.decision?.explanation.summary
 */

import { getDb } from '@/lib/db';
import { QaJudge, type QaJudgeOptions } from './judge';
import { PostgresQaRepository } from './repository';

export { QaError, QaJudge } from './judge';
export type { JudgeInput, JudgeResult, QaJudgeOptions } from './judge';

export {
  decideEmptySubmission,
  decideVerdict,
  describeDecision,
  ENGINE_VERSION,
  hasSubmittedEvidence,
} from './policy';
export type {
  CriterionOutcome,
  CriterionResult,
  DecideInput,
  QaDecision,
  QaExplanation,
  QaOutcome,
  ReputationDelta,
  SubmissionShape,
  TaskOutcome,
} from './policy';

export { QaRepositoryError, PostgresQaRepository } from './repository';
export type {
  ApplyVerdictInput,
  ApplyVerdictResult,
  PendingDeliverable,
  QaClaim,
  QaClaimResult,
  QaReleaseStatus,
  QaRepository,
} from './repository';

export {
  buildQaVerdictSchema,
  CriterionVerdictSchema,
  parseAcceptanceCriteria,
  StoredCriterionSchema,
} from './schemas';
export type { CriterionVerdict, ParsedCriteria, QaVerdict, StoredCriterion } from './schemas';

export { QA_SYSTEM_PROMPT, renderJudgePrompt } from './prompts';
export type { JudgeContext } from './prompts';

export { getQaConfig, loadQaConfig, QaConfigError, QaConfigSchema, resetQaConfigCache } from './config';
export type { QaConfig, QaEnv } from './config';

/** Juez listo para usar contra PostgreSQL con la identidad de los agentes. */
export function createQaJudge(options: Partial<QaJudgeOptions> = {}): QaJudge {
  const repository = options.repository ?? new PostgresQaRepository(getDb());
  return new QaJudge({
    repository,
    ...(options.ai === undefined ? {} : { ai: options.ai }),
    ...(options.config === undefined ? {} : { config: options.config }),
  });
}
