import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Recent impersonation events for the Activity view.
export function useAuditLog(limit = 100) {
    const [events, setEvents] = useState([]);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setStatus('loading');
        setError(null);
        const { data, error: err } = await supabase
            .from('impersonation_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (err) {
            console.error('[Alluvi] audit log load failed', err);
            setError(err);
            setStatus('error');
            return;
        }
        setEvents(data || []);
        setStatus('ready');
    }, [limit]);

    useEffect(() => { load(); }, [load]);

    return { events, status, error, reload: load };
}
