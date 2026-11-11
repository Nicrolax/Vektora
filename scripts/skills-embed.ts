/**
 * VEKTORA · FASE 3.5 — Vectoriza el catálogo de skills.
 *
 *   npm run skills:embed          # solo las que no tienen embedding
 *   npm run skills:embed -- --all # recalcula todas (tras cambiar de modelo)
 *
 * Sin esto, `resolve_or_create_skill` no puede comparar nada y la resolución degrada a
 * "slug exacto o skill nueva": el catálogo se dispersaría igual que si no hubiera
 * normalización semántica. Es un paso obligatorio después de aplicar la migración 0003.
 *
 * Idempotente: correrlo dos veces no cambia nada salvo con `--all`.
 */

import '@/lib/env';

import { getEmbeddingService } from '@/lib/ai/embeddings';
import { toPgVector } from '@/lib/ai/embeddings';
import { errorMessage } from '@/lib/ai/errors';
import { renderSkillForEmbedding } from '@/lib/providers/skills';
import { cerrarDb, dbConfigurada, getDb } from '@/lib/db';

interface SkillRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
}

async function main(): Promise<void> {
  const recalculateAll = process.argv.includes('--all');

  console.log('\n=== VEKTORA · vectorización del catálogo de skills ===\n');

  if (!dbConfigurada()) {
    console.error('\nFaltan DB_HOST, DB_NAME, DB_USER y/o DB_PASSWORD en .env (ver .env.example).\n');
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const embeddings = getEmbeddingService();

  if (!embeddings.isAvailable()) {
    console.error(
      'Los embeddings requieren GOOGLE_AI_API_KEY (Groq no expone embeddings).\n',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Modelo: ${embeddings.describeModel()}`);

  const rows = await db.query<SkillRow>(
    `select id, slug::text as slug, name, category
       from public.skills
      where is_active and ($1::boolean or embedding is null)
      order by slug`,
    [recalculateAll],
  );
  if (rows.length === 0) {
    console.log('\nNo hay skills pendientes de vectorizar. Nada que hacer.\n');
    return;
  }
  console.log(`Skills a vectorizar: ${rows.length}${recalculateAll ? ' (recálculo completo)' : ''}\n`);

  const started = Date.now();
  let saved = 0;
  let failed = 0;

  // Se procesa en lotes para respetar `AI_EMBED_CONCURRENCY` sin construir un array
  // gigantesco en memoria ni disparar todas las peticiones a la vez.
  const BATCH = 10;
  for (let offset = 0; offset < rows.length; offset += BATCH) {
    const batch = rows.slice(offset, offset + BATCH);

    let vectors: number[][];
    let model: string;
    let dimensions: number;
    try {
      const response = await embeddings.embedTexts({
        texts: batch.map((row) => renderSkillForEmbedding(row.slug, row.name)),
        taskType: 'RETRIEVAL_DOCUMENT',
      });
      vectors = response.vectors;
      model = response.model;
      dimensions = response.dimensions;
    } catch (embedError) {
      failed += batch.length;
      console.error(`  ✗ lote ${offset / BATCH + 1}: ${errorMessage(embedError)}`);
      continue;
    }

    for (let index = 0; index < batch.length; index += 1) {
      const row = batch[index];
      const vector = vectors[index];
      if (row === undefined || vector === undefined) continue;

      try {
        await db.execute(
          `update public.skills
              set embedding = $2::extensions.vector, embedding_model = $3, embedding_updated_at = now()
            where id = $1`,
          [row.id, toPgVector(vector, dimensions), model],
        );
        saved += 1;
        console.log(`  ✓ ${row.slug.padEnd(22)} ${row.category ?? '-'}`);
      } catch (updateError) {
        failed += 1;
        console.error(`  ✗ ${row.slug}: ${errorMessage(updateError)}`);
      }
    }
  }

  console.log(
    `\nVectorizadas ${saved}/${rows.length}` +
      `${failed > 0 ? ` · ${failed} con error` : ''} · ${Date.now() - started} ms\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .finally(() => cerrarDb())
  .catch((error: unknown) => {
  console.error(`\nVEKTORA/SKILLS: falló -> ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
