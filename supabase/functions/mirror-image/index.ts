// Supabase Edge Function: mirror-image
// ------------------------------------------------------------------
// Copies one output's scene image from Google Drive into Supabase
// Storage (bucket `images`) and records the public URL in
// outputs.image_storage_url. Used to self-heal card thumbnails when
// Drive's thumbnail endpoint throttles.
//
// Input  (POST JSON): { id: <outputs.id> }
// Output (200 JSON):  { ok: true, storage_url } | { ok: false, error }
//
// Mirror of mirror-video, against the `outputs` table / `images` bucket.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

const BUCKET = 'images';

async function fetchDriveFile(fileId: string): Promise<Response> {
    const direct = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    let res = await fetch(direct);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;

    const html = await res.text();
    const action = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    if (!action) return res;
    const params = new URLSearchParams();
    for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)) {
        params.set(m[1], m[2]);
    }
    const sep = action.includes('?') ? '&' : '?';
    res = await fetch(`${action}${sep}${params.toString()}`);
    return res;
}

function extFor(contentType: string): string {
    if (contentType.includes('png')) return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif')) return 'gif';
    return 'jpg';
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY) return json(200, { ok: false, error: 'missing_env' });

    let id: number | string | undefined;
    try {
        ({ id } = await req.json());
    } catch {
        return json(200, { ok: false, error: 'bad_request' });
    }
    if (id === undefined || id === null) return json(200, { ok: false, error: 'missing_id' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: row, error: rowErr } = await admin
        .from('outputs')
        .select('id, drive_file_id, drive_url, image_storage_url')
        .eq('id', id)
        .single();

    if (rowErr || !row) return json(200, { ok: false, error: 'output_not_found' });
    if (row.image_storage_url) {
        return json(200, { ok: true, storage_url: row.image_storage_url, cached: true });
    }

    const fileId = row.drive_file_id || (row.drive_url?.match(/[-\w]{25,}/)?.[0]);
    if (!fileId) return json(200, { ok: false, error: 'no_drive_file_id' });

    let bytes: Uint8Array;
    let contentType = 'image/jpeg';
    try {
        const dl = await fetchDriveFile(fileId);
        if (!dl.ok) return json(200, { ok: false, error: 'drive_download_failed', status: dl.status });
        const ct = dl.headers.get('content-type') || '';
        if (ct.includes('text/html')) return json(200, { ok: false, error: 'drive_interstitial' });
        if (ct) contentType = ct.split(';')[0].trim();
        bytes = new Uint8Array(await dl.arrayBuffer());
    } catch (err) {
        return json(200, { ok: false, error: 'drive_fetch_error', message: String(err) });
    }

    const path = `${row.id}.${extFor(contentType)}`;
    const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
    if (upErr) return json(200, { ok: false, error: 'storage_upload_failed', message: upErr.message });

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const storage_url = pub?.publicUrl;
    if (!storage_url) return json(200, { ok: false, error: 'no_public_url' });

    const { error: updErr } = await admin
        .from('outputs')
        .update({ image_storage_url: storage_url })
        .eq('id', row.id);
    if (updErr) return json(200, { ok: true, storage_url, warning: 'row_update_failed' });

    return json(200, { ok: true, storage_url });
});
