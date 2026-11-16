/**
 * VEKTORA · FASE 5 — Orquestación del AI Judge.
 *
 * Entregable -> veredicto persistido, reseña, reputación y tarea avanzada, sin intervención
 * humana:
 *
 *   1. Tomar el turno (la base lo hace atómico: dos jueces no pueden juzgar lo mismo).
 *   2. Leer los criterios de aceptación de la tarea.
 *   3. Si no hay nada que evaluar, resolver sin gastar una llamada al modelo.
 *   4. Pedir al modelo un veredicto POR CRITERIO, validado con Zod y auto-reparado.
 *   5. Calcular el veredicto global con la política pura.
 *   6. Escribirlo todo en una transacción; al aprobar, el trigger de la 0002 desbloquea
 *      las tareas que dependían de esta.
 *
 * El modo de fallo que este archivo existe para evitar: que un problema NUESTRO —modelo
 * caído, cuota agotada, esquema degradado— se convierta en un rechazo. Si la IA no
 * responde, el entregable vuelve a `error`, que es un estado desde el que la RLS permite al
 * proveedor reintentar. Rechazar ahí sería cobrarle a otro nuestra avería.
 */

import { DominioError } from '@/lib/errores';
import { AiError, AiExhaustedError, errorMessage, getAiClient, type AiClient } from '@/lib/ai';
import { getQaConfig, type QaConfig } from './config';
import {
  debeDarsePorNoEvaluable,
  decideEmptySubmission,
  decideVerdict,
  describeDecision,
  esFalloDelEntregable,
  hasSubmittedEvidence,
  type QaDecision,
} from './policy';
import {
  QaRepositoryError,
  type ApplyVerdictResult,
  type QaClaim,
  type QaGiveUpResult,
  type QaRepository,
  type QaReleaseStatus,
} from './repository';
import { buildQaVerdictSchema, parseAcceptanceCriteria, type StoredCriterion } from './schemas';
import { QA_SYSTEM_PROMPT, renderJudgePrompt } from './prompts';

export class QaError extends DominioError {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

export interface JudgeInput {
  deliverableId: string;
  /** Calcula el veredicto sin escribirlo y devuelve el entregable a su estado anterior. */
  dryRun?: boolean;
}

export interface JudgeResult {
  deliverableId: string;
  judged: boolean;
  /** Motivo por el que no se juzgó: turno no tomado, IA agotada, veredicto pisado. */
  reason: string | null;
  claim: QaClaim | null;
  criteria: StoredCriterion[];
  /** Criterios almacenados que no se pudieron interpretar. */
  malformedCriteria: number;
  decision: QaDecision | null;
  /** true si se resolvió sin llamar al modelo (entregable vacío o tarea sin criterios). */
  skippedAi: boolean;
  runId: string | null;
  provider: string | null;
  model: string | null;
  repairs: number;
  costUsd: number;
  latencyMs: number;
  applied: ApplyVerdictResult | null;
  dryRun: boolean;
  /** Si el juez dio la versión por no evaluable (devuelta, o tarea de vuelta al mercado). */
  givenUp: QaGiveUpResult | null;
}

export interface QaJudgeOptions {
  repository: QaRepository;
  ai?: AiClient;
  config?: QaConfig;
}

export class QaJudge {
  private readonly repository: QaRepository;
  private readonly config: QaConfig;
  private aiClient: AiClient | null;

  constructor(options: QaJudgeOptions) {
    this.repository = options.repository;
    this.config = options.config ?? getQaConfig();
    this.aiClient = options.ai ?? null;
  }

  private get ai(): AiClient {
    if (this.aiClient === null) this.aiClient = getAiClient();
    return this.aiClient;
  }

