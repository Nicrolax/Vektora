import { AdminService, type SkillAdmin } from '@/lib/admin';
import { requirePermiso } from '@/lib/auth/session';
import { mensajeParaUsuario } from '@/lib/errores';
import { Aviso, Panel, Titulo } from '@/components/ui/primitivas';
import { PestanasAdmin } from '../pestanas';
import { FilaSkill, FormularioNuevaSkill } from './formularios';

export const metadata = { title: 'Catálogo de skills' };

/** CRUD del catálogo de skills (R2). La base lo refuerza con la política `skills_write_admin`. */
export default async function Skills() {
  const admin = await requirePermiso('admin:skills');

  let skills: SkillAdmin[] = [];
  let error: string | null = null;
  try {
    skills = await new AdminService().listarSkills(admin.id);
  } catch (causa) {
    error = mensajeParaUsuario(causa);
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold">Administración</h1>
        <PestanasAdmin activa="skills" />
      </header>

      {error !== null && <Aviso tipo="error">{error}</Aviso>}

      <Panel className="space-y-4 p-4">
        <Titulo ayuda="El planificador elige skills de este catálogo al armar las tareas, y el emparejador las compara con las de cada proveedor.">
          Nueva skill
        </Titulo>
        <FormularioNuevaSkill />
      </Panel>

      <Panel className="overflow-x-auto p-4">
        <p className="mb-3 text-xs text-[var(--color-apagado)]">{skills.length} skills en el catálogo.</p>
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-borde)] text-left text-[var(--color-apagado)]">
              <th className="px-2 py-2 font-medium">Identificador</th>
              <th className="px-2 py-2 font-medium">Nombre y categoría</th>
              <th className="px-2 py-2 text-right font-medium">Proveedores</th>
              <th className="px-2 py-2 text-right font-medium">Tareas</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <FilaSkill key={skill.id} skill={skill} />
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
