/**
 * VEKTORA · FASE 8 — Configuración y mensajes de las cuotas.
 *
 * Que el tope global DENIEGA de verdad no se puede probar aquí: `consumirCuota` deja pasar
 * la acción cuando la base falla, así que un doble de prueba no distinguiría una cuota
 * que funciona de una apagada. Eso lo prueban `db/verify/09_tope_global.sql` y
 * `tests/integracion`, contra PostgreSQL.
 */

import { describe, expect, it } from 'vitest';
import { cargarCuotas, mensajeDeRechazo } from '@/lib/cuotas';

describe('tope global de las cuotas', () => {
  it('por defecto crear proyectos y el alta de proveedor tienen tope; entregar no', () => {
    const cuotas = cargarCuotas({});
    expect(cuotas.crear_proyecto.limiteGlobal).toBe(30);
    expect(cuotas.alta_proveedor.limiteGlobal).toBe(60);
    expect(cuotas.entregar.limiteGlobal).toBeNull();
  });

  it('«sin-tope» lo quita, en cualquier combinación de mayúsculas', () => {
    expect(cargarCuotas({ VEKTORA_QUOTA_PROYECTOS_GLOBAL: 'sin-tope' }).crear_proyecto.limiteGlobal).toBeNull();
    expect(cargarCuotas({ VEKTORA_QUOTA_PROYECTOS_GLOBAL: ' Sin-Tope ' }).crear_proyecto.limiteGlobal).toBeNull();
  });

  it('cero NO significa «sin límite»: deshabilita la acción', () => {
    const cuotas = cargarCuotas({ VEKTORA_QUOTA_PROYECTOS_GLOBAL: '0' });
    expect(cuotas.crear_proyecto.limiteGlobal).toBe(0);
    expect(mensajeDeRechazo(cuotas.crear_proyecto, 'global', null)).toMatch(/deshabilitada/);
  });

  it('rechaza un valor que no es número ni «sin-tope» en vez de apagar el tope', () => {
    expect(() => cargarCuotas({ VEKTORA_QUOTA_PROYECTOS_GLOBAL: 'mucho' })).toThrow();
    expect(() => cargarCuotas({ VEKTORA_QUOTA_PROYECTOS_GLOBAL: '-1' })).toThrow();
  });

  it('el mensaje dice cuál de los dos límites se alcanzó', () => {
    const { crear_proyecto: limite } = cargarCuotas({});
    expect(mensajeDeRechazo(limite, 'usuario', null)).toMatch(/^Llegaste al límite de 5/);
    expect(mensajeDeRechazo(limite, 'global', null)).toMatch(/^Entre todas las cuentas se alcanzó el máximo de 30/);
  });
});
