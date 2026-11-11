/**
 * VEKTORA — Ejecuta los scripts de `sql/` contra la base configurada en `DB_*`.
 *
 *   npm run sql:aplicar                 # 01-crear-tablas.sql y 02-datos-prueba.sql
 *   npm run sql:aplicar -- --solo-tablas
 *
 * Es la forma de cargar Aiven (Nivel 2) sin instalar `psql`: usa la MISMA configuración que
 * la aplicación (`lib/db/config.ts`), incluido el SSL con el certificado de Aiven. Si la
 * conexión no va cifrada y DB_SSL no es `disable`, se corta antes de ejecutar nada.
 *
 * Los scripts son idempotentes, así que repetirlo no rompe ni duplica nada.
 */

import '@/lib/env';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { cargarDbConfig, describirDbConfig, opcionesSsl } from '@/lib/db/config';

const ARCHIVOS = ['sql/01-crear-tablas.sql', 'sql/02-datos-prueba.sql'] as const;

async function main(): Promise<void> {
  const config = cargarDbConfig();
  const archivos = process.argv.includes('--solo-tablas') ? ARCHIVOS.slice(0, 1) : ARCHIVOS;

  console.log(`\n▸ Base: ${describirDbConfig(config)}`);
  // Un cliente suelto y no el pool: un script de varios miles de líneas se manda entero por
  // el protocolo simple, que admite varias sentencias en un solo envío.
  const cliente = new pg.Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: opcionesSsl(config),
    application_name: 'vektora-sql-aplicar',
  });
  cliente.on('notice', (aviso) => console.log(`  · ${aviso.message}`));
  await cliente.connect();
  // Los NOTICE de «no existe, se omite» (drop … if exists) son ruido en cada primera
  // ejecución. Los WARNING sí se muestran: avisan de algo que hay que hacer a mano.
  await cliente.query('set client_min_messages = warning');

  try {
    const ssl = await cliente.query<{ ssl: boolean | null }>(
      'select ssl from pg_stat_ssl where pid = pg_backend_pid()',
    );
    const cifrada = ssl.rows[0]?.ssl === true;
    console.log(`  conexión ${cifrada ? 'cifrada con SSL' : 'SIN cifrar'}`);
    if (!cifrada && config.ssl !== 'disable') {
      throw new Error('DB_SSL=require pero la conexión no va cifrada: no se ejecuta nada.');
    }

    for (const archivo of archivos) {
      const texto = readFileSync(resolve(process.cwd(), archivo), 'utf8');
      const inicio = Date.now();
      process.stdout.write(`\n▸ ${archivo} … `);
      await cliente.query(texto);
      console.log(`listo en ${((Date.now() - inicio) / 1000).toFixed(1)} s`);
    }

    const conteo = await cliente.query<{ tablas: number; tareas: number; cuentas: number }>(
      `select (select count(*)::int from information_schema.tables
                where table_schema = 'public' and table_type = 'BASE TABLE') as tablas,
              (select count(*)::int from public.project_tasks) as tareas,
              (select count(*)::int from public.users) as cuentas`,
    );
    const fila = conteo.rows[0];
    console.log(
      `\n✓ ${fila?.tablas ?? '?'} tablas · ${fila?.cuentas ?? '?'} cuentas · ${fila?.tareas ?? '?'} tareas`,
    );
    console.log('  Siguiente: npm run db:check  y  npm run cuenta:admin\n');
  } finally {
    await cliente.end();
  }
}

main().catch((error: unknown) => {
  // Es un script de operador: acá SÍ interesa el texto real de PostgreSQL (con su posición),
  // a diferencia de la interfaz, que nunca lo muestra.
  const detalle = error instanceof Error ? error.message : String(error);
  const posicion = (error as { position?: unknown }).position;
  console.error(`\n✗ ${detalle}${typeof posicion === 'string' ? ` (posición ${posicion})` : ''}`);
  process.exit(1);
});
