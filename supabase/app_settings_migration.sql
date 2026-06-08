-- App settings: a small key/value store for API keys & config entered from the
-- Settings page. Run this once in the Supabase SQL editor.
--
-- ⚠️ SECURITY NOTE: this app talks to Supabase with the in-bundle publishable
-- key and RLS is disabled on its tables (MVP posture). That means anything
-- stored here is readable by anyone who has that key. These are SECRET values
-- (Fal / Anthropic API keys) — only use this on a trusted / internal
-- deployment, and move to an Edge-Function-gated store (service role) before
-- this is truly public. See the note in the Settings panel.

create table if not exists public.app_settings (
    key         text primary key,
    value       text,
    updated_at  timestamptz not null default now()
);

-- Seed the known keys so they always render as (empty) rows in the UI.
insert into public.app_settings (key) values
    ('FAL_API_KEY'),
    ('ANTHROPIC_API_KEY')
on conflict (key) do nothing;

-- Match the rest of the schema's MVP posture (RLS off, anon may read/write).
alter table public.app_settings disable row level security;
grant all on public.app_settings to anon, authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- To CHECK the stored values later, run:
--
--   select key, value, updated_at from public.app_settings order by key;
--
-- ───────────────────────────────────────────────────────────────────────────
