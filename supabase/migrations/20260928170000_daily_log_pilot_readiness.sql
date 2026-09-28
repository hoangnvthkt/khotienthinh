-- Daily Log pilot readiness (owner-approved batch 1, 28/09/2026).
--
-- 1. Room actions "Công bố tiến độ" (daily_log.publish_progress) and "Xem bằng
--    chứng nguồn lực" (payment.view_resource_evidence) were left audit_only, so
--    the Room screen could not grant them and no project could start a pilot
--    (the pilot requires one member who can approve and publish). Enforce them
--    like the other Daily Log actions. Nobody holds either action today.
-- 2. The engineer → summarizer → CHT workflow told nobody anything. Notices now
--    come from the database, like Safety issues:
--      slip submitted / resubmitted → its chosen recipient, otherwise everyone
--                                      who can summarize (Room verify)
--      slip returned               → its author, with the reason
--      summary sent to CHT         → the chosen approver
--      summary returned            → the summarizer, with the reason
--      summary approved            → the summarizer and the slip authors
--    The person who made the change is never notified. The browser stops
--    sending summary notices, so nobody gets two.

update app_private.project_permission_room_action_bindings
set enforcement_status = 'enforced',
    pbac_fallback_enabled = false,
    verified_at = now(),
    verified_source = 'daily_log_pilot_readiness_2026_09_28',
    updated_at = now()
where ((room_code = 'daily_log' and action_code = 'publish_progress')
    or (room_code = 'payment' and action_code = 'view_resource_evidence'))
  and enforcement_status = 'audit_only';

create or replace function app_private.daily_log_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then p_value::uuid end;
$$;

-- Active project members holding one Daily Log Room action in this scope.
create or replace function app_private.daily_log_room_recipient_ids(
  p_project_id text, p_construction_site_id text, p_action_code text
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct u.id), '{}'::uuid[])
  from public.project_staff staff
  join public.users u on u.id::text = staff.user_id and u.is_active and u.account_status = 'ACTIVE'
  where p_project_id is not null
    and staff.project_id = p_project_id
    and staff.end_date is null
    and (nullif(p_construction_site_id, '') is null or staff.construction_site_id is null
      or staff.construction_site_id = p_construction_site_id)
    and app_private.project_actor_has_effective_room_action(
      u.id, p_project_id, nullif(p_construction_site_id, ''), 'daily_log', p_action_code);
$$;

