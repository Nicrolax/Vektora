-- =====================================================================================
-- VEKTORA · sql/02-datos-prueba.sql
-- =====================================================================================
-- ARCHIVO GENERADO por `npm run sql:build` a partir de db/. NO EDITAR A MANO:
-- cambiá el archivo de db/ correspondiente y volvé a generar.
--
-- Carga el catálogo de 30 skills y los datos de la demo (6 cuentas, 2 proyectos,
-- 8 tareas, candidaturas, una entrega aprobada y reputación). Más de 20 registros.
--
-- Idempotente: se puede ejecutar más de una vez sobre la misma base.
-- Fuentes, en orden:
--   · db/seeds/01_skills.sql
--   · db/seeds/02_datos_demo.sql
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/seeds/01_skills.sql
set search_path = public, extensions;

-- =====================================================================================
-- VEKTORA — Catálogo semilla de skills (30)
-- =====================================================================================
-- Aplicar DESPUÉS de db/schema.sql y db/migrations/0002_planner.sql.
--
-- El ProjectPlanner recibe este catálogo en el prompt para no inventar slugs. Sin semilla,
-- cada ejecución produciría planes con vocabulario distinto y el matching de la FASE 4 no
-- podría comparar nada: `project_tasks.required_skills` y `provider_skills` tienen que
-- hablar el mismo idioma.
--
-- El catálogo crece solo desde aquí: `register_skills` (FASE 3) da de alta en categoría
-- `auto` lo que el planificador necesite y no exista. Esas NO se versionan en este archivo.
--
-- PROCEDENCIA: extraído de la base desplegada el 2026-09-14 con db/dump-skills.sql.
--
-- No se toca `description`: en la base está vacía y el planificador solo usa `slug` y
-- `category` (ver `renderSkillCatalog` en lib/planner/prompts.ts). Incluirla aquí
-- sobrescribiría datos que alguien podría rellenar más adelante.
-- =====================================================================================

insert into public.skills (slug, name, category) values
  -- --- ai ---------------------------------------------------------------------------
  ('llm-integration',     'Integración de LLMs',      'ai'),
  ('machine-learning',    'Machine Learning',         'ai'),
  ('prompt-engineering',  'Prompt Engineering',       'ai'),
  -- --- business ---------------------------------------------------------------------
  ('financial-modeling',  'Modelado Financiero',      'business'),
  ('legal-review',        'Revisión Legal',           'business'),
  -- --- content ----------------------------------------------------------------------
  ('copywriting',         'Copywriting',              'content'),
  ('technical-writing',   'Redacción Técnica',        'content'),
  ('translation',         'Traducción',               'content'),
  -- --- data -------------------------------------------------------------------------
  ('data-analysis',       'Análisis de Datos',        'data'),
  ('data-engineering',    'Data Engineering',         'data'),
  ('pgvector',            'pgvector / Vector Search', 'data'),
  ('postgresql',          'PostgreSQL',               'data'),
  ('supabase',            'Supabase',                 'data'),
  -- --- design -----------------------------------------------------------------------
  ('graphic-design',      'Diseño Gráfico',           'design'),
  ('ui-design',           'Diseño de Interfaces',     'design'),
  ('ux-research',         'Investigación UX',         'design'),
  -- --- engineering ------------------------------------------------------------------
  ('electronics-design',  'Diseño Electrónico',       'engineering'),
  ('nextjs',              'Next.js',                  'engineering'),
  ('nodejs',              'Node.js',                  'engineering'),
  ('python',              'Python',                   'engineering'),
  ('react',               'React',                    'engineering'),
  ('tailwind-css',        'Tailwind CSS',             'engineering'),
  ('typescript',          'TypeScript',               'engineering'),
  -- --- marketing --------------------------------------------------------------------
  ('growth-marketing',    'Growth Marketing',         'marketing'),
  ('seo',                 'SEO',                      'marketing'),
  -- --- operations -------------------------------------------------------------------
  ('devops',              'DevOps',                   'operations'),
  ('project-management',  'Gestión de Proyectos',     'operations'),
  -- --- quality ----------------------------------------------------------------------
  ('qa-testing',          'QA y Testing',             'quality'),
  ('security-audit',      'Auditoría de Seguridad',   'quality'),
  -- --- research ---------------------------------------------------------------------
  ('market-research',     'Investigación de Mercado', 'research')
