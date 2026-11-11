import { describe, expect, it } from 'vitest';
import { normalizarPem } from '@/lib/db';
import { actualizarEnv, leerServiceUri, pemEnUnaLinea } from '@/lib/db/uri';

describe('carga de la conexión de Aiven en .env', () => {
  it('interpreta la Service URI, con caracteres escapados en la contraseña', () => {
    expect(leerServiceUri('postgres://avnadmin:a%40b%2Fc@pg-x.aivencloud.com:12345/defaultdb?sslmode=require')).toEqual({
      host: 'pg-x.aivencloud.com',
      port: '12345',
      database: 'defaultdb',
      user: 'avnadmin',
      password: 'a@b/c',
    });
  });

  it('rechaza lo que no es una URI de PostgreSQL o le falta la contraseña', () => {
    expect(() => leerServiceUri('no es una uri')).toThrow('Service URI');
    expect(() => leerServiceUri('mysql://u:p@h:1/d')).toThrow('postgres://');
    expect(() => leerServiceUri('postgres://avnadmin@h:1/d')).toThrow('contraseña');
  });

  it('el PEM queda en una línea y lib/db lo reconstruye igual', () => {
    const pem = '-----BEGIN CERTIFICATE-----\r\nMIIB\r\nABCD\r\n-----END CERTIFICATE-----\r\n';
    const linea = pemEnUnaLinea(pem);
    expect(linea).not.toContain('\n');
    expect(normalizarPem(linea)).toBe('-----BEGIN CERTIFICATE-----\nMIIB\nABCD\n-----END CERTIFICATE-----\n');
    expect(() => pemEnUnaLinea('hola')).toThrow('PEM');
  });

  it('reemplaza las claves existentes, agrega las nuevas y conserva el resto', () => {
    const antes = '# comentario\nAUTH_SECRET=abc\nDB_HOST=viejo\n';
    const despues = actualizarEnv(antes, { DB_HOST: 'nuevo', DB_SSL: 'require' });
    expect(despues).toContain('# comentario\nAUTH_SECRET=abc\nDB_HOST=nuevo\n');
    expect(despues).toContain('DB_SSL=require\n');
    expect(despues.match(/DB_HOST=/g)).toHaveLength(1);
  });
});
