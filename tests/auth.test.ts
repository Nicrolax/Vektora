import { describe, expect, it } from 'vitest';
import {
  AuthService,
  costeDe,
  debeSerSegura,
  emitirToken,
  hashearContrasena,
  MENSAJE_CREDENCIALES,
  normalizarCorreo,
  opcionesCookie,
  PERMISOS_POR_ROL,
  ROLES,
  ROLES_REGISTRABLES,
  secretoDeSesion,
  tienePermiso,
  validarContrasena,
  verificarContrasena,
  verificarToken,
  type CuentaConHash,
  type CuentasRepository,
  type NuevaCuenta,
} from '@/lib/auth';
import { AuthError, ConfiguracionError, ConflictoError, DatabaseError, ValidacionError } from '@/lib/errores';

const SECRETO = 'a'.repeat(64);

describe('token de sesión HS256', () => {
  it('emite un JWT de tres partes que se verifica con el mismo secreto', () => {
    const token = emitirToken('usuario-1', SECRETO, 1_000);
    expect(token.split('.')).toHaveLength(3);
    expect(verificarToken(token, SECRETO, 1_001)).toMatchObject({ sub: 'usuario-1', iat: 1_000 });
  });

  it('rechaza el token si cambia el secreto', () => {
    const token = emitirToken('usuario-1', SECRETO, 1_000);
    expect(verificarToken(token, 'b'.repeat(64), 1_001)).toBeNull();
  });

  it('rechaza un contenido manipulado (otro sub con la firma vieja)', () => {
    const [cabecera, , firma] = emitirToken('usuario-1', SECRETO, 1_000).split('.');
    const falso = Buffer.from(JSON.stringify({ sub: 'admin', iat: 1_000, exp: 9_999_999 })).toString('base64url');
    expect(verificarToken(`${cabecera}.${falso}.${firma}`, SECRETO, 1_001)).toBeNull();
  });

  it('rechaza alg "none" aunque no traiga firma', () => {
    const cabecera = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const contenido = Buffer.from(JSON.stringify({ sub: 'admin', iat: 1, exp: 9_999_999_999 })).toString('base64url');
    expect(verificarToken(`${cabecera}.${contenido}.`, SECRETO)).toBeNull();
  });

  it('rechaza un token vencido', () => {
    const token = emitirToken('usuario-1', SECRETO, 1_000, 60);
    expect(verificarToken(token, SECRETO, 1_059)).not.toBeNull();
    expect(verificarToken(token, SECRETO, 1_060)).toBeNull();
  });

  it('rechaza basura sin lanzar', () => {
    for (const basura of ['', 'a.b', 'a.b.c.d', 'x.y.z']) expect(verificarToken(basura, SECRETO)).toBeNull();
  });

  it('exige un AUTH_SECRET de al menos 32 caracteres', () => {
    expect(() => secretoDeSesion({})).toThrow(ConfiguracionError);
    expect(() => secretoDeSesion({ AUTH_SECRET: 'corto' })).toThrow(ConfiguracionError);
    expect(secretoDeSesion({ AUTH_SECRET: SECRETO })).toBe(SECRETO);
  });
});

describe('contraseñas con BCrypt', () => {
  it('el hash usa el coste pedido y verifica solo la contraseña correcta', async () => {
    const hash = await hashearContrasena('una-clave-larga', 4);
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(costeDe(hash)).toBe(4);
    expect(await verificarContrasena('una-clave-larga', hash)).toBe(true);
    expect(await verificarContrasena('otra-clave-larga', hash)).toBe(false);
  });

  it('la misma contraseña da hashes distintos (sal aleatoria)', async () => {
    expect(await hashearContrasena('una-clave-larga', 4)).not.toBe(await hashearContrasena('una-clave-larga', 4));
  });

  it('sin hash (cuenta inexistente) siempre es falso', async () => {
    expect(await verificarContrasena('lo-que-sea-123', null)).toBe(false);
  });

  it('un hash corrupto no abre la puerta', async () => {
    expect(await verificarContrasena('lo-que-sea-123', 'no-es-un-hash')).toBe(false);
  });

  it('valida el largo: mínimo 8, máximo 72 bytes (límite de BCrypt)', () => {
    expect(() => validarContrasena('corta')).toThrow(ValidacionError);
    expect(() => validarContrasena('ñ'.repeat(40))).toThrow(ValidacionError);
    expect(() => validarContrasena('suficiente')).not.toThrow();
  });
});

