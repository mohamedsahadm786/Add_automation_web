-- ============================================================
-- DRIVE -> SUPABASE STORAGE migration. Run once in the SQL editor. Idempotent.
--
-- Removes Google Drive from the pipeline. Going forward, every generated asset
-- (persona portrait, scene image, video) is uploaded straight into Supabase
-- Storage and its public URL is recorded on the row. The frontend serves those
-- URLs natively (<img>/<video>); nothing reads Drive anymore.
--
-- Asset -> bucket -> URL column:
--   persona portrait : bucket `personas` -> personas.portrait_storage_url   (NEW)
--   scene image      : bucket `images`   -> outputs.image_storage_url        (exists)
--   video (mp4)      : bucket `videos`   -> videos.storage_url               (exists)
--   reference images : bucket `tenant-images` -> tenant_images.storage_url   (exists)
--
-- The legacy drive_file_id / drive_url columns are KEPT (not dropped) so old
-- rows remain backfillable via the mirror-image / mirror-video functions, but
-- they are no longer written or read by the new generation.
-- ============================================================

-- 1) New Storage URL column for the persona portrait (the only missing one).
alter table public.personas
    add column if not exists portrait_storage_url text;

-- 2) Public bucket for persona portraits (browser/native <img> reads it).
insert into storage.buckets (id, name, public)
values ('personas', 'personas', true)
on conflict (id) do update set public = true;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'Public read personas bucket'
    ) then
        create policy "Public read personas bucket"
            on storage.objects for select
            to public
            using (bucket_id = 'personas');
    end if;
end $$;

-- 3) (Optional, documentation) mark the legacy Drive columns. Comments only —
--    no behavioural change, safe to keep the data for backfill.
comment on column public.personas.drive_file_id is 'LEGACY (Drive removed) — use portrait_storage_url';
comment on column public.personas.drive_url     is 'LEGACY (Drive removed) — use portrait_storage_url';
comment on column public.outputs.drive_file_id  is 'LEGACY (Drive removed) — use image_storage_url';
comment on column public.outputs.drive_url      is 'LEGACY (Drive removed) — use image_storage_url';
comment on column public.videos.drive_file_id   is 'LEGACY (Drive removed) — use storage_url';
comment on column public.videos.drive_url       is 'LEGACY (Drive removed) — use storage_url';

-- 4) Find rows still missing a Storage URL (legacy, need a one-time backfill):
--   select 'personas' t, count(*) from public.personas where portrait_storage_url is null
--   union all select 'outputs', count(*) from public.outputs where image_storage_url is null
--   union all select 'videos',  count(*) from public.videos  where storage_url is null;
-- ============================================================
