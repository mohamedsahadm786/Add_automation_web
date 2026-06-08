-- Tenant lifecycle (suspend / reactivate / remove) + general admin audit.
-- Run once in the Supabase SQL editor. Additive + idempotent.
--
--   tenant_profiles.status : 'active' (default) | 'suspended' | 'removed'
--     active     -> normal access
--     suspended  -> temporarily blocked at login; reversible
--     removed     -> blocked + hidden from the tenants list (tombstone). Data is
--                   retained for audit and can be restored by reactivating.
--
--   impersonation_events.action : the audit log now records more than just
--     page views — 'view_page' (default) | 'suspend' | 'reactivate' | 'remove'.

alter table public.tenant_profiles
    add column if not exists status text not null default 'active';

alter table public.impersonation_events
    add column if not exists action text not null default 'view_page';

-- Both tables already have RLS disabled + grants from earlier migrations.
