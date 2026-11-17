import Link from 'next/link';
import { NOMBRE_ROL, tienePermiso } from '@/lib/auth';
import { requireUser } from '@/lib/auth/session';
import { Logotipo } from '@/components/ui/marca';
import { MenuCuenta } from '@/components/ui/menu-cuenta';
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
      <header className="sticky top-0 z-30 border-b border-[var(--color-borde)] bg-[var(--color-lienzo)]">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-5">
          <Link href="/panel" className="shrink-0 transition-opacity hover:opacity-80">
            <Logotipo />
          </Link>

          <div className="hidden h-full md:flex">
            <Navegacion secciones={secciones} />
          </div>

          <div className="ml-auto shrink-0">
            <MenuCuenta
              nombre={user.nombre ?? user.email ?? 'Tu cuenta'}
              email={user.email}
              rol={NOMBRE_ROL[user.role]}
              secciones={secciones}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-5">{children}</main>
    </div>
  );
}
