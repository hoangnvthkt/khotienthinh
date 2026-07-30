create table if not exists app_private.request_export_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.request_instances(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  format text not null check (format in ('PRINT', 'PDF', 'WORD')),
  result text not null check (result in ('SUCCEEDED', 'FAILED')),
  error_message text,
  client_action_id uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_id, client_action_id)
);

create index if not exists request_export_audit_request_created_idx
  on app_private.request_export_audit (request_id, created_at desc);

create or replace function app_private.record_request_export_audit(
  p_request_id uuid,
  p_format text,
  p_result text,
  p_error_message text,
  p_client_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_audit app_private.request_export_audit;
begin
  if v_actor is null
    or not app_private.request_instance_can_select(p_request_id, v_actor) then
    raise exception using errcode = 'P0001', message = 'REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if upper(coalesce(p_format, '')) not in ('PRINT', 'PDF', 'WORD')
    or upper(coalesce(p_result, '')) not in ('SUCCEEDED', 'FAILED')
    or p_client_action_id is null then
    raise exception using errcode = '22023', message = 'REQUEST_PRINT_AUDIT_INVALID';
  end if;

  insert into app_private.request_export_audit (
    request_id, actor_id, format, result, error_message, client_action_id
  ) values (
    p_request_id, v_actor, upper(p_format), upper(p_result),
    nullif(left(trim(coalesce(p_error_message, '')), 500), ''), p_client_action_id
  )
  on conflict (actor_id, client_action_id) do update
    set request_id = excluded.request_id
  returning * into v_audit;

  return jsonb_build_object('id', v_audit.id, 'createdAt', v_audit.created_at);
end;
$$;

create or replace function public.record_request_export_audit(
  p_request_id uuid,
  p_format text,
  p_result text,
  p_error_message text default null,
  p_client_action_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.record_request_export_audit(
    p_request_id, p_format, p_result, p_error_message, p_client_action_id
  );
$$;

revoke all on table app_private.request_export_audit from public, anon, authenticated;
revoke all on function app_private.record_request_export_audit(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_request_export_audit(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.record_request_export_audit(uuid, text, text, text, uuid) to authenticated;
