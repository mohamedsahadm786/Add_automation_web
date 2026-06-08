# Update Log — 2026-06-04 (Session 4)

> Worked against the live **`gopfnogmceyqkrvgkeup` (alluvi-dev)** DB (treated as
> production). This session: reconciled the recommendation-engine migration from the
> separate n8n/engine Claude chat, **dropped the dead `app_settings` table**, **ran a
> full fresh-start wipe → zero tenants**, diagnosed a post-wipe signup/email issue,
> and **added zoom-to-inspect** on the rating workspace media. The new Drive-free
> n8n flow is reportedly built (separate chat) — not verified-live from here yet.

## 0. ⚠️ Current state after this session — read first
- DB is **WIPED to zero tenants** (fresh start). All tenant/pipeline/rating/learning
  data gone; IDs reset. **Preserved:** 60 curated `scenarios`, all table structures,
  super-admin login (hardcoded, not in DB), n8n/Edge secrets.
- **`app_settings` table DROPPED** — no longer exists.
- **`learn_run_state` was NEVER created** (final engine migration is full-recompute);
  **`outputs.updated_at` does NOT exist** (still). Don't assume either is present.
- Migrations applied: #1–#17 (`DB_SCHEMA_FULL.md §0`) **minus** #3 (`app_settings`,
  dropped) **plus** the learning-engine perf indexes (below).
- **OPEN auth follow-up:** the wipe did NOT clear `auth.users` automatically (it only
  cleared `public.*`). If signup still misbehaves, see §4.

## 1. Recommendation-engine migration — reconciled & applied
- First draft from the engine chat errored: it created an index on
  `outputs.updated_at`, a column that doesn't exist → in the single-tx Supabase SQL
  editor the **whole script rolls back**. Full review was written to
  `n8n_handoff_brief.md` (that file is now a scratch pad for cross-chat messages —
  its original tenant-onboarding content was overwritten; reproducible from
  `DB_SCHEMA_FULL.md §4`).
- Engine chat revised → **LEARN job is now FULL-RECOMPUTE**: no cursor table, no
  `outputs.updated_at`. Final required SQL = **none**; only two optional perf indexes:
  - `idx_outputs_qc_status` — already existed by that exact name → **true no-op**.
  - `idx_tuning_source_output` on `tuning_suggestions(source_output_id)` — new.
- **Ran:** that migration + the `execution_id` block (identical to migration #17,
  `tenant_run_status.execution_id` + index) + the post-run self-test → **passed**
  (view returns rows, insert/delete on `attribute_stats` OK).
- Storage buckets `personas`/`images`/`videos`/`tenant-images` confirmed **public**.

## 2. Web-app `asset_ratings` write contract — verified vs the engine's spec
Checked `useAssetRating.js`, `ratingConfig.js`, `RatingWorkspace.jsx`:
- ✅ **JSONB shape** exact: `image`/`video` = `{gates:{id:{result,auto_value,disputed}}, scores:{id:1..5|null}, notes:{id}}`. Auto gates set `disputed:true`.
- ✅ **All 25 rubric IDs** match the engine's list exactly (8+5 image, 5+7 video).
- ✅ Keys/flags: one row per `output_id` (upsert), `updated_at`, `asset_triage`,
  `rubric_version`; `tenant_id` left to the DB trigger.
- ❌ **GAP — snapshot not implemented:** `composed_attributes` / `scenario_version`
  are NEVER written by the app (always NULL). Engine must JOIN
  `asset_ratings → outputs.scenario_id → scenarios` instead. (Or ask web to populate.)
- ⚠️ `image_rated` is ~**always true** (triage is required to save) — not a reliable
  "image rubric filled" signal; `video_rated` is the meaningful one (it drives the
  exploration→active flip). `v_tenant_exploration_progress.pct_complete` is **not
  surfaced in the UI** (requested-but-missing nice-to-have).

## 3. Dropped `app_settings` (dead legacy table)
- Settings bar is **already multitenant** — `useSettings(tenantId)` reads/writes the
  tenant's own `tenant_profiles` row; onboarding (`useTenant.saveSetup`) writes the
  keys there too. `app_settings` had **0 runtime references** (only a comment).
- Ran `drop table if exists public.app_settings`. Docs updated: `DB_SCHEMA_FULL.md
  §0/§6.2`, `read/db_for_n8n.md §8`, memory. (The `supabase/app_settings_migration.sql`
  file is now obsolete — left as a historical artifact.)

