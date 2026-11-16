/**
 * VEKTORA · FASE 8 — Política de plazos de entrega. Módulo PURO.
 *
 * Cuánto tiempo tiene un proveedor para entregar una tarea adjudicada. Sin red y sin base
 * de datos: la base solo aplica la ventana que sale de aquí (`recover_stalled_task`).
 *
 * Es deliberadamente simple. Lo que importa no es afinar el plazo sino que EXISTA: antes una
 * tarea adjudicada a alguien que desaparecía esperaba para siempre, y con ella todo lo que
 * dependía de ella.
 */

import type { MatchingConfig } from './config';

/**
 * Horas de reloj para entregar una tarea.
 *
 * `estimated_hours` son horas de trabajo, no de reloj; `hoursFactor` hace la conversión y
 * el resultado se acota a `[minHours, maxHours]`. Una tarea sin estimación recibe el
 * mínimo: no saber cuánto lleva no puede significar «sin plazo».
 */
export function deliveryWindowHours(
  estimatedHours: number | null,
  config: Pick<MatchingConfig, 'delivery'>,
): number {
  const { hoursFactor, minHours, maxHours } = config.delivery;
  const estimate =
    estimatedHours !== null && Number.isFinite(estimatedHours) && estimatedHours > 0
      ? estimatedHours
      : 0;
  return Math.min(maxHours, Math.max(minHours, estimate * hoursFactor));
}
