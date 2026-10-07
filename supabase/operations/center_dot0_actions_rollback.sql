-- Gỡ thao tác nhanh đợt 0 PR-D (migration 20261008138003_center_dot0_actions). Chỉ đọc nên gỡ không mất dữ liệu.
-- Gỡ kèm frontend (ActionFolder gọi vcc_my_actions_v1). PR-A/B/C giữ nguyên; gỡ riêng bằng các file center_dot0_*_rollback.sql.
begin;
drop function if exists public.vcc_my_actions_v1(text);
commit;
