/**
 * VEKTORA · FASE 8 — Límite de intentos de acceso y de altas.
 *
 * Lo que no puede fallar: que frene la fuerza bruta, que no delate qué correos existen,
 * que no deje bloquear las cuentas demo con pocos intentos, y que se libere solo.
 */

import { describe, expect, it } from 'vitest';
import {
  AuthService,
  LimitadorAcceso,
  MENSAJE_CREDENCIALES,
  POLITICA_ACCESO,
  VentanaDeslizante,
  hashearContrasena,
  ipDeCabeceras,
  minutosDe,
  type CuentaConHash,
  type CuentasRepository,
  type NuevaCuenta,
} from '@/lib/auth';
import { AuthError, LimiteIntentosError } from '@/lib/errores';

const CLAVE = 'Clave-Correcta-123';
const MINUTO = 60_000;

/** Reloj que avanza solo cuando la prueba lo pide. */
function reloj(inicio = 1_000_000) {
  let t = inicio;
  return { ahora: () => t, avanzar: (ms: number) => void (t += ms) };
}

class Cuentas implements CuentasRepository {
  private readonly filas = new Map<string, CuentaConHash>();

  async agregar(email: string): Promise<void> {
    const id = `id-${this.filas.size + 1}`;
    this.filas.set(id, { id, email, passwordHash: await hashearContrasena(CLAVE, 4), role: 'both', status: 'active' });
  }
  async buscarConHashPorCorreo(email: string) {
    return [...this.filas.values()].find((c) => c.email === email) ?? null;
  }
  async buscarPorId() {
    return null;
  }
  async crear(cuenta: NuevaCuenta) {
    const id = `id-${this.filas.size + 1}`;
    this.filas.set(id, { id, email: cuenta.email, passwordHash: cuenta.passwordHash, role: cuenta.role, status: 'active' });
    return id;
  }
  async cambiarHash() {}
  async cambiarRol() {}
  async registrarAcceso() {}
}

async function servicio(t = reloj()) {
  const cuentas = new Cuentas();
  await cuentas.agregar('real@ejemplo.com');
  const limitador = new LimitadorAcceso(POLITICA_ACCESO, t.ahora);
  return { auth: new AuthService(cuentas, 4, limitador), limitador, t };
}

/** Falla `veces` veces y devuelve el error del intento siguiente (o null si entró). */
async function fallar(auth: AuthService, correo: string, ip: string | null, veces: number) {
  for (let i = 0; i < veces; i += 1) {
    await expect(auth.iniciarSesion(correo, 'mala-mala-1', ip)).rejects.toBeInstanceOf(AuthError);
  }
}

describe('ventana deslizante', () => {
  it('bloquea al llegar al máximo y libera cuando vence el intento más viejo', () => {
    const t = reloj();
    const v = new VentanaDeslizante(100, t.ahora);
    const regla = { maximo: 3, ventanaMs: 10 * MINUTO };
    v.registrar('k', regla);
    t.avanzar(MINUTO);
    v.registrar('k', regla);
    v.registrar('k', regla);
    expect(v.bloqueo('k', regla)?.esperaMs).toBe(9 * MINUTO);
    t.avanzar(9 * MINUTO);
    expect(v.bloqueo('k', regla)).toBeNull();
  });

  it('no supera el tope de claves aunque se roten sin parar', () => {
    const t = reloj();
    const v = new VentanaDeslizante(50, t.ahora);
    for (let i = 0; i < 500; i += 1) v.registrar(`ip:10.0.0.${i}`, { maximo: 5, ventanaMs: MINUTO });
    expect(v.tamano).toBeLessThanOrEqual(50);
  });
});

