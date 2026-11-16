-- =========================================================================================
-- VEKTORA · FASE 8 — La cola del juez: un veredicto es definitivo y un turno no se pierde
-- =========================================================================================
-- Depende de: db/schema.sql y las migraciones 0002 a 0007.
-- Idempotente: se puede reaplicar sobre una base ya desplegada.
--
-- Reemplaza tres funciones de la 0005 (`claim_deliverable_for_qa`, `apply_qa_verdict` y
-- `pending_qa_deliverables`). Va DESPUÉS de la 0005 siempre: reaplicar solo la 0005
-- devolvería las versiones viejas.
--
-- Resuelve dos formas de romper el ciclo que no producen ningún error. Es la quinta y la
-- sexta vez que aparece el mismo defecto: un estado del que el sistema no sale solo.
--
--   1. UN ENTREGABLE CON REVISIÓN PEDIDA SE VOLVÍA A JUZGAR PARA SIEMPRE. La cola incluía
--      `revision_requested`, así que la MISMA versión se evaluaba en cada corrida del reloj
--      (cada 10 minutos) sin que nadie hubiera entregado nada nuevo. Tres consecuencias:
--        · una llamada al modelo por entregable y por corrida, hasta agotar la cuota;
--        · el modelo no es determinista: repetir el juicio hasta que salga «aprobado»
--          vacía de sentido al veredicto;
--        · la v1 quedaba en la cola incluso después de aprobarse la v2, y al volver a
--          juzgarla la tarea pasaba de `approved` a `revision_requested` y sus dependientes
--          de `ready` a `blocked`. El DAG retrocedía solo.
--      Ahora `revision_requested` es un veredicto como cualquier otro: lo que sigue es una
--      versión nueva del proveedor, no otro juicio de la misma.
--
--   2. UN TURNO TOMADO POR UN PROCESO QUE MUERE NO VOLVÍA NUNCA. `running` no estaba en la
--      cola y la toma lo rechazaba («otro juez lo tiene tomado»), así que un reinicio de la
--      instancia o un corte por tiempo a mitad de un juicio dejaba el entregable —y la
--      tarea, y todo lo que dependía de ella— esperando a alguien que no existe. Ahora un
--      turno con más de `qa_claim_timeout()` se considera abandonado y se puede retomar.
-- =========================================================================================

set search_path = public, extensions;


-- =========================================================================================
-- 01 · Cuándo se tomó el turno
-- =========================================================================================
-- Columna propia y no `updated_at`: el trigger `set_updated_at` la reescribe en cualquier
-- UPDATE de la fila, y «alguien tocó el entregable» no es lo mismo que «un juez lo tomó».
alter table public.deliverables
  add column if not exists qa_claimed_at timestamptz;

comment on column public.deliverables.qa_claimed_at is
  'Momento en que un juez tomó el turno por última vez. Con qa_status = running y más de '
  'qa_claim_timeout() de antigüedad, el turno se considera abandonado y otro juez lo retoma.';

-- Cuánto puede durar un juicio antes de darlo por muerto. No es política de producto sino
-- un dato de la infraestructura: los disparadores cortan a los 300 s (`maxDuration` de
-- app/api/cron), así que ningún juez vivo sostiene un turno 15 minutos. Vive en una función
-- para que la toma y la cola no puedan discrepar.
create or replace function public.qa_claim_timeout()
returns interval
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
  select interval '15 minutes';
$function$;


