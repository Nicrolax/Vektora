/**
 * VEKTORA — Carga la conexión a la base (Aiven) en `.env` sin mostrarla.
 *
 *   npm run db:configurar
 *
 * Pide, en la consola:
 *   1. la «Service URI» de Aiven (postgres://avnadmin:…@host:puerto/defaultdb?sslmode=require),
 *      con la escritura OCULTA: la contraseña no queda en pantalla ni en el historial;
 *   2. la ruta del certificado CA que se descarga de la consola de Aiven (ca.pem).
 *
 * Escribe en `.env` (que está en .gitignore) DB_HOST, DB_PORT, DB_NAME, DB_USER,
 * DB_PASSWORD, DB_SSL=require, DB_SSL_CA (el PEM en una sola línea con `\n`) y
 * DB_POOL_MAX=5, y conserva el resto de las variables. Nunca imprime la contraseña.
 *
 * Existe para que la contraseña de la base no tenga que pegarse en un chat, en un archivo
 * del repo ni en un argumento de la consola (que queda en el historial).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { actualizarEnv, leerServiceUri, pemEnUnaLinea } from '@/lib/db/uri';

const ARCHIVO = resolve(process.cwd(), '.env');

/** Pregunta en la consola. Con `oculto`, lo que se escribe no se muestra. */
function preguntar(texto: string, oculto = false): Promise<string> {
  let silenciar = false;
  const salida = new Writable({
    write(chunk: Buffer, _codificacion, listo) {
      if (!silenciar) process.stdout.write(chunk);
      listo();
    },
  });
  const rl = createInterface({ input: process.stdin, output: salida, terminal: true });
  return new Promise((resolver) => {
    rl.question(texto, (respuesta) => {
      rl.close();
      if (oculto) process.stdout.write('\n');
      resolver(respuesta.trim());
    });
    silenciar = oculto;
  });
}

function powershell(comando: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], {
    encoding: 'utf8',
  });
}

/** Texto del portapapeles de Windows (sin imprimirlo). */
function leerPortapapeles(): string {
  const texto = powershell('Get-Clipboard -Raw').trim();
  if (!texto.startsWith('postgres')) {
    throw new Error('El portapapeles no tiene una Service URI: tocá «Copy» al lado de Service URI en Aiven.');
  }
  return texto;
}

function vaciarPortapapeles(): void {
  try {
    powershell('Set-Clipboard -Value $null');
  } catch {
    /* si no se puede, no es grave: se avisa abajo */
    console.log('   ! no se pudo vaciar el portapapeles: copiá cualquier otra cosa para pisarlo');
  }
}

async function main(): Promise<void> {
  console.log('\n=== VEKTORA · conexión a la base (Aiven) ===\n');
  console.log('La contraseña no se muestra al escribir ni se imprime. Todo queda solo en .env.\n');

  // `--portapapeles`: la URI se toma del portapapeles de Windows (botón «Copy» de Aiven) y
  // el portapapeles se vacía después. Nunca se imprime.
  const desdePortapapeles = process.argv.includes('--portapapeles');
  const uri = desdePortapapeles
    ? leerPortapapeles()
    : await preguntar('1) Pegá la Service URI de Aiven (no se ve al pegar) y Enter:\n> ', true);
  const datos = leerServiceUri(uri);
  if (desdePortapapeles) vaciarPortapapeles();
  console.log(`   ✓ ${datos.user}@${datos.host}:${datos.port}/${datos.database}`);

  const indiceCa = process.argv.indexOf('--ca');
  const rutaCa =
    indiceCa !== -1 && process.argv[indiceCa + 1] !== undefined
      ? (process.argv[indiceCa + 1] as string)
      : await preguntar('\n2) Ruta del certificado CA descargado (ej.: C:\\Users\\vos\\Downloads\\ca.pem):\n> ');
  const ruta = resolve(rutaCa.replace(/^["']|["']$/g, ''));
  if (!existsSync(ruta)) throw new Error(`No existe el archivo ${ruta}`);
  const ca = pemEnUnaLinea(readFileSync(ruta, 'utf8'));
  console.log('   ✓ certificado leído');

  const actual = existsSync(ARCHIVO) ? readFileSync(ARCHIVO, 'utf8') : '';
  writeFileSync(
    ARCHIVO,
    actualizarEnv(actual, {
      DB_HOST: datos.host,
      DB_PORT: datos.port,
      DB_NAME: datos.database,
      DB_USER: datos.user,
      DB_PASSWORD: datos.password,
      DB_SSL: 'require',
      DB_SSL_CA: ca,
      DB_POOL_MAX: '5',
    }),
    'utf8',
  );
  console.log(`\n✓ Guardado en ${ARCHIVO}. Siguiente: npm run db:check\n`);
}

main().catch((error: unknown) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