on conflict (slug) do update
  set name     = excluded.name,
      category = excluded.category;


-- =====================================================================================
-- FIN — db/seeds/01_skills.sql
-- Verificación: select category, count(*) from public.skills where is_active group by 1;
-- =====================================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> db/seeds/02_datos_demo.sql
set search_path = public, extensions;

-- =====================================================================================
-- VEKTORA — Datos de prueba para la demostración (requisito R11: ≥ 20 registros)
-- =====================================================================================
-- Aplicar DESPUÉS de db/seeds/01_skills.sql.
--
-- CONTRASEÑA PÚBLICA de todas las cuentas: Demo-Vektora-2026
-- Es pública A PROPÓSITO (está en el README y en la guía): sirve para que el docente y otro
-- grupo puedan entrar sin pedir nada. En la base solo está su hash BCrypt (coste 12), nunca
-- el texto. Fuera de la defensa, suspender estas cuentas desde Administración → Cuentas.
--
--   cliente@vektora.test          Carla Méndez     client    dueña del proyecto demo
--   ambos@vektora.test            Andrés Silva     both      publica y también trabaja
--   sofia.diseno@vektora.test     Sofía Rivas      provider  diseño de interfaz
--   lucia.frontend@vektora.test   Lucía Fernández  provider  frontend
--   diego.backend@vektora.test    Diego Pereira    provider  backend
--   martin.qa@vektora.test        Martín Suárez    provider  calidad y despliegue
--
-- La cuenta de ADMINISTRACIÓN no está acá (su contraseña no puede ser pública): se crea en
-- cada base con  ADMIN_EMAIL=… ADMIN_PASSWORD='…' npm run cuenta:admin
--
-- Proyecto demo «Sitio de reservas para un consultorio odontológico», en diamante:
--
--           ┌─> T-02 (asignada a Sofía) ─┐
--   T-01 ───┤                            ├─> T-04 ──> T-05
--  (aprobada)└─> T-03 (lista)  ──────────┘  (bloq.)  (bloq.)
--
-- T-02 queda ASIGNADA a Sofía: entrando como ella se demuestra la entrega transaccional.
--
-- IDEMPOTENTE: identificadores fijos y `on conflict do nothing`. Reaplicarlo no duplica
-- nada (importa sobre todo en `reputation_events`, que es append-only).
-- =====================================================================================

set search_path = public, extensions;

-- --- 1 · Cuentas (6) -----------------------------------------------------------------
-- El trigger `trg_auth_user_created` crea por cada una su fila en `public.users` (con el
-- rol de `raw_user_meta_data`) y en `public.profiles` (con el nombre).
insert into auth.users (id, email, password_hash, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000001', 'cliente@vektora.test',
   '$2b$12$K5pWMkN4pNhsDGendPxEYeeKImreAeySL2gl0a4uIBogrKS4KScbu',
   '{"role": "client", "full_name": "Carla Méndez"}'),
  ('00000000-0000-4000-8000-000000000002', 'ambos@vektora.test',
   '$2b$12$5SjaDFyAAMlz94g/Qv0mROX9wqSfujIUTEYvTVK.L2to1J20pNLTy',
   '{"role": "both", "full_name": "Andrés Silva"}'),
  ('00000000-0000-4000-8000-000000000011', 'sofia.diseno@vektora.test',
   '$2b$12$4VLNcoUrXYK89wx6FiY7XuGbcpDsrh4imvIEdKFsOBVnXgjpn4lKG',
   '{"role": "provider", "full_name": "Sofía Rivas"}'),
  ('00000000-0000-4000-8000-000000000012', 'lucia.frontend@vektora.test',
   '$2b$12$VFtEMvUzazyFllqp70ypqe73BYE/lHnDu9o35BcHoiCoNTQEtUOwK',
   '{"role": "provider", "full_name": "Lucía Fernández"}'),
  ('00000000-0000-4000-8000-000000000013', 'diego.backend@vektora.test',
   '$2b$12$WdY5Fm7iMMwnbF2MruqOquYjR4aZcAQ.6FAoYFraPnM6FE9ToZcH6',
   '{"role": "provider", "full_name": "Diego Pereira"}'),
  ('00000000-0000-4000-8000-000000000014', 'martin.qa@vektora.test',
   '$2b$12$.OfQA0KEe2HwAEiQrdxRie.nnvjyzMcKNFr/JZeNKp.3X1vp7bVye',
   '{"role": "provider", "full_name": "Martín Suárez"}')
