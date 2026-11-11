import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requirePermiso } from '@/lib/auth/session';
import { obtenerTarea } from '@/lib/consultas';
import { esUuid } from '@/lib/db';
import { Dato, Dinero, Insignia, Panel } from '@/components/ui/primitivas';
import { FormularioEntrega } from './formulario';

export const metadata = { title: 'Entregar trabajo' };

export default async function Workspace({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await requirePermiso('trabajo:entregar');
  const { taskId } = await params;
  if (!esUuid(taskId)) notFound();

  const datos = await obtenerTarea(user.id, taskId);
  if (datos === null) notFound();
  const { tarea } = datos;

  // El espacio de entrega es de la persona adjudicada. Al resto se le devuelve al detalle
  // de la tarea, que sí puede ver. (La acción lo vuelve a comprobar dentro de la transacción.)
  if (tarea.assigneeId !== user.id) redirect(`/tareas/${taskId}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-3">
        <Link
          href={`/tareas/${taskId}`}
          className="text-xs text-[var(--color-apagado)] transition-colors hover:text-[var(--color-tenue)]"
        >
          ← {tarea.code} · {tarea.title}
        </Link>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-balance">Entregar trabajo</h1>
          <Insignia estado={tarea.status} />
        </div>
      </header>

      <Panel className="p-4">
        <p className="text-xs text-[var(--color-apagado)]">Contexto del proyecto</p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-tenue)]">{tarea.projectObjective}</p>
        {tarea.description !== null && (
          <p className="mt-3 border-t border-[var(--color-borde)] pt-3 text-sm leading-relaxed">{tarea.description}</p>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-borde)] pt-4 sm:grid-cols-3">
          <Dato etiqueta="Pago" valor={<Dinero valor={tarea.budget} />} />
          <Dato etiqueta="Esfuerzo" valor={`${tarea.estimatedHours ?? '—'} h`} />
          <Dato etiqueta="Criterios" valor={String(tarea.acceptanceCriteria.length)} />
        </dl>
      </Panel>

      <Panel className="p-5">
        <FormularioEntrega taskId={taskId} criterios={tarea.acceptanceCriteria} />
      </Panel>

      <p className="text-xs leading-relaxed text-[var(--color-apagado)]">
        Al entregar, la tarea entra en la cola de evaluación automática. El evaluador comprueba
        cada criterio por separado y cita la parte de tu evidencia que lo demuestra. Si algo no
        se puede verificar, pide cambios en lugar de rechazar.
      </p>
    </div>
  );
}
