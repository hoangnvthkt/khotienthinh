-- Keep the deployed Quality UI working while the canonical project/site path
-- is promoted. Legacy writes remain scoped through the project Room action.
create or replace function app_private.quality_storage_can_mutate(name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with path as (
    select
      public.current_app_user_id() as actor_id,
      split_part(name, '/', 1) as prefix,
      split_part(name, '/', 2) as first_scope_id,
      case
        when nullif(split_part(name, '/', 5), '') is null
          then split_part(name, '/', 2)
        else split_part(name, '/', 3)
      end as site_id,
      split_part(name, '/', 3) as third_segment,
      split_part(name, '/', 4) as fourth_segment,
      nullif(split_part(name, '/', 5), '') as canonical_file_name
  )
  select case
    when path.actor_id is null
      or path.prefix <> 'quality'
      or nullif(path.first_scope_id, '') is null
      or nullif(path.third_segment, '') is null
      or nullif(path.fourth_segment, '') is null
      then false
    when path.canonical_file_name is not null then
      app_private.project_actor_has_effective_room_action(
        path.actor_id,
        path.first_scope_id,
        path.site_id,
        'quality',
        'edit'
      )
    else exists (
      select 1
      from public.projects project_row
      where project_row.construction_site_id::text = path.site_id
        and app_private.project_actor_has_effective_room_action(
          path.actor_id,
          project_row.id,
          path.site_id,
          'quality',
          'edit'
        )
    )
  end
  from path;
$$;

revoke all on function app_private.quality_storage_can_mutate(text)
  from public, anon;
grant execute on function app_private.quality_storage_can_mutate(text)
  to authenticated;

insert into public.permission_audit_events (
  actor_user_id,
  event_type,
  before_grants,
  after_grants,
  metadata
)
select
  null,
  'quality_storage_legacy_path_rollout_compat',
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object(
    'source', 'quality_storage_legacy_path_rollout_compat',
    'reason', 'deployed_quality_ui_uses_site_record_file_path',
    'canonical_path', 'quality/{projectId}/{siteId}/{recordId}/{file}',
    'legacy_path', 'quality/{siteId}/{recordId}/{file}'
  )
where not exists (
  select 1
  from public.permission_audit_events audit_event
  where audit_event.event_type = 'quality_storage_legacy_path_rollout_compat'
);

notify pgrst, 'reload schema';