on conflict (id) do nothing;

-- Datos de presentación que el trigger no conoce.
update public.profiles p
   set display_name = split_part(p.full_name, ' ', 1),
       country_code = 'UY',
       timezone     = 'America/Montevideo'
 where p.user_id in (
         '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
         '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000012',
         '00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000014')
   and p.display_name is null;

-- --- 2 · Perfiles de proveedor (5) ---------------------------------------------------
-- Sin embedding: el motor de matching los encuentra igual por la rama determinista
-- (habilidades + reputación). `npm run provider:seed` los vectoriza si hay clave de IA.
insert into public.provider_profiles
  (id, user_id, headline, summary, seniority, hourly_rate_usd, min_task_budget_usd,
   availability_hours_week, languages, timezone, accepts_auto_assign)
values
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000011',
   'Diseñadora de interfaces para servicios de salud',
   'Diseño interfaces web y móviles centradas en agendas, turnos y formularios accesibles. '
   'Trabajo en Figma con sistemas de diseño y entrego prototipos navegables y guías de estilo.',
   'senior', 28, 150, 30, '{es,en}', 'America/Montevideo', true),
  ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000012',
   'Desarrolladora frontend con React y Next.js',
   'Construyo interfaces con React, Next.js y Tailwind CSS. Integro APIs REST, cuido la '
   'accesibilidad y escribo pruebas de componentes. Experiencia en sitios de reservas.',
   'semi-senior', 24, 120, 25, '{es}', 'America/Montevideo', true),
  ('10000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000013',
   'Backend con Node.js, TypeScript y PostgreSQL',
   'Diseño APIs con Node.js y TypeScript sobre PostgreSQL: modelado de datos, transacciones, '
   'consultas parametrizadas y migraciones. Despliego con Docker en servicios gratuitos.',
   'senior', 30, 200, 20, '{es,en}', 'America/Montevideo', true),
  ('10000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000014',
   'QA y despliegue continuo',
   'Escribo planes de prueba y pruebas automatizadas, reviso seguridad básica y armo '
   'pipelines de integración continua con GitHub Actions y contenedores.',
   'semi-senior', 22, 100, 30, '{es}', 'America/Montevideo', true),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   'Analista funcional y redacción técnica',
   'Relevo requisitos con clientes, escribo historias de usuario y documentación técnica '
   'clara. También hago investigación de mercado para productos digitales.',
   'senior', 26, 100, 15, '{es,en}', 'America/Montevideo', true)
on conflict (user_id) do nothing;

-- --- 3 · Habilidades de cada proveedor (13) — relación N:M proveedor ↔ skill ----------
insert into public.provider_skills (provider_profile_id, skill_id, level, years_experience)
select v.perfil::uuid, s.id, v.nivel, v.anios
  from (values
    ('10000000-0000-4000-8000-000000000011', 'ui-design',         5, 7),
    ('10000000-0000-4000-8000-000000000011', 'graphic-design',    4, 6),
    ('10000000-0000-4000-8000-000000000011', 'ux-research',       4, 4),
    ('10000000-0000-4000-8000-000000000012', 'react',             5, 5),
    ('10000000-0000-4000-8000-000000000012', 'nextjs',            4, 3),
    ('10000000-0000-4000-8000-000000000012', 'tailwind-css',      4, 3),
    ('10000000-0000-4000-8000-000000000013', 'nodejs',            5, 8),
    ('10000000-0000-4000-8000-000000000013', 'postgresql',        5, 8),
    ('10000000-0000-4000-8000-000000000013', 'typescript',        4, 5),
    ('10000000-0000-4000-8000-000000000014', 'qa-testing',        5, 6),
    ('10000000-0000-4000-8000-000000000014', 'devops',            4, 4),
    ('10000000-0000-4000-8000-000000000002', 'technical-writing', 5, 9),
    ('10000000-0000-4000-8000-000000000002', 'market-research',   4, 5)
  ) as v (perfil, slug, nivel, anios)
  join public.skills s on s.slug = v.slug
