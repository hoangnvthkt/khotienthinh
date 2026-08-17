-- Cloud-only smoke. All fixtures and mutations are rolled back.
begin;

do $$
begin
  if to_regprocedure('public.create_quality_checklist(uuid,text,text,jsonb,jsonb)') is null
    or to_regprocedure('public.update_quality_checklist(uuid,text,text,uuid,timestamptz,jsonb)') is null
    or to_regprocedure('public.transition_quality_checklist(uuid,text,text,uuid,timestamptz,text,jsonb,text)') is null
    or to_regprocedure('public.delete_quality_checklist(uuid,text,text,uuid,timestamptz)') is null
    or to_regprocedure('public.create_quality_inspection_attempt(uuid,text,text,uuid,timestamptz,jsonb)') is null then
    raise exception 'Quality command RPC surface is incomplete';
  end if;
  if has_table_privilege('authenticated', 'public.quality_checklists', 'INSERT')
    or has_table_privilege('authenticated', 'public.quality_checklists', 'UPDATE')
    or has_table_privilege('authenticated', 'public.quality_checklists', 'DELETE')
    or has_table_privilege('authenticated', 'public.quality_inspection_attempts', 'INSERT') then
    raise exception 'Authenticated still has direct Quality writes';
  end if;
end;
$$;

create temp table quality_smoke_ids (
  project_id uuid not null,
  other_project_id uuid not null,
  site_id uuid not null,
  other_site_id uuid not null,
  position_id uuid not null,
  editor_id uuid not null,
  approver_id uuid not null,
  viewer_id uuid not null,
  editor_staff_id uuid not null,
  approver_staff_id uuid not null,
  viewer_staff_id uuid not null,
  editor_email text not null,
  approver_email text not null,
  viewer_email text not null
) on commit drop;

insert into quality_smoke_ids values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  'quality-smoke-editor@vioo.local',
  'quality-smoke-approver@vioo.local',
  'quality-smoke-viewer@vioo.local'
);

create temp table quality_smoke_state (
  checklist_id uuid,
  updated_at timestamptz,
  delete_checklist_id uuid,
  delete_updated_at timestamptz,
  create_request_id uuid not null default gen_random_uuid()
) on commit drop;
insert into quality_smoke_state default values;
grant select on quality_smoke_ids to authenticated;
grant select, insert, update on quality_smoke_state to authenticated;

insert into public.hrm_construction_sites (id, name)
select site_id, 'Quality smoke site' from quality_smoke_ids
union all
select other_site_id, 'Quality smoke other site' from quality_smoke_ids;

insert into public.projects (id, code, name, construction_site_id, source)
select project_id::text, 'QUALITY-SMOKE', 'Quality smoke project', site_id, 'manual'
from quality_smoke_ids
union all
select other_project_id::text, 'QUALITY-SMOKE-OTHER', 'Quality smoke other project', other_site_id, 'manual'
from quality_smoke_ids;

insert into public.hrm_positions (
  id, name, level, code, is_active, sort_order, source, metadata
)
select position_id, 'Quality smoke position', 1, 'QUALITY-SMOKE', true, 0, 'smoke', '{}'::jsonb
from quality_smoke_ids;

insert into public.users (
  id, name, email, username, role, is_active,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select editor_id, 'Quality smoke editor', editor_email, 'quality-smoke-editor',
  'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from quality_smoke_ids
union all
select approver_id, 'Quality smoke approver', approver_email, 'quality-smoke-approver',
  'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from quality_smoke_ids
union all
select viewer_id, 'Quality smoke viewer', viewer_email, 'quality-smoke-viewer',
  'EMPLOYEE'::public.user_role, true, '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from quality_smoke_ids;

insert into public.project_staff (
  id, project_id, construction_site_id, user_id, position_id, start_date, note
)
select editor_staff_id, project_id::text, site_id::text, editor_id::text,
  position_id, current_date, 'Quality editor'
from quality_smoke_ids
union all
select approver_staff_id, project_id::text, site_id::text, approver_id::text,
  position_id, current_date, 'Quality approver'
from quality_smoke_ids
union all
select viewer_staff_id, project_id::text, site_id::text, viewer_id::text,
  position_id, current_date, 'Quality viewer'
from quality_smoke_ids;

insert into public.project_permission_room_members (
  project_id, construction_site_id, room_code, project_staff_id, is_active
)
select project_id::text, site_id::text, 'quality', editor_staff_id, true from quality_smoke_ids
union all
select project_id::text, site_id::text, 'quality', approver_staff_id, true from quality_smoke_ids
union all
select project_id::text, site_id::text, 'quality', viewer_staff_id, true from quality_smoke_ids;

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, grant_source
)
select member.id, action_code, true, 'manual_room'
from public.project_permission_room_members member
join quality_smoke_ids ids on member.project_id = ids.project_id::text
cross join lateral unnest(case
  when member.project_staff_id = ids.editor_staff_id
    then array['view', 'edit', 'delete', 'submit']::text[]
  when member.project_staff_id = ids.approver_staff_id
    then array['view', 'approve']::text[]
  else array['view']::text[]
end) action_code
where member.room_code = 'quality';

