-- Gỡ "Hôm nay" đợt 0 PR-C (migration 20261008138002_center_dot0_today). Chỉ đọc nên gỡ không mất dữ liệu.
-- Gỡ kèm frontend (TodayView gọi vcc_my_center_v1). PR-A/PR-B giữ nguyên; gỡ riêng bằng các file center_dot0_*_rollback.sql.
begin;
drop function if exists public.vcc_my_center_v1(text);
drop function if exists app_private.vcc_uuid(text);
commit;
