import Link from 'next/link';
import { requirePermiso } from '@/lib/auth/session';
import { buscarTareas, ESTADOS_BUSCABLES, normalizarFiltros, type ResultadoBusqueda } from '@/lib/consultas';
import { mensajeParaUsuario } from '@/lib/errores';
import { presentarTarea } from '@/components/estados';
import { Aviso, Dinero, Insignia, Panel, Vacio } from '@/components/ui/primitivas';

export const metadata = { title: 'Buscar tareas' };

/**
 * Búsqueda con filtros (R6). Es un formulario GET: los filtros quedan en la URL, así una
 * búsqueda se puede compartir o recargar. La consulta la arma `lib/consultas/busqueda.ts`
 * con parámetros preparados y JOIN a proyectos y perfiles.
 */
export default async function Buscar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermiso('tareas:buscar');
  const crudos = await searchParams;
  const entrada: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(crudos)) entrada[clave] = Array.isArray(valor) ? valor[0] : valor;

  let resultado: ResultadoBusqueda | null = null;
  let error: string | null = null;
  try {
    resultado = await buscarTareas(user.id, normalizarFiltros(entrada));
  } catch (causa) {
    error = mensajeParaUsuario(causa);
  }
  const valor = (clave: string) => (typeof entrada[clave] === 'string' ? (entrada[clave] as string) : '');

  return (
    <div className="space-y-6">
      <header className="entra space-y-1.5">
        <h1 className="text-2xl font-semibold">Buscar tareas</h1>
        <p className="text-sm text-[var(--color-apagado)]">
          Tareas de tus proyectos, de los proyectos públicos y de aquellos donde trabajás.
        </p>
      </header>

      <Panel className="p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-[var(--color-apagado)] sm:col-span-2">
            Texto (título, descripción o proyecto)
            <input name="q" defaultValue={valor('q')} maxLength={120} className="campo" placeholder="reservas, diseño, API…" />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-apagado)]">
            Estado
            <select name="estado" defaultValue={valor('estado')} className="campo">
              <option value="">Cualquiera</option>
              {ESTADOS_BUSCABLES.map((estado) => (
                <option key={estado} value={estado}>
                  {presentarTarea(estado).etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-[var(--color-apagado)]">
            Habilidad
            <input name="skill" defaultValue={valor('skill')} maxLength={80} className="campo" placeholder="react, ui-design…" />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-apagado)]">
            Presupuesto mínimo (USD)
            <input name="min" type="number" min={0} step="any" defaultValue={valor('min')} className="campo" />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-apagado)]">
            Presupuesto máximo (USD)
            <input name="max" type="number" min={0} step="any" defaultValue={valor('max')} className="campo" />
          </label>
          <label className="space-y-1 text-xs text-[var(--color-apagado)]">
            Orden
            <select name="orden" defaultValue={valor('orden') || 'recientes'} className="campo">
              <option value="recientes">Más recientes</option>
              <option value="presupuesto_desc">Mayor presupuesto</option>
              <option value="presupuesto_asc">Menor presupuesto</option>
              <option value="codigo">Proyecto y código</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2.5 text-sm">
            <input type="checkbox" name="libres" value="si" defaultChecked={valor('libres') === 'si'} />
            Solo sin asignar
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="boton boton-primario degradado-marca">
              Buscar
            </button>
            <Link href="/buscar" className="boton boton-suave">
              Limpiar
            </Link>
          </div>
        </form>
      </Panel>

      {error !== null && <Aviso tipo="error">{error}</Aviso>}

      {resultado !== null && (
        <Panel className="p-4">
          <p className="text-xs text-[var(--color-apagado)]">
            {resultado.total === 0
              ? 'Sin resultados.'
              : `${resultado.total} tarea${resultado.total === 1 ? '' : 's'}${resultado.total > resultado.tareas.length ? ` (se muestran ${resultado.tareas.length})` : ''}`}
          </p>
          <div className="mt-3 space-y-2">
            {resultado.tareas.length === 0 && <Vacio>Ninguna tarea coincide con esos filtros.</Vacio>}
            {resultado.tareas.map((tarea) => (
              <Link
                key={tarea.id}
                href={`/tareas/${tarea.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-borde)] bg-[var(--color-panel-alto)] p-3 transition-colors hover:border-[var(--color-acento)]"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm">
                    <span className="mr-2 font-mono text-[11px] text-[var(--color-apagado)]">{tarea.code}</span>
                    {tarea.title}
                  </p>
                  <p className="text-xs text-[var(--color-apagado)]">
                    {tarea.projectTitle}
                    {tarea.duenio !== null && ` · de ${tarea.duenio}`}
                    {tarea.visibility === 'public' && ' · público'}
                    {tarea.asignada !== null && ` · asignada a ${tarea.asignada}`}
                  </p>
                  {tarea.requiredSkills.length > 0 && (
                    <p className="font-mono text-[11px] text-[var(--color-apagado)]">{tarea.requiredSkills.join(', ')}</p>
                  )}
                </div>
                <Insignia estado={tarea.status} />
                <span className="text-sm">
                  <Dinero valor={tarea.budget} />
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