## 4. Fresh-start wipe → ZERO tenants (EXECUTED)
- Ran the wipe as one transaction. What it did:
  - `TRUNCATE … RESTART IDENTITY CASCADE` on the pipeline chain (`asset_ratings`,
    `tiktok_posts`, `tiktok_auth`, `videos`, `outputs`, `personas`, `tiktok_accounts`)
    + side tables (`tenant_images`, `tenant_run_configs`, `tenant_run_status`,
    `impersonation_events`) + learning tables (`attribute_stats`, `attribute_priors`,
    `tuning_suggestions`, `tenant_learning_state`).
  - `delete from scenarios where source='generated'` (0 rows — guard; curated kept).
  - `delete from tenant_profiles` (row-level cascade — curated scenarios `tenant_id
    NULL` untouched). **Key landmine avoided:** must NOT `TRUNCATE tenant_profiles
    CASCADE` — that would wipe the whole `scenarios` table (incl. curated 60).
- Verified clean: all data tables 0, `scenarios` curated = 60.
- **POST-WIPE AUTH ISSUE (diagnosed):** new signups got **no confirmation email**.
  Cause = TWO things: (a) `public.tenant_profiles` ≠ `auth.users` — the SQL wipe
  cleared the app tables but **NOT** Supabase Auth, so the previously-used emails
  **still existed in `auth.users`**, and Supabase **silently sends nothing when an
  email already exists** (anti-enumeration); (b) Supabase's built-in confirmation
  email is rate-limited/unreliable, and this app is designed to run with **"Confirm
  email" OFF**. **Fix:** delete the stale rows in dashboard → Authentication → Users
  (or `delete from auth.users;`) **and** turn OFF Authentication → Sign In/Providers →
  Email → "Confirm email", then sign up again. *(Confirm whether this was completed.)*

## 5. NEW FEATURE — zoom-to-inspect on rating media (SHIPPED)
- Added a `ZoomableMedia` wrapper in `RatingWorkspace.jsx` around both the video and
  the source image. Zoom via **+/− buttons** (top-right overlay) or **scroll wheel**
  (1×–4×); **drag-to-pan** when zoomed; **double-click / reset button** to reset.
- Zoom is **clipped to the frame** (`overflow:hidden`) and the pan offset is
  **clamped** so content always covers the box — never overflows the rectangle.
  At 1× the video's native controls work normally (pan only engages when zoomed).
- CSS in `index.css`: `.zoom-frame` (clipping box, same 9:16 size as old
  `.rating-frame`), `.zoom-inner` (transform), `.zoom-media`, `.zoom-controls`/`.zoom-btn`;
  added `.zoom-frame` to the ≤1100px responsive height rule. Empty states unchanged.
- `npm run build` → **green.**

## 6. NEXT — for tomorrow
- **Finish the auth reset** (§4) if not done: clear `auth.users` + turn off Confirm
  email → verify a fresh member signup → onboarding works end-to-end.
- **Confirm the live n8n** is the Drive-free version (reads `tenant_profiles` keys,
  `scenarios`; writes `*_storage_url`; writes `tenant_run_status`). Then smoke-test
  the Run button as a freshly onboarded tenant.
- **Drive-column removal (Phase 2, still BLOCKED).** Drop
  `personas`/`outputs`/`videos`.`drive_file_id`/`drive_url` ONLY after: (1) frontend
  stops naming them — `usePublishing.js` (lines 45-48, 70-71) + `useAnalytics.js`
  (lines 24, 50) explicitly `.select('… drive_file_id, drive_url …')`, so dropping now
  breaks Publishing + Analytics; (2) the live n8n is confirmed Drive-free. Order: edit
  FE → `npm run build` → drop columns. (DB drop SQL drafted in this chat.)
- **Optional:** decide the `asset_ratings` snapshot (§2 GAP) — engine-join vs.
  web-populate `composed_attributes`/`scenario_version`; and whether to surface
  `pct_complete` to reviewers.
- **Possible enhancement:** zoom-toward-cursor (currently zooms to center).

---

# Update Log — 2026-06-03 (Session 3)

> Builds on Session 2 (below). This session: finished the **Google Drive →
> Supabase Storage** removal (frontend + schema), shipped the **Learning Layer
> v2** schema + the **60-scenario catalog seed**, wired **`tenant_id` into the run
> trigger**, and produced the full **n8n hand-off doc set**. The DB target is now
> the **`gopfnogmceyqkrvgkeup` (alluvi-dev)** project, treated as the
> **final/production DB**. n8n is being rebuilt in a *separate* Claude chat
> against these docs — **n8n itself was not touched here.**

## 0. ⚠️ Current DB state — read this first
- **Final DB = `gopfnogmceyqkrvgkeup` (alluvi-dev).** All new work targets it. n8n
  trigger reuses the old credential (webhook `https://harveyd.app.n8n.cloud/webhook/run-alluvi-pipeline`).
- Migrations applied through **Learning Layer v2** + the seed + `run_status_execution_id`.
  Canonical order lives in **`DB_SCHEMA_FULL.md §0`** — verify #1–#17 are all applied.
