-- Super Admin role marker. Run once in the Supabase SQL editor. Additive + idempotent.
--
-- Everyone who signs in is a tenant (tenant_id = auth.users.id). The super admin
-- is a separate, platform-wide role that sees every tenant and can impersonate
-- them. For now the super admin uses the hardcoded sessionStorage login (see
-- useAuth.js) and reads through the publishable key; this `role` column is here
-- to future-proof the later RLS pass, where the super admin becomes a real auth
-- user flagged role = 'super_admin' with a bypass policy.

alter table public.tenant_profiles
    add column if not exists role text not null default 'tenant';

-- Optional: index if we ever filter tenants by role in the console.
create index if not exists idx_tenant_profiles_role
    on public.tenant_profiles(role);