  async judge(input: JudgeInput): Promise<JudgeResult> {
    const dryRun = input.dryRun === true;
    const base = emptyResult(input.deliverableId, dryRun, null);

    const claimed = await this.repository.claim(input.deliverableId);
    if (!claimed.claimed || claimed.claim === null) {
      return { ...base, reason: claimed.reason ?? 'no se pudo tomar el entregable' };
    }

    const claim = claimed.claim;
    // A partir de aquí el entregable está en `running`: TODO camino de salida tiene que
    // resolverlo o soltarlo, o se queda bloqueado para siempre y ningún juez lo recogerá.
    const restore = claim.previousStatus as QaReleaseStatus;

    // Un juicio que muere SIEMPRE en este entregable nunca llega a soltar el turno: solo la
    // toma que lo retoma puede contarlo y, llegado el máximo, darle salida.
    if (
      !dryRun &&
      claim.reclaimed &&
      debeDarsePorNoEvaluable(claim.qaUnjudgeable, this.config)
    ) {
      const salida = await this.safeGiveUp(input.deliverableId);
      if (salida?.givenUp === true) {
        return { ...base, claim, givenUp: salida, reason: describirSalida(salida) };
      }
      // Sin evidencia de que el juez funciona: se intenta juzgar igual, como un reintento más.
    }

    try {
      const parsed = parseAcceptanceCriteria(claim.task.acceptanceCriteria);
      const withClaim: JudgeResult = {
        ...base,
        claim,
        criteria: parsed.criteria,
        malformedCriteria: parsed.malformed,
      };

      // --- Caminos que no necesitan modelo ------------------------------------------------
      if (!hasSubmittedEvidence(claim.deliverable)) {
        const decision = decideEmptySubmission(this.config, claim.deliverable.attempt);
        return await this.finish({ ...withClaim, decision, skippedAi: true }, restore, dryRun);
      }

      if (parsed.criteria.length === 0) {
        // Sin criterios no hay nada contra lo que contrastar. Aprobar por defecto sería la
        // peor opción posible: cualquiera podría cobrar entregando cualquier cosa.
        const decision = decideVerdict({
          criteria: [],
          verdicts: [],
          attempt: claim.deliverable.attempt,
          summary:
            'La tarea no tiene criterios de aceptación interpretables, así que no hay nada ' +
            'contra lo que evaluar el entregable. Hay que definirlos antes de poder aceptarlo.',
          blockingIssues: ['La tarea no declara criterios de aceptación válidos.'],
          config: this.config,
        });
        return await this.finish({ ...withClaim, decision, skippedAi: true }, restore, dryRun);
      }

      // --- Veredicto del modelo -----------------------------------------------------------
      const schema = buildQaVerdictSchema(parsed.criteria.map((criterion) => criterion.id));

      let response;
      try {
        response = await this.ai.generateStructured({
          operation: 'qa_judge',
          schema,
          schemaName: 'QaVerdict',
          system: QA_SYSTEM_PROMPT,
          prompt: renderJudgePrompt({
            projectTitle: claim.project.title,
            projectObjective: claim.project.objective,
            taskCode: claim.task.code,
            taskTitle: claim.task.title,
            taskDescription: claim.task.description,
            criteria: parsed.criteria,
            deliverableSummary: claim.deliverable.summary,
            deliverableContent: claim.deliverable.content,
            artifacts: claim.deliverable.artifacts,
            evidence: claim.deliverable.evidence,
          }),
          context: {
            projectId: claim.task.projectId,
            taskId: claim.task.id,
            userId: claim.deliverable.providerId,
          },
          temperature: 0,
          maxOutputTokens: this.config.maxOutputTokens,
        });
      } catch (error) {
        // Nunca un veredicto contra el proveedor: se suelta como `error`, contando el fallo, y
        // la cola lo reintenta más tarde. Si el fallo es del entregable y ya van demasiados,
        // se le da salida (sin reseña ni reputación).
        const detail = errorMessage(error);
        const salida = await this.safeFail(input.deliverableId, error, restore, dryRun);
        return {
          ...withClaim,
          givenUp: salida,
          reason:
            salida?.givenUp === true
              ? `${describirSalida(salida)} (último fallo: ${detail})`
              : `el juez no pudo evaluar: ${detail}`,
        };
      }

      const decision = decideVerdict({
        criteria: parsed.criteria,
        verdicts: response.data.criteria,
        attempt: claim.deliverable.attempt,
        summary: response.data.summary,
        blockingIssues: response.data.blockingIssues,
        config: this.config,
      });

      return await this.finish(
        {
          ...withClaim,
          decision,
          runId: response.runId,
          provider: response.provider,
          model: response.model,
          repairs: response.repairs,
          costUsd: response.costUsd,
          latencyMs: response.latencyMs,
        },
        restore,
        dryRun,
      );
    } catch (error) {
      // Cualquier fallo inesperado deja igualmente el entregable reintentable.
      await this.safeFail(input.deliverableId, error, restore, dryRun);
      if (error instanceof QaRepositoryError) throw error;
      throw new QaError(`VEKTORA/QA: el juicio falló -> ${errorMessage(error)}`, error);
    }
  }

