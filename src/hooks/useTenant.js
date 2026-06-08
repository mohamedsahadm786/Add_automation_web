import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Resolves the current tenant context.
//   • admin  → tenantId null, onboarded true (no setup, no filtering)
//   • member → tenantId = auth uid; loads/creates their tenant_profiles row;
//              onboarded reflects whether they've completed the setup page.
export function useTenant(user) {
    const isAdmin = user?.kind === 'admin';
    const tenantId = user?.kind === 'member' ? user.id : null;

    const [profile, setProfile] = useState(null);
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        if (isAdmin || !tenantId) {
            setProfile(null);
            setStatus('ready');
            return;
        }
        setStatus('loading');
        setError(null);

        const { data: row, error: selErr } = await supabase
            .from('tenant_profiles')
            .select('*')
            .eq('tenant_id', tenantId)
            .maybeSingle();

        if (selErr) {
            console.error('[Alluvi] tenant load failed', selErr);
            setError(selErr);
            setStatus('error');
            return;
        }

        if (row) {
            setProfile(row);
            setStatus('ready');
            return;
        }

        // First sign-in for this member — create their profile stub.
        const { data: created, error: insErr } = await supabase
            .from('tenant_profiles')
            .insert({ tenant_id: tenantId, name: user.name, email: user.email, onboarded: false })
            .select()
            .single();
        if (insErr) {
            console.error('[Alluvi] tenant create failed', insErr);
            setError(insErr);
            setStatus('error');
            return;
        }
        setProfile(created);
        setStatus('ready');
    }, [isAdmin, tenantId, user?.name, user?.email]);

    useEffect(() => { load(); }, [load]);

    // Save the setup page: upload images, then persist keys/briefings + flip
    // onboarded to true.
    const saveSetup = useCallback(async ({ falApiKey, anthropicApiKey, productBriefing, companyBriefing }, files) => {
        if (!tenantId) throw new Error('No tenant context.');

        // 1) upload any selected images
        for (const file of files || []) {
            const safe = file.name.replace(/[^\w.\-]+/g, '_');
            const path = `${tenantId}/${Date.now()}-${safe}`;
            const { error: upErr } = await supabase.storage
                .from('tenant-images')
                .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
            if (upErr) throw upErr;
            const { data: pub } = supabase.storage.from('tenant-images').getPublicUrl(path);
            const { error: rowErr } = await supabase
                .from('tenant_images')
                .insert({ tenant_id: tenantId, storage_url: pub.publicUrl, file_name: file.name });
            if (rowErr) throw rowErr;
        }

        // 2) persist config + mark onboarded
        const { data, error: updErr } = await supabase
            .from('tenant_profiles')
            .update({
                fal_api_key: falApiKey?.trim() || null,
                anthropic_api_key: anthropicApiKey?.trim() || null,
                product_briefing: productBriefing?.trim() || null,
                company_briefing: companyBriefing?.trim() || null,
                onboarded: true,
                updated_at: new Date().toISOString(),
            })
            .eq('tenant_id', tenantId)
            .select()
            .single();
        if (updErr) throw updErr;
        setProfile(data);
    }, [tenantId]);

    const onboarded = isAdmin || Boolean(profile?.onboarded);

    return { tenantId, isAdmin, onboarded, profile, status, error, reload: load, saveSetup };
}
