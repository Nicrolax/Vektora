'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

/**
 * Navegación con indicador de sección activa.
 *
 * Las secciones las decide el SERVIDOR según el rol (`app/(app)/layout.tsx`) y llegan como
 * props: este componente no sabe nada de permisos. Ocultar un enlace es comodidad, no
 * seguridad; cada página vuelve a exigir su permiso con `requirePermiso()`.
 *
 * El subrayado se dibuja con un pseudo-elemento animado en vez de cambiar el borde: así la
 * transición entre secciones es un deslizamiento y no un parpadeo. Va DENTRO del enlace, que
 * ocupa todo el alto de la cabecera: si quedara afuera, el `overflow-x-auto` de la barra
 * mostraría un desplazamiento vertical.
 */
export interface Seccion {
  href: Route;
  etiqueta: string;
}

export function Navegacion({ secciones }: { secciones: Seccion[] }) {
  const ruta = usePathname();

  return (
    <nav aria-label="Principal" className="flex h-full items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none]">
      {secciones.map((seccion) => {
        const activa = ruta === seccion.href || ruta.startsWith(`${seccion.href}/`);
        return (
          <Link
            key={seccion.href}
            href={seccion.href}
            aria-current={activa ? 'page' : undefined}
            className="relative flex shrink-0 items-center px-3 text-sm whitespace-nowrap transition-colors duration-200"
            style={{ color: activa ? 'var(--color-texto)' : 'var(--color-apagado)' }}
          >
            {seccion.etiqueta}
            <span
              aria-hidden
              className="absolute inset-x-3 bottom-0 h-[2px] bg-[var(--color-acento)] rounded-full transition-all duration-300"
              style={{
                opacity: activa ? 1 : 0,
                transform: activa ? 'scaleX(1)' : 'scaleX(0.3)',
              }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
