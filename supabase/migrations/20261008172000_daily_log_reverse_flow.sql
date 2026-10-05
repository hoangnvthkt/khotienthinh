-- Nhật ký công trường — luồng ngược (chủ SP duyệt 05/10/2026, "đồng ý cả 4, câu 2 chọn A").
--
-- Rà soát 05/10 trên SMB-2026 (chạy thử trong giao dịch hoàn tác) thấy:
--  * Người tổng hợp có quyền verify nhưng thiếu submit nên không gửi được bản tổng hợp cho CHT
--    (01/10 KS phải gửi thay). Thiết kế can_act_on_subject_impl đã cho "summarize hoặc submit";
--    4 chỗ còn lại đòi riêng submit → sửa cho verify là đủ với bản tổng hợp từ phiếu.
--  * Mỗi phiếu gửi / rút báo cho mọi người có verify (8 người ở SMB). Nay chỉ báo người tổng hợp và
--    CHT nhận duyệt của bản tổng hợp gần nhất (còn quyền); chưa từng có bản tổng hợp thì giữ như cũ.
--  * Phiếu bị bỏ khỏi bản tổng hợp chưa gửi: báo cho kỹ sư.
-- Duyệt bản tổng hợp ở chế độ thí điểm làm ở giao diện (đường transition_daily_log_status sẵn có).

CREATE OR REPLACE FUNCTION app_private.submit_daily_log_summary_draft_v2(p_daily_log_id text, p_expected_updated_at timestamp with time zone, p_approver_user_id uuid, p_submission_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.daily_logs%rowtype;
begin
  if not exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id=p_daily_log_id) then
    return app_private.submit_daily_log_summary_legacy_v1(p_daily_log_id,p_expected_updated_at,p_approver_user_id,p_submission_note); end if;
  select * into l from public.daily_logs where id=p_daily_log_id;
  if public.current_app_user_id() is null or not app_private.current_actor_has_effective_room_action(l.project_id,l.construction_site_id,'daily_log','verify') then
    raise exception using errcode='42501',message='DAILY_LOG_SUBMIT_REQUIRED'; end if;
  perform app_private.lock_daily_log_rollout_v1(l.project_id,l.construction_site_id);
  perform 1 from public.daily_logs where id=p_daily_log_id for update;
  perform 1 from public.daily_log_summary_sources where daily_log_id=p_daily_log_id order by id for update;
  perform 1 from public.daily_log_contributions where id in(select contribution_id from public.daily_log_summary_sources where daily_log_id=p_daily_log_id) order by id for update;
  begin
    return app_private.submit_daily_log_summary_checked_v2(p_daily_log_id,p_expected_updated_at,p_approver_user_id,p_submission_note);
  exception when serialization_failure then
    if sqlerrm in('ROW_VERSION_CONFLICT','SUMMARY_SOURCE_REVIEW_BLOCKED') then raise exception using errcode='PT409',message=sqlerrm; end if;
    raise;
  end;
end $function$;

