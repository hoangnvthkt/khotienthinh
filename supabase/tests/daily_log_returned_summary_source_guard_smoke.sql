-- Regression smoke for returned summaries and their linked legacy source logs.
-- Run against the linked Supabase Cloud project. Every fixture is rolled back.

begin;

do $$
begin
  if app_private.daily_log_target_permission('member_contributions', 'edit') <> 'project.daily_log.approve' then
    raise exception 'Returned member-contribution summary did not keep the approver route';
  end if;

  if app_private.daily_log_target_permission(null, 'edit') <> 'project.daily_log.verify' then
    raise exception 'Returned detail log did not resolve to the verifier route';
  end if;
end $$;

insert into public.daily_logs (
  id, date, weather, worker_count, description, status, verified,
  created_by, created_at
) values (
  'daily-log-source-guard-smoke-source', current_date, 'sunny', 8,
  'Linked source must not be deleted', 'draft', false, 'smoke', now()
), (
  'daily-log-source-guard-smoke-summary', current_date, 'sunny', 8,
  'Summary referencing the source', 'rejected', false, 'smoke', now()
);

update public.daily_logs
set summary_source_type = 'member_contributions',
    summary_source_metadata = jsonb_build_object(
      'aggregationVersion', 2,
      'legacyDailyLogIds', jsonb_build_array('daily-log-source-guard-smoke-source')
    )
where id = 'daily-log-source-guard-smoke-summary';

do $$
begin
  if not exists (
    select 1
    from public.daily_logs
    where id = 'daily-log-source-guard-smoke-summary'
      and status = 'rejected'
      and submitted_to_permission = 'approve'
  ) then
    raise exception 'Returned summary row did not persist the approver route';
  end if;
end $$;

do $$
begin
  begin
    delete from public.daily_logs
    where id = 'daily-log-source-guard-smoke-source';
    raise exception 'Linked Daily Log source deletion unexpectedly succeeded';
  exception
    when foreign_key_violation then null;
  end;
end $$;

rollback;
