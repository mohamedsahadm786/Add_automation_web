# Rating feature — build plan (UI deferred)

> DB table is done (`supabase/asset_ratings_migration.sql`). The UI is to be built
> LATER. This captures the locked decisions so the build can resume cleanly.
> Full spec was pasted by the user (Image & Video rubric, rating_config, output_schema).

## Status
- [x] Table `asset_ratings` + tenant-stamping trigger + grants (migration written).
- [ ] UI build (everything below).

## Locked decisions
1. **Config-driven.** Put the spec's `rating_config` into `src/lib/ratingConfig.js` as
   the single source of truth. The rubric component renders from it — adding/removing a
   dimension = edit the config only.
2. **Auto gates** (`source: auto`: object detection, ΔE, OCR brand, OCR product-name,
   face match): render the auto-badge per spec. No pipeline metric exists yet, so
   `auto_value` stays null and the badge shows "—/pending"; the **Dispute** link flips it
   to a manual Pass/Fail so the human can still gate. Swap to real values when the
   pipeline emits them. (n8n side ignored for now.)
3. **Layout = full "both-sides" workspace:** video + video rubric on the LEFT, image +
   image rubric on the RIGHT. Rubric dimensions in **2 columns** each, visually clean.
   Triage (Accept/Reject/Flag) on top. Image rated first; video rubric unlocks after the
   image is rated. Conditional "Why?" note box on any Fail or score ≤ 2. Keyboard
   shortcuts (1–5 score, P/F gate, Tab advance, Enter submit).
4. **Save** one `asset_ratings` row per generation (upsert by `output_id`), in the spec's
   `output_schema` shape, into the `image`/`video` JSONB. Snapshot scenario/prompts/
   storage URLs. `tenant_id` auto-stamped by trigger → 100% tenant-scoped.
5. **Entry point:** a "Rate" button on the Publishing card / lightbox opens the workspace.
   `rater_id` = current user (tenant user, or super admin via impersonation).

## To build (later)
- `src/lib/ratingConfig.js` — the rating_config (gates/scores/scale/note rules).
- `src/hooks/useAssetRating.js` — load existing rating for an output_id; save/upsert.
- `src/components/RatingWorkspace.jsx` (+ subcomponents: GateControl, ScoreScale,
  AutoBadge, NoteBox, TriageControl) — renders from config, two-stage, 2-column.
- Entry button in `PublishingPanel.jsx`.
- CSS for the workspace.

## Notes / open
- `image_prompt` / `seed` / `product_id` may be null (not stored upstream yet) — columns
  are nullable; populate when available.
- `video_script` = `videos.prompt_used` / `videos.dialogue`.
