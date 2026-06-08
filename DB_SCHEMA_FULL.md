# Alluvi — Full Database Schema (single file) + Dataflow

> The entire Supabase/Postgres schema in one place, ordered parent-first, with
> the end-to-end dataflow. Reflects **every** migration including the latest:
> Drive→Storage, the scenarios catalog, and the learning layer.
>
> Conventions: **PK** = primary key, **FK** = foreign key, **UQ** = unique,
> *(trigger)* = auto-filled by a DB trigger (n8n never sets it),
> **LEGACY** = kept for old rows, not written/read by the new pipeline.

---

## 0. Migrations & run order

| # | File | Adds |
|---|---|---|
| 1 | `supabase_schema.sql` | core chain: `tiktok_accounts → personas → outputs → videos` |
| 2 | `tiktok_posting_migration.sql` | `tiktok_auth`, `tiktok_posts` |
| 3 | ~~`app_settings_migration.sql`~~ | ~~`app_settings`~~ — **DROPPED 2026-06-04** (table removed; was unused — keys live in `tenant_profiles`). Skip on a fresh rebuild. |
| 4 | `multitenancy_migration.sql` | `tiktok_accounts.tenant_id`, `tenant_profiles`, `tenant_images`, bucket `tenant-images` |
| 5 | `video_storage_migration.sql` | `videos.storage_url`, `outputs.image_storage_url`, buckets `videos`,`images` |
| 6 | `super_admin_migration.sql` | `tenant_profiles.role` |
| 7 | `impersonation_audit_migration.sql` | `impersonation_events` |
| 8 | `tenant_lifecycle_migration.sql` | `tenant_profiles.status`, `impersonation_events.action` |
| 9 | `tenant_id_everywhere_migration.sql` | `tenant_id` on personas/outputs/videos/tiktok_auth/tiktok_posts + **triggers** |
| 10 | `run_config_migration.sql` | `tenant_run_configs` |
| 11 | `asset_ratings_migration.sql` | `asset_ratings` |
| 12 | `outputs_prompt_and_rating_cleanup_migration.sql` | `outputs.prompt_used`; drops `asset_ratings.product_id`/`seed` |
| 13 | `pipeline_run_status_migration.sql` | `tenant_run_status` |
| 14 | `learning_layer_v2_migration.sql` | `scenarios`, `attribute_stats`, `attribute_priors`, `tuning_suggestions`, `tenant_learning_state`, view; `asset_ratings.composed_attributes`/`scenario_version` |
| 15 | `seed_scenarios_60.md` (SQL) | 60 curated rows into `scenarios` |
| 16 | `drive_to_storage_migration.sql` | `personas.portrait_storage_url`, bucket `personas`, legacy comments |
| 17 | `run_status_execution_id_migration.sql` | `tenant_run_status.execution_id` (+ index) — for the n8n Error Trigger tenant lookup |