describe('límite de intentos de acceso', () => {
  it('el sexto intento seguido desde la misma IP se frena sin mirar la contraseña', async () => {
    const { auth } = await servicio();
    await fallar(auth, 'real@ejemplo.com', '203.0.113.7', 5);
    // Ni siquiera la contraseña correcta entra mientras dura el bloqueo.
    const error = await auth.iniciarSesion('real@ejemplo.com', CLAVE, '203.0.113.7').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LimiteIntentosError);
    expect((error as Error).message).toMatch(/Esperá 15 min/);
  });

  it('se libera solo: no hace falta nadie para desbloquear', async () => {
    const { auth, t } = await servicio();
    await fallar(auth, 'real@ejemplo.com', '203.0.113.7', 5);
    t.avanzar(15 * MINUTO + 1);
    await expect(auth.iniciarSesion('real@ejemplo.com', CLAVE, '203.0.113.7')).resolves.toMatchObject({
      email: 'real@ejemplo.com',
    });
  });

  it('un correo inexistente se frena igual que uno real: no delata qué cuentas hay', async () => {
    const { auth } = await servicio();
    await fallar(auth, 'nadie@ejemplo.com', '203.0.113.7', 5);
    await fallar(auth, 'real@ejemplo.com', '203.0.113.8', 5);
    const inexistente = await auth.iniciarSesion('nadie@ejemplo.com', 'x-x-x-x-x', '203.0.113.7').catch((e: unknown) => e);
    const existente = await auth.iniciarSesion('real@ejemplo.com', 'x-x-x-x-x', '203.0.113.8').catch((e: unknown) => e);
    expect(inexistente).toBeInstanceOf(LimiteIntentosError);
    expect(existente).toBeInstanceOf(LimiteIntentosError);
    expect((inexistente as Error).message).toBe((existente as Error).message);
  });

  it('desde otra IP la cuenta demo sigue entrando: cinco fallos ajenos no la bloquean', async () => {
    const { auth } = await servicio();
    await fallar(auth, 'real@ejemplo.com', '198.51.100.1', 5);
    await expect(auth.iniciarSesion('real@ejemplo.com', CLAVE, '192.0.2.50')).resolves.toBeTruthy();
  });

  it('cambiar de IP en cada intento no esquiva el respaldo por correo', async () => {
    const { auth } = await servicio();
    for (let i = 0; i < 50; i += 1) {
      await expect(auth.iniciarSesion('real@ejemplo.com', 'mala-mala-1', `198.51.100.${i}`)).rejects.toBeInstanceOf(
        AuthError,
      );
    }
    await expect(auth.iniciarSesion('real@ejemplo.com', CLAVE, '198.51.100.200')).rejects.toBeInstanceOf(
      LimiteIntentosError,
    );
  });

  it('un acceso correcto limpia sus fallos pero no el contador de la IP', async () => {
    const { auth, limitador } = await servicio();
    await fallar(auth, 'real@ejemplo.com', '203.0.113.7', 4);
    await auth.iniciarSesion('real@ejemplo.com', CLAVE, '203.0.113.7');
    await fallar(auth, 'real@ejemplo.com', '203.0.113.7', 4);
    await expect(auth.iniciarSesion('real@ejemplo.com', CLAVE, '203.0.113.7')).resolves.toBeTruthy();
    // Los 8 fallos siguen contando para la IP: una cuenta válida no sirve para reiniciarla.
    for (let i = 0; i < 92; i += 1) limitador.registrarFallo(`otro-${i}@ejemplo.com`, '203.0.113.7');
    expect(limitador.bloqueoDeAcceso('tercero@ejemplo.com', '203.0.113.7')).not.toBeNull();
  });

  it('las mayúsculas y los espacios no abren cubos nuevos', async () => {
    const { auth } = await servicio();
    await fallar(auth, 'Real@Ejemplo.com', '203.0.113.7', 3);
    await fallar(auth, '  real@ejemplo.com ', '203.0.113.7', 2);
    await expect(auth.iniciarSesion('REAL@EJEMPLO.COM', CLAVE, '203.0.113.7')).rejects.toBeInstanceOf(
      LimiteIntentosError,
    );
  });

  it('sin limitador (scripts, pruebas viejas) no hay tope', async () => {
    const cuentas = new Cuentas();
    await cuentas.agregar('real@ejemplo.com');
    const auth = new AuthService(cuentas, 4);
    await fallar(auth, 'real@ejemplo.com', '203.0.113.7', 8);
    await expect(auth.iniciarSesion('real@ejemplo.com', 'mala', null)).rejects.toThrow(MENSAJE_CREDENCIALES);
  });
});

describe('límite de altas', () => {
  it('veinte altas por hora desde la misma IP; la siguiente espera', async () => {
    const { auth, t } = await servicio();
    for (let i = 0; i < 20; i += 1) {
      await auth.registrar({ email: `n${i}@ejemplo.com`, contrasena: CLAVE, role: 'client' }, '203.0.113.9');
    }
    await expect(
      auth.registrar({ email: 'n20@ejemplo.com', contrasena: CLAVE, role: 'client' }, '203.0.113.9'),
    ).rejects.toBeInstanceOf(LimiteIntentosError);
    t.avanzar(60 * MINUTO + 1);
    await expect(
      auth.registrar({ email: 'n20@ejemplo.com', contrasena: CLAVE, role: 'client' }, '203.0.113.9'),
    ).resolves.toBeTruthy();
  });

  it('sin IP conocida no se limita el alta (no hay con qué distinguir personas)', async () => {
    const { limitador } = await servicio();
    for (let i = 0; i < 40; i += 1) limitador.registrarAlta(null);
    expect(limitador.bloqueoDeAlta(null)).toBeNull();
  });
});

describe('IP de la petición', () => {
  const cabeceras = (valores: Record<string, string>) => ({ get: (n: string) => valores[n] ?? null });

  it('toma la primera entrada de x-forwarded-for', () => {
    expect(ipDeCabeceras(cabeceras({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('usa x-real-ip si no hay x-forwarded-for', () => {
    expect(ipDeCabeceras(cabeceras({ 'x-real-ip': '2001:DB8::1' }))).toBe('2001:db8::1');
  });

  it('descarta lo que no parece una IP en vez de usarlo como clave', () => {
    expect(ipDeCabeceras(cabeceras({ 'x-forwarded-for': 'hola; drop table' }))).toBeNull();
    expect(ipDeCabeceras(cabeceras({ 'x-forwarded-for': '1'.repeat(80) }))).toBeNull();
    expect(ipDeCabeceras(cabeceras({}))).toBeNull();
  });

  it('el mensaje siempre pide esperar al menos un minuto', () => {
    expect(minutosDe(0)).toBe(1);
    expect(minutosDe(61_000)).toBe(2);
  });
});
