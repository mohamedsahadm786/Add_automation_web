-- 1) Add the scene-image prompt column to `outputs`, parallel to
--    `videos.prompt_used` (which holds the video script). It's empty for now;
--    n8n will be updated to push the image prompt here. The rating snapshot
--    then reads it into asset_ratings.image_prompt.
alter table public.outputs add column if not exists prompt_used text;

-- 2) Drop the asset_ratings snapshot columns that have no upstream source.
alter table public.asset_ratings drop column if exists product_id;
alter table public.asset_ratings drop column if exists seed;

-- (outputs + asset_ratings already have RLS off + grants from earlier migrations;
--  a new column inherits the table grants.)
