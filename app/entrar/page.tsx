import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { Fondo, Logotipo } from '@/components/ui/marca';
import { FormularioAcceso, type Rol } from './formulario';

export const metadata = { title: 'Entrar' };

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; aviso?: string; alta?: string }>;
}) {
  if ((await getSessionUser()) !== null) redirect('/panel');
  const params = await searchParams;
  const alta: Rol | null =
    params.alta === 'client' || params.alta === 'provider' || params.alta === 'both' ? params.alta : null;

  return (
    <>
      <Fondo intensidad="fuerte" />

      <main className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-5 py-14 lg:grid-cols-[1.05fr_26rem] lg:gap-20 lg:py-20">
        {/* ---- Presentación ---- */}
        <section className="entra space-y-9">
          <Link
            href="/"
            className="flex w-fit items-center gap-2 text-sm text-[var(--color-apagado)] transition-colors hover:text-[var(--color-texto)]"
          >
            <span aria-hidden>←</span> Volver al inicio
          </Link>
          <div><Logotipo tamano={24} /></div>

          <div className="space-y-5">
            <h1 className="text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl lg:text-6xl">
              Proyectos que
              <br />
              <span className="texto-marca">se coordinan solos</span>
            </h1>
            <p className="max-w-md text-[0.95rem] leading-relaxed text-[var(--color-tenue)] text-pretty">
              Decís qué necesitás conseguir. El sistema lo descompone, busca quién lo haga,
              revisa lo entregado y sigue adelante. Sin reuniones, sin aprobaciones, sin
              esperar a nadie.
            </p>
          </div>
        </section>

        {/* ---- Acceso ---- */}
        <section
          className="entra tarjeta w-full p-6 sm:p-7"
          style={{ animationDelay: '160ms', backdropFilter: 'blur(12px)' }}
        >
          {params.error !== undefined && (
            <p
              role="alert"
              className="aparece mb-5 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed"
              style={{
                borderColor: 'color-mix(in oklch, var(--color-fallida) 40%, transparent)',
                backgroundColor: 'color-mix(in oklch, var(--color-fallida) 12%, transparent)',
                color: 'var(--color-fallida)',
              }}
            >
              {params.error}
            </p>
          )}
          {params.aviso !== undefined && (
            <p
              role="status"
              className="aparece mb-5 rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed"
              style={{
                borderColor: 'color-mix(in oklch, var(--color-aprobada) 40%, transparent)',
                backgroundColor: 'color-mix(in oklch, var(--color-aprobada) 12%, transparent)',
                color: 'var(--color-aprobada)',
              }}
            >
              {params.aviso}
            </p>
          )}

          <FormularioAcceso alta={alta} />
        </section>
      </main>
    </>
  );
}
