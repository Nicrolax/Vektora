'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cerrarSesion } from '@/app/entrar/acciones';
import type { Seccion } from './navegacion';

/**
 * Menú de la cuenta en la cabecera. Es un `<details>` nativo: abre y cierra con teclado y
 * lector de pantalla sin código. Lo único que se agrega es cerrarlo al hacer clic afuera, con
 * Escape y al cambiar de página, que el elemento nativo no hace solo.
 *
 * En pantallas angostas la barra de secciones no entra en la cabecera: se oculta y las
 * secciones aparecen acá, así el celular tiene un único menú y nada queda escondido.
 */
export function MenuCuenta({
  nombre,
  email,
  rol,
  secciones,
}: {
  nombre: string;
  email: string | null;
  rol: string;
  secciones: Seccion[];
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const ruta = usePathname();

  useEffect(() => {
    if (menu.current !== null) menu.current.open = false;
  }, [ruta]);

  useEffect(() => {
    const cerrar = (evento: MouseEvent | KeyboardEvent) => {
      const el = menu.current;
      if (el === null || !el.open) return;
      if (evento instanceof KeyboardEvent) {
        if (evento.key !== 'Escape') return;
        el.open = false;
        el.querySelector('summary')?.focus();
        return;
      }
      if (!el.contains(evento.target as Node)) el.open = false;
    };
    document.addEventListener('click', cerrar);
    document.addEventListener('keydown', cerrar);
    return () => {
      document.removeEventListener('click', cerrar);
      document.removeEventListener('keydown', cerrar);
    };
  }, []);

  const inicial = (nombre.trim()[0] ?? '?').toUpperCase();

  return (
    <details ref={menu} className="group relative">
      <summary
        aria-label="Menú"
        className="flex list-none items-center gap-2.5 rounded-full py-1 pr-1 pl-3 transition-colors hover:bg-[var(--color-panel)] [&::-webkit-details-marker]:hidden"
      >
        <span className="text-sm text-[var(--color-tenue)] md:hidden">Menú</span>
        <span className="hidden max-w-[12rem] truncate text-sm text-[var(--color-tenue)] md:inline">{nombre}</span>
        <span
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-acento-tenue)] text-sm font-semibold text-[var(--color-texto)]"
        >
          {inicial}
        </span>
      </summary>

      <div className="aparece absolute right-0 z-40 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-borde)] bg-[var(--color-panel)] py-1.5 shadow-[0_16px_40px_-12px_oklch(0.05_0.02_275/0.7)]">
        <div className="space-y-0.5 border-b border-[var(--color-borde)] px-4 pt-2 pb-3">
          <p className="truncate text-sm font-medium">{nombre}</p>
          {email !== null && <p className="truncate text-xs text-[var(--color-apagado)]">{email}</p>}
          <p className="text-xs text-[var(--color-apagado)]">{rol}</p>
        </div>
        {secciones.length > 0 && (
          <nav aria-label="Secciones" className="border-b border-[var(--color-borde)] py-1.5 md:hidden">
            {secciones.map((seccion) => {
              const activa = ruta === seccion.href || ruta.startsWith(`${seccion.href}/`);
              return (
                <Link
                  key={seccion.href}
                  href={seccion.href}
                  aria-current={activa ? 'page' : undefined}
                  className="block px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-panel-alto)]"
                  style={{ color: activa ? 'var(--color-texto)' : 'var(--color-tenue)' }}
                >
                  {seccion.etiqueta}
                </Link>
              );
            })}
          </nav>
        )}
        <Link
          href="/perfil"
          className="block px-4 py-2.5 text-sm text-[var(--color-tenue)] transition-colors hover:bg-[var(--color-panel-alto)] hover:text-[var(--color-texto)]"
        >
          Mi perfil
        </Link>
        <form action={cerrarSesion}>
          <button
            type="submit"
            className="block w-full px-4 py-2.5 text-left text-sm text-[var(--color-tenue)] transition-colors hover:bg-[var(--color-panel-alto)] hover:text-[var(--color-texto)]"
          >
            Cerrar sesión
          </button>
        </form>
      </div>
    </details>
  );
}
