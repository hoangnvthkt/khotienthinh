-- Nghỉ phép: chỉ người được ghi ở bước hoặc HR mới duyệt / từ chối / hủy được (audit phân quyền 23/10/2026).
-- Lỗ hổng có sẵn trên prod: bước kind 'hr' không ghi người (userId null) thì
--   v_is_assigned := (userId = mình) or (kind = 'hr' and v_is_hr) ra NULL với người không phải HR
--   (NULL OR FALSE = NULL), nên "if not v_is_assigned and not v_is_hr then raise" không chặn:
--   ai đăng nhập cũng duyệt / từ chối được (thử như nhân viên thường trên NP-2026-0030, có hoàn tác).
-- Sửa cùng kiểu:
--  1. decide_leave_request: coalesce(..., false) cho cả hai vế và cho v_is_hr.
--  2. cancel_leave_request: đơn chờ của hồ sơ chưa liên kết tài khoản (user_id null) thì "v_owner <> v_user" ra NULL
--     → ai cũng hủy được; đổi sang is distinct from.
--  3. process_request_step (luồng Yêu cầu cũ, giao diện không gọi nhưng authenticated vẫn EXECUTE được):
--     bước chờ không ghi userId thì "userId <> p_user_id" ra NULL → ai cũng duyệt được; đổi sang is distinct from.
-- Giữ nguyên thân hàm đang chạy trên Cloud (pg_get_functiondef 23/10/2026), chỉ đổi các dòng trên; quyền EXECUTE giữ nguyên.

-- 1) Duyệt / từ chối đơn nghỉ phép.
CREATE OR REPLACE FUNCTION public.decide_leave_request(p_request_id uuid, p_decision text, p_comment text DEFAULT NULL::text)
 RETURNS hrm_leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.current_app_user_id();
  v_is_hr boolean := coalesce(app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'), false);
  v_row public.hrm_leave_requests;
  v_step jsonb;
  v_index integer;
  v_is_assigned boolean;
  v_next jsonb;
  v_type public.hrm_leave_types%rowtype;
  v_employee public.employees%rowtype;
  v_year integer;
  v_day date;
  v_recipients uuid[];
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if p_decision not in ('approve', 'reject') then raise exception using errcode = '22023', message = 'Quyết định không hợp lệ.'; end if;

  select * into v_row from public.hrm_leave_requests where id = p_request_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đơn.'; end if;
  if v_row.status <> 'pending' then raise exception using errcode = '23514', message = 'Đơn này đã được xử lý.'; end if;
  select * into v_employee from public.employees where id = v_row."employeeId";
  if v_employee.user_id = v_user then raise exception using errcode = '42501', message = 'Không tự duyệt đơn của chính mình.'; end if;

  v_index := coalesce(v_row.current_step, 1) - 1;
  v_step := v_row.approvers -> v_index;
  if v_step is null then raise exception using errcode = '23514', message = 'Đơn không có bước duyệt hợp lệ.'; end if;
  -- Bước HR không ghi người (userId null): so sánh ra NULL, coalesce để không lọt qua kiểm tra dưới.
  v_is_assigned := coalesce((v_step ->> 'userId') = v_user::text, false)
    or coalesce(v_step ->> 'kind' = 'hr' and v_is_hr, false);
  if not v_is_assigned and not v_is_hr then
    raise exception using errcode = '42501', message = 'Bạn không phải người duyệt bước này.';
  end if;
  -- HR acting for someone else's step must say why; rejecting always needs a reason.
  if (not v_is_assigned or p_decision = 'reject') and length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 3 ký tự).';
  end if;

  v_step := v_step || jsonb_build_object(
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'decidedBy', v_user, 'decidedAt', now(), 'comment', nullif(trim(coalesce(p_comment, '')), ''),
    'onBehalf', not v_is_assigned);
  v_row.approvers := jsonb_set(v_row.approvers, array[v_index::text], v_step);

  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, case when p_decision = 'approve' then 'approve' else 'reject' end, v_user,
    concat_ws(' · ', 'Bước ' || (v_index + 1), case when not v_is_assigned then 'HR duyệt thay' end, nullif(trim(coalesce(p_comment, '')), '')));

  if p_decision = 'reject' then
    update public.hrm_leave_requests
    set approvers = v_row.approvers, status = 'rejected', "rejectionReason" = trim(p_comment),
        "approvedBy" = v_user::text, "approvedAt" = now()::text
    where id = v_row.id returning * into v_row;
    perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'Đơn bị từ chối', trim(p_comment));
    return v_row;
  end if;

  v_next := v_row.approvers -> (v_index + 1);
  if v_next is not null then
    update public.hrm_leave_requests set approvers = v_row.approvers, current_step = v_index + 2
    where id = v_row.id returning * into v_row;
    v_recipients := case when v_next ->> 'kind' = 'hr' then app_private.hrm_leave_hr_user_ids()
                         else array[(v_next ->> 'userId')::uuid] end;
    perform app_private.notify_hrm_leave(v_row.id, v_recipients, 'Đơn chờ bạn duyệt',
      format('%s · %s ngày từ %s (đã qua bước %s)', v_employee.full_name, v_row."totalDays", v_row."startDate", v_index + 1));
    return v_row;
  end if;

  -- Final approval: balance and timesheet follow.
  update public.hrm_leave_requests
  set approvers = v_row.approvers, status = 'approved', "approvedBy" = v_user::text, "approvedAt" = now()::text
  where id = v_row.id returning * into v_row;

  select * into v_type from public.hrm_leave_types where code = v_row.type;
  v_year := left(v_row."startDate", 4)::integer;
  if v_type.deducts_annual then
    perform app_private.hrm_leave_ledger_label('leave', v_row.id, v_row."startDate"::date, 'Nghỉ phép năm ' || coalesce(v_row.code, ''));
    update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" + v_row."totalDays"
    where "employeeId" = v_row."employeeId" and year = v_year;
    perform app_private.hrm_leave_ledger_label(null);
  elsif v_type.paid_by = 'none' and v_type.unit = 'day' then
    update public.hrm_leave_balances set "usedUnpaidDays" = "usedUnpaidDays" + v_row."totalDays"
    where "employeeId" = v_row."employeeId" and year = v_year;
  end if;

  -- Full leave days appear on the timesheet; days with punches or half days keep their punches.
  if v_type.unit = 'day' and v_row.type <> 'business_trip' then
    for v_day in select generate_series(v_row."startDate"::date, v_row."endDate"::date, interval '1 day')::date loop
      continue when app_private.hrm_leave_working_days(v_day, v_day,
        case when v_day = v_row."startDate"::date then v_row.start_session else 'full' end,
        case when v_day = v_row."endDate"::date then v_row.end_session else 'full' end) <> 1;
      insert into public.hrm_attendance (id, "employeeId", date, status, note, "approvalStatus", "createdAt")
      values (gen_random_uuid(), v_row."employeeId", v_day::text, 'leave', 'leave:' || v_row.id, 'approved', now())
      on conflict ("employeeId", date) do update
        set status = 'leave', note = left(concat_ws(E'\n', nullif(public.hrm_attendance.note, ''), 'leave:' || v_row.id), 1000)
        where public.hrm_attendance."checkIn" is null;
    end loop;
  end if;

  perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'Đơn đã được duyệt',
    format('%s · %s', (select name from public.hrm_leave_types where code = v_row.type),
      case when v_row.minutes is not null then v_row.minutes || ' phút' else v_row."totalDays" || ' ngày' end));
  return v_row;
