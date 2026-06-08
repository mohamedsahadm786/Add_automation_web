import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { TABLE } from '../lib/constants.js';
import { isMissingTableError } from '../lib/utils.js';

const IDENTITY_FIELDS = ['gender', 'age', 'country', 'language'];

function identityChanged(prev, next) {
    if (!prev) return false;
    return IDENTITY_FIELDS.some(k => {
        if (k === 'age') return Number(prev[k]) !== Number(next[k]);
        return (prev[k] ?? '') !== (next[k] ?? '');
    });
}

// Delete every pipeline artifact tied to one tiktok_account, children first
// so foreign keys are respected: videos -> outputs -> personas.
// Used on identity-field edits (next n8n run rebuilds from new identity)
// and on account delete (FK from personas would otherwise reject the delete).
async function cascadeDeleteForAccount(accountId) {
    const { data: personas, error: pErr } = await supabase
        .from('personas')
        .select('id')
        .eq('tiktok_account_id', accountId);
    if (pErr) throw pErr;
    const personaIds = (personas || []).map(p => p.id);
    if (personaIds.length === 0) return;

    const { data: outputs, error: oErr } = await supabase
        .from('outputs')
        .select('id')
        .in('persona_id', personaIds);
    if (oErr) throw oErr;
    const outputIds = (outputs || []).map(o => o.id);

    if (outputIds.length > 0) {
        const { error: vErr } = await supabase
            .from('videos').delete().in('output_id', outputIds);
        if (vErr) throw vErr;

        const { error: dOutErr } = await supabase
            .from('outputs').delete().in('id', outputIds);
        if (dOutErr) throw dOutErr;
    }

    const { error: dPersErr } = await supabase
        .from('personas').delete().in('id', personaIds);
    if (dPersErr) throw dPersErr;
}

// tenantId: null = admin (no filter, sees all rows); a uuid = member (only
// their own rows, and new rows are stamped with it).
export function useAccounts(tenantId = null) {
    const [accounts, setAccounts] = useState([]);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setStatus('loading');
        setError(null);
        let query = supabase
            .from(TABLE)
            .select('*')
            .order('created_at', { ascending: false });
        if (tenantId) query = query.eq('tenant_id', tenantId);
        const { data, error: err } = await query;

        if (err) {
            console.error('[Alluvi] load failed', err);
            setError({ raw: err, missingTable: isMissingTableError(err) });
            setStatus('error');
            return;
        }
        setAccounts(data || []);
        setStatus('ready');
    }, [tenantId]);

    useEffect(() => { load(); }, [load]);

    const create = useCallback(async (payload) => {
        const row = tenantId ? { ...payload, tenant_id: tenantId } : payload;
        const { data, error: err } = await supabase
            .from(TABLE).insert(row).select().single();
        if (err) throw err;
        setAccounts(prev => [data, ...prev]);
        return data;
    }, [tenantId]);

    const update = useCallback(async (id, payload) => {
        const prev = accounts.find(a => a.id === id);
        const cascaded = identityChanged(prev, payload);
        // cascade first: if the row update fails, the next pipeline run
        // simply regenerates from the unchanged identity. Doing it after
        // would leave stale persona/outputs/videos pinned to a new identity.
        if (cascaded) await cascadeDeleteForAccount(id);

        const { data, error: err } = await supabase
            .from(TABLE).update(payload).eq('id', id).select().single();
        if (err) throw err;
        setAccounts(prev => prev.map(a => (a.id === id ? data : a)));
        return { data, cascaded };
    }, [accounts]);

    const remove = useCallback(async (id) => {
        // FK from personas.tiktok_account_id has no ON DELETE CASCADE,
        // so we must clear children before deleting the row.
        await cascadeDeleteForAccount(id);
        const { error: err } = await supabase.from(TABLE).delete().eq('id', id);
        if (err) throw err;
        setAccounts(prev => prev.filter(a => a.id !== id));
    }, []);

    return { accounts, status, error, reload: load, create, update, remove };
}
