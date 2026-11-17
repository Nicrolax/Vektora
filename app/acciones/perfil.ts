'use server';

/**
 * VEKTORA — Datos básicos de la cuenta (nombre, presentación y sitio web).
 *
 * Escribe COMO LA PERSONA (`asUser`): la política `profiles_update_self` es la que decide
 * que solo se toca el perfil propio. El id sale de la sesión, nunca del formulario.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { mensajeParaUsuario } from '@/lib/errores';

const PerfilSchema = z.strictObject({
  nombre: z
    .string()
    .trim()
    .max(120, 'El nombre puede tener como máximo 120 caracteres.')
    .transform((v) => v || null),
  bio: z
    .string()
    .trim()
    .max(600, 'La presentación puede tener como máximo 600 caracteres. Acortala un poco.')
    .transform((v) => v || null),
  sitioWeb: z
    .string()
    .trim()
    .max(300, 'La dirección del sitio es demasiado larga.')
    .refine((v) => v === '' || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), {
      message: 'Escribí la dirección completa del sitio, empezando por https://',
    })
    .transform((v) => v || null),
});

export interface ResultadoPerfil {
  ok: boolean;
  mensaje: string | null;
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === 'string' ? valor : '';
}

export async function guardarPerfil(_previo: ResultadoPerfil, formData: FormData): Promise<ResultadoPerfil> {
  try {
    const user = await requireUser();
    const datos = PerfilSchema.safeParse({
      nombre: texto(formData, 'nombre'),
      bio: texto(formData, 'bio'),
      sitioWeb: texto(formData, 'sitio_web'),
    });
    if (!datos.success) {
      return { ok: false, mensaje: datos.error.issues[0]?.message ?? 'Revisá los datos del formulario.' };
    }

    const { nombre, bio, sitioWeb } = datos.data;
    // Upsert: el trigger de alta crea el perfil, pero si faltara no hay que dejar a la persona
    // sin forma de guardar. `display_name` y `full_name` van juntos: el nombre que se muestra
    // en todo el sistema es `coalesce(display_name, full_name)`.
    await getDb().asUser(user.id, (tx) =>
      tx.execute(
        `insert into public.profiles (user_id, full_name, display_name, bio, website_url)
         values ($1, $2, $2, $3, $4)
         on conflict (user_id) do update
            set full_name = excluded.full_name,
                display_name = excluded.display_name,
                bio = excluded.bio,
                website_url = excluded.website_url,
                updated_at = now()`,
        [user.id, nombre, bio, sitioWeb],
      ),
    );
    revalidatePath('/', 'layout');
    return { ok: true, mensaje: 'Listo, tus datos quedaron guardados.' };
  } catch (error) {
    return { ok: false, mensaje: mensajeParaUsuario(error) };
  }
}