end;
$function$;

-- 2) Hủy đơn nghỉ phép.
CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_request_id uuid, p_reason text)
 RETURNS hrm_leave_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := public.current_app_user_id();
  v_is_hr boolean := coalesce(app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'), false);
  v_row public.hrm_leave_requests;
  v_owner uuid;
  v_type public.hrm_leave_types%rowtype;
  v_year integer;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception using errcode = '22023', message = 'Nhập lý do hủy (ít nhất 3 ký tự).'; end if;
  select * into v_row from public.hrm_leave_requests where id = p_request_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đơn.'; end if;
  select user_id into v_owner from public.employees where id = v_row."employeeId";

  -- The requester withdraws a pending request; an approved one is cancelled by HR (it changes balance and timesheet).
  if v_row.status = 'pending' then
    if v_owner is distinct from v_user and not v_is_hr then raise exception using errcode = '42501', message = 'Chỉ người tạo đơn hoặc HR được hủy.'; end if;
  elsif v_row.status = 'approved' then
    if not v_is_hr then raise exception using errcode = '42501', message = 'Đơn đã duyệt chỉ HR được hủy. Liên hệ phòng HCNS.'; end if;
    select * into v_type from public.hrm_leave_types where code = v_row.type;
    v_year := left(v_row."startDate", 4)::integer;
    if v_type.deducts_annual then
      perform app_private.hrm_leave_ledger_label('leave_cancel', v_row.id, null, 'Hủy đơn ' || coalesce(v_row.code, '') || ': ' || trim(p_reason));
      update public.hrm_leave_balances set "usedPaidDays" = greatest(0, "usedPaidDays" - v_row."totalDays")
      where "employeeId" = v_row."employeeId" and year = v_year;
      perform app_private.hrm_leave_ledger_label(null);
    elsif v_type.paid_by = 'none' and v_type.unit = 'day' then
      update public.hrm_leave_balances set "usedUnpaidDays" = greatest(0, "usedUnpaidDays" - v_row."totalDays")
      where "employeeId" = v_row."employeeId" and year = v_year;
    end if;
    delete from public.hrm_attendance
    where "employeeId" = v_row."employeeId" and status = 'leave' and "checkIn" is null and note = 'leave:' || v_row.id;
  else
    raise exception using errcode = '23514', message = 'Đơn này đã kết thúc.';
  end if;

  update public.hrm_leave_requests
  set status = 'cancelled', cancelled_by = v_user, cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = v_row.id returning * into v_row;
  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, 'cancel', v_user, trim(p_reason));
  if v_owner <> v_user then
    perform app_private.notify_hrm_leave(v_row.id, array[v_owner], 'Đơn đã bị hủy', trim(p_reason));
  end if;
  return v_row;
