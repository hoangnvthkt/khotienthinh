create index if not exists idx_request_outbox_claimable
  on app_private.request_notification_outbox (available_at, id)
  where status in ('PENDING', 'FAILED');

create or replace function app_private.require_request_notification_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'REQUEST_NOTIFICATION_WORKER_FORBIDDEN';
  end if;
end;
$$;

create or replace function app_private.claim_request_notification_outbox(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_rows jsonb;
begin
  perform app_private.require_request_notification_worker();
  with candidates as (
    select outbox.id
    from app_private.request_notification_outbox outbox
    where outbox.status in ('PENDING', 'FAILED')
      and outbox.attempt_count < 10
      and outbox.available_at <= now()
    order by outbox.available_at, outbox.id
    limit v_limit
    for update skip locked
  ), claimed as (
    update app_private.request_notification_outbox outbox
    set status = 'PROCESSING', locked_at = now(), attempt_count = outbox.attempt_count + 1
    from candidates
    where outbox.id = candidates.id
    returning outbox.id, outbox.request_id, outbox.recipient_user_id, outbox.event_key,
      outbox.event_type, outbox.payload, outbox.attempt_count
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'requestId', request_id, 'recipientUserId', recipient_user_id,
    'eventKey', event_key, 'eventType', event_type, 'payload', payload,
    'attemptCount', attempt_count
  )), '[]'::jsonb) into v_rows from claimed;
  return v_rows;
end;
$$;

create or replace function app_private.deliver_request_notification(p_outbox_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox app_private.request_notification_outbox%rowtype;
  v_notification_id uuid;
  v_request public.request_instances%rowtype;
  v_title text;
  v_message text;
begin
  perform app_private.require_request_notification_worker();
  select * into v_outbox from app_private.request_notification_outbox where id = p_outbox_id for update;
  if not found or v_outbox.status = 'DELIVERED' then return jsonb_build_object('delivered', false); end if;
  if v_outbox.status <> 'PROCESSING' then raise exception using errcode = 'P0001', message = 'REQUEST_NOTIFICATION_NOT_CLAIMED'; end if;
  select * into v_request from public.request_instances where id = v_outbox.request_id;
  if not found then raise exception using errcode = 'P0001', message = 'REQUEST_NOTIFICATION_REQUEST_MISSING'; end if;
  v_title := case v_outbox.event_type
    when 'REQUEST_SUBMITTED' then 'Đề xuất mới cần duyệt'
    when 'REQUEST_APPROVAL_REQUIRED' then 'Bạn có đề xuất cần duyệt'
    when 'REQUEST_REASSIGNED' then 'Đề xuất được chuyển người duyệt'
    when 'REQUEST_RETURNED' then 'Đề xuất đã được trả lại'
    when 'REQUEST_APPROVED' then 'Đề xuất đã được chấp thuận'
    when 'REQUEST_REJECTED' then 'Đề xuất đã bị từ chối'
    else 'Cập nhật đề xuất' end;
  v_message := coalesce(v_outbox.payload ->> 'requestCode', v_request.code) || ' · ' || coalesce(v_outbox.payload ->> 'title', v_request.title);
  insert into public.notifications (
    user_id, type, category, title, message, link, severity, source_type, source_id,
    priority, push_enabled, action_url, entity_type, entity_id, metadata
  ) values (
    v_outbox.recipient_user_id, 'info', 'request', v_title, v_message,
    '/rq/' || v_outbox.request_id::text, 'info', 'request_instance', v_outbox.request_id::text,
    'normal', true, '/rq/' || v_outbox.request_id::text, 'request_instance', v_outbox.request_id::text,
    jsonb_build_object('requestInstanceId', v_outbox.request_id, 'requestCode', v_request.code,
      'eventType', v_outbox.event_type, 'eventKey', v_outbox.event_key)
  ) returning id into v_notification_id;
  update app_private.request_notification_outbox
  set status = 'DELIVERED', delivered_at = now(), locked_at = null, last_error = null
  where id = v_outbox.id;
  return jsonb_build_object('delivered', true, 'notificationId', v_notification_id);
end;
$$;

create or replace function app_private.fail_request_notification_outbox(p_outbox_id uuid, p_error_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_attempt integer;
begin
  perform app_private.require_request_notification_worker();
  select attempt_count into v_attempt from app_private.request_notification_outbox where id = p_outbox_id for update;
  if not found then return; end if;
  update app_private.request_notification_outbox
  set status = 'FAILED', locked_at = null, last_error = left(coalesce(p_error_message, 'Delivery failed'), 500),
    available_at = case when v_attempt >= 10 then now() + interval '100 years'
      else now() + make_interval(secs => least(3600, 60 * power(2, greatest(v_attempt - 1, 0)))::integer) end
  where id = p_outbox_id;
end;
$$;

create or replace function public.claim_request_notification_outbox(p_limit integer default 50)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.claim_request_notification_outbox(p_limit);
$$;
create or replace function public.deliver_request_notification(p_outbox_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select app_private.deliver_request_notification(p_outbox_id);
$$;
create or replace function public.fail_request_notification_outbox(p_outbox_id uuid, p_error_message text)
returns void language sql security invoker set search_path = '' as $$
  select app_private.fail_request_notification_outbox(p_outbox_id, p_error_message);
$$;

revoke all on function app_private.claim_request_notification_outbox(integer) from public, anon, authenticated;
revoke all on function app_private.deliver_request_notification(uuid) from public, anon, authenticated;
revoke all on function app_private.fail_request_notification_outbox(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_request_notification_outbox(integer) from public, anon, authenticated;
revoke all on function public.deliver_request_notification(uuid) from public, anon, authenticated;
revoke all on function public.fail_request_notification_outbox(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_request_notification_outbox(integer) to service_role;
grant execute on function public.deliver_request_notification(uuid) to service_role;
grant execute on function public.fail_request_notification_outbox(uuid, text) to service_role;
