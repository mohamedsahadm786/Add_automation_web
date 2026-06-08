# Alluvi Console — Complete Rebuild Specification (`rule.md`)

> **Purpose:** the single authoritative document for rebuilding this product from
> scratch. It describes *every* feature, *every* button, *every* trigger, and
> *exactly* how each action reads from and writes to the database. If you read
> only one file, read this one. It is reconciled against the live source code
> (`src/**`, `supabase/**`) and the schema docs (`DB_SCHEMA_FULL.md`,
> `read/db_for_n8n.md`).
>
> Companion docs: `DB_SCHEMA_FULL.md` (schema in one place), `read/structure.md`
> (component-by-component reference), `read/RLHF.md` (rating rubric),
> `read/drive_to_storage.md` (storage model), `n8n.md` (pipeline contract).

---

## 1. What the product is

**Alluvi Console** is the *human control panel* in front of an **n8n AI content
pipeline**. The pipeline turns a TikTok account's identity (gender, age, country,
language) into:

```
AI persona portrait → scene images (per scenario) → lip-synced videos → TikTok posts
```

The web app and the n8n workflow **never call each other's code**. They
communicate **only through a shared Supabase Postgres database** plus **one
HTTP trigger** (an Edge Function that POSTs to the n8n webhook). This separation
is the most important architectural fact: *the database is the integration
contract.*

| Actor | Owns (writes) | Consumes (reads) |
|---|---|---|
| **Web app** | human input: accounts, tenant setup, run config, QA ratings, tenant lifecycle | the whole pipeline output for display |
| **n8n** | all generated artifacts: personas, outputs, videos, posts, run status, learning stats | accounts, tenant config, API keys, scenarios |

---

## 2. Tech stack

- **React 18.3** — function components + hooks only (no Redux, no class components).
- **Vite 6** — dev server on `:5173` (`host: true`), build to `dist/`.
- **Supabase JS v2** — DB CRUD, Auth (JWT for members), Storage, Edge Functions.
- **lucide-react** — all icons.
- **Hand-rolled CSS** — one stylesheet `src/index.css` (~1100 lines), CSS custom
  properties, `html[data-theme='dark']` override block. No Tailwind, no CSS-in-JS.
- **Supabase Edge Functions (Deno)** — `trigger-pipeline`, `mirror-image`, `mirror-video`.
- **n8n Cloud** — the generation workflow (external; lives in its own repo/instance).

Scripts (`package.json`): `npm run dev` · `npm run build` · `npm run preview`.

---

## 3. Environment & secrets

The app is **environment-driven** — it does not hardcode which Supabase project
it talks to (`src/lib/constants.js`):

```
VITE_SUPABASE_URL   — Supabase project URL   (required; throws if missing)
VITE_SUPABASE_KEY   — Supabase publishable/anon key (required)
```

- Set them in `.env.local` (dev) / host env (prod). Restart `npm run dev` after a change.
- `.env.local` is git-ignored (`*.local`). `.env.example` documents prod values.

**Server-side secrets (never in the bundle)** — stored in Supabase's secret store,
read only by Edge Functions:

| Secret | Used by | Meaning |
|---|---|---|
| `N8N_WEBHOOK_URL` | `trigger-pipeline` | the n8n webhook to POST a run to |
| `N8N_WEBHOOK_USER` | `trigger-pipeline` | n8n Basic-Auth user |
| `N8N_WEBHOOK_PASS` | `trigger-pipeline` | n8n Basic-Auth password |
| service-role key | `mirror-*`, n8n | server-side Storage uploads |

> **MVP security posture (must harden before public launch):** the super-admin
> username/password is hardcoded in `src/lib/constants.js` (`admin` /
> `Alluvi@admin@1512`); RLS is **disabled** on every table with `GRANT ALL` to
> `anon, authenticated, service_role`; the publishable key ships in the bundle.
> Per-tenant API keys (Fal/Anthropic) are stored in `tenant_profiles` and are
> readable with the publishable key. See §15 (hardening backlog).

---

## 4. Authentication model

There are **two completely separate identities** (`src/hooks/useAuth.js`):

### 4.1 Super admin (platform owner)
- Hardcoded `ADMIN_USER` / `ADMIN_PASS` compared client-side, gated by a
  `sessionStorage` flag (`alluvi.session = 'ok'`). **No Supabase Auth.**
- Lands on the **Super Admin console** (`SuperAdminApp`), *not* the tenant Dashboard.
- `tenant_id` is conceptually `NULL` (sees everything / no tenant filter).

### 4.2 Members (tenants)
- Real **Supabase Auth** (email + password → JWT, persisted across reloads).
- Each member **is a tenant**: `tenant_id === auth.users.id`.
- Lands on the tenant **Dashboard**.

### 4.3 Precedence rule (critical)
A real Supabase member session **always wins** over a lingering super-admin flag:
- Admin login calls `supabase.auth.signOut()` first, then sets the session flag.
- Member sign-in/sign-up clears the admin flag first.
- The two identities are mutually exclusive — never both active.

### 4.4 Login screen modes (`LoginScreen.jsx`)
Three modes: **admin** (default) · member **Sign in** · member **Sign up**.
- Sign up collects Name, Email, Re-enter email, Password. Name → auth user metadata.
- Sign in is Email + Password.

