import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Per-tenant run-control config (was hardcoded in n8n; now in the DB).
// Required fields (must be set before a run can start):
//   max_videos_per_run, max_qc_attempts, video_duration, video_resolution
// Optional: one_per_persona (false if unset), tiktok_id (targeting override).
const EMPTY = {
    one_per_persona: false,
    tiktok_id: '',
    max_videos_per_run: '',
    max_qc_attempts: '',
    video_duration: '',
    video_resolution: '',
};

export function isRunConfigComplete(c) {
    if (!c) return false;
    return Number(c.max_videos_per_run) >= 1
        && Number(c.max_qc_attempts) >= 1
        && Boolean(c.video_duration)
        && Boolean(c.video_resolution);
}

export function useRunConfig(tenantId) {
    const [config, setConfig] = useState(EMPTY);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!tenantId) {
            setConfig(EMPTY);
            setStatus('ready');
            return;
        }
        setStatus('loading');
        setError(null);
        const { data, error: err } = await supabase
            .from('tenant_run_configs')
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle();
        if (err) {
            console.error('[Alluvi] run config load failed', err);
            setError(err);
            setStatus('error');
            return;
        }
        setConfig(data ? { ...EMPTY, ...data } : { ...EMPTY });
        setStatus('ready');
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    // Upsert the tenant's row. Numbers are coerced; empty strings -> null.
    const save = useCallback(async (draft) => {
        if (!tenantId) throw new Error('No tenant context.');
        const row = {
            tenant_id: tenantId,
            one_per_persona: Boolean(draft.one_per_persona),
            tiktok_id: draft.tiktok_id?.trim() || null,
            max_videos_per_run: draft.max_videos_per_run === '' ? null : Number(draft.max_videos_per_run),
            max_qc_attempts: draft.max_qc_attempts === '' ? null : Number(draft.max_qc_attempts),
            video_duration: draft.video_duration || null,
            video_resolution: draft.video_resolution || null,
            updated_at: new Date().toISOString(),
        };
        const { data, error: err } = await supabase
            .from('tenant_run_configs')
            .upsert(row, { onConflict: 'tenant_id' })
            .select()
            .single();
        if (err) throw err;
        setConfig({ ...EMPTY, ...data });
        return data;
    }, [tenantId]);

    return { config, status, error, isComplete: isRunConfigComplete(config), reload: load, save };
}
