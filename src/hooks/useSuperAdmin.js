import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { computeCost } from '../lib/cost.js';

const maxDate = (a, b) => {
    if (!a) return b || null;
    if (!b) return a;
    return a > b ? a : b; // ISO strings compare lexicographically
};

// Cross-tenant intelligence for the Super Admin console.
//
// n8n only stamps tenant_id on tiktok_accounts (not on personas/outputs/videos),
// so per-tenant numbers are derived by walking the chain:
//   account.tenant_id -> persona.tiktok_account_id -> output.persona_id -> video.output_id
// (an `output` row == one scene image; a `videos` row == one rendered video.)
//
// We pull lean columns for the whole pipeline once and aggregate client-side —
// fine for MVP scale. NOTE: if any table passes ~10k rows, move these
// aggregates into a Postgres view / RPC instead of fetching everything.
export function useSuperAdmin() {
    const [tenants, setTenants] = useState([]);
    const [totals, setTotals] = useState({
        tenants: 0, onboarded: 0, pending: 0, accounts: 0, images: 0, videos: 0, cost: 0,
    });
    const [status, setStatus] = useState('loading'); // 'loading' | 'ready' | 'error'
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setStatus('loading');
        setError(null);
        try {
            const [profilesRes, accountsRes, personasRes, outputsRes, videosRes] = await Promise.all([
                supabase.from('tenant_profiles').select('*'),
                supabase.from('tiktok_accounts').select('id, tenant_id, tiktok_id, name, created_at'),
                supabase.from('personas').select('id, tiktok_account_id, created_at'),
                supabase.from('outputs').select('id, persona_id, qc_status, created_at'),
                supabase.from('videos').select('id, output_id, created_at'),
            ]);
            const err = profilesRes.error || accountsRes.error || personasRes.error
                || outputsRes.error || videosRes.error;
            if (err) throw err;

            const profiles = profilesRes.data || [];
            const accounts = accountsRes.data || [];
            const personas = personasRes.data || [];
            const outputs = outputsRes.data || [];
            const videos = videosRes.data || [];

            // --- account-level rollup -------------------------------------
            const accountInfo = new Map(); // account.id -> {...stats}
            accounts.forEach(a => accountInfo.set(a.id, {
                id: a.id, tiktok_id: a.tiktok_id, name: a.name,
                tenant_id: a.tenant_id, created_at: a.created_at,
                personas: 0, images: 0, videos: 0, qcPass: 0, qcSkip: 0,
                last: a.created_at || null,
            }));

            const personaAccount = new Map(); // persona.id -> account.id
            personas.forEach(p => {
                personaAccount.set(p.id, p.tiktok_account_id);
                const acc = accountInfo.get(p.tiktok_account_id);
                if (acc) { acc.personas += 1; acc.last = maxDate(acc.last, p.created_at); }
            });

            const outputAccount = new Map(); // output.id -> account.id
            outputs.forEach(o => {
                const accId = personaAccount.get(o.persona_id);
                outputAccount.set(o.id, accId);
                const acc = accountInfo.get(accId);
                if (acc) {
                    acc.images += 1;
                    if (o.qc_status === 'pass') acc.qcPass += 1;
                    else if (o.qc_status === 'skipped') acc.qcSkip += 1;
                    acc.last = maxDate(acc.last, o.created_at);
                }
            });

            videos.forEach(v => {
                const accId = outputAccount.get(v.output_id);
                const acc = accountInfo.get(accId);
                if (acc) { acc.videos += 1; acc.last = maxDate(acc.last, v.created_at); }
            });

            // --- tenant-level rollup --------------------------------------
            const tenantAgg = new Map(); // tenant_id -> {...stats, accountList[]}
            const blank = () => ({
                accounts: 0, personas: 0, images: 0, videos: 0, qcPass: 0, qcSkip: 0,
                last: null, accountList: [],
            });
            for (const acc of accountInfo.values()) {
                if (!acc.tenant_id) continue;
                const t = tenantAgg.get(acc.tenant_id) || blank();
                t.accounts += 1;
                t.personas += acc.personas;
                t.images += acc.images;
                t.videos += acc.videos;
                t.qcPass += acc.qcPass;
                t.qcSkip += acc.qcSkip;
                t.last = maxDate(t.last, acc.last);
                t.accountList.push(acc);
                tenantAgg.set(acc.tenant_id, t);
            }

            const rows = profiles.map(p => {
                const t = tenantAgg.get(p.tenant_id) || blank();
                const cost = computeCost({ images: t.images, videos: t.videos });
                const accountList = [...t.accountList].sort(
                    (x, y) => String(y.last || '').localeCompare(String(x.last || '')),
                );
                return {
                    ...p,
                    accounts: t.accounts, personas: t.personas,
                    images: t.images, videos: t.videos,
                    qcPass: t.qcPass, qcSkip: t.qcSkip,
                    lastActivity: t.last, cost, accountList,
                };
            });
            rows.sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')));

            // Removed tenants are tombstoned — exclude them from platform totals.
            const totalsNext = rows.reduce((acc, r) => {
                if ((r.status || 'active') === 'removed') return acc;
                return {
                    tenants: acc.tenants + 1,
                    onboarded: acc.onboarded + (r.onboarded ? 1 : 0),
                    pending: acc.pending + (r.onboarded ? 0 : 1),
                    accounts: acc.accounts + r.accounts,
                    images: acc.images + r.images,
                    videos: acc.videos + r.videos,
                    cost: acc.cost + r.cost,
                };
            }, { tenants: 0, onboarded: 0, pending: 0, accounts: 0, images: 0, videos: 0, cost: 0 });

            setTenants(rows);
            setTotals(totalsNext);
            setStatus('ready');
        } catch (err) {
            console.error('[Alluvi] super-admin load failed', err);
            setError(err);
            setStatus('error');
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return { tenants, totals, status, error, reload: load };
}
