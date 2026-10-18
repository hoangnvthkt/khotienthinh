-- Trợ lý v2 · T2c "đơn mua từ báo giá" (chủ SP duyệt 18/10/2026): Trợ lý tách báo giá (NCC, dòng hàng, đơn giá, VAT, ngày giao) rồi ghi lệnh
-- nháp 'purchase_order'; thẻ là form đơn mua gọn ngay trong chat — người Mua hàng chọn mã, NCC, lý do, người duyệt rồi tự bấm Lưu nháp /
-- Gửi duyệt. Lưu / gửi gọi ĐÚNG lệnh của màn Lập đơn chủ động (save_procurement_proactive_po_v1, transition_procurement_hub_po_v1).
--   * assistant_po_approvers_v1: người duyệt đơn mua để chọn TRƯỚC khi lưu — cùng danh sách get_procurement_order_v1 trả trong đơn
--     (Admin hoặc có quyền system.procurement.manage, đang hoạt động, trừ chính người lập).

alter table public.assistant_commands drop constraint if exists assistant_commands_kind_check;
alter table public.assistant_commands add constraint assistant_commands_kind_check check (kind in ('leave_request', 'material_request', 'purchase_order'));

create or replace function public.assistant_po_approvers_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id();
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
    from public.users u where u.id <> a and u.is_active and u.account_status = 'ACTIVE'
      and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb);
end $$;

revoke all on function public.assistant_po_approvers_v1() from public, anon;
grant execute on function public.assistant_po_approvers_v1() to authenticated;
