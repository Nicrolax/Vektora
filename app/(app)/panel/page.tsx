import Link from 'next/link';
import { tienePermiso } from '@/lib/auth';
import { requireUser } from '@/lib/auth/session';
import { listarMisProyectos, type ProyectoResumen } from '@/lib/consultas';
import { mensajeParaUsuario } from '@/lib/errores';
import { Aviso, Avance, Dinero, EnlaceBoton, Vacio } from '@/components/ui/primitivas';
import { presentarProyecto } from '@/components/estados';

export const metadata = { title: 'Mis proyectos' };

export default async function PanelCliente({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string }>;
}) {
  const user = await requireUser();
  const { aviso } = await searchParams;

  // Una cuenta solo de proveedor no publica proyectos: se la orienta en vez de mostrarle un
  // botón que fallaría.
  if (!tienePermiso(user.role, 'proyectos:crear')) {
    return (
      <div className="mx-auto max-w-xl space-y-5 py-10 text-center">
        {aviso !== undefined && <Aviso tipo="info">{aviso}</Aviso>}
        <h1 className="text-xl font-semibold tracking-tight">Tu cuenta es de proveedor</h1>
        <p className="text-sm leading-relaxed text-[var(--color-apagado)]">
          Las tareas te llegan solas cuando encajás. Revisá lo que tenés asignado o buscá tareas
          abiertas.
        </p>
        <div className="flex justify-center gap-3">
          <EnlaceBoton href="/proveedor" variante="primario">
            Mi trabajo
          </EnlaceBoton>
          <EnlaceBoton href="/buscar">Buscar tareas</EnlaceBoton>
        </div>
      </div>
    );
  }

  // Se lee como la persona: si un proyecto no aparece es porque RLS no deja verlo, no
  // porque el código se haya acordado de filtrar por dueño.
  let proyectos: ProyectoResumen[] = [];
  let error: string | null = null;
  try {
    proyectos = await listarMisProyectos(user.id);
  } catch (causa) {
    error = mensajeParaUsuario(causa);
  }

  return (
    <div className="space-y-7">
      <div className="entra flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold">Mis proyectos</h1>
          <p className="text-sm text-[var(--color-apagado)]">
            Decís qué querés conseguir. El resto ocurre solo.
          </p>
        </div>
        <EnlaceBoton href="/proyectos/nuevo" variante="primario">
          Nuevo proyecto
        </EnlaceBoton>
      </div>

      {aviso !== undefined && <Aviso tipo="info">{aviso}</Aviso>}
      {error !== null && <Aviso tipo="error">{error}</Aviso>}

      {proyectos.length === 0 && error === null && (
        <div className="entra" style={{ animationDelay: '80ms' }}>
          <Vacio
            accion={
              <EnlaceBoton href="/proyectos/nuevo" variante="primario">
                Crear el primero
              </EnlaceBoton>
            }
          >
            Todavía no tenés ningún proyecto. Escribí en una frase qué necesitás y mirá cómo se
            arma el grafo de tareas.
          </Vacio>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {proyectos.map((proyecto, indice) => {
          const avance =
            proyecto.totalTareas === 0 ? 0 : Math.round((proyecto.aprobadas / proyecto.totalTareas) * 100);

          return (
            <Link
              key={proyecto.id}
              href={`/proyectos/${proyecto.id}`}
              className="tarjeta tarjeta-viva entra block p-5"
              style={{ animationDelay: `${60 + indice * 55}ms` }}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[0.95rem] leading-snug font-medium text-balance">{proyecto.title}</h2>
                <span className="shrink-0 rounded-full bg-[var(--color-lienzo-alto)] px-2.5 py-1 text-[0.7rem] text-[var(--color-apagado)]">
                  {presentarProyecto(proyecto.status)}
                </span>
              </div>

              <p className="mt-2.5 line-clamp-2 text-[0.8rem] leading-relaxed text-[var(--color-apagado)]">
                {proyecto.objective}
              </p>

              <div className="mt-5 space-y-2.5">
                <Avance porcentaje={avance} etiqueta="Tareas aprobadas" />
                <div className="flex items-center justify-between text-xs text-[var(--color-apagado)]">
                  <span>
                    {proyecto.totalTareas === 0
                      ? 'sin tareas todavía'
                      : `${proyecto.aprobadas} de ${proyecto.totalTareas} aprobadas`}
                    {proyecto.visibility === 'public' && ' · público'}
                  </span>
                  <Dinero valor={proyecto.budgetTotal} moneda={proyecto.currency} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
