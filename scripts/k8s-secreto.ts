/**
 * VEKTORA — Genera `k8s/secret.yaml` (el Secret real del clúster) con valores aleatorios.
 *
 *   npm run k8s:secreto                     # contraseñas y secretos nuevos
 *   npm run k8s:secreto -- --ia .env.render # además copia GROQ_API_KEY y GOOGLE_AI_API_KEY
 *
 * Parte de `k8s/secret.yaml.example` y reemplaza los valores. `k8s/secret.yaml` está en
 * .gitignore y en .dockerignore: nunca se sube. No imprime ningún valor.
 * Si ya existe, no lo pisa (las contraseñas de la base tienen que seguir coincidiendo con
 * las del volumen ya creado); con `--forzar` lo regenera.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const DESTINO = resolve(process.cwd(), 'k8s/secret.yaml');

/** Valor entre comillas dobles de YAML (escapa \ y "). */
function yaml(valor: string): string {
  return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function main(): void {
  if (existsSync(DESTINO) && !process.argv.includes('--forzar')) {
    console.log(`\n· ${DESTINO} ya existe: no se toca (usá --forzar para regenerarlo).\n`);
    return;
  }

  const clave = randomBytes(18).toString('base64url');
  const valores: Record<string, string> = {
    POSTGRES_USER: 'vektora',
    POSTGRES_PASSWORD: clave,
    DB_USER: 'vektora',
    DB_PASSWORD: clave,
    AUTH_SECRET: randomBytes(32).toString('hex'),
    CRON_SECRET: randomBytes(24).toString('hex'),
    GROQ_API_KEY: '',
    GOOGLE_AI_API_KEY: '',
  };

  const indiceIa = process.argv.indexOf('--ia');
  if (indiceIa !== -1 && process.argv[indiceIa + 1] !== undefined) {
    const ia = parse(readFileSync(resolve(process.argv[indiceIa + 1] as string), 'utf8'));
    for (const k of ['GROQ_API_KEY', 'GOOGLE_AI_API_KEY']) valores[k] = (ia[k] ?? '').trim();
  }

  const lineas = [
    '# Secret REAL del clúster. Generado por npm run k8s:secreto. NO SE VERSIONA.',
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    '  name: vektora-secret',
    '  labels:',
    '    app.kubernetes.io/part-of: vektora',
    'type: Opaque',
    'stringData:',
    ...Object.entries(valores).map(([k, v]) => `  ${k}: ${yaml(v)}`),
  ];
  writeFileSync(DESTINO, `${lineas.join('\n')}\n`, 'utf8');
  console.log(`\n✓ ${DESTINO} (ningún valor se imprimió). Siguiente: kubectl apply -f k8s/secret.yaml\n`);
}

main();
