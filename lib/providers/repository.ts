/**
 * VEKTORA · FASE 3.5 — Acceso a datos del onboarding de proveedores.
 *
 * Mismo patrón que `lib/planner/repository.ts`: el dominio habla con esta interfaz y nunca
 * con la base directamente, así la lógica (resolución de skills, orquestación del alta) se
 * prueba sin base de datos y la persistencia queda en un único sitio auditable.
 */

import { json, type Consultor } from '@/lib/db';
import type { ActorType } from '@/lib/db/types';
import { DatabaseError } from '@/lib/errores';

export interface UserRecord {
  id: string;
  email: string | null;
  status: string;
}

/** Fila de `public.skills` tal como la necesita el resolutor. */
export interface SkillRecord {
  id: string;
  slug: string;
  name: string;
  category: string | null;
}

export interface SkillAliasRecord {
  alias: string;
  skillId: string;
  similarity: number | null;
  source: ActorType;
}

/** Cómo se resolvió un slug propuesto contra el catálogo. */
export type SkillMatchKind = 'exact' | 'alias' | 'semantic' | 'created';

export interface ResolvedSkill {
  /** Lo que escribió el proveedor, ya normalizado. */
  proposed: string;
  skillId: string;
  slug: string;
  name: string;
  category: string | null;
  match: SkillMatchKind;
  /** Similitud coseno que justificó un mapeo `semantic`. */
  similarity: number | null;
}

export interface ProviderProfilePayload {
  headline?: string | undefined;
  summary?: string | undefined;
  seniority?: string | undefined;
  hourly_rate_usd?: number | undefined;
  min_task_budget_usd?: number | undefined;
  availability_hours_week?: number | undefined;
  languages?: string[] | undefined;
  timezone?: string | undefined;
  is_active?: boolean | undefined;
  accepts_auto_assign?: boolean | undefined;
}

export interface ProviderSkillLink {
  skill_id: string;
  level: number;
  years_experience?: number | undefined;
}

export interface PersonProfilePayload {
  full_name?: string | undefined;
  display_name?: string | undefined;
  country_code?: string | undefined;
  timezone?: string | undefined;
  locale?: string | undefined;
  bio?: string | undefined;
  website_url?: string | undefined;
}

export interface ProviderRepository {
  findUserById(userId: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  /** Coincidencias exactas de slug. Paso 1 de la cascada: gratis. */
  findSkillsBySlugs(slugs: readonly string[]): Promise<SkillRecord[]>;
  /** Alias ya registrados. Paso 2: también gratis, y evita gastar un embedding. */
  findSkillsByAliases(aliases: readonly string[]): Promise<Map<string, SkillRecord>>;
  /** Paso 3 y 4: vecino semántico o creación. `vector` null salta el paso semántico. */
  resolveOrCreateSkill(params: {
    slug: string;
    name?: string | undefined;
    vector?: string | undefined;
    threshold: number;
  }): Promise<Omit<ResolvedSkill, 'proposed'>>;
  upsertPersonProfile(userId: string, payload: PersonProfilePayload): Promise<void>;
  upsertProviderProfile(userId: string, payload: ProviderProfilePayload): Promise<string>;
  setProviderSkills(providerProfileId: string, links: readonly ProviderSkillLink[]): Promise<number>;
  saveProviderEmbedding(providerProfileId: string, vector: string, model: string): Promise<boolean>;
}

/**
 * Fallo de persistencia del alta de proveedores. Hereda de `DatabaseError`: conserva el
 * SQLSTATE y nunca muestra el texto de la base a la persona.
 */
export class ProviderRepositoryError extends DatabaseError {
  override readonly codigo: string = 'proveedor_repositorio';
}

function fail(action: string, error: unknown): never {
  if (error instanceof DatabaseError) {
    throw new ProviderRepositoryError(
      `VEKTORA/PROVIDER: ${action} falló -> ${error.message}`,
      error.sqlstate,
      error.details,
      { cause: error },
    );
  }
  throw error;
}

/**
 * Columnas de `profiles` que se pueden escribir. Es una lista blanca: el nombre de columna
 * sí va en el texto del SQL, así que NUNCA puede venir de un dato externo.
 */
const COLUMNAS_PERFIL = [
  'full_name',
  'display_name',
  'country_code',
  'timezone',
  'locale',
  'bio',
  'website_url',
] as const satisfies readonly (keyof PersonProfilePayload)[];

/** Implementación sobre PostgreSQL. Todas las consultas son parametrizadas (R9). */
export class PostgresProviderRepository implements ProviderRepository {
  constructor(private readonly db: Consultor) {}

  async findUserById(userId: string): Promise<UserRecord | null> {
    try {
      return await this.db.one<UserRecord>(
        'select id, email::text as email, status from public.users where id = $1',
        [userId],
      );
    } catch (error) {
      fail('buscar el usuario', error);
    }
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    // `users.email` es citext: la comparación ya es insensible a mayúsculas en la base.
    try {
      return await this.db.one<UserRecord>(
        'select id, email::text as email, status from public.users where email = $1',
        [email],
      );
    } catch (error) {
      fail('buscar el usuario por correo', error);
    }
  }

  async findSkillsBySlugs(slugs: readonly string[]): Promise<SkillRecord[]> {
    if (slugs.length === 0) return [];
    try {
      return await this.db.query<SkillRecord>(
        'select id, slug, name, category from public.skills where slug = any($1::text[])',
        [slugs],
      );
    } catch (error) {
      fail('leer el catálogo de skills', error);
    }
  }

