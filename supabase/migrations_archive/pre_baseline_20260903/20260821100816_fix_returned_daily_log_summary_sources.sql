-- Preserve the approver route for returned Daily Log summaries and prevent
-- deleting legacy source logs while a materialized summary still references them.

create or replace function app_private.daily_log_target_permission(
  p_summary_source_type text,
  p_submitted_to_permission text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_summary_source_type = 'member_contributions'
      or p_submitted_to_permission = 'approve'
    then 'project.daily_log.approve'
    else 'project.daily_log.verify'
  end;
$$;

revoke all on function app_private.daily_log_target_permission(text, text)
  from public, anon, authenticated;

create or replace function app_private.preserve_daily_log_summary_approval_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.daily_log_target_permission(
    new.summary_source_type,
    new.submitted_to_permission
  ) = 'project.daily_log.approve' then
    new.submitted_to_permission := 'approve';
  end if;
  return new;
end;
$$;

revoke all on function app_private.preserve_daily_log_summary_approval_route()
  from public, anon, authenticated;

drop trigger if exists preserve_daily_log_summary_approval_route on public.daily_logs;
drop trigger if exists zz_preserve_daily_log_summary_approval_route on public.daily_logs;
create trigger zz_preserve_daily_log_summary_approval_route
before insert or update of summary_source_type, submitted_to_permission, status
on public.daily_logs
for each row
execute function app_private.preserve_daily_log_summary_approval_route();

do $$
declare
  v_previous_guard text := current_setting('app.daily_log_transition_context', true);
begin
  perform set_config('app.daily_log_transition_context', 'on', true);

  update public.daily_logs
  set submitted_to_permission = 'approve'
  where summary_source_type = 'member_contributions'
    and submitted_to_permission is distinct from 'approve';

  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
exception when others then
  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
  raise;
end;
$$;

create index if not exists idx_daily_logs_legacy_summary_source_ids
on public.daily_logs
using gin ((summary_source_metadata -> 'legacyDailyLogIds'))
where summary_source_type = 'member_contributions';

create or replace function app_private.guard_daily_log_legacy_summary_source_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.daily_logs summary_log
    where summary_log.id <> old.id
      and summary_log.summary_source_type = 'member_contributions'
      and coalesce(summary_log.summary_source_metadata -> 'legacyDailyLogIds', '[]'::jsonb) ? old.id
  ) then
    raise exception 'Phiếu nhật ký nguồn đang được dùng trong bản tổng hợp. Hãy bỏ phiếu khỏi tổng hợp trước khi xoá.'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

revoke all on function app_private.guard_daily_log_legacy_summary_source_delete()
  from public, anon, authenticated;

drop trigger if exists guard_daily_log_legacy_summary_source_delete on public.daily_logs;
create trigger guard_daily_log_legacy_summary_source_delete
before delete on public.daily_logs
for each row
execute function app_private.guard_daily_log_legacy_summary_source_delete();

notify pgrst, 'reload schema';
