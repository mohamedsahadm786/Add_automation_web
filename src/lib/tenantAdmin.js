import { supabase } from './supabase.js';

// Super-admin tenant lifecycle control. status: 'active' | 'suspended' | 'removed'.
// "removed" is a reversible tombstone — data is retained for audit and can be
// restored by reactivating (a true hard-delete/purge is a separate later step).
export async function setTenantStatus(tenantId, status) {
    const { error } = await supabase
        .from('tenant_profiles')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId);
    if (error) throw error;
}