  async findSkillsByAliases(aliases: readonly string[]): Promise<Map<string, SkillRecord>> {
    const out = new Map<string, SkillRecord>();
    if (aliases.length === 0) return out;

    let filas: Array<SkillRecord & { alias: string }>;
    try {
      filas = await this.db.query<SkillRecord & { alias: string }>(
        `select a.alias, s.id, s.slug, s.name, s.category
           from public.skill_aliases a
           join public.skills s on s.id = a.skill_id
          where a.alias = any($1::text[])`,
        [aliases],
      );
    } catch (error) {
      fail('leer los alias de skills', error);
    }
    for (const fila of filas) {
      out.set(fila.alias.toLowerCase(), {
        id: fila.id,
        slug: fila.slug,
        name: fila.name,
        category: fila.category,
      });
    }
    return out;
  }

  async resolveOrCreateSkill(params: {
    slug: string;
    name?: string | undefined;
    vector?: string | undefined;
    threshold: number;
  }): Promise<Omit<ResolvedSkill, 'proposed'>> {
    let payload: {
      skill_id?: string;
      slug?: string;
      name?: string;
      category?: string | null;
      match?: SkillMatchKind;
      similarity?: number | string | null;
    } = {};
    try {
      const fila = await this.db.one<{ r: typeof payload | null }>(
        `select public.resolve_or_create_skill(
                  p_slug => $1, p_name => $2, p_embedding => $3, p_threshold => $4::numeric) as r`,
        [params.slug, params.name ?? null, params.vector ?? null, params.threshold],
      );
      payload = fila?.r ?? {};
    } catch (error) {
      fail(`resolver la skill "${params.slug}"`, error);
    }
    if (typeof payload.skill_id !== 'string') {
      throw new ProviderRepositoryError(
        `VEKTORA/PROVIDER: resolve_or_create_skill no devolvió skill_id para "${params.slug}"`,
      );
    }
    const similarity =
      payload.similarity === null || payload.similarity === undefined
        ? null
        : Number(payload.similarity);

    return {
      skillId: payload.skill_id,
      slug: payload.slug ?? params.slug,
      name: payload.name ?? params.slug,
      category: payload.category ?? null,
      match: payload.match ?? 'created',
      similarity: similarity !== null && Number.isFinite(similarity) ? similarity : null,
    };
  }

  async upsertPersonProfile(userId: string, payload: PersonProfilePayload): Promise<void> {
    const columnas: string[] = [];
    const valores: (string | null)[] = [userId];
    for (const columna of COLUMNAS_PERFIL) {
      const valor = payload[columna];
      if (valor === undefined) continue;
      columnas.push(columna);
      valores.push(valor);
    }
    // Sin columnas no hay nada que actualizar: el trigger de `auth.users` ya creó la fila.
    if (columnas.length === 0) return;

    const marcadores = columnas.map((_, indice) => `$${indice + 2}`).join(', ');
    const asignaciones = columnas.map((columna) => `${columna} = excluded.${columna}`).join(', ');
    try {
      await this.db.execute(
        `insert into public.profiles (user_id, ${columnas.join(', ')})
         values ($1, ${marcadores})
         on conflict (user_id) do update set ${asignaciones}`,
        valores,
      );
    } catch (error) {
      fail('guardar el perfil personal', error);
    }
  }

  async upsertProviderProfile(userId: string, payload: ProviderProfilePayload): Promise<string> {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) clean[key] = value;
    }
    let id: unknown;
    try {
      const fila = await this.db.one<{ r: unknown }>(
        'select public.upsert_provider_profile(p_user_id => $1::uuid, p_payload => $2::jsonb) as r',
        [userId, json(clean)],
      );
      id = fila?.r;
    } catch (error) {
      fail('guardar el perfil de proveedor', error);
    }
    if (typeof id !== 'string') {
      throw new ProviderRepositoryError(
        'VEKTORA/PROVIDER: upsert_provider_profile no devolvió el id del perfil',
      );
    }
    return id;
  }

  async setProviderSkills(
    providerProfileId: string,
    links: readonly ProviderSkillLink[],
  ): Promise<number> {
    try {
      const fila = await this.db.one<{ r: number | null }>(
        `select public.set_provider_skills(
                  p_provider_profile_id => $1::uuid, p_skills => $2::jsonb) as r`,
        [
          providerProfileId,
          json(
            links.map((link) => ({
              skill_id: link.skill_id,
              level: link.level,
              years_experience: link.years_experience ?? null,
            })),
          ),
        ],
      );
      return typeof fila?.r === 'number' ? fila.r : links.length;
    } catch (error) {
      fail('vincular las skills del proveedor', error);
    }
  }

  async saveProviderEmbedding(
    providerProfileId: string,
    vector: string,
    model: string,
  ): Promise<boolean> {
    try {
      await this.db.execute(
        `update public.provider_profiles
            set embedding = $2::extensions.vector, embedding_model = $3,
                embedding_updated_at = now()
          where id = $1`,
        [providerProfileId, vector, model],
      );
      return true;
    } catch (error) {
      // Un embedding que no se guarda degrada el matching de la FASE 4, pero no invalida el
      // alta: el proveedor existe y el ranking determinista sigue funcionando.
      const motivo = error instanceof Error ? error.message : String(error);
      console.warn(`[vektora/provider] embedding del perfil: ${motivo}`);
      return false;
    }
  }
}
