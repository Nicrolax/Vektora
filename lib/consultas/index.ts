/**
 * VEKTORA — Consultas de lectura de la interfaz (capa DAO de solo lectura).
 *
 * TODAS corren con `getDb().asUser(userId, …)`: `auth.uid()` vale el id de la persona y
 * las políticas RLS deciden qué filas ve. Si una consulta no devuelve un proyecto es porque
 * la base no deja verlo, no porque el código se haya acordado de filtrar por dueño. Esa es
 * la frontera de seguridad, y está en la base.
 *
 * Todas son parametrizadas (R9). Acá viven también la búsqueda con filtros y el reporte
 * con agregaciones que pide R6.
 */

import { getDb, type Consultor, type Db } from '@/lib/db';
import { toNumber, type PgNumeric } from '@/lib/db/types';

export { buscarTareas, normalizarFiltros, ESTADOS_BUSCABLES } from './busqueda';
export type { FiltrosBusqueda, ResultadoBusqueda, TareaEncontrada } from './busqueda';
export { reporteGeneral } from './reporte';
export type { FilaReporteEstado, FilaReporteProveedor, FilaReporteProyecto, Reporte } from './reporte';

function leer<T>(userId: string, fn: (tx: Consultor) => Promise<T>, db: Db = getDb()): Promise<T> {
  return db.asUser(userId, fn);
}

// --- Panel del cliente ------------------------------------------------------------------

export interface ProyectoResumen {
  id: string;
  title: string;
  objective: string;
  status: string;
  visibility: string;
  budgetTotal: number | null;
  currency: string;
  createdAt: string;
  totalTareas: number;
  aprobadas: number;
  esMio: boolean;
}

export async function listarMisProyectos(userId: string): Promise<ProyectoResumen[]> {
  const filas = await leer(userId, (tx) =>
    tx.query<{
      id: string;
      title: string;
      objective: string;
      status: string;
      visibility: string;
      budget_total: PgNumeric | null;
      currency: string;
      created_at: string;
      total: number;
      aprobadas: number;
      es_mio: boolean;
    }>(
      // LEFT JOIN + GROUP BY: un proyecto sin tareas también aparece, con 0.
      `select p.id, p.title, p.objective, p.status, p.visibility, p.budget_total, p.currency,
              p.created_at,
              count(t.id) as total,
              count(t.id) filter (where t.status = 'approved') as aprobadas,
              (p.owner_id = auth.uid()) as es_mio
         from public.projects p
         left join public.project_tasks t on t.project_id = p.id
        where p.owner_id = auth.uid()
        group by p.id
        order by p.created_at desc`,
    ),
  );
  return filas.map((fila) => ({
    id: fila.id,
    title: fila.title,
    objective: fila.objective,
    status: fila.status,
    visibility: fila.visibility,
    budgetTotal: toNumber(fila.budget_total),
    currency: fila.currency,
    createdAt: fila.created_at,
    totalTareas: fila.total,
    aprobadas: fila.aprobadas,
    esMio: fila.es_mio,
  }));
}

// --- Detalle de proyecto ----------------------------------------------------------------

export interface ProyectoDetalle {
  id: string;
  ownerId: string;
  title: string;
  objective: string;
  description: string | null;
  status: string;
  visibility: string;
  budgetTotal: number | null;
  currency: string;
  esMio: boolean;
}

export interface TareaDelProyecto {
  id: string;
  code: string;
  title: string;
  status: string;
  budget: number | null;
  assigneeId: string | null;
  dependsOn: string[];
}

export async function obtenerProyecto(
  userId: string,
  projectId: string,
): Promise<{ proyecto: ProyectoDetalle; tareas: TareaDelProyecto[] } | null> {
  return leer(userId, async (tx) => {
    const proyecto = await tx.one<{
      id: string;
      owner_id: string;
      title: string;
      objective: string;
      description: string | null;
      status: string;
      visibility: string;
      budget_total: PgNumeric | null;
      currency: string;
    }>(
      `select id, owner_id, title, objective, description, status, visibility, budget_total, currency
         from public.projects where id = $1`,
      [projectId],
    );
    // Sin fila: no existe o RLS no deja verlo. La interfaz responde igual en los dos casos.
    if (proyecto === null) return null;

    // Las dependencias se traen ya traducidas a código con un JOIN a la tarea de origen.
    const tareas = await tx.query<{
      id: string;
      code: string;
      title: string;
      status: string;
      budget: PgNumeric | null;
      assignee_id: string | null;
      depende_de: string[] | null;
    }>(
      `select t.id, t.code, t.title, t.status, t.budget, t.assignee_id,
              array_remove(array_agg(origen.code order by origen.code), null) as depende_de
         from public.project_tasks t
         left join public.task_dependencies d on d.task_id = t.id
         left join public.project_tasks origen on origen.id = d.depends_on_task_id
        where t.project_id = $1
        group by t.id
        order by t.order_index, t.code`,
      [projectId],
    );

    return {
      proyecto: {
        id: proyecto.id,
        ownerId: proyecto.owner_id,
        title: proyecto.title,
        objective: proyecto.objective,
        description: proyecto.description,
        status: proyecto.status,
        visibility: proyecto.visibility,
        budgetTotal: toNumber(proyecto.budget_total),
        currency: proyecto.currency,
        esMio: proyecto.owner_id === userId,
      },
      tareas: tareas.map((fila) => ({
        id: fila.id,
        code: fila.code,
        title: fila.title,
        status: fila.status,
        budget: toNumber(fila.budget),
        assigneeId: fila.assignee_id,
        dependsOn: fila.depende_de ?? [],
      })),
    };
  });
}

