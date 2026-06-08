# Drive → Supabase Storage cutover (n8n + app)

> Google Drive is being **removed entirely** from the pipeline. Every generated
> asset now lives in **Supabase Storage**, and its public URL is written to the
> DB. Generation context (persona portrait, scene image, reference images) is
> read from Storage URLs in the DB, **not from Drive**. This doc is the contract
> for the n8n rebuild + what changed in the app.
>
> Run `supabase/drive_to_storage_migration.sql` first.

---

## 1. The single rule

**Bytes → Supabase Storage. URL → the DB row. No Drive, ever.**

| Asset | Phase | Upload to bucket | Suggested object path | Write URL to column |
|---|---|---|---|---|
| Persona portrait | A | `personas` | `<persona_id>.png` | `personas.portrait_storage_url` |
| Scene image | B | `images` | `<output_id>.png` | `outputs.image_storage_url` |
| Video (mp4) | C | `videos` | `<video_id>.mp4` | `videos.storage_url` |
| Reference images | onboarding | `tenant-images` | `<tenant>/<file>` | `tenant_images.storage_url` |

All four buckets are **public** (world-readable by URL) so native `<img>`/`<video>`
in the hosted site can stream them. The migration creates the `personas` bucket;
the others already exist.

> `personas.portrait_storage_url` is the **new** column added by the migration.
> `outputs.image_storage_url`, `videos.storage_url`, `tenant_images.storage_url`
> already existed (they were the old "mirror" columns — now they're primary).

---

## 2. How n8n uploads to Supabase Storage

Use the Storage REST endpoint with the **service-role key** (server-side only —
never the publishable key):

```
POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}
Headers:
  Authorization: Bearer {SERVICE_ROLE_KEY}
  Content-Type:  image/png   (or video/mp4)
  x-upsert:      true
Body: <raw bytes>
```

Public URL to store in the DB (deterministic — build it, no extra call):

```
{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}
```

So after uploading a video to `videos/42.mp4`, write
`videos.storage_url = {SUPABASE_URL}/storage/v1/object/public/videos/42.mp4`.

> The `SUPABASE_SERVICE_ROLE_KEY` must live in n8n credentials / Supabase secret
> store — **not** in any frontend bundle.

---

## 3. Where n8n now READS context (was Drive)

| Generation step | Old source (Drive) | New source (Supabase / DB) |
|---|---|---|
| Scene image (B) needs the persona portrait | persona Drive file | `personas.portrait_storage_url` (public URL — fetch bytes or pass URL to the model) |
| Video (C) needs the scene image | output Drive file | `outputs.image_storage_url` |
| Any step needing reference images | Drive folder | `tenant_images.storage_url` (already in Storage) |
| Prompts / scripts / briefings | (mixed) | DB: `outputs.prompt_used`, `videos.prompt_used`/`dialogue`, `tenant_profiles.product_briefing`/`company_briefing` |

Net effect: **no Drive node anywhere** in the workflow — not for upload, not for
download, not for context.

---

## 4. What n8n must change (checklist)

1. **Stop all Drive uploads/downloads.** Remove every Google Drive node.
2. **Phase A — Record Persona:** upload portrait to bucket `personas`, write
   `personas.portrait_storage_url`. (Leave `drive_*` null.)
3. **Phase B — Record Output:** upload scene image to bucket `images`, write
   `outputs.image_storage_url` **and** `outputs.prompt_used` (the image prompt).
4. **Phase C — Record Video:** upload mp4 to bucket `videos`, write
   `videos.storage_url`.
5. **Read context** from the `*_storage_url` columns above instead of Drive.
6. Keep writing everything else exactly as before — `tenant_id` is still
   auto-stamped by the DB triggers (see `read/db_for_n8n.md` §9); don't set it.

---

## 5. What changed in the app (this repo)

- **Removed** `src/lib/drive.js` (Drive URL builders + Drive download).
- **Added** `src/lib/assets.js` — just `downloadAsset(url, filename)` for
  downloading Storage URLs.
- **Publishing + Rating** now display **only** from `*_storage_url` (native
  `<img>`/`<video>`); the Drive thumbnail endpoint and the Drive `/preview`
  iframe are gone. Downloads pull the Storage file.
- **Legacy bridge:** rows created before cutover that still have only a Drive id
  are backfilled once, on view, via the existing `mirror-image` / `mirror-video`
  Edge Functions (they read Drive server-side, copy to Storage, and write the
  URL). After backfill they're Drive-independent. New rows always have a Storage
  URL, so this never fires for them.

---

## 6. One-time backfill of existing data (optional)

To pull every legacy Drive asset into Storage up front (so Drive can be fully
decommissioned), invoke the mirror functions for each row still missing a
Storage URL. Find them with:

```sql
select 'outputs' t, id from public.outputs where image_storage_url is null
union all
select 'videos',  id from public.videos  where storage_url is null;
```

Then `POST` each id to `mirror-image` (outputs) / `mirror-video` (videos).
(Persona portraits had no prior mirror function; if old portraits must be
migrated, add a `mirror-persona` function mirroring `mirror-image` against the
`personas` bucket / `personas.portrait_storage_url`, or just let the next run
regenerate them.)

Once every row has a Storage URL, Google Drive has **zero** runtime role and can
be disconnected.

---

*Pairs with `read/db_for_n8n.md` (full schema + tenant contract) and
`supabase/drive_to_storage_migration.sql`.*
