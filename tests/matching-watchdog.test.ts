/**
 * VEKTORA · FASE 8 — Plazos de entrega y vigilante de tareas adjudicadas.
 *
 * La política del plazo es pura y se prueba entera. Del vigilante se prueba lo que no puede
 * fallar en silencio: que le pase a la base la ventana y los topes correctos, y que un
 * tropiezo con una tarea no deje a las demás esperando.
 */

import { describe, expect, it } from 'vitest';
import {
  TaskWatchdog,
  deliveryWindowHours,
  loadMatchingConfig,
  type RecoveryResult,
  type WatchdogRepository,
  type WatchedTask,
} from '@/lib/matching';

const config = loadMatchingConfig({});

function tarea(overrides: Partial<WatchedTask> = {}): WatchedTask {
  return {
    id: 't-1',
    code: 'T-01',
    projectTitle: 'Proyecto',
    status: 'assigned',
    estimatedHours: 8,
    ...overrides,
  };
}

const SIN_CAMBIOS: RecoveryResult = {
  action: 'deadline_set',
  reason: null,
  dueAt: '2026-12-01T00:00:00.000Z',
  reassignments: null,
};

class FakeRepository implements WatchdogRepository {
  readonly llamadas: Array<{
    taskId: string;
    windowHours: number;
    maxReassignments: number;
    deadlinePenalty: number;
  }> = [];

  constructor(
    private readonly tareas: WatchedTask[],
    private readonly respuestas: Record<string, RecoveryResult | Error> = {},
  ) {}

  async listWatched(limit: number): Promise<WatchedTask[]> {
    return this.tareas.slice(0, limit);
  }

  async recover(params: {
    taskId: string;
    windowHours: number;
    maxReassignments: number;
    deadlinePenalty: number;
  }): Promise<RecoveryResult> {
    this.llamadas.push(params);
    const respuesta = this.respuestas[params.taskId] ?? SIN_CAMBIOS;
    if (respuesta instanceof Error) throw respuesta;
    return respuesta;
  }
}

describe('plazo de entrega', () => {
  it('convierte horas de trabajo en horas de reloj', () => {
    // 24 h de trabajo × 6 = 144 h de reloj, dentro de [48, 720].
    expect(deliveryWindowHours(24, config)).toBe(144);
  });

  it('una tarea chica recibe el mínimo, no un plazo imposible', () => {
    expect(deliveryWindowHours(2, config)).toBe(48);
  });

  it('una estimación desmedida no deja la tarea trabada meses', () => {
    expect(deliveryWindowHours(1000, config)).toBe(720);
  });

  it('sin estimación hay plazo igual: no saber cuánto lleva no es «sin plazo»', () => {
    expect(deliveryWindowHours(null, config)).toBe(48);
    expect(deliveryWindowHours(Number.NaN, config)).toBe(48);
    expect(deliveryWindowHours(-5, config)).toBe(48);
  });

  it('se puede acortar por entorno para mostrarlo en una demostración', () => {
    const demo = loadMatchingConfig({
      VEKTORA_DELIVERY_HOURS_FACTOR: '0',
      VEKTORA_DELIVERY_MIN_HOURS: '0.02',
    });
    expect(deliveryWindowHours(40, demo)).toBe(0.02);
  });

  it('rechaza un máximo menor que el mínimo', () => {
    expect(() =>
      loadMatchingConfig({ VEKTORA_DELIVERY_MIN_HOURS: '100', VEKTORA_DELIVERY_MAX_HOURS: '10' }),
    ).toThrow(/plazo máximo/);
  });

  it('los valores por defecto dan tres oportunidades antes de fallar el proyecto', () => {
    expect(config.maxReassignments).toBe(2);
    expect(config.deadlineMissedDelta).toBeGreaterThan(0);
  });
});

describe('vigilante de tareas', () => {
  it('le pasa a la base la ventana de cada tarea y los topes de la configuración', async () => {
    const repository = new FakeRepository([
      tarea({ id: 't-1', estimatedHours: 24 }),
      tarea({ id: 't-2', estimatedHours: null }),
    ]);
    await new TaskWatchdog({ repository, config }).sweep(50);

    expect(repository.llamadas).toEqual([
      { taskId: 't-1', windowHours: 144, maxReassignments: 2, deadlinePenalty: 8 },
      { taskId: 't-2', windowHours: 48, maxReassignments: 2, deadlinePenalty: 8 },
    ]);
  });

  it('cuenta lo que volvió al mercado y los proyectos que fallaron', async () => {
    const repository = new FakeRepository(
      [tarea({ id: 't-1' }), tarea({ id: 't-2' }), tarea({ id: 't-3' })],
      {
        't-1': { action: 'reopened', reason: 'venció el plazo', dueAt: null, reassignments: 1 },
        't-3': { action: 'project_failed', reason: 'rechazo definitivo', dueAt: null, reassignments: 2 },
      },
    );
    const resultado = await new TaskWatchdog({ repository, config }).sweep(50);

    expect(resultado.checked).toBe(3);
    expect(resultado.reopened).toBe(1);
    expect(resultado.projectsFailed).toBe(1);
    expect(resultado.errors).toBe(0);
    // Fijar un plazo es el caso normal: no ensucia la traza.
    expect(resultado.detail.map((d) => d.taskId)).toEqual(['t-1', 't-3']);
  });

  it('un fallo con una tarea no deja a las demás esperando', async () => {
    const repository = new FakeRepository(
      [tarea({ id: 't-1' }), tarea({ id: 't-2' })],
      {
        't-1': new Error('se cortó la conexión'),
        't-2': { action: 'reopened', reason: 'venció el plazo', dueAt: null, reassignments: 1 },
      },
    );
    const resultado = await new TaskWatchdog({ repository, config }).sweep(50);

    expect(repository.llamadas).toHaveLength(2);
    expect(resultado.errors).toBe(1);
    expect(resultado.reopened).toBe(1);
    expect(resultado.detail[0]).toMatchObject({ taskId: 't-1', action: 'none' });
    expect(resultado.detail[0]?.error).toContain('se cortó la conexión');
  });

  it('respeta el cupo de la corrida', async () => {
    const repository = new FakeRepository([tarea({ id: 't-1' }), tarea({ id: 't-2' })]);
    const resultado = await new TaskWatchdog({ repository, config }).sweep(1);

    expect(resultado.checked).toBe(1);
    expect(repository.llamadas).toHaveLength(1);
  });
});
