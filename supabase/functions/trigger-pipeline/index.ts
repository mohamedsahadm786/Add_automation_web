// Supabase Edge Function: trigger-pipeline
// ------------------------------------------------------------------
// Proxies the browser's "Run pipeline" click to the n8n production
// webhook. The n8n Basic-Auth credentials live in Supabase secrets
// (N8N_WEBHOOK_URL / N8N_WEBHOOK_USER / N8N_WEBHOOK_PASS) so they
// never ship to the browser.
//
// Always responds 200 to the browser; the n8n outcome is in the JSON
// body as {ok, status, body}. This keeps supabase-js's invoke()
// happy and lets the frontend branch on the real upstream status.

// CORS — allow any origin for now; abuse prevention sits on n8n's
// rate limits and (later) JWT-gating the function. If you want to
// lock it down to your prod origin, replace '*' with that origin.
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
};

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
    });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method !== 'POST') {
        return json(405, { ok: false, error: 'method_not_allowed' });
    }

    const url  = Deno.env.get('N8N_WEBHOOK_URL');
    const user = Deno.env.get('N8N_WEBHOOK_USER');
    const pass = Deno.env.get('N8N_WEBHOOK_PASS');
    if (!url || !user || !pass) {
        return json(200, { ok: false, status: 0, error: 'missing_secrets' });
    }

    const auth = btoa(`${user}:${pass}`);

    // Forward the tenant_id from the browser so n8n knows which tenant the run is
    // for. The frontend sends { tenant_id: "<uuid>" }; we relay it at the top
    // level. If it's missing we relay {} (so n8n fails the run with a clear
    // "no tenant" message rather than running against the wrong data).
    let tenantId: string | undefined;
    try {
        const inBody = await req.json();
        if (inBody && typeof inBody.tenant_id === 'string') tenantId = inBody.tenant_id;
    } catch { /* no / non-JSON body — relay {} */ }
    const forwardBody = tenantId ? JSON.stringify({ tenant_id: tenantId }) : '{}';

    try {
        const upstream = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type':  'application/json',
            },
            body: forwardBody,
        });

        const text = await upstream.text();
        let body: unknown = text;
        try { body = JSON.parse(text); } catch { /* keep as text */ }

        return json(200, {
            ok: upstream.ok,
            status: upstream.status,
            body,
        });
    } catch (err) {
        return json(200, {
            ok: false,
            status: 0,
            error: 'network_error',
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
