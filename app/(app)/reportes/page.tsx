import Link from 'next/link';
import { requirePermiso } from '@/lib/auth/session';
import { reporteGeneral, type Reporte } from '@/lib/consultas';
import { mensajeParaUsuario } from '@/lib/errores';
import { presentarProyecto, presentarTarea } from '@/components/estados';
import { Aviso, Dinero, Panel, Titulo, Vacio } from '@/components/ui/primitivas';

export const metadata = { title: 'Reportes' };

/**
 * Reporte con COUNT, SUM y AVG agrupados (R6). Cada tabla es UNA consulta agregada de
 * `lib/consultas/reporte.ts`, y muestra lo que RLS deja ver a esta cuenta.
 */
export default async function Reportes() {
  const user = await requirePermiso('reportes:ver');

  let reporte: Reporte | null = null;
  let error: string | null = null;
  try {
    reporte = await reporteGeneral(user.id);
  } catch (causa) {
    error = mensajeParaUsuario(causa);
  }

  const celda = 'px-3 py-2 text-right tabular-nums';
  const encabezado = 'px-3 py-2 text-right font-medium text-[var(--color-apagado)]';

  return (
    <div className="space-y-6">
      <header className="entra space-y-1.5">
        <h1 className="text-2xl font-semibold">Reportes</h1>
        <p className="text-sm text-[var(--color-apagado)]">
          {user.role === 'admin' ? 'Toda la plataforma.' : 'Calculado sobre lo que tu cuenta puede ver.'}
        </p>
      </header>

      {error !== null && <Aviso tipo="error">{error}</Aviso>}

      {reporte !== null && (
        <>
          <Panel className="overflow-x-auto p-4">
            <Titulo ayuda="COUNT de tareas, COUNT filtrado de aprobadas, SUM y AVG del presupuesto, agrupado por proyecto.">
              Por proyecto
            </Titulo>
            {reporte.proyectos.length === 0 ? (
              <div className="mt-4">
                <Vacio>No hay proyectos visibles.</Vacio>
              </div>
            ) : (
              <table className="mt-4 w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-borde)]">
                    <th className="px-3 py-2 text-left font-medium text-[var(--color-apagado)]">Proyecto</th>
                    <th className={encabezado}>Tareas</th>
                    <th className={encabezado}>Aprobadas</th>
                    <th className={encabezado}>Presupuesto total</th>
                    <th className={encabezado}>Promedio por tarea</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.proyectos.map((fila) => (
                    <tr key={fila.projectId} className="border-b border-[var(--color-borde)] last:border-0">
                      <td className="px-3 py-2">
                        <Link href={`/proyectos/${fila.projectId}`} className="hover:underline">
                          {fila.titulo}
                        </Link>
                        <span className="ml-2 text-xs text-[var(--color-apagado)]">{presentarProyecto(fila.estado)}</span>
                      </td>
                      <td className={celda}>{fila.tareas}</td>
                      <td className={celda}>{fila.aprobadas}</td>
                      <td className={celda}><Dinero valor={fila.presupuestoTotal} /></td>
                      <td className={celda}><Dinero valor={fila.presupuestoPromedio} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
            <Panel className="p-4">
              <Titulo ayuda="COUNT y SUM agrupados por estado de tarea.">Por estado</Titulo>
              <table className="mt-4 w-full text-sm">
                <tbody>
                  {reporte.estados.map((fila) => (
                    <tr key={fila.estado} className="border-b border-[var(--color-borde)] last:border-0">
                      <td className="px-1 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: presentarTarea(fila.estado).color }} />
                          {presentarTarea(fila.estado).etiqueta}
                        </span>
                      </td>
                      <td className={celda}>{fila.tareas}</td>
                      <td className={celda}><Dinero valor={fila.presupuesto} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel className="overflow-x-auto p-4">
              <Titulo ayuda="Tareas asignadas y completadas (COUNT), puntaje promedio de las entregas evaluadas (AVG) y reputación acumulada.">
                Por proveedor
              </Titulo>
              {reporte.proveedores.length === 0 ? (
                <div className="mt-4">
                  <Vacio>Todavía no hay tareas asignadas.</Vacio>
                </div>
              ) : (
                <table className="mt-4 w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-borde)]">
                      <th className="px-3 py-2 text-left font-medium text-[var(--color-apagado)]">Proveedor</th>
                      <th className={encabezado}>Asignadas</th>
                      <th className={encabezado}>Completadas</th>
                      <th className={encabezado}>Puntaje medio</th>
                      <th className={encabezado}>Reputación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reporte.proveedores.map((fila) => (
                      <tr key={fila.userId} className="border-b border-[var(--color-borde)] last:border-0">
                        <td className="px-3 py-2">{fila.nombre ?? 'sin nombre'}</td>
                        <td className={celda}>{fila.asignadas}</td>
                        <td className={celda}>{fila.completadas}</td>
                        <td className={celda}>{fila.puntajePromedio === null ? '—' : fila.puntajePromedio.toFixed(2)}</td>
                        <td className={celda}>{fila.reputacion.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
