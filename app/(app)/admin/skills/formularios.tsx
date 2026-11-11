'use client';

import { useActionState } from 'react';
import { crearSkill, gestionarSkill, type ResultadoAdmin } from '@/app/acciones/admin';
import type { SkillAdmin } from '@/lib/admin';
import { Aviso } from '@/components/ui/primitivas';

const INICIAL: ResultadoAdmin = { ok: false, mensaje: null };

export function FormularioNuevaSkill() {
  const [estado, accion, pendiente] = useActionState(crearSkill, INICIAL);
  return (
    <form action={accion} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-[var(--color-apagado)]">
          Identificador
          <input name="slug" required maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="diseno-ux" className="campo" />
        </label>
        <label className="space-y-1 text-xs text-[var(--color-apagado)]">
          Nombre
          <input name="name" required minLength={2} maxLength={80} placeholder="Diseño UX" className="campo" />
        </label>
        <label className="space-y-1 text-xs text-[var(--color-apagado)]">
          Categoría
          <input name="category" maxLength={40} placeholder="design" className="campo" />
        </label>
      </div>
      {estado.mensaje !== null && <Aviso tipo={estado.ok ? 'ok' : 'error'}>{estado.mensaje}</Aviso>}
      <button type="submit" disabled={pendiente} className="boton boton-primario degradado-marca">
        {pendiente ? 'Creando…' : 'Crear skill'}
      </button>
    </form>
  );
}

export function FilaSkill({ skill }: { skill: SkillAdmin }) {
  const [estado, accion, pendiente] = useActionState(gestionarSkill, INICIAL);
  return (
    <tr className="border-b border-[var(--color-borde)] align-top last:border-0" style={{ opacity: skill.isActive ? 1 : 0.6 }}>
      <td className="px-2 py-2.5 font-mono text-xs">{skill.slug}</td>
      <td className="px-2 py-2.5" colSpan={1}>
        <form id={`skill-${skill.id}`} action={accion} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="skillId" value={skill.id} />
          <input name="name" defaultValue={skill.name} aria-label="Nombre" required minLength={2} maxLength={80} className="campo !w-44 !py-1 text-xs" />
          <input name="category" defaultValue={skill.category ?? ''} aria-label="Categoría" maxLength={40} className="campo !w-28 !py-1 text-xs" />
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" name="isActive" value="si" defaultChecked={skill.isActive} />
            activa
          </label>
        </form>
        {estado.mensaje !== null && (
          <p className="mt-1 text-xs" style={{ color: estado.ok ? 'var(--color-aprobada)' : 'var(--color-fallida)' }} role={estado.ok ? 'status' : 'alert'}>
            {estado.mensaje}
          </p>
        )}
      </td>
      <td className="px-2 py-2.5 text-right tabular-nums">{skill.proveedores}</td>
      <td className="px-2 py-2.5 text-right tabular-nums">{skill.tareas}</td>
      <td className="px-2 py-2.5">
        <div className="flex gap-1.5">
          <button type="submit" form={`skill-${skill.id}`} name="operacion" value="guardar" disabled={pendiente} className="boton boton-suave !px-2.5 !py-1 !text-xs">
            Guardar
          </button>
          <button
            type="submit"
            form={`skill-${skill.id}`}
            name="operacion"
            value="eliminar"
            disabled={pendiente}
            className="boton boton-suave !px-2.5 !py-1 !text-xs"
            style={{ color: 'var(--color-fallida)' }}
            onClick={(evento) => {
              if (!window.confirm(`¿Borrar la skill ${skill.slug}?`)) evento.preventDefault();
            }}
          >
            Borrar
          </button>
        </div>
      </td>
    </tr>
  );
}
