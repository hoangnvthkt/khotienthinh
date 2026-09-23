-- Cloud-only Daily Log summary publication smoke. All writes roll back.
begin;

insert into public.users (id, name, email, username, role)
values (
  '71000000-0000-4000-8000-000000000001', 'Daily Log Publish Smoke',
  'daily-log-publish-smoke@example.invalid', 'daily_log_publish_smoke', 'ADMIN'
);

do $$
declare
  v_admin_auth_id uuid;
begin
  select auth_id into v_admin_auth_id
  from public.users
  where role = 'ADMIN' and auth_id is not null
  order by created_at
  limit 1;
  if v_admin_auth_id is null then raise exception 'smoke requires an existing Cloud admin identity'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_admin_auth_id, 'role', 'authenticated'
  )::text, true);
end;
$$;

insert into auth.users (id, email, raw_user_meta_data)
values (
  '71000000-0000-4000-8000-000000000001', 'daily-log-publish-smoke@example.invalid',
  '{"name":"Daily Log Publish Smoke"}'::jsonb
);

set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","email":"daily-log-publish-smoke@example.invalid","role":"authenticated"}';

insert into public.projects (id, code, name, project_type, status)
values ('daily-log-publish-smoke-project', 'DL-PUBLISH-SMOKE', 'Daily Log Publish Smoke', 'construction', 'active');

insert into public.hrm_positions (id, name, level, code, is_active, sort_order, source, metadata)
values (
  '71000000-0000-4000-8000-000000000002', 'Daily Log Publish Smoke Position', 1,
  'DL-PUBLISH-SMOKE', true, 0, 'smoke', '{"scope":"daily_log_publication"}'::jsonb
);

insert into public.project_staff (id, project_id, user_id, position_id, start_date)
values (
  '71000000-0000-4000-8000-000000000003', 'daily-log-publish-smoke-project',
  '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', current_date
);

insert into public.project_permission_room_members (
  id, project_id, room_code, project_staff_id, is_active, created_by
) values (
  '71000000-0000-4000-8000-000000000004', 'daily-log-publish-smoke-project', 'daily_log',
  '71000000-0000-4000-8000-000000000003', true, '71000000-0000-4000-8000-000000000001'
);

insert into public.project_permission_room_member_actions (
  room_member_id, action_code, is_active, granted_by, grant_source
) values
  ('71000000-0000-4000-8000-000000000004', 'approve', true, '71000000-0000-4000-8000-000000000001', 'manual_room'),
  ('71000000-0000-4000-8000-000000000004', 'publish_progress', true, '71000000-0000-4000-8000-000000000001', 'manual_room'),
  ('71000000-0000-4000-8000-000000000004', 'verify', true, '71000000-0000-4000-8000-000000000001', 'manual_room'),
  ('71000000-0000-4000-8000-000000000004', 'submit', true, '71000000-0000-4000-8000-000000000001', 'manual_room');

insert into public.project_tasks (
  id, project_id, name, start_date, end_date, progress, code, wbs_code, quantity, unit
) values (
  'daily-log-publish-smoke-task', 'daily-log-publish-smoke-project', 'Bê tông móng',
  '2026-09-01', '2026-10-31', 0, '1.1', '1.1', 100, 'm3'
);

insert into public.daily_logs (
  id, project_id, date, description, created_by, created_by_id, created_at,
  status, submitted_by_id, submitted_at, submitted_to_user_id,
  submitted_to_permission, ever_submitted, last_action_by, last_action_at,
  summary_source_type, summarized_by_id, summarized_at, photo_required
) values (
  'daily-log-publish-smoke-summary', 'daily-log-publish-smoke-project', '2026-09-23',
  'Bản tổng hợp smoke', 'Daily Log Publish Smoke', '71000000-0000-4000-8000-000000000001',
  '2026-09-23T01:00:00Z', 'submitted', '71000000-0000-4000-8000-000000000001',
  '2026-09-23T02:00:00Z', '71000000-0000-4000-8000-000000000001', 'approve', true,
  '71000000-0000-4000-8000-000000000001', '2026-09-23T02:00:00Z',
  'member_contributions', '71000000-0000-4000-8000-000000000001', '2026-09-23T01:30:00Z', false
);