> If Supabase "Confirm email" is **ON**, signUp returns no session and the member
> must confirm via email before signing in. The app is designed to run with
> **Confirm email OFF** so signup → immediate session.

### 4.5 App routing (`App.jsx`)
```
not ready            → blank auth shell (loading)
not authed           → <LoginScreen>
authed & super_admin → <SuperAdminApp>
authed & member      → <Dashboard>
```

---

## 5. Multitenancy — the `tenant_id` propagation contract

**The single most important DB rule.** The web app **only ever sets `tenant_id`
on `tiktok_accounts`** (stamped on create). A chain of `BEFORE INSERT/UPDATE`
triggers copies it down every child table automatically:

| Child table | Trigger | Copies `tenant_id` from |
|---|---|---|
| `personas` | `trg_persona_tenant` | its `tiktok_account_id` |
| `outputs` | `trg_output_tenant` | its `persona_id` |
| `videos` | `trg_video_tenant` | its `output_id` |
| `tiktok_auth` | `trg_tiktok_auth_tenant` | its `tiktok_account_id` |
| `tiktok_posts` | `trg_tiktok_posts_tenant` | its `tiktok_account_id` |
| `asset_ratings` | `trg_asset_rating_tenant` | its `output_id` |

Consequences for a rebuild:
- **n8n inserts exactly as if tenancy didn't exist** — never set `tenant_id` manually.
- Frontend reads scope with `eq('tenant_id', tid)` on every table directly.
- Admin path applies **no filter** (sees all rows).
- Isolation today is **logical (frontend-enforced)**, not RLS. Hardening = move
  admin to real auth + enable RLS keyed on `auth.uid()`.

---

## 6. Storage model (no Google Drive)

**Rule: asset bytes → Supabase Storage (public bucket); public URL → the DB row.**
Google Drive is fully removed; `drive_file_id` / `drive_url` columns are **LEGACY**
(kept for old rows, never written/read on new ones).

| Asset | Phase | Bucket (public) | Object path | URL column |
|---|---|---|---|---|
| Persona portrait | A | `personas` | `<persona_id>.png` | `personas.portrait_storage_url` |
| Scene image | B | `images` | `<output_id>.png` | `outputs.image_storage_url` |
| Video (mp4) | C | `videos` | `<video_id>.mp4` | `videos.storage_url` |
| Reference images | onboarding | `tenant-images` | `<tenant>/<file>` | `tenant_images.storage_url` |

Public URL pattern: `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`.

**Legacy bridge:** rows that predate the cutover (only have a Drive id) are
back-filled once, on view, via the `mirror-image` / `mirror-video` Edge
Functions (they fetch from Drive server-side, upload to Storage, write the URL).
After first heal they are Drive-independent.

---

## 7. The database schema (every table, parent-first)

Conventions: **PK** primary key · **FK** foreign key · **UQ** unique ·
*(trigger)* auto-filled by a DB trigger · **LEGACY** old rows only.

### 7.1 The spine
```
tenant_profiles ─┐ (tenant_id = auth.users.id; NULL = super-admin/global)
                 │ stamped onto every row below
                 ▼
tiktok_accounts ──< personas ──< outputs ──< videos ──< tiktok_posts
   HUMAN/web       Phase A        Phase B      Phase C     Posting
       └──< tiktok_auth (1:1 OAuth tokens)

scenarios       → Phase B generation source (scene recipes)   [n8n READ]
asset_ratings   → attribute_stats → tenant_learning_state     [learning loop]
```
Cardinality locks: `personas.tiktok_account_id` UQ (1:1) · `outputs(persona_id,
scenario_id)` UQ · `videos.output_id` UQ (1:1) · `tiktok_posts.video_id` UQ ·
`tiktok_auth.tiktok_account_id` PK (1:1) · `asset_ratings.output_id` UQ (1:1).

### 7.2 `tenant_profiles` — the customer (web writes; n8n reads)
| Column | Type | Notes |
|---|---|---|
| `tenant_id` | uuid **PK** | = `auth.users.id`; root of isolation |
| `name` / `email` | text | display |
| `fal_api_key` | text | **n8n reads per-tenant** |
| `anthropic_api_key` | text | **n8n reads per-tenant** |
| `product_briefing` | text | freeform; fed into prompts |
| `company_briefing` | text | freeform; fed into prompts |
| `onboarded` | bool | default false; gates the full UI |
| `role` | text | default `'tenant'`; `tenant`/`super_admin` |
| `status` | text | default `'active'`; `active`/`suspended`/`removed` — **n8n only processes `active`** |
| `created_at`/`updated_at` | timestamptz | |

### 7.3 `tiktok_accounts` — human input (web writes; n8n reads)
| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | chain root |
| `tiktok_id` | text NOT NULL **UQ** | handle, no `@` |
| `name` | text NOT NULL | |
| `gender` | text NOT NULL | `female`/`male` — drives persona look |
| `country` | text NOT NULL | drives look + language |
| `age` | int NOT NULL, CHECK 0–120 | UI enforces 13–120 |
| `language` | text NOT NULL | |
| `tenant_id` | uuid | owner; web stamps it. NULL = admin/global |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | bumped by `trg_tiktok_accounts_updated_at` |

