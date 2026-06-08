import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const RUN_KEY = 'alluvi.runStartedAt';

function readPersistedRun() {
    try {
        const raw = sessionStorage.getItem(RUN_KEY);
        if (!raw) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

// Triggers the n8n pipeline via the Supabase Edge Function (which holds
// the basic-auth credentials). On confirmed success, persists the run's
// start timestamp to sessionStorage so progress polling survives refresh.
export function usePipelineRun(tenantId = null) {
    const [running, setRunning]           = useState(false);
    const [runStartedAt, setRunStartedAt] = useState(readPersistedRun);

    const run = useCallback(async () => {
        if (running) return { ok: false, alreadyRunning: true };
        setRunning(true);
        try {
            // Send the tenant_id so the Edge Function can forward it to n8n
            // (one run = one tenant). Omitted only for the admin/global path.
            const { data, error } = await supabase.functions.invoke('trigger-pipeline', {
                method: 'POST',
                body: tenantId ? { tenant_id: tenantId } : {},
            });

            if (error) {
                console.error('[Alluvi] trigger function unreachable', error);
                return { ok: false, error: 'function_unreachable', message: error.message };
            }
            if (data?.ok) {
                const t = Date.now();
                try { sessionStorage.setItem(RUN_KEY, String(t)); } catch { /* noop */ }
                setRunStartedAt(t);
                return { ok: true, status: data.status, body: data.body };
            }

            const status = data?.status ?? 0;
            if (status === 401 || status === 403) return { ok: false, status, error: 'auth_failed' };
            if (status === 404)                   return { ok: false, status, error: 'not_found' };
            if (status === 0)                     return { ok: false, status, error: 'network',  message: data?.message };
            return { ok: false, status, error: 'unknown', body: data?.body };
        } catch (err) {
            console.error('[Alluvi] trigger crashed', err);
            return { ok: false, error: 'unknown', message: err.message };
        } finally {
            setRunning(false);
        }
    }, [running, tenantId]);

    const clearRun = useCallback(() => {
        try { sessionStorage.removeItem(RUN_KEY); } catch { /* noop */ }
        setRunStartedAt(null);
    }, []);

    return { running, run, runStartedAt, clearRun };
}
