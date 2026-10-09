-- Gỡ Tìm kiếm toàn hệ thống v1 (migration 20261010110000_global_search_v1). Chỉ đọc nên gỡ không mất dữ liệu.
-- Gỡ kèm frontend (components/search/GlobalSearchDialog.tsx gọi search_global_v1) — nếu chỉ gỡ máy chủ, ô tìm vẫn chạy
-- phần chức năng / thao tác và báo "chưa tìm được hồ sơ".
begin;
drop function if exists public.search_global_v1(jsonb, text[], integer);
drop function if exists app_private.gs_candidates_v1(text, text[], text, text, integer);
drop function if exists app_private.gs_row(text, text, text, text, text, text, text, text, text, jsonb, integer);
drop function if exists app_private.gs_line_text(jsonb);
drop function if exists app_private.gs_rank(text, text, text, text);
drop function if exists app_private.gs_initials(text);
drop function if exists app_private.gs_fold(text);
commit;
