# Alluvi DB — Full Schema & Dataflow (for n8n restructure)

> Hand-off doc. Maps **every table**, **every column**, who writes it at each
> stage of the pipeline, how rows connect parent → child, and how
> **multitenancy** threads through automatically. Read top-to-bottom; the
> "What n8n must change" section at the end is the actionable summary.
>
> Source of truth: `supabase_schema.sql` + all files in `supabase/*.sql`.

---

## 0. The spine — one run flows left → right

```
tenant_profiles (the customer / tenant)
      │  tenant_id (uuid = auth.users.id)  ← ends up stamped on EVERY row below
      ▼
tiktok_accounts ──< personas ──< outputs ──< videos ──< tiktok_posts
   HUMAN / web      Phase A        Phase B      Phase C     Posting
   (web app)        (n8n)          (n8n)        (n8n)        (n8n)
      │
      └──< tiktok_auth (1:1 OAuth tokens, n8n reads to post)
```

`──<` = one-to-many. Cardinality locks:

- `personas.tiktok_account_id` **UNIQUE** → 1 persona per account (1:1).
- `outputs (persona_id, scenario_id)` **UNIQUE** → 1 row per persona×scenario (Phase B upsert key).
- `videos.output_id` **UNIQUE** → 1 video per scene image (1:1).
- `tiktok_posts.video_id` **UNIQUE** → 1 post per video (1:1).
- `tiktok_auth.tiktok_account_id` **PK** → 1 token row per account (1:1).

Trace any artifact back to its account:

```sql
SELECT t.tiktok_id, t.country,
       p.drive_url  AS persona,
       o.scenario_id, o.drive_url AS scene_image,
       v.drive_url  AS video
FROM   videos   v
JOIN   outputs  o ON o.id = v.output_id
JOIN   personas p ON p.id = o.persona_id
JOIN   tiktok_accounts t ON t.id = p.tiktok_account_id;
```

---

## 1. STAGE 0 — Tenant identity (web app writes, n8n reads)

These tables describe **the customer** and **how their run should behave**.
n8n reads them at the start of a run; it does not write them.

### `tenant_profiles` — one row per customer (root of tenant isolation)

| Column | Type | Meaning for n8n |
|---|---|---|
| `tenant_id` | uuid **PK** | = `auth.users.id`. **The value that propagates onto every pipeline row.** |
| `name` | text | display only |
| `email` | text | display only |
| `fal_api_key` | text | **n8n reads per-tenant** instead of a hardcoded key |
| `anthropic_api_key` | text | **n8n reads per-tenant** instead of a hardcoded key |
| `product_briefing` | text | fed into prompt generation |
| `company_briefing` | text | fed into prompt generation |
| `onboarded` | bool | tenant finished setup (false = not ready) |
| `role` | text | `'tenant'` / `'super_admin'` |
| `status` | text | `'active'` / `'suspended'` / `'removed'` — **only process `active`** |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `tenant_run_configs` — replaces n8n's old hardcoded `CONFIG` block

**n8n reads this at run start, keyed by `tenant_id`.** Each tenant configures their own run.

| Column | Type | Was hardcoded → now per-tenant |
|---|---|---|
| `tenant_id` | uuid **PK** | which tenant this run is for |
| `one_per_persona` | bool | true = every persona this run; false = only personas with no video yet |
| `tiktok_id` | text | targeting override (one or comma-separated handles); null = all accounts |
| `max_videos_per_run` | int | scenarios per selected persona this run |
| `max_qc_attempts` | int | QC retries per scene image before skipping it |
| `video_duration` | text | e.g. `'15'` (seconds) |
| `video_resolution` | text | e.g. `'1080p'` |
| `updated_at` | timestamptz | |

> Total videos per run = selected personas × `max_videos_per_run`. Keep below the n8n ~40-min execution cap.

### `tenant_images` — reference images the tenant uploaded

n8n reads these as look references for persona/scene generation.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | |
| `tenant_id` | uuid | owner |
| `storage_url` | text | public Supabase Storage URL |
| `file_name` | text | original name |
| `created_at` | timestamptz | |

---

