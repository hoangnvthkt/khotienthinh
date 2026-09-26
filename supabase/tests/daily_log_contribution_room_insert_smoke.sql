-- Dedicated baseline-vioo-git fixture only. Every test write rolls back.
begin;
select app_private.configure_daily_log_pilot_v1('DL-WBS-PILOT-20260925',null,'pilot','2026-09-25',
  'daily-log-wbs-20260925','72000000-0000-4000-8000-000000000004','Rollback-only Room source insertion test');
select set_config('request.jwt.claims', '{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  insert into public.daily_log_contributions(id,project_id,date,author_user_id,author_name,status)
  values(gen_random_uuid(),'DL-WBS-PILOT-20260925','2099-01-01','72000000-0000-4000-8000-000000000001','Room author','draft');
  begin
    insert into public.daily_log_contributions(id,project_id,date,author_user_id,author_name,status)
    values(gen_random_uuid(),'DL-WBS-PILOT-20260925','2099-01-01','72000000-0000-4000-8000-000000000002','Spoofed author','draft');
    raise exception 'author spoof accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.daily_log_contributions(id,project_id,date,author_user_id,author_name,status)
    values(gen_random_uuid(),'DL-WBS-PILOT-20260925','2026-09-24','72000000-0000-4000-8000-000000000001','Before cutover','draft');
    raise exception 'pre-cutover legacy permission was bypassed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
select set_config('request.jwt.claims', '{"sub":"89441ea9-ec40-46f3-b8ef-b647e6ede9b8","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    insert into public.daily_log_contributions(id,project_id,date,author_user_id,author_name,status)
    values(gen_random_uuid(),'DL-WBS-PILOT-20260925','2099-01-01','72000000-0000-4000-8000-000000000005','Read only','draft');
    raise exception 'reader write accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
