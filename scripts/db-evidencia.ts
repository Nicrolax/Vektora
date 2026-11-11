/**
 * VEKTORA — Evidencia de la base para la entrega.
 *
 *   npm run db:evidencia
 *
 * Hace dos SELECT de solo lectura contra la base de `DB_*` (Aiven, el compose o minikube)
 * y los muestra junto con el SQL que se ejecutó:
 *
 *   1. La conexión actual vista desde el servidor (`pg_stat_ssl`): si va cifrada, con qué
 *      versión de TLS y con qué usuario. Es la prueba de que la app habla con la base por SSL.
 *   2. Las últimas cuentas `@vektora.test`: una cuenta creada desde la interfaz aparece acá.
 *
 * No imprime el host a propósito: el nombre del servicio de Aiven identifica a la persona
 * que lo creó y esta salida se pega en capturas.
 */

import '@/lib/env';

import { errorMessage } from '@/lib/ai/errors';
import { cerrarDb, getDb } from '@/lib/db';

const amarillo = (texto: string): string => `\x1b[33m${texto}\x1b[0m`;

const SQL_CONEXION = `select split_part(version(), ' ', 2) as postgres, s.ssl, s.version as tls, s.cipher, current_user
  from pg_stat_ssl s where s.pid = pg_backend_pid()`;

const SQL_CUENTAS = `select u.email, u.role, u.status,
       to_char(u.created_at at time zone 'America/Montevideo', 'YYYY-MM-DD HH24:MI') as creada
  from public.users u where u.email like '%@vektora.test'
 order by u.created_at desc limit 4`;

async function main(): Promise<void> {
  const db = getDb();
  console.log(amarillo(`base=> ${SQL_CONEXION};`));
  console.table(await db.query(SQL_CONEXION));
  console.log(amarillo(`base=> ${SQL_CUENTAS};`));
  console.table(await db.query(SQL_CUENTAS));
}

main()
  .finally(() => cerrarDb())
  .catch((error: unknown) => {
    console.error(`\nVEKTORA/DB: la consulta falló -> ${errorMessage(error)}\n`);
    process.exitCode = 1;
  });