describe('permisos por rol', () => {
  it('cada rol tiene su tabla', () => {
    for (const rol of ROLES) expect(PERMISOS_POR_ROL[rol].size).toBeGreaterThan(0);
  });

  it('cliente crea proyectos pero no entrega; proveedor al revés', () => {
    expect(tienePermiso('client', 'proyectos:crear')).toBe(true);
    expect(tienePermiso('client', 'trabajo:entregar')).toBe(false);
    expect(tienePermiso('provider', 'trabajo:entregar')).toBe(true);
    expect(tienePermiso('provider', 'proyectos:crear')).toBe(false);
  });

  it('solo admin gestiona cuentas y skills', () => {
    for (const rol of ['client', 'provider', 'both'] as const) {
      expect(tienePermiso(rol, 'admin:cuentas')).toBe(false);
      expect(tienePermiso(rol, 'admin:skills')).toBe(false);
    }
    expect(tienePermiso('admin', 'admin:cuentas')).toBe(true);
  });

  it('admin no se puede elegir al registrarse', () => {
    expect(ROLES_REGISTRABLES).not.toContain('admin');
  });
});

describe('cookie de sesión', () => {
  it('es Secure detrás de un proxy HTTPS (Render) y no en http local', () => {
    expect(debeSerSegura('https', {})).toBe(true);
    expect(debeSerSegura('https, http', {})).toBe(true);
    expect(debeSerSegura('http', {})).toBe(false);
    expect(debeSerSegura(null, {})).toBe(false);
  });

  it('COOKIE_SECURE la fuerza en un sentido o en el otro', () => {
    expect(debeSerSegura('http', { COOKIE_SECURE: 'true' })).toBe(true);
    expect(debeSerSegura('https', { COOKIE_SECURE: 'false' })).toBe(false);
  });

  it('siempre es httpOnly y SameSite=Lax', () => {
    expect(opcionesCookie(true)).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
  });
});

/** Repositorio en memoria: prueba las reglas del servicio sin base. */
class CuentasEnMemoria implements CuentasRepository {
  readonly cuentas = new Map<string, CuentaConHash & { nombre: string | null }>();
  accesos = 0;

  async buscarConHashPorCorreo(email: string) {
    return [...this.cuentas.values()].find((c) => c.email === email.toLowerCase()) ?? null;
  }
  async buscarPorId(id: string) {
    const c = this.cuentas.get(id);
    return c === undefined ? null : { id: c.id, email: c.email, role: c.role, status: c.status, nombre: c.nombre };
  }
  async crear(cuenta: NuevaCuenta) {
    if ([...this.cuentas.values()].some((c) => c.email === cuenta.email)) {
      throw new DatabaseError('duplicate key value violates unique constraint', '23505');
    }
    const id = `id-${this.cuentas.size + 1}`;
    this.cuentas.set(id, { id, email: cuenta.email, passwordHash: cuenta.passwordHash, role: cuenta.role, status: 'active', nombre: cuenta.nombre });
    return id;
  }
  async cambiarHash(id: string, hash: string) {
    const c = this.cuentas.get(id);
    if (c !== undefined) c.passwordHash = hash;
  }
  async cambiarRol(id: string, role: CuentaConHash['role']) {
    const c = this.cuentas.get(id);
    if (c !== undefined) c.role = role;
  }
  async registrarAcceso() {
    this.accesos += 1;
  }
}

