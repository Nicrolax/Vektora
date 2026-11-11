import Link from 'next/link';
import { NOMBRE_ROL, tienePermiso } from '@/lib/auth';
import { requireUser } from '@/lib/auth/session';
import { cerrarSesion } from '@/app/entrar/acciones';
import { Fondo, Logotipo } from '@/components/ui/marca';
import { Navegacion, type Seccion } from '@/components/ui/navegacion';

/**
 * Envoltorio de todo lo que exige sesión. `requireUser()` corre en el servidor antes de
 * renderizar nada: una página protegida nunca llega a existir para quien no inició sesión.
 * El menú se arma con los permisos del rol (R3).
 */
export default async function LayoutAplicacion({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const secciones: Seccion[] = [];
  if (tienePermiso(user.role, 'proyectos:crear')) secciones.push({ href: '/panel', etiqueta: 'Mis proyectos' });
  if (tienePermiso(user.role, 'proveedor:perfil')) secciones.push({ href: '/proveedor', etiqueta: 'Mi trabajo' });
  if (tienePermiso(user.role, 'tareas:buscar')) secciones.push({ href: '/buscar', etiqueta: 'Buscar' });
  if (tienePermiso(user.role, 'reportes:ver')) secciones.push({ href: '/reportes', etiqueta: 'Reportes' });
  if (tienePermiso(user.role, 'admin:cuentas')) secciones.push({ href: '/admin', etiqueta: 'Administración' });

  return (
    <div className="min-h-dvh">
      <Fondo />

      <header className="sticky top-0 z-30 border-b border-[var(--color-borde)]/70 bg-[var(--color-lienzo)]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-5">
          <Link href="/panel" className="shrink-0 transition-opacity hover:opacity-80">
            <Logotipo />
          </Link>

          <Navegacion secciones={secciones} />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="hidden max-w-[14rem] truncate text-right text-xs leading-tight text-[var(--color-apagado)] md:inline">
              {user.nombre ?? user.email ?? user.id}
              <br />
              <span className="text-[0.68rem]">{NOMBRE_ROL[user.role]}</span>
            </span>
            <form action={cerrarSesion}>
              <button type="submit" className="boton boton-suave !px-3 !py-1.5 text-xs">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-9 sm:px-5">{children}</main>
    </div>
  );
}
