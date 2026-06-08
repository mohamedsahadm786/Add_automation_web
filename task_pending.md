# Task Pending — Production Cutover Checklist

> Everything to do **when we go from the dev project back to the live (production)
> project**, after web development on `alluvi-dev` is finished.
>
> Context: during development the app points at the **dev** Supabase project
> (`gopfnogmceyqkrvgkeup`) via `.env.local`. The **live** project
> (`hgmvgnsvxlzcylfwttlc`) — used by the live site **and n8n** — was deliberately
> left untouched. This file is the plan to bring all the new work to production
> safely. Work top-to-bottom; nothing here is done until checked.

---

## 0. Pre-flight
- [ ] Confirm dev is fully tested and signed off (multitenancy, super admin, lifecycle).
- [ ] Take a **backup / snapshot of the live database** before touching it (Supabase → Database → Backups, or `pg_dump`).
- [ ] Pick a low-traffic window (n8n writes to live continuously).

## 0b. Cutover rehearsal (do once, when dev development is FINISHED)
Prove the exact live migration works on real data *before* touching production:
- [ ] Wipe the dev project and copy a **fresh snapshot of CURRENT live** into it
      (with its real NULL `tenant_id`s and all newly-added rows).
- [ ] Run **all migrations in §1 + the backfill in §2, in order**.
- [ ] Verify end-to-end: tenant isolation, super-admin console, impersonation,
      lifecycle (suspend/remove), run-config save, null-tenant counts = 0.
- [ ] Only after this passes, do the same on live (§1–2).
> NOTE: live is migrated **in place** (additive SQL) — you do NOT wipe or
> re-copy live. Live already holds all the rows. The wipe/re-copy is for the
> dev REHEARSAL only.

---

## 1. Run the new SQL migrations on the LIVE project (in this order)
All are additive + idempotent. Run each in the live SQL Editor, confirm "Success":

1. [ ] `supabase/super_admin_migration.sql` — `tenant_profiles.role`
2. [ ] `supabase/impersonation_audit_migration.sql` — audit table + grants
3. [ ] `supabase/tenant_lifecycle_migration.sql` — `tenant_profiles.status` + audit `action`
4. [ ] `supabase/tenant_id_everywhere_migration.sql` — `tenant_id` on all pipeline
       tables + **backfill** + **triggers** (this is the big one)
5. [ ] `supabase/run_config_migration.sql` — per-tenant `tenant_run_configs` table
6. [ ] `supabase/asset_ratings_migration.sql` — human QA ratings table
7. [ ] `supabase/outputs_prompt_and_rating_cleanup_migration.sql` — adds `outputs.prompt_used` (image prompt) + drops unused `asset_ratings.product_id`/`seed`
8. [ ] `supabase/pipeline_run_status_migration.sql` — `tenant_run_status` completion marker

> Note: `tiktok_auth` / `tiktok_posts` already exist on live, so do NOT run
> `tiktok_posting_migration.sql` there — but step 4 still adds their `tenant_id`
> column + grants, which is needed.

**Verify after step 4** (all counts must be 0):
```sql
select 'personas' t, count(*) filter (where tenant_id is null) from public.personas
union all select 'outputs', count(*) filter (where tenant_id is null) from public.outputs
union all select 'videos',  count(*) filter (where tenant_id is null) from public.videos;
```

---