describe('AuthService', () => {
  it('registra, normaliza el correo y deja entrar', async () => {
    const repo = new CuentasEnMemoria();
    const servicio = new AuthService(repo, 4);
    const nuevo = await servicio.registrar({ email: '  Ana@Ejemplo.COM ', contrasena: 'clave-segura', role: 'client' });
    expect(nuevo.email).toBe('ana@ejemplo.com');
    expect(await servicio.iniciarSesion('ANA@ejemplo.com', 'clave-segura')).toMatchObject({ role: 'client' });
    expect(repo.accesos).toBe(1);
  });

  it('el mismo mensaje para correo inexistente, contraseña mala o correo mal escrito', async () => {
    const servicio = new AuthService(new CuentasEnMemoria(), 4);
    await servicio.registrar({ email: 'ana@ejemplo.com', contrasena: 'clave-segura', role: 'client' });
    for (const [correo, clave] of [
      ['ana@ejemplo.com', 'otra-clave'],
      ['nadie@ejemplo.com', 'clave-segura'],
      ['no-es-correo', 'clave-segura'],
    ] as const) {
      await expect(servicio.iniciarSesion(correo, clave)).rejects.toThrow(MENSAJE_CREDENCIALES);
    }
  });

  it('una cuenta suspendida no entra aunque la contraseña sea correcta', async () => {
    const repo = new CuentasEnMemoria();
    const servicio = new AuthService(repo, 4);
    const { id } = await servicio.registrar({ email: 'ana@ejemplo.com', contrasena: 'clave-segura', role: 'both' });
    const cuenta = repo.cuentas.get(id);
    if (cuenta !== undefined) cuenta.status = 'suspended';
    await expect(servicio.iniciarSesion('ana@ejemplo.com', 'clave-segura')).rejects.toBeInstanceOf(AuthError);
  });

  it('no se puede registrar como admin ni repetir correo', async () => {
    const servicio = new AuthService(new CuentasEnMemoria(), 4);
    await expect(servicio.registrar({ email: 'a@ejemplo.com', contrasena: 'clave-segura', role: 'admin' })).rejects.toBeInstanceOf(
      ValidacionError,
    );
    await servicio.registrar({ email: 'a@ejemplo.com', contrasena: 'clave-segura', role: 'client' });
    await expect(servicio.registrar({ email: 'A@ejemplo.com', contrasena: 'clave-segura', role: 'client' })).rejects.toBeInstanceOf(
      ConflictoError,
    );
  });

  it('rehace al entrar un hash con coste menor al actual', async () => {
    const repo = new CuentasEnMemoria();
    await new AuthService(repo, 4).registrar({ email: 'a@ejemplo.com', contrasena: 'clave-segura', role: 'client' });
    await new AuthService(repo, 5).iniciarSesion('a@ejemplo.com', 'clave-segura');
    const hash = [...repo.cuentas.values()][0]?.passwordHash ?? '';
    expect(costeDe(hash)).toBe(5);
  });

  it('asegurarAdmin crea la cuenta o asciende la existente', async () => {
    const repo = new CuentasEnMemoria();
    const servicio = new AuthService(repo, 4);
    await expect(servicio.asegurarAdmin('jefa@ejemplo.com', 'corta')).rejects.toBeInstanceOf(ValidacionError);
    expect((await servicio.asegurarAdmin('jefa@ejemplo.com', 'una-clave-de-admin')).creada).toBe(true);
    await servicio.registrar({ email: 'ana@ejemplo.com', contrasena: 'clave-segura', role: 'client' });
    expect((await servicio.asegurarAdmin('ana@ejemplo.com', 'una-clave-de-admin')).creada).toBe(false);
    expect([...repo.cuentas.values()].filter((c) => c.role === 'admin')).toHaveLength(2);
  });

  it('normalizarCorreo rechaza lo que no es un correo', () => {
    expect(() => normalizarCorreo('sin-arroba')).toThrow(ValidacionError);
    expect(normalizarCorreo(' X@Y.UY ')).toBe('x@y.uy');
  });
});
