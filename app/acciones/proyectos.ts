'use server';

/**
 * VEKTORA — Acciones de proyecto (presentación → servicio).
 *
 * Crear cruza la frontera de privilegios: la acción valida la sesión y el permiso y, solo
 * después, invoca al planificador, que opera como los agentes autónomos. Ese orden es la
 * garantía de que nadie planifica proyectos a nombre de otro. Una acción de servidor es un
 * punto de entrada HTTP como cualquier otro: sin la comprobación previa, bastaría conocer
 * su identificador para invocarla.
 *
 * Editar, cambiar de estado y eliminar van por `ProyectosService`, que corre como la
 * persona: RLS confirma en la base que sea la dueña (o admin).
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { z } from 'zod';
import { exigirPermiso } from '@/lib/auth/session';
import { consumirCuota } from '@/lib/cuotas';
import { esUuid } from '@/lib/db';
import { mensajeParaUsuario, ValidacionError } from '@/lib/errores';
import { createProjectPlanner } from '@/lib/planner';
import { ProyectosService, TRANSICIONES, validarCambios, type AccionEstado } from '@/lib/proyectos';
import { validarPresupuesto, validarTextoSustantivo } from '@/lib/validacion/entrada';

const CrearProyectoSchema = z.object({
  objective: z
    .string()
    .trim()
    .min(20, 'Describí el objetivo con al menos 20 caracteres: el planificador necesita contexto')
    .max(2000, 'El objetivo es demasiado largo'),
  budgetTotal: z
    .number({ error: 'El presupuesto tiene que ser un número' })
    .positive('El presupuesto tiene que ser mayor que cero')
    .max(1_000_000, 'El presupuesto excede el máximo admitido'),
});

export interface ResultadoCrear {
  ok: boolean;
  error: string | null;
}

export async function crearProyecto(
  _estadoPrevio: ResultadoCrear,
  formData: FormData,
): Promise<ResultadoCrear> {
  let projectId: string;
  try {
    const user = await exigirPermiso('proyectos:crear');

    const presupuestoCrudo = formData.get('budgetTotal');
    const parsed = CrearProyectoSchema.safeParse({
      objective: formData.get('objective'),
      budgetTotal: typeof presupuestoCrudo === 'string' ? Number(presupuestoCrudo) : Number.NaN,
    });
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Los datos no son válidos' };
    }

    // Zod comprobó tipos y longitudes. Esto comprueba que haya CONTENIDO: un objetivo que
    // repite la misma palabra pasa el primer filtro, cuesta una llamada al modelo igual, y
    // produce un plan inventado.
    const objetivo = validarTextoSustantivo(parsed.data.objective, { minPalabras: 6, minPalabrasDistintas: 5 });
    if (!objetivo.valido) return { ok: false, error: objetivo.motivo };

    const presupuesto = validarPresupuesto(parsed.data.budgetTotal);
    if (!presupuesto.valido) return { ok: false, error: presupuesto.motivo };

    // La cuota se consume ANTES de llamar al modelo.
    const cuota = await consumirCuota(user.id, 'crear_proyecto');
    if (!cuota.permitido) return { ok: false, error: cuota.mensaje };

    const resultado = await createProjectPlanner().planProject({
      create: { ownerId: user.id, objective: parsed.data.objective, budgetTotal: parsed.data.budgetTotal },
    });
    projectId = resultado.project.id;
  } catch (error) {
    return { ok: false, error: mensajeParaUsuario(error) };
  }

  revalidatePath('/panel');
  redirect(`/proyectos/${projectId}` as Route);
}

export interface ResultadoGestion {
  ok: boolean;
  mensaje: string | null;
}

function idDeProyecto(formData: FormData): string {
  const id = formData.get('projectId');
  if (!esUuid(id)) throw new ValidacionError('Identificador de proyecto inválido.');
  return id;
}

export async function actualizarProyecto(
  _estadoPrevio: ResultadoGestion,
  formData: FormData,
): Promise<ResultadoGestion> {
  try {
    const user = await exigirPermiso('proyectos:gestionar');
    const id = idDeProyecto(formData);
    const cambios = validarCambios({
      title: formData.get('title'),
      description: formData.get('description'),
      visibility: formData.get('visibility'),
    });
    await new ProyectosService().actualizar(user.id, id, cambios);
    revalidatePath(`/proyectos/${id}`);
    revalidatePath('/panel');
    return { ok: true, mensaje: 'Cambios guardados.' };
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
}

export async function cambiarEstadoProyecto(
  _estadoPrevio: ResultadoGestion,
  formData: FormData,
): Promise<ResultadoGestion> {
  try {
    const user = await exigirPermiso('proyectos:gestionar');
    const id = idDeProyecto(formData);
    const accion = formData.get('accion');
    if (typeof accion !== 'string' || !(accion in TRANSICIONES)) {
      throw new ValidacionError('Acción de estado desconocida.');
    }
    await new ProyectosService().cambiarEstado(user.id, id, accion as AccionEstado);
    revalidatePath(`/proyectos/${id}`);
    revalidatePath('/panel');
    return { ok: true, mensaje: 'Estado actualizado.' };
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
}

export async function eliminarProyecto(
  _estadoPrevio: ResultadoGestion,
  formData: FormData,
): Promise<ResultadoGestion> {
  try {
    const user = await exigirPermiso('proyectos:gestionar');
    const id = idDeProyecto(formData);
    if (formData.get('confirmacion') !== 'ELIMINAR') {
      throw new ValidacionError('Para eliminar escribí ELIMINAR en mayúsculas.', 'confirmacion');
    }
    await new ProyectosService().eliminar(user.id, id);
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
  revalidatePath('/panel');
  redirect('/panel');
}
