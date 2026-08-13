-- One-time recovery for the interrupted 2026-08-13 pre-cutover smoke run.
-- Guarded so it only changes the accidental pilot marker and reconstructs the
-- four removed workflow grants from the latest Room replacement audit event.
begin;

do $$
begin
  if (
    select count(*)
    from app_private.project_permission_room_action_bindings binding
    where binding.room_code = 'gantt'
      and binding.verified_source = 'gantt_room_authoritative_cutover_2026_08_13'
  ) <> 3 then
    raise exception 'Recovery guard failed: Gantt is not in the interrupted pre-cutover state';
  end if;
end;
$$;

update public.project_permission_rooms
set description = 'Quản lý công việc và xác nhận hoàn thành.',
    allowed_actions = array['view', 'edit', 'delete', 'submit', 'verify', 'approve']::text[],
    required_actions = array['verify', 'approve']::text[],
    updated_at = now()
where code = 'gantt';

insert into app_private.project_permission_room_action_bindings (
  room_code, action_code, legacy_permission_codes, enforcement_status,
  relationship_description, verified_at, verified_source, created_at, updated_at,
  pbac_fallback_enabled, prerequisite_action_codes
)
select
  'gantt', action_code, '{}'::text[], 'audit_only',
  'Chưa xác minh đầy đủ UI, frontend capability, backend RPC/RLS và database.',
  null, 'project_room_permission_audit_v1', now(), now(), true, '{}'::text[]
from unnest(array['view', 'edit', 'delete', 'submit', 'verify', 'approve']::text[]) action_code
on conflict (room_code, action_code) do update
set legacy_permission_codes = '{}'::text[],
    enforcement_status = 'audit_only',
    relationship_description = excluded.relationship_description,
    verified_at = null,
    verified_source = 'project_room_permission_audit_v1',
    updated_at = now(),
    pbac_fallback_enabled = true,
    prerequisite_action_codes = '{}'::text[];

with latest_scope_event as (
  select distinct on (
    event.metadata ->> 'project_id',
    coalesce(event.metadata ->> 'construction_site_id', '')
  )
    event.actor_user_id,
    event.created_at,
    event.metadata ->> 'project_id' as project_id,
    nullif(event.metadata ->> 'construction_site_id', '') as construction_site_id,
    event.after_grants
  from public.permission_audit_events event
  where event.event_type = 'replace_project_permission_room_members'
    and event.metadata ->> 'room_code' = 'gantt'
  order by event.metadata ->> 'project_id',
    coalesce(event.metadata ->> 'construction_site_id', ''),
    event.created_at desc
), intended_actions as (
  select
    event.actor_user_id,
    event.created_at,
    event.project_id,
    event.construction_site_id,
    (member_payload ->> 'project_staff_id')::uuid as project_staff_id,
    action_code
  from latest_scope_event event
  cross join lateral jsonb_array_elements(event.after_grants) member_payload
  cross join lateral jsonb_array_elements_text(member_payload -> 'action_codes') action_code
  where action_code in ('submit', 'verify', 'approve')
)
insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, granted_at, updated_at, grant_source
)
select member.id, intended.action_code, true, intended.actor_user_id,
  intended.created_at, now(), 'manual_room'
from intended_actions intended
join public.project_permission_room_members member
  on member.project_id = intended.project_id
  and member.construction_site_id is not distinct from intended.construction_site_id
  and member.room_code = 'gantt'
  and member.project_staff_id = intended.project_staff_id
  and member.is_active
on conflict (room_member_id, action_code) do update
set is_active = true,
    updated_at = now(),
    grant_source = 'manual_room';

do $$
declare
  v_restored_count integer;
begin
  select count(*) into v_restored_count
  from public.project_permission_room_members member
  join public.project_permission_room_member_actions action on action.room_member_id = member.id
  where member.room_code = 'gantt'
    and action.action_code in ('submit', 'verify', 'approve')
    and action.is_active;

  if v_restored_count <> 4 then
    raise exception 'Recovery expected four active workflow grants, got %', v_restored_count;
  end if;

  insert into public.permission_audit_events (
    actor_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    null, 'gantt_pre_cutover_recovery', '[]'::jsonb, '[]'::jsonb,
    jsonb_build_object(
      'room_code', 'gantt',
      'restored_workflow_grant_count', v_restored_count,
      'reason', 'Interrupted transaction smoke was missing outer BEGIN'
    )
  );
end;
$$;

commit;