- A separate **"learning engine" script** (from the n8n chat — it added
  `learn_run_state`, `outputs.updated_at` + trigger, the LEARN indexes, and a
  slimmer view) was **attempted then FULLY REVERTED**. So the DB currently does
  **NOT** have: `learn_run_state`, `outputs.updated_at`, the LEARN indexes, or the
  `is_complete`-less view. The view is still the original v2 one (with
  `is_complete`). → If we resume the LEARN job, land those cleanly (see §10).
  - Known landmine when we redo it: the LEARN index `idx_outputs_qc_updated` needs
    `outputs.updated_at`, which doesn't exist → add the column+trigger first, and
    the new view can't `create or replace` over the old one (drop it first:
    `42P16 cannot drop columns from view`).

## 1. Rating workspace — Save only on a real change
- Save is disabled until the draft differs from the loaded/saved baseline
  (`isDirty`); saving still upserts/overwrites by `output_id`.
- Fixed the gate-only bug where reverting a gate left Save enabled — gate values
  are objects and JSONB reorders their keys on load; compare now uses an
  order-independent `stableStringify`.
- File: `src/components/RatingWorkspace.jsx`.

## 2. Bug — two videos playing at once
- Opening **Rate** from the Publishing lightbox left the lightbox's autoplaying
  `<video>` running behind the rating workspace. Now opening Rate closes the
  lightbox first (`openRating` → `setLightbox(null)`).
- File: `src/components/PublishingPanel.jsx`.

## 3. Google Drive REMOVED → Supabase Storage only
- **Deleted** `src/lib/drive.js`; **added** `src/lib/assets.js` (`downloadAsset`).
- Publishing + Rating display only from `*_storage_url` (native `<img>`/`<video>`);
  Drive thumbnail/iframe/download gone. Legacy rows backfill once on view via the
  `mirror-image`/`mirror-video` functions (server-side), then serve from Storage.
  `PublishCard.hasVideo` now keys on id/storage_url.
- Files: `src/components/PublishingPanel.jsx`, `src/components/RatingWorkspace.jsx`.
- SQL: **`supabase/drive_to_storage_migration.sql`** — adds
  **`personas.portrait_storage_url`** + public bucket **`personas`**; marks
  `drive_*` columns LEGACY.
- Asset → bucket → column: portrait→`personas`→`personas.portrait_storage_url`;
  scene image→`images`→`outputs.image_storage_url`; video→`videos`→`videos.storage_url`;
  references→`tenant-images`→`tenant_images.storage_url`.
- Doc: **`read/drive_to_storage.md`**.

## 4. Learning Layer v2 + scenario catalog
- SQL: **`supabase/learning_layer_v2_migration.sql`** — `scenarios`,
  `attribute_stats`, `attribute_priors`, `tuning_suggestions`,
  `tenant_learning_state`, `v_tenant_exploration_progress` (QC-skip-aware),
  `asset_ratings.composed_attributes`/`scenario_version`; RLS-off + grants.
- Seed: **`seed_scenarios_60.md`** — 60 curated scenarios = the scene recipes that
  **drive generation**, now in the DB not Drive. `content` jsonb =
  scene/outfit/pose/grip/lighting/etc.; `composed_attributes` = 15 learning tags.
  **Category vocabulary expanded to ~39 values** (was a small set) → any
  category-keyed logic needs a default branch.

## 5. tenant_id wired into the run trigger (minimal web patch)
- `supabase/functions/trigger-pipeline/index.ts` now reads the incoming
  `tenant_id` and forwards `{ "tenant_id": "<uuid>" }` to n8n at the top level
  (was hardcoded `{}`).
- `src/hooks/usePipelineRun.js` → `usePipelineRun(tenantId)` sends it;
  `src/components/Dashboard.jsx` passes `tenantId`.
- **Deployed** `trigger-pipeline` to `gopfnogmceyqkrvgkeup` (`--no-verify-jwt`).
  **Secrets set** on that project: `N8N_WEBHOOK_URL/USER/PASS` (reusing the old
  n8n trigger credential).

## 6. run_status execution_id (for the Error Trigger)
- SQL: **`supabase/run_status_execution_id_migration.sql`** —
  `tenant_run_status.execution_id` (+ index). Orchestrator stamps its execution id
  at start; the n8n Error Trigger looks the tenant up by it to write `failed`.
- Fan-out decision: **option (b)** — n8n writes `running` (start) + `failed`
  (error) only; completion via the web's existing ~5-min quiet heuristic.
  (Option (a) atomic-counter RPC deferred.)

## 7. n8n hand-off docs (n8n rebuilt in a separate chat)
- **`n8n.md`** — extended: §9 Drive removed, §10 scenarios from DB, §11 learning
  gate (exploration→active, LEARN, QC-skip signal), updated quick-ref table.
