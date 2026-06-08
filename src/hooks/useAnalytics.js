import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Pulls the whole pipeline (lean columns) so the analytics panel can compute
// every breakdown client-side. We skip large text fields (prompt_used,
// dialogue) since none of them feed a metric. Fine for MVP scale; if a
// table ever passes ~10k rows, move the aggregates into a Postgres view.
// tenantId: null = admin (whole pipeline). A uuid = member; since n8n doesn't
// stamp tenant_id on personas/outputs/videos, we scope by walking the chain
// from the tenant's own accounts.
export function useAnalytics(tenantId = null) {
    const [data, setData] = useState({ accounts: [], personas: [], outputs: [], videos: [] });
    const [status, setStatus] = useState('loading');   // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const loadAll = useCallback(async () => {
        const [accountsRes, personasRes, outputsRes, videosRes] = await Promise.all([
            supabase.from('tiktok_accounts')
                .select('id, tiktok_id, name, gender, age, country, language, created_at'),
            supabase.from('personas').select('id, tiktok_account_id, created_at'),
            supabase.from('outputs')
                .select('id, persona_id, scenario_id, scenario_title, qc_status, qc_reason, attempts, created_at'),
            supabase.from('videos')
                .select('id, output_id, scenario_id, drive_file_id, drive_url, created_at'),
        ]);
        const err = accountsRes.error || personasRes.error || outputsRes.error || videosRes.error;
        if (err) throw err;
        return {
            accounts: accountsRes.data || [],
            personas: personasRes.data || [],
            outputs:  outputsRes.data  || [],
            videos:   videosRes.data   || [],
        };
    }, []);

    // Every pipeline table now carries tenant_id (kept correct by DB triggers),
    // so we filter each table directly instead of walking the chain.
    const loadForTenant = useCallback(async (tid) => {
        const [accountsRes, personasRes, outputsRes, videosRes] = await Promise.all([
            supabase.from('tiktok_accounts')
                .select('id, tiktok_id, name, gender, age, country, language, created_at')
                .eq('tenant_id', tid),
            supabase.from('personas')
                .select('id, tiktok_account_id, created_at')
                .eq('tenant_id', tid),
            supabase.from('outputs')
                .select('id, persona_id, scenario_id, scenario_title, qc_status, qc_reason, attempts, created_at')
                .eq('tenant_id', tid),
            supabase.from('videos')
                .select('id, output_id, scenario_id, drive_file_id, drive_url, created_at')
                .eq('tenant_id', tid),
        ]);
        const err = accountsRes.error || personasRes.error || outputsRes.error || videosRes.error;
        if (err) throw err;
        return {
            accounts: accountsRes.data || [],
            personas: personasRes.data || [],
            outputs:  outputsRes.data  || [],
            videos:   videosRes.data   || [],
        };
    }, []);

    const load = useCallback(async () => {
        setStatus('loading');
        setError(null);
        try {
            const next = tenantId ? await loadForTenant(tenantId) : await loadAll();
            setData(next);
            setStatus('ready');
        } catch (err) {
            console.error('[Alluvi] analytics load failed', err);
            setError(err);
            setStatus('error');
        }
    }, [tenantId, loadAll, loadForTenant]);

    useEffect(() => { load(); }, [load]);

    return { data, status, error, reload: load };
}
