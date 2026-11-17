import Link from 'next/link';
import type { Route } from 'next';
import { presentarTarea, presentarQa } from '@/components/estados';

/** Etiqueta de estado. El punto de color es el mismo dato que colorea el grafo. */
export function Insignia({ estado, tipo = 'tarea' }: { estado: string; tipo?: 'tarea' | 'qa' }) {
  const { etiqueta, color, ayuda } = tipo === 'qa' ? presentarQa(estado) : presentarTarea(estado);
  return (
    <span
      title={ayuda}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{
        borderColor: `color-mix(in oklch, ${color} 35%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
        color,
      }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {etiqueta}
    </span>
  );
}

/** Bloque de una página: separado por una línea y aire, no encerrado en una caja. */
export function Panel({
  children,
  className = '',
  retraso = 0,
}: {
  children: React.ReactNode;
  className?: string;
  retraso?: number;
}) {
  return (
    <section
      className={`seccion entra ${className}`}
      style={retraso > 0 ? { animationDelay: `${retraso}ms` } : undefined}
    >
      {children}
    </section>
  );
}

export function Titulo({ children, ayuda }: { children: React.ReactNode; ayuda?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold">{children}</h2>
      {ayuda !== undefined && (
        <p className="max-w-[65ch] text-xs leading-relaxed text-[var(--color-apagado)]">{ayuda}</p>
      )}
    </div>
  );
}

export function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-[var(--color-apagado)]">
        {etiqueta}
      </dt>
      <dd className="text-lg font-medium tabular-nums">{valor}</dd>
    </div>
  );
}

export function Vacio({ children, accion }: { children: React.ReactNode; accion?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 py-6">
      <p className="max-w-[60ch] text-sm leading-relaxed text-[var(--color-apagado)]">
        {children}
      </p>
      {accion}
    </div>
  );
}

export function EnlaceBoton({
  href,
  children,
  variante = 'suave',
}: {
  href: Route;
  children: React.ReactNode;
  variante?: 'primario' | 'suave';
}) {
  return (
    <Link href={href} className={variante === 'primario' ? 'boton boton-primario' : 'boton boton-suave'}>
      {children}
    </Link>
  );
}

/** Dinero con el formato de Uruguay y el símbolo de la moneda del proyecto. */
export function Dinero({ valor, moneda = 'USD' }: { valor: number | null; moneda?: string }) {
  if (valor === null) return <span className="text-[var(--color-apagado)]">Sin dato</span>;
  return (
    <span className="tabular-nums">
      {new Intl.NumberFormat('es-UY', {
        style: 'currency',
        currency: moneda,
        maximumFractionDigits: 2,
      }).format(valor)}
    </span>
  );
}

const FORMATO_FECHA = new Intl.DateTimeFormat('es-UY', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Montevideo',
});

/**
 * Fecha y hora en horario de Uruguay. La zona va explícita porque se formatea en el
 * servidor, que corre en UTC: sin ella un plazo se mostraría tres horas corrido.
 */
export function Fecha({ valor }: { valor: string | null }) {
  const fecha = valor === null ? null : new Date(valor);
  if (fecha === null || Number.isNaN(fecha.getTime())) {
    return <span className="text-[var(--color-apagado)]">Sin dato</span>;
  }
  return (
    <time dateTime={fecha.toISOString()} className="tabular-nums">
      {FORMATO_FECHA.format(fecha)}
    </time>
  );
}

/** Barra de avance. `aria-valuenow` es lo que la hace legible para un lector de pantalla. */
export function Avance({ porcentaje, etiqueta }: { porcentaje: number; etiqueta: string }) {
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-[var(--color-lienzo-alto)]"
      role="progressbar"
      aria-valuenow={porcentaje}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={etiqueta}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{
          width: `${porcentaje}%`,
          background:
            porcentaje === 100 ? 'var(--color-aprobada)' : 'var(--color-acento)',
        }}
      />
    </div>
  );
}

/**
 * Mensaje de error o de confirmación. El texto ya viene de `mensajeParaUsuario()`: nunca es
 * el error crudo del servidor.
 */
export function Aviso({ tipo, children }: { tipo: 'error' | 'ok' | 'info'; children: React.ReactNode }) {
  const color =
    tipo === 'error' ? 'var(--color-fallida)' : tipo === 'ok' ? 'var(--color-aprobada)' : 'var(--color-revision)';
  return (
    <p
      role={tipo === 'error' ? 'alert' : 'status'}
      className="aparece rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed"
      style={{
        borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
        color,
      }}
    >
      {children}
    </p>
  );
}
