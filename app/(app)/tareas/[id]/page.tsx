import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { obtenerTarea } from '@/lib/consultas';
import { esUuid } from '@/lib/db';
import { ESTADOS_ENTREGABLES } from '@/lib/entregas';
import { Dato, Dinero, EnlaceBoton, Insignia, Panel, Titulo, Vacio } from '@/components/ui/primitivas';

const ICONO: Record<string, string> = { pass: '✓', fail: '✗', unverifiable: '?' };
const COLOR: Record<string, string> = {
  pass: 'var(--color-aprobada)',
  fail: 'var(--color-fallida)',
  unverifiable: 'var(--color-revision)',
};

export default async function DetalleTarea({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!esUuid(id)) notFound();

  const datos = await obtenerTarea(user.id, id);
  if (datos === null) notFound();
  const { tarea, candidaturas: listaCandidaturas, entregables: listaEntregables } = datos;
  const criterios = tarea.acceptanceCriteria;
  // El botón solo aparece si la tarea admite una entrega ahora (la acción lo vuelve a comprobar).
  const soyProveedor =
    tarea.assigneeId === user.id && (ESTADOS_ENTREGABLES as readonly string[]).includes(tarea.status);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          href={`/proyectos/${tarea.projectId}`}
          className="text-xs text-[var(--color-apagado)] transition-colors hover:text-[var(--color-tenue)]"
        >
          ← {tarea.projectTitle}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="font-mono text-xs text-[var(--color-apagado)]">{tarea.code}</p>
            <h1 className="text-xl font-semibold tracking-tight text-balance">{tarea.title}</h1>
            <Insignia estado={tarea.status} />
          </div>
          {soyProveedor && (
            <EnlaceBoton href={`/trabajo/${id}`} variante="primario">
              Entregar trabajo
            </EnlaceBoton>
          )}
        </div>
        {tarea.description !== null && (
          <p className="max-w-3xl text-sm leading-relaxed text-[var(--color-tenue)]">
            {tarea.description}
          </p>
        )}
      </header>

      <Panel className="p-4">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Dato etiqueta="Presupuesto" valor={<Dinero valor={tarea.budget} />} />
          <Dato
            etiqueta="Esfuerzo estimado"
            valor={`${tarea.estimatedHours ?? '—'} h`}
          />
          <Dato etiqueta="Criterios" valor={String(criterios.length)} />
          <Dato
            etiqueta="Habilidades"
            valor={
              <span className="font-mono text-xs">{tarea.requiredSkills.join(', ')}</span>
            }
          />
        </dl>
      </Panel>

      <Panel className="p-4">
        <Titulo ayuda="Escritos al planificar, antes de que nadie trabaje. Son el contrato que el evaluador comprueba.">
          Criterios de aceptación
        </Titulo>
        <ul className="mt-4 space-y-3">
          {criterios.map((criterio) => (
            <li key={criterio.id} className="flex gap-3">
              <span className="mt-0.5 shrink-0 font-mono text-[11px] text-[var(--color-apagado)]">
                {criterio.id}
              </span>
              <div className="space-y-1">
                <p className="text-sm leading-relaxed">{criterio.criterion}</p>
                {criterio.verification !== undefined && (
                  <p className="text-xs leading-relaxed text-[var(--color-apagado)]">
                    Se comprueba: {criterio.verification}
                  </p>
                )}
              </div>
            </li>
          ))}
          {criterios.length === 0 && <Vacio>Esta tarea no tiene criterios registrados.</Vacio>}
        </ul>
      </Panel>

      <Panel className="p-4">
        <Titulo ayuda="Puntuación de cada candidato con su desglose. Ninguna adjudicación ocurre sin esta explicación.">
          Candidaturas
        </Titulo>
        <div className="mt-4 space-y-3">
          {listaCandidaturas.length === 0 && (
            <Vacio>Todavía no se puntuó ningún candidato para esta tarea.</Vacio>
          )}
          {listaCandidaturas.map((candidatura) => (
            <div
              key={candidatura.id}
              className="rounded-lg border border-[var(--color-borde)] bg-[var(--color-panel-alto)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium tabular-nums">
                  {(candidatura.matchScore ?? 0).toFixed(4)}
                </span>
                <span className="text-xs text-[var(--color-apagado)]">
                  {candidatura.proveedor ?? 'proveedor'} · {candidatura.status}
                </span>
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--color-tenue)]">
                <span>afinidad {(candidatura.vectorScore ?? 0).toFixed(3)}</span>
                <span>habilidades {(candidatura.skillScore ?? 0).toFixed(3)}</span>
                <span>reputación {(candidatura.reputationScore ?? 0).toFixed(3)}</span>
              </dl>
              {candidatura.resumen !== null && (
                <p className="mt-2 text-xs leading-relaxed text-[var(--color-apagado)]">
                  {candidatura.resumen}
                </p>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="p-4">
        <Titulo ayuda="Cada entrega con el veredicto del evaluador, criterio por criterio y con la evidencia citada.">
          Entregas y veredictos
        </Titulo>
        <div className="mt-4 space-y-4">
          {listaEntregables.length === 0 && <Vacio>Todavía no hay ninguna entrega.</Vacio>}
          {listaEntregables.map((entregable) => (
            <article
              key={entregable.id}
              className="rounded-lg border border-[var(--color-borde)] bg-[var(--color-panel-alto)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-[var(--color-apagado)]">
                    v{entregable.version}
                  </span>
                  <Insignia estado={entregable.qaStatus} tipo="qa" />
                </div>
                {entregable.qaScore !== null && (
                  <span className="text-sm tabular-nums">
                    {entregable.qaScore.toFixed(2)} / 100
                  </span>
                )}
              </div>

              {entregable.summary !== null && (
                <p className="mt-2.5 text-sm leading-relaxed">{entregable.summary}</p>
              )}

              {entregable.qaResumen !== null && (
                <p className="mt-3 rounded-md border-l-2 border-[var(--color-acento)] bg-[var(--color-panel)] px-3 py-2 text-xs leading-relaxed text-[var(--color-tenue)]">
                  {entregable.qaResumen}
                </p>
              )}

              {entregable.criterios.length > 0 && (
                <ul className="mt-3 space-y-2.5 border-t border-[var(--color-borde)] pt-3">
                  {entregable.criterios.map((resultado) => (
                    <li key={resultado.id} className="flex gap-2.5">
                      <span
                        aria-hidden
                        className="mt-px shrink-0 font-mono text-sm"
                        style={{ color: COLOR[resultado.outcome] ?? 'var(--color-apagado)' }}
                      >
                        {ICONO[resultado.outcome] ?? '·'}
                      </span>
                      <div className="space-y-1">
                        <p className="text-xs">
                          <span className="font-mono text-[var(--color-apagado)]">
                            {resultado.id}
                          </span>{' '}
                          <span style={{ color: COLOR[resultado.outcome] }}>
                            {resultado.outcome}
                          </span>
                          {resultado.downgraded && (
                            <span className="text-[var(--color-apagado)]">
                              {' '}
                              — el modelo dijo {resultado.reported}, degradado por confianza{' '}
                              {resultado.confidence.toFixed(2)}
                            </span>
                          )}
                        </p>
                        <p className="text-xs leading-relaxed text-[var(--color-tenue)]">
                          {resultado.reasoning}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