on conflict (provider_profile_id, skill_id) do nothing;

-- --- 4 · Proyectos (2) — relación 1:N usuario → proyectos ----------------------------
-- El de recetas es PÚBLICO: cualquier cuenta lo ve en la búsqueda de tareas (RLS:
-- `can_read_project` deja leer los proyectos con visibility = 'public').
insert into public.projects
  (id, owner_id, title, objective, status, visibility, currency, budget_total,
   planner_metadata, dag_generated_at, started_at)
values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'Sitio de reservas para un consultorio odontológico',
   'Necesito un sitio web donde los pacientes de un consultorio odontológico puedan ver los '
   'horarios disponibles, reservar un turno y recibir la confirmación por correo, con un '
   'panel para que la recepción gestione la agenda.',
   'active', 'private', 'USD', 2400.00,
   '{"origen": "datos de prueba (db/seeds/02_datos_demo.sql)", "version": "demo-1"}',
   now() - interval '6 days', now() - interval '5 days'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002',
   'Lanzamiento de una aplicación de recetas saludables',
   'Quiero lanzar una aplicación de recetas saludables: investigar a la competencia, '
   'escribir los textos de la tienda de aplicaciones y diseñar las pantallas principales.',
   'planned', 'public', 'USD', 900.00,
   '{"origen": "datos de prueba (db/seeds/02_datos_demo.sql)", "version": "demo-1"}',
   now() - interval '2 days', null)
on conflict (id) do nothing;

-- --- 5 · Tareas (8) — relación 1:N proyecto → tareas ---------------------------------
insert into public.project_tasks
  (id, project_id, code, title, description, acceptance_criteria, required_skills, status,
   priority, order_index, depth, estimated_hours, budget, assignee_id, assigned_at,
   started_at, completed_at)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'T-01',
   'Relevamiento de requisitos y flujo de reservas',
   'Documentar los actores, el flujo de reserva y cancelación de turnos y las reglas de la agenda.',
   '[{"id": "AC-1", "criterion": "El documento describe el flujo completo de reserva y cancelación de un turno.", "verification": "Hay un diagrama o lista de pasos desde elegir horario hasta recibir la confirmación."},
     {"id": "AC-2", "criterion": "Se listan las reglas de la agenda: duración del turno, horario de atención y feriados.", "verification": "Una sección del documento enumera cada regla con su valor concreto."}]',
   '{technical-writing}', 'approved', 1, 0, 0, 10, 300.00,
   '00000000-0000-4000-8000-000000000002', now() - interval '5 days', now() - interval '5 days',
   now() - interval '3 days'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'T-02',
   'Diseño de la interfaz de la agenda de turnos',
   'Diseñar las pantallas de calendario, selección de horario, confirmación y panel de recepción.',
   '[{"id": "AC-1", "criterion": "Hay diseños de las cuatro pantallas: calendario, horario, confirmación y panel de recepción.", "verification": "El entregable enlaza o describe cada una de las cuatro pantallas por nombre."},
     {"id": "AC-2", "criterion": "Los diseños cumplen contraste de color AA para texto normal.", "verification": "Se informa la relación de contraste de los colores de texto principales, mayor o igual a 4.5:1."}]',
   '{ui-design,graphic-design}', 'assigned', 2, 1, 1, 18, 500.00,
   '00000000-0000-4000-8000-000000000011', now() - interval '2 days', null, null),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'T-03',
   'API de reservas con PostgreSQL',
   'Construir la API que lista horarios libres, crea y cancela reservas sin superposiciones.',
   '[{"id": "AC-1", "criterion": "La API impide reservar dos veces el mismo horario aunque lleguen dos pedidos a la vez.", "verification": "Una prueba automatizada crea dos reservas simultáneas del mismo horario y solo una tiene éxito."},
     {"id": "AC-2", "criterion": "Todas las consultas a la base usan parámetros y no concatenan texto.", "verification": "El código muestra consultas con marcadores de parámetro en lugar de texto concatenado."}]',
   '{nodejs,postgresql,typescript}', 'ready', 2, 2, 1, 24, 700.00, null, null, null, null),
  ('30000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'T-04',
   'Integración del frontend con la API',
   'Implementar en Next.js las pantallas diseñadas y conectarlas con la API de reservas.',
   '[{"id": "AC-1", "criterion": "Un paciente puede reservar un turno de punta a punta desde el navegador.", "verification": "El entregable incluye los pasos de una reserva real con las respuestas de la API."}]',
   '{react,nextjs,tailwind-css}', 'blocked', 3, 3, 2, 20, 600.00, null, null, null, null),
  ('30000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', 'T-05',
   'Pruebas de aceptación y puesta en producción',
   'Probar el flujo completo, corregir lo que falle y publicar el sitio con HTTPS.',
   '[{"id": "AC-1", "criterion": "El sitio publicado responde por HTTPS y pasa el plan de pruebas de aceptación.", "verification": "Se entrega la URL HTTPS y el resultado de cada caso del plan de pruebas."}]',
   '{qa-testing,devops}', 'blocked', 3, 4, 3, 12, 300.00, null, null, null, null),
  ('30000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000002', 'T-01',
   'Investigación de aplicaciones de recetas competidoras',
   'Comparar al menos cinco aplicaciones de recetas: funciones, precios y opiniones de usuarios.',
   '[{"id": "AC-1", "criterion": "La comparación cubre al menos cinco aplicaciones con funciones y precio de cada una.", "verification": "Hay una tabla con una fila por aplicación y columnas de funciones y precio."}]',
   '{market-research}', 'ready', 2, 0, 0, 8, 250.00, null, null, null, null),
  ('30000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000002', 'T-02',
   'Textos para la tienda de aplicaciones',
   'Escribir el título, la descripción corta y la descripción larga para la tienda.',
   '[{"id": "AC-1", "criterion": "Se entregan título, descripción corta y descripción larga dentro de los límites de la tienda.", "verification": "Cada texto informa su cantidad de caracteres y queda por debajo del máximo indicado."}]',
   '{copywriting}', 'blocked', 3, 1, 1, 6, 200.00, null, null, null, null),
  ('30000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000002', 'T-03',
   'Diseño de las pantallas principales',
   'Diseñar inicio, detalle de receta y lista de compras.',
   '[{"id": "AC-1", "criterion": "Hay diseños de inicio, detalle de receta y lista de compras.", "verification": "El entregable describe o enlaza las tres pantallas por nombre."}]',
   '{ui-design}', 'blocked', 3, 2, 1, 14, 450.00, null, null, null, null)