## 2. Convert the live "admin" data into a tenant
On live, the existing data has `tenant_id = NULL` (the old admin was a god-view).
- [ ] Sign up a tenant account (member door) that will own the existing data (owner's email).
- [ ] Get its UID: `select tenant_id, email from public.tenant_profiles order by created_at desc;`
- [ ] Backfill + mark onboarded (triggers then cascade tenant_id to children on next writes; run step-1.4 backfill again if accounts changed):
```sql
update public.tiktok_accounts set tenant_id = 'LIVE_UID' where tenant_id is null;
update public.tenant_profiles set onboarded = true where tenant_id = 'LIVE_UID';
-- re-run the child backfills from tenant_id_everywhere_migration.sql so existing
-- personas/outputs/videos inherit the now-set account tenant_id.
```
- [ ] Re-verify the null-tenant counts are 0.

---

## 3. Point the production frontend at the live project
- [ ] In the hosting platform (Vercel/Netlify/etc.) set env vars to the **live** values:
  - `VITE_SUPABASE_URL = https://hgmvgnsvxlzcylfwttlc.supabase.co`
  - `VITE_SUPABASE_KEY = sb_publishable_OsyKDJj8PnmDKhb6IfVjCQ_sul3esnq`
  - (these are documented in `.env.example`)
- [ ] Confirm `.env.local` (dev) is NOT deployed (it's gitignored).
- [ ] Rebuild & deploy the site. Smoke-test login on the live URL.

---

## 4. Supabase Auth config on live
- [ ] Authentication → Providers → Email → **turn OFF "Confirm email"** (so member
      signup → signin works instantly), OR set up the confirmation email flow properly.

---

## 5. Wire the RUN button on production (was deferred the whole time)
- [ ] Rotate the **n8n Basic-Auth password** (it was leaked in chat earlier).
- [ ] Deploy the Edge Functions to the **live** project:
  - `trigger-pipeline`, `mirror-video`, `mirror-image`
  - deploy with `--no-verify-jwt` (publishable key is not a JWT).
- [ ] Set function secrets: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_USER`, `N8N_WEBHOOK_PASS` (rotated).
- [ ] Smoke-test `trigger-pipeline` (curl) → expect `{"ok":true,...}`.
- [ ] Lock the function CORS `Access-Control-Allow-Origin` to the prod origin.
- [ ] Add abuse protection / rate-limit on the Run trigger before public exposure.

---

## 6. Security hardening — the real "secure" pass (do together)
- [ ] Migrate the **super admin** off the hardcoded password (`constants.js`) onto a real
      Supabase Auth user flagged `role = 'super_admin'`; update `useAuth.js` to sign it in
      and `useTenant`/`App` to derive the role from the DB.
- [ ] Remove `ADMIN_PASS` / `ADMIN_USER` from the bundle.
- [ ] **Enable RLS** on every tenant-scoped table with policies:
  - tenant rows: `tenant_id = auth.uid()`
  - super admin: bypass policy keyed on the `super_admin` role.
  - (Now feasible because every table has `tenant_id` and everyone is a real auth user.)
  - n8n uses the service-role key → bypasses RLS automatically, so it keeps working.
- [ ] Re-test tenant isolation + super-admin access + impersonation under RLS on dev first.

---

## 7. Rotate all leaked secrets
These appeared in chat / in the n8n workflow JSON and should be rotated before public launch:
- [ ] n8n Basic-Auth password
- [ ] `FAL_KEY`, `APIFY_TOKEN`, `ANTHROPIC_KEY` (in the n8n workflow CONFIG block)
- [ ] Supabase **secret** key (`sb_secret_…`) for the live project
- [ ] Consider rotating the live publishable key if needed (update host env var + n8n).

---

## 8. Config to tune before launch
- [ ] `src/lib/constants.js` → `COST_RATES` { image, video }: set to real Fal/Anthropic pricing.
- [ ] Tighten `tiktok_accounts.age` CHECK from `0–120` to `13–120` to match UI validation.

---

## 9. Known deferred / optional (not blocking launch)
- [ ] **Hard purge** option for removed tenants (today "Remove" is a reversible tombstone;
      data is retained). Add a true delete + storage cleanup if required for compliance.
- [ ] Orphaned `tenant-images` storage files aren't deleted on tenant remove — add cleanup.
- [ ] `useSuperAdmin` aggregates client-side; move to a Postgres view/RPC if any table
      passes ~10k rows.
- [ ] Storage scaling: move video/image buckets to Cloudflare R2 if egress becomes an issue
      (single swap point in `src/lib/drive.js` + the mirror functions).

---

## 9b. n8n — read run control from the DB (not hardcoded)
The run-control settings (`ONE_PER_PERSONA`, `TIKTOK_ID`, `MAX_VIDEOS_PER_RUN`,
`MAX_QC_ATTEMPTS`, `VIDEO_DURATION`, `VIDEO_RESOLUTION`) now live per-tenant in
`public.tenant_run_configs`. The web saves them on Run.
- [ ] In n8n, **delete the hardcoded CONFIG values** for those fields.
- [ ] Add a step that reads the row for the current tenant:
      `select * from public.tenant_run_configs where tenant_id = '<tenant uid>';`
      and feeds `one_per_persona / tiktok_id / max_videos_per_run / max_qc_attempts /
      video_duration / video_resolution` into the flow.
- [ ] The trigger-pipeline Edge Function should pass the tenant_id so n8n knows
      which tenant's config + accounts to process (currently it sends `{}`).
- [ ] **Image prompt:** add an n8n step that writes the scene-image generation prompt
      into `outputs.prompt_used` (parallel to how the video script is written to
      `videos.prompt_used`). The rating snapshot already reads it into
      `asset_ratings.image_prompt` — it's just empty until n8n fills it.
- [ ] **API keys from DB:** remove hardcoded `FAL_KEY`/`ANTHROPIC_KEY` from n8n CONFIG;
      read each tenant's `tenant_profiles.fal_api_key` / `anthropic_api_key` instead.
- [ ] **Run status:** n8n updates `tenant_run_status` (running/completed/failed) so
      the Run pill shows "Pipeline complete" accurately.
- [ ] **Full n8n checklist:** see `n8n.md` for the complete restructure steps.

## 10. n8n note (re-seed / triggers)
- n8n keeps writing to live; the new triggers auto-stamp `tenant_id` on its inserts — **no
  n8n change required**. Verify a fresh pipeline run produces correctly-tenant-stamped rows.
- If re-seeding data into live: seed `tiktok_accounts` **with their `tenant_id` first**, then
  children — triggers fill the children's `tenant_id` automatically.

---

_Last updated: 2026-06-02 (dev build, on `alluvi-dev`)._
