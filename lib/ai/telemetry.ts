/**
 * VEKTORA · FASE 2 — Telemetría de corridas de IA sobre la tabla `ai_runs`.
 *
 * Contrato: la telemetría NUNCA puede tumbar la operación de negocio. Todo fallo de
 * escritura se captura y se degrada a `null`. `start()` inserta la fila en estado
 * `pending` y `finish()` la cierra; así una corrida que se cuelga queda visible como
 * `pending` con `finished_at` nulo, que es precisamente la señal útil en la FASE 7.
 */

import { json, type Consultor } from '@/lib/db';
import type { AiConfig } from './config';
import { isTelemetryConfigured } from './config';
import type { FlatZodIssue } from './errors';
import { truncateForLog } from './json';
import type {
  AiContext,
  AiOperation,
  AiProviderId,
  AiRunStatus,
  TokenUsage,
} from './types';

export interface RunStart {
  operation: AiOperation;
  provider: AiProviderId;
  model: string;
  attempt: number;
  fellBackFrom?: AiProviderId | null;
  parentRunId?: string | null;
  context?: AiContext | undefined;
  requestPayload?: unknown;
}

export interface RunFinish {
  status: AiRunStatus;
  usage?: TokenUsage | undefined;
  latencyMs?: number | undefined;
  costUsd?: number | undefined;
  responsePayload?: unknown;
  zodErrors?: FlatZodIssue[] | undefined;
  errorMessage?: string | undefined;
}

export interface TelemetrySink {
  start(run: RunStart): Promise<string | null>;
  finish(runId: string | null, patch: RunFinish): Promise<void>;
}

/** Sin telemetría (entorno local sin base de datos). */
export class NullTelemetrySink implements TelemetrySink {
  async start(): Promise<string | null> {
    return null;
  }

  async finish(): Promise<void> {
    /* no-op */
  }
}

export interface RecordedRun extends RunStart {
  id: string;
  status: AiRunStatus;
  finish?: RunFinish;
}

/** En memoria: útil en pruebas y para inspeccionar la cadena de fallback en local. */
export class InMemoryTelemetrySink implements TelemetrySink {
  readonly runs: RecordedRun[] = [];
  private sequence = 0;

  async start(run: RunStart): Promise<string | null> {
    this.sequence += 1;
    const id = `run_${this.sequence}`;
    this.runs.push({ ...run, id, status: 'pending' });
    return id;
  }

  async finish(runId: string | null, patch: RunFinish): Promise<void> {
    if (runId === null) return;
    const found = this.runs.find((run) => run.id === runId);
    if (found === undefined) return;
    found.status = patch.status;
    found.finish = patch;
  }

  reset(): void {
    this.runs.length = 0;
    this.sequence = 0;
  }
}

function sanitizePayload(
  payload: unknown,
  logPayloads: boolean,
  maxChars: number,
): Record<string, unknown> {
  if (!logPayloads || payload === undefined || payload === null) return {};
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) return {};
    if (serialized.length <= maxChars) return JSON.parse(serialized) as Record<string, unknown>;
    return { truncated: true, preview: truncateForLog(serialized, maxChars) };
  } catch {
    return { unserializable: true };
  }
}

/**
 * Persiste en `public.ai_runs` como dueño de las tablas (la identidad de los agentes).
 * Es la tercera implementación de `TelemetrySink` junto con `NullTelemetrySink` y
 * `InMemoryTelemetrySink`: el cliente de IA no sabe cuál recibe (polimorfismo, R5).
 */
export class PostgresTelemetrySink implements TelemetrySink {
  constructor(
    private readonly db: Consultor,
    private readonly logPayloads: boolean,
    private readonly maxChars: number,
  ) {}

  async start(run: RunStart): Promise<string | null> {
    try {
      const fila = await this.db.one<{ id: string }>(
        `insert into public.ai_runs
           (operation, provider, model, status, attempt, fell_back_from, parent_run_id,
            user_id, project_id, task_id, request_payload)
         values ($1::public.ai_operation, $2::public.ai_provider, $3, 'pending', $4,
                 $5::public.ai_provider, $6, $7, $8, $9, $10::jsonb)
         returning id`,
        [
          run.operation,
          run.provider,
          run.model,
          run.attempt,
          run.fellBackFrom ?? null,
          run.parentRunId ?? null,
          run.context?.userId ?? null,
          run.context?.projectId ?? null,
          run.context?.taskId ?? null,
          json(sanitizePayload(run.requestPayload, this.logPayloads, this.maxChars)),
        ],
      );
      return fila?.id ?? null;
    } catch (error) {
      reportTelemetryFailure('start', error);
      return null;
    }
  }

  async finish(runId: string | null, patch: RunFinish): Promise<void> {
    if (runId === null) return;
    try {
      await this.db.execute(
        `update public.ai_runs
            set status = $2::public.ai_run_status,
                prompt_tokens = $3, completion_tokens = $4, total_tokens = $5,
                latency_ms = $6, cost_usd = $7, response_payload = $8::jsonb,
                zod_errors = $9::jsonb, error_message = $10, finished_at = now()
          where id = $1`,
        [
          runId,
          patch.status,
          patch.usage?.promptTokens ?? null,
          patch.usage?.completionTokens ?? null,
          patch.usage?.totalTokens ?? null,
          patch.latencyMs ?? null,
          patch.costUsd ?? 0,
          json(sanitizePayload(patch.responsePayload, this.logPayloads, this.maxChars)),
          patch.zodErrors === undefined ? null : json(patch.zodErrors),
          patch.errorMessage ?? null,
        ],
      );
    } catch (error) {
      reportTelemetryFailure('finish', error);
    }
  }
}

function reportTelemetryFailure(stage: 'start' | 'finish', detail: unknown): void {
  const message = detail instanceof Error ? detail.message : String(detail);
  // No se relanza: la telemetría es best-effort.
  console.warn(`[vektora/ai] telemetría ${stage} falló: ${message}`);
}

export interface BuildTelemetryOptions {
  db?: Consultor | undefined;
}

export function buildTelemetrySink(
  config: AiConfig,
  options: BuildTelemetryOptions = {},
): TelemetrySink {
  if (options.db !== undefined) {
    return new PostgresTelemetrySink(
      options.db,
      config.AI_LOG_PAYLOADS,
      config.AI_LOG_PAYLOAD_MAX_CHARS,
    );
  }
  if (!isTelemetryConfigured(config)) return new NullTelemetrySink();
  return new LazyPostgresTelemetrySink(config);
}

/**
 * Retrasa la conexión hasta la primera escritura, para que importar la capa de IA no exija
 * una base de datos (las pruebas y `next build` no la tienen).
 */
class LazyPostgresTelemetrySink implements TelemetrySink {
  private delegate: TelemetrySink | null = null;

  constructor(private readonly config: AiConfig) {}

  private async resolve(): Promise<TelemetrySink> {
    if (this.delegate !== null) return this.delegate;
    try {
      const { getDb } = await import('@/lib/db');
      this.delegate = new PostgresTelemetrySink(
        getDb(),
        this.config.AI_LOG_PAYLOADS,
        this.config.AI_LOG_PAYLOAD_MAX_CHARS,
      );
    } catch (error) {
      reportTelemetryFailure('start', error);
      this.delegate = new NullTelemetrySink();
    }
    return this.delegate;
  }

  async start(run: RunStart): Promise<string | null> {
    return (await this.resolve()).start(run);
  }

  async finish(runId: string | null, patch: RunFinish): Promise<void> {
    return (await this.resolve()).finish(runId, patch);
  }
}