## 2. STAGE 1 — `tiktok_accounts` (HUMAN input; n8n reads only)

The only table humans fill (via the web app). **n8n never writes here** — it reads accounts to know who to build for.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | parent key for the whole chain |
| `tiktok_id` | text **NOT NULL UNIQUE** | TikTok handle, no `@` |
| `name` | text NOT NULL | |
| `gender` | text NOT NULL | `'female'` / `'male'` — drives persona look |
| `country` | text NOT NULL | drives look + language |
| `age` | int NOT NULL | CHECK 0–120 (UI enforces 13–120) |
| `language` | text NOT NULL | |
| `tenant_id` | uuid | **owner.** Web app stamps it. NULL = super-admin/global rows |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | auto-bumped by `trg_tiktok_accounts_updated_at` |

> **Identity fields** = `gender`, `age`, `country`, `language`. If the web app edits any of these, it cascade-deletes the account's `videos → outputs → personas` so the next n8n run rebuilds from the new identity. Editing only `name` does not cascade.

**n8n reads:** filter by tenant (and by `tenant_run_configs.tiktok_id` if set) to choose accounts.

---

## 3. STAGE 2 — `personas` (Phase A: n8n writes the AI portrait)

One persona per account (`tiktok_account_id` UNIQUE).

| Column | Type | Who / what |
|---|---|---|
| `id` | bigint **PK** | |
| `tiktok_account_id` | bigint FK→accounts, **NOT NULL UNIQUE** | links to Stage 1 |
| `drive_file_id` | text | Google Drive id of the portrait |
| `drive_url` | text | viewable Drive link |
| `prompt_used` | text | the portrait prompt (traceability) |
| `status` | text | default `'done'` |
| `tenant_id` | uuid | **AUTO-FILLED** by trigger `trg_persona_tenant` from the parent account — **n8n inserts nothing here** |
| `created_at` | timestamptz | default now() |

**n8n flow:** `A: Check Personas` (read accounts + personas) → generate portrait → `A: Record Persona` **upsert on `tiktok_account_id`**.

---

## 4. STAGE 3 — `outputs` (Phase B: n8n writes scene images, persona × scenario)

| Column | Type | Who / what |
|---|---|---|
| `id` | bigint **PK** | |
| `persona_id` | bigint FK→personas, **NOT NULL** | links to Stage 2 |
| `scenario_id` | text **NOT NULL** | one of the 30 fixed scenarios |
| `scenario_title` | text | human-readable label |
| `drive_file_id` | text | Drive id of the scene image |
| `drive_url` | text | Drive link |
| `qc_status` | text | `'pass'` (cleared QC) / `'skipped'` (failed after all retries) |
| `qc_reason` | text | `defect \| score \| resemblance \| attempts` |
| `attempts` | int | default 1 — QC attempts used |
| `prompt_used` | text | **NEW — n8n must start writing the image prompt here.** Currently empty; the rating snapshot reads it into `asset_ratings.image_prompt` |
| `image_storage_url` | text | Supabase-mirrored image URL — **web app fills this, n8n leaves null** |
| `tenant_id` | uuid | **AUTO-FILLED** by `trg_output_tenant` from the parent persona |
| `created_at` | timestamptz | default now() |
| — | — | **UNIQUE (`persona_id`, `scenario_id`)** → the upsert key |

**n8n flow:** `B: Get Personas` → `B: Build Job List` (skip done rows) → generate + QC → `B: Record Output` **upsert on (`persona_id`,`scenario_id`)**. Only `qc_status='pass'` rows advance to Stage 4.

---

## 5. STAGE 4 — `videos` (Phase C: n8n writes one lip-synced clip per passed image)

| Column | Type | Who / what |
|---|---|---|
| `id` | bigint **PK** | |
| `output_id` | bigint FK→outputs, **UNIQUE** | 1:1 with the scene image |
| `scenario_id` | text | copied from the output for convenience |
| `drive_file_id` | text | Drive id of the MP4 |
| `drive_url` | text | Drive link |
| `prompt_used` | text | the Seedance video prompt |
| `dialogue` | text | spoken dialogue |
| `status` | text | default `'done'` |
| `storage_url` | text | Supabase-mirrored MP4 — **web app fills on first play, n8n leaves null** |
| `tenant_id` | uuid | **AUTO-FILLED** by `trg_video_tenant` from the parent output |
| `created_at` | timestamptz | default now() |

