/**
 * VEKTORA — API pública de la capa de datos.
 *
 *   import { getDb, json } from '@/lib/db';
 *
 *   // Como dueño de las tablas (agentes autónomos, login, telemetría): RLS no aplica.
 *   const filas = await getDb().query('select id from public.skills where slug = $1', [slug]);
 *
 *   // Como la persona: `auth.uid()` = userId y las políticas RLS se aplican.
 *   const mios = await getDb().asUser(userId, (tx) => tx.query('select id from public.projects'));
 *
 * Solo servidor: `pg` abre sockets TCP y no existe en el navegador.
 */

export { cerrarDb, crearDb, envolverError, esErrorDePostgres, esUuid, getDb, json } from './client';
export type { Consultor, Db, Parametro } from './client';

export {
  cargarDbConfig,
  dbConfigurada,
  describirDbConfig,
  normalizarPem,
  opcionesSsl,
} from './config';
export type { DbConfig, ModoSsl } from './config';

export { toNumber } from './types';
export type * from './types';
