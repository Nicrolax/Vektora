/**
 * VEKTORA · FASE 6 — Emparejamiento periódico (RF-4.9).
 *
 * Esto es lo que convierte al sistema en autónomo de verdad. Sin un disparador periódico,
 * una tarea que queda disponible espera a que alguien ejecute algo — y eso es intervención
 * humana, aunque se llame «pulsar un botón».
 *
 * Un fallo en una tarea no detiene a las demás: el mercado de una no dice nada del de otra.
 */

import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/ai/errors';
import { autorizarCron } from '@/lib/cron/autorizacion';
import { createTaskMatcher } from '@/lib/matching';
import { getDb } from '@/lib/db';
import { mensajeParaUsuario } from '@/lib/errores';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAXIMO_POR_CORRIDA = 10;

export async function POST(request: Request): Promise<NextResponse> {
  const autorizacion = autorizarCron(request.headers);
  if (!autorizacion.autorizado) {
    return NextResponse.json({ error: autorizacion.motivo }, { status: autorizacion.estado });
  }

  let pendientes: Array<{ id: string; code: string; proyecto: string }>;
  try {
    // Como dueño de las tablas: es un agente autónomo, no una persona. Las tareas de
    // proyectos pausados o cancelados no se emparejan.
    pendientes = await getDb().query<{ id: string; code: string; proyecto: string }>(
      `select t.id, t.code, p.title as proyecto
         from public.project_tasks t
         join public.projects p on p.id = t.project_id
        where t.assignee_id is null
          and t.status in ('ready', 'open', 'matching')
          and p.status not in ('paused', 'cancelled', 'completed')
        order by t.created_at asc
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
      resultados.push({
        code: tarea.code,
        // Dos proyectos pueden tener su propia T-01; sin el título, la traza es ambigua.
        proyecto: tarea.proyecto,
        candidatos: resultado.candidates,
        adjudicada: resultado.assigned !== null,
        escalada: resultado.escalated,
        motivo: resultado.assignmentSkipped,
      });
    } catch (causa) {
      resultados.push({ code: tarea.code, error: errorMessage(causa) });
    }
  }

  return NextResponse.json({
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
