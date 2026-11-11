/**
 * VEKTORA — Configuración de la conexión a PostgreSQL (requisito R10).
 *
 * TODO dato de conexión sale de variables de entorno; ninguno está escrito en el código,
 * en el Dockerfile ni en los manifiestos. El mismo binario se conecta a:
 *
 *   · la base del docker-compose  (DB_HOST=db, DB_SSL=disable — red interna de Docker)
 *   · Aiven en la nube           (DB_SSL=require + DB_SSL_CA con el certificado de Aiven)
 *   · la base dentro de minikube  (DB_HOST=vektora-db, valores desde ConfigMap y Secret)
 *
 * | Variable      | Por defecto | Para qué                                                |
 * |---------------|-------------|---------------------------------------------------------|
 * | DB_HOST       | —           | servidor                                                |
 * | DB_PORT       | 5432        | puerto                                                  |
 * | DB_NAME       | —           | base                                                    |
 * | DB_USER       | —           | usuario (dueño de las tablas)                           |
 * | DB_PASSWORD   | —           | contraseña                                              |
 * | DB_SSL        | require     | `require` cifra; `disable` solo para redes internas     |
 * | DB_SSL_CA     | —           | certificado de la CA en PEM; con él se verifica el host |
 * | DB_POOL_MAX   | 5           | conexiones simultáneas (el plan gratis de Aiven da pocas)|
 *
 * `require` es el valor por defecto a propósito: olvidarse de la variable tiene que dar una
 * conexión cifrada, no una en texto plano.
 */

import { z } from 'zod';
import { ConfiguracionError } from '@/lib/errores';

export type ModoSsl = 'require' | 'disable';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: ModoSsl;
  /** PEM de la autoridad certificante. Si está, se verifica el certificado del servidor. */
  sslCa: string | undefined;
  poolMax: number;
}

const DbEnvSchema = z.object({
  DB_HOST: z.string().trim().min(1, 'falta DB_HOST'),
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  DB_NAME: z.string().trim().min(1, 'falta DB_NAME'),
  DB_USER: z.string().trim().min(1, 'falta DB_USER'),
  DB_PASSWORD: z.string().min(1, 'falta DB_PASSWORD'),
  DB_SSL: z
    .enum(['require', 'disable'], { error: 'DB_SSL tiene que ser "require" o "disable"' })
    .default('require'),
  DB_SSL_CA: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
});

/**
 * El certificado suele pegarse en una sola línea (paneles de Render, `.env`): se aceptan
 * los `\n` escritos como dos caracteres y se convierten en saltos de línea reales.
 */
export function normalizarPem(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  const limpio = valor.trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();
  if (limpio === '') return undefined;
  if (!limpio.includes('-----BEGIN CERTIFICATE-----')) {
    throw new ConfiguracionError(
      'DB_SSL_CA no parece un certificado PEM: tiene que empezar con -----BEGIN CERTIFICATE-----',
    );
  }
  return `${limpio}\n`;
}

/** Lee y valida la configuración. Lanza `ConfiguracionError` sin incluir ningún valor. */
export function cargarDbConfig(env: Record<string, string | undefined> = process.env): DbConfig {
  const presentes: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(env)) {
    if (clave.startsWith('DB_') && typeof valor === 'string' && valor.trim() !== '') {
      presentes[clave] = valor;
    }
  }

  const parsed = DbEnvSchema.safeParse(presentes);
  if (!parsed.success) {
    // Se nombra la VARIABLE (el camino del issue), nunca su valor.
    const faltan = parsed.error.issues
      .map((issue) => {
        const variable = String(issue.path[0] ?? 'DB_*');
        return issue.input === undefined ? `falta ${variable}` : `${variable} inválida`;
      })
      .join('; ');
    throw new ConfiguracionError(
      `configuración de base de datos incompleta: ${faltan}. Copiá .env.example a .env y completá los DB_*.`,
    );
  }

  const v = parsed.data;
  return {
    host: v.DB_HOST,
    port: v.DB_PORT,
    database: v.DB_NAME,
    user: v.DB_USER,
    password: v.DB_PASSWORD,
    ssl: v.DB_SSL,
    sslCa: normalizarPem(v.DB_SSL_CA),
    poolMax: v.DB_POOL_MAX,
  };
}

/** `true` si están las variables mínimas, sin lanzar. */
export function dbConfigurada(env: Record<string, string | undefined> = process.env): boolean {
  try {
    cargarDbConfig(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Traduce el modo a la opción `ssl` de `pg`:
 *
 *   · `disable`            → sin TLS (solo red interna: compose, minikube).
 *   · `require` + CA       → TLS verificando el certificado contra esa CA (lo recomendado
 *                            con Aiven: impide que alguien se haga pasar por el servidor).
 *   · `require` sin CA     → TLS sin verificar la CA, como `sslmode=require` de libpq. El
 *                            canal va cifrado; `npm run db:check` avisa que falta la CA.
 */
export function opcionesSsl(
  config: Pick<DbConfig, 'ssl' | 'sslCa'>,
): false | { rejectUnauthorized: boolean; ca?: string } {
  if (config.ssl === 'disable') return false;
  if (config.sslCa !== undefined) return { rejectUnauthorized: true, ca: config.sslCa };
  return { rejectUnauthorized: false };
}

/** Descripción para registros: NUNCA incluye la contraseña. */
export function describirDbConfig(config: DbConfig): string {
  const ssl =
    config.ssl === 'disable' ? 'sin SSL' : config.sslCa === undefined ? 'SSL (sin CA)' : 'SSL verificado';
  return `${config.user}@${config.host}:${config.port}/${config.database} · ${ssl} · pool ${config.poolMax}`;
}