**n8n flow:** `C: Build Video Job List` (only QC-passed outputs without a video) → generate video → `C: Record Video` **upsert on `output_id`**.

> A `(persona, scenario)` that already has a video row is skipped permanently. To redo one, delete its `videos` row (and optionally the `outputs` row for a fresh scene image).

---

## 6. STAGE 5 — Posting to TikTok

### `tiktok_auth` — OAuth tokens, 1:1 with account (n8n READS to post)

| Column | Type | Notes |
|---|---|---|
| `tiktok_account_id` | bigint **PK** FK→accounts | the account these tokens belong to |
| `access_token` | text NOT NULL | |
| `refresh_token` | text NOT NULL | |
| `expires_at` | timestamptz NOT NULL | refresh before this |
| `open_id` | text NOT NULL | TikTok user open id |
| `scope` | text | granted scopes |
| `tenant_id` | uuid | **AUTO-FILLED** by `trg_tiktok_auth_tenant` from the account |
| `updated_at` | timestamptz | default now() |

### `tiktok_posts` — one row per published video (n8n WRITES after posting)

| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | |
| `video_id` | bigint FK→videos, **NOT NULL UNIQUE** | the video that was posted |
| `tiktok_account_id` | bigint FK→accounts, NOT NULL | which account posted it |
| `publish_id` | text | TikTok publish id |
| `status` | text NOT NULL | post status |
| `tiktok_post_url` | text | live post URL |
| `error_reason` | text | failure detail |
| `posted_at` | timestamptz | when it went live |
| `tenant_id` | uuid | **AUTO-FILLED** by `trg_tiktok_posts_tenant` from the account |
| `created_at` | timestamptz | default now() |

---

## 7. Run telemetry — `tenant_run_status` (n8n MUST write this)

The web app can't see when an n8n run *finishes* — it only sees rows appear.
n8n updates one row per tenant so the Run pill is accurate.

| Column | Type | n8n writes |
|---|---|---|
| `tenant_id` | uuid **PK** | the run's tenant |
| `status` | text | **at start** `'running'`, **on done** `'completed'`, **on error** `'failed'` |
| `started_at` | timestamptz | now() at start |
| `finished_at` | timestamptz | now() when done; NULL while running |
| `personas_made` | int | final count this run (display) |
| `images_made` | int | final count this run (display) |
| `videos_made` | int | final count this run (display) |
| `message` | text | optional error / summary text |
| `updated_at` | timestamptz | default now() |

**n8n usage:**
```
start:  upsert (tenant_id, status='running',   started_at=now(), finished_at=null)
done:   upsert (tenant_id, status='completed', finished_at=now(), videos_made=...)
error:  upsert (tenant_id, status='failed',    finished_at=now(), message=...)
```

---

## 8. QA + misc (web-app owned — n8n can ignore for now)

### `asset_ratings` — one row per output (human QC ratings)

`tenant_id` auto-stamped from the output via `trg_asset_rating_tenant`.
Reads `outputs.prompt_used` → `image_prompt`, `videos.prompt_used`/`dialogue` → `video_script`.
Rubric results stored as JSONB (`image`, `video`) shaped `{ gates, scores, notes }`.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | |
| `tenant_id` | uuid | auto-stamped from output |
| `output_id` | bigint FK→outputs **UNIQUE**, ON DELETE CASCADE | one rating per generation |
| `video_id` | bigint FK→videos, ON DELETE SET NULL | |
| `persona_id` | bigint | snapshot |
| `tiktok_account_id` | bigint | snapshot |
| `scenario_id` | text | snapshot |
| `scenario_title` | text | snapshot |
| `image_prompt` | text | from `outputs.prompt_used` |
| `video_script` | text | from `videos.prompt_used` / `dialogue` |
| `image_storage_url` | text | snapshot |
| `video_storage_url` | text | snapshot |
| `rater_id` | text | who rated |
| `asset_triage` | text | `'Accept'` / `'Reject'` / `'Flag'` |
| `image` | jsonb | `{ gates, scores, notes }` |
| `video` | jsonb | `{ gates, scores, notes }` |
| `image_rated` | bool | |
| `video_rated` | bool | |
| `rubric_version` | text | config version that produced this |
| `created_at` / `updated_at` | timestamptz | |

