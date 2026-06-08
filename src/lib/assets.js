// Asset URLs — the single place that knows where bytes live.
//
// Google Drive has been removed. The pipeline now uploads every generated asset
// (persona portrait, scene image, video) straight into Supabase Storage and
// records the public URL on the row (*_storage_url columns). The frontend reads
// those URLs directly via native <img>/<video>. Nothing here touches Drive.
//
// Legacy rows created before the cutover may still lack a Storage URL; the
// Publishing UI backfills those once via the mirror-image / mirror-video Edge
// Functions (server-side), then serves the Storage copy. New rows never need it.

// Download a public asset (a Supabase Storage URL) as a file.
export function downloadAsset(url, filename) {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    if (filename) a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
}