CREATE OR REPLACE FUNCTION app_private.submit_daily_log_summary_checked_v2(p_daily_log_id text, p_expected_updated_at timestamp with time zone, p_approver_user_id uuid, p_submission_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_log public.daily_logs%rowtype;
  v_previous_guard text := current_setting('app.daily_log_transition_context', true);
begin
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if v_log.summary_source_type is distinct from 'member_contributions'
    or coalesce(v_log.status, '') not in ('draft', 'rejected') then
    raise exception using errcode = '42501', message = 'SUMMARY_NOT_SUBMITTABLE';
  end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  -- Chủ SP 05/10/2026: ai có quyền tổng hợp (verify) thì được gửi bản tổng hợp cho CHT.
  if not app_private.current_actor_has_effective_room_action(
    v_log.project_id, v_log.construction_site_id, 'daily_log', 'verify') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_SUMMARIZE_AND_SUBMIT_REQUIRED';
  end if;
  if not app_private.daily_log_user_can_receive_assignment(
    v_log.project_id, v_log.construction_site_id, 'project.daily_log.approve', p_approver_user_id
  ) then raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVER_REQUIRED'; end if;
  if exists (select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id and state.is_locked
      and ((state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly' and state.period_start = date_trunc('week', v_log.date::date)::date))
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;
  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id, true);
  perform set_config('app.daily_log_transition_context', 'on', true);
  if v_log.submitted_to_permission is distinct from 'approve' then
  update public.daily_logs set submitted_to_permission = 'approve' where id = p_daily_log_id;
  end if;
  perform public.transition_daily_log_status(p_daily_log_id, 'submitted', p_approver_user_id::text, null, null);
  update public.daily_logs set submission_note = nullif(trim(p_submission_note), '') where id = p_daily_log_id;
  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id;
  return jsonb_build_object('dailyLogId', v_log.id, 'status', v_log.status,
    'updatedAt', v_log.last_action_at, 'approverUserId', v_log.submitted_to_user_id);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.submit_daily_log_summary_legacy_v1(p_daily_log_id text, p_expected_updated_at timestamp with time zone, p_approver_user_id uuid, p_submission_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_log public.daily_logs%rowtype;
  v_previous_guard text := current_setting('app.daily_log_transition_context', true);
begin
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if v_log.summary_source_type is distinct from 'member_contributions'
    or coalesce(v_log.status, '') not in ('draft', 'rejected') then
    raise exception using errcode = '42501', message = 'SUMMARY_NOT_SUBMITTABLE';
  end if;
  if coalesce(v_log.last_action_at, v_log.created_at) is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;
  -- Chủ SP 05/10/2026: ai có quyền tổng hợp (verify) thì được gửi bản tổng hợp cho CHT.
  if not app_private.current_actor_has_effective_room_action(
    v_log.project_id, v_log.construction_site_id, 'daily_log', 'verify') then
    raise exception using errcode = '42501', message = 'DAILY_LOG_SUMMARIZE_AND_SUBMIT_REQUIRED';
  end if;
  if not app_private.daily_log_user_can_receive_assignment(
    v_log.project_id, v_log.construction_site_id, 'project.daily_log.approve', p_approver_user_id
  ) then raise exception using errcode = '42501', message = 'DAILY_LOG_APPROVER_REQUIRED'; end if;
  if exists (select 1 from public.project_progress_period_states state
    where state.project_id = v_log.project_id
      and state.construction_site_id is not distinct from v_log.construction_site_id and state.is_locked
      and ((state.period_type = 'daily' and state.period_start = v_log.date::date)
        or (state.period_type = 'weekly' and state.period_start = date_trunc('week', v_log.date::date)::date))
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;
  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id, true);
  perform set_config('app.daily_log_transition_context', 'on', true);
  update public.daily_logs set submitted_to_permission = 'approve' where id = p_daily_log_id;
  perform public.transition_daily_log_status(p_daily_log_id, 'submitted', p_approver_user_id::text, null, null);
  update public.daily_logs set submission_note = nullif(trim(p_submission_note), '') where id = p_daily_log_id;
  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
  select log.* into v_log from public.daily_logs log where log.id = p_daily_log_id;
  return jsonb_build_object('dailyLogId', v_log.id, 'status', v_log.status,
    'updatedAt', v_log.last_action_at, 'approverUserId', v_log.submitted_to_user_id);
end;
$function$;

CREATE OR REPLACE FUNCTION app_private.enforce_daily_log_room_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_action text;
  v_target_action text;
begin
  if new.status is not distinct from old.status
    and new.submitted_to_user_id is not distinct from old.submitted_to_user_id
    and new.submitted_to_permission is not distinct from old.submitted_to_permission then
    return new;
  end if;

  if new.status is not distinct from old.status and new.status = 'submitted' then
    v_action := 'submit';
    v_target_action := case when new.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  elsif new.status = 'submitted' then
    v_action := 'submit';
    v_target_action := case when new.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  elsif new.status = 'verified' then
    v_action := case when old.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  elsif new.status = 'rejected' then
    v_action := case when old.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  else
    return new;
  end if;

  -- Bản tổng hợp từ phiếu: người tổng hợp (verify) được gửi CHT mà không cần thêm quyền submit.
  if v_action = 'submit' and new.summary_source_type = 'member_contributions'
    and app_private.current_actor_has_effective_room_action(new.project_id::text, new.construction_site_id::text, 'daily_log', 'verify') then
    null;
  else
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'daily_log', v_action
    );
  end if;

  if new.status = 'submitted' and nullif(new.submitted_to_user_id, '') is not null then
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'daily_log', v_target_action,
      new.submitted_to_user_id::uuid
    );
  end if;
  return new;
end;
$function$;

create or replace function app_private.daily_log_source_recipient_ids(p_project_id text, p_construction_site_id text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  -- Người tổng hợp + CHT của bản tổng hợp gần nhất (còn quyền); chưa có bản nào thì mọi người có verify.
  with latest as (
    select app_private.daily_log_uuid(d.summarized_by_id) summarizer, app_private.daily_log_uuid(d.submitted_to_user_id) approver
    from public.daily_logs d
    where d.project_id = p_project_id
      and (nullif(p_construction_site_id, '') is null or d.construction_site_id = p_construction_site_id)
      and d.summary_source_type = 'member_contributions' and nullif(d.summarized_by_id, '') is not null
    order by left(d.date, 10) desc, d.created_at desc
    limit 1
  ), picked as (
    select summarizer id from latest
    where summarizer = any(app_private.daily_log_room_recipient_ids(p_project_id, p_construction_site_id, 'verify'))
    union
    select approver from latest
    where approver = any(app_private.daily_log_room_recipient_ids(p_project_id, p_construction_site_id, 'approve'))
  )
  select case when exists (select 1 from picked where id is not null)
    then (select array_agg(id) from picked where id is not null)
    else app_private.daily_log_room_recipient_ids(p_project_id, p_construction_site_id, 'verify') end;
$$;

revoke all on function app_private.daily_log_source_recipient_ids(text, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.notify_daily_log_source_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_old_status text := case when tg_op = 'UPDATE' then old.status end;
  v_actor uuid := public.current_app_user_id();
  v_date text := to_char(new.date, 'DD/MM/YYYY');
  v_area text := coalesce(nullif(btrim(new.work_area_name), ''), 'chưa đặt tên khu vực');
  v_recipient uuid := app_private.daily_log_uuid(new.submitted_to_user_id);
  v_meta jsonb := jsonb_strip_nulls(jsonb_build_object('projectId', new.project_id,
    'constructionSiteId', new.construction_site_id, 'contributionId', new.id, 'date', new.date));
begin
  if new.status is not distinct from v_old_status then return new; end if;
  if new.status = 'submitted' then
    perform app_private.daily_log_notify(
      case when v_recipient is not null then array[v_recipient]
        else app_private.daily_log_source_recipient_ids(new.project_id, new.construction_site_id) end,
      v_actor, case when v_recipient is not null then 'assigned' else 'responsible' end, 'info', 'info',
      case when v_old_status = 'returned' then 'Phiếu nhật ký đã sửa, chờ tổng hợp'
        else 'Phiếu nhật ký mới chờ tổng hợp' end,
      coalesce(nullif(btrim(new.author_name), ''), 'Kỹ sư') || ' gửi phiếu ' || v_area || ' ngày ' || v_date || '.',
      app_private.daily_log_link(new.project_id, new.construction_site_id),
      'dailylog_source_submitted', 'dailylog_source_' || new.id || ':' || new.row_version,
      new.construction_site_id, v_meta);
  elsif new.status = 'returned' then
    perform app_private.daily_log_notify(
      array[app_private.daily_log_uuid(new.author_user_id)], v_actor, 'assigned', 'warning', 'warning',
      'Phiếu nhật ký bị trả, cần sửa',
      'Phiếu ' || v_area || ' ngày ' || v_date || ' bị '
        || coalesce(nullif(btrim(new.returned_by_name), ''), 'người tổng hợp') || ' trả lại'
        || coalesce(': ' || left(nullif(btrim(new.return_reason), ''), 300), '.'),
      app_private.daily_log_link(new.project_id, new.construction_site_id),
      'dailylog_source_returned', 'dailylog_source_' || new.id || ':' || new.row_version,
      new.construction_site_id, v_meta);
  elsif new.status = 'draft' and v_old_status = 'submitted' then
    perform app_private.daily_log_notify(
      case when v_recipient is not null then array[v_recipient]
        else app_private.daily_log_source_recipient_ids(new.project_id, new.construction_site_id) end,
      v_actor, case when v_recipient is not null then 'assigned' else 'responsible' end, 'info', 'info',
      'Phiếu nhật ký đã được rút về sửa',
      coalesce(nullif(btrim(new.author_name), ''), 'Kỹ sư') || ' rút phiếu ' || v_area || ' ngày ' || v_date
        || ' về sửa. Chưa cần tổng hợp phiếu này cho tới khi được gửi lại.',
      app_private.daily_log_link(new.project_id, new.construction_site_id),
      'dailylog_source_withdrawn', 'dailylog_source_' || new.id || ':' || new.row_version,
      new.construction_site_id, v_meta);
  end if;
  return new;
end;
$function$;

create or replace function app_private.notify_daily_log_source_dropped()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_log public.daily_logs%rowtype; v_src public.daily_log_contributions%rowtype;
begin
  -- Chỉ khi người tổng hợp bỏ phiếu khỏi bản nháp / bản cần sửa; không báo khi xóa cả bản tổng hợp.
  select * into v_log from public.daily_logs where id = old.daily_log_id;
  if not found or v_log.summary_source_type is distinct from 'member_contributions'
    or coalesce(v_log.status, 'draft') not in ('draft', 'rejected') then return old; end if;
  select * into v_src from public.daily_log_contributions where id = old.contribution_id;
  if not found or v_src.status <> 'submitted' then return old; end if;
  perform app_private.daily_log_notify(
    array[app_private.daily_log_uuid(v_src.author_user_id)], public.current_app_user_id(), 'assigned', 'info', 'info',
    'Phiếu nhật ký chưa được đưa vào tổng hợp',
    'Phiếu ' || coalesce(nullif(btrim(v_src.work_area_name), ''), 'chưa đặt tên khu vực') || ' ngày ' || to_char(v_src.date, 'DD/MM/YYYY')
      || ' đã được bỏ khỏi bản tổng hợp. Phiếu vẫn ở trạng thái đã gửi; cần sửa thì bấm "Rút về sửa".',
    app_private.daily_log_link(v_src.project_id, v_src.construction_site_id),
    'dailylog_source_dropped', 'dailylog_source_dropped_' || v_src.id || ':' || old.daily_log_id || ':' || v_src.row_version,
    v_src.construction_site_id,
    jsonb_strip_nulls(jsonb_build_object('projectId', v_src.project_id, 'constructionSiteId', v_src.construction_site_id,
      'contributionId', v_src.id, 'dailyLogId', old.daily_log_id, 'date', v_src.date)));
  return old;
end;
$$;

revoke all on function app_private.notify_daily_log_source_dropped() from public, anon, authenticated;
drop trigger if exists trg_daily_log_source_dropped_notify on public.daily_log_summary_sources;
create trigger trg_daily_log_source_dropped_notify
  after delete on public.daily_log_summary_sources
  for each row execute function app_private.notify_daily_log_source_dropped();
