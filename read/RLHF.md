# RLHF / QA Rating — full reference

> Everything the **Rate generation** workspace asks, how every answer is
> captured, and a column-by-column breakdown of the `asset_ratings` table where
> it all lands. This is the human-feedback (RLHF) layer: a person scores each
> generated image + video so the pipeline can later be tuned / filtered on real
> quality signal.
>
> Sources of truth:
> - Questions/rubric: `src/lib/ratingConfig.js`
> - UI + draft logic: `src/components/RatingWorkspace.jsx`
> - Load/save: `src/hooks/useAssetRating.js`
> - Table DDL: `supabase/asset_ratings_migration.sql`
>   (+ `outputs_prompt_and_rating_cleanup_migration.sql` dropped `product_id`/`seed`)

---

## 1. What the workspace is

A full-screen QA window opened from the **"Rate"** button in the Publishing
lightbox. It rates **one generation** = one `outputs` row (the scene image) plus
its 1:1 `videos` row (the clip), if a video exists.

Layout (left → right): **video rubric · video · source image · image rubric.**
At the very top sits the **Decision (triage)** control and the **Save rating**
button.

Two-stage intent: the image is rated, a decision is made, and the video rubric
is filled. One `asset_ratings` row is written per generation (upsert by
`output_id`, so re-rating overwrites).

Three answer types appear in the rubrics:

| Control | What the user does | Stored as |
|---|---|---|
| **Gate** (`pass_fail`) | click **Pass** or **Fail** | `"Pass"` / `"Fail"` (or `null` if untouched) |
| **Auto gate** (`auto_badge`) | same Pass/Fail, but shows an **"Auto · pending"** badge (the pipeline has no auto metric yet, so a human sets it manually) | `result` + `auto_value:null` + `disputed:true` |
| **Score** (`scale_5`) | click **1–5** | integer `1..5` (or `null`) |
| **Note** | optional textarea, shown only on a **Fail** gate or a **score ≤ 2** | string keyed by the item id |
| **Triage** | one of **Accept / Reject / Flag** (required to save) | `asset_triage` |

Scale anchors: `1 Bad · 2 Poor · 3 Fair · 4 Good · 5 Excellent`.
Notes cap at 200 chars; the note trigger for scores is `≤ 2`.

---

## 2. The questions — IMAGE rubric

### 2a. Image gates (Pass / Fail) — 8 items

| # | id | Question / label | source | control |
|---|---|---|---|---|
| 1 | `img_product_present`  | Product present & correctly placed | auto  | auto_badge |
| 2 | `img_color_fidelity`   | Product colour fidelity            | auto  | auto_badge |
| 3 | `img_shape_dimensions` | Product shape & dimensions         | human | pass_fail |
| 4 | `img_brand_text`       | Brand text legible & correct       | auto  | auto_badge |
| 5 | `img_productname_text` | Product-name text legible & correct| auto  | auto_badge |
| 6 | `img_grip_logic`       | Grip / placement logic             | human | pass_fail |
| 7 | `img_persona_identity` | Persona identity match             | auto  | auto_badge |
| 8 | `img_scene_logic`      | Scene logic & reflections          | human | pass_fail |

> The 5 **auto** gates map to future pipeline metrics (`object_detection`,
> `delta_e` ≤ 5.0, `ocr_cer` ≤ 0.10 against brand / product-name ground truth,
> `face_cosine` ≥ 0.70). Those metrics don't exist yet, so each auto gate stores
> `auto_value: null` and the human's click is recorded with `disputed: true`
> (a manual override of an absent auto value).

### 2b. Image scores (1–5) — 5 items

| # | id | Question / label |
|---|---|---|
| 1 | `img_scene_adherence` | Scene / prompt adherence |
| 2 | `img_aesthetic`       | Aesthetic quality |
| 3 | `img_detail_realism`  | Detail & realism |
| 4 | `img_lighting`        | Lighting execution |
| 5 | `img_ad_worthiness`   | Ad-worthiness / scroll-stop |

---

## 3. The questions — VIDEO rubric

### 3a. Video gates (Pass / Fail) — 5 items (all human)

| # | id | Question / label | source | control |
|---|---|---|---|---|
| 1 | `vid_product_identity`  | Product identity preserved through motion   | human | pass_fail |
| 2 | `vid_persona_identity`  | Persona identity preserved through motion   | human | pass_fail |
| 3 | `vid_no_artifacts`      | No catastrophic artifacts                   | human | pass_fail |
| 4 | `vid_grip_maintained`   | Grip maintained through motion              | human | pass_fail |
| 5 | `vid_brand_text_motion` | Brand & product text legible through motion | human | pass_fail |

