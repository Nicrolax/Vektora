'use client';

import { useFormStatus } from 'react-dom';
import { iniciarSesion, registrarse } from './acciones';

function Boton({ children, variante }: { children: React.ReactNode; variante: 'primario' | 'suave' }) {
  const { pending } = useFormStatus();
  const clases =
    variante === 'primario' ? 'boton boton-primario degradado-marca w-full' : 'boton boton-suave w-full';
  return (
    <button type="submit" disabled={pending} className={clases}>
      {pending ? 'Un momento…' : children}
    </button>
  );
}

function Campo({
  id,
  etiqueta,
  ayuda,
  ...props
}: { id: string; etiqueta: string; ayuda?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-[var(--color-tenue)]">
        {etiqueta}
      </label>
      <input id={id} name={props.name ?? id} className="campo" {...props} />
      {ayuda !== undefined && <p className="text-xs text-[var(--color-apagado)]">{ayuda}</p>}
    </div>
  );
}

/**
 * Dos formularios HERMANOS, no anidados: anidar formularios es HTML inválido y el navegador
 * descarta el interno sin avisar (ya pasó una vez en este proyecto).
 */
export function FormularioAcceso() {
  return (
    <div className="space-y-6">
      <form action={iniciarSesion} className="space-y-4">
        <Campo id="email" name="email" etiqueta="Correo" type="email" autoComplete="email" required placeholder="tu@correo.com" />
        <Campo id="password" name="password" etiqueta="Contraseña" type="password" autoComplete="current-password" required />
        <div className="pt-1">
          <Boton variante="primario">Entrar</Boton>
        </div>
      </form>

      <details className="group rounded-xl border border-[var(--color-borde)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-[var(--color-tenue)] select-none">
          ¿Primera vez? Crear una cuenta
        </summary>
        <form action={registrarse} className="mt-4 space-y-4">
          <Campo id="nombre-alta" name="nombre" etiqueta="Nombre" autoComplete="name" maxLength={120} placeholder="Cómo querés que te vean" />
          <Campo id="email-alta" name="email" etiqueta="Correo" type="email" autoComplete="email" required placeholder="tu@correo.com" />
          <Campo
            id="password-alta"
            name="password"
            etiqueta="Contraseña"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            ayuda="Entre 8 y 72 caracteres. Se guarda solo su hash BCrypt."
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-[var(--color-tenue)]">¿Qué vas a hacer?</legend>
            {[
              { valor: 'client', texto: 'Publicar proyectos' },
              { valor: 'provider', texto: 'Ofrecer mi trabajo' },
              { valor: 'both', texto: 'Las dos cosas' },
            ].map((opcion) => (
              <label key={opcion.valor} className="flex items-center gap-2.5 text-sm">
                <input type="radio" name="role" value={opcion.valor} defaultChecked={opcion.valor === 'both'} required />
                {opcion.texto}
              </label>
            ))}
          </fieldset>
          <Boton variante="suave">Crear cuenta</Boton>
        </form>
      </details>
    </div>
  );
}