set local role authenticated;
select set_config('request.jwt.claim.email', (select editor_email from quality_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', (select editor_email from quality_smoke_ids),
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  ids quality_smoke_ids%rowtype;
  v_result jsonb;
  v_request_id uuid := (select create_request_id from quality_smoke_state);
begin
  select * into ids from quality_smoke_ids;
  v_result := public.create_quality_checklist(
    v_request_id, ids.project_id::text, ids.site_id::text,
    jsonb_build_object(
      'code', 'QC-SMOKE-001', 'title', 'Quality command smoke',
      'work_date', current_date, 'attachments', '[]'::jsonb,
      'site_photos', '[]'::jsonb, 'checklist_data', '[]'::jsonb
    ), null
  );
  if not coalesce((v_result ->> 'ok')::boolean, false)
    or coalesce((v_result ->> 'replayed')::boolean, true) then
    raise exception 'Quality create command failed: %', v_result;
  end if;
  update quality_smoke_state set
    checklist_id = (v_result #>> '{checklist,id}')::uuid,
    updated_at = (v_result #>> '{checklist,updated_at}')::timestamptz;

  v_result := public.create_quality_checklist(
    v_request_id, ids.project_id::text, ids.site_id::text,
    jsonb_build_object(
      'code', 'QC-SMOKE-001', 'title', 'Quality command smoke',
      'work_date', current_date, 'attachments', '[]'::jsonb,
      'site_photos', '[]'::jsonb, 'checklist_data', '[]'::jsonb
    ), null
  );
  if not coalesce((v_result ->> 'replayed')::boolean, false) then
    raise exception 'Quality create replay was not recognized';
  end if;

  begin
    perform public.create_quality_checklist(
      v_request_id, ids.project_id::text, ids.site_id::text,
      jsonb_build_object('code', 'QC-SMOKE-CHANGED', 'title', 'Changed payload'), null
    );
    raise exception 'Reused request id with another payload unexpectedly succeeded';
  exception when others then
    if sqlerrm not like '%QUALITY_REQUEST_ID_REUSED%' then raise; end if;
  end;

  begin
    perform public.update_quality_checklist(
      gen_random_uuid(), ids.project_id::text, ids.site_id::text,
      (select checklist_id from quality_smoke_state), now() - interval '1 day',
      jsonb_build_object('title', 'Stale update')
    );
    raise exception 'Stale Quality update unexpectedly succeeded';
  exception when serialization_failure then null;
  end;

  begin
    perform public.update_quality_checklist(
      gen_random_uuid(), ids.other_project_id::text, ids.other_site_id::text,
      (select checklist_id from quality_smoke_state),
      (select updated_at from quality_smoke_state), jsonb_build_object('title', 'Wrong scope')
    );
    raise exception 'Cross-project Quality update unexpectedly succeeded';
  exception when insufficient_privilege or check_violation then null;
  end;

  v_result := public.update_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state),
    jsonb_build_object('title', 'Quality command smoke updated')
  );
  update quality_smoke_state set updated_at =
    (v_result #>> '{checklist,updated_at}')::timestamptz;

  v_result := public.create_quality_inspection_attempt(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state),
    jsonb_build_object('attempt_number', 1, 'result', 'PASSED', 'items_data', '[]'::jsonb)
  );
  if v_result -> 'attempt' is null then
    raise exception 'Quality inspection attempt was not returned';
  end if;
  update quality_smoke_state set updated_at =
    (v_result #>> '{checklist,updated_at}')::timestamptz;

  v_result := public.transition_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state), 'submitted',
    jsonb_build_object('user_id', ids.approver_id, 'note', 'Smoke submit'), null
  );
  update quality_smoke_state set updated_at =
    (v_result #>> '{checklist,updated_at}')::timestamptz;

  if not app_private.quality_storage_can_mutate(
    'quality/' || ids.project_id || '/' || ids.site_id || '/record/file.jpg'
  ) then
    raise exception 'Quality editor cannot mutate a correctly scoped Storage path';
  end if;
  if app_private.quality_storage_can_mutate(
    'quality/' || ids.other_project_id || '/' || ids.other_site_id || '/record/file.jpg'
  ) then
    raise exception 'Quality Storage scope leaked to another project/site';
  end if;
  if not app_private.quality_storage_can_mutate(
    'quality/' || ids.site_id || '/legacy-record/file.jpg'
  ) then
    raise exception 'Scoped legacy Quality Storage path was blocked during frontend rollout';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.email', (select approver_email from quality_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', (select approver_email from quality_smoke_ids),
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  ids quality_smoke_ids%rowtype;
  v_result jsonb;
begin
  select * into ids from quality_smoke_ids;
  v_result := public.transition_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state), 'returned', null, 'Bổ sung ảnh smoke'
  );
  update quality_smoke_state set updated_at =
    (v_result #>> '{checklist,updated_at}')::timestamptz;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.email', (select editor_email from quality_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', (select editor_email from quality_smoke_ids),
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  ids quality_smoke_ids%rowtype;
  v_result jsonb;
begin
  select * into ids from quality_smoke_ids;
  v_result := public.update_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state), jsonb_build_object('note', 'Đã bổ sung')
  );
  update quality_smoke_state set updated_at =
    (v_result #>> '{checklist,updated_at}')::timestamptz;
  v_result := public.transition_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state), 'submitted',
    jsonb_build_object('user_id', ids.approver_id), null
  );
  update quality_smoke_state set updated_at =
    (v_result #>> '{checklist,updated_at}')::timestamptz;

  v_result := public.create_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    jsonb_build_object('code', 'QC-SMOKE-DELETE', 'title', 'Delete smoke'), null
  );
  update quality_smoke_state set
    delete_checklist_id = (v_result #>> '{checklist,id}')::uuid,
    delete_updated_at = (v_result #>> '{checklist,updated_at}')::timestamptz;
  perform public.delete_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select delete_checklist_id from quality_smoke_state),
    (select delete_updated_at from quality_smoke_state)
  );
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.email', (select approver_email from quality_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', (select approver_email from quality_smoke_ids),
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  ids quality_smoke_ids%rowtype;
  v_result jsonb;
