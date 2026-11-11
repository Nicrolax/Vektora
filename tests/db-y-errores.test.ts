import { describe, expect, it } from 'vitest';
import { validarSkill } from '@/lib/admin';
import { ESTADOS_BUSCABLES, normalizarFiltros } from '@/lib/consultas/busqueda';
import {
  cargarDbConfig,
  dbConfigurada,
  describirDbConfig,
  envolverError,
  esErrorDePostgres,
  esUuid,
  json,
  normalizarPem,
  opcionesSsl,
} from '@/lib/db';
import { EntregasService } from '@/lib/entregas';
import {
  ConfiguracionError,
  DatabaseError,
  DominioError,
  estadoHttpDe,
  MENSAJE_GENERICO,
  mensajeParaUsuario,
  PermisoDenegadoError,
  RecursoNoEncontradoError,
  ValidacionError,
  VektoraError,
} from '@/lib/errores';
import { AiError, AiExhaustedError } from '@/lib/ai/errors';
import { MatchingRepositoryError } from '@/lib/matching';
import { PlannerError, PlannerRepositoryError } from '@/lib/planner';
import { esHistorialInmutable, validarCambios } from '@/lib/proyectos';

const BASE = { DB_HOST: 'db', DB_NAME: 'vektora', DB_USER: 'vektora', DB_PASSWORD: 'secreta' };
const PEM = '-----BEGIN CERTIFICATE-----\\nMIIBfake\\n-----END CERTIFICATE-----';

describe('configuración de la base (R10)', () => {
  it('lee todo de variables de entorno con valores por defecto seguros', () => {
    const config = cargarDbConfig(BASE);
    expect(config).toMatchObject({ host: 'db', port: 5432, ssl: 'require', poolMax: 5, sslCa: undefined });
  });

  it('falta un dato → ConfiguracionError que nombra la variable y NO muestra valores', () => {
    let error: unknown;
    try {
      cargarDbConfig({ ...BASE, DB_HOST: '' });
    } catch (causa) {
      error = causa;
    }
    expect(error).toBeInstanceOf(ConfiguracionError);
    expect((error as Error).message).toContain('DB_HOST');
    expect((error as Error).message).not.toContain('secreta');
    expect(dbConfigurada({})).toBe(false);
  });

  it('DB_SSL solo admite require o disable', () => {
    expect(() => cargarDbConfig({ ...BASE, DB_SSL: 'quizas' })).toThrow(ConfiguracionError);
    expect(cargarDbConfig({ ...BASE, DB_SSL: 'disable' }).ssl).toBe('disable');
  });

  it('el certificado de Aiven se acepta en una línea con \\n escritos', () => {
    const pem = normalizarPem(PEM);
    expect(pem).toContain('-----BEGIN CERTIFICATE-----\nMIIBfake\n');
    expect(() => normalizarPem('no es un pem')).toThrow(ConfiguracionError);
    expect(normalizarPem('  ')).toBeUndefined();
  });

  it('SSL: sin cifrar, cifrado sin CA o cifrado verificando la CA', () => {
    expect(opcionesSsl({ ssl: 'disable', sslCa: undefined })).toBe(false);
    expect(opcionesSsl({ ssl: 'require', sslCa: undefined })).toEqual({ rejectUnauthorized: false });
    expect(opcionesSsl({ ssl: 'require', sslCa: 'PEM' })).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
  });

  it('la descripción para registros nunca incluye la contraseña', () => {
    expect(describirDbConfig(cargarDbConfig(BASE))).not.toContain('secreta');
  });
});