on conflict (id) do nothing;

-- --- 6 · Dependencias (7) — relación N:M tarea ↔ tarea (el DAG) -----------------------
insert into public.task_dependencies (id, task_id, depends_on_task_id, created_by) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'system'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'system'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', 'system'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', 'system'),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000004', 'system'),
  ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000006', 'system'),
  ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000006', 'system')
on conflict (id) do nothing;

-- --- 7 · Candidaturas (4) — relación N:M proveedor ↔ tarea ----------------------------
insert into public.task_applications
  (id, task_id, provider_id, status, vector_score, skill_score, reputation_score,
   match_score, match_explanation, is_auto_generated, decided_at)
values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002', 'accepted', 0.62000, 1.00000, 0.25000, 0.67900,
   '{"summary": "Cubre la única habilidad pedida (technical-writing) con nivel 5; sin historial, reputación neutra."}',
   true, now() - interval '5 days'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000011', 'accepted', 0.71000, 1.00000, 0.25000, 0.72950,
   '{"summary": "Cubre ui-design y graphic-design con niveles 5 y 4; mejor afinidad entre los candidatos."}',
   true, now() - interval '2 days'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000012', 'rejected', 0.40000, 0.00000, 0.25000, 0.23000,
   '{"summary": "No declara ninguna de las habilidades pedidas; quedó por debajo de la candidata adjudicada."}',
   true, now() - interval '2 days'),
  ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000013', 'pending', 0.68000, 1.00000, 0.25000, 0.70600,
   '{"summary": "Cubre nodejs, postgresql y typescript; pendiente de la próxima ronda del emparejador."}',
   true, null)
on conflict (id) do nothing;