> Future n8n relevance only: feeding real auto-gate metrics (object detection, ΔE, OCR, face match) into the gates instead of "pending".

### `impersonation_events` — super-admin audit log (n8n: ignore)

`id`, `actor` (default `'super_admin'`), `tenant_id`, `tenant_name`, `tenant_email`, `action` (`'view_page'`/`'suspend'`/`'reactivate'`/`'remove'`), `created_at`.

### ~~`app_settings`~~ — DROPPED (2026-06-04; n8n never used it)

Removed (`drop table public.app_settings`). Per-tenant API keys live in
`tenant_profiles.fal_api_key` / `anthropic_api_key` — read those.

---

## 9. Multitenancy contract — the key takeaway for n8n

**You barely touch `tenant_id`. It auto-propagates.**

1. The **web app stamps `tenant_id` on `tiktok_accounts` only**.
2. **BEFORE INSERT/UPDATE triggers copy it down the chain automatically:**

   | Child table | Trigger | Copies tenant_id from |
   |---|---|---|
   | `personas` | `trg_persona_tenant` | its `tiktok_account_id` |
   | `outputs` | `trg_output_tenant` | its `persona_id` |
   | `videos` | `trg_video_tenant` | its `output_id` |
   | `tiktok_auth` | `trg_tiktok_auth_tenant` | its `tiktok_account_id` |
   | `tiktok_posts` | `trg_tiktok_posts_tenant` | its `tiktok_account_id` |
   | `asset_ratings` | `trg_asset_rating_tenant` | its `output_id` |

So **n8n inserts exactly as today and Postgres fills `tenant_id` for free.**
**Never set `tenant_id` manually** — let the triggers do it.

---

## 10. What n8n MUST change (actionable checklist)

1. **Receive `tenant_id`** in the webhook payload (which tenant triggered this run).
2. **Read run settings** from `tenant_run_configs WHERE tenant_id = :id` — replaces the hardcoded `CONFIG` block (`one_per_persona`, `tiktok_id`, `max_videos_per_run`, `max_qc_attempts`, `video_duration`, `video_resolution`).
3. **Read API keys + briefings** from `tenant_profiles WHERE tenant_id = :id` (`fal_api_key`, `anthropic_api_key`, `product_briefing`, `company_briefing`) — replaces hardcoded keys. Skip tenants where `status <> 'active'` or `onboarded = false`.
4. **Filter accounts** by that tenant (and by `tenant_run_configs.tiktok_id` if set).
5. **Write `outputs.prompt_used`** (the image prompt) — currently always null.
6. **Write `tenant_run_status`** at start / done / error so the Run pill is accurate (see §7).
7. **Do NOT set** `tenant_id`, `storage_url`, or `image_storage_url` on any insert — triggers / web app own those.

### Reference — queries each phase runs

