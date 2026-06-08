# Alluvi Onboarding Console — Project Structure

> Full reverse-engineered map of the React + Vite + Supabase frontend, the SQL
> backend (TikTok accounts CRM **and** the upstream AI persona / UGC pipeline),
> the routing/state flow, the design system, and every component contract.
>
> Scope read for this doc:
> - `package.json`, `vite.config.js`, `index.html`
> - All `src/**` (App, components, hooks, contexts, lib, styles)
> - `supabase_schema.sql` (upstream AI pipeline DB)
> - `tiktok_accounts_migration.sql` (this app's CRM table)

---

## 1. What the app is

**Alluvi Console** is a single-page **TikTok account CRM** for an automation
team. It is the *human onboarding layer* in front of a larger AI persona →
scene image → lip-synced video pipeline (see §6). Operators sign in with a
hard-coded admin credential, then **list / search / filter / create / edit /
delete** TikTok publishing accounts stored in Supabase.

The non-account areas (Publishing, Analytics, Settings) are stubbed in the
sidebar with `Soon` badges — only the **Accounts** module is implemented in
this MVP build.

Tech stack:
- **React 18.3** (function components, hooks only — no class, no Redux)
- **Vite 6** as dev server / bundler (`@vitejs/plugin-react`)
- **Supabase JS v2** for DB CRUD (anon publishable key, RLS disabled in MVP)
- **lucide-react** for icons
- Hand-rolled **CSS variables theming** (no Tailwind, no CSS-in-JS)

---

## 2. Top-level layout

```
automationonboarding/
├── index.html                       Vite entry HTML (Inter + JetBrains Mono fonts)
├── vite.config.js                   React plugin, dev server :5173, host:true
├── package.json                     Scripts: dev / build / preview
├── supabase_schema.sql              Canonical schema for all 4 tables (tiktok_accounts → personas → outputs → videos)
├── tiktok_accounts_migration.sql    Redundant — contents now folded into supabase_schema.sql
├── dist/                            Vite build output
├── node_modules/
└── src/
    ├── main.jsx                     ReactDOM.createRoot → <App />
    ├── App.jsx                      Auth gate: <LoginScreen /> or <Dashboard />
    ├── index.css                    Global stylesheet (~867 lines, all design tokens)
    ├── components/                  13 presentational + container components
    │   ├── AccountFormModal.jsx     Create + edit form (datalists for country/lang)
    │   ├── AccountsPanel.jsx        Table (desktop) + card list (mobile) + filters/states
    │   ├── AnalyticsPanel.jsx       KPI hero, pipeline funnel, QC quality, demographics, leaderboards, recents
    │   ├── BrandMark.jsx            SVG logo with pink→violet gradient
    │   ├── Dashboard.jsx            Authenticated shell, owns view state + CRUD modals
    │   ├── DeleteModal.jsx          Confirm dialog ("This can't be undone")
    │   ├── LoginScreen.jsx          Username/password form + animated gradient bg
    │   ├── Modal.jsx                Portal + scrim + Escape-to-close primitive
    │   ├── PublishingPanel.jsx     Publishing list (accounts) + detail (downloads table)
    │   ├── Sidebar.jsx              Clickable nav (Accounts / Publishing / Analytics active)
    │   ├── Stats.jsx                4 KPI cards (Total / Countries / Languages / Week)
    │   ├── ThemeToggle.jsx          Sun/Moon switch (regular + floating variant)
    │   └── Topbar.jsx               Configurable title/subtitle, optional search + Onboard
    ├── contexts/
    │   └── ToastContext.jsx         Toast queue + provider + useToast() hook
    ├── hooks/
    │   ├── useAccounts.js           CRUD + cascade-delete on identity edit / row delete
    │   ├── useAnalytics.js          Pulls all 4 tables (lean cols) in parallel for the panel
    │   ├── useAuth.js               sessionStorage gate for hard-coded admin
    │   ├── usePublishing.js         Outputs + nested videos for one account, latest first
    │   └── useTheme.js              localStorage + prefers-color-scheme theme
    └── lib/
        ├── constants.js             Supabase URL/key, admin creds, dropdowns
        ├── drive.js                 Drive download URL builder + downloadFromDrive()
        ├── supabase.js              createClient(...) singleton, persistSession:false
        └── utils.js                 formatDate, genderClass, genderLabel, error helpers
```

---

## 3. Runtime entry & data flow

```
index.html ──► /src/main.jsx
                    │
                    ▼
            <StrictMode><App/></StrictMode>
                    │
                    ▼
                <App>
   ┌────────────────┴───────────────────┐
   │   useTheme() → data-theme attr     │   useAuth() → sessionStorage gate
   └────────────────┬───────────────────┘
                    ▼
            <ToastProvider>            (global toast queue)
                    │
       authed ? <Dashboard/> : <LoginScreen/>
                    │
                    ▼
   <Dashboard>
     ├─ useAccounts() ── Supabase tiktok_accounts ──► UI state
     ├─ <Sidebar />
     ├─ <Topbar />            (search, theme, Onboard CTA)
     ├─ <Stats />             (derived KPIs from accounts[])
     ├─ <AccountsPanel />     (table OR card-list with filters)
     ├─ <AccountFormModal />  (create / edit; throws → modal renders error)
     └─ <DeleteModal />       (confirm; success/error toasts)
```

### Auth flow (toy)

`src/hooks/useAuth.js`
- Initial state read from `sessionStorage.getItem('alluvi.session') === 'ok'`.
- `login(username, password)` waits 360 ms (so the spinner is visible), then
  string-compares to `ADMIN_USER = "admin"` / `ADMIN_PASS = "Alluvi@admin@1512"`
  from `lib/constants.js`.
- On success, sets the session key and flips `authed → true`; on failure
  returns `{ok:false, error:'Invalid credentials. …'}` which `LoginScreen`
  renders inline and resets the password field.
- `logout()` clears the key. The sidebar's `LogOut` icon button triggers it.

> ⚠️ **Security note:** Both Supabase publishable key and admin password are
> shipped in the bundle (`src/lib/constants.js`). RLS is also disabled on the
> Supabase tables. This is explicitly a **MVP** posture — see "Hardening
> backlog" at the end.

### Theme flow

`src/hooks/useTheme.js`
- Reads `localStorage['alluvi.theme']`; falls back to
  `prefers-color-scheme: dark`.
- On every change writes `<html data-theme="…">` and persists to localStorage.
- `<ThemeToggle>` flips between `'light'` and `'dark'`. CSS swaps tokens via
  `html[data-theme='dark']` selectors.

### Toast flow

`src/contexts/ToastContext.jsx`
- `<ToastProvider>` wraps the whole app, owns a `toasts[]` queue and a
  `Map<id, timeoutHandle>`.
- API: `useToast() → { success, error, info }`. Each call enqueues a toast
  rendered in a fixed bottom-right `.toast-stack` (with `aria-live="polite"`),
  auto-dismissed after 3.2 s with a 220 ms `is-leaving` exit animation.
- Icon picked from `{success: Check, error: AlertTriangle, info: Info}`.

---

## 4. Component reference

### 4.1 `App.jsx`
Top-level switch.
- Props: none.
- Hooks: `useTheme`, `useAuth`.
- Renders `<ToastProvider>` and gates on `authed`.

### 4.2 `LoginScreen.jsx`
Props: `{ onLogin, theme, onToggleTheme }`.
- Local state: `username`, `password`, `showPass`, `error`, `submitting`.
- Awaits `onLogin(username.trim(), password)` → `{ok, error?}`.
- Layout: full-bleed `auth-shell` with animated background (`.auth-bg` +
  three `.orb` blobs floating on 14s loops + `.grid-overlay` masked grid),
  centered `auth-card` containing `BrandMark`, copy block, two
  `field-input`s (User / Lock icons from lucide-react), password
  show/hide eye, error banner, and a full-width gradient submit button.
- Floating `ThemeToggle` top-right.

### 4.3 `Dashboard.jsx`
Authenticated workspace and **owner of all CRUD state**.
- Props: `{ theme, onToggleTheme, onLogout }`.
- Hooks: `useAccounts` (data), `useToast` (feedback).
- Local state:
  - `sidebarOpen` — mobile drawer toggle.
  - `search`, `genderFilter`, `countryFilter` — pure UI filters, applied
    in `<AccountsPanel>` (the Dashboard doesn't filter, it just passes
    state and setters).
  - `formState = {open, mode:'create'|'edit', target}` — drives `AccountFormModal`.
  - `deleteState = {open, target}` — drives `DeleteModal`.
- Keyboard: global `/` focuses `searchRef` unless an input/select/textarea is
  focused or a modal is open.
- Handlers:
  - `openOnboard()` / `openEdit(account)` / `closeForm()`.
  - `handleFormSubmit(payload)` — calls `create` or `update`, shows toast,
    closes modal. On error rethrows `friendlySupabaseError(err)` so the
    modal can render the message inline.
  - `openDelete(account)` / `closeDelete()` / `handleDeleteConfirm(target)` —
    `remove` then toast.
- Layout: grid `app-shell` = `<Sidebar>` + `<main>` with `<Topbar>`,
  `<Stats>`, `<AccountsPanel>`, page footer "Alluvi Onboarding Console · MVP build",
  and the two modals.

### 4.4 `Sidebar.jsx`
Props: `{ open, onClose, onLogout }`.
- Sections:
  - **Manage** — `Accounts` (active), `Publishing` (Soon), `Analytics` (Soon).
  - **System** — `Settings` (Soon).
- Footer `user-chip` shows the `A` avatar, "Admin · Workspace owner", and a
  logout `icon-btn`.
- Mobile (< 760 px): becomes a fixed off-canvas drawer; clicking the rendered
  `.sidebar-scrim` calls `onClose`.

### 4.5 `Topbar.jsx`
Props: `{ theme, onToggleTheme, onOpenSidebar, onOnboard, search, onSearchChange, searchRef }`.
- Mobile hamburger `topbar-menu` triggers `onOpenSidebar`.
- Title block: "TikTok Accounts" / "Manage every account your automation publishes from."
- Right cluster: search input (with kbd `/` hint), `ThemeToggle`, primary
  gradient "Onboard" button (Plus icon).

### 4.6 `Stats.jsx`
Props: `{ accounts }`.
- Derives 4 KPIs via `useMemo`:
  - `total` = `accounts.length`
  - `countries` = unique non-empty `country` values
  - `languages` = unique non-empty `language` values
  - `week` = accounts created in the last 7 days
- Renders four `<Card>` items (pink / violet / blue / green gradient icons:
  Users / Globe / Languages / Zap).

### 4.7 `AccountsPanel.jsx`
The data table — and on mobile, a card list — plus the filter row.
- Props: `{ accounts, status, error, search, genderFilter, onGenderFilter,
  countryFilter, onCountryFilter, onReload, onOnboard, onEdit, onDelete }`.
- `countryOptions` (memo): unique countries from current accounts (the
  filter dropdown is dynamic; gender uses the static `GENDER_OPTIONS`).
- `filtered` (memo): applies gender → country → free-text search across
  `tiktok_id | name | country | language` (lowercased contains).
- Header sub-line states one of: `Loading…`, `No accounts onboarded yet.`,
  `N accounts total`, or `M of N shown` (singular/plural aware).
- Three exclusive states:
  - `loading` → centered spinner + "Loading accounts…"
  - `error` → `<ErrorState>` (special copy when
    `error.missingTable === true`, instructing to run
    `tiktok_accounts_migration.sql`).
  - `ready` + empty → `<EmptyState>` with primary CTA to onboard.
  - `ready` + populated → desktop `.data-table` AND mobile `.card-list`.
- Table columns: TikTok ID (monospaced, `@`-prefixed), Name, Gender (colored
  tag), Age, Country (with dot indicator tag), Language, Added
  (`formatDate(created_at)`), Actions (Pencil → onEdit, Trash2 → onDelete).
- Filter empty result inside loaded data shows a "No accounts match the
  current filters." row/card.

### 4.8 `AccountFormModal.jsx`
Create + edit dialog. Props: `{ open, mode, initial, onClose, onSubmit }`.
- Resets state when `open` flips: prefills from `initial` in edit mode,
  otherwise from `EMPTY = {tiktok_id, name, gender, age, country, language}`.
- Auto-focuses the first field 80 ms after mount.
- Validates client-side on submit:
  - Strips leading `@`s from `tiktok_id`.
  - Trims strings, parses `age` as int.
  - Refuses if any field is empty/NaN → "Please fill in the X field."
  - Refuses if `age < 13` or `age > 120`.
- On submit: `await onSubmit(payload)`. If it throws, message is shown in the
  inline `.auth-error` block.
- Datalists: `country-options` from `COUNTRY_SUGGESTIONS`, `language-options`
  from `LANGUAGE_SUGGESTIONS`, both in `lib/constants.js`.
- Modal eyebrow: `@{tiktok_id}` in edit, `New account` in create.

### 4.9 `DeleteModal.jsx`
Props: `{ open, target, onClose, onConfirm }`.
- Local: `submitting` boolean (disables both buttons during the await).
- Body: "Remove @{tiktok_id} from the workspace? Its automation history will
  be detached." — language deliberately implies the deletion only removes the
  row from `tiktok_accounts`, not from the upstream pipeline tables.
- Uses `modal-card--sm` width and `modal-eyebrow--danger` color.

### 4.10 `Modal.jsx`
Lightweight primitive. Props: `{ open, onClose, children, labelledBy }`.
- When open: locks `body.style.overflow = 'hidden'`, listens for `Escape`,
  restores both on unmount.
- Renders into `document.body` via `createPortal`.
- DOM: `.modal[role=dialog][aria-modal=true][aria-labelledby={labelledBy}]`
  → `.modal-scrim` (click → close) + children.

### 4.11 `BrandMark.jsx`
SVG logo. Props: `{ small=false, gradientId='brand-grad' }`.
- Pink (`#ec4899`) → violet (`#8b5cf6`) gradient on a rounded square with a
  stylized "Alluvi" mark (TikTok-style waveform). `gradientId` is exposed to
  avoid `defs` collisions when multiple marks render (used: `login-grad`,
  `sidebar-grad`).

### 4.12 `ThemeToggle.jsx`
Props: `{ theme, onToggle, floating=false }`.
- Renders `Moon` icon in dark mode, `Sun` in light; `aria-label` and `title`
  describe the *target* mode.
- `floating` variant absolutely positions it top-right (used on the login
  screen).

---

## 5. Hooks & lib reference

### 5.1 `hooks/useAccounts.js`
Owns all DB interaction for `tiktok_accounts`.

State: `accounts[]`, `status ∈ {'loading','ready','error'}`, `error`.

API:
- `load()` (also exposed as `reload`) — `SELECT * FROM tiktok_accounts
  ORDER BY created_at DESC`. On error wraps as
  `{raw, missingTable: isMissingTableError(err)}` and flips status.
- `create(payload)` — `.insert(payload).select().single()`; optimistically
  prepends the returned row.
- `update(id, payload)` — `.update(payload).eq('id', id).select().single()`;
  swaps the row in place.
- `remove(id)` — `.delete().eq('id', id)`; filters the row out locally.
- Mutations re-throw so callers can show the error in the modal/toast.

Loads once on mount via `useEffect(() => load(), [load])`.

### 5.2 `hooks/useAuth.js`
Hard-coded admin auth — see §3 "Auth flow".

### 5.3 `hooks/useTheme.js`
Theme toggle — see §3 "Theme flow".

### 5.4 `lib/constants.js`
| Constant | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://hgmvgnsvxlzcylfwttlc.supabase.co` | Hard-coded |
| `SUPABASE_KEY` | `sb_publishable_OsyKDJj…` | Publishable anon key, in-bundle |
| `TABLE` | `'tiktok_accounts'` | Single table this UI touches |
| `ADMIN_USER` | `'admin'` | |
| `ADMIN_PASS` | `'Alluvi@admin@1512'` | In-bundle |
| `SESSION_KEY` | `'alluvi.session'` | sessionStorage key |
| `THEME_KEY` | `'alluvi.theme'` | localStorage key |
| `GENDER_OPTIONS` | `[female, male, non-binary, other]` | Drives select + filter |
| `COUNTRY_SUGGESTIONS` | 20 countries | Datalist hint, not a constraint |
| `LANGUAGE_SUGGESTIONS` | 18 languages | Datalist hint, not a constraint |

### 5.5 `lib/supabase.js`
```
createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
```
No Supabase Auth — DB access is via the publishable key, and gating is done
entirely on the React side.

### 5.6 `lib/utils.js`
- `formatDate(iso)` — relative for < 7 d (`just now`, `Nm ago`, `Nh ago`,
  `Nd ago`), else `Mon D, YYYY` in the user's locale; returns `'—'` for
  invalid input.
- `genderClass(g)` → `tag-gender-female|male|non-binary|other`.
- `genderLabel(g)` → Title-case the value (falls back to `'Other'`).
- `isMissingTableError(err)` — true for Postgres `42P01` /
  PostgREST `PGRST205` / "relation … does not exist" messages.
- `friendlySupabaseError(err)` — special-cases unique-constraint failures
  ("A TikTok account with that ID already exists.").

---

## 6. Database

One Supabase project, **one canonical schema file** (`supabase_schema.sql`),
four tables in a strict parent → child chain. `tiktok_accounts_migration.sql`
in the repo is now **redundant** (its contents are folded into the main
schema); leave it as a historical artifact or delete it.

### 6.1 The full chain

```
tiktok_accounts ──< personas ──< outputs ──< videos
       (1)       (1)  (1)     (many) (1)  (1)
   human input    Phase A         Phase B       Phase C
   (this UI)      n8n writes      n8n writes    n8n writes
```

- `personas.tiktok_account_id` is **UNIQUE** → one persona per account (1:1).
- `outputs (persona_id, scenario_id)` UNIQUE → one row per persona×scenario,
  Phase B upserts.
- `videos.output_id` UNIQUE → one video per scene image (1:1).

Trace any artifact back to its account:

```sql
SELECT t.tiktok_id, t.country, p.drive_url AS persona,
       o.scenario_id, o.drive_url AS scene_image, v.drive_url AS video
FROM   videos   v
JOIN   outputs  o ON o.id = v.output_id
JOIN   personas p ON p.id = o.persona_id
JOIN   tiktok_accounts t ON t.id = p.tiktok_account_id;
```

### 6.2 Table specs

**`tiktok_accounts`** — the only table humans fill in. Owned by this UI.

| Column     | Type        | Notes |
|------------|-------------|-------|
| id         | bigint, PK  | identity |
| tiktok_id  | text        | NOT NULL **UNIQUE** (handle, no `@`) |
| name       | text        | NOT NULL |
| gender     | text        | NOT NULL — `'female' / 'male'` (drives persona look) |
| country    | text        | NOT NULL (drives look + language) |
| age        | integer     | NOT NULL, CHECK 0–120 (UI enforces 13–120) |
| language   | text        | NOT NULL |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now(), kept fresh by `trg_tiktok_accounts_updated_at` |

Identity fields = **`gender`, `age`, `country`, `language`**. Editing any of
these invalidates the persona (see §6.5 cascade).

**`personas`** — Phase A output. Written by n8n.

| Column            | Type        | Notes |
|-------------------|-------------|-------|
| id                | bigint, PK  | |
| tiktok_account_id | bigint, FK  | → `tiktok_accounts.id`, **NOT NULL UNIQUE** (1:1) |
| drive_file_id     | text        | Google Drive file id of the portrait |
| drive_url         | text        | Viewable Drive link |
| prompt_used       | text        | The text prompt used (traceability) |
| status            | text        | DEFAULT `'done'` |
| created_at        | timestamptz | DEFAULT now() |

**`outputs`** — Phase B output (scene images, persona × scenario). Written by n8n.

| Column         | Type        | Notes |
|----------------|-------------|-------|
| id             | bigint, PK  | |
| persona_id     | bigint, FK  | → `personas.id`, NOT NULL |
| scenario_id    | text        | NOT NULL — one of the 30 fixed scenarios |
| scenario_title | text        | Human-readable scenario label |
| drive_file_id  | text        | Drive id of the scene image |
| drive_url      | text        | Drive link |
| qc_status      | text        | `'pass'` (cleared QC) / `'skipped'` (failed after all retries) |
| qc_reason      | text        | QC summary: defect \| score \| resemblance \| attempts |
| attempts       | integer     | DEFAULT 1 |
| created_at     | timestamptz | DEFAULT now() |
| —              | —           | UNIQUE (`persona_id`, `scenario_id`) → upsert key |

**`videos`** — Phase C output. Written by n8n. Only QC-passed outputs become videos.

| Column        | Type        | Notes |
|---------------|-------------|-------|
| id            | bigint, PK  | |
| output_id     | bigint, FK  | → `outputs.id`, **UNIQUE** (1:1) |
| scenario_id   | text        | Copied from output for convenience |
| drive_file_id | text        | Drive id of the MP4 |
| drive_url     | text        | Drive link |
| prompt_used   | text        | Seedance video prompt |
| dialogue      | text        | Spoken dialogue |
| status        | text        | DEFAULT `'done'` |
| created_at    | timestamptz | DEFAULT now() |

### 6.3 Indexes & triggers

Indexes: `tiktok_accounts(country)`, `tiktok_accounts(created_at DESC)`,
`personas(tiktok_account_id)`, `outputs(persona_id)`, `outputs(qc_status)`,
`videos(output_id)`.

Trigger: `trg_tiktok_accounts_updated_at` BEFORE UPDATE on
`tiktok_accounts` → `set_tiktok_accounts_updated_at()` sets
`NEW.updated_at = now()`.

### 6.4 Who reads / writes what

| Phase | Node                     | Reads                                              | Writes |
|-------|--------------------------|-----------------------------------------------------|--------|
| A     | `A: Check Personas`      | `tiktok_accounts`, `personas`                       | — |
| A     | `A: Record Persona`      | —                                                   | `personas` (upsert on `tiktok_account_id`) |
| B     | `B: Get Personas`        | `personas` + joined `tiktok_accounts`               | — |
| B     | `B: Build Job List`      | `outputs`, `videos`                                 | — |
| B     | `B: Record Output`       | —                                                   | `outputs` (upsert on `persona_id,scenario_id`) |
| C     | `C: Build Video Job List`| `outputs` (passed), `personas`, `tiktok_accounts`, `videos` | — |
| C     | `C: Record Video`        | —                                                   | `videos` (upsert on `output_id`) |

Web app currently: only CRUD on `tiktok_accounts` (`useAccounts.js`).
The other three tables are visible from this Supabase but **unread by the
UI** today.

### 6.5 Cascade-delete on identity edit (web-app responsibility, NOT yet implemented)

If `gender / age / country / language` change for an account, the existing
persona + everything built from it must be deleted so the next n8n run
rebuilds them from the new identity. Editing only `name` skips the cascade.

Children-first, FK-safe:

```sql
DELETE FROM videos
  WHERE output_id IN (SELECT o.id FROM outputs o
    JOIN personas p ON p.id = o.persona_id
    WHERE p.tiktok_account_id = :edited_account_id);

DELETE FROM outputs
  WHERE persona_id IN (SELECT id FROM personas
    WHERE tiktok_account_id = :edited_account_id);

DELETE FROM personas WHERE tiktok_account_id = :edited_account_id;
```

> Status: `src/hooks/useAccounts.js` `update()` is a plain row update — it
> does **not** run this cascade yet. Needs to: diff identity fields, and
> when they change, run the cascade (ideally as a Supabase RPC for atomicity)
> before/after the row update.

### 6.6 Run-control flags (n8n side, FYI)

The pipeline run is bounded by three Config flags. The web app does not own
these, but they're worth knowing when designing monitoring pages:

- `ONE_PER_PERSONA` — true: every persona processed each run; false: only
  personas with no video yet.
- `TIKTOK_ID` — false, or one handle, or comma-separated handles. When set,
  overrides the above and only processes those accounts.
- `MAX_VIDEOS_PER_RUN` — scenarios per selected persona this run (lowest
  undone `scenario_id` first).

Total videos per run = personas selected × `MAX_VIDEOS_PER_RUN`. Keep below
the n8n 40-minute execution cap.

Nothing regenerates automatically: a `(persona, scenario)` that already has
a video row is skipped permanently. To redo one, delete its `videos` row
(and optionally the `outputs` row if you want a fresh scene image).

### 6.7 Security posture (MVP)

`ALTER TABLE … DISABLE ROW LEVEL SECURITY` on all four tables; `GRANT ALL
… TO anon, authenticated, service_role`. The schema file's own comment:
*"Keep this only if you want the same posture; otherwise … configure proper
Row Level Security policies before production."*

---

## 7. Styling / design system

All styles live in **`src/index.css`** (~867 lines, no preprocessor, no
utility framework). The system is built on **CSS custom properties** with a
`html[data-theme='dark']` override block.

### 7.1 Design tokens (`:root`)

| Group       | Tokens                                                        |
|-------------|---------------------------------------------------------------|
| Brand       | `--brand-1` (`#ec4899`), `--brand-2` (`#8b5cf6`), `--brand-3` (`#6366f1`), `--brand-grad` (pink→violet→indigo 135°) |
| Surfaces    | `--bg`, `--bg-muted`, `--surface`, `--surface-2`, `--surface-elev`, `--border`, `--border-strong` |
| Text        | `--text`, `--text-muted`, `--text-soft`                       |
| Shadows     | `--shadow-sm`, `--shadow-md`, `--shadow-lg`                   |
| Focus ring  | `--ring` (`0 0 0 4px rgba(brand,…)`)                          |
| Status      | `--danger`, `--danger-soft`, `--success`, `--success-soft`, `--warning` |
| Radii       | `--radius-xs/sm/md/lg/xl` = 6 / 10 / 14 / 20 / 28 px          |
| Type        | `--font-sans` (Inter), `--font-mono` (JetBrains Mono)         |
| Layout      | `--header-h` (72), `--sidebar-w` (264)                        |

Dark mode (`html[data-theme='dark']`): inverts surface/border/text scale,
darkens shadows, and softens the `--ring` toward pink.

### 7.2 Major style sections (in order)

1. **Brand mark + theme toggle** (`.brand-mark`, `.brand-eyebrow`,
   `.brand-title*`, `.theme-toggle`, `.theme-toggle--floating`).
2. **Buttons** (`.btn`, `.btn-primary` gradient, `.btn-ghost`,
   `.btn-danger`, `.btn-sm`, `.btn-block`, `.icon-btn`, `.icon-btn--danger`).
3. **Login** (`.auth-shell`, `.auth-bg` radial gradients, three floating
   `.orb`s with 14s `@keyframes float`, `.grid-overlay` radial-masked grid,
   `.auth-card` with `@keyframes rise`, `.auth-form`, `.auth-error`).
4. **Form fields** (`.field`, `.field-label`, `.field-input` with
   `:focus-within` ring, `.field-input.is-select::after` chevron,
   `.field-row` 2-col grid, `.reveal` eye toggle).
5. **App shell** (`.app-shell` 2-col grid, `.sidebar`, `.sidebar-head`,
   `.sidebar-nav`, `.nav-section`, `.nav-item` + `.is-active` /
   `.is-disabled` / `.badge-soon`, `.sidebar-foot`, `.user-chip`,
   `.avatar`, `.sidebar-scrim`).
6. **Main / Topbar** (`.main`, `.topbar`, `.topbar-menu`, `.topbar-title`,
   `.topbar-actions`, `.search` with `kbd` hint).
7. **Stats** (`.stats` 4-col grid, `.stat-card`, four
   `.stat-icon--pink/violet/blue/green` gradient chips).
8. **Panel** (`.panel`, `.panel-head`, `.panel-sub`, `.filters`,
   `.select-sm` with inline SVG chevron background).
9. **Data table** (`.table-wrap` scrollable, `.data-table`, uppercase
   `<thead>`, `.td-handle` monospaced, `.td-name` bold, `.td-actions`).
10. **Tags** (`.tag`, `.tag-dot`, `.tag-gender-female|male|non-binary|other`
    with light/dark color overrides).
11. **Mobile card list** (`.card-list`, `.account-card`,
    `.account-card-head/meta/foot/actions`).
12. **States** (`.state`, `.state-loading`, `.state-error`, `.state-empty`,
    `.spinner` with `@keyframes spin`).
13. **Modal** (`.modal` fixed overlay, `.modal-scrim` blurred, `.modal-card`
    with `@keyframes pop`, `.modal-card--sm`, `.modal-head`,
    `.modal-eyebrow*`, `.modal-body`, `.modal-form`, `.modal-foot`).
14. **Toast** (`.toast-stack` fixed bottom-right, `.toast` with
    `@keyframes slide`, `.is-leaving` exit, `.toast-success/error/info`).
15. **Responsive** breakpoints:
    - `≤ 1080 px`: stats collapse to 2 columns; search narrows to 220 px.
    - `≤ 760 px`: single-column shell; sidebar becomes an off-canvas drawer
      (`transform: translateX(-100%)` + `.is-open`); hamburger appears;
      desktop table hides, card list shows; field rows stack;
      modal docks to bottom as a sheet (`@keyframes slideUp`, 92dvh max,
      rounded top corners).
    - `≤ 380 px`: stats collapse to 1 column; panel title shrinks.
16. **A11y**: `@media (prefers-reduced-motion: reduce)` clamps all
    animations/transitions to `0.001s`.

### 7.3 Iconography

`lucide-react` only. Inventory:
- Auth: `ArrowRight`, `Eye`, `EyeOff`, `Lock`, `User`
- Topbar / Panel: `Menu`, `Plus`, `Search`, `RefreshCw`, `Pencil`, `Trash2`
- Sidebar: `BarChart3`, `LogOut`, `Settings`, `Users`, `Video`, `X`
- Stats: `Globe`, `Languages`, `Users`, `Zap`
- Theme: `Moon`, `Sun`
- Toast: `Check`, `Info`, `AlertTriangle`

---

## 8. Build & dev

`package.json` scripts:
- `npm run dev` → `vite` (dev server on **:5173**, `host: true` so it's
  reachable on LAN).
- `npm run build` → `vite build` → `dist/`.
- `npm run preview` → `vite preview --port 4173`.

Dependencies:
- Runtime: `react ^18.3.1`, `react-dom ^18.3.1`,
  `@supabase/supabase-js ^2.45.4`, `lucide-react ^0.469.0`.
- Dev: `vite ^6.0.5`, `@vitejs/plugin-react ^4.3.4`.

`index.html` preconnects to `fonts.googleapis.com` / `fonts.gstatic.com` and
loads Inter (400/500/600/700/800) + JetBrains Mono 500. The favicon is an
inline data-SVG of the brand mark. Theme-color meta tags switch with the
system color scheme (`#0a0a0f` dark / `#f6f7fb` light).

---

## 9. End-to-end user journeys

### 9.1 Sign in → load list
1. User hits the page; `useAuth` reads sessionStorage, `<LoginScreen>` shows
   if not signed in.
2. Submit → 360 ms delay → string-compare → set session → re-render to
   `<Dashboard>`.
3. `<Dashboard>` mount → `useAccounts.load()` → `SELECT *` ordered by
   `created_at DESC` → status `'ready'` → table + stats render.
4. If the table doesn't exist yet, the error panel tells the operator to
   run `tiktok_accounts_migration.sql`.

### 9.2 Onboard a TikTok account
1. Click **Onboard** (Topbar) or the empty-state CTA →
   `setFormState({open:true, mode:'create', target:null})`.
2. `<AccountFormModal>` resets to `EMPTY`, focuses TikTok ID after 80 ms.
3. Submit → strip `@`, trim, parse age → validate not-empty + age 13–120 →
   `useAccounts.create(payload)`.
4. On success: optimistic prepend, modal closes, `toast.success('Account
   onboarded.')`.
5. On unique-violation: `friendlySupabaseError` → "A TikTok account with that
   ID already exists." renders inline in the modal; the modal stays open.

### 9.3 Edit
- From a table row's Pencil → `openEdit(account)` →
  `<AccountFormModal mode='edit' initial={account}>` prefills, eyebrow shows
  `@handle`, primary button label is "Save changes" / "Saving…".

### 9.4 Delete
- Trash2 → `<DeleteModal target={account}>` → confirm calls
  `useAccounts.remove(id)` → toast + close. Errors go to `toast.error`.

### 9.5 Search & filter (purely client-side over loaded rows)
- `/` (when not in an input/modal) focuses the search box.
- Free text contains-matches against `tiktok_id`, `name`, `country`,
  `language` (lowercased).
- Gender filter ANDs with the static `GENDER_OPTIONS`.
- Country filter ANDs with the dynamic `countryOptions` (unique countries in
  the current dataset).
- Panel subtitle reflects "M of N shown" vs "N accounts total".

### 9.6 Theme toggle
- Sun/Moon button anywhere → flips `theme`, writes localStorage, swaps
  `data-theme` on `<html>`. All component colors re-resolve via CSS vars.

---

## 10. Hardening backlog (visible from the code)

Things the code itself flags as MVP shortcuts — useful as a TODO when
graduating beyond this prototype:

1. **Secrets in bundle.** `SUPABASE_KEY` and `ADMIN_PASS` are both shipped to
   the client (`src/lib/constants.js`). Move auth server-side (Supabase Auth
   or a backing API) and rotate the leaked password.
2. **RLS disabled.** Both SQL files explicitly disable RLS and grant `anon`
   full access. The CRM migration calls this out: *"Rotate to RLS policies
   before going to production."*
3. **Cascade-delete on identity edit is not implemented.** `useAccounts.update()`
   is a plain row update; it must additionally delete `videos → outputs →
   personas` for the account when an identity field changes. See §6.5.
4. **No real Supabase auth on the client.** `persistSession:false,
   autoRefreshToken:false`; if auth ever moves to Supabase Auth, flip these.
5. **Stub modules.** `Publishing`, `Analytics`, and `Settings` nav items are
   `is-disabled` with `Soon` badges.
6. **Age validation mismatch.** UI restricts age 13–120; the SQL CHECK is
   0–120. Tighten the DB constraint to match the product rule.
7. **Toast id counter** (`let nextId = 1`) is module-scoped. Fine for SPA
   sessions; would collide across SSR boundaries if SSR is ever added.