- **`read/db_for_n8n.md`** — extended with the v2 additions (Drive→Storage,
  scenarios, learning tables, what n8n must change).
- **`n8n_handoff_brief.md`** (root) — rewritten to: where each onboarding input is
  stored + exact read queries (brand→`company_briefing`, product→`product_briefing`,
  keys→`fal_api_key`/`anthropic_api_key`, images→`tenant_images.storage_url`).
- **`DB_SCHEMA_FULL.md`** (root) — entire schema in one file (parent-first) +
  dataflow + migration run order.
- **`read/RLHF.md`** — the rating questions (every gate/score id) + `asset_ratings`
  explained.
- Answers given to the n8n chat (verbal, not all in a doc): the rubric gate/score
  IDs + craft-vs-commercial split; the legacy `service_role` JWT location
  (Settings → API Keys → **Legacy**) for Storage `Authorization: Bearer`; the
  `sb_secret_…`-not-a-JWT/Bearer trap.

## 8. Build status
- `npm run build` green after all frontend changes.

## 9. Decisions still OPEN (defaults chosen; override later if needed)
1. **Product vs brand images** — all `tenant_images` rows are undifferentiated
   references (no `kind`). Add a `kind` column + labelled UI only if a hard split
   is needed.
2. **Brand-safety guardrails** — briefings are freeform text; the never-say /
   brand-name lock lives in the n8n system prompt. Add structured
   `tenant_profiles` columns only if we want it enforced from the DB.
3. **Run completion accuracy** — option (b) heuristic for now; add counter columns
   + atomic RPC for instant "complete · N videos" later.

## 10. NEXT STEPS — resume here tomorrow
- [ ] Confirm migrations **#1–#17** are all applied on `gopfnogmceyqkrvgkeup`
      (order + verify queries in `DB_SCHEMA_FULL.md §0`).
- [ ] Land the **LEARN job prerequisites** cleanly (the reverted bits): decide
      whether to add `outputs.updated_at` (+ trigger), `learn_run_state` (+ grant),
      the LEARN indexes, and the slimmer view — or adjust the LEARN job to use
      `created_at` and keep the existing view. (See §0 landmines.)
- [ ] Finish + **Activate** the new n8n workflow at the webhook; then **click Run**
      as an onboarded member (run-config set) and smoke-test `trigger-pipeline`
      → expect `{"ok":true}`.
- [ ] If the site is hosted, **redeploy the web build** so the Drive-removal +
      `tenant_id` patch ship to prod (locally `npm run dev` already has them).
- [ ] Once real ratings exist, run the **LEARN job + gate-flip**; verify
      `v_tenant_exploration_progress` and the exploration→active switch.

---

# Update Log — 2026-06-02 (Session 2)

> Continuation of the 2026-06-01 log (below). This session moved dev onto an
> **isolated Supabase project**, made **multitenancy airtight**, built a full
> **Super Admin console** with tenant lifecycle control, a **per-tenant Run
> config**, a **QA rating feature**, the publishing **compare** view, and a Run
> **"completed"** state. Stack unchanged (React 18 + Vite 6 + Supabase JS v2 +
> lucide). **n8n was NOT touched** — all n8n work is captured in `n8n.md` for the
> cutover.

---

## 0. ⚠️ Dev / prod isolation — read this first
- The app's Supabase target is now **env-driven**: `src/lib/constants.js` reads
  `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` (throws if missing).
- **`.env.local`** points localhost at the **DEV** project `gopfnogmceyqkrvgkeup`
  (`alluvi-dev`). Production values are documented in **`.env.example`**.
- **Live project `hgmvgnsvxlzcylfwttlc` is untouched** — still used by the live
  site **and n8n**. Nothing local can reach it now.
- Restart `npm run dev` after any `.env` change (Vite reads env at startup).

## 1. Dev DB = faithful copy of live
- Created `alluvi-dev`, ran the schema + all migrations, copied data via CSV
  (parent→child order).
- `tiktok_auth` + `tiktok_posts` existed on live but were missing from the repo →
  reconstructed in `supabase/tiktok_posting_migration.sql`.