### 3b. Video scores (1–5) — 7 items

| # | id | Question / label |
|---|---|---|
| 1 | `vid_motion_smoothness`     | Motion smoothness |
| 2 | `vid_temporal_stability`    | Temporal stability |
| 3 | `vid_dynamic_degree`        | Dynamic degree |
| 4 | `vid_camera_motion`         | Camera motion quality |
| 5 | `vid_physical_plausibility` | Physical plausibility |
| 6 | `vid_imaging_quality`       | Imaging quality |
| 7 | `vid_hook_strength`         | Hook strength / ad-worthiness |

### 3c. Triage decision (top bar, required)

`Accept` · `Reject` · `Flag` — exactly one. Save is blocked until one is chosen.

**Totals:** image = 8 gates + 5 scores; video = 5 gates + 7 scores; + 1 triage.

---

## 4. How an answer becomes stored data

### 4a. The in-memory draft (built by `emptyRating()`)

While rating, the UI holds a `draft` object:

```js
{
  triage: null,                 // 'Accept' | 'Reject' | 'Flag'
  image: {
    gates:  { <gate_id>: { result: null, auto_value: null, disputed: false }, … },
    scores: { <score_id>: null, … },     // null until clicked, then 1..5
    notes:  { <item_id>: "text", … },    // only present if a note was typed
  },
  video: { gates: {…}, scores: {…}, notes: {…} },
}
```

- Clicking a gate sets `result: 'Pass'|'Fail'`. For **auto** gates it also sets
  `disputed: true` (human overriding the missing auto metric); `auto_value`
  stays `null` until the pipeline emits a real value.
- Clicking a score sets that id to the integer `1..5`.
- Typing in a conditional note sets `notes[item_id]`.

### 4b. The "is it changed?" guard (Save button)

On open, the loaded row is hydrated into the draft and snapshotted as a
**baseline**. The **Save** button is disabled until the draft differs from the
baseline (`isDirty`), so re-opening a rated item and changing nothing can't
re-write the row. The compare uses an order-independent `stableStringify`
(because Postgres JSONB reorders gate-object keys on load). Any real edit — new
gate, changed gate, changed score, edited note, or changed decision — enables
Save; reverting to the original value disables it again.

### 4c. What `save()` writes (`useAssetRating.js`)

On save, the draft + a context snapshot are upserted into `asset_ratings`
(`onConflict: 'output_id'`). Two booleans are **derived**, not entered:

```js
const hasInput = (sec) =>
  Object.values(sec.gates).some(g => g.result) ||   // any gate Pass/Fail
  Object.values(sec.scores).some(v => v != null);   // any score set

image_rated: Boolean(draft.triage) || hasInput(draft.image),
video_rated: hasInput(draft.video),
```

- `asset_triage` ← the chosen decision.
- `image_rated` ← **true whenever a decision was picked** (because saving
  requires a triage), or if any image gate/score was set.
- `video_rated` ← true only if the **video** rubric actually had any input
  (no triage shortcut here).
- `image` / `video` JSONB ← the draft's `{gates, scores, notes}` for each side.
- `updated_at` ← `new Date().toISOString()`.

> Note on `image_rated`: because a triage decision is mandatory to save,
> `Boolean(draft.triage)` is effectively always true, so `image_rated` is ~always
> `true` on any saved row. `video_rated` is the one that genuinely reflects
> "the video rubric was filled." (If you want `image_rated` to mean the same
> for the image rubric, drop the `Boolean(draft.triage) ||` term.)

---

## 5. The `asset_ratings` table — every column

One row per generation (`output_id` is **UNIQUE** → upsert key). `ON DELETE
CASCADE` from `outputs`, so deleting the scene image deletes its rating.

### 5a. Identity / linkage

| Column | Type | Stores / how it works |
|---|---|---|
| `id` | bigint **PK** | surrogate key |
| `tenant_id` | uuid | **auto-stamped** by trigger `trg_asset_rating_tenant` from `outputs.tenant_id` — keeps the rating tenant-scoped without the app setting it |
| `output_id` | bigint FK→`outputs`, **NOT NULL UNIQUE**, ON DELETE CASCADE | the rated scene image; the upsert key (one rating per output) |
| `video_id` | bigint FK→`videos`, ON DELETE SET NULL | the rated clip (null if image-only); set null if the video row is deleted |
| `persona_id` | bigint | snapshot of the parent persona (denormalized for querying) |
| `tiktok_account_id` | bigint | snapshot of the parent account |

