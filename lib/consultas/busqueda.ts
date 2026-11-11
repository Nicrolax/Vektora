/**
 * VEKTORA — Búsqueda de tareas con filtros (requisito R6).
 *
 * Combina hasta seis filtros opcionales sobre `project_tasks` con JOIN a `projects` (título
 * y visibilidad) y a `profiles` (nombre del dueño y de quien la tiene asignada).
 *
 * Cómo se arma sin perder las consultas preparadas (R9): el TEXTO del SQL solo crece con
 * fragmentos fijos escritos acá (`t.status = $3`), y cada VALOR que escribió la persona se
 * agrega a la lista de parámetros. Nada de lo que llega del formulario se pega al SQL. La
 * única parte variable del texto, el ORDER BY, sale de una lista blanca.
 *
 * La búsqueda corre como la persona (`asUser`): solo encuentra tareas de proyectos propios,
 * públicos, o donde tiene asignación o candidatura. RLS decide; la consulta no filtra por eso.
 */

import { getDb, type Parametro } from '@/lib/db';
import { toNumber, type PgNumeric, type TaskStatus } from '@/lib/db/types';
import { ValidacionError } from '@/lib/errores';

export const ESTADOS_BUSCABLES: readonly TaskStatus[] = [
  'blocked',
  'ready',
  'open',
  'matching',
  'assigned',
  'in_progress',
  'submitted',
  'in_review',
  'revision_requested',
  'approved',
  'cancelled',
  'failed',
];

const ORDENES = {
  recientes: 't.created_at desc',
  presupuesto_desc: 't.budget desc nulls last, t.created_at desc',
  presupuesto_asc: 't.budget asc nulls last, t.created_at desc',
  codigo: 'p.title asc, t.code asc',
} as const;

export type OrdenBusqueda = keyof typeof ORDENES;

export interface FiltrosBusqueda {
  texto: string | null;
  estado: TaskStatus | null;
  skill: string | null;
  presupuestoMin: number | null;
  presupuestoMax: number | null;
  soloSinAsignar: boolean;
  orden: OrdenBusqueda;
}

export interface TareaEncontrada {
  id: string;
  code: string;
  title: string;
  status: string;
  budget: number | null;
  requiredSkills: string[];
  projectId: string;
  projectTitle: string;
  visibility: string;
  duenio: string | null;
  asignada: string | null;
}

export interface ResultadoBusqueda {
  filtros: FiltrosBusqueda;
  tareas: TareaEncontrada[];
  /** Total de coincidencias (puede ser mayor que `tareas.length`, que se corta en 50). */
  total: number;
}

const LIMITE = 50;

function texto(valor: unknown, maximo: number): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  if (limpio === '') return null;
  if (limpio.length > maximo) {
    throw new ValidacionError(`El texto de búsqueda puede tener como máximo ${maximo} caracteres.`);
  }
  return limpio;
}

function numero(valor: unknown, campo: string): number | null {
  if (valor === undefined || valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) {
    throw new ValidacionError(`El ${campo} tiene que ser un número mayor o igual a cero.`, campo);
  }
  return n;
}

/** Convierte los parámetros de la URL en filtros válidos. Lanza `ValidacionError` si no. */
export function normalizarFiltros(entrada: Record<string, unknown>): FiltrosBusqueda {
  const estado = texto(entrada['estado'], 40);
  if (estado !== null && !(ESTADOS_BUSCABLES as readonly string[]).includes(estado)) {
    throw new ValidacionError('Elegí un estado de la lista.', 'estado');
  }
  const presupuestoMin = numero(entrada['min'], 'presupuesto mínimo');
  const presupuestoMax = numero(entrada['max'], 'presupuesto máximo');
  if (presupuestoMin !== null && presupuestoMax !== null && presupuestoMin > presupuestoMax) {
    throw new ValidacionError('El presupuesto mínimo no puede ser mayor que el máximo.', 'min');
  }
  const orden = texto(entrada['orden'], 30);
  return {
    texto: texto(entrada['q'], 120),
    estado: estado as TaskStatus | null,
    skill: texto(entrada['skill'], 80)?.toLowerCase() ?? null,
    presupuestoMin,
    presupuestoMax,
    soloSinAsignar: entrada['libres'] === 'si',
    orden: orden !== null && orden in ORDENES ? (orden as OrdenBusqueda) : 'recientes',
  };
}

/** Escapa `%`, `_` y `\` para que el texto se busque literal dentro de ILIKE. */
function patronLiteral(valor: string): string {
  return `%${valor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function buscarTareas(userId: string, filtros: FiltrosBusqueda): Promise<ResultadoBusqueda> {
  const condiciones: string[] = [];
  const parametros: Parametro[] = [];
  const agregar = (fragmento: (marcador: string) => string, valor: Parametro) => {
    parametros.push(valor);
    condiciones.push(fragmento(`$${parametros.length}`));
  };

  if (filtros.texto !== null) {
    agregar((m) => `(t.title ilike ${m} or t.description ilike ${m} or p.title ilike ${m})`, patronLiteral(filtros.texto));
  }
  if (filtros.estado !== null) agregar((m) => `t.status = ${m}::public.task_status`, filtros.estado);
  if (filtros.skill !== null) agregar((m) => `${m} = any(t.required_skills)`, filtros.skill);
  if (filtros.presupuestoMin !== null) agregar((m) => `t.budget >= ${m}`, filtros.presupuestoMin);
  if (filtros.presupuestoMax !== null) agregar((m) => `t.budget <= ${m}`, filtros.presupuestoMax);
  if (filtros.soloSinAsignar) condiciones.push('t.assignee_id is null');

  const where = condiciones.length === 0 ? '' : `where ${condiciones.join(' and ')}`;
  const orden = ORDENES[filtros.orden];

  const filas = await getDb().asUser(userId, (tx) =>
    tx.query<{
      id: string;
      code: string;
      title: string;
      status: string;
      budget: PgNumeric | null;
      required_skills: string[] | null;
      project_id: string;
      project_title: string;
      visibility: string;
      duenio: string | null;
      asignada: string | null;
      total: number;
    }>(
      `select t.id, t.code, t.title, t.status, t.budget, t.required_skills,
              p.id as project_id, p.title as project_title, p.visibility,
              coalesce(dueno.display_name, dueno.full_name) as duenio,
              coalesce(asignada.display_name, asignada.full_name) as asignada,
              count(*) over () as total
         from public.project_tasks t
         join public.projects p          on p.id = t.project_id
         left join public.profiles dueno    on dueno.user_id = p.owner_id
         left join public.profiles asignada on asignada.user_id = t.assignee_id
         ${where}
        order by ${orden}
        limit ${LIMITE}`,
      parametros,
    ),
  );

  return {
    filtros,
    total: filas[0]?.total ?? 0,
    tareas: filas.map((f) => ({
      id: f.id,
      code: f.code,
      title: f.title,
      status: f.status,
      budget: toNumber(f.budget),
      requiredSkills: f.required_skills ?? [],
      projectId: f.project_id,
      projectTitle: f.project_title,
      visibility: f.visibility,
      duenio: f.duenio,
      asignada: f.asignada,
    })),
  };
}
