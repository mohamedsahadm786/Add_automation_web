---
name: alluvi-console-project
description: Alluvi Console — React+Vite+Supabase TikTok onboarding CRM; Publishing page is the main operating surface
metadata:
  type: project
---

**Alluvi Onboarding Console** — single-page TikTok-account CRM (React 18 + Vite 6 + Supabase JS v2, lucide-react, hand-rolled CSS vars in one `src/index.css`). No Tailwind/Redux. Hard-coded admin auth (`admin` / pass in `src/lib/constants.js`), sessionStorage gate. Supabase anon key in bundle, RLS disabled — explicit MVP posture.

Data model is a 4-table parent→child chain; web app only WRITES `tiktok_accounts`, READS the rest:
`tiktok_accounts ──< personas ──< outputs ──< videos` (n8n pipeline writes personas/outputs/videos). personas 1:1 account; outputs UNIQUE(persona_id,scenario_id); videos 1:1 output.

Three views in `Dashboard.jsx` via `view` state (accounts | publishing | analytics) — docs/structure.md is stale and calls Publishing/Analytics "Soon" stubs, but they ARE implemented now.

**Publishing page (the main operating surface):**
- `src/components/PublishingPanel.jsx` — master list of accounts (reuses `accounts` from `useAccounts`, client-side search over tiktok_id/name/gender). Click an account → `PublishingDetail` sub-component.
- `PublishingDetail` uses `src/hooks/usePublishing.js` (`usePublishingForAccount(accountId)`): 2-step query — lookup persona by `tiktok_account_id`, then its `outputs` with nested `videos`, ordered created_at desc. Returns flat rows `{id, created_at, scenario_id, scenario_title, qc_status, image_file_id, image_url, video}`.
- Detail renders a 3-col table: Created (+scenario) / Image download / Video download. Downloads via `src/lib/drive.js downloadFromDrive(fileId, fallbackUrl)` → opens `drive.google.com/uc?export=download&id=...`.

**RUN button** (Accounts view only): `usePipelineRun.js` → calls Supabase Edge Function `supabase/functions/trigger-pipeline` (proxies to n8n webhook, holds Basic-Auth secrets server-side). `useRunProgress.js` polls every 20s, stalled after 45min.

Pipeline run flags (n8n-side, not owned by app): `ONE_PER_PERSONA`, `TIKTOK_ID`, `MAX_VIDEOS_PER_RUN`.

**Publishing redesign (2026-06-01):** detail view is a grid of 9:16 phone cards (thumbnail = generated image), click → lightbox plays video. Drive is flaky for BOTH images and video, so both are mirrored to Supabase Storage:
- **Video:** "mirror on first play" — `mirror-video` Edge Function copies Drive→bucket `videos` on first click, saves `videos.storage_url`; lightbox plays native `<video>`, falls back to Drive `/preview` iframe if mirror fails.
- **Image:** self-healing thumbnail — card prefers `outputs.image_storage_url`; if the Drive `thumbnail?id=` endpoint fails to load, `mirror-image` Edge Function copies Drive→bucket `images`, swaps in the Supabase URL.

n8n is UNCHANGED — all mirroring lives in this repo + Supabase. Both buckets public.

**CRITICAL gotcha:** Edge Functions MUST be deployed with `--no-verify-jwt` (e.g. `npx supabase functions deploy mirror-video --no-verify-jwt --project-ref hgmvgnsvxlzcylfwttlc`). The Supabase key is the new `sb_publishable_...` format which is NOT a JWT, so the default JWT verification rejects all browser `functions.invoke()` calls with `UNAUTHORIZED_INVALID_JWT_FORMAT`. Same applies to `trigger-pipeline`.

Storage swap point for later (Cloudflare R2 etc.): `src/lib/drive.js` (`thumbnailUrl`, `videoEmbedUrl`) + the Edge Functions' upload target. Setup: run `supabase/video_storage_migration.sql` (adds both columns + both buckets) + deploy `mirror-video` & `mirror-image` with `--no-verify-jwt`. Free tier ~15MB/video → ~66 videos / 1GB.

**Auth (2026-06-01):** hybrid in `src/hooks/useAuth.js`. (1) Super-admin = hardcoded `admin`/`ADMIN_PASS` via sessionStorage flag (unchanged). (2) Members = real **Supabase Auth** email/password (JWT, `persistSession:true`). LoginScreen has 3 modes (admin / member signin / member signup with name+email+re-email+password); two bottom buttons switch to member signup/signin. `useAuth` returns `{authed, ready, user, login, signUp, signIn, logout}`. Name stored in auth user_metadata. PRECEDENCE: a Supabase member session ALWAYS wins over the admin sessionStorage flag in `deriveUser` (else a lingering admin flag shadows a logged-in member → member wrongly treated as admin, setup skipped). Admin login signs out any member session; member sign in/up clears the admin flag — kept mutually exclusive. NOTE: if Supabase "Confirm email" is ON, signup returns no session → UI bounces to signin with a confirm note; disable email confirmation in dashboard for instant signup→signin. **Multitenancy (2026-06-01, implemented):** tenant = a signed-up member; `tenant_id` = their auth.users.id. Admin (hardcoded) has tenant_id NULL and is NEVER filtered (sees all, untouched). Scoping is done in FRONTEND queries (RLS stays OFF so the anon-key admin path keeps working — true isolation later needs RLS + admin moved off anon). `useTenant(user)` hook resolves `{tenantId, isAdmin, onboarded, saveSetup}`. Fresh members hit `TenantSetup` page (kept sidebar, setup replaces Accounts main area) collecting Fal key, Anthropic key, multiple images, product briefing, company briefing → stored in `tenant_profiles` + `tenant_images` (+ `tenant-images` public bucket), flips `onboarded=true` → full interface appears. `useAccounts(tenantId)` filters + stamps tenant_id on create; `useAnalytics(tenantId)` walks account→persona→output→video chain for members (n8n doesn't stamp tenant_id on children). SQL: `supabase/multitenancy_migration.sql`. Settings page is per-tenant (`useSettings(tenantId)` reads/writes `tenant_profiles.fal_api_key`/`anthropic_api_key`). The old global `app_settings` table was **dropped 2026-06-04** (dead code — 0 runtime refs; superseded by the per-tenant keys).

Full reference: `read/structure.md` + `read/continue.md`.
