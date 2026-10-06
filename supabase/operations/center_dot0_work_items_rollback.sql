-- Gỡ "Việc của tôi" đợt 0 PR-B (migration 20261008138001_center_dot0_work_items). Chỉ đọc nên gỡ không mất dữ liệu.
-- Gỡ kèm frontend (InboxPanel gọi vcc_my_work_items_v1). Khung PR-A (20261008138000) giữ nguyên; gỡ riêng bằng center_dot0_rollback.sql.
begin;
drop function if exists public.vcc_my_work_items_v1(text);
drop function if exists app_private.vcc_item(text,text,text,text,text,text,text,text,text,timestamptz,text,jsonb);
drop function if exists app_private.vcc_money(numeric);
drop function if exists app_private.vcc_employee_name(text);
drop function if exists app_private.vcc_user_name(text);
drop function if exists app_private.vcc_date(text);
commit;
