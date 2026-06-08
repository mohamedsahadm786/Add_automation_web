# Continue — Alluvi Console handover

> Read this first thing tomorrow. It tells you exactly where we left, what
> works, what doesn't, and the precise commands you still need to run.

---

## TL;DR — what to do tomorrow morning

1. **Rotate the n8n Basic-Auth password.** It was pasted in chat yesterday and is now in conversation history and your PowerShell history.
2. **Clean your PowerShell history** (one command — below).
3. **Deploy the Supabase Edge Function** (4 CLI commands — below). This is the *only* thing blocking the **Run** button from working end-to-end.
4. **Paste the deploy output** back to Claude so I can verify and run a smoke test.

After that, the app is feature-complete for this milestone.

---

## Where we are right now

**Working & verified (green build, manually tested):**
- Accounts page — CRUD with cascade-delete on identity edits (`videos → outputs → personas` deleted when `gender / age / country / language` change, so n8n rebuilds from the new identity).
- Publishing page — master list of accounts → click → 3-column table of (Created / Image / Video) download buttons, latest first.
- Analytics page — KPI hero, pipeline funnel, QC quality card, demographics (gender / age / countries / languages), top-accounts-by-videos leaderboard, top scenarios, recent activity.
- RUN button (green, top-right of Accounts page) with a 3-state pill (idle / pulsing live progress / amber stalled) and 20-second Supabase polling.

**Built but NOT YET DEPLOYED:**
- `supabase/functions/trigger-pipeline/index.ts` — Deno Edge Function that holds the n8n Basic-Auth credentials server-side and proxies the POST. The frontend has already been switched to call `supabase.functions.invoke('trigger-pipeline')` — meaning **clicking RUN today returns 404 / CORS error in DevTools**, because the function exists locally but Supabase doesn't know about it yet.

**Why we went this route:** the site will be publicly hosted, so the n8n credentials cannot ship in the frontend bundle. The Edge Function is the cheapest "backend" — uses Supabase you already have, no new server, secrets live in Supabase's secret store.

---

## The 3 secrets that must live in Supabase (not in code, not in chat)

| Name | Value |
|------|-------|
| `N8N_WEBHOOK_URL` | `https://harveyd.app.n8n.cloud/webhook/run-alluvi-pipeline` |
| `N8N_WEBHOOK_USER` | `Sahad` |
| `N8N_WEBHOOK_PASS` | **the rotated password** (NOT `Alluvi@admin@1512` — that was leaked) |

---

## Step 0 — security hygiene (do this before anything else)

### Rotate the n8n password
- Open your n8n workflow → the **Webhook** trigger node → its credential (Basic Auth) → change the password → Save → re-activate the workflow.
- Use the new password in step 3 below.
- While you're there: make it different from `ADMIN_PASS` in `src/lib/constants.js`, since the same string was being used in two places.

### Clean PowerShell history
```powershell
Clear-History
Remove-Item "$env:APPDATA\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt" -ErrorAction SilentlyContinue
```

---

## Step 1 — deploy the Edge Function (4 commands)

The Supabase CLI is **not** installed globally — use `npx supabase ...` everywhere. Run from project root:

```powershell
cd "D:\video_automation_prototype\Web Dev\n8n_\automationonboarding"
```

### 1a. Log in (opens a browser tab to authorize)
```powershell
npx supabase login
```

### 1b. Link the project (needs your Postgres DB password from Supabase dashboard → Project Settings → Database)
```powershell
npx supabase link --project-ref hgmvgnsvxlzcylfwttlc
```

> `hgmvgnsvxlzcylfwttlc` is your project ref (from your Supabase URL). DB password is NOT the anon key / admin password / n8n password — it's the Postgres password. Reset it in the dashboard if you've forgotten.

### 1c. Set the 3 secrets (use the ROTATED n8n password from Step 0)
```powershell
npx supabase secrets set N8N_WEBHOOK_URL=https://harveyd.app.n8n.cloud/webhook/run-alluvi-pipeline
npx supabase secrets set N8N_WEBHOOK_USER=Sahad
npx supabase secrets set N8N_WEBHOOK_PASS=<your new rotated password>
npx supabase secrets list   # confirm all 3 names appear
```

### 1d. Deploy the function
```powershell
npx supabase functions deploy trigger-pipeline
```

When asked about JWT verification, accept the default (yes).

---

## Step 2 — smoke test the deployed function

```powershell
$anon = "sb_publishable_OsyKDJj8PnmDKhb6IfVjCQ_sul3esnq"
curl.exe -i -X POST "https://hgmvgnsvxlzcylfwttlc.supabase.co/functions/v1/trigger-pipeline" `
  -H "Authorization: Bearer $anon" `
  -H "apikey: $anon" `
  -H "Content-Type: application/json" -d "{}"
```

**Expected:** `HTTP/2 200` and body `{"ok":true,"status":200,"body":{"status":"started"}}`

**Common failures and what they mean:**
- `"ok":false,"status":403` → n8n password mismatch; re-run `secrets set N8N_WEBHOOK_PASS=...` with the correct value.
- `"error":"missing_secrets"` → one of the three `secrets set` commands didn't take. Run `npx supabase secrets list` and re-set whichever is missing.
- `HTTP/2 404` from the function URL itself → deploy didn't happen; re-run step 1d.

---

## Step 3 — try the app

```powershell
npm run dev
```

Open `http://localhost:5173`, log in (`admin` / `Alluvi@admin@1512`), navigate to **Accounts**, click **Run** (green button, top-right).