  /** Escribe el veredicto, o lo deshace si es un ensayo. */
  private async finish(
    result: JudgeResult,
    restore: QaReleaseStatus,
    dryRun: boolean,
  ): Promise<JudgeResult> {
    const decision = result.decision;
    if (decision === null) {
      await this.safeRelease(result.deliverableId, restore, null);
      return { ...result, reason: 'no se pudo construir un veredicto' };
    }

    if (dryRun) {
      await this.safeRelease(result.deliverableId, restore, null);
      return { ...result, judged: true, reason: 'ensayo: no se escribió nada' };
    }

    const applied = await this.repository.applyVerdict({
      deliverableId: result.deliverableId,
      qaStatus: decision.qaStatus,
      taskStatus: decision.taskStatus,
      score: decision.score,
      rating: decision.rating,
      qualityScore: decision.rating,
      feedback: {
        engine: decision.explanation.engine,
        summary: decision.explanation.summary,
        blockingIssues: decision.explanation.blockingIssues,
        thresholds: decision.explanation.thresholds,
        counts: decision.explanation.counts,
        downgraded: decision.explanation.downgraded,
        attempt: decision.explanation.attempt,
        escalated: decision.explanation.escalated,
        skippedAi: result.skippedAi,
        malformedCriteria: result.malformedCriteria,
      },
      criteriaResults: decision.criteria,
      runId: result.runId,
      comment: describeDecision(decision),
      reputation: decision.reputation,
    });

    return {
      ...result,
      judged: applied.applied,
      reason: applied.applied ? null : applied.reason,
      applied,
    };
  }