insert into public.daily_log_contributions (
  id, project_id, date, author_user_id, author_name, status, submitted_at,
  work_area_code, work_area_name, row_version, source_fingerprint
) values (
  '71000000-0000-4000-8000-000000000010', 'daily-log-publish-smoke-project', '2026-09-23',
  '71000000-0000-4000-8000-000000000001', 'Daily Log Publish Smoke', 'submitted',
  '2026-09-23T01:00:00Z', 'A', 'Khu A', 2, 'source-fingerprint-2'
);

insert into public.daily_log_summary_sources (
  id, daily_log_id, contribution_id, source_user_id, source_user_name,
  source_version, source_fingerprint, source_state, review_status,
  work_area_code, work_area_name, sort_order
) values (
  '71000000-0000-4000-8000-000000000020', 'daily-log-publish-smoke-summary',
  '71000000-0000-4000-8000-000000000010', '71000000-0000-4000-8000-000000000001',
  'Daily Log Publish Smoke', 2, 'source-fingerprint-2', 'current', 'ready', 'A', 'Khu A', 0
);

insert into public.daily_log_work_items (
  id, contribution_id, project_id, task_id, work_area_code, work_area_name_snapshot,
  wbs_code_snapshot, task_name_snapshot, unit_snapshot, planned_quantity_snapshot,
  area_planned_quantity_snapshot, baseline_progress_percent, baseline_quantity_done,
  baseline_fingerprint, cumulative_progress_percent, cumulative_quantity_done,
  daily_quantity_done, schedule_finish_date_snapshot, forecast_finish_date
) values (
  '71000000-0000-4000-8000-000000000030', '71000000-0000-4000-8000-000000000010',
  'daily-log-publish-smoke-project', 'daily-log-publish-smoke-task', 'A', 'Khu A',
  '1.1', 'Bê tông móng', 'm3', 100, 100, 0, null, md5('0|0'), 30, 30, 30,
  '2026-10-31', '2026-10-31'
);

insert into public.daily_log_work_items (
  id, daily_log_id, summary_source_id, source_work_item_id, project_id, task_id,
  work_area_code, work_area_name_snapshot, wbs_code_snapshot, task_name_snapshot,
  unit_snapshot, planned_quantity_snapshot, area_planned_quantity_snapshot,
  baseline_progress_percent, baseline_quantity_done, baseline_fingerprint,
  cumulative_progress_percent, cumulative_quantity_done, daily_quantity_done,
  schedule_finish_date_snapshot, forecast_finish_date
) values (
  '71000000-0000-4000-8000-000000000031', 'daily-log-publish-smoke-summary',
  '71000000-0000-4000-8000-000000000020', '71000000-0000-4000-8000-000000000030',
  'daily-log-publish-smoke-project', 'daily-log-publish-smoke-task', 'A', 'Khu A',
  '1.1', 'Bê tông móng', 'm3', 100, 100, 0, null, md5('0|0'), 30, 30, 30,
  '2026-10-31', '2026-10-31'
);

insert into public.daily_log_wbs_decisions (
  daily_log_id, task_id, official_cumulative_percent, official_cumulative_quantity,
  official_daily_quantity, forecast_finish_date, aggregation_method,
  daily_quantity_method, included_source_work_item_ids, source_fingerprint
) values (
  'daily-log-publish-smoke-summary', 'daily-log-publish-smoke-task', 30, 30, 30,
  '2026-10-31', 'single_source', 'sum_non_overlapping',
  '["71000000-0000-4000-8000-000000000030"]'::jsonb, 'decision-fingerprint'
);

insert into public.daily_log_labor (
  id, daily_log_id, daily_log_work_item_id, summary_source_id, labor_type,
  count, hours, people_count, hours_per_person, total_labor_hours,
  provider_entry_mode, manual_provider_type, manual_provider_name,
  resource_semantics_version, unit_cost, total_cost, project_id, task_id
) values (
  '71000000-0000-4000-8000-000000000040', 'daily-log-publish-smoke-summary',
  '71000000-0000-4000-8000-000000000031', '71000000-0000-4000-8000-000000000020',
  'Tổ xây dựng', 4, 32, 4, 8, 32, 'manual', 'free_crew', 'Tổ anh Minh', 2,
  null, null, 'daily-log-publish-smoke-project', 'daily-log-publish-smoke-task'
);

insert into public.business_partners (id, code, name, classifications, is_active)
values ('daily-log-publish-smoke-provider', 'DL-SMOKE-PROVIDER', 'Nhà cung cấp smoke', array['supplier'], false);

