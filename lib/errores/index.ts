/**
 * VEKTORA — Jerarquía de excepciones propias (requisitos R5 y R8).
 *
 * Todas las excepciones del dominio heredan de `VektoraError`, que es ABSTRACTA: nadie
 * lanza un «error de VEKTORA» genérico, se lanza uno que dice qué pasó. Cada subclase
 * define dos cosas:
 *
 *   · `codigo`      — identificador estable para registros y pruebas.
 *   · `estadoHttp`  — cómo responde una ruta HTTP cuando el error llega hasta ella.
 *
 * Y la regla que sostiene R8: el único camino de un error a la interfaz es
 * `mensajeParaUsuario()`. Un error que NO es de esta jerarquía (un `TypeError`, un fallo de
 * red, un error de la base sin envolver) nunca muestra su texto: se registra en el
 * servidor y la persona ve un mensaje genérico que dice qué hacer. Así no se filtran
 * nombres de tablas, rutas de archivos ni trazas.
 *
 *   VektoraError (abstracta)
 *   ├── ValidacionError            400  datos de entrada inválidos
 *   ├── AuthError                  401  sin sesión o credenciales incorrectas
 *   ├── PermisoDenegadoError       403  hay sesión, pero el rol no alcanza
 *   ├── RecursoNoEncontradoError   404  no existe o no se puede ver (no se distingue)
 *   ├── ConflictoError             409  el estado actual no admite la operación
 *   ├── ConfiguracionError         503  falta o sobra una variable de entorno
 *   ├── DatabaseError              500  fallo de PostgreSQL, con su SQLSTATE
 *   │   └── *RepositoryError            (planner, providers, matching, qa)
 *   └── DominioError               422  una regla de negocio no se pudo cumplir
 *       └── PlannerError, MatchingError, ProviderError, QaError…
 *
 * `AiError` (en `lib/ai/errors.ts`) también hereda de `VektoraError`.
 */

export abstract class VektoraError extends Error {
  /** Identificador estable, en minúsculas y con guiones bajos. */
  abstract readonly codigo: string;
  /** Estado HTTP con el que responde una ruta cuando el error llega hasta ella. */
  abstract readonly estadoHttp: number;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    // `new.target.name` y no un literal: cada subclase queda con su propio nombre sin que
    // haya que acordarse de asignarlo.
    this.name = new.target.name;
  }

  /**
   * Texto que puede ver la persona. Por defecto es el propio mensaje: las subclases que
   * pueden llevar detalles internos (como `DatabaseError`) lo sobrescriben.
   */
  get mensajeUsuario(): string {
    return this.message;
  }
}

/** Un dato de entrada no cumple las reglas. El mensaje dice QUÉ corregir. */
export class ValidacionError extends VektoraError {
  readonly codigo = 'validacion';
  readonly estadoHttp = 400;
  /** Campo del formulario al que se refiere, si se sabe. */
  readonly campo: string | undefined;

  constructor(message: string, campo?: string) {
    super(message);
    this.campo = campo;
  }
}

/** No hay sesión, o el correo y la contraseña no coinciden. */
export class AuthError extends VektoraError {
  readonly codigo = 'autenticacion';
  readonly estadoHttp = 401;
}

/** Hay sesión, pero el rol de la cuenta no permite la operación. */
export class PermisoDenegadoError extends VektoraError {
  readonly codigo = 'permiso_denegado';
  readonly estadoHttp = 403;
}

/**
 * El recurso no existe O la persona no puede verlo. A propósito no se distinguen: revelar
 * la diferencia permitiría averiguar qué identificadores existen.
 */
export class RecursoNoEncontradoError extends VektoraError {
  readonly codigo = 'no_encontrado';
  readonly estadoHttp = 404;
}

/** El estado actual no admite la operación (por ejemplo, borrar algo con historial). */
export class ConflictoError extends VektoraError {
  readonly codigo = 'conflicto';
  readonly estadoHttp = 409;
}

/** Falta o es inválida una variable de entorno. Nunca lleva el VALOR en el mensaje. */
export class ConfiguracionError extends VektoraError {
  readonly codigo = 'configuracion';
  readonly estadoHttp = 503;

  override get mensajeUsuario(): string {
    return 'El servicio no está configurado por completo. Avisale a quien administra la instalación.';
  }
}

/**
 * Fallo de PostgreSQL. Conserva el SQLSTATE (`23505`, `23514`…) para que el código que
 * lo captura pueda decidir sin parsear mensajes, pero NUNCA muestra el texto de la base a
 * la persona: puede contener nombres de tablas, columnas o valores.
 */
export class DatabaseError extends VektoraError {
  readonly codigo: string = 'base_de_datos';
  readonly estadoHttp: number = 500;
  /** SQLSTATE de PostgreSQL, si el fallo vino de la base. */
  readonly sqlstate: string | undefined;
  readonly details: unknown;

  constructor(message: string, sqlstate?: string, details?: unknown, options?: { cause?: unknown }) {
    super(message, options);
    this.sqlstate = sqlstate;
    this.details = details;
  }

  /** Compatibilidad con los repositorios, que históricamente exponían `code`. */
  get code(): string | undefined {
    return this.sqlstate;
  }

  /** `23xxx`: violación de integridad (única, foránea, check). */
  get esViolacionDeIntegridad(): boolean {
    return this.sqlstate !== undefined && this.sqlstate.startsWith('23');
  }

  override get mensajeUsuario(): string {
    if (this.sqlstate === '23505') return 'Ya existe un registro con esos datos.';
    if (this.sqlstate === '23503') {
      return 'No se puede completar: hay otros datos que dependen de este registro.';
    }
    if (this.sqlstate === '42501') return 'No tenés permiso para hacer eso.';
    return 'No se pudo acceder a la base de datos. Probá de nuevo en unos segundos.';
  }
}

/**
 * Una regla de negocio no se pudo cumplir (el planificador no logró un grafo válido, el
 * juez no pudo tomar un entregable…). Sus mensajes los escribe VEKTORA, así que se pueden
 * mostrar.
 */
export class DominioError extends VektoraError {
  readonly codigo: string = 'dominio';
  readonly estadoHttp: number = 422;
}

/** Mensaje genérico para errores que no son de la jerarquía. */
export const MENSAJE_GENERICO =
  'Ocurrió un error inesperado. Probá de nuevo y, si se repite, avisale a quien administra la instalación.';

export function esVektoraError(error: unknown): error is VektoraError {
  return error instanceof VektoraError;
}

/**
 * ÚNICO camino de un error a la interfaz (R8).
 *
 * Si es de la jerarquía, devuelve su `mensajeUsuario`. Si no, lo registra en el servidor
 * —con todo el detalle, para poder diagnosticar— y devuelve un mensaje genérico.
 */
export function mensajeParaUsuario(
  error: unknown,
  registrar: (mensaje: string, error: unknown) => void = (mensaje, causa) =>
    console.error(mensaje, causa),
): string {
  if (error instanceof VektoraError) {
    if (error instanceof DatabaseError || error instanceof ConfiguracionError) {
      registrar(`[vektora] ${error.name}: ${error.message}`, error);
    }
    return error.mensajeUsuario;
  }
  registrar('[vektora] error no controlado', error);
  return MENSAJE_GENERICO;
}

/** Estado HTTP para un error cualquiera: 500 si no es de la jerarquía. */
export function estadoHttpDe(error: unknown): number {
  return error instanceof VektoraError ? error.estadoHttp : 500;
}
