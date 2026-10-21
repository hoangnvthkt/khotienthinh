-- Gỡ PR-3 Dòng chảy công việc (migration 20261013180000_center_flow_items_v1.sql). Không đụng vcc_flow_v1, không xóa thông báo đã gửi.
begin;
drop function if exists public.vcc_flow_remind_v1(jsonb, text);
drop function if exists public.vcc_flow_items_v1(jsonb, integer, integer);
drop function if exists app_private.vcc_flow_items_rows_v1(jsonb);
drop function if exists app_private.vcc_flow_waiting_rows_v1(text, uuid[], text[]);
drop type if exists app_private.vcc_flow_row;
drop function if exists app_private.vcc_flow_scope_v1(text, uuid);
drop function if exists app_private.vcc_flow_thresholds_v1();
commit;