### 5b. Context snapshot (frozen at rating time)

Copied from the source rows so the rating stays interpretable even if those rows
are later regenerated or deleted.

| Column | Type | Stores |
|---|---|---|
| `scenario_id` | text | the scenario this generation was for |
| `scenario_title` | text | human-readable scenario label |
| `image_prompt` | text | the scene-image prompt — from `outputs.prompt_used` (n8n will populate this; may be null today) |
| `video_script` | text | from `videos.prompt_used` or `videos.dialogue` |
| `image_storage_url` | text | mirrored Supabase image URL at rating time |
| `video_storage_url` | text | mirrored Supabase video URL at rating time |

### 5c. The rating itself

| Column | Type | Stores / how it works |
|---|---|---|
| `rater_id` | text | who rated (tenant user, or super-admin via impersonation) |
| `asset_triage` | text | `'Accept'` / `'Reject'` / `'Flag'` — the top-bar decision; required to save |
| `image` | jsonb (default `{}`) | full image rubric result — `{ gates, scores, notes }` (shape below) |
| `video` | jsonb (default `{}`) | full video rubric result — same shape |
| `image_rated` | bool (default false) | derived: a decision was picked **or** the image rubric had input |
| `video_rated` | bool (default false) | derived: the video rubric had any gate/score input |
| `rubric_version` | text | which config version produced this (`RUBRIC_VERSION`, currently `'v1'`) — lets you reinterpret old rows if the rubric changes |
| `created_at` | timestamptz (default now) | first rated |
| `updated_at` | timestamptz | last save (app writes ISO timestamp on each upsert) |

> Dropped earlier (`outputs_prompt_and_rating_cleanup_migration.sql`):
> `product_id` and `seed` — they had no upstream source.

### 5d. The JSONB shape inside `image` / `video`

```json
{
  "gates": {
    "<gate_id>": { "result": "Pass" | "Fail" | null,
                   "auto_value": <number|string|null>,
                   "disputed": <bool> }
  },
  "scores": {
    "<score_id>": 1 | 2 | 3 | 4 | 5 | null
  },
  "notes": {
    "<item_id>": "free text (≤200 chars)"
  }
}
```

- `result` — the human Pass/Fail (null = not rated).
- `auto_value` — reserved for the real auto metric (object-detection score, ΔE,
  OCR CER, face cosine…); `null` until the pipeline emits it.
- `disputed` — `true` on auto gates because the human set a value the auto metric
  didn't provide (a manual override). `false` on human gates.
- `scores` keys are the score-item ids → integer 1–5.
- `notes` keys are gate **or** score ids → the optional "Why?" text. Only present
  for items where the user actually typed a note (Fail gate or score ≤ 2).

**Why JSONB and not one column per question:** the rubric is config-driven
(`ratingConfig.js`). Adding/removing a dimension means editing the config only —
no schema migration. The per-dimension answers live as JSON keyed by item id, and
`rubric_version` records which config produced a given row.

### 5e. Indexes & trigger

- Indexes: `tenant_id`, `video_id`, `scenario_id`, `asset_triage`.
- Trigger `trg_asset_rating_tenant` (BEFORE INSERT/UPDATE) copies `tenant_id`
  from the rated `outputs` row — 100% tenant-scoped automatically.
- MVP posture: RLS off, `GRANT ALL` to `anon, authenticated, service_role`.

Read a tenant's ratings:
```sql
select * from public.asset_ratings where tenant_id = '<tenant uid>';
```

---

## 6. End-to-end: one rating, start to row

1. Operator clicks **Rate** on a Publishing card → workspace opens for that
   `output` (+ its `video`).
2. `useAssetRating(output_id)` loads any existing row; the draft hydrates from it
   (or starts empty) and is snapshotted as the baseline.
3. Operator fills gates (Pass/Fail), scores (1–5), optional notes, and picks a
   **decision** (Accept/Reject/Flag). Save stays disabled until something changes.
4. **Save** → `save(draft, context)` builds the row, derives `image_rated` /
   `video_rated`, and upserts on `output_id` (overwriting any prior rating).
5. The DB trigger stamps `tenant_id` from the output. Toast confirms; the window
   closes.

---

*End of doc. Pairs with `read/rating_feature_plan.md` (build decisions) and
`read/db_for_n8n.md` §8 (where `asset_ratings` sits in the wider schema).*
