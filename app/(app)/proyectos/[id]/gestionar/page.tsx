import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermiso } from '@/lib/auth/session';
import { obtenerProyecto } from '@/lib/consultas';
import { esUuid } from '@/lib/db';
import { presentarProyecto } from '@/components/estados';
import { Panel, Titulo } from '@/components/ui/primitivas';
import { FormularioEdicion, FormularioEliminar, FormularioEstado } from './formularios';

export const metadata = { title: 'Gestionar proyecto' };

/** Editar, pausar/reanudar/cancelar y eliminar: la U y la D del CRUD de proyectos (R2). */
export default async function GestionarProyecto({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermiso('proyectos:gestionar');
  const { id } = await params;
  if (!esUuid(id)) notFound();

  const datos = await obtenerProyecto(user.id, id);
  // Solo la dueña gestiona. A cualquier otra persona se le responde como si no existiera.
  if (datos === null || (!datos.proyecto.esMio && user.role !== 'admin')) notFound();
  const { proyecto } = datos;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <Link
          href={`/proyectos/${id}`}
          className="text-xs text-[var(--color-apagado)] transition-colors hover:text-[var(--color-tenue)]"
        >
          ← {proyecto.title}
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Gestionar proyecto</h1>
        <p className="text-sm text-[var(--color-apagado)]">Estado actual: {presentarProyecto(proyecto.status)}</p>
      </header>

      <Panel className="space-y-4 p-5">
        <Titulo ayuda="El objetivo y las tareas los fijó el planificador y no se editan: cambiarlos invalidaría lo ya adjudicado.">
          Datos del proyecto
        </Titulo>
        <FormularioEdicion
          projectId={id}
          inicial={{ title: proyecto.title, description: proyecto.description ?? '', visibility: proyecto.visibility }}
        />
      </Panel>

      <Panel className="space-y-4 p-5">
        <Titulo ayuda="Pausado, el emparejador no adjudica tareas nuevas. Cancelado es definitivo y conserva el historial.">
          Estado
        </Titulo>
        <FormularioEstado projectId={id} estado={proyecto.status} />
      </Panel>

      <Panel className="space-y-4 p-5">
        <Titulo ayuda="Borra el proyecto y sus tareas. Si alguna tarea ya movió reputación, no se puede: cancelalo.">
          Eliminar
        </Titulo>
        <FormularioEliminar projectId={id} />
      </Panel>
    </div>
  );
}
