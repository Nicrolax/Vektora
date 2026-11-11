/**
 * VEKTORA — Utilidades PURAS para cargar la conexión de Aiven en `.env`
 * (las usa `scripts/configurar-db.ts`; se prueban en tests/db-uri.test.ts).
 */

export interface DatosConexion {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

/** Interpreta una URI `postgres://usuario:clave@host:puerto/base?…`. */
export function leerServiceUri(uri: string): DatosConexion {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('Eso no parece una URI. Copiala entera desde Aiven → Overview → Service URI.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('La URI tiene que empezar con postgres:// (la «Service URI» de PostgreSQL).');
  }
  const datos = {
    host: url.hostname,
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'defaultdb',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
  if (datos.host === '' || datos.user === '' || datos.password === '') {
    throw new Error('A la URI le falta el host, el usuario o la contraseña.');
  }
  return datos;
}

/** PEM en una línea, con los saltos escritos como `\n` (lo lee lib/db/config.ts). */
export function pemEnUnaLinea(pem: string): string {
  const limpio = pem.replace(/\r/g, '').trim();
  if (!limpio.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new Error('El archivo no es un certificado PEM (tiene que empezar con -----BEGIN CERTIFICATE-----).');
  }
  return limpio.split('\n').join('\\n');
}

/** Reemplaza o agrega claves en el texto de un .env, sin tocar las demás líneas. */
export function actualizarEnv(texto: string, valores: Record<string, string>): string {
  const pendientes = new Map(Object.entries(valores));
  const lineas = texto.split(/\r?\n/).map((linea) => {
    const clave = /^\s*([A-Z0-9_]+)\s*=/.exec(linea)?.[1];
    if (clave === undefined || !pendientes.has(clave)) return linea;
    const valor = pendientes.get(clave) ?? '';
    pendientes.delete(clave);
    return `${clave}=${valor}`;
  });
  while (lineas.length > 0 && lineas[lineas.length - 1] === '') lineas.pop();
  if (pendientes.size > 0) {
    lineas.push('', '# --- Base de datos (escrito por npm run db:configurar) ---');
    for (const [clave, valor] of pendientes) lineas.push(`${clave}=${valor}`);
  }
  return `${lineas.join('\n')}\n`;
}
