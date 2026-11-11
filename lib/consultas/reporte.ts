/**
 * VEKTORA — Reporte con agregaciones (requisito R6: COUNT, SUM, AVG + GROUP BY).
 *
 * Tres cortes, cada uno una sola consulta agregada:
 *
 *   1. Por proyecto: cantidad de tareas, aprobadas, presupuesto total y promedio por tarea.
 *   2. Por estado: cuántas tareas hay en cada estado y cuánto presupuesto representan.
 *   3. Por proveedor: tareas asignadas, completadas, puntaje promedio de las entregas
 *      evaluadas y reputación (la suma del libro mayor que mantiene un trigger).
 *
 * Corre como la persona (`asUser`): cada quien ve el reporte de LO QUE PUEDE VER. La cuenta
 * de administración ve todo porque las políticas RLS (`is_admin()`) se lo permiten; una
 * clienta ve sus proyectos. La misma consulta, distinto resultado, sin un solo `if`.
 */

import { getDb } from '@/lib/db';
import { toNumber, type PgNumeric } from '@/lib/db/types';

export interface FilaReporteProyecto {
  projectId: string;
  titulo: string;
  estado: string;
  tareas: number;
  aprobadas: number;
  presupuestoTotal: number;
  presupuestoPromedio: number | null;
}

export interface FilaReporteEstado {
  estado: string;
  tareas: number;
  presupuesto: number;
}

export interface FilaReporteProveedor {
  userId: string;
  nombre: string | null;
  asignadas: number;
  completadas: number;
  puntajePromedio: number | null;
  reputacion: number;
}

export interface Reporte {
  proyectos: FilaReporteProyecto[];
  estados: FilaReporteEstado[];
  proveedores: FilaReporteProveedor[];
}

export async function reporteGeneral(userId: string): Promise<Reporte> {
  return getDb().asUser(userId, async (tx) => {
    const proyectos = await tx.query<{
      project_id: string;
      titulo: string;
      estado: string;
      tareas: number;
      aprobadas: number;
      presupuesto_total: PgNumeric | null;
      presupuesto_promedio: PgNumeric | null;
    }>(
      `select p.id as project_id, p.title as titulo, p.status as estado,
              count(t.id)                                        as tareas,
              count(t.id) filter (where t.status = 'approved')    as aprobadas,
              coalesce(sum(t.budget), 0)                          as presupuesto_total,
              round(avg(t.budget), 2)                             as presupuesto_promedio
         from public.projects p
         left join public.project_tasks t on t.project_id = p.id
        group by p.id, p.title, p.status
        order by presupuesto_total desc, p.title`,
    );

    const estados = await tx.query<{ estado: string; tareas: number; presupuesto: PgNumeric | null }>(
      `select t.status as estado, count(*) as tareas, coalesce(sum(t.budget), 0) as presupuesto
         from public.project_tasks t
        group by t.status
        order by tareas desc, estado`,
    );

    // Subconsultas agregadas por separado y luego JOIN: agregarlo todo en un solo GROUP BY
    // multiplicaría filas (tareas × entregas × eventos) y inflaría las sumas.
    const proveedores = await tx.query<{
      user_id: string;
      nombre: string | null;
      asignadas: number;
      completadas: number;
      puntaje_promedio: PgNumeric | null;
      reputacion: PgNumeric | null;
    }>(
      `with tareas as (
         select assignee_id as user_id,
                count(*)                                      as asignadas,
                count(*) filter (where status = 'approved')   as completadas
           from public.project_tasks
          where assignee_id is not null
          group by assignee_id
       ),
       entregas as (
         select provider_id as user_id, round(avg(qa_score), 2) as puntaje_promedio
           from public.deliverables
          where qa_score is not null
          group by provider_id
       )
       -- La reputación sale de \`provider_profiles.reputation_score\`, que un trigger mantiene
       -- como SUM(delta * weight) del libro mayor. Se lee la proyección y no los eventos
       -- porque RLS solo deja ver los eventos propios; el puntaje del perfil es público.
       select t.user_id, coalesce(pr.display_name, pr.full_name) as nombre,
              t.asignadas, t.completadas, e.puntaje_promedio,
              coalesce(pp.reputation_score, 0) as reputacion
         from tareas t
         left join entregas e on e.user_id = t.user_id
         left join public.provider_profiles pp on pp.user_id = t.user_id
         left join public.profiles pr on pr.user_id = t.user_id
        order by t.completadas desc, t.asignadas desc`,
    );

    return {
      proyectos: proyectos.map((f) => ({
        projectId: f.project_id,
        titulo: f.titulo,
        estado: f.estado,
        tareas: f.tareas,
        aprobadas: f.aprobadas,
        presupuestoTotal: toNumber(f.presupuesto_total) ?? 0,
        presupuestoPromedio: toNumber(f.presupuesto_promedio),
      })),
      estados: estados.map((f) => ({
        estado: f.estado,
        tareas: f.tareas,
        presupuesto: toNumber(f.presupuesto) ?? 0,
      })),
      proveedores: proveedores.map((f) => ({
        userId: f.user_id,
        nombre: f.nombre,
        asignadas: f.asignadas,
        completadas: f.completadas,
        puntajePromedio: toNumber(f.puntaje_promedio),
        reputacion: toNumber(f.reputacion) ?? 0,
      })),
    };
  });
}
