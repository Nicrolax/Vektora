/**
 * VEKTORA — Cliente de PostgreSQL.
 *
 * Es la ÚNICA puerta a la base. Tres operaciones, tres requisitos de la consigna:
 *
 *   · `query(texto, parámetros)` — **R9, consultas preparadas.** El texto lleva `$1, $2…`
 *     y los valores viajan aparte, en el protocolo extendido de PostgreSQL. Es el
 *     equivalente exacto de `PreparedStatement` en Java: un valor nunca se concatena al
 *     SQL, así que no hay inyección posible. No existe otra forma de ejecutar SQL.
 *
 *   · `transaction(fn)` — **R7, transacciones.** `BEGIN`, ejecuta `fn` con una conexión
 *     dedicada, `COMMIT` si termina bien y `ROLLBACK` si lanza. Lo que `fn` escribió en
 *     varias tablas queda todo o no queda nada.
 *
 *   · `asUser(id, fn)` — la identidad de la PERSONA. Es una transacción que además hace
 *     `SET LOCAL ROLE authenticated` y fija `request.jwt.claim.sub`, de modo que
 *     `auth.uid()` devuelve ese id y las políticas RLS del esquema se aplican igual que con
 *     Supabase. Fuera de `asUser` se opera como el dueño de las tablas: esa es la identidad
 *     de los agentes autónomos, del login y de la telemetría.
 *
 * Errores: solo los de PostgreSQL (traen SQLSTATE y `severity`) se envuelven en
 * `DatabaseError`. Un error de dominio lanzado dentro de una transacción provoca el
 * ROLLBACK y sale tal cual, para que quien lo capture siga sabiendo qué fue.
 */

import pg from 'pg';
import { DatabaseError, ValidacionError } from '@/lib/errores';
import { cargarDbConfig, opcionesSsl, type DbConfig } from './config';

/** Lo que se puede pasar como parámetro de una consulta. */
export type Parametro = string | number | boolean | null | Date | readonly string[] | readonly number[];

/** Algo que ejecuta consultas: el pool o una conexión dentro de una transacción. */
export interface Consultor {
  /** Ejecuta una consulta parametrizada y devuelve las filas. */
  query<T extends object = Record<string, unknown>>(
    texto: string,
    parametros?: readonly Parametro[],
  ): Promise<T[]>;
  /** Primera fila o `null`. */
  one<T extends object = Record<string, unknown>>(
    texto: string,
    parametros?: readonly Parametro[],
  ): Promise<T | null>;
  /** Cantidad de filas afectadas (INSERT/UPDATE/DELETE). */
  execute(texto: string, parametros?: readonly Parametro[]): Promise<number>;
}

export interface Db extends Consultor {
  transaction<T>(fn: (tx: Consultor) => Promise<T>): Promise<T>;
  asUser<T>(userId: string, fn: (tx: Consultor) => Promise<T>): Promise<T>;
  /** `select 1` con tope de tiempo; lo usa `/health`. */
  ping(timeoutMs?: number): Promise<boolean>;
  /** `true` si la conexión actual va cifrada con TLS. */
  usaSsl(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Parámetro `jsonb`. `pg` convierte un array JS en un array de PostgreSQL, no en JSON: un
 * `jsonb` siempre se pasa con `json(valor)` y se castea en el SQL (`$1::jsonb`).
 */
export function json(valor: unknown): string {
  return JSON.stringify(valor ?? null);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && UUID_RE.test(valor);
}

interface PgErrorLike {
  code?: unknown;
  severity?: unknown;
  message?: unknown;
  detail?: unknown;
  hint?: unknown;
  constraint?: unknown;
}

/** Un error de PostgreSQL trae SQLSTATE de 5 caracteres y `severity`. */
export function esErrorDePostgres(error: unknown): error is Error & PgErrorLike {
  if (!(error instanceof Error)) return false;
  const candidato = error as PgErrorLike;
  return (
    typeof candidato.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(candidato.code) &&
    typeof candidato.severity === 'string'
  );
}

/** Envuelve SOLO los errores de PostgreSQL. El resto sale tal cual. */
export function envolverError(error: unknown): unknown {
  if (!esErrorDePostgres(error)) return error;
  return new DatabaseError(
    error.message,
    error.code as string,
    { detail: error.detail, hint: error.hint, constraint: error.constraint },
    { cause: error },
  );
}

// --- Conversión de tipos --------------------------------------------------------------
// Se imita lo que devolvía PostgREST para que el resto del código no cambie:
//   · bigint (count, sum de enteros) -> number (los recuentos caben de sobra)
//   · numeric -> string (se normaliza con `toNumber`; no se pierde precisión en dinero)
//   · timestamptz / timestamp -> string ISO 8601
//   · date -> 'AAAA-MM-DD'
const OID_INT8 = 20;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_DATE = 1082;

const tipos = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format === undefined || format === 'text') {
      if (oid === OID_INT8) return (valor: string) => Number(valor);
      if (oid === OID_DATE) return (valor: string) => valor;
      if (oid === OID_TIMESTAMPTZ || oid === OID_TIMESTAMP) {
        const base = pg.types.getTypeParser(oid, 'text') as (valor: string) => Date;
        return (valor: string) => {
          const fecha = base(valor);
          return Number.isNaN(fecha.getTime()) ? valor : fecha.toISOString();
        };
      }
    }
    return pg.types.getTypeParser(oid, format ?? 'text');
  },
};

