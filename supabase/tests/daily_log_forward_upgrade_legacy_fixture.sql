-- Synthetic pre-Daily-Log-V2 fixture for the dedicated Cloud upgrade rehearsal.
-- The runner must verify its exact isolated project ref before executing this.
-- Never run on production or baseline-vioo-git. Retained for upgrade assertions.
begin;
do $$
begin
  if to_regclass('public.daily_log_work_items') is not null then
    raise exception 'FORWARD_UPGRADE_REQUIRES_PRE_DAILY_LOG_SCHEMA';
  end if;
  if exists (select 1 from public.projects)
    or exists (select 1 from auth.users)
    or exists (select 1 from public.daily_logs) then
    raise exception 'FORWARD_UPGRADE_REQUIRES_EMPTY_SYNTHETIC_TARGET';
  end if;
end;
$$;

insert into public.projects(id, code, name, project_type, status)
values ('DL-UPGRADE-SYNTHETIC', 'DL-UPGRADE-SYNTHETIC',
  'Synthetic Daily Log upgrade fixture', 'construction', 'active');

insert into public.project_tasks(id, project_id, name, start_date, end_date,
  progress, code, wbs_code, quantity, unit)
values ('DL-UPGRADE-TASK', 'DL-UPGRADE-SYNTHETIC', 'Synthetic legacy WBS',
  '2026-09-01', '2026-10-31', 40, '1.1', '1.1', 100, 'm3');

insert into public.daily_logs(id, project_id, date, description, created_by,
  status, summary_source_type, verified, verified_by, verified_at)
values
  ('DL-UPGRADE-LEGACY-VERIFIED', 'DL-UPGRADE-SYNTHETIC', '2026-09-20',
    'Synthetic legacy verified summary', 'Synthetic legacy author',
    'verified', 'member_contributions', true, 'Synthetic verifier', '2026-09-20T08:00:00Z'),
  ('DL-UPGRADE-LEGACY-DRAFT', 'DL-UPGRADE-SYNTHETIC', '2026-09-21',
    'Synthetic legacy draft', 'Synthetic legacy author', 'draft', null, false, null, null),
  ('DL-UPGRADE-LEGACY-REJECTED', 'DL-UPGRADE-SYNTHETIC', '2026-09-22',
    'Synthetic legacy rejected log', 'Synthetic legacy author', 'rejected', null, false, null, null);

-- Historical fields are deliberately populated before the upgrade; they are
-- compatibility sentinels, not new physical/provider reporting or accrual.
insert into public.daily_log_labor(id, daily_log_id, project_id, labor_type,
  count, hours, unit_cost, total_cost, note)
values ('73000000-0000-4000-8000-000000000001', 'DL-UPGRADE-LEGACY-VERIFIED',
  'DL-UPGRADE-SYNTHETIC', 'Synthetic historical crew', 3, 8, 17, 51, 'Keep historical semantics');
insert into public.daily_log_machines(id, daily_log_id, project_id, machine_name,
  machine_type, shifts, hours, unit_cost, total_cost, note)
values ('73000000-0000-4000-8000-000000000002', 'DL-UPGRADE-LEGACY-VERIFIED',
  'DL-UPGRADE-SYNTHETIC', 'Synthetic historical machine', 'excavator', 2, 6,
  19, 38, 'Do not infer physical machine-hours from shifts');

insert into public.daily_log_contributions(id, project_id, date, author_user_id,
  author_name, status, content)
values ('73000000-0000-4000-8000-000000000003', 'DL-UPGRADE-SYNTHETIC',
  '2026-09-21', 'synthetic-legacy-author', 'Synthetic legacy author',
  'submitted', 'Keep legacy contribution without guessed work area');

insert into public.project_daily_task_progress(id, scope_key, project_id,
  task_id, progress_date, week_start, progress_percent, quantity_done,
  daily_quantity_done, source_daily_log_id, note)
values ('73000000-0000-4000-8000-000000000004', 'DL-UPGRADE-SYNTHETIC',
  'DL-UPGRADE-SYNTHETIC', 'DL-UPGRADE-TASK', '2026-09-20', '2026-09-14',
  40, 40, 7, 'DL-UPGRADE-LEGACY-VERIFIED', 'Keep historical manual progress');
commit;
