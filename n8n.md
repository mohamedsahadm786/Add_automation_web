# n8n restructure — instructions for later

> Everything to change in the n8n workflow so it works with the new multitenant
> web app + DB. The web side is already built and waiting for these. Nothing here
> is urgent for dev (Run isn't wired in dev); do it as part of the production
> cutover (`task_pending.md §5/§9b`).
>
> Golden rule: n8n keeps using the **service-role key** → it bypasses RLS and the
> `tenant_id` triggers fill child tables automatically. So most of n8n is
> unchanged; the changes below are about (1) per-tenant config, (2) knowing which
> tenant a run is for, (3) storing the image prompt, and (4) reporting run status.
>
> ⚠️ **Two big shifts added in the latest session (§9–§11) — read those too:**
> 1. **Google Drive is REMOVED.** Assets now upload to **Supabase Storage** (URL
>    saved on the row) and generation **context** comes from the **DB**, not Drive.
> 2. **Scenarios + a learning layer** now live in the DB: scene recipes come from
>    `public.scenarios` (not a Drive file), and an **exploration→active gate**
>    governs whether the run is plain coverage or engine-driven. (§9, §10, §11.)

---

## 0. Connection (unchanged)
- Keep n8n pointed at the **LIVE** Supabase project (`hgmvgnsvxlzcylfwttlc`) with the
  **service-role secret**. Do NOT point it at dev.
- Service-role bypasses RLS; the DB triggers auto-stamp `tenant_id` on
  `personas / outputs / videos / tiktok_auth / tiktok_posts`, so your existing
  insert nodes need **no change** for tenancy.

## 1. Receive the tenant_id for the run
The web triggers a run via the `trigger-pipeline` Edge Function. That function must
forward a **`tenant_id`** in the webhook body (today it sends `{}` — see
`task_pending §5`). In n8n:
- [ ] Read `tenant_id` from the incoming webhook payload.
- [ ] Use it for every per-tenant lookup below. One run processes **one tenant**.

## 2. Read run control from the DB (remove hardcoded CONFIG)
The settings that were hardcoded in the CONFIG code block now live in
`public.tenant_run_configs` (one row per tenant).
- [ ] **Delete** these from the hardcoded CONFIG: `ONE_PER_PERSONA`, `TIKTOK_ID`,
      `MAX_VIDEOS_PER_RUN`, `MAX_QC_ATTEMPTS`, `VIDEO_DURATION`, `VIDEO_RESOLUTION`.
- [ ] Add a Postgres/Supabase node early in the flow:
      `select one_per_persona, tiktok_id, max_videos_per_run, max_qc_attempts,
              video_duration, video_resolution
         from public.tenant_run_configs where tenant_id = '{{tenant_id}}';`
- [ ] Feed those values into the same places the CONFIG constants were used.
- [ ] `tiktok_id` may be NULL (process all) or a comma-separated list (targeting).

## 2b. Read the API keys from the DB (remove hardcoded keys)
The Fal and Claude keys are no longer hardcoded — each tenant stores their own
during onboarding (and can change them in Settings). They live in
`public.tenant_profiles.fal_api_key` and `public.tenant_profiles.anthropic_api_key`.
- [ ] **Delete** `FAL_KEY` and `ANTHROPIC_KEY` from the hardcoded CONFIG block.
- [ ] In the same per-tenant lookup, also read the keys:
      `select fal_api_key, anthropic_api_key
         from public.tenant_profiles where tenant_id = '{{tenant_id}}';`
      (can be one combined query with §2 if you prefer.)
- [ ] Use `fal_api_key` for every Fal API call and `anthropic_api_key` for every
      Claude/Anthropic call, **per tenant** — so each tenant's runs use their own keys.
- [ ] Handle the empty case: if a key is NULL, fail the run early with a clear
      message (and set `tenant_run_status.status='failed'`, see §4) rather than
      calling the API with a blank key.
- [ ] `APIFY_TOKEN` (and any other shared infra keys) can stay in n8n config/secrets
      if they're platform-wide, not per-tenant — your call.

## 3. Store the scene-image prompt
The web rating feature snapshots the image prompt from `outputs.prompt_used`
(parallel to the video script in `videos.prompt_used`). That column exists but is
empty until n8n fills it.
- [ ] In the node that records each output (`B: Record Output`), also write the
      image generation prompt into `outputs.prompt_used`.

## 4. Report run status (so the web pill can show "Pipeline complete")
The web can't tell when a run finishes — it polls row counts. Update
`public.tenant_run_status` (one row per tenant) so the pill is accurate.
- [ ] **At run start:** upsert
      `{ tenant_id, status: 'running', started_at: now(), finished_at: null }`.
- [ ] **On success (final node):** upsert
      `{ tenant_id, status: 'completed', finished_at: now(),
         personas_made, images_made, videos_made }` (counts optional but nice).
- [ ] **On error (error workflow / catch):** upsert
      `{ tenant_id, status: 'failed', finished_at: now(), message: '<error>' }`.
- Upsert key = `tenant_id`. The web matches completion to its run by `finished_at`.
- Until this is wired, the web falls back to a heuristic (no new rows for ~5 min
  ⇒ "complete"), so this mainly makes completion **instant and accurate**.

## 5. Pipeline writes (unchanged, FYI)
- `personas` (upsert on `tiktok_account_id`), `outputs` (upsert on
  `persona_id, scenario_id`), `videos` (upsert on `output_id`) — all as today.
- Do NOT set `tenant_id` manually on these — the DB triggers do it from the parent.

## 6. Secrets to rotate (they leaked in chat / the workflow JSON)
- [ ] n8n Basic-Auth password (webhook).
- [ ] Fal + Anthropic keys — rotate them; the **new** values go into each tenant's
      `tenant_profiles` row (via onboarding / Settings), NOT back into CONFIG.
- [ ] `APIFY_TOKEN` (if it stays platform-wide in n8n config).
- [ ] Supabase **service-role** secret for the live project.

---

## 7. NOTE — replacing the old workflow with a new one (connection contract)
The web app does NOT know anything about the workflow internals. The **only** link
is the `trigger-pipeline` Edge Function POSTing to the n8n **webhook**, using three
Supabase secrets (set on the LIVE project):

| Secret | Current value |
|--------|---------------|
| `N8N_WEBHOOK_URL`  | `https://harveyd.app.n8n.cloud/webhook/run-alluvi-pipeline` |
| `N8N_WEBHOOK_USER` | `Sahad` |
| `N8N_WEBHOOK_PASS` | the rotated Basic-Auth password |

**To swap the flow with ZERO app changes, make the new workflow's Webhook node match:**
- [ ] HTTP Method **POST**, Path **`run-alluvi-pipeline`** (same path ⇒ same URL).
- [ ] Same **Basic Auth** credential (user `Sahad` + the rotated password).
- [ ] **Activate** the workflow — the production URL `/webhook/<path>` only works when
      the workflow is Active. (`/webhook-test/<path>` is the editor test URL — don't
      use that one in the secret.)
- [ ] Read the JSON body → **`tenant_id`** (the Edge Function sends it; see §1).
- [ ] **Respond 200 immediately** (e.g. "Respond to Webhook" at the start). The
      pipeline is long; if the webhook waits for the whole run, the trigger call
      times out instead of returning "started".

**If the new flow uses a different path or credentials**, update the secrets instead:
```powershell
npx supabase secrets set N8N_WEBHOOK_URL=https://harveyd.app.n8n.cloud/webhook/<new-path> --project-ref hgmvgnsvxlzcylfwttlc
npx supabase secrets set N8N_WEBHOOK_USER=<user> --project-ref hgmvgnsvxlzcylfwttlc
npx supabase secrets set N8N_WEBHOOK_PASS=<pass> --project-ref hgmvgnsvxlzcylfwttlc
npx supabase secrets list --project-ref hgmvgnsvxlzcylfwttlc   # confirm all 3
```

**Re-attach the n8n-side credentials in the new flow** (these live in n8n, not the app):
- [ ] Supabase / Postgres credential → **LIVE** project + **service-role** secret.
- [ ] Supabase **Storage** access (same service-role key) for uploading assets —
      **replaces Google Drive OAuth, which is no longer used at all** (§9).
- [ ] Apify auth if used. (Per-tenant Fal + Claude keys now come from the DB — §2b.)

**Smoke test after the swap** (expect `{"ok":true,...}`):
```powershell
$anon = "<live publishable key>"
curl.exe -i -X POST "https://hgmvgnsvxlzcylfwttlc.supabase.co/functions/v1/trigger-pipeline" `
  -H "Authorization: Bearer $anon" -H "apikey: $anon" `
  -H "Content-Type: application/json" -d "{}"
```

---

## 8. NOTE — new tables & columns (this session) and how the new flow uses them
Everything the web app added to the DB, and what n8n should do with each when you
build the new flow. All per-tenant reads key on `tenant_id` (passed in via the
webhook, §1).

### Tables n8n READS (per tenant)
- **`tenant_run_configs`** *(new)* — the run settings that replaced the hardcoded
  CONFIG. Read: `one_per_persona, tiktok_id, max_videos_per_run, max_qc_attempts,
  video_duration, video_resolution`. (§2)
- **`tenant_profiles`** *(existing; new cols)* — read **`fal_api_key`,
  `anthropic_api_key`** (per-tenant keys, §2b) and **`product_briefing`,
  `company_briefing`** (prompt context, if you want them in the prompts). Ignore
  `role` / `status` / `onboarded` (app-managed).
- **`tenant_images`** *(prior session)* — the reference images the tenant uploaded
  at onboarding, as Supabase Storage URLs (`storage_url`). If the new flow should use
  **per-tenant** product/brand references instead of the old hardcoded
  `PRODUCT_FILE_IDS`, read them here: `select storage_url from tenant_images where
  tenant_id = '{{tenant_id}}'`. ⚠️ These are **Supabase public URLs**, not Google
  Drive file IDs — the image-input step must accept a URL. (Decide at build time.)
- **`tiktok_accounts`** *(existing)* — the tenant's accounts; filter by `tenant_id`
  (already stored). As today.

### Tables/columns n8n WRITES
- **`personas` / `outputs` / `videos`** — exactly as today (upserts unchanged).
  **Do NOT set `tenant_id`** on these — the new `tenant_id` columns are filled
  automatically by BEFORE-INSERT triggers from the parent row.
- **`outputs.prompt_used`** *(new column)* — write the **scene-image prompt** here
  (parallel to `videos.prompt_used` = video script). The web rating feature reads it. (§3)
- **`tenant_run_status`** *(new table)* — write run lifecycle: `running` at start,
  `completed` (+ counts) on success, `failed` (+ message) on error. Upsert key =
  `tenant_id`. Drives the web "Pipeline complete" pill. (§4)

### Tables n8n IGNORES (web-only)
- **`asset_ratings`** *(new)* — human QA ratings, written by the web. n8n doesn't
  write it. *(Future option: n8n could READ scores like `img_ad_worthiness` /
  `vid_hook_strength` to weight scenario selection — not wired now.)*
- **`impersonation_events`** *(new)* — super-admin audit log, app-only.
- **`tenant_run_configs`** is read-only for n8n (the web writes it on Run).

### New `tenant_id` columns (trigger-managed — informational)
`personas`, `outputs`, `videos`, `tiktok_auth`, `tiktok_posts` all gained a
`tenant_id` column, auto-stamped by triggers from their parent. n8n requires **no
change** for these — just keep inserting as before.

---

## 9. Google Drive is REMOVED — assets live in Supabase Storage

**Why:** the site is publicly hosted and Drive was flaky for embedding
(throttled thumbnails, failing `/preview` iframes) and awkward as a context
source. Everything is now in Supabase: **asset bytes in Storage, scene context
in the DB.** Delete every Google Drive node from the flow.

### 9a. Upload generated assets to Storage, store the URL on the row
Upload with the **service-role key**; the public URL is deterministic.

| Asset | Phase | Bucket | Object path | Write URL to |
|---|---|---|---|---|
| Persona portrait | A | `personas` | `<persona_id>.png` | `personas.portrait_storage_url` **(new col)** |
| Scene image | B | `images` | `<output_id>.png` | `outputs.image_storage_url` |
| Video (mp4) | C | `videos` | `<video_id>.mp4` | `videos.storage_url` |

```
POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}
  Authorization: Bearer {SERVICE_ROLE_KEY}
  Content-Type:  image/png   (or video/mp4)
  x-upsert:      true
  body: <raw bytes>
Public URL to save = {SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}
```
- [ ] Phase A → upload portrait, write `personas.portrait_storage_url`.
- [ ] Phase B → upload scene image, write `outputs.image_storage_url`.
- [ ] Phase C → upload mp4, write `videos.storage_url`.
- [ ] Leave the legacy `drive_file_id` / `drive_url` columns **null** (kept only
      for old rows; never read).

### 9b. Read generation CONTEXT from the DB, not Drive
| Step needs… | Old (Drive) | New (Supabase / DB) |
|---|---|---|
| Scene image (B) needs the persona portrait | Drive file | `personas.portrait_storage_url` |
| Video (C) needs the scene image | Drive file | `outputs.image_storage_url` |
| Reference / product images | Drive folder / `PRODUCT_FILE_IDS` | `tenant_images.storage_url` (per tenant) |

⚠️ These are **public URLs**, not Drive file IDs — image-input steps must accept
a URL (fetch the bytes or pass the URL straight to the model). Full detail:
`read/drive_to_storage.md`. One-time backfill of old Drive rows is optional
(mirror-image / mirror-video functions) — see that doc.

---

## 10. Scenarios come from the DB (`public.scenarios`), not Drive

The 60 curated scene recipes that **drive every generation** are now seeded into
`public.scenarios` (`seed_scenarios_60.md`). The old Drive-hosted scenario file
is gone.

- [ ] Replace the Drive scenario read with:
      ```sql
      select scenario_id, index_no, scenario_title, content, composed_attributes, version
      from public.scenarios
      where source = 'curated' and active = true
      order by index_no;
      ```
- [ ] Use **`content`** (jsonb: `scene`, `outfit`, `pose`, `hand_assignment`,
      `grip_or_placement`, `lighting`, `mood`, `palette`, `framing`,
      `camera_height`) as the scene-prompt source.
- [ ] Copy `scenario_id` + `scenario_title` onto each `outputs` row (as today).
- [ ] `composed_attributes` (jsonb learning tags) + `version` are for the
      learning layer — carry them through to the LEARN step (§11).
- [ ] Process order = `index_no` ascending. `MAX_VIDEOS_PER_RUN` still bounds how
      many scenarios per persona per run (lowest undone `index_no` first).

---

## 11. Learning layer — exploration → active gate (NEW)

A two-phase model per tenant. **Read one switch; behave accordingly; learn; flip
when coverage is complete.** Tables: `tenant_learning_state`,
`v_tenant_exploration_progress`, `attribute_stats`, `attribute_priors`,
`tuning_suggestions`. (Full column specs: `read/db_for_n8n.md` §14.)

### 11a. Read the switch
```sql
insert into public.tenant_learning_state (tenant_id) values ('{{tenant_id}}')
on conflict (tenant_id) do nothing;                      -- ensure a row exists
select phase, engine_enabled, min_coverage_pct
from public.tenant_learning_state where tenant_id = '{{tenant_id}}';
```
- **`engine_enabled = false` (exploration)** → behave **exactly like today**:
  process **all** active curated scenarios in `index_no` order to get full
  coverage. No selection engine, no prompt edits.
- **`engine_enabled = true` (active)** → engine-driven: bias scenario/attribute
  selection by learned `attribute_stats`, and apply only **`status='validated'`**
  rows from `tuning_suggestions` to the prompts.

### 11b. LEARN step (end of run, or a separate job)
For each newly **resolved** output, fold its result into `attribute_stats` —
one upsert per `(attribute × rubric dimension)`:
```sql
insert into public.attribute_stats
  (tenant_id, context_key, attribute_key, dimension, kind, n, passes, sum_val, sum_sq, estimate, updated_at)
values ('{{tenant_id}}','global', :attr_key, :dimension, :kind,
        1, :gate_pass, :score, :score*:score, :estimate, now())
on conflict (tenant_id, context_key, attribute_key, dimension) do update set
  n        = attribute_stats.n + 1,
  passes   = attribute_stats.passes  + excluded.passes,
  sum_val  = attribute_stats.sum_val + excluded.sum_val,
  sum_sq   = attribute_stats.sum_sq  + excluded.sum_sq,
  estimate = case when :kind='gate'
                  then (attribute_stats.passes + excluded.passes)::numeric / (attribute_stats.n + 1)
                  else (attribute_stats.sum_val + excluded.sum_val) / (attribute_stats.n + 1) end,
  updated_at = now();
```
- `attribute_key` = each entry of the scenario's `composed_attributes`
  (e.g. `lighting_type=golden_hour`). `dimension` = the rubric item
  (gate id like `img_persona_identity`, or score id like `img_aesthetic`).
  `kind` = `gate` or `score`. Source the gate/score values from `asset_ratings`.
- **Free signal (no human needed):** a `qc_status='skipped'` output is an
  automatic **image-gate fail** — write a gate fail (`dimension='img_qc'`,
  `passes=0`) for every attribute in that scenario's `composed_attributes`, so the
  engine learns to avoid attribute combos the image stage can't even render.

### 11c. Flip the gate when coverage is complete
```sql
update public.tenant_learning_state ls
   set phase='active', engine_enabled=true, engine_enabled_at=now(), updated_at=now()
  from public.v_tenant_exploration_progress p
 where ls.tenant_id = '{{tenant_id}}' and p.tenant_id = ls.tenant_id
   and ls.engine_enabled = false
   and p.pct_complete >= ls.min_coverage_pct;     -- default 100 = strict full coverage
```
The view counts a curated scenario **resolved** when it hits a terminal state:
`qc_status='skipped'` OR (`qc_status='pass'` AND its rating `video_rated=true`) —
so a perpetually-failing scenario can't trap a tenant in exploration. The flip is
one-way and timestamped for audit.

---

## Quick reference — tables n8n touches
| Table | n8n action | tenant_id |
|-------|-----------|-----------|
| `tenant_run_configs` | READ run settings | by `tenant_id` |
| `tenant_profiles`    | READ Fal + Claude keys (+ briefings) | by `tenant_id` |
| `tenant_images`      | READ reference image **Storage URLs** | by `tenant_id` |
| `tenant_run_status`  | WRITE running/completed/failed | sets `tenant_id` |
| `tiktok_accounts`    | READ (filter to tenant) | already set |
| `scenarios`          | READ scene recipes (`content`) — curated, active, by `index_no` | curated = NULL |
| `personas/outputs/videos` | WRITE as today + **`*_storage_url`** (Storage) + `outputs.prompt_used` | trigger auto-fills |
| `tenant_learning_state` | READ `engine_enabled`; FLIP to active when complete | sets `tenant_id` |
| `v_tenant_exploration_progress` | READ coverage % (decide the flip) | by `tenant_id` |
| `attribute_stats`    | WRITE running tallies (LEARN step + QC-skip signal) | sets `tenant_id` |
| `tuning_suggestions` | READ `status='validated'` (active phase only) | by `tenant_id` |
| `asset_ratings` / `impersonation_events` | ignore (web-only) | — |

**Drive:** removed. Asset bytes → Supabase Storage buckets `personas` / `images`
/ `videos`; URLs on `personas.portrait_storage_url`, `outputs.image_storage_url`,
`videos.storage_url`. Legacy `drive_*` columns are never written or read. (§9)
