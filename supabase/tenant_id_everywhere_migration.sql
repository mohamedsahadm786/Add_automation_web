-- Tenant isolation on EVERY table. Run once in the Supabase SQL editor.
-- Additive + idempotent. Safe to run on dev and (later) on live.
--
-- Today only tiktok_accounts carries tenant_id; the child tables are scoped by
-- walking the chain. This adds tenant_id to every pipeline table and keeps it
-- correct AUTOMATICALLY via BEFORE INSERT/UPDATE triggers that copy tenant_id
-- down from the parent row. n8n keeps inserting exactly as it does now —
-- Postgres fills tenant_id for free — so no n8n change is required.
--
-- Chain: tiktok_accounts -> personas -> outputs -> videos
--        tiktok_accounts -> tiktok_auth
--        tiktok_accounts -> tiktok_posts (also linked to videos)

-- ── 1) columns + indexes ────────────────────────────────────────────────────
alter table public.personas     add column if not exists tenant_id uuid;
alter table public.outputs      add column if not exists tenant_id uuid;
alter table public.videos       add column if not exists tenant_id uuid;
alter table public.tiktok_auth  add column if not exists tenant_id uuid;
alter table public.tiktok_posts add column if not exists tenant_id uuid;

create index if not exists idx_personas_tenant     on public.personas(tenant_id);
create index if not exists idx_outputs_tenant      on public.outputs(tenant_id);
create index if not exists idx_videos_tenant       on public.videos(tenant_id);
create index if not exists idx_tiktok_auth_tenant  on public.tiktok_auth(tenant_id);
create index if not exists idx_tiktok_posts_tenant on public.tiktok_posts(tenant_id);

-- ── 2) backfill existing rows, parent -> child order ────────────────────────
update public.personas p
   set tenant_id = a.tenant_id
  from public.tiktok_accounts a
 where a.id = p.tiktok_account_id
   and p.tenant_id is distinct from a.tenant_id;

update public.outputs o
   set tenant_id = p.tenant_id
  from public.personas p
 where p.id = o.persona_id
   and o.tenant_id is distinct from p.tenant_id;

update public.videos v
   set tenant_id = o.tenant_id
  from public.outputs o
 where o.id = v.output_id
   and v.tenant_id is distinct from o.tenant_id;

update public.tiktok_auth t
   set tenant_id = a.tenant_id
  from public.tiktok_accounts a
 where a.id = t.tiktok_account_id
   and t.tenant_id is distinct from a.tenant_id;

update public.tiktok_posts tp
   set tenant_id = a.tenant_id
  from public.tiktok_accounts a
 where a.id = tp.tiktok_account_id
   and tp.tenant_id is distinct from a.tenant_id;

-- ── 3) triggers: auto-stamp tenant_id from the parent on insert/update ──────
create or replace function public.set_persona_tenant() returns trigger as $$
begin
    select a.tenant_id into new.tenant_id
      from public.tiktok_accounts a where a.id = new.tiktok_account_id;
    return new;
end; $$ language plpgsql;

create or replace function public.set_output_tenant() returns trigger as $$
begin
    select p.tenant_id into new.tenant_id
      from public.personas p where p.id = new.persona_id;
    return new;
end; $$ language plpgsql;

create or replace function public.set_video_tenant() returns trigger as $$
begin
    select o.tenant_id into new.tenant_id
      from public.outputs o where o.id = new.output_id;
    return new;
end; $$ language plpgsql;

create or replace function public.set_tiktok_account_child_tenant() returns trigger as $$
begin
    select a.tenant_id into new.tenant_id
      from public.tiktok_accounts a where a.id = new.tiktok_account_id;
    return new;
end; $$ language plpgsql;

drop trigger if exists trg_persona_tenant on public.personas;
create trigger trg_persona_tenant before insert or update on public.personas
    for each row execute function public.set_persona_tenant();

drop trigger if exists trg_output_tenant on public.outputs;
create trigger trg_output_tenant before insert or update on public.outputs
    for each row execute function public.set_output_tenant();

drop trigger if exists trg_video_tenant on public.videos;
create trigger trg_video_tenant before insert or update on public.videos
    for each row execute function public.set_video_tenant();

drop trigger if exists trg_tiktok_auth_tenant on public.tiktok_auth;
create trigger trg_tiktok_auth_tenant before insert or update on public.tiktok_auth
    for each row execute function public.set_tiktok_account_child_tenant();

drop trigger if exists trg_tiktok_posts_tenant on public.tiktok_posts;
create trigger trg_tiktok_posts_tenant before insert or update on public.tiktok_posts
    for each row execute function public.set_tiktok_account_child_tenant();

-- ── 4) MVP posture: RLS off + grants (match the rest of the schema) ─────────
alter table public.tiktok_auth  disable row level security;
alter table public.tiktok_posts disable row level security;
grant all on public.tiktok_auth  to anon, authenticated, service_role;
grant all on public.tiktok_posts to anon, authenticated, service_role;

-- Verify:
--   select 'personas' t, count(*) filter (where tenant_id is null) as null_tenant from public.personas
--   union all select 'outputs', count(*) filter (where tenant_id is null) from public.outputs
--   union all select 'videos',  count(*) filter (where tenant_id is null) from public.videos;