> **Identity fields = `gender, age, country, language`.** Editing any of these
> invalidates the persona → triggers a cascade delete (see §9). Editing only
> `name` does not.

### 7.4 `personas` — Phase A (n8n writes)
| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | |
| `tiktok_account_id` | bigint FK NOT NULL **UQ** | 1:1 with account |
| `portrait_storage_url` | text | **Storage URL of portrait (primary)** |
| `prompt_used` | text | portrait prompt |
| `status` | text | default `'done'` |
| `drive_file_id` / `drive_url` | text | **LEGACY** |
| `tenant_id` | uuid *(trigger)* | from account |
| `created_at` | timestamptz | |

### 7.5 `outputs` — Phase B scene images (n8n writes)
| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | |
| `persona_id` | bigint FK NOT NULL | |
| `scenario_id` | text NOT NULL | from `scenarios` |
| `scenario_title` | text | human-readable |
| `image_storage_url` | text | **Storage URL of scene image (primary)** |
| `qc_status` | text | `pass` / `skipped` |
| `qc_reason` | text | `defect \| score \| resemblance \| attempts` |
| `attempts` | int | default 1 (QC retries used) |
| `prompt_used` | text | **image prompt (n8n must fill; null today)** |
| `drive_file_id` / `drive_url` | text | **LEGACY** |
| `tenant_id` | uuid *(trigger)* | from persona |
| `created_at` | timestamptz | |
| — | — | **UQ (persona_id, scenario_id)** → Phase B upsert key |

### 7.6 `videos` — Phase C clips (n8n writes)
| Column | Type | Notes |
|---|---|---|
| `id` | bigint **PK** | |
| `output_id` | bigint FK **UQ** | 1:1 with scene image |
| `scenario_id` | text | copied from output |
| `storage_url` | text | **Storage URL of mp4 (primary)** |
| `prompt_used` | text | Seedance/video prompt |
| `dialogue` | text | spoken dialogue |
| `status` | text | default `'done'` |
| `drive_file_id` / `drive_url` | text | **LEGACY** |
| `tenant_id` | uuid *(trigger)* | from output |
| `created_at` | timestamptz | |

### 7.7 `tiktok_auth` — OAuth tokens (1:1 account; n8n reads to post)
`tiktok_account_id` **PK** FK · `access_token` NOT NULL · `refresh_token` NOT NULL ·
`expires_at` NOT NULL · `open_id` NOT NULL · `scope` · `tenant_id` *(trigger)* ·
`updated_at`.

### 7.8 `tiktok_posts` — one row per published video (n8n writes)
`id` PK · `video_id` FK NOT NULL **UQ** · `tiktok_account_id` FK NOT NULL ·
`publish_id` · `status` NOT NULL · `tiktok_post_url` · `error_reason` ·
`posted_at` · `tenant_id` *(trigger)* · `created_at`.

### 7.9 `tenant_images` — reference uploads (web writes; n8n reads)
`id` PK · `tenant_id` NOT NULL · `storage_url` NOT NULL (bucket `tenant-images`) ·
`file_name` · `created_at`. No product-vs-brand distinction.

### 7.10 `tenant_run_configs` — per-tenant run settings (web writes; n8n reads)
| Column | Type | Notes |
|---|---|---|
| `tenant_id` | uuid **PK** | |
| `one_per_persona` | bool | true = every persona this run; false = only personas with no video |
| `tiktok_id` | text | targeting override (csv handles); null = all accounts |
| `max_videos_per_run` | int | scenarios per selected persona this run |
| `max_qc_attempts` | int | QC retries before skipping an image |
| `video_duration` | text | e.g. `'15'` (seconds) |
| `video_resolution` | text | e.g. `'1080p'` |
| `updated_at` | timestamptz | |

> Total videos per run = selected personas × `max_videos_per_run`. Keep below
> n8n's ~40-minute execution cap.

### 7.11 `tenant_run_status` — run telemetry (n8n writes; web reads)
`tenant_id` PK · `status` (`running`/`completed`/`failed`) · `started_at` ·
`finished_at` (null while running) · `personas_made` · `images_made` ·
`videos_made` · `message` · `execution_id` (indexed; Error Trigger looks up the
tenant by it) · `updated_at`.

### 7.12 `scenarios` — scene catalog (seeded; n8n reads). The generation source.
| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `index_no` | int partial **UQ** | order 1..N for curated; NULL for generated |
| `scenario_id` | text NOT NULL **UQ** | stable id (`gym_post_workout_mirror_01`); copied onto `outputs.scenario_id` |
| `tenant_id` | uuid FK | **NULL = curated/shared (all tenants); set = tenant-specific generated** |
| `source` | text | `'curated'` / `'generated'` |
| `category`/`difficulty`/`scenario_title` | text | denormalized for filtering |
| `content` | jsonb NOT NULL | **full scene recipe** (scene, outfit, pose, hand_assignment, grip_or_placement, lighting, mood, palette, framing, camera_height) |
| `composed_attributes` | jsonb NOT NULL | 15 canonical learning tags (archetype, scene_category, environment, has_phone, product_hand, hold_type, grip_level, box_orientation, framing, camera_height, lighting_type, time_of_day, mirror, fabric_family, difficulty) |
| `version` | text | content version (`'v1'`) |
| `content_hash` | text | md5 of `content` |
| `active` | bool | only `active=true` curated rows are processed |
| `created_at`/`updated_at` | timestamptz | |