select app_private.create_daily_log_assignment(
  'daily-log-publish-smoke-summary', '71000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_status text;
  v_progress_count bigint;
  v_source_snapshot jsonb;
begin
  -- A one-card change request must be atomic and preserve unrelated snapshots.
  begin
    v_source_snapshot := (select source_snapshot from public.daily_log_summary_sources where id = '71000000-0000-4000-8000-000000000020');
    perform public.request_daily_log_summary_source_changes_v1(
      'daily-log-publish-smoke-summary', '71000000-0000-4000-8000-000000000020',
      'Bổ sung ảnh hiện trường', '2026-09-23T02:00:00Z'
    );
    if (select review_status from public.daily_log_summary_sources where id = '71000000-0000-4000-8000-000000000020') <> 'change_requested'
      or (select status from public.daily_logs where id = 'daily-log-publish-smoke-summary') <> 'rejected'
      or (select source_snapshot from public.daily_log_summary_sources where id = '71000000-0000-4000-8000-000000000020') is distinct from v_source_snapshot then
      raise exception 'change request did not isolate the selected card';
    end if;
    raise exception 'ROLLBACK_CHANGE_REQUEST_CASE';
  exception when others then
    if sqlerrm <> 'ROLLBACK_CHANGE_REQUEST_CASE' then raise; end if;
  end;

  -- Price/cost/amount fields are rejected before detail rows can be written.
  begin
    perform app_private.assert_daily_log_wbs_resource_payload_v1(
      '[{"workItemClientKey":"work-1","laborType":"Tổ xây dựng","peopleCount":4,"hoursPerPerson":8,"unitCost":1000,"provider":{"entryMode":"manual","manualProviderType":"free_crew","manualProviderName":"Tổ anh Minh"}}]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'price payload was accepted';
  exception when others then
    if sqlerrm <> 'RESOURCE_PRICE_FIELDS_NOT_ALLOWED' then raise; end if;
  end;
  if exists (select 1 from public.daily_log_labor where id = '71000000-0000-4000-8000-000000000040' and (unit_cost is not null or total_cost is not null)) then
    raise exception 'physical resource acquired monetary values';
  end if;

  -- A locked week must leave status and progress untouched.
  insert into public.project_progress_period_states (
    scope_key, project_id, period_type, period_start, is_locked, locked_by, locked_at
  ) values (
    'daily-log-publish-smoke-project', 'daily-log-publish-smoke-project', 'weekly',
    '2026-09-21', true, '71000000-0000-4000-8000-000000000001', now()
  );
  begin
    perform public.publish_daily_log_summary_v1(
      'daily-log-publish-smoke-summary', '2026-09-23T02:00:00Z',
      '71000000-0000-4000-8000-000000000050'
    );
    raise exception 'locked period was published';
  exception when others then
    if sqlerrm <> 'PERIOD_LOCKED' then raise; end if;
  end;
  select status into v_status from public.daily_logs where id = 'daily-log-publish-smoke-summary';
  select count(*) into v_progress_count from public.project_daily_task_progress
    where source_daily_log_id = 'daily-log-publish-smoke-summary';
  if v_status <> 'submitted' or v_progress_count <> 0 then
    raise exception 'locked period changed status or progress';
  end if;
  delete from public.project_progress_period_states
    where scope_key = 'daily-log-publish-smoke-project' and period_type = 'weekly' and period_start = '2026-09-21';

  update public.daily_log_work_items set baseline_fingerprint = 'stale'
    where id = '71000000-0000-4000-8000-000000000031';
  begin
    perform public.publish_daily_log_summary_v1(
      'daily-log-publish-smoke-summary', '2026-09-23T02:00:00Z',
      '71000000-0000-4000-8000-000000000051'
    );
    raise exception 'stale baseline was published';
  exception when others then
    if sqlerrm <> 'STALE_PROGRESS_BASELINE' then raise; end if;
  end;
  update public.daily_log_work_items set baseline_fingerprint = md5('0|0')
    where id = '71000000-0000-4000-8000-000000000031';

  update public.daily_log_work_items
    set forecast_finish_date = '2026-11-01', forecast_change_reason = null
    where id = '71000000-0000-4000-8000-000000000031';
  begin
    perform public.publish_daily_log_summary_v1(
      'daily-log-publish-smoke-summary', '2026-09-23T02:00:00Z',
      '71000000-0000-4000-8000-000000000052'
    );
    raise exception 'forecast without reason was published';
  exception when others then
    if sqlerrm <> 'FORECAST_CHANGE_REASON_REQUIRED' then raise; end if;
  end;
  update public.daily_log_work_items
    set forecast_finish_date = schedule_finish_date_snapshot, forecast_change_reason = null
    where id = '71000000-0000-4000-8000-000000000031';

  update public.daily_log_labor
  set provider_entry_mode = 'catalog', partner_id = 'daily-log-publish-smoke-provider',
      provider_code_snapshot = 'DL-SMOKE-PROVIDER', provider_name_snapshot = 'Nhà cung cấp smoke',
      manual_provider_type = null, manual_provider_name = null
  where id = '71000000-0000-4000-8000-000000000040';
  begin
    perform set_config('app.daily_log_transition_context', 'on', true);
    update public.daily_logs
    set status = 'draft', last_action_at = '2026-09-23T02:01:00Z'
    where id = 'daily-log-publish-smoke-summary';
    perform set_config('app.daily_log_transition_context', '', true);
    perform public.submit_daily_log_summary_v1(
      'daily-log-publish-smoke-summary', '2026-09-23T02:01:00Z',
      '71000000-0000-4000-8000-000000000001'
    );
    raise exception 'inactive catalog provider was submitted';
  exception when others then
    if sqlerrm <> 'CATALOG_PROVIDER_NOT_ACTIVE' then raise; end if;
  end;
  begin
    perform public.publish_daily_log_summary_v1(
      'daily-log-publish-smoke-summary', '2026-09-23T02:00:00Z',
      '71000000-0000-4000-8000-000000000053'
    );
    raise exception 'inactive catalog provider was published';
  exception when others then
    if sqlerrm <> 'CATALOG_PROVIDER_NOT_ACTIVE' then raise; end if;
  end;
  update public.daily_log_labor
  set provider_entry_mode = 'manual', partner_id = null, provider_code_snapshot = null,
      provider_name_snapshot = null, manual_provider_type = 'free_crew', manual_provider_name = 'Tổ anh Minh'
  where id = '71000000-0000-4000-8000-000000000040';
end;
$$;

do $$
declare
  v_receipt_1 jsonb;
  v_receipt_2 jsonb;
  v_receipt_3 jsonb;
  v_transactions_before bigint;
  v_transactions_after bigint;
begin
  select count(*) into v_transactions_before from public.project_transactions;
  v_receipt_1 := public.publish_daily_log_summary_v1(
    'daily-log-publish-smoke-summary', '2026-09-23T02:00:00Z',
    '71000000-0000-4000-8000-000000000060'
  );
  v_receipt_2 := public.publish_daily_log_summary_v1(
    'daily-log-publish-smoke-summary', '2026-09-23T02:00:00Z',
    '71000000-0000-4000-8000-000000000060'
  );
  if v_receipt_1 is distinct from v_receipt_2 then
    raise exception 'same command id did not return the same receipt';
  end if;

  v_receipt_3 := public.publish_daily_log_summary_v1(
    'daily-log-publish-smoke-summary', '1999-01-01T00:00:00Z',
    '71000000-0000-4000-8000-000000000061'
  );
  if v_receipt_3 is distinct from v_receipt_1
    or (select count(*) from public.project_daily_task_progress
      where source_daily_log_id = 'daily-log-publish-smoke-summary'
        and task_id = 'daily-log-publish-smoke-task' and progress_date = '2026-09-23') <> 1 then
    raise exception 'different command id created duplicate progress';
  end if;
  if (select count(*) from public.daily_log_publish_commands where daily_log_id = 'daily-log-publish-smoke-summary') <> 1 then
    raise exception 'different command id created duplicate receipt';
  end if;
  if (select status from public.daily_logs where id = 'daily-log-publish-smoke-summary') <> 'verified' then
    raise exception 'publication did not verify the summary';
  end if;
  if exists (select 1 from public.daily_log_labor where id = '71000000-0000-4000-8000-000000000040' and (unit_cost is not null or total_cost is not null)) then
    raise exception 'published resource acquired monetary values';
  end if;
  select count(*) into v_transactions_after from public.project_transactions;
  if v_transactions_after <> v_transactions_before then
    raise exception 'project_transactions count changed';
  end if;
  -- Daily Log publication intentionally invokes no accrual table or command.
end;
$$;

rollback;