-- =========================================================================================
-- 02 · claim_deliverable_for_qa — solo lo que espera veredicto, y solo la última versión
-- =========================================================================================
create or replace function public.claim_deliverable_for_qa(p_deliverable_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current    public.qa_status;
  v_previous   public.qa_status;
  v_task_id    uuid;
  v_version    integer;
  v_claimed_at timestamptz;
  v_abandoned  boolean := false;
  v_result     jsonb;
begin
  select d.qa_status, d.task_id, d.version, coalesce(d.qa_claimed_at, d.updated_at)
    into v_current, v_task_id, v_version, v_claimed_at
    from public.deliverables d
   where d.id = p_deliverable_id
   for update;

  if not found then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'no existe ningún entregable con ese id'
    );
  end if;

  -- Un turno abandonado se retoma. Sin esto, el proceso que murió con el turno tomado
  -- sería el único que podía devolverlo.
  v_abandoned := v_current = 'running'
             and v_claimed_at < now() - public.qa_claim_timeout();

  if not v_abandoned and v_current not in ('pending', 'error') then
    return jsonb_build_object(
      'claimed', false,
      'qa_status', v_current,
      'reason', format(
        'el entregable está en qa_status=%s: %s',
        v_current,
        case v_current
          when 'running'  then 'otro juez lo tiene tomado ahora mismo'
          when 'approved' then 'ya fue aprobado y el veredicto es terminal'
          when 'rejected' then 'ya fue rechazado y el veredicto es terminal'
          when 'revision_requested' then
            'ya tiene veredicto; lo que sigue es una versión nueva del proveedor'
          else 'no admite juicio automático'
        end
      )
    );
  end if;

  -- Solo se juzga la última versión. Una versión superada ya no decide nada sobre la
  -- tarea: juzgarla sería gastar una llamada al modelo para, en el peor caso, pisar el
  -- estado que dejó la versión vigente.
  if exists (
    select 1 from public.deliverables n
     where n.task_id = v_task_id and n.version > v_version
  ) then
    return jsonb_build_object(
      'claimed', false,
      'qa_status', v_current,
      'reason', 'hay una versión más nueva de esta entrega: solo se juzga la última'
    );
  end if;

  -- Un turno abandonado se informa como `pending`: es el estado al que hay que devolverlo
  -- si este juicio resulta ser un ensayo.
  v_previous := case when v_abandoned then 'pending'::public.qa_status else v_current end;

  update public.deliverables
     set qa_status     = 'running',
         qa_claimed_at = now(),
         updated_at    = now()
   where id = p_deliverable_id;

  select jsonb_build_object(
    'claimed', true,
    'previous_status', v_previous,
    'reclaimed', v_abandoned,
    'deliverable', jsonb_build_object(
      'id',           d.id,
      'task_id',      d.task_id,
      'provider_id',  d.provider_id,
      'version',      d.version,
      'summary',      d.summary,
      'content',      d.content,
      'artifacts',    d.artifacts,
      'evidence',     d.evidence,
      'submitted_at', d.submitted_at
    ),
    'task', jsonb_build_object(
      'id',                  t.id,
      'project_id',          t.project_id,
      'code',                t.code,
      'title',               t.title,
      'description',         t.description,
      'acceptance_criteria', t.acceptance_criteria,
      'required_skills',     t.required_skills,
      'status',              t.status,
      'assignee_id',         t.assignee_id,
      'budget',              t.budget,
      'estimated_hours',     t.estimated_hours
    ),
    'project', jsonb_build_object(
      'id',        p.id,
      'title',     p.title,
      'objective', p.objective
    ),
    'previous_rejections', (
      select count(*)
        from public.reputation_events re
       where re.task_id = d.task_id
         and re.event_type = 'deliverable_rejected'
    )
  )
  into v_result
  from public.deliverables d
  join public.project_tasks t on t.id = d.task_id
  join public.projects      p on p.id = t.project_id
  where d.id = p_deliverable_id;

  return v_result;
end;
$function$;


