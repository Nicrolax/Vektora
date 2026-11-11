/**
 * VEKTORA — Arma `.env.render` para pegar en Render («Environment → Add from .env»).
 *
 *   npm run render:env                         # toma la base de .env
 *   npm run render:env -- --ia ruta/.env.local # además copia GROQ_API_KEY y GOOGLE_AI_API_KEY
 *
 * - Copia de `.env` la conexión a Aiven (DB_*), que ya se probó con `db:check`.
 * - Genera un AUTH_SECRET y un CRON_SECRET NUEVOS para producción: no se reutilizan los de
 *   desarrollo. Si `.env.render` ya existe, conserva los suyos (así no se invalidan las
 *   sesiones ni el secreto de GitHub cada vez que se corre).
 * - NO imprime ningún valor. `.env.render` está ignorado por Git (`.env.*`).
 *
 * El CRON_SECRET de este archivo es el mismo que hay que cargar como secreto de GitHub para
 * el workflow «Agentes».
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const ORIGEN = resolve(process.cwd(), '.env');
const DESTINO = resolve(process.cwd(), '.env.render');

const DE_LA_BASE = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL_CA'] as const;
const DE_IA = ['GROQ_API_KEY', 'GOOGLE_AI_API_KEY'] as const;

function leer(ruta: string): Record<string, string> {
  return existsSync(ruta) ? parse(readFileSync(ruta, 'utf8')) : {};
}

function main(): void {
  const base = leer(ORIGEN);
  const faltan = DE_LA_BASE.filter((clave) => (base[clave] ?? '').trim() === '');
  if (faltan.length > 0) {
    throw new Error(`Faltan en .env: ${faltan.join(', ')}. Corré antes npm run db:configurar.`);
  }
  if (base['DB_SSL'] === 'disable') {
    throw new Error('.env tiene DB_SSL=disable: eso no puede ir a Render. Corré npm run db:configurar.');
  }

  const anterior = leer(DESTINO);
  const valores: Record<string, string> = {};
  for (const clave of DE_LA_BASE) valores[clave] = base[clave] ?? '';
  valores['DB_SSL'] = 'require';
  valores['DB_POOL_MAX'] = '5';
  valores['AUTH_SECRET'] = anterior['AUTH_SECRET'] ?? randomBytes(32).toString('hex');
  valores['CRON_SECRET'] = anterior['CRON_SECRET'] ?? randomBytes(24).toString('hex');

  const indiceIa = process.argv.indexOf('--ia');
  const ia = indiceIa !== -1 && process.argv[indiceIa + 1] !== undefined ? leer(resolve(process.argv[indiceIa + 1] as string)) : {};
  let conIa = 0;
  for (const clave of DE_IA) {
    const valor = (ia[clave] ?? anterior[clave] ?? base[clave] ?? '').trim();
    if (valor !== '' && !valor.startsWith('<')) {
      valores[clave] = valor;
      conIa += 1;
    }
  }

  const lineas = [
    '# Variables para Render → Environment → Add from .env. NO SE VERSIONA.',
    '# Generado por npm run render:env. CRON_SECRET va también como secreto de GitHub.',
    ...Object.entries(valores).map(([clave, valor]) => `${clave}=${valor}`),
  ];
  writeFileSync(DESTINO, `${lineas.join('\n')}\n`, 'utf8');

  console.log(`\n✓ ${DESTINO}`);
  console.log(`  ${Object.keys(valores).length} variables (${conIa} de IA). Ningún valor se imprimió.\n`);
}

try {
  main();
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