**Fresh-DB order:** 1→14 in sequence (**skip #3 — `app_settings` is dropped**),
then 15 (seed), then 16. All idempotent.
Security posture across the board: **RLS disabled**, `GRANT ALL` to
`anon, authenticated, service_role` (MVP).

---

## 1. The spine

```
tenant_profiles ─┐ (tenant_id = auth.users.id; NULL = super-admin/global)
                 │ stamped onto every row below
                 ▼
tiktok_accounts ──< personas ──< outputs ──< videos ──< tiktok_posts
   HUMAN/web       Phase A        Phase B      Phase C     Posting
                 (n8n)          (n8n)        (n8n)        (n8n)
       └──< tiktok_auth (1:1 OAuth tokens)

scenarios ──► drive Phase B generation (scene recipes)        [n8n READ]
asset_ratings ──► attribute_stats ──► tenant_learning_state    [learning loop]
```
Cardinality: `personas.tiktok_account_id` UQ (1:1) · `outputs(persona_id,
scenario_id)` UQ · `videos.output_id` UQ (1:1) · `tiktok_posts.video_id` UQ ·
`tiktok_auth.tiktok_account_id` PK (1:1).

---

## 2. Pipeline core

### 2.1 `tiktok_accounts` — human input (web writes; n8n reads)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | chain root |
| tiktok_id | text | NOT NULL **UQ** | handle, no `@` |
| name | text | NOT NULL | |
| gender | text | NOT NULL | `female`/`male` — drives persona look |
| country | text | NOT NULL | drives look + language |
| age | int | NOT NULL, CHECK 0–120 | UI enforces 13–120 |
| language | text | NOT NULL | |
| tenant_id | uuid | | owner; NULL = admin/global |
| created_at | timestamptz | default now() | |
| updated_at | timestamptz | default now() | bumped by `trg_tiktok_accounts_updated_at` |

### 2.2 `personas` — Phase A (n8n writes)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| tiktok_account_id | bigint | FK→tiktok_accounts, NOT NULL **UQ** | 1:1 |
| portrait_storage_url | text | | **Storage URL of the portrait (NEW — primary)** |
| prompt_used | text | | portrait prompt |
| status | text | default `'done'` | |
| drive_file_id | text | | **LEGACY** |
| drive_url | text | | **LEGACY** |
| tenant_id | uuid | *(trigger)* `trg_persona_tenant` | from account |
| created_at | timestamptz | default now() | |

### 2.3 `outputs` — Phase B scene images (n8n writes)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| persona_id | bigint | FK→personas, NOT NULL | |
| scenario_id | text | NOT NULL | from `scenarios` |
| scenario_title | text | | |
| image_storage_url | text | | **Storage URL of the scene image (primary)** |
| qc_status | text | | `pass` / `skipped` |
| qc_reason | text | | `defect \| score \| resemblance \| attempts` |
| attempts | int | default 1 | |
| prompt_used | text | | **image prompt (n8n must fill)** |
| drive_file_id / drive_url | text | | **LEGACY** |
| tenant_id | uuid | *(trigger)* `trg_output_tenant` | from persona |
| created_at | timestamptz | default now() | |
| — | — | **UQ (persona_id, scenario_id)** | upsert key |

### 2.4 `videos` — Phase C clips (n8n writes)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| output_id | bigint | FK→outputs, **UQ** | 1:1 |
| scenario_id | text | | copied from output |
| storage_url | text | | **Storage URL of the mp4 (primary)** |
| prompt_used | text | | video/Seedance prompt |
| dialogue | text | | spoken dialogue |
| status | text | default `'done'` | |
| drive_file_id / drive_url | text | | **LEGACY** |
| tenant_id | uuid | *(trigger)* `trg_video_tenant` | from output |
| created_at | timestamptz | default now() | |

---

## 3. TikTok posting

### 3.1 `tiktok_auth` — OAuth tokens (1:1 account; n8n reads)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| tiktok_account_id | bigint | PK, FK→tiktok_accounts | |
| access_token | text | NOT NULL | |
| refresh_token | text | NOT NULL | |
| expires_at | timestamptz | NOT NULL | |
| open_id | text | NOT NULL | |
| scope | text | | |
| tenant_id | uuid | *(trigger)* `trg_tiktok_auth_tenant` | from account |
| updated_at | timestamptz | default now() | |

### 3.2 `tiktok_posts` — one row per published video (n8n writes)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| video_id | bigint | FK→videos, NOT NULL **UQ** | |
| tiktok_account_id | bigint | FK→tiktok_accounts, NOT NULL | |
| publish_id | text | | |
| status | text | NOT NULL | |
| tiktok_post_url | text | | |
| error_reason | text | | |
| posted_at | timestamptz | | |
| tenant_id | uuid | *(trigger)* `trg_tiktok_posts_tenant` | from account |
| created_at | timestamptz | default now() | |

---

## 4. Tenant identity & run control

### 4.1 `tenant_profiles` — one per customer (web writes; n8n reads)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| tenant_id | uuid | PK | = auth.users.id; root of isolation |
| name / email | text | | |
| fal_api_key | text | | **n8n reads per-tenant** |
| anthropic_api_key | text | | **n8n reads per-tenant** |
| product_briefing | text | | **freeform** (no structure) |
| company_briefing | text | | **freeform** (no structure) |
| onboarded | bool | NOT NULL default false | |
| role | text | NOT NULL default `'tenant'` | `tenant`/`super_admin` |
| status | text | NOT NULL default `'active'` | `active`/`suspended`/`removed` |
| created_at / updated_at | timestamptz | default now() | |

### 4.2 `tenant_images` — reference uploads (web writes; n8n reads)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| tenant_id | uuid | NOT NULL | owner |
| storage_url | text | NOT NULL | public URL (bucket `tenant-images`) |
| file_name | text | | original filename |
| created_at | timestamptz | default now() | |

> No product-vs-brand distinction — all rows are undifferentiated references.

### 4.3 `tenant_run_configs` — per-tenant run settings (web writes; n8n reads)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| tenant_id | uuid | PK | |
| one_per_persona | bool | NOT NULL default false | true = all personas; false = only without a video |
| tiktok_id | text | | targeting override (csv handles); null = all |
| max_videos_per_run | int | | scenarios per persona this run |
| max_qc_attempts | int | | QC retries before skip |
| video_duration | text | | e.g. `'15'` |
| video_resolution | text | | e.g. `'1080p'` |
| updated_at | timestamptz | NOT NULL default now() | |

### 4.4 `tenant_run_status` — run telemetry (n8n writes; web reads)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| tenant_id | uuid | PK | |
| status | text | | `running`/`completed`/`failed` |
| started_at / finished_at | timestamptz | | finished null while running |
| personas_made / images_made / videos_made | int | | display counts |
| message | text | | error/summary |
| execution_id | text | (indexed) | orchestrator's n8n execution id; Error Trigger looks up the tenant by it |
| updated_at | timestamptz | NOT NULL default now() | |

---

## 5. Learning layer (RLHF + selection)

### 5.1 `scenarios` — scene catalog (seeded; n8n reads). The generation source.
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| index_no | int | partial **UQ** (curated) | order 1..N; NULL for generated |
| scenario_id | text | NOT NULL **UQ** | stable id (`*_NN`) |
| tenant_id | uuid | FK→tenant_profiles ON DELETE CASCADE | **NULL = curated/shared** |
| source | text | NOT NULL default `'curated'`, CHECK in (curated,generated) | |
| category | text | | ~39 distinct values (see brief) |
| difficulty | text | | easy/medium/hard |
| scenario_title | text | | |
| content | jsonb | NOT NULL | **full scene recipe** (scene, outfit{style_brief,female,male}, pose, hand_assignment{phone_hand,product_hand,free_hand_action}, grip_or_placement, lighting, mood, palette, framing, camera_height) |
| composed_attributes | jsonb | NOT NULL | canonical learning tags (15 keys) |
| version | text | NOT NULL default `'v1'` | |
| content_hash | text | | md5 of content |
| active | bool | NOT NULL default true | only active processed |
| created_at / updated_at | timestamptz | default now() | |

### 5.2 `asset_ratings` — human QA (web writes; learning reads). One per output.
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| tenant_id | uuid | *(trigger)* `trg_asset_rating_tenant` | from output |
| output_id | bigint | FK→outputs, NOT NULL **UQ**, ON DELETE CASCADE | upsert key |
| video_id | bigint | FK→videos, ON DELETE SET NULL | |
| persona_id / tiktok_account_id | bigint | | snapshot |
| scenario_id / scenario_title | text | | snapshot |
| image_prompt | text | | from `outputs.prompt_used` |
| video_script | text | | from `videos.prompt_used`/`dialogue` |
| image_storage_url / video_storage_url | text | | snapshot |
| rater_id | text | | who rated |
| asset_triage | text | | `Accept`/`Reject`/`Flag` |
| image | jsonb | NOT NULL default `'{}'` | `{gates,scores,notes}` |
| video | jsonb | NOT NULL default `'{}'` | `{gates,scores,notes}` |
| image_rated / video_rated | bool | NOT NULL default false | |
| rubric_version | text | | config version |
| composed_attributes | jsonb | | **(NEW v2)** scenario tags snapshot |
| scenario_version | text | | **(NEW v2)** scenario content version |
| created_at / updated_at | timestamptz | default now() | |

> JSONB `image`/`video` shape: `{"gates":{"<id>":{"result":"Pass|Fail","auto_value":<n|null>,"disputed":bool}},"scores":{"<id>":1..5},"notes":{"<id>":"text"}}`

### 5.3 `attribute_stats` — per-tenant running tallies (n8n LEARN writes)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| tenant_id | uuid | NOT NULL, FK→tenant_profiles ON DELETE CASCADE | |
| context_key | text | NOT NULL default `'global'` | grouping bucket |
| attribute_key | text | NOT NULL | e.g. `lighting_type=golden_hour` |
| dimension | text | NOT NULL | rubric item (gate/score id) |
| kind | text | NOT NULL, CHECK in (gate,score) | |
| n / passes | int | NOT NULL default 0 | |
| sum_val / sum_sq | numeric | NOT NULL default 0 | for score mean/variance |
| estimate | numeric | | pass-rate or mean |
| updated_at | timestamptz | NOT NULL default now() | |
| — | — | **UQ (tenant_id, context_key, attribute_key, dimension)** | upsert key |

### 5.4 `attribute_priors` — cross-tenant cold-start pool (optional)
Same shape as `attribute_stats` **without** `tenant_id`; **UQ (context_key,
attribute_key, dimension)`.

### 5.5 `tuning_suggestions` — prompt/script fixes (n8n reads validated)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| id | bigint | PK identity | |
| tenant_id | uuid | NOT NULL, FK ON DELETE CASCADE | |
| scope_type | text | NOT NULL, CHECK in (attribute,scenario) | |
| scope_key | text | NOT NULL | |
| dimension | text | NOT NULL | |
| cause | text | | |
| suggested_edit | text | | |
| status | text | NOT NULL default `'candidate'`, CHECK in (candidate,testing,validated,rejected) | only `validated` alters prompts |
| evidence_n | int | NOT NULL default 0 | |
| score_delta | numeric | | |
| source_output_id | bigint | | |
| created_at / updated_at | timestamptz | default now() | |

### 5.6 `tenant_learning_state` — exploration→active gate (n8n reads + flips)
| Column | Type | Key/Constraint | Notes |
|---|---|---|---|
| tenant_id | uuid | PK, FK ON DELETE CASCADE | |
| phase | text | NOT NULL default `'exploration'`, CHECK in (exploration,active) | |
| engine_enabled | bool | NOT NULL default false | **the switch n8n reads** |
| min_coverage_pct | int | NOT NULL default 100, CHECK 1–100 | flip threshold |
| required_coverage | int | | optional snapshot at start |
| exploration_started_at | timestamptz | NOT NULL default now() | |
| engine_enabled_at | timestamptz | | set when flipped |
| updated_at | timestamptz | NOT NULL default now() | |

### 5.7 `v_tenant_exploration_progress` — VIEW (read-only)
Columns: `tenant_id`, `active_curated`, `resolved_curated`, `pct_complete`,
`is_complete`. **Resolved** = a curated scenario with ≥1 terminal output:
`qc_status='skipped'` OR (`qc_status='pass'` AND its rating `video_rated=true`).

---

## 6. Platform / admin

### 6.1 `impersonation_events` — super-admin audit (web only)
`id` PK · `actor` text NOT NULL default `'super_admin'` · `tenant_id` uuid NOT NULL ·
`tenant_name` · `tenant_email` · `action` text NOT NULL default `'view_page'`
(`view_page`/`suspend`/`reactivate`/`remove`) · `created_at`.

### 6.2 ~~`app_settings`~~ — DROPPED (2026-06-04)
Legacy global key/value store — **removed** (`drop table public.app_settings`). It
was unused by the app and never read by n8n; per-tenant API keys live in
`tenant_profiles.fal_api_key` / `anthropic_api_key`. Migration
`app_settings_migration.sql` is now obsolete.

---

## 7. Storage buckets (all public)

| Bucket | Holds | URL column |
|---|---|---|
| `personas` | persona portraits | `personas.portrait_storage_url` |
| `images` | scene images | `outputs.image_storage_url` |
| `videos` | mp4 clips | `videos.storage_url` |
| `tenant-images` | tenant reference uploads | `tenant_images.storage_url` |

Public URL pattern: `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`.

---

## 8. Triggers & functions

| Trigger | Table | Timing | Function | Effect |
|---|---|---|---|---|
| `trg_tiktok_accounts_updated_at` | tiktok_accounts | BEFORE UPDATE | `set_tiktok_accounts_updated_at` | `updated_at = now()` |
| `trg_persona_tenant` | personas | BEFORE INS/UPD | `set_persona_tenant` | tenant_id ← account |
| `trg_output_tenant` | outputs | BEFORE INS/UPD | `set_output_tenant` | tenant_id ← persona |
| `trg_video_tenant` | videos | BEFORE INS/UPD | `set_video_tenant` | tenant_id ← output |
| `trg_tiktok_auth_tenant` | tiktok_auth | BEFORE INS/UPD | `set_tiktok_account_child_tenant` | tenant_id ← account |
| `trg_tiktok_posts_tenant` | tiktok_posts | BEFORE INS/UPD | `set_tiktok_account_child_tenant` | tenant_id ← account |
| `trg_asset_rating_tenant` | asset_ratings | BEFORE INS/UPD | `set_asset_rating_tenant` | tenant_id ← output |

**`tenant_id` propagation:** web stamps it on `tiktok_accounts` only; the
triggers cascade it to every child. **n8n never sets `tenant_id`.**

---

## 9. Dataflow by stage (who reads / writes)

| Stage | Actor | READS | WRITES |
|---|---|---|---|
| Onboard account | Web | — | `tiktok_accounts` (+tenant_id) |
| Tenant setup | Web | — | `tenant_profiles`, `tenant_images`, `tenant_run_configs` |
| Run start | n8n | `tenant_run_configs`, `tenant_profiles` (keys/briefings), `tenant_learning_state`, `tiktok_accounts`, `scenarios` | `tenant_run_status='running'`, ensure `tenant_learning_state` row |
| Phase A | n8n | accounts, personas | upload portrait→`personas` bucket; `personas` (portrait_storage_url, prompt_used) |
| Phase B | n8n | `personas` (portrait_storage_url), `scenarios.content`, `outputs`/`videos` | upload image→`images` bucket; `outputs` (image_storage_url, prompt_used, qc_*) |
| Phase C | n8n | `outputs` (image_storage_url, qc=pass) | upload mp4→`videos` bucket; `videos` (storage_url, prompt_used, dialogue) |
| Posting | n8n | `tiktok_auth`, `videos` | `tiktok_posts` |
| Rate | Web | `outputs`,`videos`,`scenarios` | `asset_ratings` |
| LEARN | n8n | `asset_ratings`, `outputs.qc_status`, `scenarios.composed_attributes` | `attribute_stats` (+ QC-skip fails) |
| Gate flip | n8n | `v_tenant_exploration_progress`, `tenant_learning_state` | `tenant_learning_state` (→active) |
| Run end | n8n | — | `tenant_run_status='completed'`/`'failed'` |
| Active phase | n8n | `attribute_stats`, `tuning_suggestions` (validated) | (selection + prompt edits) |

> **Drive:** fully removed. Asset bytes live in Storage; scene context lives in
> `scenarios` + `tenant_*`; `drive_*` columns are LEGACY only.

---

*Pairs with `n8n_handoff_brief.md`, `n8n.md`, `read/db_for_n8n.md`,
`read/drive_to_storage.md`, `seed_scenarios_60.md`.*