Seeded with **60 curated scenarios** (`seed_scenarios_60.md`).

### 7.13 `asset_ratings` — human QA / RLHF (web writes; learning reads). One per output.
| Column | Type | Notes |
|---|---|---|
| `id` | bigint PK | |
| `tenant_id` | uuid *(trigger)* | from output |
| `output_id` | bigint FK NOT NULL **UQ**, ON DELETE CASCADE | upsert key |
| `video_id` | bigint FK, ON DELETE SET NULL | |
| `persona_id`/`tiktok_account_id` | bigint | snapshot |
| `scenario_id`/`scenario_title` | text | snapshot |
| `image_prompt` | text | from `outputs.prompt_used` |
| `video_script` | text | from `videos.prompt_used` / `videos.dialogue` |
| `image_storage_url`/`video_storage_url` | text | snapshot |
| `rater_id` | text | who rated |
| `asset_triage` | text | `Accept`/`Reject`/`Flag` (required to save) |
| `image` | jsonb default `{}` | `{gates, scores, notes}` |
| `video` | jsonb default `{}` | `{gates, scores, notes}` |
| `image_rated`/`video_rated` | bool | derived (see §11) |
| `rubric_version` | text | config version (`'v1'`) |
| `composed_attributes` | jsonb | scenario tags snapshot (NOT written by app today → NULL; learning joins instead) |
| `scenario_version` | text | scenario content version snapshot (NULL today) |
| `created_at`/`updated_at` | timestamptz | |

JSONB shape: `{"gates":{"<id>":{"result":"Pass|Fail|null","auto_value":<n|null>,"disputed":bool}},"scores":{"<id>":1..5|null},"notes":{"<id>":"text"}}`

### 7.14 Learning layer (n8n writes/reads; optional for a basic rebuild)
- `attribute_stats` — per-tenant running tallies per `attribute_key × dimension`
  (`n, passes, sum_val, sum_sq, estimate`; UQ `(tenant_id, context_key,
  attribute_key, dimension)`). n8n's LEARN job upserts these.
- `attribute_priors` — cross-tenant cold-start pool, same shape without `tenant_id`.
- `tuning_suggestions` — prompt/script fixes (`scope_type`, `scope_key`,
  `dimension`, `cause`, `suggested_edit`, `status` candidate→testing→validated/rejected).
  Only `validated` rows alter prompts.
- `tenant_learning_state` — the **exploration → active gate**:
  `phase` (exploration/active) · `engine_enabled` (the switch n8n reads;
  `false` = process all curated scenarios in order; `true` = engine-driven
  selection) · `min_coverage_pct` (flip threshold, default 100) · audit timestamps.
- `v_tenant_exploration_progress` — VIEW: `active_curated`, `resolved_curated`,
  `pct_complete`, `is_complete`. A curated scenario is **resolved** when it hits a
  terminal state: `qc_status='skipped'` OR (`qc_status='pass'` AND its rating
  `video_rated=true`).

### 7.15 `impersonation_events` — super-admin audit (web only)
`id` PK · `actor` default `'super_admin'` · `tenant_id` NOT NULL · `tenant_name` ·
`tenant_email` · `action` (`view_page`/`suspend`/`reactivate`/`remove`) · `created_at`.

### 7.16 Triggers & functions
| Trigger | Table | Timing | Effect |
|---|---|---|---|
| `trg_tiktok_accounts_updated_at` | tiktok_accounts | BEFORE UPDATE | `updated_at = now()` |
| `trg_persona_tenant` | personas | BEFORE INS/UPD | tenant_id ← account |
| `trg_output_tenant` | outputs | BEFORE INS/UPD | tenant_id ← persona |
| `trg_video_tenant` | videos | BEFORE INS/UPD | tenant_id ← output |
| `trg_tiktok_auth_tenant` | tiktok_auth | BEFORE INS/UPD | tenant_id ← account |
| `trg_tiktok_posts_tenant` | tiktok_posts | BEFORE INS/UPD | tenant_id ← account |
| `trg_asset_rating_tenant` | asset_ratings | BEFORE INS/UPD | tenant_id ← output |

---

## 8. The web interface — every page, button, and DB effect

The Dashboard (`Dashboard.jsx`) is the authenticated member shell. It owns the
view state and all modals. Four views, switched from the Sidebar:
`accounts` · `publishing` · `analytics` · `settings`.

### 8.0 First-run gate (member only)
On a member's first sign-in, `useTenant` creates a `tenant_profiles` stub
(`onboarded=false`). Until they finish setup:
- The Accounts view renders **`TenantSetup`** instead of the accounts UI.
- Onboard and Run controls are hidden.
A **suspended/removed** tenant is blocked entirely with a "contact administrator"
screen (bypassed when a super-admin is impersonating, `impersonated=true`).

### 8.1 Tenant Setup page (`TenantSetup.jsx`)
Collects 5 things → **Finish setup** button (`useTenant.saveSetup`):
1. Fal API key, 2. Anthropic API key, 3. Reference images (multi-upload), 4.
Product briefing, 5. Company briefing.