/** Firma del estado de las tareas: la vista la sondea para saber si tiene que refrescar. */
export async function firmaDelProyecto(userId: string, projectId: string): Promise<string | null> {
  const fila = await leer(userId, (tx) =>
    tx.one<{ firma: string | null; visible: boolean }>(
      `select exists(select 1 from public.projects where id = $1) as visible,
              (select string_agg(t.id::text || ':' || t.status || ':' || coalesce(t.assignee_id::text, ''),
                                 ',' order by t.id)
                 from public.project_tasks t where t.project_id = $1) as firma`,
      [projectId],
    ),
  );
  if (fila === null || !fila.visible) return null;
  return fila.firma ?? '';
}

// --- Detalle de tarea -------------------------------------------------------------------

export interface Criterio {
  id: string;
  criterion: string;
  verification?: string;
}

export interface TareaDetalle {
  id: string;
  projectId: string;
  projectTitle: string;
  projectObjective: string;
  code: string;
  title: string;
  description: string | null;
  acceptanceCriteria: Criterio[];
  requiredSkills: string[];
  status: string;
  budget: number | null;
  estimatedHours: number | null;
  assigneeId: string | null;
  assigneeNombre: string | null;
}

export interface CandidaturaVista {
  id: string;
  providerId: string;
  proveedor: string | null;
  status: string;
  matchScore: number | null;
  vectorScore: number | null;
  skillScore: number | null;
  reputationScore: number | null;
  resumen: string | null;
}

export interface CriterioEvaluado {
  id: string;
  outcome: string;
  reported: string;
  confidence: number;
  evidence: string;
  reasoning: string;
  downgraded: boolean;
}

export interface EntregableVista {
  id: string;
  version: number;
  summary: string | null;
  qaStatus: string;
  qaScore: number | null;
  qaResumen: string | null;
  criterios: CriterioEvaluado[];
  submittedAt: string;
  qaEvaluatedAt: string | null;
}

function criteriosDe(valor: unknown): Criterio[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((entrada) => {
    if (typeof entrada !== 'object' || entrada === null) return [];
    const { id, criterion, verification } = entrada as Record<string, unknown>;
    if (typeof id !== 'string' || typeof criterion !== 'string') return [];
    return [typeof verification === 'string' ? { id, criterion, verification } : { id, criterion }];
  });
}

function evaluadosDe(valor: unknown): CriterioEvaluado[] {
  if (!Array.isArray(valor)) return [];
  return valor.flatMap((entrada) => {
    if (typeof entrada !== 'object' || entrada === null) return [];
    const r = entrada as Record<string, unknown>;
    if (typeof r['id'] !== 'string') return [];
    return [
      {
        id: r['id'],
        outcome: String(r['outcome'] ?? ''),
        reported: String(r['reported'] ?? ''),
        confidence: Number(r['confidence'] ?? 0),
        evidence: String(r['evidence'] ?? ''),
        reasoning: String(r['reasoning'] ?? ''),
        downgraded: r['downgraded'] === true,
      },
    ];
  });
}

