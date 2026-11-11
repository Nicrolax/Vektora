'use server';

/**
 * VEKTORA — Acciones de administración (presentación → servicio).
 *
 * Cada acción exige el permiso en la aplicación (`exigirPermiso`) y el servicio vuelve a
 * operar con la identidad de la persona admin, así RLS lo confirma también en la base.
 */

import { revalidatePath } from 'next/cache';
import { AdminService, validarSkill } from '@/lib/admin';
import { esRol } from '@/lib/auth';
import { exigirPermiso } from '@/lib/auth/session';
import { esUuid } from '@/lib/db';
import { mensajeParaUsuario, ValidacionError } from '@/lib/errores';

export interface ResultadoAdmin {
  ok: boolean;
  mensaje: string | null;
}

function id(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  if (!esUuid(valor)) throw new ValidacionError('Identificador inválido.');
  return valor;
}

export async function gestionarCuenta(_previo: ResultadoAdmin, formData: FormData): Promise<ResultadoAdmin> {
  try {
    const admin = await exigirPermiso('admin:cuentas');
    const cuentaId = id(formData, 'cuentaId');
    const servicio = new AdminService();
    const operacion = formData.get('operacion');

    if (operacion === 'rol') {
      const rol = formData.get('role');
      if (!esRol(rol)) throw new ValidacionError('Elegí un rol de la lista.');
      await servicio.cambiarRol(admin.id, cuentaId, rol);
    } else if (operacion === 'suspender' || operacion === 'activar') {
      await servicio.cambiarEstado(admin.id, cuentaId, operacion === 'suspender' ? 'suspended' : 'active');
    } else if (operacion === 'eliminar') {
      await servicio.eliminarCuenta(admin.id, cuentaId);
    } else {
      throw new ValidacionError('Operación desconocida.');
    }
    revalidatePath('/admin/cuentas');
    return { ok: true, mensaje: 'Listo.' };
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
}

export async function crearSkill(_previo: ResultadoAdmin, formData: FormData): Promise<ResultadoAdmin> {
  try {
    const admin = await exigirPermiso('admin:skills');
    const datos = validarSkill({
      slug: formData.get('slug'),
      name: formData.get('name'),
      category: formData.get('category'),
    });
    await new AdminService().crearSkill(admin.id, datos);
    revalidatePath('/admin/skills');
    return { ok: true, mensaje: `Skill «${datos.slug}» creada.` };
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
}

export async function gestionarSkill(_previo: ResultadoAdmin, formData: FormData): Promise<ResultadoAdmin> {
  try {
    const admin = await exigirPermiso('admin:skills');
    const skillId = id(formData, 'skillId');
    const servicio = new AdminService();
    if (formData.get('operacion') === 'eliminar') {
      await servicio.eliminarSkill(admin.id, skillId);
      revalidatePath('/admin/skills');
      return { ok: true, mensaje: 'Skill eliminada.' };
    }
    const datos = validarSkill({ name: formData.get('name'), category: formData.get('category') });
    await servicio.actualizarSkill(admin.id, skillId, {
      name: datos.name,
      category: datos.category,
      isActive: formData.get('isActive') === 'si',
    });
    revalidatePath('/admin/skills');
    return { ok: true, mensaje: 'Guardado.' };
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
}