**DB effect:** for each file → upload to bucket `tenant-images`, insert a
`tenant_images` row (`tenant_id, storage_url, file_name`). Then `UPDATE
tenant_profiles SET fal_api_key, anthropic_api_key, product_briefing,
company_briefing, onboarded=true, updated_at`. → full UI unlocks.

### 8.2 Accounts view (`AccountsPanel.jsx`, `Stats.jsx`, modals)
The only table humans fill. Topbar shows **Onboard**, **Run settings**, and the
**Run** control (all only when `onboarded`).

**Stats cards** (`Stats.jsx`, derived client-side from `accounts[]`): Total ·
Countries · Languages · Added this week.

**Buttons & triggers:**

| Button / action | Where | Effect |
|---|---|---|
| **Onboard** | Topbar / empty-state CTA | opens `AccountFormModal` (create mode) |
| **Pencil** (row) | table / card | opens `AccountFormModal` (edit mode, prefilled) |
| **Trash** (row) | table / card | opens `DeleteModal` |
| **Reload** | panel header | re-runs `useAccounts.load()` |
| free-text search | Topbar (`/` focuses) | client-side filter on `tiktok_id, name, country, language` |
| gender / country filter | panel | client-side filter |

**AccountFormModal (create):** strips leading `@`, trims, parses age, validates
all-fields-present + age 13–120. → `INSERT INTO tiktok_accounts (...payload,
tenant_id)` `.select().single()`; optimistic prepend. Unique-violation on
`tiktok_id` → friendly inline error ("A TikTok account with that ID already exists.").

**AccountFormModal (edit):** → `UPDATE tiktok_accounts SET ... WHERE id`. **If an
identity field (`gender/age/country/language`) changed, runs the cascade delete
FIRST** (§9), then the update. Toast tells the user the persona will be
regenerated next run.

**DeleteModal (confirm):** → cascade delete children (§9), then `DELETE FROM
tiktok_accounts WHERE id`. (The FK from `personas` has no `ON DELETE CASCADE`, so
children must be cleared first.)

### 8.3 Run controls (`RunControl.jsx`, `RunConfigModal.jsx`)

**Run settings** button → `RunConfigModal`. Saving → `UPSERT tenant_run_configs`
(coerces numbers, empty → null). Required to enable Run:
`max_videos_per_run≥1, max_qc_attempts≥1, video_duration, video_resolution`
(`isRunConfigComplete`).

**Run** button (`handleRun`):
1. If config incomplete → opens Run settings modal + info toast. Stops.
2. Else `saveRunConfig(runConfig)` (persists to DB so n8n can read it).
3. `usePipelineRun.run()` → `supabase.functions.invoke('trigger-pipeline', { body: { tenant_id } })`.
4. On `{ok:true}` → persist `runStartedAt` to `sessionStorage` (`alluvi.runStartedAt`) → success toast.
5. On error → toast mapped from `RUN_ERRORS` (`auth_failed`, `not_found`,
   `network`, `function_unreachable`, `missing_secrets`, `unknown`).

> **The Run button writes nothing to the pipeline tables itself.** It only saves
> run config + POSTs to n8n. All pipeline rows appear because n8n inserts them.

**Run state machine (the pill, `useRunProgress` polls every 20s, tenant-scoped):**

| State | Condition | UI |
|---|---|---|
| idle | no `runStartedAt` | green **Run** button |
| active | rows appearing since run start | live pill `N personas · M images · K videos` |
| completed | `tenant_run_status.status='completed'` (reliable) **OR** progressed then quiet 5 min (heuristic) | green **Pipeline complete · N videos** pill + **Run again** |
| stalled | no rows at all for 45 min | amber **Run stalled** pill + **Re-run** |

The pill survives refresh/view-switch (sessionStorage). The **X** clears the local
indicator only (does NOT cancel the n8n run). Polling counts rows in
`personas/outputs/videos` with `created_at > runStartedAt` and reads
`tenant_run_status`.

### 8.4 Publishing view (`PublishingPanel.jsx`, `usePublishingForAccount`)
Master list of accounts → click an account → gallery of 9:16 cards (latest-first),
each card = one `outputs` row (scene image) with an optional nested 1:1 `videos` row.

**Query:** find the persona for the account (`personas` where
`tiktok_account_id`), then `outputs` (`id, created_at, scenario_id,
scenario_title, persona_id, prompt_used, image_storage_url, drive_*` + nested
`videos(id, storage_url, drive_*, prompt_used, dialogue)`) ordered by
`created_at DESC`. Tenant defense-in-depth filter applied.

**Buttons & triggers:**

| Button | Effect |
|---|---|
| card click | opens **Lightbox**; if it has a video, plays native `<video>` from `storage_url` |
| **Compare** | shows video + source image side by side |
| **Download image / Download video** | downloads the Storage file (`downloadAsset`) |
| **Rate** | closes the lightbox, opens `RatingWorkspace` for that output |
| (auto) image/video mirror | on legacy rows missing a Storage URL, invokes `mirror-image`/`mirror-video` to self-heal, then patches local state |

