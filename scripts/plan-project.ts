/**
 * VEKTORA · FASE 3 — Planificación de un proyecto real, de punta a punta.
 *
 *   npm run plan -- "Necesito un micrositio de captación con formulario y analítica" [presupuesto]
 *
 * Requisitos: GROQ_API_KEY o GOOGLE_AI_API_KEY, y la conexión a PostgreSQL en DB_* con
 * los scripts de `sql/` ya aplicados (`npm run sql:aplicar`, o la base de docker compose).
 *
 * Propietario del proyecto: se usa VEKTORA_OWNER_ID si está definido, y se VERIFICA que
 * exista en `public.users` antes de gastar una llamada al modelo — un uuid que no está en
 * la tabla falla como violación de clave foránea a mitad del insert, después de haber
 * pagado la generación del plan. Si no está definido, se toma el usuario más antiguo.
 *
 * No imprime ninguna clave.
 */

import '@/lib/env';

import { errorMessage } from '@/lib/ai/errors';
import { createProjectPlanner } from '@/lib/planner';
import { PostgresPlannerRepository } from '@/lib/planner';
import { cerrarDb, getDb, toNumber } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

interface OwnerResolution {
  id: string;
  email: string | null;
  source: 'VEKTORA_OWNER_ID' | 'public.users';
}

/**
 * Resuelve y VERIFICA el propietario contra `public.users`.
 *
 * `public.users` es la proyección de `auth.users` que crea el bootstrap de la FASE 1:
 * `projects.owner_id` referencia esa tabla, no `auth.users` directamente.
 */
async function resolveOwner(): Promise<OwnerResolution> {
  const db = getDb();
  const fromEnv = process.env['VEKTORA_OWNER_ID']?.trim();

  if (fromEnv !== undefined && fromEnv !== '') {
    if (!UUID_RE.test(fromEnv)) {
      throw new Error(
        `VEKTORA_OWNER_ID="${fromEnv}" no es un UUID válido. Debe ser el id de una fila de ` +
          'public.users (el mismo uuid que en auth.users).',
      );
    }

    let data: { id: string; email: string | null; status: string } | null;
    try {
      data = await db.one('select id, email::text as email, status from public.users where id = $1', [fromEnv]);
    } catch (error) {
      throw new Error(
        `no se pudo consultar public.users -> ${errorMessage(error)}. ¿Corriste npm run sql:aplicar?`,
      );
    }
    if (data === null) {
      throw new Error(
        `VEKTORA_OWNER_ID=${fromEnv} no existe en public.users. Creá la cuenta desde /entrar ` +
          '(el trigger la proyecta a public.users) o quitá la variable para usar el primer ' +
          'usuario disponible.',
      );
    }

    const row = data;
    if (row.status === 'suspended' || row.status === 'deleted') {
      throw new Error(
        `el usuario ${fromEnv} está en estado "${row.status}": no puede ser propietario de ` +
          'un proyecto nuevo.',
      );
    }
    return { id: row.id, email: row.email, source: 'VEKTORA_OWNER_ID' };
  }

  let row: { id: string; email: string | null } | null;
  try {
    row = await db.one(
      `select id, email::text as email from public.users
        where status = 'active' order by created_at limit 1`,
    );
  } catch (error) {
    throw new Error(`no se pudo leer public.users -> ${errorMessage(error)}. ¿Corriste npm run sql:aplicar?`);
  }
  if (row === null) {
    throw new Error(
      'no hay ningún usuario activo en public.users. Creá una cuenta desde /entrar o ' +
        'definí VEKTORA_OWNER_ID con el uuid de un usuario existente.',
    );
  }
  return { id: row.id, email: row.email, source: 'public.users' };
}

function usage(): void {
  console.error('\nUso: npm run plan -- "<objetivo en lenguaje natural>" [presupuesto]\n');
}

