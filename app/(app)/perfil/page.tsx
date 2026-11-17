import { NOMBRE_ROL } from '@/lib/auth';
import { requireUser } from '@/lib/auth/session';
import { leerMiPerfil } from '@/lib/consultas';
import { Dato, Panel, Titulo } from '@/components/ui/primitivas';
import { FormularioPerfil } from './formulario';

export const metadata = { title: 'Mi perfil' };

export default async function MiPerfil() {
  const user = await requireUser();
  const perfil = await leerMiPerfil(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="entra space-y-1.5">
        <h1 className="text-2xl font-semibold">Mi perfil</h1>
        <p className="text-sm text-[var(--color-apagado)]">
          Lo que ven las demás personas cuando trabajan con vos.
        </p>
      </header>

      <Panel>
        <dl className="grid grid-cols-2 gap-6">
          <Dato etiqueta="Correo" valor={<span className="text-base break-all">{user.email ?? 'Sin correo'}</span>} />
          <Dato etiqueta="Tipo de cuenta" valor={<span className="text-base">{NOMBRE_ROL[user.role]}</span>} />
        </dl>
      </Panel>

      <Panel retraso={60}>
        <Titulo ayuda="El correo y el tipo de cuenta no se cambian desde acá.">Datos básicos</Titulo>
        <div className="mt-5">
          <FormularioPerfil inicial={perfil} />
        </div>
      </Panel>
    </div>
  );
}
