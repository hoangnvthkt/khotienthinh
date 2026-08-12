begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'asset-images',
  'asset-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.vehicle_user_can_manage_asset_images(
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (
      select 1
      from public.users app_user
      where app_user.id = p_user_id
        and app_user.role = 'ADMIN'
    )
    or app_private.vehicle_user_has_permission(
      p_user_id,
      'booking.vehicle.manage_fleet'
    )
    or app_private.asset_has_any_action(
      'asset.catalog.edit',
      p_user_id
    )
    or app_private.asset_has_any_action(
      'asset.catalog.create',
      p_user_id
    )
  );
$$;

revoke all on function app_private.vehicle_user_can_manage_asset_images(uuid)
  from public, anon;
grant execute on function app_private.vehicle_user_can_manage_asset_images(uuid)
  to authenticated;

drop policy if exists p_asset_images_select on storage.objects;
create policy p_asset_images_select
on storage.objects
for select
to authenticated
using (bucket_id = 'asset-images');

drop policy if exists p_asset_images_insert on storage.objects;
create policy p_asset_images_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'asset-images'
  and (storage.foldername(name))[1] = 'assets'
  and app_private.vehicle_user_can_manage_asset_images(
    (select public.current_app_user_id())
  )
);

drop policy if exists p_asset_images_update on storage.objects;
create policy p_asset_images_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'asset-images'
  and (storage.foldername(name))[1] = 'assets'
  and app_private.vehicle_user_can_manage_asset_images(
    (select public.current_app_user_id())
  )
)
with check (
  bucket_id = 'asset-images'
  and (storage.foldername(name))[1] = 'assets'
  and app_private.vehicle_user_can_manage_asset_images(
    (select public.current_app_user_id())
  )
);

drop policy if exists p_asset_images_delete on storage.objects;
create policy p_asset_images_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'asset-images'
  and (storage.foldername(name))[1] = 'assets'
  and app_private.vehicle_user_can_manage_asset_images(
    (select public.current_app_user_id())
  )
);

grant select, insert, update, delete on storage.objects to authenticated;

commit;
