/**
 * VEKTORA · FASE 5 — Enviar un entregable para que el AI Judge lo evalúe.
 *
 *   npm run deliver                                  # tareas asignadas esperando entrega
 *   npm run deliver -- <task_id>                     # criterios completos de esa tarea
 *   npm run deliver -- <task_id> <archivo>           # .json estructurado, o .md/.txt como contenido
 *   npm run deliver -- <task_id> --empty             # entrega vacía, para probar la regla dura
 *
 * Existe porque sin él la FASE 5 no se puede ejercitar: el flujo real de entrega es la
 * FASE 6 (workspace del proveedor), y hasta entonces no hay ninguna forma de crear un
 * `deliverable`. No es un mock — escribe en la tabla real, con el proveedor real asignado.
 *
 * Formato del .json:
 *   {
 *     "summary":  "Qué se entregó, en una o dos frases",
 *     "content":  "El trabajo en sí, o dónde está",
 *     "artifacts": [{ "type": "url", "url": "https://…", "label": "Repositorio" }],
 *     "evidence": { "AC-1": "Dónde se demuestra AC-1", "AC-2": "…" }
 *   }
 *
 * Hay dos entregas completas de ejemplo en `scripts/ejemplos/`.
 */

import '@/lib/env';

import { readFile } from 'node:fs/promises';
import { errorMessage } from '@/lib/ai/errors';
import { cerrarDb, dbConfigurada, getDb, json } from '@/lib/db';

interface Submission {
  summary: string | null;
  content: string | null;
  artifacts: unknown[];
  evidence: Record<string, unknown>;
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(24)} ${value}`);
}

/** IDs de criterio de una tarea. Son las claves que `evidence` debe usar. */
function criterionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as { id?: unknown }).id
        : undefined,
    )
    .filter((id): id is string => typeof id === 'string' && id !== '');
}

async function listAssignedTasks(): Promise<void> {
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await getDb().query(
      `select t.id, t.code, t.title, t.status, t.assignee_id, t.acceptance_criteria,
              p.title as project_title
         from public.project_tasks t
         join public.projects p on p.id = t.project_id
        where t.assignee_id is not null
          and t.status in ('assigned', 'in_progress', 'revision_requested', 'submitted')
        order by t.created_at
        limit 40`,
    );
  } catch (error) {
    console.error(`\nNo se pudieron leer las tareas -> ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  if (rows.length === 0) {
    console.log(
      '\nNo hay ninguna tarea asignada esperando entrega.\n' +
        'Adjudica una primero:  npm run match -- <task_id> --assign\n',
    );
    return;
  }

  console.log('\nTareas asignadas:\n');
  for (const row of rows) {
    const projectTitle = String(row['project_title'] ?? '');
    const ids = criterionIds(row['acceptance_criteria']);
    console.log(`  ${String(row['id'])}`);
    console.log(
      `    ${String(row['code'])} · ${String(row['title'])}  [${String(row['status'])}]` +
        `   (${projectTitle})`,
    );
    // Los IDs, no solo cuántos son: son las claves que debe llevar "evidence" en el JSON.
    console.log(`    criterios: ${ids.length === 0 ? '(ninguno)' : ids.join(', ')}`);
  }
  console.log('\nEnviar una entrega:');
  console.log('  npm run deliver -- <task_id> <archivo.json|.md>\n');
}

/**
 * Criterios completos de una tarea.
 *
 * Sin esto, la única forma de leer el texto de un criterio era crear un entregable y mirar
 * la salida del juez — es decir, gastar una llamada al modelo para averiguar contra qué hay
 * que entregar. Se invoca con `npm run deliver -- <task_id>`, sin archivo.
 */
