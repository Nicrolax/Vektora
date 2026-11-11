'use client';

import { useActionState } from 'react';
import {
  actualizarProyecto,
  cambiarEstadoProyecto,
  eliminarProyecto,
  type ResultadoGestion,
} from '@/app/acciones/proyectos';
import { Aviso } from '@/components/ui/primitivas';

const INICIAL: ResultadoGestion = { ok: false, mensaje: null };

function Resultado({ estado }: { estado: ResultadoGestion }) {
  if (estado.mensaje === null) return null;
  return <Aviso tipo={estado.ok ? 'ok' : 'error'}>{estado.mensaje}</Aviso>;
}

export function FormularioEdicion({
  projectId,
  inicial,
}: {
  projectId: string;
  inicial: { title: string; description: string; visibility: string };
}) {
  const [estado, accion, pendiente] = useActionState(actualizarProyecto, INICIAL);
  return (
    <form action={accion} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="space-y-1.5">
        <label htmlFor="title" className="block text-sm font-medium text-[var(--color-tenue)]">
          Título
        </label>
        <input id="title" name="title" defaultValue={inicial.title} required minLength={3} maxLength={200} className="campo" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium text-[var(--color-tenue)]">
          Descripción (opcional)
        </label>
        <textarea id="description" name="description" defaultValue={inicial.description} maxLength={4000} rows={4} className="campo" />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[var(--color-tenue)]">Visibilidad</legend>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="radio" name="visibility" value="private" defaultChecked={inicial.visibility !== 'public'} />
          Privado: solo vos y quienes trabajan en él
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="radio" name="visibility" value="public" defaultChecked={inicial.visibility === 'public'} />
          Público: aparece en la búsqueda de todas las cuentas
        </label>
      </fieldset>
      <Resultado estado={estado} />
      <button type="submit" disabled={pendiente} className="boton boton-primario degradado-marca">
        {pendiente ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </form>
  );
}

const BOTONES: Record<string, { accion: string; texto: string }[]> = {
  planned: [
    { accion: 'pausar', texto: 'Pausar' },
    { accion: 'cancelar', texto: 'Cancelar proyecto' },
  ],
  active: [
    { accion: 'pausar', texto: 'Pausar' },
    { accion: 'cancelar', texto: 'Cancelar proyecto' },
  ],
  paused: [
    { accion: 'reanudar', texto: 'Reanudar' },
    { accion: 'cancelar', texto: 'Cancelar proyecto' },
  ],
};

export function FormularioEstado({ projectId, estado: actual }: { projectId: string; estado: string }) {
  const [estado, accion, pendiente] = useActionState(cambiarEstadoProyecto, INICIAL);
  const botones = BOTONES[actual] ?? (['completed', 'cancelled'].includes(actual) ? [] : [{ accion: 'cancelar', texto: 'Cancelar proyecto' }]);
  if (botones.length === 0) {
    return <p className="text-sm text-[var(--color-apagado)]">El proyecto ya terminó: no admite cambios de estado.</p>;
  }
  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        {botones.map((boton) => (
          <button key={boton.accion} type="submit" name="accion" value={boton.accion} disabled={pendiente} className="boton boton-suave">
            {boton.texto}
          </button>
        ))}
      </div>
      <Resultado estado={estado} />
    </form>
  );
}

export function FormularioEliminar({ projectId }: { projectId: string }) {
  const [estado, accion, pendiente] = useActionState(eliminarProyecto, INICIAL);
  return (
    <form action={accion} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="space-y-1.5">
        <label htmlFor="confirmacion" className="block text-sm font-medium text-[var(--color-tenue)]">
          Escribí ELIMINAR para confirmar
        </label>
        <input id="confirmacion" name="confirmacion" autoComplete="off" className="campo" />
      </div>
      <Resultado estado={estado} />
      <button
        type="submit"
        disabled={pendiente}
        className="boton boton-suave"
        style={{ color: 'var(--color-fallida)' }}
      >
        {pendiente ? 'Eliminando…' : 'Eliminar proyecto'}
      </button>
    </form>
  );
}