Expected sequence:
1. Button shows `Starting…` with a spinner.
2. Toast: *"Pipeline started. Progress will appear next to the Run button."*
3. Button morphs into a green pulsing pill (`pipeline running…`).
4. As n8n creates rows, the pill updates: `1 persona`, then `1 persona · 3 images`, then `1 persona · 3 images · 1 video`, etc. (polls every 20 s.)
5. The pill survives page refresh and view switches (sessionStorage).
6. The X on the pill clears the local indicator (doesn't cancel the n8n run).
7. After 45 min of no row changes → pill turns amber `Run stalled` and a **Re-run** button appears.

---

## What to paste back to me when you resume

After you've done steps 1–2, paste:
1. The **last 6 lines** of `npx supabase functions deploy trigger-pipeline` output (success or error).
2. The **full output** of the smoke test (`curl.exe …`) — just the status line and JSON body.
3. If the smoke test passes but the in-browser **Run** still errors, the relevant entry from the browser DevTools Network tab (status code + initiator).

That's enough for me to confirm everything works or to debug the remaining failure.

---

## Reference — the 4 tables this whole app is built on

```
tiktok_accounts ──< personas ──< outputs ──< videos
   (this UI)       (n8n A)       (n8n B)      (n8n C)
```

- Web app **only writes** `tiktok_accounts`. Reads `personas / outputs / videos` for Publishing + Analytics.
- `personas.tiktok_account_id` is UNIQUE → 1:1 with accounts.
- `outputs (persona_id, scenario_id)` UNIQUE → Phase B upsert key.
- `videos.output_id` UNIQUE → 1:1 with scene images.
- Cascade-delete on identity edit is handled in `src/hooks/useAccounts.js` (`cascadeDeleteForAccount`).

Full reference doc: `read/structure.md` §6.

---

## File map (so you can re-orient quickly)

**Edge Function**
- `supabase/functions/trigger-pipeline/index.ts` — Deno; reads 3 secrets, sends Basic header to n8n.

**Hooks (`src/hooks/`)**
- `useAccounts.js` — CRUD + cascade-delete on identity edit.
- `useAnalytics.js` — parallel fetch of all 4 tables (lean columns).
- `useAuth.js` — hardcoded admin session.
- `usePipelineRun.js` — calls the Edge Function; persists `runStartedAt` to sessionStorage.
- `usePublishing.js` — outputs+nested videos for one account, latest first.
- `useRunProgress.js` — 20 s polling; stalled after 45 min flat.
- `useTheme.js` — light/dark.

**Components (`src/components/`)**
- `AccountsPanel.jsx`, `AccountFormModal.jsx`, `DeleteModal.jsx` — Accounts CRUD UI.
- `PublishingPanel.jsx` — list + detail with Drive download buttons.
- `AnalyticsPanel.jsx` — KPIs / funnel / quality / demographics / leaderboards / recents.
- `RunControl.jsx` — 3-state pill (idle / active / stalled).
- `Topbar.jsx`, `Sidebar.jsx`, `Dashboard.jsx` — shell.
- `Modal.jsx`, `BrandMark.jsx`, `ThemeToggle.jsx`, `Stats.jsx`, `LoginScreen.jsx` — primitives.

**Lib (`src/lib/`)**
- `constants.js` — Supabase URL/key, admin creds, dropdowns. **No webhook URL anymore.**
- `drive.js` — `downloadFromDrive(fileId, fallbackUrl)`.
- `supabase.js` — singleton client.
- `utils.js` — `formatDate`, gender helpers, Supabase error helpers.

**Styles**
- `src/index.css` — one ~1100-line stylesheet, all CSS variables. Sections: Brand, Buttons (incl. `.btn-run` + `.btn-spinner`), Login, Form fields, App shell, Data table, Tags, Card list, States, Modal, Toast, Analytics, Publishing, Run pill, Responsive, `prefers-reduced-motion`.

**Docs (`read/`)**
- `structure.md` — full project reference (data flow, components, hooks, DB, styles, hardening backlog).
- `continue.md` — this file.

---

## Known non-issues (don't get distracted by these)

- **`tiktok_accounts_migration.sql` looks redundant.** It is. The canonical schema is `supabase_schema.sql`. Leave the migration file as historical artifact or delete it — your call, no impact on the app either way.
- **Analytics shows zeros if no pipeline has ever run.** That's correct; no `personas / outputs / videos` rows exist until n8n writes some.
- **Vite build prints a 422 KB bundle.** Normal for React + Supabase + lucide. Fine for MVP.

---

## Open items beyond today's RUN-button work (not blocking)

- Move `ADMIN_PASS` / `ADMIN_USER` out of `src/lib/constants.js` to real auth (Supabase Auth or a proxy login).
- Re-enable RLS on the 4 Supabase tables and write policies before public launch (schema's own comment).
- Tighten `tiktok_accounts.age` CHECK constraint from `0–120` to `13–120` to match UI validation.
- The Edge Function currently has `Access-Control-Allow-Origin: *`. Lock it down to your prod origin once you know the URL.
- Consider real abuse protection on the RUN button (rate limit on the Edge Function, or require a signed-in Supabase user) before public hosting — right now anyone with the anon key + function URL can trigger a run.

---

**End of handover.** When you're ready, run Steps 0–3 above and paste the outputs from the box marked *"What to paste back to me when you resume."*