```sql
-- run start: load this tenant's config + keys
select * from public.tenant_run_configs where tenant_id = :tenant_id;
select fal_api_key, anthropic_api_key, product_briefing, company_briefing,
       status, onboarded
  from public.tenant_profiles where tenant_id = :tenant_id;

-- pick accounts (respect tiktok_id targeting if set)
select * from public.tiktok_accounts
 where tenant_id = :tenant_id
   and (:tiktok_id is null or tiktok_id = any(string_to_array(:tiktok_id, ',')));

-- Phase A: record persona (tenant_id auto-stamped)
insert into public.personas (tiktok_account_id, drive_file_id, drive_url, prompt_used, status)
values (:acc, :fid, :url, :prompt, 'done')
on conflict (tiktok_account_id) do update set
  drive_file_id = excluded.drive_file_id,
  drive_url     = excluded.drive_url,
  prompt_used   = excluded.prompt_used;

-- Phase B: record output (note prompt_used now populated)
insert into public.outputs (persona_id, scenario_id, scenario_title, drive_file_id,
                            drive_url, qc_status, qc_reason, attempts, prompt_used)
values (:pid, :scn, :title, :fid, :url, :qc, :reason, :attempts, :image_prompt)
on conflict (persona_id, scenario_id) do update set
  drive_file_id = excluded.drive_file_id,
  drive_url     = excluded.drive_url,
  qc_status     = excluded.qc_status,
  qc_reason     = excluded.qc_reason,
  attempts      = excluded.attempts,
  prompt_used   = excluded.prompt_used;

-- Phase C: record video
insert into public.videos (output_id, scenario_id, drive_file_id, drive_url,
                          prompt_used, dialogue, status)
values (:oid, :scn, :fid, :url, :vprompt, :dialogue, 'done')
on conflict (output_id) do update set
  drive_file_id = excluded.drive_file_id,
  drive_url     = excluded.drive_url,
  prompt_used   = excluded.prompt_used,
  dialogue      = excluded.dialogue;

-- run status markers
insert into public.tenant_run_status (tenant_id, status, started_at, finished_at)
values (:tenant_id, 'running', now(), null)
on conflict (tenant_id) do update set
  status = 'running', started_at = now(), finished_at = null, updated_at = now();

insert into public.tenant_run_status (tenant_id, status, finished_at, videos_made)
values (:tenant_id, 'completed', now(), :videos_made)
on conflict (tenant_id) do update set
  status = 'completed', finished_at = now(),
  videos_made = excluded.videos_made, updated_at = now();
```

---

# ════════════════════════════════════════════════════════════
# v2 ADDITIONS — Drive removal, Scenarios catalog, Learning layer
# ════════════════════════════════════════════════════════════

> Everything below is **new this session** and **supersedes** the Drive-based
> bits above. Two big shifts: (a) **Google Drive is removed** — assets live in
> Supabase Storage and the scene *context* lives in the DB, not Drive; (b) a
> **learning layer** (scenarios + per-attribute stats + an exploration→active
> gate) sits on top of the pipeline.
>
> Migrations: `supabase/drive_to_storage_migration.sql`,
> `supabase/learning_layer_v2_migration.sql`, then the `seed_scenarios_60.md` SQL.

---

## 11. Drive → Supabase Storage (asset bytes)

**Rule: bytes → Supabase Storage; public URL → the DB row. No Drive, ever.**

| Asset | Phase | Bucket | Object path | URL column |
|---|---|---|---|---|
| Persona portrait | A | `personas` | `<persona_id>.png` | `personas.portrait_storage_url` **(NEW)** |
| Scene image | B | `images` | `<output_id>.png` | `outputs.image_storage_url` |
| Video (mp4) | C | `videos` | `<video_id>.mp4` | `videos.storage_url` |
| Reference images | onboarding | `tenant-images` | `<tenant>/<file>` | `tenant_images.storage_url` |

- The `drive_file_id` / `drive_url` columns on `personas` / `outputs` / `videos`
  are now **LEGACY** — keep them null on new rows; don't read them.
- Upload server-side with the **service-role key**:
  `POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}` (`x-upsert: true`,
  `Content-Type: image/png|video/mp4`). Public URL is deterministic:
  `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}` — build it and store it.

**n8n now READS generation context from Storage URLs in the DB, not Drive:**
- scene image (B) needs the portrait → `personas.portrait_storage_url`
- video (C) needs the scene image → `outputs.image_storage_url`
- reference images → `tenant_images.storage_url`

Full cutover detail: `read/drive_to_storage.md`.

### Updated insert SQL (Storage, not Drive)