begin
  select * into ids from quality_smoke_ids;
  v_result := public.transition_quality_checklist(
    gen_random_uuid(), ids.project_id::text, ids.site_id::text,
    (select checklist_id from quality_smoke_state),
    (select updated_at from quality_smoke_state), 'approved', null, null
  );
  if v_result #>> '{checklist,status}' <> 'approved' then
    raise exception 'Quality approval failed: %', v_result;
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.email', (select viewer_email from quality_smoke_ids), true);
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object(
  'email', (select viewer_email from quality_smoke_ids),
  'sub', current_setting('request.jwt.claim.sub', true)
)::text, true);

do $$
declare
  ids quality_smoke_ids%rowtype;
begin
  select * into ids from quality_smoke_ids;
  if not exists (
    select 1 from public.quality_checklists item
    where item.id = (select checklist_id from quality_smoke_state)
  ) then
    raise exception 'Quality viewer cannot read the scoped checklist through RLS';
  end if;
  begin
    perform public.update_quality_checklist(
      gen_random_uuid(), ids.project_id::text, ids.site_id::text,
      (select checklist_id from quality_smoke_state),
      (select updated_at from quality_smoke_state), jsonb_build_object('title', 'Viewer write')
    );
    raise exception 'Quality viewer unexpectedly mutated a checklist';
  exception when insufficient_privilege then null;
  end;
  if app_private.quality_storage_can_mutate(
    'quality/' || ids.project_id || '/' || ids.site_id || '/record/file.jpg'
  ) or app_private.quality_storage_can_mutate(
    'quality/' || ids.site_id || '/legacy-record/file.jpg'
  ) then
    raise exception 'Quality viewer unexpectedly received Storage mutation access';
  end if;
end;
$$;

reset role;

do $$
declare
  ids quality_smoke_ids%rowtype;
begin
  select * into ids from quality_smoke_ids;
  if (select count(*) from public.notifications notification
      where notification.source_type = 'quality_checklist'
        and notification.source_id = (select checklist_id::text from quality_smoke_state)) < 3 then
    raise exception 'Quality workflow notifications were not written transactionally';
  end if;
  if (select count(*) from public.audit_trail audit
      where audit.module = 'quality'
        and (audit.record_id = (select checklist_id::text from quality_smoke_state)
          or audit.context ->> 'checklistId' = (select checklist_id::text from quality_smoke_state))) < 7 then
    raise exception 'Quality command audit trail is incomplete';
  end if;
  if exists (
    select 1 from public.quality_checklists item
    where item.id = (select delete_checklist_id from quality_smoke_state)
  ) then
    raise exception 'Quality delete command did not remove the draft';
  end if;
end;
$$;

rollback;
