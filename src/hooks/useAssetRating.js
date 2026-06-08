import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { RUBRIC_VERSION } from '../lib/ratingConfig.js';

// Load + save the QA rating for one generation (output). One row per output_id
// (upsert). tenant_id is auto-stamped by a DB trigger from the output, so the
// rating is always correctly tenant-scoped.
export function useAssetRating(outputId) {
    const [existing, setExisting] = useState(null);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (!outputId) { setExisting(null); setStatus('ready'); return; }
        setStatus('loading');
        setError(null);
        const { data, error: err } = await supabase
            .from('asset_ratings')
            .select('*')
            .eq('output_id', outputId)
            .maybeSingle();
        if (err) {
            console.error('[Alluvi] rating load failed', err);
            setError(err);
            setStatus('error');
            return;
        }
        setExisting(data || null);
        setStatus('ready');
    }, [outputId]);

    useEffect(() => { load(); }, [load]);

    // draft: { triage, image:{gates,scores,notes}, video:{...} }
    // context: snapshot fields gathered from the row/account.
    const save = useCallback(async (draft, context) => {
        const hasInput = (sec) =>
            Object.values(sec.gates).some(g => g.result) ||
            Object.values(sec.scores).some(v => v != null);

        const row = {
            output_id: context.output_id,
            video_id: context.video_id ?? null,
            persona_id: context.persona_id ?? null,
            tiktok_account_id: context.tiktok_account_id ?? null,
            scenario_id: context.scenario_id ?? null,
            scenario_title: context.scenario_title ?? null,
            image_prompt: context.image_prompt ?? null,
            video_script: context.video_script ?? null,
            image_storage_url: context.image_storage_url ?? null,
            video_storage_url: context.video_storage_url ?? null,
            rater_id: context.rater_id ?? null,
            asset_triage: draft.triage,
            image: draft.image,
            video: draft.video,
            image_rated: Boolean(draft.triage) || hasInput(draft.image),
            video_rated: hasInput(draft.video),
            rubric_version: RUBRIC_VERSION,
            updated_at: new Date().toISOString(),
        };
        const { data, error: err } = await supabase
            .from('asset_ratings')
            .upsert(row, { onConflict: 'output_id' })
            .select()
            .single();
        if (err) throw err;
        setExisting(data);
        return data;
    }, []);

    return { existing, status, error, reload: load, save };
}