async function main(): Promise<void> {
  const objective = process.argv[2];
  if (objective === undefined || objective.trim().length < 10) {
    usage();
    process.exitCode = 1;
    return;
  }

  const budgetArg = process.argv[3];
  const budgetTotal =
    budgetArg === undefined || budgetArg.trim() === '' ? null : Number(budgetArg);
  if (budgetTotal !== null && (!Number.isFinite(budgetTotal) || budgetTotal < 0)) {
    console.error('\nEl presupuesto debe ser un número no negativo.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n=== VEKTORA · FASE 3 · ProjectPlanner ===\n');

  const owner = await resolveOwner();
  const planner = createProjectPlanner({
    repository: new PostgresPlannerRepository(getDb()),
  });

  console.log('[0] Propietario');
  line('owner_id:', owner.id);
  line('email:', owner.email ?? '(sin email)');
  line('origen:', owner.source);
  console.log();

  const started = Date.now();
  const result = await planner.planProject({
    create: { ownerId: owner.id, objective, budgetTotal },
  });

  console.log('[1] Proyecto');
  line('id:', result.project.id);
  line('título:', result.project.title);
  line(
    'presupuesto:',
    budgetTotal === null ? '(sin declarar)' : `${budgetTotal} ${result.project.currency}`,
  );
  console.log();

  console.log('[2] Generación');
  line('proveedor:', `${result.ai.provider} · ${result.ai.model}`);
  line('esquema estricto:', result.ai.strictSchema ? 'sí' : 'no (fallback determinista)');
  line('intentos / repar.:', `${result.ai.attempts} / ${result.ai.repairs}`);
  line('ai_runs:', result.ai.runId ?? '(telemetría desactivada)');
  console.log();

  console.log('[3] DAG');
  line('tareas / aristas:', `${result.taskCount} / ${result.edgeCount}`);
  line('profundidad:', String(result.stats.depth));
  line('raíces:', result.stats.roots.join(', '));
  line('hojas:', result.stats.leaves.join(', '));
  line(
    'ruta crítica:',
    `${result.stats.criticalPath.path.join(' → ')} (${result.stats.criticalPath.totalWeight} h)`,
  );
  result.stats.levels.forEach((level, index) => {
    line(`nivel ${index}:`, level.join(', '));
  });
  console.log();

  console.log('[4] Tareas persistidas');
  let data: Array<Record<string, unknown>> | null = null;
  try {
    data = await getDb().query(
      `select code, title, status, depth, order_index, estimated_hours, budget, required_skills
         from public.project_tasks where project_id = $1 order by order_index`,
      [result.project.id],
    );
  } catch (error) {
    console.log(`  (no se pudieron releer las tareas: ${errorMessage(error)})`);
  }
  if (data !== null) {
    let budgetSum = 0;
    for (const row of data) {
      const skills = Array.isArray(row['required_skills'])
        ? (row['required_skills'] as string[]).join(',')
        : '';
      const budget = toNumber(row['budget'] as number | string | null);
      if (budget !== null) budgetSum += budget;
      console.log(
        `  ${String(row['code']).padEnd(7)} ${String(row['status']).padEnd(8)} ` +
          `d${String(row['depth'])}  ${String(row['estimated_hours']).padStart(5)}h  ` +
          `${(budget === null ? '-' : budget.toFixed(2)).padStart(9)}  ` +
          `${skills.padEnd(28)} ${String(row['title'])}`,
      );
    }
    if (budgetTotal !== null && budgetTotal > 0) {
      const exact = Math.abs(budgetSum - budgetTotal) < 0.005;
      line(
        'suma de budgets:',
        `${budgetSum.toFixed(2)} / ${budgetTotal.toFixed(2)} ${exact ? '✓ exacto' : '✗ DESCUADRA'}`,
      );
    }
  }
  console.log();

  if (result.corrections.length > 0) {
    console.log('[5] Correcciones automáticas del grafo');
    for (const correction of result.corrections) {
      console.log(`  · [${correction.kind}] ${correction.detail}`);
    }
    console.log();
  }

  console.log('[6] Extras');
  line('skills nuevas:', result.newSkills.length > 0 ? result.newSkills.join(', ') : '(ninguna)');
  line('tareas vectorizadas:', `${result.embeddedTasks}/${result.taskCount}`);
  line('tiempo total:', `${Date.now() - started} ms`);

  console.log('\n=== Plan aplicado ===\n');
}

main()
  .finally(() => cerrarDb())
  .catch((error: unknown) => {
  console.error(`\nVEKTORA/PLANNER: falló -> ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
