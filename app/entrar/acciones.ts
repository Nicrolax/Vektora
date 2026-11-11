'use server';

/**
 * VEKTORA — Alta y acceso (presentación → servicio).
 *
 * La acción solo traduce el formulario y la respuesta HTTP; las reglas viven en
 * `AuthService` (lib/auth/servicio.ts): BCrypt, mensaje único para credenciales
 * incorrectas, cuentas suspendidas y roles que se pueden elegir.
 *
 * El perfil en `public.users` NO se crea acá: lo crea el trigger `handle_new_auth_user` al
 * insertar en `auth.users`. Si dependiera de este código, un alta que fallara a mitad
 * dejaría una cuenta sin perfil.
 */

import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { crearAuthService, esRol, tienePermiso } from '@/lib/auth';
import { abrirSesion, cerrarSesionActual } from '@/lib/auth/session';
import { mensajeParaUsuario } from '@/lib/errores';
import { validarCorreo } from '@/lib/validacion/entrada';

/**
 * Al REGISTRARSE se exige un correo real; al ENTRAR no se comprueba nada de esto. La
 * asimetría es deliberada: endurecer también el inicio de sesión dejaría afuera a quien se
 * registró antes de que un dominio entrara en la lista.
 */
const CORREO_ESTRICTO = { bloquearDesechables: true, bloquearReservados: true } as const;

function volverConError(mensaje: string): never {
  redirect(`/entrar?error=${encodeURIComponent(mensaje)}` as Route);
}

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === 'string' ? valor : '';
}

export async function iniciarSesion(formData: FormData): Promise<void> {
  let destino: Route = '/panel';
  try {
    const usuario = await crearAuthService().iniciarSesion(texto(formData, 'email'), texto(formData, 'password'));
    await abrirSesion(usuario.id);
    // Una cuenta solo de proveedor no publica proyectos: entra directo a su trabajo.
    if (!tienePermiso(usuario.role, 'proyectos:crear')) destino = '/proveedor';
  } catch (error) {
    volverConError(mensajeParaUsuario(error));
  }
  // `redirect` fuera del try: internamente lanza, y un catch se lo tragaría.
  redirect(destino);
}

export async function registrarse(formData: FormData): Promise<void> {
  const email = texto(formData, 'email');
  const correo = validarCorreo(email, CORREO_ESTRICTO);
  if (!correo.valido) volverConError(correo.motivo ?? 'El correo no es válido.');

  const rol = texto(formData, 'role');
  if (!esRol(rol)) volverConError('Elegí si querés publicar proyectos, ofrecer tu trabajo o ambas.');

  let destino: Route = '/panel';
  try {
    const usuario = await crearAuthService().registrar({
      email,
      contrasena: texto(formData, 'password'),
      role: rol,
      nombre: texto(formData, 'nombre'),
    });
    await abrirSesion(usuario.id);
    if (!tienePermiso(usuario.role, 'proyectos:crear')) destino = '/proveedor/alta';
  } catch (error) {
    volverConError(mensajeParaUsuario(error));
  }
  redirect(destino);
}

export async function cerrarSesion(): Promise<void> {
  await cerrarSesionActual();
  redirect('/entrar');
}
