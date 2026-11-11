'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Grafo } from '@/components/grafo/Grafo';
import { contarPorEstado, type TareaGrafo } from '@/components/grafo/disposicion';
import { Insignia } from '@/components/ui/primitivas';
import { ORDEN_TAREA, presentarTarea } from '@/components/estados';

/** Cada cuánto se pregunta si algo cambió. 15 s: suficiente para ver avanzar el ciclo. */
const INTERVALO_MS = 15_000;

/**
 * Grafo más panel lateral, con actualización automática.
 *
 * Antes se usaba Realtime de Supabase; con PostgreSQL común se SONDEA: cada 15 s, y solo
 * con la pestaña visible, se pide a `/api/proyectos/<id>/firma` un resumen del estado de
 * las tareas. Si cambió, se le pide a Next que vuelva a renderizar la página en el
 * servidor. Así los datos siguen pasando por RLS una sola vez, en el servidor, y el
 * navegador nunca recibe más de lo que puede ver. Con la pestaña oculta no se consulta
 * nada: no se gastan conexiones de la base por una pestaña que nadie mira.
 */
export function VistaProyecto({
  projectId,
  tareas,
}: {
  projectId: string;
  tareas: TareaGrafo[];
}) {
  const router = useRouter();
  const [seleccionada, setSeleccionada] = useState<string | null>(tareas[0]?.id ?? null);
  const [vivo, setVivo] = useState(false);

  useEffect(() => {
    let firma: string | null = null;
    let cancelado = false;

    async function consultar() {
      if (document.visibilityState !== 'visible') return;
      try {
        const respuesta = await fetch(`/api/proyectos/${projectId}/firma`, { cache: 'no-store' });
        if (!respuesta.ok) {
          if (!cancelado) setVivo(false);
          return;
        }
        const { firma: nueva } = (await respuesta.json()) as { firma: string };
        if (cancelado) return;
        setVivo(true);
        if (firma !== null && nueva !== firma) router.refresh();
        firma = nueva;
      } catch {
        if (!cancelado) setVivo(false);
      }
    }

    void consultar();
    const temporizador = setInterval(() => void consultar(), INTERVALO_MS);
    // Al volver a la pestaña se consulta enseguida, sin esperar al próximo intervalo.
    const alCambiarVisibilidad = () => void consultar();
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => {
      cancelado = true;
      clearInterval(temporizador);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [projectId, router]);

  const detalle = tareas.find((tarea) => tarea.id === seleccionada) ?? null;
  const cuenta = contarPorEstado(tareas);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {ORDEN_TAREA.filter((estado) => (cuenta.get(estado) ?? 0) > 0).map((estado) => {
            const { etiqueta, color, ayuda } = presentarTarea(estado);
            return (
              <li
                key={estado}
                title={ayuda}
                className="flex items-center gap-1.5 text-xs text-[var(--color-tenue)]"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {cuenta.get(estado)} {etiqueta}
              </li>
            );
          })}
        </ul>

        <span
          className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-apagado)]"
          title={
            vivo
              ? 'Se revisa cada 15 segundos: los cambios de estado aparecen sin recargar.'
              : 'Sin actualización automática: recargá para ver los cambios.'
          }
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: vivo ? 'var(--color-aprobada)' : 'var(--color-apagado)',
            }}
          />
          {vivo ? 'actualización automática' : 'sin actualización automática'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Grafo tareas={tareas} seleccionada={seleccionada} onSeleccionar={setSeleccionada} />

        <aside className="tarjeta entra h-fit p-5" style={{ animationDelay: '80ms' }}>
          {detalle === null ? (
            <p className="text-sm text-[var(--color-apagado)]">
              Elegí una tarea del grafo para ver su detalle.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="font-mono text-xs text-[var(--color-apagado)]">{detalle.code}</p>
                <h2 className="text-sm leading-snug font-medium text-balance">{detalle.title}</h2>
                <Insignia estado={detalle.status} />
              </div>

              <dl className="space-y-2.5 border-t border-[var(--color-borde)] pt-4">
                <div className="space-y-0.5">
                  <dt className="text-xs text-[var(--color-apagado)]">Presupuesto</dt>
                  <dd className="text-sm tabular-nums">
                    {detalle.budget === null ? '—' : `USD ${detalle.budget.toFixed(2)}`}
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs text-[var(--color-apagado)]">Depende de</dt>
                  <dd className="text-sm">
                    {detalle.dependsOn.length === 0 ? (
                      <span className="text-[var(--color-apagado)]">nada: arranca el grafo</span>
                    ) : (
                      <span className="font-mono text-xs">{detalle.dependsOn.join(', ')}</span>
                    )}
                  </dd>
                </div>
                <div className="space-y-0.5">
                  <dt className="text-xs text-[var(--color-apagado)]">Proveedor</dt>
                  <dd className="text-sm">
                    {detalle.assigneeId === null ? (
                      <span className="text-[var(--color-apagado)]">sin adjudicar</span>
                    ) : (
                      'adjudicada'
                    )}
                  </dd>
                </div>
              </dl>

              <Link
                href={`/tareas/${detalle.id}`}
                className="boton boton-suave w-full"
              >
                Ver criterios, candidaturas y veredicto
              </Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
