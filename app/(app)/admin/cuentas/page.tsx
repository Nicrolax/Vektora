import { AdminService, type CuentaAdmin } from '@/lib/admin';
import { NOMBRE_ROL } from '@/lib/auth';
import { requirePermiso } from '@/lib/auth/session';
import { mensajeParaUsuario } from '@/lib/errores';
import { Aviso, Panel } from '@/components/ui/primitivas';
import { PestanasAdmin } from '../pestanas';
import { FilaCuenta } from './fila';

export const metadata = { title: 'Cuentas' };

/** Gestión de cuentas: listar, cambiar rol, suspender/activar y borrar (R2, R3). */
export default async function Cuentas({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const admin = await requirePermiso('admin:cuentas');
  const { q } = await searchParams;
  const texto = typeof q === 'string' && q.trim() !== '' ? q.trim().slice(0, 120) : null;

  let cuentas: CuentaAdmin[] = [];
  let error: string | null = null;
  try {
    cuentas = await new AdminService().listarCuentas(admin.id, texto);
  } catch (causa) {
    error = mensajeParaUsuario(causa);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold">Administración</h1>
          <PestanasAdmin activa="cuentas" />
        </div>
        <form method="get" className="flex gap-2">
          <input name="q" defaultValue={texto ?? ''} placeholder="Buscar por correo o nombre" className="campo !w-64" />
          <button type="submit" className="boton boton-suave">Buscar</button>
        </form>
      </header>

      {error !== null && <Aviso tipo="error">{error}</Aviso>}

      <Panel className="overflow-x-auto p-4">
        <p className="mb-3 text-xs text-[var(--color-apagado)]">
          {cuentas.length} cuenta{cuentas.length === 1 ? '' : 's'}. Roles: {Object.values(NOMBRE_ROL).join(' · ')}.
        </p>
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-borde)] text-left text-[var(--color-apagado)]">
              <th className="px-2 py-2 font-medium">Cuenta</th>
              <th className="px-2 py-2 text-right font-medium">Proyectos</th>
              <th className="px-2 py-2 text-right font-medium">Tareas</th>
              <th className="px-2 py-2 font-medium">Rol y estado</th>
            </tr>
          </thead>
          <tbody>
            {cuentas.map((cuenta) => (
              <FilaCuenta key={cuenta.id} cuenta={cuenta} esYo={cuenta.id === admin.id} />
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
