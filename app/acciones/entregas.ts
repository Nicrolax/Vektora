'use server';

/**
 * VEKTORA — Registro de entregables (presentación → servicio).
 *
 * La acción traduce el formulario; la entrega en sí es UNA transacción en
 * `EntregasService` (lib/entregas): bloquea la tarea, comprueba que la persona sea la
 * adjudicada, inserta el entregable, pasa la tarea a `submitted` y registra la auditoría.
 * Todo o nada (R7).
 *
 * La evidencia se guarda como un objeto con una clave por criterio. Esa correspondencia es
 * lo que hace fiable al evaluador: no se le pide que adivine qué parte del trabajo responde
 * a qué criterio, se le dice.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { exigirPermiso } from '@/lib/auth/session';
import { consumirCuota } from '@/lib/cuotas';
import { esUuid } from '@/lib/db';
import { EntregasService } from '@/lib/entregas';
import { mensajeParaUsuario, ValidacionError } from '@/lib/errores';

export interface ResultadoEntrega {
  ok: boolean;
  error: string | null;
  faltantes: string[];
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === 'string' ? valor.trim() : '';
}

export async function entregarTrabajo(
  _estadoPrevio: ResultadoEntrega,
  formData: FormData,
): Promise<ResultadoEntrega> {
  let destino: string;
  try {
    const user = await exigirPermiso('trabajo:entregar');

    const taskId = formData.get('taskId');
    if (!esUuid(taskId)) throw new ValidacionError('Identificador de tarea inválido.');

    const summary = texto(formData, 'summary');
    const content = texto(formData, 'content');
    if (summary.length > 2000) throw new ValidacionError('El resumen es demasiado largo (máximo 2000 caracteres).');
    if (content.length > 200_000) throw new ValidacionError('El contenido supera el máximo admitido.');

    // Las claves `evidencia:<criterio>` del formulario.
    const evidencia: Record<string, string> = {};
    const criterios: string[] = [];
    for (const [clave, valor] of formData.entries()) {
      if (!clave.startsWith('evidencia:') || typeof valor !== 'string') continue;
      const id = clave.slice('evidencia:'.length);
      criterios.push(id);
      evidencia[id] = valor;
    }

    // Los criterios sin evidencia se avisan pero NO bloquean: el evaluador los juzgará contra
    // el contenido general, con menos confianza. Impedir entregar sería peor.
    const faltantes = EntregasService.faltantes(criterios, evidencia);
    if (faltantes.length > 0 && formData.get('confirmar') !== 'si') {
      return { ok: false, error: null, faltantes };
    }

    // Entregar es barato, pero cada entrega dispara una evaluación, que no lo es.
    const cuota = await consumirCuota(user.id, 'entregar');
    if (!cuota.permitido) return { ok: false, error: cuota.mensaje, faltantes: [] };

    const entrega = await new EntregasService().entregar(user.id, { taskId, summary, content, evidence: evidencia });
    revalidatePath(`/proyectos/${entrega.projectId}`);
    revalidatePath(`/tareas/${taskId}`);
    revalidatePath('/proveedor');
    destino = `/tareas/${taskId}?entregado=${entrega.version}`;
  } catch (error) {
    return { ok: false, error: mensajeParaUsuario(error), faltantes: [] };
  }
  redirect(destino as Route);
}
