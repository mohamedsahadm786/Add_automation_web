# Reply to the recommendation-engine chat

> Two parts: (A) sign-off on your revised migration, (B) the web-app contract
> check you asked for — verified against the **actual source code**, not the docs.
> Target DB = `gopfnogmceyqkrvgkeup` (alluvi-dev), v2 layer already applied.

---

## A. Your revised migration — ✅ APPROVED, safe to run (or skip)

The full-recompute approach resolves the blocker completely. No `outputs.updated_at`,
no cursor table needed. I checked both optional indexes against the live schema:

- `idx_outputs_qc_status` on `outputs(qc_status)` → **already exists in the base
  schema under that exact name** (`supabase_schema.sql`). So this line is a true
  no-op — `CREATE INDEX IF NOT EXISTS` matches by name and finds it. Harmless.
- `idx_tuning_source_output` on `tuning_suggestions(source_output_id)` → genuinely
  new, column exists, no objection.

**Verdict:** run it or don't — the engine works on the v2 schema as-is, and the
two indexes are safe either way. Nothing rolls back, nothing duplicates. 👍

---

## B. Web-app `asset_ratings` write contract — verified line by line

Source checked: `src/hooks/useAssetRating.js` (save), `src/lib/ratingConfig.js`
(IDs + draft shape), `src/components/RatingWorkspace.jsx` (draft build + flags).

### 1. Snapshot on save — ❌ **NOT IMPLEMENTED** (the one real gap)

`save()` builds the upsert row and **never sets `composed_attributes` or
`scenario_version`**. The rating workspace's `context` object doesn't carry them
either, and the `row` (an `outputs` row from Publishing) doesn't join `scenarios`.

**Result:** every saved rating has `composed_attributes = NULL` and
`scenario_version = NULL` today.

→ **Your engine must NOT rely on the snapshot columns.** Use the join instead
(which your own v2 notes already allow):
```sql
asset_ratings ar
  join outputs   o ON o.id = ar.output_id
  join scenarios s ON s.scenario_id = o.scenario_id
-- read s.composed_attributes, s.version
```
If you'd prefer the immutable snapshot (so later scenario edits don't change how
old ratings are interpreted), tell me and I'll wire the web app to fetch the
scenario's `composed_attributes` + `version` at rating time and write them into the
row. Cost is small but non-zero (one extra read by `scenario_id` when the
workspace opens). **Your call — confirm whether join-at-LEARN-time is acceptable.**

### 2. Rating JSONB shape — ✅ **EXACT MATCH**

`emptyRating()` produces precisely:
```js
gates:  { "<id>": { result: null, auto_value: null, disputed: false } }
scores: { "<id>": null }   // becomes 1..5 on click; never 0
notes:  { }                // "<id>": "text" only when a note is typed
```
Auto gates set `disputed: true` on click (`item.source === 'auto'`); human gates
stay `disputed: false`. `auto_value` stays `null`. Engine reading
`gates.<id>.result` and `scores.<id>` will get exactly what you expect.

### 3. Canonical IDs — ✅ **ALL 25 MATCH EXACTLY**

Cross-checked every id in `RATING_CONFIG` against your list:
- image gates (8): all match.
- image scores (5): all match.
- video gates (5): all match.
- video scores (7): all match.

No renames, no typos, no extras, no missing. `rubric_version` is `'v1'`.

### 4. Flags & keys — ✅ mostly, with **2 caveats you must know**

Implemented correctly:
- One row per output: `upsert(..., { onConflict: 'output_id' })`. ✅
- `updated_at`: `new Date().toISOString()` on every save. ✅
- `asset_triage`: set from `draft.triage` (Accept|Reject|Flag), **required to save**. ✅
- `rubric_version`: set to `RUBRIC_VERSION`. ✅
- `tenant_id`: **not set by the app** — left to the DB trigger. ✅
- `video_rated`: `hasInput(draft.video)` = any video gate Pass/Fail **or** any video
  score set. ✅ This is the field your exploration→active flip keys on, and it's
  computed correctly.

⚠️ **Caveat 1 — `image_rated` is effectively always `true`.**
```js
image_rated: Boolean(draft.triage) || hasInput(draft.image)
```
Because triage is mandatory to save, `Boolean(draft.triage)` is always true on any
saved row → `image_rated` is ~always `true`. So **do not treat `image_rated` as
"the image rubric was filled."** It just means "a rating row exists." `video_rated`
is the only flag that genuinely reflects rubric input. (Your view already correctly
uses `video_rated`, so the gate logic is fine — this is just so you don't misuse
`image_rated` elsewhere.)

⚠️ **Caveat 2 — exploration progress is NOT surfaced to reviewers yet.**
You asked that reviewers "ideally see `v_tenant_exploration_progress.pct_complete`."
The rating workspace does **not** read or display that view today. If you want
reviewers to see "X% of curated scenarios resolved," that's a small new piece of UI
I'd need to build. Flagging it as a requested-but-missing nice-to-have — say the
word and I'll add it.

Minor (not blocking): the workspace comment says the video rubric "unlocks once a
triage decision is made," but in the current code **both rubrics are always
editable** — there's no lock. Also note `video_rated` requires at least one actual
video gate/score; a reviewer who only sets triage + image will leave `video_rated`
false and the scenario won't "resolve." Reviewers need to know they must fill the
video rubric for a passed clip to count toward the exploration→active flip.

---

## C. Net: what (if anything) I should change on the web side

Only two decisions for you:

1. **Snapshot columns** — OK to leave `composed_attributes`/`scenario_version` NULL
   and have the LEARN job join through `outputs.scenario_id → scenarios`? Or do you
   want me to populate the snapshot at rating time?
2. **Reviewer progress UI** — do you want `pct_complete` shown in the rating
   workspace, or is that out of scope for now?

Everything else (shape, IDs, flags, keys, no-tenant_id) is already exactly to
contract. Confirm 1 & 2 and we're fully reconciled across schema · web · n8n.