describe('cliente pg', () => {
  it('json() serializa para parámetros jsonb (un array no se convierte en array de PG)', () => {
    expect(json([1, 'a'])).toBe('[1,"a"]');
    expect(json(undefined)).toBe('null');
  });

  it('reconoce uuids', () => {
    expect(esUuid('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(esUuid("1' or '1'='1")).toBe(false);
    expect(esUuid(42)).toBe(false);
  });

  it('solo envuelve errores de PostgreSQL; los de dominio salen tal cual', () => {
    const pg = Object.assign(new Error('duplicate key'), { code: '23505', severity: 'ERROR', constraint: 'x' });
    expect(esErrorDePostgres(pg)).toBe(true);
    const envuelto = envolverError(pg);
    expect(envuelto).toBeInstanceOf(DatabaseError);
    expect((envuelto as DatabaseError).sqlstate).toBe('23505');

    const dominio = new ValidacionError('dato inválido');
    expect(envolverError(dominio)).toBe(dominio);
    const red = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(envolverError(red)).toBe(red);
  });
});

describe('jerarquía de excepciones (R5, R8)', () => {
  it('todas heredan de VektoraError, que es abstracta', () => {
    for (const error of [
      new ValidacionError('x'),
      new PermisoDenegadoError('x'),
      new RecursoNoEncontradoError('x'),
      new DatabaseError('x'),
      new PlannerRepositoryError('x', '23514'),
      new MatchingRepositoryError('x', '23505'),
      new PlannerError('x'),
      new AiError({ code: 'timeout', message: 'x' }),
      new AiExhaustedError([]),
    ]) {
      expect(error).toBeInstanceOf(VektoraError);
      expect(error).toBeInstanceOf(Error);
    }
    expect(new PlannerError('x')).toBeInstanceOf(DominioError);
    expect(new PlannerRepositoryError('x')).toBeInstanceOf(DatabaseError);
  });

  it('cada subclase conserva su nombre y su estado HTTP', () => {
    expect(new ValidacionError('x').name).toBe('ValidacionError');
    expect(estadoHttpDe(new ValidacionError('x'))).toBe(400);
    expect(estadoHttpDe(new PermisoDenegadoError('x'))).toBe(403);
    expect(estadoHttpDe(new RecursoNoEncontradoError('x'))).toBe(404);
    expect(estadoHttpDe(new TypeError('x'))).toBe(500);
  });

  it('los repositorios siguen exponiendo el SQLSTATE', () => {
    expect(new PlannerRepositoryError('ciclo', '23514').isDagViolation).toBe(true);
    expect(new MatchingRepositoryError('carrera', '23505').isAlreadyAssigned).toBe(true);
    expect(new PlannerRepositoryError('x', '23514').code).toBe('23514');
  });

  it('un error interno nunca llega a la interfaz con su texto', () => {
    const registros: string[] = [];
    const interno = new TypeError("Cannot read properties of undefined (reading 'rows') at /app/lib/db/client.ts:42");
    expect(mensajeParaUsuario(interno, (m) => registros.push(m))).toBe(MENSAJE_GENERICO);
    expect(registros).toHaveLength(1);
  });

  it('un error de la base muestra un mensaje genérico, no el SQL', () => {
    const error = new DatabaseError('relation "public.projects" violates foreign key "x"', '23503');
    const mensaje = mensajeParaUsuario(error, () => undefined);
    expect(mensaje).not.toContain('public.projects');
    expect(mensaje).toContain('dependen');
  });

  it('los errores de dominio sí muestran su mensaje (ya dice qué hacer)', () => {
    expect(mensajeParaUsuario(new ValidacionError('El título es muy corto.'))).toBe('El título es muy corto.');
  });

  it('la IA traduce la causa a un texto entendible', () => {
    expect(mensajeParaUsuario(new AiExhaustedError([]))).toContain('no está configurada');
    expect(mensajeParaUsuario(new AiError({ code: 'rate_limit', message: '429 too many' }))).toContain('cuota');
  });

  it('detecta el rechazo de las tablas append-only', () => {
    expect(esHistorialInmutable(new DatabaseError('VEKTORA/SEC: la tabla audit_logs es append-only', '42501'))).toBe(true);
    expect(esHistorialInmutable(new DatabaseError('otra cosa', '42501'))).toBe(false);
  });
});

describe('validaciones de los formularios', () => {
  it('búsqueda: normaliza filtros y rechaza los inválidos', () => {
    expect(normalizarFiltros({})).toMatchObject({ texto: null, estado: null, orden: 'recientes', soloSinAsignar: false });
    expect(normalizarFiltros({ q: '  api ', skill: 'React', min: '10', libres: 'si', orden: 'codigo' })).toMatchObject({
      texto: 'api',
      skill: 'react',
      presupuestoMin: 10,
      soloSinAsignar: true,
      orden: 'codigo',
    });
    expect(normalizarFiltros({ orden: 'drop table' }).orden).toBe('recientes');
    expect(() => normalizarFiltros({ estado: 'hackeado' })).toThrow(ValidacionError);
    expect(() => normalizarFiltros({ min: '-1' })).toThrow(ValidacionError);
    expect(() => normalizarFiltros({ min: '500', max: '100' })).toThrow(ValidacionError);
    expect(ESTADOS_BUSCABLES).toContain('submitted');
  });

  it('proyecto: título de 3 a 200 caracteres y visibilidad conocida', () => {
    expect(validarCambios({ title: '  Mi proyecto ', description: '', visibility: 'public' })).toEqual({
      title: 'Mi proyecto',
      description: null,
      visibility: 'public',
    });
    expect(() => validarCambios({ title: 'ab', description: '', visibility: 'private' })).toThrow(ValidacionError);
    expect(() => validarCambios({ title: 'Válido', description: '', visibility: 'secreto' })).toThrow(ValidacionError);
  });

  it('skill: identificador en minúsculas con guiones', () => {
    expect(validarSkill({ slug: 'Diseno-UX', name: 'Diseño UX', category: ' Design ' })).toEqual({
      slug: 'diseno-ux',
      name: 'Diseño UX',
      category: 'design',
    });
    expect(() => validarSkill({ slug: 'con espacios', name: 'Nombre', category: '' })).toThrow(ValidacionError);
    expect(() => validarSkill({ slug: 'ok', name: 'x', category: '' })).toThrow(ValidacionError);
  });

  it('entrega: detecta los criterios sin evidencia', () => {
    expect(EntregasService.faltantes(['AC-1', 'AC-2'], { 'AC-1': 'ok', 'AC-2': '  ' })).toEqual(['AC-2']);
  });
});
