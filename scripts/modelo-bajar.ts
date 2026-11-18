/**
 * VEKTORA — Baja un modelo GGUF a `modelos/` y verifica su SHA256.
 *
 *   npm run modelo:bajar              # el modelo por defecto (Qwen3-1.7B Q4_K_M, ~1,3 GB)
 *   npm run modelo:bajar -- prueba    # modelo diminuto (1 MB) para pruebas de humo y CI
 *   npm run modelo:bajar -- --lista   # catálogo, sin bajar nada
 *
 * El modelo es un archivo y no una API: después de bajarlo, la inferencia corre sin
 * internet (`docker compose up inferencia`). Cada entrada fija la REVISIÓN exacta del
 * repositorio (un commit, no `main`) y el SHA256 del archivo: si lo que llega no coincide,
 * se borra y el script falla. Nada se usa sin verificar.
 *
 * `modelos/` está en .gitignore: los pesos nunca van a git.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as ReadableStreamDeNode } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';

interface ModeloCatalogo {
  descripcion: string;
  repo: string;
  /** Commit del repositorio en Hugging Face: un `main` movible rompería la verificación. */
  revision: string;
  archivo: string;
  bytes: number;
  sha256: string;
  licencia: string;
}

const CATALOGO = {
  'qwen3-1.7b-q4': {
    descripcion: 'Modelo por defecto del planner y del juez (cuantizado Q4_K_M)',
    repo: 'ggml-org/Qwen3-1.7B-GGUF',
    revision: 'daeb8e2d528a760970442092f6bf1e55c3b659eb',
    archivo: 'Qwen3-1.7B-Q4_K_M.gguf',
    bytes: 1_282_439_264,
    sha256: 'd2387ca2dbfee2ffabce7120d3770dadca0b293052bc2f0e138fdc940d9bc7b5',
    licencia: 'Apache-2.0 (ficha de Qwen/Qwen3-1.7B y de ggml-org/Qwen3-1.7B-GGUF)',
  },
  prueba: {
    descripcion: 'Modelo diminuto SOLO para pruebas de humo: no genera texto útil',
    repo: 'ggml-org/models-moved',
    revision: '499bc8821c6b12b4e53c5bffcb21ec206f212d81',
    archivo: 'tinyllamas/stories260K.gguf',
    bytes: 1_185_376,
    sha256: '270cba1bd5109f42d03350f60406024560464db173c0e387d91f0426d3bd256d',
    licencia: 'MIT, proyecto llama2.c (a confirmar: el repositorio no declara licencia)',
  },
} as const satisfies Record<string, ModeloCatalogo>;

type NombreModelo = keyof typeof CATALOGO;

const DIRECTORIO = path.resolve(process.cwd(), 'modelos');

function esNombreModelo(valor: string): valor is NombreModelo {
  return Object.hasOwn(CATALOGO, valor);
}

async function sha256DeArchivo(ruta: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(ruta), hash);
  return hash.digest('hex');
}

function mostrarCatalogo(): void {
  console.log('Modelos disponibles (npm run modelo:bajar -- <nombre>):\n');
  for (const [nombre, modelo] of Object.entries(CATALOGO)) {
    const megas = (modelo.bytes / 1_000_000).toFixed(1);
    console.log(`  ${nombre.padEnd(15)} ${megas.padStart(8)} MB  ${modelo.descripcion}`);
    console.log(`  ${''.padEnd(15)} ${''.padStart(8)}     licencia: ${modelo.licencia}`);
  }
}

async function bajar(nombre: NombreModelo): Promise<void> {
  const modelo: ModeloCatalogo = CATALOGO[nombre];
  const destino = path.join(DIRECTORIO, path.basename(modelo.archivo));
  const parcial = `${destino}.parcial`;

  if (existsSync(destino)) {
    process.stdout.write(`Ya existe ${path.relative(process.cwd(), destino)}; verificando SHA256… `);
    if ((await sha256DeArchivo(destino)) === modelo.sha256) {
      console.log('correcto. No hace falta bajarlo de nuevo.');
      return;
    }
    console.log('NO coincide. Lo borro y lo bajo de nuevo.');
    await rm(destino);
  }

  await mkdir(DIRECTORIO, { recursive: true });
  const url = `https://huggingface.co/${modelo.repo}/resolve/${modelo.revision}/${modelo.archivo}`;
  console.log(`Bajando ${modelo.archivo} (${(modelo.bytes / 1_000_000).toFixed(1)} MB) de ${modelo.repo}…`);

  const respuesta = await fetch(url);
  if (!respuesta.ok || respuesta.body === null) {
    throw new Error(
      `Hugging Face respondió ${respuesta.status} para ${url}. ` +
        'Revisá tu conexión, o si el archivo sigue publicado en esa revisión.',
    );
  }

  const hash = createHash('sha256');
  let recibidos = 0;
  let ultimoAviso = 0;
  // El `fetch` de Node devuelve un ReadableStream de node:stream/web; los tipos del DOM
  // lo declaran como el del navegador, que es el mismo objeto con otra firma.
  const cuerpo = Readable.fromWeb(respuesta.body as ReadableStreamDeNode<Uint8Array>);
  cuerpo.on('data', (trozo: Buffer) => {
    hash.update(trozo);
    recibidos += trozo.length;
    const porcentaje = Math.floor((recibidos / modelo.bytes) * 100);
    if (porcentaje >= ultimoAviso + 10) {
      ultimoAviso = porcentaje - (porcentaje % 10);
      console.log(`  ${ultimoAviso} %`);
    }
  });

  try {
    await pipeline(cuerpo, createWriteStream(parcial));
  } catch (error) {
    await rm(parcial, { force: true });
    throw error;
  }

  const calculado = hash.digest('hex');
  const { size } = await stat(parcial);
  if (calculado !== modelo.sha256 || size !== modelo.bytes) {
    await rm(parcial, { force: true });
    throw new Error(
      `El archivo bajado no coincide con el catálogo (SHA256 ${calculado}, ${size} bytes; ` +
        `se esperaba ${modelo.sha256}, ${modelo.bytes} bytes). Lo borré: no se usa un ` +
        'modelo sin verificar. Volvé a intentarlo; si se repite, el archivo cambió en origen.',
    );
  }

  await rename(parcial, destino);
  console.log(`Listo: ${path.relative(process.cwd(), destino)} (SHA256 verificado).`);
}

async function main(): Promise<void> {
  const argumento = process.argv[2] ?? 'qwen3-1.7b-q4';
  if (argumento === '--lista') {
    mostrarCatalogo();
    return;
  }
  if (!esNombreModelo(argumento)) {
    console.error(`No conozco el modelo «${argumento}».\n`);
    mostrarCatalogo();
    process.exitCode = 1;
    return;
  }
  await bajar(argumento);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