  /**
   * Soltar el turno no puede tumbar el juicio.
   *
   * Si la base tampoco responde aquí, lo que importa es no perder el error ORIGINAL, que es
   * el que explica por qué se estaba soltando.
   */
  private async safeRelease(
    deliverableId: string,
    status: QaReleaseStatus,
    detail: string | null,
  ): Promise<void> {
    try {
      await this.repository.release(deliverableId, status, detail);
    } catch (error) {
      console.warn(
        `VEKTORA/QA: no se pudo devolver el turno de ${deliverableId} -> ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Suelta el turno de un juicio que no terminó. Fuera de un ensayo cuenta como fallo (la
   * cola lo hará esperar) y, si el fallo es del entregable y llegó al máximo, intenta darle
   * salida. En un ensayo se devuelve al estado anterior: un ensayo no escribe nada, tampoco
   * un fallo ni una salida.
   */
  private async safeFail(
    deliverableId: string,
    error: unknown,
    restore: QaReleaseStatus,
    dryRun: boolean,
  ): Promise<QaGiveUpResult | null> {
    if (dryRun) {
      await this.safeRelease(deliverableId, restore, null);
      return null;
    }
    const code = codigoDeFallo(error);
    const unjudgeable = esFalloDelEntregable(code);
    try {
      const fallo = await this.repository.fail(deliverableId, {
        error: errorMessage(error),
        code,
        unjudgeable,
      });
      if (fallo.released && unjudgeable && debeDarsePorNoEvaluable(fallo.unjudgeableCount, this.config)) {
        return await this.safeGiveUp(deliverableId);
      }
    } catch (causa) {
      console.warn(
        `VEKTORA/QA: no se pudo devolver el turno de ${deliverableId} -> ${errorMessage(causa)}`,
      );
    }
    return null;
  }

  /**
   * Da la versión por no evaluable. Si la base no responde, no pasa nada grave: el
   * entregable sigue en `error` y el próximo fallo lo vuelve a intentar.
   */
  private async safeGiveUp(deliverableId: string): Promise<QaGiveUpResult | null> {
    try {
      return await this.repository.giveUp(deliverableId, this.config.unjudgeable.waiverHours);
    } catch (causa) {
      console.warn(
        `VEKTORA/QA: no se pudo dar por no evaluable ${deliverableId} -> ${errorMessage(causa)}`,
      );
      return null;
    }
  }

  /** Cola de entregables pendientes: los que menos fallaron primero, y después los más antiguos. */
  async queue(limit?: number): Promise<Awaited<ReturnType<QaRepository['pending']>>> {
    return this.repository.pending(limit ?? this.config.queueLimit);
  }

  /**
   * Juzga la cola entera. Un fallo en uno no detiene a los demás: `judge` ya soltó su turno
   * antes de lanzar, así que aquí solo queda anotarlo y seguir. Sin esto, un error de la base
   * a mitad de la corrida dejaba sin juzgar todo lo que venía detrás y el disparador
   * respondía 500.
   */
  async judgeQueue(limit?: number, dryRun = false): Promise<JudgeResult[]> {
    const pending = await this.queue(limit);
    const results: JudgeResult[] = [];
    for (const entry of pending) {
      try {
        results.push(await this.judge({ deliverableId: entry.deliverableId, dryRun }));
      } catch (error) {
        results.push(emptyResult(entry.deliverableId, dryRun, `el juicio falló: ${errorMessage(error)}`));
      }
    }
    return results;
  }
}

/** Resultado sin juicio: el punto de partida de `judge` y lo que queda de uno que lanzó. */
function emptyResult(deliverableId: string, dryRun: boolean, reason: string | null): JudgeResult {
  return {
    deliverableId,
    judged: false,
    reason,
    claim: null,
    criteria: [],
    malformedCriteria: 0,
    decision: null,
    skippedAi: false,
    runId: null,
    provider: null,
    model: null,
    repairs: 0,
    costUsd: 0,
    latencyMs: 0,
    applied: null,
    dryRun,
    givenUp: null,
  };
}

/** Una línea para la traza y la respuesta del disparador. */
function describirSalida(salida: QaGiveUpResult): string {
  return salida.action === 'failed'
    ? 'no evaluable por segunda vez: la tarea vuelve al mercado, sin multa'
    : 'no evaluable: la versión vuelve al proveedor, sin multa y sin contar como intento';
}

/**
 * Causa de un fallo del juez, para guardarla con el entregable.
 *
 * De la cadena agotada se toma el ÚLTIMO intento, no `exhausted`: «se agotó» no dice si fue
 * cuota, salida inválida o un bloqueo. Sin proveedores configurados no hay intentos y la
 * causa es `not_configured`. Distinguir una avería nuestra (cuota, red, base) de un
 * entregable que no se puede juzgar es lo que hará falta para decidir qué hacer con uno que
 * falla para siempre.
 */
export function codigoDeFallo(error: unknown): string {
  if (error instanceof AiExhaustedError) return error.lastFailure?.code ?? 'not_configured';
  if (error instanceof AiError) return error.code;
  if (error instanceof QaRepositoryError) return 'database';
  return 'unexpected';
}
