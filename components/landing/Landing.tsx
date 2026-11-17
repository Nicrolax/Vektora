import Link from 'next/link';
import type { Route } from 'next';
import { Fondo, Logotipo } from '@/components/ui/marca';
import { Ciclo, GrafoVivo, Manifiesto, Movimiento, Revelar } from './vivo';

/**
 * Presentación pública (`/` sin sesión).
 *
 * Todo lo que se cuenta acá sale del repositorio: los números son mediciones o hechos del
 * proyecto (CLAUDE.md), no cifras de marketing. Lo que es de ejemplo, lo dice.
 */

const alta = (rol: 'client' | 'provider' | 'both') => `/entrar?alta=${rol}` as Route;
const REPO = 'https://github.com/Nicrolax/_JBDPA_Grupo_1';

export function Landing() {
  return (
    <Movimiento>
      <Fondo intensidad="suave" />

      <header className="sticky top-0 z-20 border-b border-[var(--color-borde)]/60 bg-[var(--color-lienzo)]/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="VEKTORA, inicio">
            <Logotipo />
          </Link>
          <nav aria-label="Secciones" className="flex items-center gap-1 sm:gap-2">
            <a
              href="#ciclo"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-[var(--color-tenue)] transition-colors hover:text-[var(--color-texto)] sm:inline-block"
            >
              Cómo funciona
            </a>
            <a
              href="#garantias"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-[var(--color-tenue)] transition-colors hover:text-[var(--color-texto)] sm:inline-block"
            >
              Garantías
            </a>
            <Link href="/entrar" className="boton boton-suave ml-2 !py-2">
              Entrar
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ---- Hero: el mensaje a la izquierda, el producto andando debajo ---- */}
        <section className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl flex-col justify-center gap-12 px-4 py-14 sm:px-6 lg:py-20">
          <div className="entra max-w-3xl space-y-6">
            <h1 className="text-4xl leading-[1.05] font-semibold text-balance sm:text-5xl lg:text-6xl">
              Decís el resultado.
              <br />
              <span className="texto-marca">El resto se coordina solo.</span>
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-[var(--color-tenue)] sm:text-lg">
              VEKTORA lo divide en tareas, elige quién las hace, revisa cada entrega y avanza sin esperar
              aprobaciones.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href={alta('both')} className="boton boton-primario degradado-marca">
                Crear cuenta
              </Link>
              <a href="#ciclo" className="boton boton-suave">
                Ver el ciclo
              </a>
            </div>
          </div>
          <div className="entra" style={{ animationDelay: '140ms' }}>
            <GrafoVivo />
          </div>
        </section>

        {/* ---- El ciclo, fijado al scroll ---- */}
        <section id="ciclo" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-12 sm:px-6 lg:py-0">
          <Ciclo
            encabezado={
              <div className="space-y-3">
                <p className="text-xs font-medium tracking-[0.16em] text-[var(--color-acento-claro)] uppercase">
                  Cómo funciona
                </p>
                <h2 className="text-3xl font-semibold text-balance sm:text-4xl">
                  Cuatro pasos que se repiten hasta terminar el proyecto.
                </h2>
              </div>
            }
          />
        </section>

        {/* ---- Manifiesto ---- */}
        <section className="mx-auto max-w-5xl px-4 py-20 text-center sm:px-6 lg:py-24">
          <Manifiesto texto="Ninguna persona decide nada en el ciclo. Y ningún estado queda esperando a alguien que no existe." />
        </section>

        {/* ---- Garantías: bento de cinco celdas ---- */}
        <section id="garantias" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-12 sm:px-6">
          <Revelar>
            <h2 className="max-w-2xl text-3xl font-semibold text-balance sm:text-4xl">
              Autónomo no quiere decir sin control.
            </h2>
          </Revelar>

          <div className="mt-10 grid gap-4 md:grid-cols-6">
            <Revelar className="md:col-span-4 md:row-span-2">
              <article
                className="tarjeta flex h-full flex-col justify-between gap-10 overflow-hidden p-7 sm:p-9"
                style={{
                  background:
                    'radial-gradient(120% 90% at 100% 0%, color-mix(in oklch, var(--color-acento) 22%, transparent), transparent 60%), var(--color-panel)',
                }}
              >
                <div className="space-y-3">
                  <p className="text-7xl font-semibold tracking-tight tabular-nums sm:text-8xl">10</p>
                  <h3 className="text-xl font-semibold">puntos muertos encontrados y cerrados</h3>
                  <p className="max-w-md text-sm leading-relaxed text-[var(--color-tenue)]">
                    Estados de los que el sistema no salía solo. Ninguno lanzaba un error: por eso se buscan a
                    propósito antes de dar un cambio por bueno.
                  </p>
                </div>
                <ul className="grid gap-3 text-sm text-[var(--color-tenue)] sm:grid-cols-3">
                  <li className="rounded-xl bg-[var(--color-lienzo)]/60 px-4 py-3">
                    Un criterio que pedía la firma del cliente
                  </li>
                  <li className="rounded-xl bg-[var(--color-lienzo)]/60 px-4 py-3">
                    Una tarea esperando para siempre un candidato mejor
                  </li>
                  <li className="rounded-xl bg-[var(--color-lienzo)]/60 px-4 py-3">
                    Una tarea adjudicada que nadie entregaba
                  </li>
                </ul>
              </article>
            </Revelar>

            <Revelar className="md:col-span-2" retraso={0.05}>
              <article className="tarjeta h-full space-y-3 p-6">
                <h3 className="font-semibold">Cada decisión queda explicada</h3>
                <p className="text-sm leading-relaxed text-[var(--color-tenue)]">
                  Por qué se adjudicó, qué criterio falló, qué corrigió el planificador. Todo queda guardado
                  en la base.
                </p>
                <p className="font-mono text-xs leading-relaxed text-[var(--color-apagado)]">
                  match_explanation
                  <br />
                  qa_criteria_results
                  <br />
                  ai_runs
                </p>
              </article>
            </Revelar>

            <Revelar className="md:col-span-2" retraso={0.1}>
              <article
                className="tarjeta h-full space-y-3 p-6"
                style={{
                  background:
                    'linear-gradient(160deg, color-mix(in oklch, var(--color-revision) 16%, transparent), transparent 70%), var(--color-panel)',
                }}
              >
                <h3 className="font-semibold">Una avería nuestra nunca es un veredicto</h3>
                <p className="text-sm leading-relaxed text-[var(--color-tenue)]">
                  Si la IA falla, la entrega espera y se reintenta. No descuenta reputación ni cuenta como
                  intento.
                </p>
              </article>
            </Revelar>

            <Revelar className="md:col-span-3" retraso={0.05}>
              <article className="tarjeta flex h-full flex-col gap-3 p-6 sm:flex-row sm:items-end sm:gap-6">
                <p className="text-5xl font-semibold tracking-tight whitespace-nowrap tabular-nums">
                  0 de 435
                </p>
                <div className="space-y-1">
                  <h3 className="font-semibold">Umbrales medidos, no puestos a ojo</h3>
                  <p className="text-sm leading-relaxed text-[var(--color-tenue)]">
                    Pares de habilidades distintas que se fusionan con el umbral de 0.95.
                  </p>
                </div>
              </article>
            </Revelar>

            <Revelar className="md:col-span-3" retraso={0.1}>
              <article
                className="tarjeta h-full space-y-3 p-6"
                style={{
                  background:
                    'linear-gradient(200deg, color-mix(in oklch, var(--color-aprobada) 13%, transparent), transparent 65%), var(--color-panel)',
                }}
              >
                <h3 className="font-semibold">Gratis de punta a punta, sin tarjeta</h3>
                <p className="text-sm leading-relaxed text-[var(--color-tenue)]">
                  Next.js, PostgreSQL con pgvector, Groq y Gemini con relevo automático, desplegado en Render,
                  Aiven y minikube.
                </p>
              </article>
            </Revelar>
          </div>
        </section>

        {/* ---- Cierre: los dos roles reales del alta ---- */}
        <section className="mx-auto max-w-6xl px-4 pt-12 pb-20 sm:px-6">
          <Revelar>
            <h2 className="max-w-2xl text-3xl font-semibold text-balance sm:text-4xl">
              Hay dos maneras de usarlo.
            </h2>
          </Revelar>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Camino
              href={alta('client')}
              titulo="Tenés un objetivo"
              texto="Lo escribís en una frase con un presupuesto. Recibís el grafo de tareas y lo ves avanzar sin coordinar a nadie."
              accion="Publicar un proyecto"
              tinte="var(--color-acento)"
            />
            <Camino
              href={alta('provider')}
              titulo="Sabés hacer algo"
              texto="Contás tu perfil con tus palabras. Las tareas que encajan te llegan solas y cada entrega aprobada suma reputación."
              accion="Ofrecer mi trabajo"
              tinte="var(--color-aprobada)"
              retraso={0.06}
            />
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--color-borde)]/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-[var(--color-apagado)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logotipo tamano={18} />
          <p>Programación Avanzada, UTU. URUCON Juniors 2026.</p>
          <a
            href={REPO}
            className="transition-colors hover:text-[var(--color-texto)]"
            rel="noopener noreferrer"
          >
            Código en GitHub
          </a>
        </div>
      </footer>
    </Movimiento>
  );
}

function Camino({
  href,
  titulo,
  texto,
  accion,
  tinte,
  retraso = 0,
}: {
  href: Route;
  titulo: string;
  texto: string;
  accion: string;
  tinte: string;
  retraso?: number;
}) {
  return (
    <Revelar retraso={retraso}>
      <Link
        href={href}
        className="tarjeta tarjeta-viva group flex h-full flex-col justify-between gap-12 p-7 sm:p-9"
        style={{
          background: `radial-gradient(110% 120% at 0% 100%, color-mix(in oklch, ${tinte} 18%, transparent), transparent 60%), var(--color-panel)`,
        }}
      >
        <div className="space-y-3">
          <h3 className="text-2xl font-semibold">{titulo}</h3>
          <p className="max-w-md text-[0.95rem] leading-relaxed text-[var(--color-tenue)]">{texto}</p>
        </div>
        <span className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: tinte }}>
          {accion}
          <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">
            →
          </span>
        </span>
      </Link>
    </Revelar>
  );
}
