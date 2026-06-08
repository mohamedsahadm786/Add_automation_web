-- ============================================================
-- ALLUVI LEARNING LAYER v2 — enterprise migration
-- Run once in the Supabase SQL editor. Idempotent.
--
-- Adds the learning/RLHF layer on top of the existing pipeline schema:
--   scenarios (curated catalog + per-tenant generated), attribute_stats,
--   attribute_priors, tuning_suggestions, tenant_learning_state, and the
--   exploration-progress view (QC-skip aware).
--
-- See read/learning_layer.md for the full explanation of how the
-- exploration -> active gate works and what n8n must read/write.
-- ============================================================

-- 1) SCENARIO CATALOG  (curated = shared/tenant_id NULL; generated = per-tenant)
create table if not exists public.scenarios (
  id                   bigint generated always as identity primary key,
  index_no             integer,                     -- ordering position 1..N for curated; NULL for generated
  scenario_id          text not null unique,        -- curated = human id; generated = namespaced (gen_<tenant8>_0007)
  tenant_id            uuid references public.tenant_profiles(tenant_id) on delete cascade,
                                                     -- NULL = global curated (shared); set = tenant-specific generated
  source               text not null default 'curated',  -- 'curated' | 'generated'
  category             text,
  difficulty           text,
  scenario_title       text,
  content              jsonb not null,              -- full scenario JSON
  composed_attributes  jsonb not null,              -- canonical learning tags
  version              text not null default 'v1',
  content_hash         text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint scenarios_source_chk check (source in ('curated','generated'))
);
create index if not exists idx_scenarios_tenant on public.scenarios(tenant_id);
create index if not exists idx_scenarios_active on public.scenarios(active);
create index if not exists idx_scenarios_source on public.scenarios(source);
-- keep curated ordering positions unique (gap-tolerant: partial index)
create unique index if not exists uq_scenarios_curated_index
  on public.scenarios(index_no) where source = 'curated' and index_no is not null;

-- 2) ASSET_RATINGS — immutable attribute snapshot (unchanged from v1)
alter table public.asset_ratings
  add column if not exists composed_attributes jsonb,
  add column if not exists scenario_version   text;

-- 3) ATTRIBUTE_STATS — per-tenant running tallies (unchanged from v1)
create table if not exists public.attribute_stats (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenant_profiles(tenant_id) on delete cascade,
  context_key   text not null default 'global',
  attribute_key text not null,
  dimension     text not null,
  kind          text not null,
  n             integer not null default 0,
  passes        integer not null default 0,
  sum_val       numeric not null default 0,
  sum_sq        numeric not null default 0,
  estimate      numeric,
  updated_at    timestamptz not null default now(),
  constraint attribute_stats_kind_chk check (kind in ('gate','score')),
  unique (tenant_id, context_key, attribute_key, dimension)
);
create index if not exists idx_attrstats_tenant on public.attribute_stats(tenant_id);
create index if not exists idx_attrstats_lookup on public.attribute_stats(tenant_id, context_key, attribute_key);

-- 4) ATTRIBUTE_PRIORS — optional cross-tenant cold-start pool (unchanged)
create table if not exists public.attribute_priors (
  id            bigint generated always as identity primary key,
  context_key   text not null default 'global',
  attribute_key text not null,
  dimension     text not null,
  kind          text not null,
  n             integer not null default 0,
  passes        integer not null default 0,
  sum_val       numeric not null default 0,
  sum_sq        numeric not null default 0,
  estimate      numeric,
  updated_at    timestamptz not null default now(),
  constraint attribute_priors_kind_chk check (kind in ('gate','score')),
  unique (context_key, attribute_key, dimension)
);

-- 5) TUNING_SUGGESTIONS — prompt/script fixes, validated before use (unchanged)
create table if not exists public.tuning_suggestions (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null references public.tenant_profiles(tenant_id) on delete cascade,
  scope_type       text not null,
  scope_key        text not null,
  dimension        text not null,
  cause            text,
  suggested_edit   text,
  status           text not null default 'candidate',
  evidence_n       integer not null default 0,
  score_delta      numeric,
  source_output_id bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint tuning_status_chk check (status in ('candidate','testing','validated','rejected')),
  constraint tuning_scope_chk  check (scope_type in ('attribute','scenario'))
);
create index if not exists idx_tuning_tenant_status on public.tuning_suggestions(tenant_id, status);

-- 6) TENANT_LEARNING_STATE — the exploration -> active gate (+ threshold)
create table if not exists public.tenant_learning_state (
  tenant_id              uuid primary key references public.tenant_profiles(tenant_id) on delete cascade,
  phase                  text not null default 'exploration',  -- 'exploration' | 'active'
  engine_enabled         boolean not null default false,
  min_coverage_pct       integer not null default 100,         -- flip when pct_complete >= this (100 = strict)
  required_coverage      integer,                              -- active-curated count captured at start (optional)
  exploration_started_at timestamptz not null default now(),
  engine_enabled_at      timestamptz,
  updated_at             timestamptz not null default now(),
  constraint tls_phase_chk check (phase in ('exploration','active')),
  constraint tls_pct_chk   check (min_coverage_pct between 1 and 100)
);

-- 7) VIEW — exploration progress per tenant (now QC-skip aware)
create or replace view public.v_tenant_exploration_progress as
with active_curated as (
  select count(*)::int as total
  from public.scenarios
  where source = 'curated' and active = true
),
resolved as (
  -- a curated scenario is RESOLVED for a tenant when it has >=1 terminal output:
  --   qc_status='skipped'  (no video to rate), OR
  --   qc_status='pass' AND its rating has video_rated=true
  select o.tenant_id,
         count(distinct o.scenario_id) filter (
           where s.source = 'curated' and s.active = true
             and ( o.qc_status = 'skipped'
                or (o.qc_status = 'pass' and ar.video_rated = true) )
         )::int as resolved_count
  from   public.outputs o
  join   public.scenarios s   on s.scenario_id = o.scenario_id
  left   join public.asset_ratings ar on ar.output_id = o.id
  group  by o.tenant_id
)
select t.tenant_id,
       ac.total                                as active_curated,
       coalesce(r.resolved_count, 0)           as resolved_curated,
       case when ac.total = 0 then 0
            else round(100.0 * coalesce(r.resolved_count,0) / ac.total) end as pct_complete,
       (coalesce(r.resolved_count,0) >= ac.total and ac.total > 0)          as is_complete
from   public.tenant_profiles t
cross  join active_curated ac
left   join resolved r on r.tenant_id = t.tenant_id;

-- MVP posture (match the rest of the schema): RLS off + grants.
alter table public.scenarios             disable row level security;
alter table public.attribute_stats       disable row level security;
alter table public.attribute_priors      disable row level security;
alter table public.tuning_suggestions    disable row level security;
alter table public.tenant_learning_state disable row level security;
grant all on public.scenarios             to anon, authenticated, service_role;
grant all on public.attribute_stats       to anon, authenticated, service_role;
grant all on public.attribute_priors      to anon, authenticated, service_role;
grant all on public.tuning_suggestions    to anon, authenticated, service_role;
grant all on public.tenant_learning_state to anon, authenticated, service_role;
grant select on public.v_tenant_exploration_progress to anon, authenticated, service_role;

-- ============================================================
-- END migration v2
-- ============================================================
