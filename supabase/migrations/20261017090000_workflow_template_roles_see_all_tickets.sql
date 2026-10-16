-- Quy trình: Người quản trị quy trình (managers) và Người giám sát workflow (default_watchers)
-- luôn thấy mọi phiếu của quy trình, theo danh sách HIỆN TẠI trên mẫu.
-- Trước đây quyền xem chỉ dựa vào workflow_instance_participants: người giám sát chỉ được ghi vào
-- lúc tạo phiếu, người quản trị không bao giờ được ghi → người được thêm sau không thấy phiếu cũ.
-- Bình luận, nhật ký phiếu đi theo workflow_instance_actor_can_select nên cũng mở theo.
-- Thông báo không đổi: vẫn chỉ gửi người đang theo dõi phiếu.

CREATE OR REPLACE FUNCTION app_private.workflow_instance_user_can_select(p_instance_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workflow_instances instance_row
    join public.users user_row on user_row.id = p_user_id
      and user_row.is_active
      and user_row.account_status = 'ACTIVE'
    left join public.workflow_templates template_row on template_row.id = instance_row.template_id
    where instance_row.id = p_instance_id
      and not exists (
        select 1 from public.workflow_subjects subject_row
        where subject_row.workflow_instance_id = instance_row.id
      )
      and (
        app_private.has_permission(p_user_id, 'workflow.instance.view', 'global', '*')
        or app_private.has_permission(p_user_id, 'workflow.instance.administer', 'global', '*')
        -- Người quản trị quy trình và người giám sát workflow: mọi phiếu của quy trình.
        or coalesce(template_row.managers, '{}'::text[]) @> array[p_user_id::text]
        or coalesce(template_row.default_watchers, '{}'::text[]) @> array[p_user_id::text]
        -- Người tạo, người theo dõi, người được @nhắc; người xử lý theo cài đặt của mẫu.
        or app_private.workflow_instance_user_follows(instance_row.id, p_user_id)
      )
  );
$function$;
