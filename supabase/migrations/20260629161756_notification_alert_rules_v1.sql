-- Configurable notification alert rules.
-- V1 moves formerly global operational alerts to admin-managed recipient rules.

create extension if not exists pgcrypto;

create table if not exists public.notification_alert_rules (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  label text not null,
  description text,
  category text not null,
  is_enabled boolean not null default true,
  thresholds jsonb not null default '{}'::jsonb,
  cooldown_minutes integer not null default 1440,
  recipient_config jsonb not null default '{"mode":"admin","fallbackToAdmin":true}'::jsonb,
  channels jsonb not null default '{"inApp":true,"webPush":true}'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_alert_rules_alert_key_unique unique (alert_key),
  constraint notification_alert_rules_cooldown_nonnegative check (cooldown_minutes >= 0),
  constraint notification_alert_rules_thresholds_object check (jsonb_typeof(thresholds) = 'object'),
  constraint notification_alert_rules_recipient_config_object check (jsonb_typeof(recipient_config) = 'object'),
  constraint notification_alert_rules_channels_object check (jsonb_typeof(channels) = 'object')
);

create index if not exists idx_notification_alert_rules_enabled
  on public.notification_alert_rules(is_enabled, category);

drop trigger if exists trg_notification_alert_rules_updated_at on public.notification_alert_rules;
create trigger trg_notification_alert_rules_updated_at
before update on public.notification_alert_rules
for each row execute function public.set_updated_at();

insert into public.notification_alert_rules (
  alert_key,
  label,
  description,
  category,
  is_enabled,
  thresholds,
  cooldown_minutes,
  recipient_config,
  channels
) values
  (
    'budget_overrun',
    'Ngân sách vượt/sắp vượt',
    'Cảnh báo khi chi phí dự án đạt ngưỡng hoặc vượt giá trị hợp đồng.',
    'budget',
    true,
    '{"warningPercent":90,"criticalPercent":100}'::jsonb,
    1440,
    '{"mode":"project_permission","projectPermissionCodes":["confirm","approve"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'overdue_payment',
    'Thanh toán quá hạn',
    'Cảnh báo lịch thanh toán đã quá hạn.',
    'payment',
    true,
    '{}'::jsonb,
    1440,
    '{"mode":"project_permission","projectPermissionCodes":["confirm","approve"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'material_waste',
    'Hao hụt vật tư vượt định mức',
    'Cảnh báo vật tư có tỷ lệ hao hụt vượt ngưỡng cấu hình.',
    'material',
    true,
    '{}'::jsonb,
    1440,
    '{"mode":"project_permission","projectPermissionCodes":["confirm","approve"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'slow_progress',
    'Tiến độ chậm',
    'Cảnh báo công trình đang thi công nhưng tiến độ thấp hơn ngưỡng.',
    'progress',
    true,
    '{"minProgressPercent":30}'::jsonb,
    1440,
    '{"mode":"project_permission","projectPermissionCodes":["edit","confirm","approve"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'attendance_reminder',
    'Nhắc chấm công',
    'Nhắc cá nhân chưa chấm công trước giờ vào làm.',
    'attendance',
    true,
    '{"minutesBefore":5}'::jsonb,
    1440,
    '{"mode":"employee_owner","fallbackToAdmin":false}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'contract_expiry',
    'Hợp đồng lao động sắp hết hạn',
    'Cảnh báo HRM khi hợp đồng lao động sắp hết hạn.',
    'hrm',
    true,
    '{"daysBeforeWarning":30,"criticalDays":7}'::jsonb,
    1440,
    '{"mode":"module_admins","moduleKeys":["HRM"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'overdue_request',
    'Yêu cầu quá hạn',
    'Cảnh báo phiếu yêu cầu quá hạn xử lý.',
    'system',
    true,
    '{}'::jsonb,
    1440,
    '{"mode":"module_admins","moduleKeys":["RQ"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'employee_birthday',
    'Sinh nhật nhân viên',
    'Thông báo sinh nhật nhân viên trong ngày cho nhóm HRM/Admin.',
    'hrm',
    true,
    '{}'::jsonb,
    1440,
    '{"mode":"module_admins","moduleKeys":["HRM"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":false}'::jsonb
  ),
  (
    'missing_payroll',
    'Chưa tính lương tháng này',
    'Cảnh báo HRM khi sau ngày 25 vẫn còn nhân viên chưa có bảng lương.',
    'hrm',
    true,
    '{"startDay":25}'::jsonb,
    1440,
    '{"mode":"module_admins","moduleKeys":["HRM"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'stale_daily_log',
    'Nhật ký chờ xác nhận quá lâu',
    'Cảnh báo nhật ký đã gửi nhưng quá hạn xác nhận.',
    'progress',
    true,
    '{"daysPending":2}'::jsonb,
    1440,
    '{"mode":"project_permission","projectPermissionCodes":["verify"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  ),
  (
    'safety_critical',
    'Sự cố an toàn nghiêm trọng',
    'Cảnh báo sự cố an toàn critical cho nhóm phụ trách dự án/Admin.',
    'safety',
    true,
    '{}'::jsonb,
    1440,
    '{"mode":"project_permission","projectPermissionCodes":["confirm","approve"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb,
    '{"inApp":true,"webPush":true}'::jsonb
  )
on conflict (alert_key) do update set
  label = excluded.label,
  description = excluded.description,
  category = excluded.category,
  thresholds = coalesce(public.notification_alert_rules.thresholds, excluded.thresholds),
  recipient_config = coalesce(public.notification_alert_rules.recipient_config, excluded.recipient_config),
  channels = coalesce(public.notification_alert_rules.channels, excluded.channels);

alter table public.notification_alert_rules enable row level security;

drop policy if exists notification_alert_rules_admin_select on public.notification_alert_rules;
drop policy if exists notification_alert_rules_admin_insert on public.notification_alert_rules;
drop policy if exists notification_alert_rules_admin_update on public.notification_alert_rules;
drop policy if exists notification_alert_rules_admin_delete on public.notification_alert_rules;

create policy notification_alert_rules_admin_select
on public.notification_alert_rules
for select
to authenticated
using (public.is_admin());

create policy notification_alert_rules_admin_insert
on public.notification_alert_rules
for insert
to authenticated
with check (public.is_admin());

create policy notification_alert_rules_admin_update
on public.notification_alert_rules
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy notification_alert_rules_admin_delete
on public.notification_alert_rules
for delete
to authenticated
using (public.is_admin());

revoke all on table public.notification_alert_rules from anon;
revoke all on table public.notification_alert_rules from public;
revoke all on table public.notification_alert_rules from authenticated;
grant select, insert, update, delete on table public.notification_alert_rules to authenticated;
grant all on table public.notification_alert_rules to service_role;

notify pgrst, 'reload schema';
