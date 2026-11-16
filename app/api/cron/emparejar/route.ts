/**
 * VEKTORA · FASE 6 — Emparejamiento periódico (RF-4.9).
 *
 * Esto es lo que convierte al sistema en autónomo de verdad. Sin un disparador periódico,
 * una tarea que queda disponible espera a que alguien ejecute algo — y eso es intervención
 * humana, aunque se llame «pulsar un botón».
 *
 * Un fallo en una tarea no detiene a las demás: el mercado de una no dice nada del de otra.
 *
 * Antes de emparejar pasa el vigilante (FASE 8): devuelve al mercado las tareas fallidas y
 * las que vencieron su plazo de entrega, así entran a esta misma corrida. Sin él, una tarea
 * adjudicada a alguien que desapareció no volvería nunca a estar disponible.
 */

import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/ai/errors';
import { autorizarCron } from '@/lib/cron/autorizacion';
import { createTaskMatcher, createTaskWatchdog, type SweepResult } from '@/lib/matching';
import { getDb } from '@/lib/db';
import { mensajeParaUsuario } from '@/lib/errores';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAXIMO_POR_CORRIDA = 10;
/** Tareas adjudicadas o fallidas que el vigilante revisa por corrida (una consulta cada una). */
const MAXIMO_VIGILADAS = 50;

export async function POST(request: Request): Promise<NextResponse> {
  const autorizacion = autorizarCron(request.headers);
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.motivo }, { status: autorizacion.estado });
  }

  // Si el vigilante falla, se empareja igual: que no se puedan liberar tareas trabadas no es
  // motivo para dejar sin proveedor a las que ya están disponibles.
  const vigilante = createTaskWatchdog();
  let vigilancia: SweepResult | { error: string };
  try {
    vigilancia = await vigilante.sweep(MAXIMO_VIGILADAS);
  } catch (error) {
    vigilancia = { error: errorMessage(error) };
  }

  let pendientes: Array<{ id: string; code: string; proyecto: string }>;
  try {
    // Como dueño de las tablas: es un agente autónomo, no una persona. Las tareas de
    // proyectos pausados, cancelados, completados o fallidos no se emparejan.
    //
    // Orden: primero las que menos rondas llevan, y a igualdad la más antigua. Ordenar solo
    // por antigüedad dejaba la cola tomada: diez tareas viejas para las que no existe ningún
    // proveedor ocupaban el cupo de cada corrida para siempre y las nuevas no llegaban nunca
    // a emparejarse. Así una tarea sin mercado sigue intentándose, pero cede el turno.
    pendientes = await getDb().query<{ id: string; code: string; proyecto: string }>(
      `select t.id, t.code, p.title as proyecto
         from public.project_tasks t
         join public.projects p on p.id = t.project_id
        where t.assignee_id is null
          and t.status in ('ready', 'open', 'matching')
          and p.status not in ('paused', 'cancelled', 'completed', 'failed')
        order by t.matching_rounds asc, t.created_at asc
        limit $1`,
      [MAXIMO_POR_CORRIDA],
    );
  } catch (error) {
    return NextResponse.json({ error: mensajeParaUsuario(error) }, { status: 500 });
  }

  const matcher = createTaskMatcher();
  const resultados: Array<Record<string, unknown>> = [];

  for (const tarea of pendientes) {
    try {
      const resultado = await matcher.matchTask({ taskId: tarea.id, assign: true });
      let plazo: string | null = null;
      if (resultado.assigned !== null) {
        // El plazo queda escrito en la misma corrida que adjudica: quien recibe la tarea lo
        // ve desde el primer momento. Si esto falla, la próxima pasada del vigilante lo fija.
        try {
          const revision = await vigilante.check({
            id: tarea.id,
            estimatedHours: resultado.task.estimatedHours,
          });
          plazo = revision.dueAt;
        } catch (causa) {
          console.warn(`[vektora/match] plazo sin fijar para ${tarea.code} -> ${errorMessage(causa)}`);
        }
      }
      resultados.push({
        code: tarea.code,
        // Dos proyectos pueden tener su propia T-01; sin el título, la traza es ambigua.
        proyecto: tarea.proyecto,
        candidatos: resultado.candidates,
        adjudicada: resultado.assigned !== null,
        escalada: resultado.escalated,
        motivo: resultado.assignmentSkipped,
        plazo,
      });
    } catch (causa) {
      resultados.push({ code: tarea.code, error: errorMessage(causa) });
    }
  }

  return NextResponse.json({
    vigilancia,
    revisadas: pendientes.length,
    adjudicadas: resultados.filter((r) => r['adjudicada'] === true).length,
    detalle: resultados,
  });
}

/** GET para poder comprobar el estado del disparador sin ejecutar nada. */
export async function GET(request: Request): Promise<NextResponse> {
  const autorizacion = autorizarCron(request.headers);
  return autorizacion.autorizado
    ? NextResponse.json({ listo: true, trabajo: 'emparejar' })
    : NextResponse.json({ error: autorizacion.motivo }, { status: autorizacion.estado });
}
