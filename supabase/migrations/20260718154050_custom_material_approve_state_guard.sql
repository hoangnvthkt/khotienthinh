create or replace function public.transition_custom_material_request_status(
  p_request_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.custom_material_requests%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_line_status text;
  v_previous_guard text;
  v_result jsonb;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id then
    raise exception 'Không xác định được người dùng chuyển trạng thái phiếu CMR.'
      using errcode = '42501';
  end if;

  select *
  into v_request
  from public.custom_material_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu CMR.';
  end if;

  if coalesce(p_status, '') = 'cancelled' then
    raise exception 'Phiếu CMR không được hủy qua luồng duyệt.'
      using errcode = '23514';
  end if;

  v_required_permission := case
    when p_status = 'submitted' then 'project.custom_material.create'
    when p_status in ('po_created') then 'project.material_po.create'
    when p_status in ('partially_received', 'completed') then 'project.material_po.receive'
    else 'project.custom_material.approve'
  end;

  if v_required_permission = 'project.custom_material.approve'
    and (
      v_request.status is distinct from 'submitted'
      or coalesce(p_status, '') not in ('approved', 'returned', 'rejected')
    )
  then
    raise exception 'Chỉ phiếu CMR đang chờ duyệt mới được duyệt, trả lại hoặc từ chối.'
      using errcode = '23514';
  end if;

  if p_status = 'submitted' and coalesce(v_request.status, 'draft') not in ('draft', 'returned') then
    raise exception 'Chỉ phiếu nháp hoặc bị trả lại mới được gửi duyệt.';
  end if;

  if not app_private.material_has_action(v_request.project_id, v_request.construction_site_id, v_required_permission, v_user_id) then
    raise exception 'Bạn cần quyền % để chuyển trạng thái CMR.', v_required_permission
      using errcode = '42501';
  end if;

  v_line_status := case p_status
    when 'submitted' then 'submitted'
    when 'approved' then 'approved'
    when 'rejected' then 'cancelled'
    when 'cancelled' then 'cancelled'
    else null
  end;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.custom_material_requests
  set
    status = p_status,
    updated_by = v_user_id,
    submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then v_user_id else approved_by end,
    returned_at = case when p_status = 'returned' then now() else returned_at end,
    returned_by = case when p_status = 'returned' then v_user_id else returned_by end,
    rejected_at = case when p_status = 'rejected' then now() else rejected_at end,
    rejected_by = case when p_status = 'rejected' then v_user_id else rejected_by end,
    cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when p_status = 'cancelled' then v_user_id else cancelled_by end,
    updated_at = now()
  where id = p_request_id
  returning * into v_request;

  if v_line_status is not null then
    update public.custom_material_request_lines
    set status = v_line_status,
        updated_at = now()
    where request_id = p_request_id
      and status in ('draft', 'submitted');
  end if;

  insert into public.custom_material_request_events (
    request_id,
    event_type,
    actor_user_id,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    p_request_id,
    p_status,
    v_user_id,
    null,
    p_status,
    p_note,
    '{}'::jsonb
  );

  select to_jsonb(v_request)
    || jsonb_build_object(
      'lines',
      coalesce((
        select jsonb_agg(to_jsonb(l) order by l.sort_order)
        from public.custom_material_request_lines l
        where l.request_id = p_request_id
      ), '[]'::jsonb),
      'attachments',
      coalesce((
        select jsonb_agg(to_jsonb(a) order by a.created_at desc)
        from public.custom_material_request_attachments a
        where a.request_id = p_request_id
      ), '[]'::jsonb)
    )
  into v_result;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  return v_result;
end;
$$;

revoke all on function public.transition_custom_material_request_status(uuid, text, uuid, text) from public;
revoke all on function public.transition_custom_material_request_status(uuid, text, uuid, text) from anon;
grant execute on function public.transition_custom_material_request_status(uuid, text, uuid, text) to authenticated;
