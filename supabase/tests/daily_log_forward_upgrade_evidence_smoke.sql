-- Dedicated synthetic Cloud forward-upgrade fixture only. All writes roll back.
begin;
do $$
begin
  if (select count(*) from public.projects) <> 1
    or not exists (select 1 from public.projects where id = 'DL-UPGRADE-SYNTHETIC')
    or exists (select 1 from auth.users) then
    raise exception 'FORWARD_UPGRADE_SYNTHETIC_FIXTURE_REQUIRED';
  end if;
end;
$$;

-- Let the actual Auth profile trigger create its canonical profile. Precreating
-- a profile would require an administrator to link it and is not this fixture.
insert into auth.users(id, email, raw_user_meta_data)
values ('73000000-0000-4000-8000-000000000010',
  'daily-log-upgrade-reader@example.invalid', '{"name":"Synthetic evidence reader"}'::jsonb);

insert into public.hrm_positions(id, name, level, code, is_active, sort_order, source, metadata)
values ('73000000-0000-4000-8000-000000000011', 'Synthetic evidence position',
  1, 'DL-UPGRADE-SYNTHETIC', true, 0, 'smoke', '{"scope":"forward_upgrade"}'::jsonb);
insert into public.project_staff(id, project_id, user_id, position_id, start_date)
values ('73000000-0000-4000-8000-000000000012', 'DL-UPGRADE-SYNTHETIC',
  (select id from public.users where auth_id = '73000000-0000-4000-8000-000000000010'),
  '73000000-0000-4000-8000-000000000011', current_date);

set local role authenticated;
set local request.jwt.claims = '{"sub":"73000000-0000-4000-8000-000000000010","role":"authenticated"}';
do $$
begin
  begin
    perform public.get_verified_resource_usage_evidence_v1(
      'DL-UPGRADE-SYNTHETIC', null, '2026-09-20', '2026-09-22');
    raise exception 'UNGRANTED_FORWARD_UPGRADE_READER_ACCEPTED';
  exception when others then
    if sqlerrm <> 'RESOURCE_EVIDENCE_SCOPE_DENIED' then raise; end if;
  end;
end;
$$;
reset role;

update app_private.project_permission_room_action_bindings
set enforcement_status = 'pilot', pbac_fallback_enabled = false
where room_code = 'payment' and action_code = 'view_resource_evidence';
insert into public.project_permission_room_members(id, project_id, room_code,
  project_staff_id, is_active, created_by)
values ('73000000-0000-4000-8000-000000000013', 'DL-UPGRADE-SYNTHETIC',
  'payment', '73000000-0000-4000-8000-000000000012', true,
  (select id from public.users where auth_id = '73000000-0000-4000-8000-000000000010'));
insert into public.project_permission_room_member_actions(room_member_id,
  action_code, is_active, granted_by, grant_source)
values ('73000000-0000-4000-8000-000000000013', 'view_resource_evidence', true,
  (select id from public.users where auth_id = '73000000-0000-4000-8000-000000000010'), 'manual_room');

set local role authenticated;
do $$
declare v_result jsonb;
begin
  v_result := public.get_verified_resource_usage_evidence_v1(
    'DL-UPGRADE-SYNTHETIC', null, '2026-09-20', '2026-09-22');
  if (v_result ->> 'unknownLegacyCount')::integer <> 2
    or jsonb_array_length(v_result -> 'rows') <> 0
    or (v_result #>> '{totals,lineCount}')::integer <> 0 then
    raise exception 'LEGACY_EVIDENCE_WAS_INFERRED';
  end if;
  if v_result::text ~* '(unit_cost|unitCost|total_cost|totalCost|amount|accrual)' then
    raise exception 'LEGACY_MONEY_LEAKED_IN_EVIDENCE';
  end if;
end;
$$;
reset role;

do $$
begin
  if exists (select 1 from public.project_transactions)
    or exists (select 1 from public.daily_log_publish_commands)
    or exists (select 1 from app_private.daily_log_wbs_rollout_scopes) then
    raise exception 'FORWARD_UPGRADE_ACTIVATED_OR_CREATED_TRANSACTIONS';
  end if;
end;
$$;
rollback;
