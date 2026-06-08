-- Pipeline run status (completion marker). Run once in the Supabase SQL editor.
-- Additive + idempotent.
--
-- The web app can't tell when an n8n run *finishes* — it only sees rows appear.
-- n8n updates this row (one per tenant, latest run) so the Run pill can show
-- "Pipeline complete" accurately instead of guessing from row counts.
--
--   status      : 'running' | 'completed' | 'failed'
--   started_at  : when n8n began this run
--   finished_at : when n8n finished (NULL while running)
--   *_made      : final counts n8n produced this run (optional, for display)
--
-- The app matches a completion to its own run by comparing finished_at to the
-- timestamp it started the run at. Until n8n writes here, the app falls back to
-- a quiescence heuristic (no new rows for a few minutes => complete).

create table if not exists public.tenant_run_status (
    tenant_id     uuid primary key,              -- = auth.users.id
    status        text,                          -- 'running' | 'completed' | 'failed'
    started_at    timestamptz,
    finished_at   timestamptz,
    personas_made integer,
    images_made   integer,
    videos_made   integer,
    message       text,                          -- optional error/summary text
    updated_at    timestamptz not null default now()
);

-- MVP posture (match the rest of the schema): RLS off + grants.
alter table public.tenant_run_status disable row level security;
grant all on public.tenant_run_status to anon, authenticated, service_role;

-- n8n usage:
--   at start:  upsert (tenant_id, status='running',   started_at=now(), finished_at=null)
--   on done:   upsert (tenant_id, status='completed', finished_at=now(), videos_made=...)
--   on error:  upsert (tenant_id, status='failed',    finished_at=now(), message=...)
