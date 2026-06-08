-- Per-tenant run control. Run once in the Supabase SQL editor. Additive.
--
-- These settings used to be hardcoded in the n8n "CONFIG" code block. They now
-- live per-tenant in the DB so each tenant configures their own run, and n8n
-- reads them from here (keyed by tenant_id) instead of being hardcoded.
--
--   one_per_persona     bool  -- true: every persona this run; false: only personas with no video yet
--   tiktok_id           text  -- targeting override (one or comma-separated handles); null = not used
--   max_videos_per_run  int   -- scenarios per selected persona this run
--   max_qc_attempts     int   -- QC retries per scene image before skipping it
--   video_duration      text  -- e.g. '15' (seconds)
--   video_resolution    text  -- e.g. '1080p'
--
-- Nullable numeric/text columns: a row is "incomplete" until the tenant fills
-- the required fields — the web Run button stays disabled until then.

create table if not exists public.tenant_run_configs (
    tenant_id          uuid primary key,        -- = auth.users.id
    one_per_persona    boolean not null default false,
    tiktok_id          text,
    max_videos_per_run integer,
    max_qc_attempts    integer,
    video_duration     text,
    video_resolution   text,
    updated_at         timestamptz not null default now()
);

-- MVP posture (match the rest of the schema): RLS off + grants.
alter table public.tenant_run_configs disable row level security;
grant all on public.tenant_run_configs to anon, authenticated, service_role;

-- n8n reads a tenant's config like:
--   select * from public.tenant_run_configs where tenant_id = '<tenant uid>';