```sql
-- Phase A: portrait uploaded to bucket `personas`; store its URL
insert into public.personas (tiktok_account_id, portrait_storage_url, prompt_used, status)
values (:acc, :portrait_url, :prompt, 'done')
on conflict (tiktok_account_id) do update set
  portrait_storage_url = excluded.portrait_storage_url,
  prompt_used          = excluded.prompt_used;

-- Phase B: scene image uploaded to bucket `images`; store its URL + the prompt
insert into public.outputs (persona_id, scenario_id, scenario_title,
                            image_storage_url, qc_status, qc_reason, attempts, prompt_used)
values (:pid, :scn, :title, :image_url, :qc, :reason, :attempts, :image_prompt)
on conflict (persona_id, scenario_id) do update set
  image_storage_url = excluded.image_storage_url,
  qc_status = excluded.qc_status, qc_reason = excluded.qc_reason,
  attempts = excluded.attempts, prompt_used = excluded.prompt_used;

-- Phase C: video uploaded to bucket `videos`; store its URL
insert into public.videos (output_id, scenario_id, storage_url, prompt_used, dialogue, status)
values (:oid, :scn, :video_url, :vprompt, :dialogue, 'done')
on conflict (output_id) do update set
  storage_url = excluded.storage_url,
  prompt_used = excluded.prompt_used, dialogue = excluded.dialogue;
```

---

## 12. `scenarios` — the scene catalog (NEW; replaces Drive-sourced scenarios)

The 60 curated scenarios that **drive generation** now live in the DB (seeded by
`seed_scenarios_60.md`), not in a Drive file. **n8n READS them; never writes
curated rows.**

| Column | Type | Meaning |
|---|---|---|
| `id` | bigint PK | |
| `index_no` | int | catalog/processing order 1..N (curated). NULL for generated. **Not** the engine trigger — just order. |
| `scenario_id` | text **UNIQUE** | stable id (e.g. `gym_post_workout_mirror_01`). Copied onto `outputs.scenario_id`. |
| `tenant_id` | uuid | **NULL = curated/shared** (every tenant uses it). Set = tenant-specific generated scenario. |
| `source` | text | `'curated'` \| `'generated'` |
| `category`, `difficulty`, `scenario_title` | text | denormalized for filtering/readability |
| `content` | jsonb | **the full scene recipe** the generator consumes: `scene`, `outfit` (female/male), `pose`, `hand_assignment`, `grip_or_placement`, `lighting`, `mood`, `palette`, `framing`, `camera_height` |
| `composed_attributes` | jsonb | the canonical **learning tags** (`archetype`, `scene_category`, `environment`, `has_phone`, `product_hand`, `hold_type`, `grip_level`, `box_orientation`, `framing`, `camera_height`, `lighting_type`, `time_of_day`, `mirror`, `fabric_family`, `difficulty`) |
| `version` | text | scenario content version (`'v1'`) — snapshot onto ratings as `scenario_version` |
| `content_hash` | text | md5 of `content` for change detection |
| `active` | bool | only `active=true` curated rows are processed |
| `created_at`, `updated_at` | timestamptz | |

**n8n READ (Phase B scene selection):**
```sql
select scenario_id, index_no, scenario_title, content, composed_attributes, version
from public.scenarios
where source = 'curated' and active = true
order by index_no;
```
Use `content` as the scene prompt source; copy `scenario_id` + `scenario_title`
onto the `outputs` row.

---

## 13. `asset_ratings` — new snapshot columns (NEW)

Two columns added so a rating carries its scenario's learning tags immutably:

| Column | Type | Stores |
|---|---|---|
| `composed_attributes` | jsonb | snapshot of the scenario's tags at rating time (from `scenarios.composed_attributes`) |
| `scenario_version` | text | the `scenarios.version` that produced this generation |

> Web writes these at rating time. n8n's LEARN job can instead just join
> `asset_ratings → outputs.scenario_id → scenarios.composed_attributes`, so the
> snapshot is a convenience, not a dependency.

---

## 14. Learning layer tables (NEW) — what n8n reads/writes

### `tenant_learning_state` — the exploration → active gate (n8n READS + FLIPS)
| Column | Type | Meaning |
|---|---|---|
| `tenant_id` | uuid PK | |
| `phase` | text | `'exploration'` (default) \| `'active'` |
| `engine_enabled` | bool | **the switch n8n reads.** `false` → behave exactly like today (process all curated scenarios in `index_no` order). `true` → use attribute-stat selection + validated prompt edits. |
| `min_coverage_pct` | int | flip threshold (default 100 = strict full coverage; e.g. 95 for resilience) |
| `required_coverage` | int | optional active-curated count captured at start |
| `exploration_started_at`, `engine_enabled_at`, `updated_at` | timestamptz | audit |

