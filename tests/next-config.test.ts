import { describe, expect, it } from 'vitest';
import config from '@/next.config';
import { NOMBRE_COOKIE } from '@/lib/auth/cookie';

/**
 * Las cabeceras de seguridad y las redirecciones sin sesión salieron de los hallazgos de
 * OWASP ZAP (docs/informe-seguridad.md). Estas pruebas evitan que se pierdan sin querer.
 */

async function cabeceras(): Promise<Map<string, string>> {
  const reglas = (await config.headers?.()) ?? [];
  const todas = reglas.find((r) => r.source === '/:path*');
  return new Map((todas?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe('next.config — cabeceras de seguridad', () => {
  it('manda las cabeceras que pidió ZAP en todas las rutas', async () => {
    const h = await cabeceras();
    for (const nombre of [
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
      'strict-transport-security',
      'cross-origin-opener-policy',
      'cross-origin-embedder-policy',
      'cross-origin-resource-policy',
    ]) {
      expect(h.get(nombre), nombre).toBeTruthy();
    }
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('x-content-type-options')).toBe('nosniff');
  });

  it('la CSP solo permite el propio origen y prohíbe marcos, objetos y otros destinos de formularios', async () => {
    const csp = (await cabeceras()).get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toMatch(/https?:|\*/); // ningún dominio ajeno ni comodines
  });

  it('no anuncia X-Powered-By', () => {
    expect(config.poweredByHeader).toBe(false);
  });
});

describe('next.config — redirección sin sesión', () => {
  it('usa el mismo nombre de cookie que el login', async () => {
    const reglas = (await config.redirects?.()) ?? [];
    expect(reglas.length).toBeGreaterThan(0);
    for (const r of reglas) {
      expect(r.missing).toEqual([{ type: 'cookie', key: NOMBRE_COOKIE }]);
      expect(r.destination).toBe('/entrar');
      expect(r.permanent).toBe(false);
    }
  });

  it('cubre la raíz y todas las secciones privadas, pero no /entrar ni /health', async () => {
    const reglas = (await config.redirects?.()) ?? [];
    const fuentes = reglas.map((r) => r.source).join(' ');
    for (const s of ['panel', 'proyectos', 'tareas', 'trabajo', 'proveedor', 'buscar', 'reportes', 'admin']) {
      expect(fuentes).toContain(s);
    }
    expect(reglas.some((r) => r.source === '/')).toBe(true);
    expect(fuentes).not.toMatch(/entrar|health|api/);
  });
});
