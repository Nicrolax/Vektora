import Link from 'next/link';
import { requirePermiso } from '@/lib/auth/session';
import { perfilProveedor } from '@/lib/consultas';
import { Panel } from '@/components/ui/primitivas';
import { FormularioProveedor } from './formulario';

export const metadata = { title: 'Mi perfil de proveedor' };

/** La vectorización del perfil llama al modelo de embeddings; 10 s se quedan cortos. */
export const maxDuration = 60;

export default async function AltaProveedor() {
  const user = await requirePermiso('proveedor:perfil');
  const perfil = await perfilProveedor(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-2">
        <Link
          href="/proveedor"
          className="text-xs text-[var(--color-apagado)] transition-colors hover:text-[var(--color-tenue)]"
        >
          ← Mi trabajo
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {perfil === null ? 'Ofrecerme como proveedor' : 'Mi perfil de proveedor'}
        </h1>
        <p className="text-sm leading-relaxed text-[var(--color-apagado)]">
          El sistema compara tu perfil con cada tarea para decidir a quién adjudicarla. No hay
          postulaciones: si encajás, te llega.
        </p>
      </header>

      <Panel className="p-5">
        <FormularioProveedor
          inicial={
            perfil === null
              ? null
              : {
                  headline: perfil.headline ?? '',
                  summary: perfil.summary ?? '',
                  hourlyRateUsd: perfil.hourlyRateUsd,
                  minTaskBudgetUsd: perfil.minTaskBudgetUsd,
                  availabilityHoursWeek: perfil.availabilityHoursWeek,
                  acceptsAutoAssign: perfil.acceptsAutoAssign,
                  skills: perfil.skills,
                }
          }
        />
      </Panel>
    </div>
  );
}
