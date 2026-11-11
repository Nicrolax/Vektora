import Link from 'next/link';
import { requirePermiso } from '@/lib/auth/session';
import { perfilProveedor, trabajoDelProveedor } from '@/lib/consultas';
import { Dato, Dinero, EnlaceBoton, Insignia, Panel, Titulo, Vacio } from '@/components/ui/primitivas';

export const metadata = { title: 'Mi trabajo' };

const EVENTO: Record<string, string> = {
  onboarding_bonus: 'bonificación de alta',
  deliverable_approved: 'entregable aprobado',
  deliverable_rejected: 'entregable rechazado',
  task_completed: 'tarea completada',
  task_failed: 'tarea fallida',
  review_received: 'reseña recibida',
  deadline_met: 'plazo cumplido',
  deadline_missed: 'plazo incumplido',
  evidence_verified: 'evidencia verificada',
  evidence_disputed: 'evidencia cuestionada',
  manual_adjustment: 'ajuste manual',
};

export default async function PanelProveedor() {
  const user = await requirePermiso('proveedor:perfil');
  const perfil = await perfilProveedor(user.id);

  if (perfil === null) {
    return (
      <div className="mx-auto max-w-xl space-y-5 py-10 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Todavía no ofrecés tu trabajo</h1>
        <p className="text-sm leading-relaxed text-[var(--color-apagado)]">
          Creá tu perfil de proveedor y el sistema empezará a compararlo con cada tarea que
          entre. No hay que postularse a nada: si encajás, te llega.
        </p>
        <div className="flex justify-center">
          <EnlaceBoton href="/proveedor/alta" variante="primario">
            Crear mi perfil
          </EnlaceBoton>
        </div>
      </div>
    );
  }

  const { tareas: misTareas, eventos: misEventos } = await trabajoDelProveedor(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Mi trabajo</h1>
          <p className="text-sm text-[var(--color-apagado)]">{perfil.headline}</p>
        </div>
        <EnlaceBoton href="/proveedor/alta">Editar perfil</EnlaceBoton>
      </div>

      {!perfil.acceptsAutoAssign && (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-revision)]/40 bg-[var(--color-revision)]/10 px-3 py-2.5 text-sm leading-relaxed text-[var(--color-revision)]"
        >
          Tenés desactivada la adjudicación automática, así que no vas a recibir ninguna tarea.
          Activala en tu perfil para entrar en los emparejamientos.
        </p>
      )}

      <Panel className="p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Dato
            etiqueta="Reputación"
            valor={perfil.reputationScore.toFixed(2)}
          />
          <Dato
            etiqueta="Valoración media"
            valor={
              perfil.avgRating === null ? 'sin historial' : `${perfil.avgRating.toFixed(2)} / 5`
            }
          />
          <Dato etiqueta="Tareas completadas" valor={String(perfil.tasksCompleted)} />
          <Dato etiqueta="Tareas fallidas" valor={String(perfil.tasksFailed)} />
        </dl>
      </Panel>

      <Panel className="p-4">
        <Titulo ayuda="Adjudicadas automáticamente: ninguna hizo falta postularse.">
          Tareas asignadas
        </Titulo>
        <div className="mt-4 space-y-2">
          {misTareas.length === 0 && (
            <Vacio>
              Todavía no te adjudicaron ninguna tarea. El emparejador revisa periódicamente las
              tareas disponibles.
            </Vacio>
          )}
          {misTareas.map((tarea) => {
            const puedeEntregar = ['assigned', 'in_progress', 'revision_requested'].includes(
              tarea.status,
            );
            return (
              <div
                key={tarea.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-borde)] bg-[var(--color-panel-alto)] p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <Link href={`/tareas/${tarea.id}`} className="block text-sm hover:underline">
                    <span className="mr-2 font-mono text-[11px] text-[var(--color-apagado)]">
                      {tarea.code}
                    </span>
                    {tarea.title}
                  </Link>
                  <p className="text-xs text-[var(--color-apagado)]">{tarea.projectTitle}</p>
                </div>
                <Insignia estado={tarea.status} />
                <span className="text-sm">
                  <Dinero valor={tarea.budget} />
                </span>
                {puedeEntregar && (
                  <Link
                    href={`/trabajo/${tarea.id}`}
                    className="boton boton-primario degradado-marca !px-3 !py-1.5 !text-xs"
                  >
                    Entregar
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="p-4">
        <Titulo ayuda="Registro inmutable: cualquier puntuación se reconstruye sumando estos eventos.">
          Historial de reputación
        </Titulo>
        <div className="mt-4 space-y-1.5">
          {misEventos.length === 0 && <Vacio>Todavía no hay eventos de reputación.</Vacio>}
          {misEventos.map((evento) => {
            const delta = evento.puntos;
            return (
              <div
                key={evento.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--color-borde)] pb-1.5 text-xs last:border-0"
              >
                <span
                  className="w-14 shrink-0 text-right font-medium tabular-nums"
                  style={{
                    color: delta >= 0 ? 'var(--color-aprobada)' : 'var(--color-fallida)',
                  }}
                >
                  {delta >= 0 ? '+' : ''}
                  {delta.toFixed(2)}
                </span>
                <span>{EVENTO[evento.eventType] ?? evento.eventType}</span>
                {evento.reason !== null && (
                  <span className="text-[var(--color-apagado)]">{evento.reason}</span>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