async function showCriteria(taskId: string): Promise<void> {
  let data: Record<string, unknown> | null;
  try {
    data = await getDb().one(
      `select code, title, description, status, budget, estimated_hours, acceptance_criteria
         from public.project_tasks where id = $1`,
      [taskId],
    );
  } catch (error) {
    console.error(`\nNo se pudo leer la tarea -> ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (data === null) {
    console.error(`\nNo existe ninguna tarea con id ${taskId}\n`);
    process.exitCode = 1;
    return;
  }

  const row = data;
  console.log(`\n=== ${String(row['code'])} · ${String(row['title'])} ===\n`);
  line('estado:', String(row['status']));
  line('presupuesto / horas:', `${String(row['budget'])} / ${String(row['estimated_hours'])} h`);
  const description = row['description'];
  if (typeof description === 'string' && description.trim() !== '') {
    console.log(`\n  ${description}`);
  }

  const criteria = Array.isArray(row['acceptance_criteria'])
    ? (row['acceptance_criteria'] as Array<Record<string, unknown>>)
    : [];
  console.log('\nCriterios de aceptación:');
  if (criteria.length === 0) {
    console.log('  (ninguno: el juez no podrá aprobar nada)');
  }
  for (const criterion of criteria) {
    console.log(`\n  [${String(criterion['id'])}] ${String(criterion['criterion'])}`);
    const verification = criterion['verification'];
    if (typeof verification === 'string' && verification !== '') {
      console.log(`      se comprueba: ${verification}`);
    }
  }
  console.log('\nLas claves de "evidence" en el JSON deben ser esos IDs.\n');
}

async function readSubmission(path: string): Promise<Submission> {
  const raw = await readFile(path, 'utf8');

  if (!path.toLowerCase().endsWith('.json')) {
    return { summary: null, content: raw, artifacts: [], evidence: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`${path} no es JSON válido -> ${errorMessage(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} debe contener un objeto JSON`);
  }
  const record = parsed as Record<string, unknown>;

  const artifacts = record['artifacts'];
  const evidence = record['evidence'];
  return {
    summary: typeof record['summary'] === 'string' ? record['summary'] : null,
    content: typeof record['content'] === 'string' ? record['content'] : null,
    artifacts: Array.isArray(artifacts) ? artifacts : [],
    evidence:
      typeof evidence === 'object' && evidence !== null && !Array.isArray(evidence)
        ? (evidence as Record<string, unknown>)
        : {},
  };
}

async function submit(taskId: string, submission: Submission): Promise<void> {
  const db = getDb();

  let task: Record<string, unknown> | null;
  try {
    task = await db.one(
      'select id, code, title, status, assignee_id, acceptance_criteria from public.project_tasks where id = $1',
      [taskId],
    );
  } catch (error) {
    console.error(`\nNo se pudo leer la tarea -> ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (task === null) {
    console.error(`\nNo existe ninguna tarea con id ${taskId}\n`);
    process.exitCode = 1;
    return;
  }

  const row = task;
  const assignee = row['assignee_id'];
  if (typeof assignee !== 'string' || assignee === '') {
    console.error(
      `\nLa tarea ${String(row['code'])} no tiene proveedor asignado, así que nadie puede ` +
        'entregar todavía.\n  npm run match -- ' +
        `${taskId} --assign\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Cotejar las claves de `evidence` con los criterios REALES de la tarea. Una entrega con
  // las claves cambiadas se juzga igual —el modelo ve todo el objeto— pero pierde la
  // correspondencia criterio <-> evidencia, que es justo lo que hace fiable al juez. Se
  // avisa y se continúa: bloquear la entrega por esto sería peor que entregarla desalineada.
  const ids = criterionIds(row['acceptance_criteria']);
  const aportadas = Object.keys(submission.evidence);
  if (ids.length > 0 && aportadas.length > 0) {
    const faltan = ids.filter((id) => !aportadas.includes(id));
    const sobran = aportadas.filter((key) => !ids.includes(key));
    if (faltan.length > 0) {
      console.log(`\n  ! sin evidencia declarada: ${faltan.join(', ')}`);
      console.log('    el juez los evaluará contra el contenido general, con menos confianza');
    }
    if (sobran.length > 0) {
      console.log(`\n  ! claves que no son criterios de esta tarea: ${sobran.join(', ')}`);
      console.log(`    los criterios son: ${ids.join(', ')}`);
    }
  } else if (ids.length > 0 && aportadas.length === 0) {
    console.log(`\n  ! la entrega no declara evidencia por criterio (${ids.join(', ')})`);
  }

  // Entregable + cambio de estado en UNA transacción (R7): si el UPDATE falla, el INSERT
  // se deshace y no queda un entregable sin tarea en `submitted`.
  let deliverable: { id: string; version: number; qa_status: string };
  try {
    deliverable = await db.transaction(async (tx) => {
      const fila = await tx.one<{ id: string; version: number; qa_status: string }>(
        `insert into public.deliverables (task_id, provider_id, summary, content, artifacts, evidence)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         returning id, version, qa_status`,
        [taskId, assignee, submission.summary, submission.content, json(submission.artifacts), json(submission.evidence)],
      );
      if (fila === null) throw new Error('el insert no devolvió el entregable');
      await tx.execute(
        `update public.project_tasks set status = 'submitted'
          where id = $1 and status in ('assigned', 'in_progress', 'revision_requested')`,
        [taskId],
      );
      return fila;
    });
  } catch (error) {
    console.error(`\nNo se pudo registrar la entrega -> ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  console.log('\n=== Entrega registrada ===\n');
  line('tarea:', `${String(row['code'])} · ${String(row['title'])}`);
  line('entregable:', String(deliverable.id));
  line('versión:', String(deliverable.version));
  line('estado QA:', String(deliverable.qa_status));
  line('criterios a evaluar:', ids.length === 0 ? '0' : `${ids.length} (${ids.join(', ')})`);
  line('evidencia aportada:', String(Object.keys(submission.evidence).length));
  console.log('\nEvaluarlo:');
  console.log(`  npm run qa -- ${String(deliverable.id)} --dry-run`);
  console.log(`  npm run qa -- ${String(deliverable.id)}\n`);
}

async function main(): Promise<void> {
  if (!dbConfigurada()) {
    console.error('\nFaltan DB_HOST, DB_NAME, DB_USER y/o DB_PASSWORD en .env (ver .env.example).\n');
    process.exitCode = 1;
    return;
  }

  const args = process.argv.slice(2).filter((arg) => arg !== '***');
  const taskId = args.find((arg) => !arg.startsWith('--'));

  if (taskId === undefined) {
    await listAssignedTasks();
    return;
  }

  if (args.includes('--empty')) {
    console.log('\n(entrega VACÍA a propósito: sirve para comprobar que el juez no aprueba nada)');
    await submit(taskId, { summary: null, content: null, artifacts: [], evidence: {} });
    return;
  }

  const path = args.filter((arg) => !arg.startsWith('--')).at(1);
  if (path === undefined) {
    // Un task_id sin archivo no es un error: es la pregunta «¿contra qué tengo que
    // entregar?», que es justo lo que hay que saber antes de escribir la entrega.
    await showCriteria(taskId);
    return;
  }

  await submit(taskId, await readSubmission(path));
}

main()
  .finally(() => cerrarDb())
  .catch((error: unknown) => {
  console.error(`\nVEKTORA/DELIVER: falló -> ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
