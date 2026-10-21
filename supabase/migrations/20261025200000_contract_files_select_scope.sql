-- Storage hợp đồng (audit 20/10/2026, follow-up S1/S3): đọc tệp hợp đồng theo đúng quyền xem hợp đồng.
--
-- Trước: policy contract_files_select chỉ kiểm bucket_id → mọi nhân viên đăng nhập tạo được signed URL cho mọi tệp trong
-- contract-files (HĐ khách hàng, NCC, thầu phụ) dù bảng hợp đồng đã thu hẹp ở #266.
-- Sau: đọc được tệp khi (1) chính mình tải lên, (2) Admin, hoặc (3) nhìn thấy dòng hợp đồng chủ của tệp theo RLS của bảng:
--   customer/<contract_id>/…        → public.customer_contracts
--   supplier/<contract_id>/…        → public.supplier_contracts
--   subcontractor/<contract_id>/…   → public.subcontractor_contracts
--   appendices/<contract_id>/<appendix_id>/… → public.contract_appendices (ContractAppendixPanel)
-- Hàm SECURITY INVOKER: chạy bằng quyền người gọi nên RLS của bảng hợp đồng quyết định, không chép lại luật quyền.
-- INSERT/UPDATE/DELETE giữ nguyên (is_module_admin('HD')).

create or replace function app_private.contract_file_object_can_read(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case split_part(p_name, '/', 1)
    when 'customer' then exists (
      select 1 from public.customer_contracts c where c.id = split_part(p_name, '/', 2)
    )
    when 'supplier' then exists (
      select 1 from public.supplier_contracts c where c.id = split_part(p_name, '/', 2)
    )
    when 'subcontractor' then exists (
      select 1 from public.subcontractor_contracts c where c.id = split_part(p_name, '/', 2)
    )
    when 'appendices' then exists (
      select 1 from public.contract_appendices a where a.id::text = split_part(p_name, '/', 3)
    )
    else false
  end;
$$;

revoke all on function app_private.contract_file_object_can_read(text) from public, anon;
grant execute on function app_private.contract_file_object_can_read(text) to authenticated;

alter policy contract_files_select on storage.objects
using (
  bucket_id = 'contract-files'
  and (
    owner_id = (select auth.uid())::text
    or (select public.is_admin())
    or app_private.contract_file_object_can_read(name)
  )
);