export async function obtenerTarea(
  userId: string,
  taskId: string,
): Promise<{ tarea: TareaDetalle; candidaturas: CandidaturaVista[]; entregables: EntregableVista[] } | null> {
  return leer(userId, async (tx) => {
    const fila = await tx.one<{
      id: string;
      project_id: string;
      project_title: string;
      project_objective: string;
      code: string;
      title: string;
      description: string | null;
      acceptance_criteria: unknown;
      required_skills: string[] | null;
      status: string;
      budget: PgNumeric | null;
      estimated_hours: PgNumeric | null;
      assignee_id: string | null;
      assignee_nombre: string | null;
    }>(
      `select t.id, t.project_id, p.title as project_title, p.objective as project_objective,
              t.code, t.title, t.description, t.acceptance_criteria, t.required_skills, t.status,
              t.budget, t.estimated_hours, t.assignee_id,
              coalesce(pr.display_name, pr.full_name) as assignee_nombre
         from public.project_tasks t
         join public.projects p on p.id = t.project_id
         left join public.profiles pr on pr.user_id = t.assignee_id
        where t.id = $1`,
      [taskId],
    );
    if (fila === null) return null;

    const candidaturas = await tx.query<{
      id: string;
      provider_id: string;
      proveedor: string | null;
      status: string;
      match_score: PgNumeric | null;
      vector_score: PgNumeric | null;
      skill_score: PgNumeric | null;
      reputation_score: PgNumeric | null;
      resumen: string | null;
    }>(
      `select a.id, a.provider_id, coalesce(pr.display_name, pr.full_name) as proveedor, a.status,
              a.match_score, a.vector_score, a.skill_score, a.reputation_score,
              a.match_explanation ->> 'summary' as resumen
         from public.task_applications a
         left join public.profiles pr on pr.user_id = a.provider_id
        where a.task_id = $1
        order by a.match_score desc nulls last`,
      [taskId],
    );

    const entregables = await tx.query<{
      id: string;
      version: number;
      summary: string | null;
      qa_status: string;
      qa_score: PgNumeric | null;
      qa_resumen: string | null;
      qa_criteria_results: unknown;
      submitted_at: string;
      qa_evaluated_at: string | null;
    }>(
      `select id, version, summary, qa_status, qa_score, qa_feedback ->> 'summary' as qa_resumen,
              qa_criteria_results, submitted_at, qa_evaluated_at
         from public.deliverables
        where task_id = $1
        order by version desc`,
      [taskId],
    );

    return {
      tarea: {
        id: fila.id,
        projectId: fila.project_id,
        projectTitle: fila.project_title,
        projectObjective: fila.project_objective,
        code: fila.code,
        title: fila.title,
        description: fila.description,
        acceptanceCriteria: criteriosDe(fila.acceptance_criteria),
        requiredSkills: fila.required_skills ?? [],
        status: fila.status,
        budget: toNumber(fila.budget),
        estimatedHours: toNumber(fila.estimated_hours),
        assigneeId: fila.assignee_id,
        assigneeNombre: fila.assignee_nombre,
      },
      candidaturas: candidaturas.map((c) => ({
        id: c.id,
        providerId: c.provider_id,
        proveedor: c.proveedor,
        status: c.status,
        matchScore: toNumber(c.match_score),
        vectorScore: toNumber(c.vector_score),
        skillScore: toNumber(c.skill_score),
        reputationScore: toNumber(c.reputation_score),
        resumen: c.resumen,
      })),
      entregables: entregables.map((e) => ({
        id: e.id,
        version: e.version,
        summary: e.summary,
        qaStatus: e.qa_status,
        qaScore: toNumber(e.qa_score),
        qaResumen: e.qa_resumen,
        criterios: evaluadosDe(e.qa_criteria_results),
        submittedAt: e.submitted_at,
        qaEvaluatedAt: e.qa_evaluated_at,
      })),
    };
  });
}

// --- Consumo de IA ----------------------------------------------------------------------

export interface CorridaIa {
  id: string;
  operation: string;
  provider: string;
  model: string;
  status: string;
  attempt: number;
  fellBackFrom: string | null;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  startedAt: string;
}

export async function consumoDelProyecto(
  userId: string,
  projectId: string,
): Promise<{ titulo: string; corridas: CorridaIa[] } | null> {
  return leer(userId, async (tx) => {
    const proyecto = await tx.one<{ title: string }>('select title from public.projects where id = $1', [
      projectId,
    ]);
    if (proyecto === null) return null;
    const filas = await tx.query<{
      id: string;
      operation: string;
      provider: string;
      model: string;
      status: string;
      attempt: number;
      fell_back_from: string | null;
      total_tokens: number | null;
      cost_usd: PgNumeric | null;
      latency_ms: number | null;
      error_message: string | null;
      started_at: string;
    }>(
      `select id, operation, provider, model, status, attempt, fell_back_from, total_tokens,
              cost_usd, latency_ms, error_message, started_at
         from public.ai_runs
        where project_id = $1
        order by started_at desc
        limit 100`,
      [projectId],
    );
    return {
      titulo: proyecto.title,
      corridas: filas.map((f) => ({
        id: f.id,
        operation: f.operation,
        provider: f.provider,
        model: f.model,
        status: f.status,
        attempt: f.attempt,
        fellBackFrom: f.fell_back_from,
        totalTokens: f.total_tokens,
        costUsd: toNumber(f.cost_usd),
        latencyMs: f.latency_ms,
        errorMessage: f.error_message,
        startedAt: f.started_at,
      })),
    };
  });
}