### 8.5 Analytics view (`AnalyticsPanel.jsx`, `useAnalytics`)
Read-only. Pulls lean columns of all 4 chain tables in parallel (admin = whole
pipeline; member = `eq('tenant_id')` per table) and computes everything
client-side:
- KPI hero, pipeline funnel (accounts→personas→passed images→videos),
- QC quality from `outputs.qc_status` / `attempts`,
- demographics from `gender/age/country/language`,
- top scenarios by `scenario_id`, top accounts by video count (lineage walked
  `video.output_id → output.persona_id → persona.tiktok_account_id`),
- recent activity from `created_at`.

Shows zeros until the pipeline has produced rows. **No DB writes.**

### 8.6 Settings view (`SettingsPanel.jsx`, `useSettings`)
A form for **Fal API key** + **Anthropic API key** (masked, show/hide). Reads &
writes the tenant's own `tenant_profiles.fal_api_key` / `anthropic_api_key`
(empty → NULL, sets `updated_at`). Same columns the setup page and the super-admin
Edit modal write — one source of truth.

### 8.7 Rating workspace / RLHF (`RatingWorkspace.jsx`, `useAssetRating`)
Full-screen QA window opened from **Rate**. Rates one generation = one `outputs`
row + its 1:1 `videos` row. Layout: video rubric · video · source image · image
rubric. Top bar: triage + Save.

**Controls:** Pass/Fail gates · 1–5 scores · conditional "Why?" notes (on Fail or
score ≤ 2) · triage (Accept/Reject/Flag, required). Auto gates show an
"Auto · pending" badge and store `disputed:true` + `auto_value:null` (no pipeline
metric yet). Media supports zoom/pan. Keyboard shortcuts (1–5 score, P/F gate, etc.).
Save is disabled until the draft differs from the loaded baseline (`isDirty`,
order-independent compare because JSONB reorders keys).

**Rubric (config-driven, `src/lib/ratingConfig.js`, `RUBRIC_VERSION='v1'`):**
- Image: 8 gates + 5 scores. Video: 5 gates + 7 scores. + 1 triage.

**DB effect (Save):** `UPSERT asset_ratings ON CONFLICT (output_id)` with the
draft `image`/`video` JSONB + a context snapshot (`output_id, video_id,
persona_id, tiktok_account_id, scenario_id, scenario_title, image_prompt,
video_script, image_storage_url, video_storage_url, rater_id`). Derives
`image_rated = Boolean(triage) || hasInput(image)` and `video_rated =
hasInput(video)`. `tenant_id` auto-stamped by trigger. (`image_rated` is ~always
true because triage is mandatory; `video_rated` is the meaningful signal that
drives the exploration→active flip.)

### 8.8 Super Admin console (`SuperAdminApp.jsx` + `SuperAdmin*`, `useSuperAdmin`)
Platform-owner only. Three views: **Overview / Tenants / Activity**.
- **Overview** (`SuperAdminOverview`): platform totals, top tenants by videos,
  setup-pending. Reads all `tenant_profiles` + chain aggregates (counts +
  qc pass/skip) and estimated cost via `lib/cost.js` (`COST_RATES`: $0.05/image,
  $0.20/video — placeholders, no real metering).
- **Tenants list** (`TenantsList`): status badges, "show removed" toggle, last-active.
- **Tenant detail** (`TenantDetail`): counts, QC pass-rate, est. cost, **API keys**
  (masked+reveal), briefings, per-account table.
  - **Edit** (`TenantConfigModal`) → writes `tenant_profiles` config columns.
  - **Suspend / Reactivate / Remove** (`TenantActionModal`) → `setTenantStatus`
    (`lib/tenantAdmin.js`) writes `tenant_profiles.status` + `updated_at`, and
    logs an `impersonation_events` row (`suspend`/`reactivate`/`remove`).
  - **Page** → impersonation: renders the tenant's exact Dashboard with
    `ImpersonationBanner` and logs a `view_page` event.
- **Activity** (`AuditLogPanel`, `useAuditLog`): reads `impersonation_events`
  (latest 100).

Lifecycle: `status` active/suspended/removed; suspended/removed members are
blocked at their own login (gate in `Dashboard.jsx`); removed = reversible
tombstone (hidden + excluded from totals).

---

## 9. Cascade delete (web-app responsibility)

When an identity field changes on an account, **or** when an account is deleted,
the web app deletes the account's pipeline artifacts **children-first** so the
next n8n run rebuilds from the new identity (`useAccounts.cascadeDeleteForAccount`):

```
1. find personas WHERE tiktok_account_id = :id        → personaIds
2. find outputs  WHERE persona_id IN personaIds       → outputIds
3. DELETE videos  WHERE output_id IN outputIds
4. DELETE outputs WHERE id        IN outputIds
5. DELETE personas WHERE id       IN personaIds
```

- Triggered on **edit** only when `gender/age/country/language` changed
  (`identityChanged`); editing only `name` skips it. Runs **before** the row
  update (so a failed update just regenerates from the unchanged identity).
- Triggered on **delete** always (FK from `personas` has no `ON DELETE CASCADE`).
- `asset_ratings` rows are removed automatically via their `ON DELETE CASCADE`
  from `outputs`.