## 2. SQL migrations created this session
Run on dev already; **run on live at cutover** (see `read/task_pending.md`). Order:
1. `tiktok_posting_migration.sql` — `tiktok_auth` + `tiktok_posts` (dev only; live has them)
2. `super_admin_migration.sql` — `tenant_profiles.role`
3. `impersonation_audit_migration.sql` — `impersonation_events` (audit log)
4. `tenant_lifecycle_migration.sql` — `tenant_profiles.status` + `impersonation_events.action`
5. `tenant_id_everywhere_migration.sql` — `tenant_id` on personas/outputs/videos/tiktok_auth/tiktok_posts + **backfill** + **BEFORE INSERT/UPDATE triggers** (auto-stamp from parent; n8n needs no change)
6. `run_config_migration.sql` — `tenant_run_configs`
7. `asset_ratings_migration.sql` — `asset_ratings`
8. `outputs_prompt_and_rating_cleanup_migration.sql` — `outputs.prompt_used` + drops `asset_ratings.product_id`/`seed`
9. `pipeline_run_status_migration.sql` — `tenant_run_status` (completion marker)
- One-time dev backfill: assigned existing NULL `tiktok_accounts.tenant_id` to the
  converted-admin tenant + set `onboarded=true`.

## 3. Auth model now (everyone is a tenant)
- The hardcoded admin login (username/password) is relabeled **`kind: 'super_admin'`**
  in `useAuth.js` → lands on the **Super Admin console**, NOT the tenant dashboard.
- Members (signup/signin) = tenants, `tenant_id = auth.users.id`.
- The "current admin" data was converted into a normal tenant (signup + backfill).
- `App.jsx` branches: `super_admin → <SuperAdminApp>`, else `<Dashboard>` (the tenant
  Dashboard is reused untouched, incl. for impersonation).

## 4. Super Admin console (new) — `src/components/SuperAdmin*`
- `SuperAdminApp` + `SuperAdminSidebar` (Overview / Tenants / Activity).
- **Overview**: platform totals + top-tenants-by-videos + setup-pending.
- **Tenants list**: status badges, "show removed" toggle, last-active.
- **Tenant detail**: counts, QC pass-rate, est. cost, **API keys** (masked+reveal),
  briefings, per-account table; **Edit** (`TenantConfigModal`); **Account control**
  Suspend/Reactivate/Remove (`TenantActionModal`); **"Page"** = impersonation.
- **Impersonation** renders the tenant's exact Dashboard with `ImpersonationBanner`
  (logged to audit). **Audit log** = `impersonation_events` (view_page/suspend/
  reactivate/remove) shown in the Activity view (`AuditLogPanel`).
- **Lifecycle**: `status` active/suspended/removed; suspended/removed members are
  **blocked at login** (gate in `Dashboard.jsx`, bypassed during impersonation);
  removed = reversible tombstone (hidden + excluded from totals).
- **Cost**: `COST_RATES` in `constants.js` (placeholder per-image/per-video rates).
- New hooks/libs: `useSuperAdmin`, `useAuditLog`, `lib/cost.js`, `lib/audit.js`,
  `lib/tenantAdmin.js`.

## 5. 100% tenant isolation (no leakage)
- `tenant_id` on **every** pipeline table, kept correct by **DB triggers** (so n8n's
  inserts auto-stamp it — no n8n change).
- Frontend reads filter `tenant_id` **directly** (`useAnalytics`); publishing has a
  defense-in-depth filter; `useRunProgress` is tenant-scoped.
- **FIXED LEAK:** the tenant **Settings** page used the global `app_settings` table
  (shared across tenants). Now `useSettings(tenantId)` reads/writes the tenant's own
  `tenant_profiles.fal_api_key` / `anthropic_api_key`. **Onboarding (`useTenant.saveSetup`),
  Settings, and the super-admin Edit modal all write the SAME `tenant_profiles` columns.**

## 6. Per-tenant Run config — moves n8n's hardcoded CONFIG into the DB
- `tenant_run_configs` (one_per_persona, tiktok_id, max_videos_per_run,
  max_qc_attempts, video_duration, video_resolution).
- `useRunConfig` hook + `RunConfigModal` (**"Run settings"** button, top-right by Run).
- The **Run button is disabled until required fields are set**; on Run, the config is
  saved to the DB, then the pipeline is triggered. n8n will read it (see `n8n.md`).

## 7. Publishing improvements
- **Compare** view: video + source image side by side (Compare button in the lightbox).
- **Self-healing** images (lightbox + rating) — mirror-on-error.
- Lightbox footer restructured (buttons row, readable info line below).
- **Deployed `mirror-image` + `mirror-video` Edge Functions to the DEV project** so
  self-heal works in dev (they already existed on live).

## 8. QA Rating feature — `asset_ratings`
- One row per generation (output), JSONB `image`/`video` (`{gates,scores,notes}`),
  `tenant_id` auto-stamped by trigger. `asset_triage` = Accept/Reject/Flag column.
- **Config-driven**: `src/lib/ratingConfig.js` is the single source of truth.
- `RatingWorkspace` (full-screen, both-sides: video+rubric | image+rubric), gates
  (pass/fail + "Auto · pending" badge for the auto items — no pipeline metric yet),
  1–5 scores, conditional note boxes, keyboard shortcuts, save/upsert via `useAssetRating`.
