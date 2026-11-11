/**
 * VEKTORA — Genera los dos scripts de `sql/` que pide la consigna (requisito R11).
 *
 *   npm run sql:build     # escribe sql/01-crear-tablas.sql y sql/02-datos-prueba.sql
 *   npm run sql:check     # falla si sql/ no coincide con lo que generaría db/
 *
 * La FUENTE es `db/` (un archivo por fase, con su historia). `sql/` es solo la
 * concatenación en el orden de despliegue, para que haya UN script de tablas y UN script de
 * datos que se puedan ejecutar en cualquier PostgreSQL 16 con pgvector:
 *
 *   · docker-compose y minikube los montan en /docker-entrypoint-initdb.d (corren solos al
 *     crear la base vacía, en orden alfabético).
 *   · En Aiven se ejecutan con `npm run sql:aplicar`.
 *
 * No se editan a mano: `sql:check` corre en CI y falla si alguien lo hizo.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const ORDEN = {
  'sql/01-crear-tablas.sql': [
    'db/00_plataforma.sql',
    'db/schema.sql',
    'db/migrations/0002_planner.sql',
    'db/migrations/0003_provider_onboarding.sql',
    'db/migrations/0004_matching.sql',
    'db/migrations/0005_qa.sql',
    'db/migrations/0007_escalada.sql',
  ],
  'sql/02-datos-prueba.sql': ['db/seeds/01_skills.sql', 'db/seeds/02_datos_demo.sql'],
} as const satisfies Record<string, readonly string[]>;

const DESCRIPCION: Record<keyof typeof ORDEN, string> = {
  'sql/01-crear-tablas.sql':
    'Crea el esquema completo: plataforma (auth, roles), 14 tablas, triggers, índices,\n' +
    '-- políticas RLS y las funciones de cada fase.',
  'sql/02-datos-prueba.sql':
    'Carga el catálogo de 30 skills y los datos de la demo (6 cuentas, 2 proyectos,\n' +
    '-- 8 tareas, candidaturas, una entrega aprobada y reputación). Más de 20 registros.',
};

/** Contenido que debería tener cada archivo de `sql/`. Usa siempre saltos `\n`. */
export function generar(raiz: string = process.cwd()): Map<string, string> {
  const salida = new Map<string, string>();
  for (const [destino, fuentes] of Object.entries(ORDEN) as [keyof typeof ORDEN, readonly string[]][]) {
    const partes = [
      '-- =====================================================================================',
      `-- VEKTORA · ${destino}`,
      '-- =====================================================================================',
      '-- ARCHIVO GENERADO por `npm run sql:build` a partir de db/. NO EDITAR A MANO:',
      '-- cambiá el archivo de db/ correspondiente y volvé a generar.',
      '--',
      `-- ${DESCRIPCION[destino]}`,
      '--',
      '-- Idempotente: se puede ejecutar más de una vez sobre la misma base.',
      '-- Fuentes, en orden:',
      ...fuentes.map((fuente) => `--   · ${fuente}`),
      '-- =====================================================================================',
      '',
    ];
    for (const fuente of fuentes) {
      const texto = readFileSync(resolve(raiz, fuente), 'utf8').replace(/\r\n/g, '\n').trimEnd();
      partes.push(
        '',
        `-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ${fuente}`,
        // Cada fuente arranca con el mismo search_path, aunque la anterior lo haya cambiado.
        'set search_path = public, extensions;',
        '',
        texto,
        '',
      );
    }
    salida.set(destino, `${partes.join('\n').trimEnd()}\n`);
  }
  return salida;
}

/**
 * Lee un archivo, o null si no existe. Se intenta leer directamente en vez de preguntar
 * antes con existsSync (carrera TOCTOU que marcó CodeQL).
 */
function leerSiExiste(ruta: string): string | null {
  try {
    return readFileSync(ruta, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

function main(): void {
  const soloComprobar = process.argv.includes('--check');
  const raiz = process.cwd();
  let desactualizados = 0;

  for (const [destino, contenido] of generar(raiz)) {
    const ruta = resolve(raiz, destino);
    const actual = leerSiExiste(ruta)?.replace(/\r\n/g, '\n') ?? null;
    if (soloComprobar) {
      if (actual !== contenido) {
        desactualizados += 1;
        console.error(`✗ ${destino} no coincide con db/. Corré: npm run sql:build`);
      } else {
        console.log(`✓ ${destino} al día`);
      }
      continue;
    }
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, contenido, 'utf8');
    console.log(`✓ ${destino} (${contenido.length.toLocaleString('es-UY')} caracteres)`);
  }

  if (desactualizados > 0) process.exit(1);
}

main();
