import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Fetch every (scene image + optional video) pair for one tiktok account,
// ordered latest-first by the scene image's created_at.
//
// Two-step query (clearer than a single nested filter, and works with
// the relationship graph as it is): get the persona for the account,
// then its outputs with nested videos.
export function usePublishingForAccount(accountId, tenantId = null) {
    const [rows, setRows] = useState([]);
    const [status, setStatus] = useState('idle');   // 'idle' | 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!accountId) {
            setRows([]);
            setStatus('idle');
            return;
        }
        setStatus('loading');
        setError(null);

        let personaQuery = supabase
            .from('personas')
            .select('id')
            .eq('tiktok_account_id', accountId);
        if (tenantId) personaQuery = personaQuery.eq('tenant_id', tenantId); // defense-in-depth
        const { data: persona, error: pErr } = await personaQuery.maybeSingle();

        if (pErr) {
            console.error('[Alluvi] publishing: persona lookup failed', pErr);
            setError(pErr);
            setStatus('error');
            return;
        }
        if (!persona) {
            setRows([]);
            setStatus('ready');
            return;
        }

        let outputsQuery = supabase
            .from('outputs')
            .select(`
                id, created_at, scenario_id, scenario_title, persona_id, prompt_used,
                drive_file_id, drive_url, qc_status, image_storage_url,
                videos ( id, drive_file_id, drive_url, storage_url, created_at, prompt_used, dialogue )
            `)
            .eq('persona_id', persona.id);
        if (tenantId) outputsQuery = outputsQuery.eq('tenant_id', tenantId); // defense-in-depth
        const { data: outputs, error: oErr } = await outputsQuery
            .order('created_at', { ascending: false });

        if (oErr) {
            console.error('[Alluvi] publishing: outputs load failed', oErr);
            setError(oErr);
            setStatus('error');
            return;
        }

        const flat = (outputs || []).map(o => ({
            id: o.id,
            persona_id: o.persona_id,
            image_prompt: o.prompt_used || null,
            created_at: o.created_at,
            scenario_id: o.scenario_id,
            scenario_title: o.scenario_title,
            qc_status: o.qc_status,
            image_file_id: o.drive_file_id,
            image_url: o.drive_url,
            image_storage_url: o.image_storage_url,
            video: Array.isArray(o.videos) ? o.videos[0] : o.videos,
        }));
        setRows(flat);
        setStatus('ready');
    }, [accountId]);

    useEffect(() => { load(); }, [load]);

    // Mirror one video from Drive into Supabase Storage on first play.
    // Returns the native storage_url and patches it into local state so the
    // next open is instant. Throws on failure so the caller can fall back.
    const mirrorVideo = useCallback(async (rowId, videoId) => {
        const { data, error: fnErr } = await supabase.functions.invoke('mirror-video', {
            body: { id: videoId },
        });
        if (fnErr) throw fnErr;
        if (!data?.ok || !data?.storage_url) {
            throw new Error(data?.error || 'mirror_failed');
        }
        setRows(rs => rs.map(r => (
            r.id === rowId
                ? { ...r, video: { ...(r.video || {}), storage_url: data.storage_url } }
                : r
        )));
        return data.storage_url;
    }, []);

    // Mirror one scene image from Drive into Supabase Storage. Called to
    // self-heal a thumbnail when Drive's thumbnail endpoint fails to load.
    const mirrorImage = useCallback(async (rowId) => {
        const { data, error: fnErr } = await supabase.functions.invoke('mirror-image', {
            body: { id: rowId },
        });
        if (fnErr) throw fnErr;
        if (!data?.ok || !data?.storage_url) {
            throw new Error(data?.error || 'mirror_failed');
        }
        setRows(rs => rs.map(r => (
            r.id === rowId ? { ...r, image_storage_url: data.storage_url } : r
        )));
        return data.storage_url;
    }, []);

    return { rows, status, error, reload: load, mirrorVideo, mirrorImage };
}