end;
$function$;

-- 3) Luồng Yêu cầu cũ.
CREATE OR REPLACE FUNCTION public.process_request_step(p_request_id uuid, p_user_id uuid, p_action text, p_comment text DEFAULT ''::text)
 RETURNS request_instances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.request_instances%rowtype;
  v_current_user uuid := public.current_app_user_id();
  v_step jsonb;
  v_step_ord bigint;
  v_approvers jsonb;
  v_all_approved boolean;
  v_status text;
  v_step_order integer;
begin
  if v_current_user is null then
    raise exception 'authentication required';
  end if;
  if p_user_id is distinct from v_current_user and not public.is_module_admin('RQ') then
    raise exception 'cannot act as another user';
  end if;

  select * into v_req
  from public.request_instances
  where id = p_request_id
  for update;
  if not found then
    raise exception 'request not found: %', p_request_id;
  end if;
  if v_req.status not in ('PENDING', 'IN_PROGRESS') then
    raise exception 'request is not waiting for approval';
  end if;

  select elem, ord
    into v_step, v_step_ord
  from jsonb_array_elements(coalesce(v_req.approvers, '[]'::jsonb)) with ordinality as e(elem, ord)
  where elem->>'status' = 'waiting'
  order by coalesce((elem->>'order')::integer, ord::integer)
  limit 1;

  if v_step is null then
    raise exception 'no waiting approver';
  end if;
  if (v_step->>'userId') is distinct from p_user_id::text and not public.is_module_admin('RQ') then
    raise exception 'user is not the current approver';
  end if;

  v_step_order := coalesce((v_step->>'order')::integer, v_step_ord::integer);

  if upper(p_action) = 'APPROVED' then
    select jsonb_agg(
      case when ord = v_step_ord then
        elem || jsonb_build_object(
          'status', 'approved',
          'comment', coalesce(nullif(p_comment, ''), 'Đã duyệt'),
          'actedAt', now()::text
        )
      else elem end
      order by ord
    )
      into v_approvers
    from jsonb_array_elements(coalesce(v_req.approvers, '[]'::jsonb)) with ordinality as e(elem, ord);

    v_all_approved := not exists (
      select 1 from jsonb_array_elements(v_approvers) e(elem)
      where elem->>'status' = 'waiting'
    );
    v_status := case when v_all_approved then 'APPROVED' else 'PENDING' end;

    update public.request_instances
    set approvers = v_approvers,
        status = v_status,
        updated_at = now()
    where id = p_request_id
    returning * into v_req;

    insert into public.request_logs(request_id, action, acted_by, comment)
    values (
      p_request_id,
      'APPROVED',
      p_user_id,
      coalesce(nullif(p_comment, ''), 'Duyệt bước ' || v_step_order::text)
    );
  elsif upper(p_action) = 'REJECTED' then
    select jsonb_agg(
      case when ord = v_step_ord then
        elem || jsonb_build_object(
          'status', 'rejected',
          'comment', coalesce(nullif(p_comment, ''), 'Từ chối'),
          'actedAt', now()::text
        )
      else elem end
      order by ord
    )
      into v_approvers
    from jsonb_array_elements(coalesce(v_req.approvers, '[]'::jsonb)) with ordinality as e(elem, ord);

    update public.request_instances
    set approvers = v_approvers,
        status = 'REJECTED',
        updated_at = now()
    where id = p_request_id
    returning * into v_req;

    insert into public.request_logs(request_id, action, acted_by, comment)
    values (
      p_request_id,
      'REJECTED',
      p_user_id,
      coalesce(nullif(p_comment, ''), 'Từ chối ở bước ' || v_step_order::text)
    );
  else
    raise exception 'unsupported request action: %', p_action;
  end if;

  return v_req;
end;
$function$;
