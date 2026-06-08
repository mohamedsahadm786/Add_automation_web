import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const POLL_INTERVAL_MS = 20_000;
const STALL_TIMEOUT_MS = 45 * 60 * 1000;   // no progress at all -> stalled/failed
const QUIET_COMPLETE_MS = 5 * 60 * 1000;   // progress, then quiet -> assume complete
const COMPLETE_SKEW_MS = 2 * 60 * 1000;    // tolerance matching n8n finish to our run start

// Polls progress of an n8n run and resolves its phase:
//   running   -> rows still appearing (show counts)
//   completed -> n8n wrote a 'completed' status for this run (reliable), OR
//                rows appeared and then went quiet for QUIET_COMPLETE_MS (heuristic)
//   stalled   -> no rows at all for STALL_TIMEOUT_MS (likely failed)
//
// Returns: { counts:{personas,outputs,videos}, lastChangeAt, completed, stalled }.
export function useRunProgress(runStartedAt, tenantId = null) {
    const [counts,       setCounts]       = useState({ personas: 0, outputs: 0, videos: 0 });
    const [lastChangeAt, setLastChangeAt] = useState(null);
    const [completed,    setCompleted]    = useState(false);
    const [stalled,      setStalled]      = useState(false);

    useEffect(() => {
        if (!runStartedAt) {
            setCounts({ personas: 0, outputs: 0, videos: 0 });
            setLastChangeAt(null);
            setCompleted(false);
            setStalled(false);
            return;
        }

        let cancelled  = false;
        let lastSig    = '';
        let lastChange = runStartedAt;
        const startISO = new Date(runStartedAt).toISOString();
        const scoped = (q) => (tenantId ? q.eq('tenant_id', tenantId) : q);

        async function poll() {
            if (cancelled) return;
            try {
                const [pRes, oRes, vRes, statusRes] = await Promise.all([
                    scoped(supabase.from('personas').select('*', { count: 'exact', head: true }).gt('created_at', startISO)),
                    scoped(supabase.from('outputs') .select('*', { count: 'exact', head: true }).gt('created_at', startISO)),
                    scoped(supabase.from('videos')  .select('*', { count: 'exact', head: true }).gt('created_at', startISO)),
                    tenantId
                        ? supabase.from('tenant_run_status').select('status, finished_at').eq('tenant_id', tenantId).maybeSingle()
                        : Promise.resolve({ data: null }),
                ]);
                if (cancelled) return;

                const next = {
                    personas: pRes.count || 0,
                    outputs:  oRes.count || 0,
                    videos:   vRes.count || 0,
                };
                const sig = `${next.personas},${next.outputs},${next.videos}`;
                if (sig !== lastSig) {
                    lastSig = sig;
                    lastChange = Date.now();
                    setCounts(next);
                    setLastChangeAt(lastChange);
                }

                // 1) Reliable: n8n marked this run completed.
                const st = statusRes?.data;
                const markerDone = st?.status === 'completed' && st.finished_at &&
                    new Date(st.finished_at).getTime() >= runStartedAt - COMPLETE_SKEW_MS;

                // 2) Heuristic: produced something, then quiet for a while.
                const progressed = next.personas + next.outputs + next.videos > 0;
                const quiet = Date.now() - lastChange;
                const heuristicDone = progressed && quiet > QUIET_COMPLETE_MS;

                if (markerDone || heuristicDone) {
                    setCompleted(true);
                    setStalled(false);
                } else if (!progressed && quiet > STALL_TIMEOUT_MS) {
                    setStalled(true);
                }
            } catch (err) {
                console.error('[Alluvi] run progress poll failed', err);
                // keep polling; transient failures shouldn't kill the loop
            }
        }

        poll();
        const id = setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [runStartedAt, tenantId]);

    return { counts, lastChangeAt, completed, stalled };
}
