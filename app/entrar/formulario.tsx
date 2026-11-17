'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { NIVEL_MINIMO_CONTRASENA, evaluarContrasena } from '@/lib/validacion/entrada';
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

const COLOR_NIVEL = [
  'var(--color-fallida)',
  'var(--color-fallida)',
  'var(--color-revision)',
  'var(--color-aprobada)',
  'var(--color-aprobada)',
];

/**
 * Contraseña nueva + confirmación. Los avisos van por `setCustomValidity`: el navegador no
 * envía el formulario mientras haya uno, y lo anuncia como cualquier otro campo inválido. El
 * servidor repite las dos comprobaciones (`acciones.ts` y `AuthService.registrar`).
 */
function ContrasenaNueva({ correo }: { correo: string }) {
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const fuerza = evaluarContrasena(clave, correo);
  const debil = clave !== '' && fuerza.nivel < NIVEL_MINIMO_CONTRASENA;
  const distinta = confirmacion !== '' && confirmacion !== clave;

  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor="password-alta" className="block text-sm font-medium text-[var(--color-tenue)]">
          Contraseña
        </label>
        <input
          id="password-alta"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          aria-describedby="fuerza-alta"
          className="campo"
          value={clave}
          // Ref en línea: se vuelve a aplicar en cada render, así también acompaña los cambios del correo.
          ref={(el) => el?.setCustomValidity(debil ? `Contraseña ${fuerza.etiqueta.toLowerCase()}. ${fuerza.consejo ?? ''}` : '')}
          onChange={(e) => setClave(e.target.value)}
        />
        <div id="fuerza-alta" aria-live="polite" className="space-y-1.5 pt-0.5">
          <div aria-hidden className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((paso) => (
              <span
                key={paso}
                className="h-1 rounded-full transition-colors duration-200"
                style={{
                  backgroundColor:
                    clave !== '' && fuerza.nivel >= paso ? COLOR_NIVEL[fuerza.nivel] : 'var(--color-borde)',
                }}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--color-apagado)]">
            {clave === '' ? (
              'Entre 8 y 72 caracteres. Se guarda solo su hash BCrypt.'
            ) : (
              <>
                <span style={{ color: COLOR_NIVEL[fuerza.nivel] }}>{fuerza.etiqueta}.</span>{' '}
                {debil ? fuerza.consejo : (fuerza.consejo ?? 'Lista para usar.')}
              </>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password-confirmacion" className="block text-sm font-medium text-[var(--color-tenue)]">
          Repetí la contraseña
        </label>
        <input
          id="password-confirmacion"
          name="password_confirmacion"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={distinta}
          aria-describedby="confirmacion-alta"
          className="campo"
          value={confirmacion}
          ref={(el) => el?.setCustomValidity(confirmacion !== clave ? 'Las dos contraseñas no coinciden.' : '')}
          onChange={(e) => setConfirmacion(e.target.value)}
        />
        {distinta && (
          <p id="confirmacion-alta" className="text-xs text-[var(--color-fallida)]">
            Las dos contraseñas no coinciden.
          </p>
        )}
      </div>
    </>
  );
}

export type Rol = 'client' | 'provider' | 'both';

/**
 * Dos formularios HERMANOS, no anidados: anidar formularios es HTML inválido y el navegador
 * descarta el interno sin avisar (ya pasó una vez en este proyecto).
 */
export function FormularioAcceso({ alta }: { alta: Rol | null }) {
  // `alta` llega de la landing (?alta=client|provider|both): abre directo el alta con ese rol.
  const [modo, setModo] = useState<'entrar' | 'crear'>(alta === null ? 'entrar' : 'crear');
  const [correoAlta, setCorreoAlta] = useState('');

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Acceso"
        className="grid grid-cols-2 rounded-xl bg-[var(--color-lienzo-alto)] p-1"
      >
        {(
          [
            { valor: 'entrar', texto: 'Entrar' },
            { valor: 'crear', texto: 'Crear cuenta' },
          ] as const
        ).map((pestana) => (
          <button
            key={pestana.valor}
            type="button"
            role="tab"
            aria-selected={modo === pestana.valor}
            aria-controls={`panel-${pestana.valor}`}
            onClick={() => setModo(pestana.valor)}
            className="rounded-lg py-2 text-sm font-medium transition-colors duration-200"
            style={{
              backgroundColor: modo === pestana.valor ? 'var(--color-panel-alto)' : 'transparent',
              color: modo === pestana.valor ? 'var(--color-texto)' : 'var(--color-apagado)',
            }}
          >
            {pestana.texto}
          </button>
        ))}
      </div>

      <form
        id="panel-entrar"
        role="tabpanel"
        hidden={modo !== 'entrar'}
        action={iniciarSesion}
        className="space-y-4"
      >
        <Campo
          id="email"
          name="email"
          etiqueta="Correo"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
        />
        <Campo
          id="password"
          name="password"
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="pt-1">
          <Boton variante="primario">Entrar</Boton>
        </div>
      </form>

      <form
        id="panel-crear"
        role="tabpanel"
        hidden={modo !== 'crear'}
        action={registrarse}
        className="space-y-4"
      >
        <Campo
          id="nombre-alta"
          name="nombre"
          etiqueta="Nombre"
          autoComplete="name"
          maxLength={120}
          placeholder="Cómo querés que te vean"
        />
        <Campo
          id="email-alta"
          name="email"
          etiqueta="Correo"
          type="email"
          autoComplete="email"
          required
          placeholder="tu@correo.com"
          onChange={(e) => setCorreoAlta(e.target.value)}
        />
        <ContrasenaNueva correo={correoAlta} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-[var(--color-tenue)]">¿Qué vas a hacer?</legend>
          {[
            { valor: 'client', texto: 'Publicar proyectos' },
            { valor: 'provider', texto: 'Ofrecer mi trabajo' },
            { valor: 'both', texto: 'Las dos cosas' },
          ].map((opcion) => (
            <label key={opcion.valor} className="flex items-center gap-2.5 text-sm">
              <input
                type="radio"
                name="role"
                value={opcion.valor}
                defaultChecked={opcion.valor === (alta ?? 'both')}
                required
              />
              {opcion.texto}
            </label>
          ))}
        </fieldset>
        <div className="pt-1">
          <Boton variante="primario">Crear cuenta</Boton>
        </div>
      </form>
    </div>
  );
}
