-- Video mirroring: serve videos from Supabase Storage instead of the flaky
-- Google Drive /preview iframe. Run this once in the Supabase SQL editor.
--
-- 1) A column to hold the native, public Storage URL for each video.
--    NULL = not mirrored yet (frontend falls back to Drive on play).
alter table public.videos
    add column if not exists storage_url text;

-- 2) A public bucket to hold the mirrored MP4s. Public = anyone with the URL
--    can stream it (needed for the hosted site's native <video>). The
--    mirror-video Edge Function uploads here with the service-role key.
insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do update set public = true;

-- 3) Read policy: allow anyone to read objects in the `videos` bucket.
--    (Public buckets are already world-readable via getPublicUrl, but this
--    makes the intent explicit and survives bucket setting changes.)
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Public read videos bucket'
    ) then
        create policy "Public read videos bucket"
            on storage.objects for select
            to public
            using (bucket_id = 'videos');
    end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Image mirroring (same idea, for card thumbnails). Drive's thumbnail endpoint
-- throttles; mirror images to Supabase and serve them natively. The image
-- lives on the OUTPUT row, so the URL column goes on `outputs`.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.outputs
    add column if not exists image_storage_url text;

insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do update set public = true;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage'
          and tablename = 'objects'
          and policyname = 'Public read images bucket'
    ) then
        create policy "Public read images bucket"
            on storage.objects for select
            to public
            using (bucket_id = 'images');
    end if;
end $$;