- Entry: **"Rate"** button in the Publishing lightbox.
- `image_prompt` is sourced from `outputs.prompt_used` (n8n will fill it later).
- Plan/decisions: `read/rating_feature_plan.md`.

## 9. Run "completed" state — `tenant_run_status`
- n8n writes running/completed/failed; `useRunProgress` resolves **completed** via the
  marker (reliable) OR a quiet-5-min heuristic; **stalled** after 45 min of zero progress.
- `RunControl` now shows a green **"Pipeline complete · N videos"** pill.

## 10. Docs to read on restart
- **`read/task_pending.md`** — full production **cutover checklist** (live migrations in
  order, admin→tenant backfill, host env vars, deploy Edge Functions, RLS + super-admin
  auth, rotate secrets, cost rates) + a **cutover-rehearsal** step.
- **`n8n.md`** — every n8n restructure task: read run config + **API keys** from the DB,
  receive `tenant_id`, write `outputs.prompt_used`, update `tenant_run_status`, and the
  **webhook swap contract** (§7 — what must match to replace the workflow).
- **`read/rating_feature_plan.md`** — rating feature plan.

## 11. Known constraints (so you don't chase non-bugs)
- **Run is NOT wired in dev** (trigger Edge Function not deployed to dev; n8n writes to
  live). So Run / progress / completed can't be fully tested until cutover — by design.
- **RLS still OFF** — frontend scoping only for now; real RLS is the final hardening
  step (needs the super-admin moved to real Supabase Auth first). In `task_pending.md`.
- **Super-admin password is still hardcoded** (`constants.js`) — migrate at cutover.
- Dev `tenant_profiles`/`tenant_images` carry stale (live) UIDs — fine for dev; the
  cutover rehearsal re-seeds cleanly.

## 12. How to restart
1. `npm run dev` (env already points at dev).
2. Log in: **username/password** → Super Admin console; **email signup/signin** → tenant.
3. Continue feature work, or start the cutover via `read/task_pending.md` + `n8n.md`.

---

# Update Log — 2026-06-01

> Everything built in this session, on top of the baseline described in
> `structure.md` / `continue.md`. Five features shipped: **Publishing card
> gallery + inline player**, **Drive→Supabase asset mirroring**, **Settings
> page**, **member auth (signup/signin + JWT)**, and **multitenancy**.
>
> Stack unchanged: React 18 + Vite 6 + Supabase JS v2 + lucide-react, one
> `src/index.css`. **n8n was NOT touched.** All new server logic lives in
> Supabase Edge Functions + SQL.

---

## 0. TL;DR — what you must run in Supabase

Three SQL files (Supabase dashboard → SQL Editor → Run) and two Edge Function
deploys. All idempotent / safe to re-run.

| Step | What | Where |
|------|------|-------|
| SQL  | `supabase/video_storage_migration.sql` | adds `videos.storage_url`, `outputs.image_storage_url`, buckets `videos` + `images` |
| SQL  | `supabase/app_settings_migration.sql`  | `app_settings` key/value table (Fal + Anthropic) |
| SQL  | `supabase/multitenancy_migration.sql`  | `tiktok_accounts.tenant_id`, `tenant_profiles`, `tenant_images`, bucket `tenant-images` |
| Deploy | `npx supabase functions deploy mirror-video --no-verify-jwt --project-ref hgmvgnsvxlzcylfwttlc` | |
| Deploy | `npx supabase functions deploy mirror-image --no-verify-jwt --project-ref hgmvgnsvxlzcylfwttlc` | |

> **CRITICAL:** Edge Functions MUST be deployed with `--no-verify-jwt`. The
> Supabase key is the new `sb_publishable_…` format, which is NOT a JWT, so the
> default JWT verification rejects every browser `functions.invoke()` with
> `UNAUTHORIZED_INVALID_JWT_FORMAT`.

Also in the Supabase dashboard: **Authentication → Email → turn OFF "Confirm
email"** so member signup → signin works instantly (otherwise members must
confirm via email link first).

---

## 1. Publishing — card gallery + inline video player

**Before:** the account detail view was a 3-column download table
(Created / Image / Video, each a Drive download button).

**After:** a grid of **9:16 phone-shaped cards**, latest-first.
- Each card's thumbnail is the generated scene **image**.
- A ▶ play badge + "Video" pill marks rows that have a video; others show
  "Image only".
- **Click a card → a lightbox opens and the video plays inline.** Image-only
  rows show the full image. Arrow keys / on-screen chevrons step through the
  gallery; Download Image / Download Video buttons live in the footer.

**Files:** `src/components/PublishingPanel.jsx` (rewritten detail view +
`PublishCard`, `Thumb`, `Lightbox`, `VideoStage`), `src/index.css`
(`.publish-grid`, `.publish-card*`, `.lightbox*`).