> Ideally this becomes a single Supabase RPC for atomicity; today it is sequential
> client-side deletes.

---

## 10. n8n pipeline contract (the other side of the DB)

n8n receives `{ tenant_id }` from the `trigger-pipeline` Edge Function and runs:

| Stage | n8n READS | n8n WRITES |
|---|---|---|
| **Run start** | `tenant_run_configs`, `tenant_profiles` (keys/briefings/status/onboarded), `tenant_learning_state`, `tiktok_accounts` (by tenant, respecting `tiktok_id` targeting), `scenarios` (active, curated, by `index_no`) | `tenant_run_status='running'` (+ `execution_id`); ensure `tenant_learning_state` row |
| **Phase A** | accounts, personas | upload portrait → `personas` bucket; UPSERT `personas` (portrait_storage_url, prompt_used) ON CONFLICT `tiktok_account_id` |
| **Phase B** | `personas.portrait_storage_url`, `scenarios.content`, existing `outputs`/`videos` | upload image → `images` bucket; UPSERT `outputs` (image_storage_url, prompt_used, scenario_id/title, qc_status, qc_reason, attempts) ON CONFLICT `(persona_id, scenario_id)` |
| **Phase C** | `outputs` where `qc_status='pass'` without a video | upload mp4 → `videos` bucket; UPSERT `videos` (storage_url, prompt_used, dialogue) ON CONFLICT `output_id` |
| **Posting** | `tiktok_auth`, `videos` | `tiktok_posts` |
| **LEARN** | `asset_ratings`, `outputs.qc_status`, `scenarios.composed_attributes` | `attribute_stats` (a `qc_status='skipped'` output = automatic image-gate fail for every attribute in that scenario) |
| **Gate flip** | `v_tenant_exploration_progress`, `tenant_learning_state` | `tenant_learning_state` → `active`/`engine_enabled=true` when `pct_complete ≥ min_coverage_pct` |
| **Run end** | — | `tenant_run_status='completed'` / `'failed'` |

**Hard rules for n8n:** never set `tenant_id`, `storage_url`, or `image_storage_url`
on inserts that the triggers/web own; skip tenants where `status<>'active'` or
`onboarded=false`; only `qc_status='pass'` outputs advance to Phase C; a
`(persona, scenario)` with an existing video is skipped permanently (delete the
`videos` row to redo).

### Edge Functions (Deno, `supabase/functions/`)
- **`trigger-pipeline`** — holds the n8n Basic-Auth secrets; forwards
  `{ tenant_id }` to the n8n webhook. **Deploy with `--no-verify-jwt`** (the
  `sb_publishable_…` key is not a JWT). CORS currently `*` (lock to prod origin).
- **`mirror-image` / `mirror-video`** — legacy bridge: fetch a Drive asset
  server-side, upload to Storage with the service-role key, write the URL.

---

## 11. The rating data model (how an answer becomes a row)

In-memory draft while rating:
```js
{ triage: 'Accept'|'Reject'|'Flag'|null,
  image: { gates:{<id>:{result,auto_value,disputed}}, scores:{<id>:1..5|null}, notes:{<id>:string} },
  video: { gates:{...}, scores:{...}, notes:{...} } }
```
- Gate click → `result:'Pass'|'Fail'`; auto gates also set `disputed:true`.
- Score click → integer 1..5. Note typed → `notes[id]`.
- Save derives `image_rated`/`video_rated`, snapshots context, upserts by
  `output_id`. `rubric_version` records which config produced the row, so old rows
  stay interpretable when the rubric changes. (Why JSONB and not a column per
  question: the rubric is config-driven — adding/removing a dimension is a config
  edit, no migration.)

Full rubric item ids: see `read/RLHF.md` §2–3 and `src/lib/ratingConfig.js`.

---

## 12. State, theming, toasts (cross-cutting UI)

- **Theme** (`useTheme`): `localStorage['alluvi.theme']`, falls back to
  `prefers-color-scheme`; writes `<html data-theme>`. Toggle anywhere.
- **Toasts** (`ToastContext`): `useToast() → {success, error, info}`; bottom-right
  stack, auto-dismiss ~3.2s, `aria-live="polite"`.
- **Keyboard:** `/` focuses search (on views with search, when not in an input/modal).
- **Modal primitive** (`Modal.jsx`): portal + scrim + Escape-to-close + body scroll lock.
- **Responsive:** ≤1080px stats→2 cols; ≤760px sidebar becomes off-canvas drawer,
  table→card list, modals dock as bottom sheets; ≤380px stats→1 col.
  `prefers-reduced-motion` clamps animations.

---

## 13. File map (where each responsibility lives)

