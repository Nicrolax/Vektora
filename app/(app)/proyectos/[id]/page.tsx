import Link from 'next/link';
import { notFound } from 'next/navigation';
import { esUuid } from '@/lib/db';
import { requireUser } from '@/lib/auth/session';
import { obtenerProyecto } from '@/lib/consultas';
import { presentarProyecto } from '@/components/estados';
import { Dinero } from '@/components/ui/primitivas';
import type { TareaGrafo } from '@/components/grafo/disposicion';
import { VistaProyecto } from './vista';

export default async function DetalleProyecto({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Un id que no es uuid no llega a la base: PostgreSQL respondería con un error de tipo.
  if (!esUuid(id)) notFound();

  // Sin resultado significa que no existe o que RLS no deja verlo. La interfaz responde
  // igual en los dos casos: revelar la diferencia permitiría averiguar qué proyectos existen.
  const datos = await obtenerProyecto(user.id, id);
  if (datos === null) notFound();
  const { proyecto, tareas } = datos;

  const paraGrafo: TareaGrafo[] = tareas.map((tarea) => ({
    id: tarea.id,
    code: tarea.code,
    title: tarea.title,
    status: tarea.status,
    dependsOn: tarea.dependsOn,
    assigneeId: tarea.assigneeId,
    budget: tarea.budget,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          href="/panel"
          className="text-xs text-[var(--color-apagado)] transition-colors hover:text-[var(--color-tenue)]"
        >
          ← Mis proyectos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-balance">{proyecto.title}</h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--color-apagado)]">{proyecto.objective}</p>
            {proyecto.description !== null && (
              <p className="max-w-2xl text-sm leading-relaxed text-[var(--color-tenue)]">{proyecto.description}</p>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-5">
            <dl className="flex gap-6 text-right">
              <div>
                <dt className="text-xs text-[var(--color-apagado)]">Estado</dt>
                <dd className="text-sm">{presentarProyecto(proyecto.status)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-apagado)]">Presupuesto</dt>
                <dd className="text-sm">
                  <Dinero valor={proyecto.budgetTotal} moneda={proyecto.currency} />
                </dd>
              </div>
            </dl>
            {proyecto.esMio && (
              <div className="flex gap-2">
                <Link href={`/proyectos/${id}/consumo`} className="boton boton-suave !px-3 !py-1.5 !text-xs">
                  Consumo de IA
                </Link>
                <Link href={`/proyectos/${id}/gestionar`} className="boton boton-suave !px-3 !py-1.5 !text-xs">
                  Gestionar
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      <VistaProyecto projectId={id} tareas={paraGrafo} />
    </div>
  );
}