---

## 2. Asset mirroring — Drive → Supabase Storage

**Problem:** Google Drive is flaky for embedding — the `/preview` iframe fails
on some videos ("taking longer than expected…") and the `thumbnail?id=`
endpoint throttles, so thumbnails go blank. Both images and video are
affected.

**Solution:** mirror assets into Supabase Storage and serve them natively.
**n8n keeps writing to Drive unchanged** — Drive is the original source;
Supabase becomes the serving layer.

### Video — "mirror on first play"
- Click a video → if already mirrored, plays native `<video>` from Supabase
  instantly. If not, shows **"Preparing video…"**, calls the `mirror-video`
  Edge Function (copies Drive→bucket `videos`, saves `videos.storage_url`),
  then plays native. If mirroring fails, falls back to the Drive iframe.

### Image — "self-healing thumbnail"
- Card prefers the mirrored copy (`outputs.image_storage_url`). If only the
  Drive thumbnail exists and it fails to load, the card mirrors the image via
  the `mirror-image` Edge Function (copies Drive→bucket `images`) and swaps in
  the Supabase URL. After first heal, it's Drive-independent forever.

### Pieces
- **Edge Functions:** `supabase/functions/mirror-video/index.ts`,
  `supabase/functions/mirror-image/index.ts`. Both download the public Drive
  file (handling the large-file confirm interstitial), upload to Storage with
  the service-role key, and save the public URL on the row.
- **SQL:** `supabase/video_storage_migration.sql` (columns + public buckets +
  read policies).
- **Frontend:** `src/hooks/usePublishing.js` (`mirrorVideo`, `mirrorImage`),
  `src/lib/drive.js` (`thumbnailUrl`, `videoEmbedUrl` — **the single place
  that decides where bytes come from; the swap point for Cloudflare R2 later**).

### Verified working
`video_storage_migration.sql` applied; both functions deployed `--no-verify-jwt`.
- Video 21 → mirrored to `…/videos/21.mp4`, HTTP 200, `video/mp4`, 15.7 MB.
- Output 38 image → `…/images/38.png`, HTTP 200, `image/png`, 1.48 MB.

### Free-tier note
Supabase Storage free tier ≈ 1 GB / ~5 GB egress/month. At ~15 MB/video that's
≈ 66 videos. When you outgrow it, repoint to **Cloudflare R2** (10 GB free,
zero egress) — only `drive.js` + the functions' upload target change.

---

## 3. Settings page

New sidebar item (under **System**) — was a "Soon" stub, now live. A form to
store API keys:
- **Fal API Key**, **Anthropic Claude API Key** (masked, with show/hide).
- (Supabase URL / Secret fields were added then removed at your request.)

**Storage:** `app_settings` key/value table.
**Files:** `src/hooks/useSettings.js`, `src/components/SettingsPanel.jsx`,
wiring in `Dashboard.jsx` / `Sidebar.jsx`, `supabase/app_settings_migration.sql`.

> ⚠️ Stored values are readable by anyone with the publishable key (RLS off,
> MVP posture). Use on a trusted deployment; move to an Edge-Function-gated
> store before going truly public.

---

## 4. Member auth — signup / signin (JWT)

**Kept:** the hardcoded super-admin login (username + password) is **unchanged**.

**Added:** real member auth via **Supabase Auth** (issues + refreshes a JWT,
persists across reloads).
- Login screen now has **3 modes**: admin (default) · member sign-in · member
  sign-up. Two buttons under the admin form switch to member **Sign up** /
  **Sign in**.
- **Sign up** collects Name, Email, Re-enter email, Password (validated).
  **Sign in** is just Email + Password. Name is stored in auth user metadata.

**Precedence rule (important):** a real Supabase member session ALWAYS wins
over the admin `sessionStorage` flag — otherwise a lingering admin flag would
shadow a logged-in member and skip their setup. Admin login signs out any
member session; member sign in/up clears the admin flag. The two identities
are mutually exclusive.

**Files:** `src/hooks/useAuth.js` (rewritten — hybrid auth),
`src/components/LoginScreen.jsx` (3 modes), `src/lib/supabase.js`
(`persistSession: true`), `src/App.jsx` (new handlers + async session gate).

### "Who's logged in" indicator
The sidebar footer now reflects the actual user: admin → "Admin / Workspace
owner"; member → their name + email + initial avatar.
**Files:** `useAuth.js` (exposes `user`), `App.jsx`, `Dashboard.jsx`,
`Sidebar.jsx`, `index.css`.

---

## 5. Multitenancy

**Model:** each signed-up **member is a tenant**; `tenant_id` = their
`auth.users.id`. The **hardcoded admin is NOT a tenant** — `tenant_id` is NULL
for admin and the app applies **no filter** for admin (sees everything, exactly
as before — untouched).

