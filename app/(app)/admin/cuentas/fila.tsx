'use client';

import { useActionState } from 'react';
import { gestionarCuenta, type ResultadoAdmin } from '@/app/acciones/admin';
import type { CuentaAdmin } from '@/lib/admin';

const INICIAL: ResultadoAdmin = { ok: false, mensaje: null };

const ROLES: { valor: CuentaAdmin['role']; texto: string }[] = [
  { valor: 'client', texto: 'Cliente' },
  { valor: 'provider', texto: 'Proveedor' },
  { valor: 'both', texto: 'Cliente y proveedor' },
  { valor: 'admin', texto: 'Administración' },
];

export function FilaCuenta({ cuenta, esYo }: { cuenta: CuentaAdmin; esYo: boolean }) {
  const [estado, accion, pendiente] = useActionState(gestionarCuenta, INICIAL);
  const suspendida = cuenta.status !== 'active';

  return (
    <tr className="border-b border-[var(--color-borde)] align-top last:border-0" style={{ opacity: suspendida ? 0.65 : 1 }}>
      <td className="px-2 py-2.5">
        <p>{cuenta.nombre ?? 'sin nombre'}{esYo && <span className="ml-1.5 text-xs text-[var(--color-apagado)]">(vos)</span>}</p>
        <p className="text-xs text-[var(--color-apagado)]">{cuenta.email ?? '—'}</p>
        {estado.mensaje !== null && (
          <p className="mt-1 text-xs" style={{ color: estado.ok ? 'var(--color-aprobada)' : 'var(--color-fallida)' }} role={estado.ok ? 'status' : 'alert'}>
            {estado.mensaje}
          </p>
        )}
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums">{cuenta.proyectos}</td>
      <td className="px-2 py-2.5 text-right tabular-nums">{cuenta.tareasAsignadas}</td>
      <td className="px-2 py-2.5">
        <form action={accion} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="cuentaId" value={cuenta.id} />
          <select name="role" defaultValue={cuenta.role} aria-label="Rol" className="campo !w-auto !py-1 text-xs" disabled={pendiente}>
            {ROLES.map((rol) => (
              <option key={rol.valor} value={rol.valor}>{rol.texto}</option>
            ))}
          </select>
          <button type="submit" name="operacion" value="rol" className="boton boton-suave !px-2.5 !py-1 !text-xs" disabled={pendiente}>
            Cambiar rol
          </button>
          {!esYo && (
            <>
              <button
                type="submit"
                name="operacion"
                value={suspendida ? 'activar' : 'suspender'}
                className="boton boton-suave !px-2.5 !py-1 !text-xs"
                disabled={pendiente}
              >
                {suspendida ? 'Activar' : 'Suspender'}
              </button>
              <button
                type="submit"
                name="operacion"
                value="eliminar"
                className="boton boton-suave !px-2.5 !py-1 !text-xs"
                style={{ color: 'var(--color-fallida)' }}
                disabled={pendiente}
                onClick={(evento) => {
                  if (!window.confirm(`¿Borrar la cuenta ${cuenta.email ?? ''}? Se borran también sus proyectos.`)) evento.preventDefault();
                }}
              >
                Borrar
              </button>
            </>
          )}
        </form>
      </td>
    </tr>
  );
}
