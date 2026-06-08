import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Per-tenant settings. Keys live on the tenant's own tenant_profiles row — NOT
// the global app_settings table — so one tenant can never see or overwrite
// another's keys. The field `key` is the tenant_profiles column name.
export const SETTING_FIELDS = [
    { key: 'fal_api_key',       label: 'Fal API Key',              placeholder: 'fal-…',    secret: true },
    { key: 'anthropic_api_key', label: 'Anthropic Claude API Key', placeholder: 'sk-ant-…', secret: true },
];

export function useSettings(tenantId) {
    const [values, setValues] = useState({}); // { column: value }
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!tenantId) {
            setValues({});
            setStatus('ready');
            return;
        }
        setStatus('loading');
        setError(null);
        const { data, error: err } = await supabase
            .from('tenant_profiles')
            .select(SETTING_FIELDS.map(f => f.key).join(', '))
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (err) {
            console.error('[Alluvi] settings load failed', err);
            setError({ raw: err });
            setStatus('error');
            return;
        }
        const map = {};
        SETTING_FIELDS.forEach(f => { map[f.key] = data?.[f.key] ?? ''; });
        setValues(map);
        setStatus('ready');
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    // Persist the tenant's keys. Empty strings are stored as NULL.
    const save = useCallback(async (next) => {
        if (!tenantId) throw new Error('No tenant context.');
        const patch = { updated_at: new Date().toISOString() };
        SETTING_FIELDS.forEach(f => { patch[f.key] = (next[f.key] ?? '').trim() || null; });
        const { error: err } = await supabase
            .from('tenant_profiles')
            .update(patch)
            .eq('tenant_id', tenantId);
        if (err) throw err;
        const map = {};
        SETTING_FIELDS.forEach(f => { map[f.key] = patch[f.key] ?? ''; });
        setValues(map);
    }, [tenantId]);

    return { values, status, error, reload: load, save };
}
