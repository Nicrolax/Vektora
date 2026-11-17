'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { guardarPerfil, type ResultadoPerfil } from '@/app/acciones/perfil';
import type { MiPerfil } from '@/lib/consultas';
import { Aviso } from '@/components/ui/primitivas';

const INICIAL: ResultadoPerfil = { ok: false, mensaje: null };

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="boton boton-primario">
      {pending ? 'Guardando…' : 'Guardar cambios'}
    </button>
  );
}

export function FormularioPerfil({ inicial }: { inicial: MiPerfil }) {
  const [estado, accion] = useActionState(guardarPerfil, INICIAL);

  return (
    <form action={accion} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="nombre" className="block text-sm font-medium text-[var(--color-tenue)]">
          Nombre
        </label>
        <input
          id="nombre"
          name="nombre"
          autoComplete="name"
          maxLength={120}
          defaultValue={inicial.nombre ?? ''}
          className="campo"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="bio" className="block text-sm font-medium text-[var(--color-tenue)]">
          Presentación
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={4}
          maxLength={600}
          defaultValue={inicial.bio ?? ''}
          aria-describedby="bio-ayuda"
          className="campo resize-y"
        />
        <p id="bio-ayuda" className="text-xs text-[var(--color-apagado)]">
          Opcional, hasta 600 caracteres.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="sitio_web" className="block text-sm font-medium text-[var(--color-tenue)]">
          Sitio web
        </label>
        <input
          id="sitio_web"
          name="sitio_web"
          type="url"
          inputMode="url"
          maxLength={300}
          placeholder="https://"
          defaultValue={inicial.sitioWeb ?? ''}
          className="campo"
        />
      </div>

      {estado.mensaje !== null && <Aviso tipo={estado.ok ? 'ok' : 'error'}>{estado.mensaje}</Aviso>}

      <Guardar />
    </form>
  );
}