// --- Panel del proveedor ----------------------------------------------------------------

export interface PerfilProveedorVista {
  id: string;
  headline: string | null;
  summary: string | null;
  hourlyRateUsd: number | null;
  minTaskBudgetUsd: number | null;
  availabilityHoursWeek: number | null;
  acceptsAutoAssign: boolean;
  isActive: boolean;
  reputationScore: number;
  avgRating: number | null;
  tasksCompleted: number;
  tasksFailed: number;
  skills: { slug: string; level: number; years: number | null }[];
}

export async function perfilProveedor(userId: string): Promise<PerfilProveedorVista | null> {
  return leer(userId, async (tx) => {
    const perfil = await tx.one<{
      id: string;
      headline: string | null;
      summary: string | null;
      hourly_rate_usd: PgNumeric | null;
      min_task_budget_usd: PgNumeric | null;
      availability_hours_week: number | null;
      accepts_auto_assign: boolean;
      is_active: boolean;
      reputation_score: PgNumeric;
      avg_rating: PgNumeric | null;
      tasks_completed: number;
      tasks_failed: number;
    }>(
      `select id, headline, summary, hourly_rate_usd, min_task_budget_usd, availability_hours_week,
              accepts_auto_assign, is_active, reputation_score, avg_rating, tasks_completed, tasks_failed
         from public.provider_profiles
        where user_id = auth.uid()`,
    );
    if (perfil === null) return null;
    const skills = await tx.query<{ slug: string; level: number; years_experience: PgNumeric | null }>(
      `select s.slug::text as slug, ps.level, ps.years_experience
         from public.provider_skills ps
         join public.skills s on s.id = ps.skill_id
        where ps.provider_profile_id = $1
        order by ps.level desc, s.slug`,
      [perfil.id],
    );
    return {
      id: perfil.id,
      headline: perfil.headline,
      summary: perfil.summary,
      hourlyRateUsd: toNumber(perfil.hourly_rate_usd),
      minTaskBudgetUsd: toNumber(perfil.min_task_budget_usd),
      availabilityHoursWeek: perfil.availability_hours_week,
      acceptsAutoAssign: perfil.accepts_auto_assign,
      isActive: perfil.is_active,
      reputationScore: toNumber(perfil.reputation_score) ?? 0,
      avgRating: toNumber(perfil.avg_rating),
      tasksCompleted: perfil.tasks_completed,
      tasksFailed: perfil.tasks_failed,
      skills: skills.map((s) => ({ slug: s.slug, level: s.level, years: toNumber(s.years_experience) })),
    };
  });
}

export interface TareaAsignada {
  id: string;
  code: string;
  title: string;
  status: string;
  budget: number | null;
  projectTitle: string;
}

export interface EventoReputacion {
  id: string;
  eventType: string;
  puntos: number;
  reason: string | null;
  createdAt: string;
}

export async function trabajoDelProveedor(
  userId: string,
): Promise<{ tareas: TareaAsignada[]; eventos: EventoReputacion[] }> {
  return leer(userId, async (tx) => {
    const tareas = await tx.query<{
      id: string;
      code: string;
      title: string;
      status: string;
      budget: PgNumeric | null;
      project_title: string;
    }>(
      `select t.id, t.code, t.title, t.status, t.budget, p.title as project_title
         from public.project_tasks t
         join public.projects p on p.id = t.project_id
        where t.assignee_id = auth.uid()
        order by t.updated_at desc
        limit 30`,
    );
    const eventos = await tx.query<{
      id: string;
      event_type: string;
      puntos: PgNumeric;
      reason: string | null;
      created_at: string;
    }>(
      `select id, event_type, (delta * weight) as puntos, reason, created_at
         from public.reputation_events
        where user_id = auth.uid()
        order by created_at desc
        limit 15`,
    );
    return {
      tareas: tareas.map((t) => ({
        id: t.id,
        code: t.code,
        title: t.title,
        status: t.status,
        budget: toNumber(t.budget),
        projectTitle: t.project_title,
      })),
      eventos: eventos.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        puntos: toNumber(e.puntos) ?? 0,
        reason: e.reason,
        createdAt: e.created_at,
      })),
    };
  });
}