-- =========================================================================================
-- 03 · apply_qa_verdict — una tarea aprobada no retrocede
-- =========================================================================================
-- Igual que en la 0005, con un cambio: el veredicto de un entregable no mueve una tarea que
-- ya está `approved`. La toma ya impide juzgar una versión superada; esto es la segunda
-- cerradura, en el único sitio donde el daño sería irreversible de verdad (al salir de
-- `approved`, el trigger de la 0002 vuelve a bloquear todo lo que dependía de la tarea).
create or replace function public.apply_qa_verdict(
  p_deliverable_id      uuid,
  p_qa_status           public.qa_status,
  p_qa_score            numeric,
  p_qa_feedback         jsonb,
  p_qa_criteria_results jsonb,
  p_task_status         public.task_status,
  p_rating              numeric,
  p_qa_run_id           uuid    default null,
  p_quality_score       numeric default null,
  p_timeliness_score    numeric default null,
  p_comment             text    default null,
  p_reputation          jsonb   default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task_id      uuid;
  v_provider_id  uuid;
  v_review_id    uuid;
  v_event        jsonb;
  v_event_type   public.reputation_event_type;
  v_written      integer := 0;
  v_skipped      text[]  := array[]::text[];
  v_task_rows    integer := 0;
begin
  if p_qa_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'VEKTORA/QA: apply_qa_verdict no admite qa_status=%', p_qa_status
      using errcode = '22023';
  end if;

  -- Solo se aplica sobre un turno realmente tomado. Si otro proceso ya resolvió este
  -- entregable, aquí no se pisa nada: se informa y se sale.
  update public.deliverables d
     set qa_status           = p_qa_status,
         qa_score            = p_qa_score,
         qa_feedback         = coalesce(p_qa_feedback, '{}'::jsonb),
         qa_criteria_results = coalesce(p_qa_criteria_results, '[]'::jsonb),
         qa_run_id           = p_qa_run_id,
         qa_evaluated_at     = now(),
         updated_at          = now()
   where d.id = p_deliverable_id
     and d.qa_status = 'running'
  returning d.task_id, d.provider_id into v_task_id, v_provider_id;

  if v_task_id is null then
    return jsonb_build_object(
      'applied', false,
      'reason', 'el entregable no estaba en qa_status=running: otro proceso lo resolvió antes'
    );
  end if;

  -- --- Reseña automática ---------------------------------------------------------------
  insert into public.reviews (
    task_id, deliverable_id, reviewer_id, reviewee_id, source,
    rating, quality_score, timeliness_score, comment, is_public
  )
  values (
    v_task_id, p_deliverable_id, null, v_provider_id, 'ai_judge',
    p_rating, p_quality_score, p_timeliness_score, p_comment, true
  )
  on conflict (task_id, reviewee_id, source) where reviewer_id is null
  do update set
    deliverable_id   = excluded.deliverable_id,
    rating           = excluded.rating,
    quality_score    = excluded.quality_score,
    timeliness_score = excluded.timeliness_score,
    comment          = excluded.comment,
    updated_at       = now()
  returning id into v_review_id;

  -- --- Reputación ----------------------------------------------------------------------
  -- Guardia de idempotencia ANTES del insert: la tabla es append-only.
  for v_event in select * from jsonb_array_elements(coalesce(p_reputation, '[]'::jsonb))
  loop
    v_event_type := (v_event ->> 'event_type')::public.reputation_event_type;

    if exists (
      select 1
        from public.reputation_events re
       where re.deliverable_id = p_deliverable_id
         and re.event_type = v_event_type
    ) then
      v_skipped := v_skipped || v_event_type::text;
      continue;
    end if;

    insert into public.reputation_events (
      user_id, event_type, delta, weight, reason,
      task_id, deliverable_id, review_id, actor_type, metadata
    )
    values (
      v_provider_id,
      v_event_type,
      coalesce((v_event ->> 'delta')::numeric, 0),
      coalesce((v_event ->> 'weight')::numeric, 1),
      v_event ->> 'reason',
      v_task_id,
      p_deliverable_id,
      v_review_id,
      'ai_agent',
      coalesce(v_event -> 'metadata', '{}'::jsonb)
    );
    v_written := v_written + 1;
  end loop;

  -- --- Estado de la tarea --------------------------------------------------------------
  -- Pasar a 'approved' dispara `trg_propagate_task_readiness`: ahí el DAG avanza solo.
  -- Una tarea ya aprobada no se toca (ver la cabecera de esta sección).
  update public.project_tasks t
     set status     = p_task_status,
         updated_at = now()
   where t.id = v_task_id
     and t.status is distinct from p_task_status
     and t.status <> 'approved';
  get diagnostics v_task_rows = row_count;

  return jsonb_build_object(
    'applied',             true,
    'deliverable_id',      p_deliverable_id,
    'task_id',             v_task_id,
    'provider_id',         v_provider_id,
    'review_id',           v_review_id,
    'qa_status',           p_qa_status,
    'task_status',         (select t.status from public.project_tasks t where t.id = v_task_id),
    'task_updated',        v_task_rows > 0,
    'reputation_written',  v_written,
    'reputation_skipped',  to_jsonb(v_skipped)
  );
end;
$function$;


-- =========================================================================================
-- 04 · pending_qa_deliverables — lo que espera veredicto, nada más
-- =========================================================================================
-- Entran: lo recién entregado (`pending`), lo que falló por una avería NUESTRA (`error`) y
-- los turnos abandonados. No entra `revision_requested` (ya tiene veredicto) ni una versión
-- superada por otra más nueva.
create or replace function public.pending_qa_deliverables(p_limit integer default 20)
returns table (
  deliverable_id uuid,
  task_id        uuid,
  project_id     uuid,
  task_code      text,
  task_title     text,
  provider_id    uuid,
  version        integer,
  qa_status      public.qa_status,
  submitted_at   timestamptz,
  criteria_count integer
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select
    d.id,
    d.task_id,
    t.project_id,
    t.code,
    t.title,
    d.provider_id,
    d.version,
    d.qa_status,
    d.submitted_at,
    coalesce(jsonb_array_length(t.acceptance_criteria), 0)::integer
  from public.deliverables d
  join public.project_tasks t on t.id = d.task_id
  where (
          d.qa_status in ('pending', 'error')
          or (d.qa_status = 'running'
              and coalesce(d.qa_claimed_at, d.updated_at) < now() - public.qa_claim_timeout())
        )
    and not exists (
      select 1 from public.deliverables n
       where n.task_id = d.task_id and n.version > d.version
    )
  order by d.submitted_at asc
  limit greatest(1, coalesce(p_limit, 20));
$function$;


-- =========================================================================================
-- 05 · Privilegios
-- =========================================================================================
-- `create or replace` conserva los privilegios de la 0005, pero `qa_claim_timeout` es nueva
-- y nace con EXECUTE para PUBLIC. Se revoca todo otra vez para que el archivo se sostenga
-- solo: ningún rol de cliente puede tomar turnos ni emitir veredictos.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.qa_claim_timeout()',
    'public.claim_deliverable_for_qa(uuid)',
    'public.apply_qa_verdict(uuid, public.qa_status, numeric, jsonb, jsonb, public.task_status, numeric, uuid, numeric, numeric, text, jsonb)',
    'public.pending_qa_deliverables(integer)'
  ]
  loop
    execute format('revoke all on function %s from public', v_fn);
    execute format('revoke all on function %s from anon, authenticated', v_fn);
  end loop;
end $$;


-- =========================================================================================
-- FIN — db/migrations/0008_qa_cola.sql
-- Verificación: db/verify/06_qa_cola.sql
-- =========================================================================================