```
src/
  main.jsx               ReactDOM root → <App/>
  App.jsx                auth gate + super-admin/member routing
  index.css              all styles (CSS variables, ~1100 lines)
  lib/
    constants.js         env-driven Supabase URL/key, admin creds, COST_RATES, dropdowns
    supabase.js          createClient singleton (persistSession:true)
    assets.js            downloadAsset(url, filename)  [Drive removed]
    utils.js             formatDate, gender helpers, isMissingTableError, friendlySupabaseError
    ratingConfig.js      rubric source of truth + RUBRIC_VERSION
    cost.js              computeCost({images,videos})
    tenantAdmin.js       setTenantStatus(tenantId, status)
    audit.js             logImpersonation / logTenantAction → impersonation_events
  contexts/ToastContext.jsx
  hooks/
    useAuth.js           super-admin flag + Supabase member auth
    useTenant.js         tenant_profiles load/create + saveSetup
    useAccounts.js       tiktok_accounts CRUD + cascade delete
    useAnalytics.js      parallel lean fetch of the 4 chain tables
    usePublishing.js     persona→outputs(+videos) for one account + mirror helpers
    useAssetRating.js    load/upsert asset_ratings by output_id
    useRunConfig.js      tenant_run_configs load/upsert + isRunConfigComplete
    usePipelineRun.js    invoke trigger-pipeline; persist runStartedAt
    useRunProgress.js    20s polling of pipeline counts + tenant_run_status
    useSuperAdmin.js     all tenants + aggregates + cost
    useSettings.js       tenant_profiles api-key columns
    useAuditLog.js       impersonation_events feed
    useTheme.js          light/dark
  components/            (presentational + containers — see §8 per-view)
supabase/
  functions/             trigger-pipeline, mirror-image, mirror-video (Deno)
  *.sql                  migrations (see §14)
```

---

## 14. Rebuild order (migrations)

Apply in order on a fresh Supabase project (all idempotent; **skip #3 — dropped**):

| # | File | Adds |
|---|---|---|
| 1 | `supabase_schema.sql` | core chain `tiktok_accounts → personas → outputs → videos` |
| 2 | `tiktok_posting_migration.sql` | `tiktok_auth`, `tiktok_posts` |
| 3 | ~~`app_settings_migration.sql`~~ | **DROPPED — skip** (keys live in `tenant_profiles`) |
| 4 | `multitenancy_migration.sql` | `tiktok_accounts.tenant_id`, `tenant_profiles`, `tenant_images`, bucket `tenant-images` |
| 5 | `video_storage_migration.sql` | `videos.storage_url`, `outputs.image_storage_url`, buckets `videos`,`images` |
| 6 | `super_admin_migration.sql` | `tenant_profiles.role` |
| 7 | `impersonation_audit_migration.sql` | `impersonation_events` |
| 8 | `tenant_lifecycle_migration.sql` | `tenant_profiles.status`, `impersonation_events.action` |
| 9 | `tenant_id_everywhere_migration.sql` | `tenant_id` on children + the propagation triggers |
| 10 | `run_config_migration.sql` | `tenant_run_configs` |
| 11 | `asset_ratings_migration.sql` | `asset_ratings` + tenant trigger |
| 12 | `outputs_prompt_and_rating_cleanup_migration.sql` | `outputs.prompt_used`; drops `asset_ratings.product_id`/`seed` |
| 13 | `pipeline_run_status_migration.sql` | `tenant_run_status` |
| 14 | `learning_layer_v2_migration.sql` | `scenarios`, learning tables, view, `asset_ratings.composed_attributes`/`scenario_version` |
| 15 | `seed_scenarios_60.md` (SQL) | 60 curated rows into `scenarios` |
| 16 | `drive_to_storage_migration.sql` | `personas.portrait_storage_url`, bucket `personas`, legacy comments |
| 17 | `run_status_execution_id_migration.sql` | `tenant_run_status.execution_id` |

Then: deploy the 3 Edge Functions (`--no-verify-jwt`), set the n8n secrets, turn
**OFF** Supabase "Confirm email", and point `.env` at the project.

---

## 15. Known issues & hardening backlog

1. **Secrets in bundle** — super-admin password hardcoded in
   `src/lib/constants.js`; publishable key shipped to client. Move admin to real
   Supabase Auth; rotate the password.
2. **RLS disabled** on all tables (`GRANT ALL` to anon). Enable RLS keyed on
   `auth.uid()` before public launch (requires moving admin off the anon path first).
3. **Tenant isolation is frontend-only** today (filters, not RLS).
4. **Dead code:** `useTenant.js` checks `user?.kind === 'admin'`, but `useAuth`
   only emits `'super_admin'` / `'member'`. Harmless (admins never reach the
   tenant Dashboard) but should be cleaned up.
5. **Age constraint mismatch** — DB CHECK is 0–120; UI enforces 13–120. Tighten DB.
6. **`asset_ratings` snapshot gap** — `composed_attributes` / `scenario_version`
   are never written by the app (always NULL); the learning job must join
   `asset_ratings → outputs.scenario_id → scenarios` instead.
7. **`outputs.prompt_used`** — n8n must start writing the image prompt; null today,
   so `asset_ratings.image_prompt` is often empty.
8. **Cost is estimated**, not metered (`COST_RATES` placeholders).
9. **Run trigger has no abuse protection** — anyone with the anon key + function
   URL can trigger a run. Add a rate limit / signed-in check; lock CORS to the
   prod origin.
10. **Storage free tier** ≈ 1 GB (~66 videos at 15 MB). Repoint buckets to
    Cloudflare R2 when it runs out (single swap point in the upload target).

---

*End of `rule.md`. This is the rebuild contract: the schema is the integration
boundary, `tenant_id` propagates via triggers, the web app owns human input and
the n8n workflow owns generation, and everything meets in Supabase.*