**Flow for a new member:**
1. First sign-in auto-creates a `tenant_profiles` row (`onboarded = false`).
2. They land on a **Setup page** — sidebar/topbar **shell stays identical**;
   the main Accounts area is replaced by a blank setup asking 5 things:
   1. Fal API key
   2. Anthropic Claude API key
   3. Reference images (multi-upload, drag/drop, thumbnails → bucket
      `tenant-images`, one `tenant_images` row each, stamped with tenant_id)
   4. Product briefing
   5. Company briefing
3. **Finish setup** → saves to `tenant_profiles` + `tenant_images`, flips
   `onboarded = true` → the full interface appears (Onboard, Run, etc.).
4. From then on everything is **scoped to that tenant** — Accounts, Publishing,
   Analytics show only their data (blank until they create/run anything).

**Scoping approach:** done in the **frontend queries** — admin = no filter;
member = `eq tenant_id`. RLS stays OFF (enabling RLS keyed on `auth.uid()`
would break the hardcoded-anon admin path). This is logical separation, not
bulletproof; production hardening = move admin to real auth + add RLS.

**Files:**
- SQL: `supabase/multitenancy_migration.sql` (adds `tiktok_accounts.tenant_id`,
  `tenant_profiles`, `tenant_images`, bucket `tenant-images` + policies).
- `src/hooks/useTenant.js` — resolves `{tenantId, isAdmin, onboarded,
  saveSetup}`, loads/creates the profile, saves the setup (uploads images +
  persists config).
- `src/hooks/useAccounts.js` — `useAccounts(tenantId)`: filters on load, stamps
  `tenant_id` on create.
- `src/hooks/useAnalytics.js` — `useAnalytics(tenantId)`: admin = whole
  pipeline; member = walks account→persona→output→video chain (n8n doesn't
  stamp tenant_id on children).
- `src/components/TenantSetup.jsx` — the setup page.
- `src/components/Dashboard.jsx` — gates setup vs full UI, hides Onboard/Run
  until onboarded, passes `tenantId` down.

### Verify in SQL
```sql
select tenant_id, name, email, onboarded, fal_api_key, anthropic_api_key,
       product_briefing, company_briefing, updated_at
from public.tenant_profiles order by updated_at desc;

select tenant_id, file_name, storage_url, created_at
from public.tenant_images order by created_at desc;

select tenant_id, count(*) from public.tiktok_accounts group by tenant_id;
```

---

## 6. Known overlaps / follow-ups

- **Settings vs tenant keys:** the global Settings page (`app_settings`) is
  admin-level; member keys live per-tenant in `tenant_profiles`. Not yet
  unified — members editing the Settings page would touch the global keys.
- **Tenant setup is one-time:** members can't yet re-edit keys/briefings/images
  after finishing setup.
- **Security posture is still MVP:** in-bundle admin password, RLS disabled,
  secrets readable via the publishable key. Harden before truly public.
- **Storage scaling:** move video/image buckets to Cloudflare R2 when the
  Supabase free tier runs out (single swap point in `drive.js` + functions).

---

## 7. New/changed file map (this session)

**Edge Functions**
- `supabase/functions/mirror-video/index.ts` *(new)*
- `supabase/functions/mirror-image/index.ts` *(new)*

**SQL**
- `supabase/video_storage_migration.sql` *(new)*
- `supabase/app_settings_migration.sql` *(new)*
- `supabase/multitenancy_migration.sql` *(new)*

**Hooks**
- `src/hooks/useAuth.js` *(rewritten — hybrid admin + member auth, `user`)*
- `src/hooks/useTenant.js` *(new)*
- `src/hooks/useSettings.js` *(new)*
- `src/hooks/useAccounts.js` *(tenant-scoped)*
- `src/hooks/useAnalytics.js` *(tenant-scoped)*
- `src/hooks/usePublishing.js` *(mirror helpers + storage_url)*

**Components**
- `src/components/PublishingPanel.jsx` *(card gallery + lightbox + mirroring)*
- `src/components/SettingsPanel.jsx` *(new)*
- `src/components/TenantSetup.jsx` *(new)*
- `src/components/LoginScreen.jsx` *(3-mode auth)*
- `src/components/Sidebar.jsx` *(Settings nav live + who's-logged-in)*
- `src/components/Dashboard.jsx` *(tenant gating, settings view, user prop)*
- `src/components/AnalyticsPanel.jsx` *(accepts `tenantId`)*
- `src/App.jsx` *(auth handlers + session gate + user)*

**Lib / styles**
- `src/lib/drive.js` *(thumbnail/video URL builders — storage swap point)*
- `src/lib/supabase.js` *(session persistence on)*
- `src/index.css` *(publishing grid, lightbox, settings, setup, auth switch)*