function consultorDe(ejecutor: pg.Pool | pg.PoolClient): Consultor {
  async function correr(texto: string, parametros: readonly Parametro[] = []) {
    try {
      return await ejecutor.query({ text: texto, values: [...parametros] });
    } catch (error) {
      throw envolverError(error);
    }
  }
  return {
    async query<T extends object>(texto: string, parametros?: readonly Parametro[]) {
      return (await correr(texto, parametros)).rows as T[];
    },
    async one<T extends object>(texto: string, parametros?: readonly Parametro[]) {
      return ((await correr(texto, parametros)).rows[0] as T | undefined) ?? null;
    },
    async execute(texto: string, parametros?: readonly Parametro[]) {
      return (await correr(texto, parametros)).rowCount ?? 0;
    },
  };
}

export function crearDb(config: DbConfig = cargarDbConfig()): Db {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: opcionesSsl(config),
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'vektora',
    types: tipos,
  });

  // Una conexión ociosa que el servidor cierra (Aiven lo hace al apagarse) emite 'error'
  // en el pool. Sin este manejador, el proceso entero se cae por un evento no atendido.
  pool.on('error', (error) => {
    console.warn(`[vektora/db] conexión ociosa cerrada por el servidor: ${error.message}`);
  });

  const base = consultorDe(pool);

  async function transaction<T>(
    fn: (tx: Consultor) => Promise<T>,
    preparar?: (cliente: pg.PoolClient) => Promise<void>,
  ): Promise<T> {
    let cliente: pg.PoolClient;
    try {
      cliente = await pool.connect();
    } catch (error) {
      throw envolverError(error);
    }
    let rota = false;
    try {
      await cliente.query('begin');
      if (preparar !== undefined) await preparar(cliente);
      const resultado = await fn(consultorDe(cliente));
      await cliente.query('commit');
      return resultado;
    } catch (error) {
      // Si el ROLLBACK también falla, la conexión está rota: se descarta en vez de
      // devolverla al pool con una transacción a medias.
      await cliente.query('rollback').catch(() => {
        rota = true;
      });
      throw envolverError(error);
    } finally {
      cliente.release(rota);
    }
  }

  return {
    ...base,
    transaction: (fn) => transaction(fn),

    asUser(userId, fn) {
      if (!esUuid(userId)) {
        // No se llega a la base con un id que no es uuid: `set_config` lo aceptaría y
        // `auth.uid()` reventaría después con un error mucho menos claro.
        return Promise.reject(new ValidacionError('Identificador de usuario inválido'));
      }
      return transaction(fn, async (cliente) => {
        // `SET LOCAL` y `set_config(..., true)`: ambos mueren con la transacción, así que
        // la identidad nunca queda pegada a una conexión que vuelve al pool.
        await cliente.query('set local role authenticated');
        await cliente.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      });
    },

    async ping(timeoutMs = 3_000) {
      let temporizador: NodeJS.Timeout | undefined;
      const limite = new Promise<boolean>((resolve) => {
        temporizador = setTimeout(() => resolve(false), timeoutMs);
      });
      const consulta = pool
        .query('select 1 as ok')
        .then((r) => r.rows[0]?.ok === 1)
        .catch(() => false);
      try {
        return await Promise.race([consulta, limite]);
      } finally {
        clearTimeout(temporizador);
      }
    },

    async usaSsl() {
      // `pg_stat_ssl` dice si ESTA conexión va cifrada; no se fía de la configuración.
      const fila = await base.one<{ ssl: boolean | null }>(
        'select ssl from pg_stat_ssl where pid = pg_backend_pid()',
      );
      return fila?.ssl === true;
    },

    close: () => pool.end(),
  };
}

let compartida: Db | null = null;

/**
 * Cliente compartido por el proceso, perezoso: importar este módulo no exige variables de
 * entorno, así `next build` y las pruebas no necesitan una base.
 */
export function getDb(): Db {
  if (compartida === null) compartida = crearDb();
  return compartida;
}

/** Cierra el pool compartido (scripts que terminan). */
export async function cerrarDb(): Promise<void> {
  if (compartida === null) return;
  const actual = compartida;
  compartida = null;
  await actual.close();
}
