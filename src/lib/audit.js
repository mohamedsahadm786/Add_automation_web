import { supabase } from './supabase.js';

// Record a super-admin action against a tenant. Best-effort: a logging failure
// must never block the action itself.
async function logEvent(tenant, action) {
    try {
        const { error } = await supabase.from('impersonation_events').insert({
            actor: 'super_admin',
            action,
            tenant_id: tenant.tenant_id,
            tenant_name: tenant.name || null,
            tenant_email: tenant.email || null,
        });
        if (error) console.warn('[Alluvi] audit log failed', error);
    } catch (err) {
        console.warn('[Alluvi] audit log threw', err);
    }
}

// Opening a tenant's interface ("Page" / view-as).
export const logImpersonation = (tenant) => logEvent(tenant, 'view_page');

// Lifecycle actions: 'suspend' | 'reactivate' | 'remove'.
export const logTenantAction = (tenant, action) => logEvent(tenant, action);