### `v_tenant_exploration_progress` — progress view (n8n READS to decide the flip)
Returns per tenant: `active_curated` (denominator), `resolved_curated`,
`pct_complete`, `is_complete`. A curated scenario is **resolved** when it reaches
a terminal state for the tenant: `outputs.qc_status='skipped'` (nothing to rate)
**OR** `qc_status='pass'` AND its rating has `video_rated=true`. This is what
prevents an always-QC-failing scenario from blocking a tenant forever.

### `attribute_stats` — per-tenant running tallies (n8n WRITES in the LEARN job)
| Column | Type | Meaning |
|---|---|---|
| `tenant_id` | uuid | owner |
| `context_key` | text | grouping bucket (default `'global'`; could be per-archetype) |
| `attribute_key` | text | e.g. `lighting_type=golden_hour` |
| `dimension` | text | the rubric item, e.g. gate `img_persona_identity` or score `img_aesthetic` |
| `kind` | text | `'gate'` \| `'score'` |
| `n`, `passes`, `sum_val`, `sum_sq` | numeric | running counts (gates use `passes/n`; scores use `sum_val/n`) |
| `estimate` | numeric | the current pass-rate / mean |
| unique | — | `(tenant_id, context_key, attribute_key, dimension)` → upsert key |

### `attribute_priors` — cross-tenant cold-start pool (optional; same shape, no tenant_id)
### `tuning_suggestions` — prompt/script fixes, validated before use (n8n READS validated ones in active phase)
`scope_type` (`attribute`\|`scenario`), `scope_key`, `dimension`, `cause`,
`suggested_edit`, `status` (`candidate`→`testing`→`validated`/`rejected`),
`evidence_n`, `score_delta`. Only `status='validated'` rows should alter prompts.

---

## 15. What n8n MUST change — v2 addendum

On top of §10 (tenant_id, run config, keys, run status):

8. **Drop all Google Drive nodes.** Upload assets to Supabase Storage and write
   the `*_storage_url` columns (§11). Read generation context from those URLs.
9. **Read scenarios from `public.scenarios`** (`active`, `curated`, ordered by
   `index_no`) instead of a Drive scenario file (§12). Copy `scenario_id` /
   `scenario_title` onto `outputs`.
10. **Respect the learning gate:** read `tenant_learning_state.engine_enabled`.
    `false` → process all active curated scenarios as today (exploration).
    `true` → engine-driven selection + validated `tuning_suggestions` (active).
11. **Run the LEARN step** (end of run or a separate job): for each newly-resolved
    output, fold its rating into `attribute_stats` per attribute × dimension.
    **Free signal:** a `qc_status='skipped'` output is an automatic image-gate
    **fail** — write it as a gate fail (e.g. dimension `img_qc`) for every
    attribute in that scenario's `composed_attributes`, so the engine learns to
    avoid attribute combos the image stage can't even render.
12. **Flip the gate when complete:**
    ```sql
    -- ensure a state row exists at exploration start
    insert into public.tenant_learning_state (tenant_id) values (:tenant_id)
    on conflict (tenant_id) do nothing;

    -- after the LEARN step, flip if coverage met
    update public.tenant_learning_state ls
       set phase='active', engine_enabled=true, engine_enabled_at=now(), updated_at=now()
      from public.v_tenant_exploration_progress p
     where ls.tenant_id = :tenant_id and p.tenant_id = ls.tenant_id
       and ls.engine_enabled = false
       and p.pct_complete >= ls.min_coverage_pct;
    ```
13. **Still don't set `tenant_id`** anywhere — triggers stamp `personas`,
    `outputs`, `videos`, `asset_ratings`, etc. from their parent.

---

*End of doc. Pairs with `read/structure.md` (full app reference), `n8n.md`
(workflow restructure), `read/drive_to_storage.md` (Drive cutover), and
`seed_scenarios_60.md` (scenario catalog).*