-- --- 8 · Entrega aprobada de T-01 (1) y su reseña automática (1) -----------------------
insert into public.deliverables
  (id, task_id, provider_id, version, summary, content, evidence, qa_status, qa_score,
   qa_feedback, qa_criteria_results, qa_evaluated_at, submitted_at)
values
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002', 1,
   'Documento de requisitos con el flujo de reservas y las reglas de la agenda.',
   'Flujo: el paciente elige especialidad, ve los horarios libres de la semana, elige uno, '
   'completa nombre, cédula y correo, y recibe la confirmación. Puede cancelar hasta 24 h antes '
   'con el enlace del correo. Reglas: turnos de 30 minutos, atención de lunes a viernes de 9 a 18 h, '
   'sin turnos en feriados nacionales.',
   '{"AC-1": "Sección 2: pasos 1 a 6 desde elegir horario hasta el correo de confirmación, más la cancelación.", "AC-2": "Sección 3: duración 30 min, horario 9 a 18 h de lunes a viernes, feriados nacionales sin agenda."}',
   'approved', 100.00,
   '{"summary": "Los dos criterios se cumplen con evidencia concreta en el documento."}',
   '[{"id": "AC-1", "outcome": "pass", "reported": "pass", "confidence": 0.93, "evidence": "Sección 2, pasos 1 a 6", "reasoning": "El flujo de reserva y el de cancelación están completos.", "downgraded": false},
     {"id": "AC-2", "outcome": "pass", "reported": "pass", "confidence": 0.95, "evidence": "Sección 3", "reasoning": "Cada regla tiene un valor concreto.", "downgraded": false}]',
   now() - interval '3 days', now() - interval '4 days')
on conflict (id) do nothing;

insert into public.reviews
  (id, task_id, deliverable_id, reviewer_id, reviewee_id, source, rating, quality_score, comment)
values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '60000000-0000-4000-8000-000000000001', null, '00000000-0000-4000-8000-000000000002',
   'ai_judge', 5.00, 5.00, 'Aprobado por el evaluador automático: 2 de 2 criterios cumplidos.')
on conflict (id) do nothing;

-- --- 9 · Reputación (7) — libro mayor append-only ------------------------------------
-- El trigger `trg_apply_reputation_event` proyecta cada evento a `provider_profiles`.
insert into public.reputation_events
  (id, user_id, event_type, delta, weight, reason, task_id, deliverable_id, review_id, actor_type)
values
  ('80000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'onboarding_bonus', 5, 1, 'Alta de proveedora', null, null, null, 'system'),
  ('80000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000012', 'onboarding_bonus', 5, 1, 'Alta de proveedora', null, null, null, 'system'),
  ('80000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000013', 'onboarding_bonus', 5, 1, 'Alta de proveedor', null, null, null, 'system'),
  ('80000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000014', 'onboarding_bonus', 5, 1, 'Alta de proveedor', null, null, null, 'system'),
  ('80000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', 'onboarding_bonus', 5, 1, 'Alta de proveedor', null, null, null, 'system'),
  ('80000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000002', 'deliverable_approved', 8, 1, 'T-01 aprobada por el evaluador automático',
   '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'ai_agent'),
  ('80000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000002', 'task_completed', 4, 1, 'T-01 completada',
   '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', null, 'ai_agent')
on conflict (id) do nothing;

-- --- 10 · Auditoría (2) --------------------------------------------------------------
insert into public.audit_logs (id, actor_id, actor_type, action, entity_type, entity_id, project_id, changes)
values
  ('90000000-0000-4000-8000-000000000001', null, 'ai_agent', 'task.assigned', 'project_task',
   '30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   '{"assignee_id": "00000000-0000-4000-8000-000000000011", "origen": "datos de prueba"}'),
  ('90000000-0000-4000-8000-000000000002', null, 'ai_agent', 'deliverable.approved', 'deliverable',
   '60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '{"qa_score": 100, "origen": "datos de prueba"}')
on conflict (id) do nothing;

-- =====================================================================================
-- FIN — db/seeds/02_datos_demo.sql
-- Verificación:
--   select count(*) from public.project_tasks;            -- 8
--   select code, status from public.project_tasks
--    where project_id = '20000000-0000-4000-8000-000000000001' order by code;
-- =====================================================================================
