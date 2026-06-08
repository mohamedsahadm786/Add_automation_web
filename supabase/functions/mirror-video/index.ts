// Supabase Edge Function: mirror-video
// ------------------------------------------------------------------
// Copies one video's MP4 from Google Drive into Supabase Storage
// (bucket `videos`) and records the public URL in videos.storage_url.
//
// Called by the frontend on first play. Idempotent: if the row already
// has a storage_url, it returns it without re-downloading.
//
// Input  (POST JSON): { id: <videos.id> }
// Output (200 JSON):  { ok: true, storage_url } | { ok: false, error }
//
// Uses the auto-injected SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, so it
// bypasses RLS for the read/update and the storage upload. No extra
// secrets to set.

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

const BUCKET = 'videos';

// Download a public Drive file. For large files Drive serves an HTML
// "can't scan for viruses" interstitial instead of the bytes; we hit the
// usercontent host with confirm=t, and if we still get HTML we parse the
// confirm form and follow it.
async function fetchDriveFile(fileId: string): Promise<Response> {
    const direct = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    let res = await fetch(direct);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return res;

    // Interstitial — parse the form and resubmit.
    const html = await res.text();
    const action = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    if (!action) return res; // give up; caller will detect non-video content
    const params = new URLSearchParams();
    for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)) {
        params.set(m[1], m[2]);
    }
    const sep = action.includes('?') ? '&' : '?';
    res = await fetch(`${action}${sep}${params.toString()}`);
    return res;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return json(200, { ok: false, error: 'missing_env' });
    }

    let id: number | string | undefined;
    try {
        ({ id } = await req.json());
    } catch {
        return json(200, { ok: false, error: 'bad_request' });
    }
    if (id === undefined || id === null) {
        return json(200, { ok: false, error: 'missing_id' });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Look up the video row.
    const { data: row, error: rowErr } = await admin
        .from('videos')
        .select('id, drive_file_id, drive_url, storage_url')
        .eq('id', id)
        .single();

    if (rowErr || !row) {
        return json(200, { ok: false, error: 'video_not_found' });
    }
    if (row.storage_url) {
        return json(200, { ok: true, storage_url: row.storage_url, cached: true });
    }

    const fileId = row.drive_file_id
        || (row.drive_url?.match(/[-\w]{25,}/)?.[0]); // pull id from a Drive URL if needed
    if (!fileId) {
        return json(200, { ok: false, error: 'no_drive_file_id' });
    }

    // Download from Drive.
    let bytes: Uint8Array;
    let contentType = 'video/mp4';
    try {
        const dl = await fetchDriveFile(fileId);
        if (!dl.ok) return json(200, { ok: false, error: 'drive_download_failed', status: dl.status });
        const ct = dl.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
            return json(200, { ok: false, error: 'drive_interstitial' });
        }
        if (ct) contentType = ct.split(';')[0].trim();
        bytes = new Uint8Array(await dl.arrayBuffer());
    } catch (err) {
        return json(200, { ok: false, error: 'drive_fetch_error', message: String(err) });
    }

    // Upload to Supabase Storage.
    const ext = contentType.includes('webm') ? 'webm' : 'mp4';
    const path = `${row.id}.${ext}`;
    const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
    if (upErr) {
        return json(200, { ok: false, error: 'storage_upload_failed', message: upErr.message });
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const storage_url = pub?.publicUrl;
    if (!storage_url) {
        return json(200, { ok: false, error: 'no_public_url' });
    }

    // Record the URL so next time is instant.
    const { error: updErr } = await admin
        .from('videos')
        .update({ storage_url })
        .eq('id', row.id);
    if (updErr) {
        // The file is uploaded; just couldn't save the pointer. Still usable now.
        return json(200, { ok: true, storage_url, warning: 'row_update_failed' });
    }

    return json(200, { ok: true, storage_url });
});
