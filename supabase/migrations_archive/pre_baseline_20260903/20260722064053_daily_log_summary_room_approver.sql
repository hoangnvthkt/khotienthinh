-- Daily Log summaries choose their CHT from the scoped Nhật ký Room.
-- A selected recipient is still validated in the database; the client never
-- gets to manufacture an assignment for a permission peer outside that Room.
create or replace function app_private.daily_log_user_can_receive_assignment(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and app_private.project_user_has_room_action(
      p_user_id,
      p_project_id,
      p_construction_site_id,
      'daily_log',
      case p_permission_code
        when 'project.daily_log.verify' then 'verify'
        when 'project.daily_log.approve' then 'approve'
        else null
      end
    );
$$;

revoke all on function app_private.daily_log_user_can_receive_assignment(text, text, text, uuid) from public, anon, authenticated;

create or replace function app_private.create_daily_log_assignment(
  p_log_id text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_responsibility text;
  v_permission_code text;
  v_slot record;
  v_selected_user_id uuid;
  v_assignee_user_id uuid;
  v_scope_type text;
  v_scope_id text;
  v_assigned_reason text;
  v_metadata jsonb;
  v_assignment_id uuid;
begin
  select * into v_log from public.daily_logs where id = p_log_id for update;
  if not found then
    raise exception 'Không tìm thấy nhật ký công trường.' using errcode = 'P0002';
  end if;

  v_responsibility := case when coalesce(v_log.submitted_to_permission, '') = 'approve' then 'current_approver' else 'current_verifier' end;
  v_permission_code := case when v_responsibility = 'current_approver' then 'project.daily_log.approve' else 'project.daily_log.verify' end;

  select user_row.id
  into v_selected_user_id
  from public.users user_row
  where user_row.id::text = nullif(v_log.submitted_to_user_id, '');

  if v_selected_user_id is not null then
    if not app_private.daily_log_user_can_receive_assignment(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_permission_code,
      v_selected_user_id
    ) then
      raise exception 'Người được chọn không còn quyền % trong Room Nhật ký công trường.', v_responsibility
        using errcode = '42501';
    end if;

    v_assignee_user_id := v_selected_user_id;
    v_scope_type := case when nullif(v_log.construction_site_id::text, '') is not null then 'construction_site' else 'project' end;
    v_scope_id := coalesce(nullif(v_log.construction_site_id::text, ''), nullif(v_log.project_id::text, ''));
    v_assigned_reason := 'selected_from_daily_log_room';
    v_metadata := jsonb_build_object('source', 'daily_log_room', 'selected_by', p_actor_user_id);
  else
    select * into v_slot
    from app_private.resolve_daily_log_responsibility(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_responsibility,
      v_permission_code
    );

    if not found then
      raise exception 'Chưa chọn người chịu trách nhiệm % trong Room Nhật ký công trường.', v_responsibility
        using errcode = '42501',
              hint = 'Chọn người nhận trong Room Nhật ký công trường trước khi gửi.';
    end if;

    v_assignee_user_id := v_slot.assignee_user_id;
    v_scope_type := v_slot.scope_type;
    v_scope_id := v_slot.scope_id;
    v_assigned_reason := 'resolved_from_responsibility_slot';
    v_metadata := jsonb_build_object('responsibility_slot_id', v_slot.responsibility_slot_id);
  end if;

  with cancelled_assignments as (
    update public.app_assignments
    set status = 'cancelled', closed_at = now(), closed_by = p_actor_user_id,
        close_reason = 'reassigned', updated_at = now()
    where subject_type = 'daily_log' and subject_id = p_log_id and status = 'active'
    returning id
  )
  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  select id, 'cancelled', p_actor_user_id, jsonb_build_object('reason', 'reassigned')
  from cancelled_assignments;

  insert into public.app_assignments (
    subject_type, subject_id, workflow_step_id, principal_type, principal_id,
    responsibility, permission_code, scope_type, scope_id, status,
    assigned_by, assigned_reason, metadata
  ) values (
    'daily_log', p_log_id, v_responsibility, 'user', v_assignee_user_id,
    v_responsibility, v_permission_code, v_scope_type, v_scope_id, 'active',
    p_actor_user_id, v_assigned_reason, v_metadata
  ) returning id into v_assignment_id;

  insert into public.app_assignment_events (assignment_id, event_type, actor_user_id, metadata)
  values (v_assignment_id, 'assigned', p_actor_user_id, v_metadata);

  return v_assignment_id;
end;
$$;

revoke all on function app_private.create_daily_log_assignment(text, uuid) from public, anon, authenticated;

-- The selected recipient is accepted only when the user belongs to the exact
-- Room/action of the current workflow step. Legacy callers may omit it and
-- continue through their already-configured slot during the gradual cutover.
create or replace function public.transition_daily_log_status(
  p_log_id text,
  p_status text,
  p_requested_verifier_id text default null,
  p_requested_verifier_name text default null,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_actor_user_id uuid := public.current_app_user_id();
  v_actor_user_id_text text := public.current_app_user_id()::text;
  v_actor_name text;
  v_requested_user_id uuid;
  v_target_permission_code text;
  v_assignment_id uuid;
  v_assignment public.app_assignments%rowtype;
  v_owner_user_id uuid;
  v_previous_guard text;
  v_action text;
begin
  if v_actor_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.' using errcode = '42501';
  end if;
  if p_status not in ('submitted', 'verified', 'rejected') then
    raise exception 'Trạng thái nhật ký không hợp lệ: %', p_status using errcode = '22023';
  end if;

  select * into v_log from public.daily_logs where id = p_log_id for update;
  if not found then
    raise exception 'Không tìm thấy nhật ký công trường.' using errcode = 'P0002';
  end if;

  select coalesce(name, username, email, id::text) into v_actor_name from public.users where id = v_actor_user_id;
  v_action := case
    when p_status = 'submitted' then 'submit'
    when p_status = 'verified' and coalesce(v_log.submitted_to_permission, '') = 'approve' then 'approve'
    when p_status = 'verified' then 'verify'
    else 'return'
  end;
  if not app_private.can_act_on_subject_impl('daily_log', p_log_id, v_action) then
    raise exception 'Bạn không có assignment, grant hoặc trạng thái workflow hợp lệ để % nhật ký này.', v_action using errcode = '42501';
  end if;
  if p_status = 'rejected' and nullif(btrim(coalesce(p_rejection_reason, '')), '') is null then
    raise exception 'Vui lòng nhập lý do trả lại nhật ký.' using errcode = '22023';
  end if;

  if p_status = 'submitted' and nullif(p_requested_verifier_id, '') is not null then
    select user_row.id into v_requested_user_id
    from public.users user_row
    where user_row.id::text = p_requested_verifier_id;
    if v_requested_user_id is null then
      raise exception 'Người nhận nhật ký không hợp lệ.' using errcode = '22023';
    end if;
    v_target_permission_code := case when coalesce(v_log.submitted_to_permission, '') = 'approve' then 'project.daily_log.approve' else 'project.daily_log.verify' end;
    if not app_private.daily_log_user_can_receive_assignment(
      v_log.project_id::text, v_log.construction_site_id::text, v_target_permission_code, v_requested_user_id
    ) then
      raise exception 'Người được chọn chưa có quyền phù hợp trong Room Nhật ký công trường.' using errcode = '42501';
    end if;
  end if;

  v_previous_guard := current_setting('app.daily_log_transition_context', true);
  perform set_config('app.daily_log_transition_context', 'on', true);

  if p_status = 'submitted' then
    update public.daily_logs
    set status = 'submitted', verified = false,
        submitted_by = v_actor_user_id_text, submitted_by_id = v_actor_user_id_text, submitted_at = now(),
        requested_verifier_id = null, requested_verifier_name = null,
        submitted_to_user_id = v_requested_user_id::text,
        submitted_to_name = case when v_requested_user_id is null then null else (select coalesce(name, username, email, id::text) from public.users where id = v_requested_user_id) end,
        submitted_to_permission = case when coalesce(submitted_to_permission, '') = 'approve' then 'approve' else 'verify' end,
        submission_note = null, ever_submitted = true,
        rejected_by = null, rejected_by_id = null, rejected_at = null, rejection_reason = null,
        last_action_by = v_actor_user_id_text, last_action_at = now()
    where id = p_log_id;

    v_assignment_id := app_private.create_daily_log_assignment(p_log_id, v_actor_user_id);
    select * into v_assignment from public.app_assignments where id = v_assignment_id;
    update public.daily_logs
    set requested_verifier_id = v_assignment.principal_id::text,
        requested_verifier_name = (select coalesce(name, username, email, id::text) from public.users where id = v_assignment.principal_id),
        submitted_to_user_id = v_assignment.principal_id::text,
        submitted_to_name = (select coalesce(name, username, email, id::text) from public.users where id = v_assignment.principal_id),
        submitted_to_permission = case when v_assignment.permission_code = 'project.daily_log.approve' then 'approve' else 'verify' end
    where id = p_log_id;
  elsif p_status = 'verified' then
    update public.daily_logs
    set status = 'verified', verified = true,
        verified_by = coalesce(v_actor_name, v_actor_user_id_text), verified_by_id = v_actor_user_id_text, verified_at = now(),
        rejected_by = null, rejected_by_id = null, rejected_at = null, rejection_reason = null,
        last_action_by = v_actor_user_id_text, last_action_at = now()
    where id = p_log_id;
    perform app_private.close_daily_log_assignments(p_log_id, v_actor_user_id, 'completed');
  else
    select owner_user.id into v_owner_user_id from public.users owner_user
    where owner_user.id::text = coalesce(nullif(v_log.created_by_id, ''), nullif(v_log.submitted_by_id, ''), nullif(v_log.submitted_by, ''), nullif(v_log.created_by, '')) limit 1;
    update public.daily_logs
    set status = 'rejected', verified = false,
        rejected_by = coalesce(v_actor_name, v_actor_user_id_text), rejected_by_id = v_actor_user_id_text, rejected_at = now(), rejection_reason = p_rejection_reason,
        submitted_to_user_id = v_owner_user_id::text,
        submitted_to_name = (select coalesce(name, username, email, id::text) from public.users where id = v_owner_user_id),
        submitted_to_permission = 'edit', submission_note = p_rejection_reason,
        last_action_by = v_actor_user_id_text, last_action_at = now()
    where id = p_log_id;
    perform app_private.close_daily_log_assignments(p_log_id, v_actor_user_id, 'returned');
    perform app_private.create_daily_log_revision_assignment(p_log_id, v_owner_user_id, v_actor_user_id);
  end if;

  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
exception when others then
  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

revoke all on function public.transition_daily_log_status(text, text, text, text, text) from public, anon;
grant execute on function public.transition_daily_log_status(text, text, text, text, text) to authenticated;
