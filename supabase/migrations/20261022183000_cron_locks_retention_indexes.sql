-- Vận hành (audit 20/10/2026, mục H4 + H5): cron có khóa chống chồng, retention telemetry, index FK, bỏ index thừa.
--
-- H4. Cron: 16 job, 4 job chạy mỗi phút, không job nào có advisory lock → khi DB bận (200 người) các tick xếp hàng và chồng
--     lên nhau. Gộp 3 tick mỗi phút (vehicle outbox, work, workflow) thành app_private.cron_tick_minute() và 3 tick 5 phút
--     (feedback auto-close, dọn đính kèm work, cảnh báo định kỳ) thành app_private.cron_tick_five_minutes(): mỗi hàm giữ
--     pg_try_advisory_xact_lock (trùng lượt thì bỏ qua, không xếp hàng), từng việc con chạy trong khối exception riêng
--     (một việc lỗi không làm hỏng việc khác, lỗi ghi vào kết quả trả về để cron.job_run_details còn thấy).
--     Job 9 (http_post process-request-notifications) và các job theo ngày giữ nguyên.
--     cleanup-expired-hrm-imports thất bại MỖI NGÀY (7/7 lần) vì xóa storage.objects bằng SQL (storage.protect_delete()
--     chặn, như sự cố #276): sửa chỉ xóa dòng hrm_import_batches; tệp hết hạn trong bucket hrm-private-imports để
--     Edge Function dọn sau (follow-up, bucket có giới hạn 20 MB/tệp và RLS theo thư mục người tải).
--
-- H5. Retention: user_session_events 147 nghìn dòng (61 MB, +19 nghìn/tuần, 28 nghìn dòng > 90 ngày, chỉ ghi không đọc),
--     notification_deliveries 19 nghìn (4 nghìn > 90 ngày), user_sessions giữ 180 ngày (events cascade theo session).
--     Job app_private.telemetry_retention_tick() mỗi ngày 03:15 UTC xóa theo lô 5.000 dòng.
--     Index FK: 21 cột FK trên bảng >200 kB chưa có index (inventory_ledger_entries.created_by/approved_by nằm trong
--     policy SELECT sau #267; transactions.supplier_id/approver_id; workflow_instances.template_version_id…).
--     Bỏ 4 index 0 lần dùng từ khi tạo (pg_stat_user_indexes chưa reset): idx_user_session_events_user_created (10 MB,
--     không hàm/màn nào đọc theo user_id), 3 index một cột trên notification_deliveries (status/channel/
--     provider_status_code, 630 kB). Giữ index FK, partial, GIN, vector dù 0 lần dùng (bảng đang rỗng hoặc phục vụ xóa dây chuyền).
--     VACUUM FULL cho project_daily_task_progress (13 MB/8 dòng), project_weekly_task_progress (7 MB/8 dòng),
--     cost_norm_import_raw_rows (3 MB/0 dòng) chạy riêng bằng psql (không chạy được trong transaction migration).

-- ---------------------------------------------------------------------------------------------------------
-- 1. Tick mỗi phút (thay job 11 vehicle-booking-notification-outbox, 25 work-notification-outbox,
--    50 process-workflow-notifications-every-minute).
create or replace function app_private.cron_tick_minute()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:tick_minute')) then
    return jsonb_build_object('skipped', 'lượt trước chưa xong');
  end if;

  begin
    v_result := v_result || jsonb_build_object('vehicle_outbox', app_private.process_vehicle_notification_outbox(50));
  exception when others then
    v_result := v_result || jsonb_build_object('vehicle_outbox_error', sqlerrm);
  end;

  begin
    v_result := v_result || jsonb_build_object('work_notification', app_private.work_notification_tick());
  exception when others then
    v_result := v_result || jsonb_build_object('work_notification_error', sqlerrm);
  end;

  begin
    v_result := v_result || jsonb_build_object('workflow_notification', app_private.workflow_notification_tick());
  exception when others then
    v_result := v_result || jsonb_build_object('workflow_notification_error', sqlerrm);
  end;

  return v_result;
end;
$$;

-- 2. Tick 5 phút (thay job 10 vehicle-booking-feedback-auto-close, 38 work-attachment-cleanup, 55 server-scheduled-alerts).
create or replace function app_private.cron_tick_five_minutes()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:tick_five_minutes')) then
    return jsonb_build_object('skipped', 'lượt trước chưa xong');
  end if;

  begin
    v_result := v_result || jsonb_build_object('feedback_auto_close', app_private.process_feedback_auto_close());
  exception when others then
    v_result := v_result || jsonb_build_object('feedback_auto_close_error', sqlerrm);
  end;

  begin
    v_result := v_result || jsonb_build_object('work_attachment_cleanup', app_private.work_attachment_cleanup_tick());
  exception when others then
    v_result := v_result || jsonb_build_object('work_attachment_cleanup_error', sqlerrm);
  end;

  begin
    v_result := v_result || jsonb_build_object('scheduled_alerts', app_private.run_scheduled_alerts());
  exception when others then
    v_result := v_result || jsonb_build_object('scheduled_alerts_error', sqlerrm);
  end;

  return v_result;
end;
$$;

-- 3. Retention telemetry (mỗi ngày): theo lô để không giữ khóa lâu.
create or replace function app_private.telemetry_retention_tick(p_batch integer default 5000, p_max_batches integer default 40)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events bigint := 0;
  v_deliveries bigint := 0;
  v_sessions bigint := 0;
  v_rows bigint;
  v_i integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:telemetry_retention')) then
    return jsonb_build_object('skipped', 'lượt trước chưa xong');
  end if;

  for v_i in 1..p_max_batches loop
    delete from public.user_session_events e
    where e.id in (
      select id from public.user_session_events
      where created_at < now() - interval '90 days'
      limit p_batch
    );
    get diagnostics v_rows = row_count;
    v_events := v_events + v_rows;
    exit when v_rows < p_batch;
  end loop;

  for v_i in 1..p_max_batches loop
    delete from public.notification_deliveries d
    where d.id in (
      select id from public.notification_deliveries
      where created_at < now() - interval '90 days'
      limit p_batch
    );
    get diagnostics v_rows = row_count;
    v_deliveries := v_deliveries + v_rows;
    exit when v_rows < p_batch;
  end loop;

  -- Phiên đăng nhập giữ 180 ngày; user_session_events của phiên xóa theo (ON DELETE CASCADE).
  for v_i in 1..p_max_batches loop
    delete from public.user_sessions s
    where s.id in (
      select id from public.user_sessions
      where coalesce(last_seen_at, login_at, created_at) < now() - interval '180 days'
      limit p_batch
    );
    get diagnostics v_rows = row_count;
    v_sessions := v_sessions + v_rows;
    exit when v_rows < p_batch;
  end loop;

  return jsonb_build_object('user_session_events', v_events, 'notification_deliveries', v_deliveries, 'user_sessions', v_sessions);
end;
$$;

-- 4. cleanup-expired-hrm-imports: không xóa storage.objects bằng SQL nữa (storage.protect_delete() chặn → job lỗi mỗi ngày).
create or replace function app_private.cleanup_expired_hrm_import_batches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  -- Tệp trong bucket hrm-private-imports để Edge Function dọn (follow-up); dòng batch hết hạn xóa ngay.
  delete from public.hrm_import_batches where expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function app_private.cron_tick_minute() from public, anon, authenticated;
revoke all on function app_private.cron_tick_five_minutes() from public, anon, authenticated;
revoke all on function app_private.telemetry_retention_tick(integer, integer) from public, anon, authenticated;

-- 5. Lịch cron: gỡ 6 job cũ, đặt 3 job mới (cron.schedule theo tên: chạy lại migration không nhân đôi).
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'vehicle-booking-notification-outbox', 'work-notification-outbox', 'process-workflow-notifications-every-minute',
  'vehicle-booking-feedback-auto-close', 'work-attachment-cleanup', 'server-scheduled-alerts'
);
select cron.schedule('notification-ticks-every-minute', '* * * * *', 'select app_private.cron_tick_minute();');
select cron.schedule('maintenance-ticks-every-5-minutes', '*/5 * * * *', 'select app_private.cron_tick_five_minutes();');
select cron.schedule('telemetry-retention-daily', '15 3 * * *', 'select app_private.telemetry_retention_tick();');

-- 6. Index cho cột FK chưa có index (bảng nhỏ, tạo tức thì).
create index if not exists idx_transactions_supplier_id on public.transactions (supplier_id);
create index if not exists idx_transactions_approver_id on public.transactions (approver_id);
create index if not exists idx_transactions_updated_by on public.transactions (updated_by);
create index if not exists idx_inventory_ledger_entries_created_by on public.inventory_ledger_entries (created_by);
create index if not exists idx_inventory_ledger_entries_approved_by on public.inventory_ledger_entries (approved_by);
create index if not exists idx_inventory_transactions_created_by on public.inventory_transactions (created_by);
create index if not exists idx_inventory_transactions_approved_by on public.inventory_transactions (approved_by);
create index if not exists idx_inventory_transactions_reversal_of on public.inventory_transactions (reversal_of_inventory_transaction_id);
create index if not exists idx_user_permission_grants_granted_by on public.user_permission_grants (granted_by);
create index if not exists idx_user_permission_grants_revoked_by on public.user_permission_grants (revoked_by);
create index if not exists idx_workflow_instances_template_version_id on public.workflow_instances (template_version_id);
create index if not exists idx_workflow_instances_current_instance_node_id on public.workflow_instances (current_instance_node_id);
create index if not exists idx_workflow_step_assignments_node_id on public.workflow_step_assignments (node_id);
create index if not exists idx_workflow_step_assignments_instance_node_id on public.workflow_step_assignments (instance_node_id);
create index if not exists idx_requests_workflow_template_id on public.requests (workflow_template_id);
create index if not exists idx_daily_log_labor_subcontract_id on public.daily_log_labor (subcontract_id);
create index if not exists idx_daily_log_labor_source_labor_line_id on public.daily_log_labor (source_labor_line_id);
create index if not exists idx_procurement_source_line_registry_material_budget_item_id on public.procurement_source_line_registry (material_budget_item_id);
create index if not exists idx_procurement_source_line_registry_work_boq_item_id on public.procurement_source_line_registry (work_boq_item_id);
create index if not exists idx_hrm_payroll_import_rows_matched_employee_id on public.hrm_payroll_import_rows (matched_employee_id);
create index if not exists idx_hrm_payroll_import_rows_applied_assignment_id on public.hrm_payroll_import_rows (applied_assignment_id);

-- 7. Bỏ index 0 lần dùng (không FK, không partial/GIN/vector).
drop index if exists public.idx_user_session_events_user_created;
drop index if exists public.idx_notification_deliveries_status;
drop index if exists public.idx_notification_deliveries_channel;
drop index if exists public.idx_notification_deliveries_provider_status_code;