create or replace function app_private.daily_log_link(
  p_project_id text, p_construction_site_id text, p_daily_log_id text default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select '/#/da?' || concat_ws('&',
    'projectId=' || p_project_id,
    'siteId=' || nullif(p_construction_site_id, ''),
    'tab=dailylog',
    'dailyLogId=' || p_daily_log_id);
$$;

create or replace function app_private.daily_log_notify(
  p_recipients uuid[], p_actor uuid, p_reason text, p_type text, p_severity text,
  p_title text, p_message text, p_link text, p_source_type text, p_source_id text,
  p_construction_site_id text, p_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link,
    source_type, source_id, construction_site_id, priority, push_enabled, metadata, delivery_reason)
  select u.id::text, p_type, 'progress', p_title, p_message, p_message, p_severity, '📝', p_link,
    p_source_type, p_source_id || ':' || u.id, nullif(p_construction_site_id, ''), 'normal', true,
    p_metadata || jsonb_build_object('deliveredBy', 'daily_log_trigger'), p_reason
  from (select distinct unnest(p_recipients) id) recipient
  join public.users u on u.id = recipient.id and u.is_active and u.account_status = 'ACTIVE'
  where recipient.id is distinct from p_actor;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_private.notify_daily_log_source_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
        else app_private.daily_log_room_recipient_ids(new.project_id, new.construction_site_id, 'verify') end,
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
  end if;
  return new;
end;
$$;

create or replace function app_private.notify_daily_log_summary_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status text := case when tg_op = 'UPDATE' then old.status end;
  v_actor uuid := public.current_app_user_id();
  v_date text := to_char(left(new.date, 10)::date, 'DD/MM/YYYY');
  v_summarizer uuid := coalesce(app_private.daily_log_uuid(new.summarized_by_id),
    app_private.daily_log_uuid(new.submitted_by_id), app_private.daily_log_uuid(new.created_by_id));
  v_link text := app_private.daily_log_link(new.project_id, new.construction_site_id, new.id);
  v_source_id text := 'dailylog_' || new.id || ':' || coalesce(new.status, '') || ':'
    || coalesce(extract(epoch from new.last_action_at)::bigint::text, '');
  v_meta jsonb := jsonb_strip_nulls(jsonb_build_object('projectId', new.project_id,
    'constructionSiteId', new.construction_site_id, 'logId', new.id, 'date', new.date,
    'assignmentUserId', new.submitted_to_user_id));
  v_label text := case when coalesce(new.revision_no, 1) > 1 then 'Bản điều chỉnh nhật ký ngày ' else 'Nhật ký ngày ' end || v_date;
begin
  if new.summary_source_type is distinct from 'member_contributions'
    or new.status is not distinct from v_old_status then
    return new;
  end if;
  if new.status = 'submitted' then
    perform app_private.daily_log_notify(array[app_private.daily_log_uuid(new.submitted_to_user_id)], v_actor,
      'assigned', 'info', 'info', v_label || ' chờ bạn duyệt',
      coalesce(nullif(btrim(new.summarized_by_name), ''), 'Người tổng hợp') || ' gửi bản tổng hợp'
        || coalesce(' ' || nullif(new.summary_contribution_count, 0) || ' phiếu', '') || '.',
      v_link, 'dailylog_summary_submitted', v_source_id, new.construction_site_id, v_meta);
  elsif new.status = 'rejected' then
    perform app_private.daily_log_notify(array[v_summarizer], v_actor, 'assigned', 'warning', 'warning',
      v_label || ' bị trả lại',
      'Bản tổng hợp bị trả lại' || coalesce(': ' || left(nullif(btrim(new.rejection_reason), ''), 300), '.'),
      v_link, 'dailylog_rejected', v_source_id, new.construction_site_id, v_meta);
  elsif new.status = 'verified' then
    perform app_private.daily_log_notify(
      array[v_summarizer] || coalesce((
        select array_agg(app_private.daily_log_uuid(contribution.author_user_id))
        from public.daily_log_contributions contribution
        where contribution.included_in_daily_log_id = new.id
          or contribution.id in (select source.contribution_id from public.daily_log_summary_sources source
            where source.daily_log_id = new.id)
      ), '{}'::uuid[]),
      v_actor, 'watching', 'success', 'info', v_label || ' đã được duyệt',
      'Bản tổng hợp đã được ' || coalesce(nullif(btrim(new.verified_by), ''), 'CHT') || ' duyệt.',
      v_link, 'dailylog_verified', v_source_id, new.construction_site_id, v_meta);
  end if;
  return new;
end;
$$;

revoke all on function app_private.daily_log_uuid(text) from public, anon, authenticated;
revoke all on function app_private.daily_log_room_recipient_ids(text, text, text) from public, anon, authenticated;
revoke all on function app_private.daily_log_link(text, text, text) from public, anon, authenticated;
revoke all on function app_private.daily_log_notify(uuid[], uuid, text, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.notify_daily_log_source_change() from public, anon, authenticated;
revoke all on function app_private.notify_daily_log_summary_change() from public, anon, authenticated;

drop trigger if exists trg_daily_log_source_notify on public.daily_log_contributions;
create trigger trg_daily_log_source_notify
  after insert or update of status on public.daily_log_contributions
  for each row execute function app_private.notify_daily_log_source_change();

drop trigger if exists trg_daily_log_summary_notify on public.daily_logs;
create trigger trg_daily_log_summary_notify
  after insert or update of status on public.daily_logs
  for each row execute function app_private.notify_daily_log_summary_change();
