-- Quy trình (WF): chỉ người xử lý bước hiện tại mới duyệt / từ chối / trả lại được (audit mẫu quyền 23/10/2026).
-- Không đổi giao diện: màn /wf chỉ gọi process_workflow_instance_fast (mảng người nhận), bản này đã kiểm người xử lý.
--  1. Thu hồi EXECUTE hai RPC cũ 4 tham số (process_workflow_instance, process_workflow_instance_fast):
--     chỉ kiểm p_user_id = người gọi rồi chuyển bước, ai biết id phiếu RUNNING cũng duyệt được.
--  2. Trigger chặn log (guard_generic_workflow_process_log) kiểm người xử lý thật, đúng luật v_can_act của
--     process_workflow_instance_fast: được giao đích danh / theo vai trò / quản trị mẫu / người tạo sau khi bị trả lại,
--     hoặc quyền workflow.instance.administer. Trước đây chỉ đòi quyền act_assigned (66 người có), và bỏ qua hẳn
--     kiểm tra khi app.workflow_command chưa đặt trên kết nối (NULL <> 'cancel' ra NULL).
--  3. Bucket workflow-attachments: chỉ xem tệp của phiếu mình xem được (tệp gắn trong form_data hoặc
--     step-tasks/<id phiếu>/…) hoặc tệp mình tải lên; tải lên phải đúng đường dẫn và là người làm Quy trình.
--  4. workflow_step_tasks: ai xem phiếu thì xem việc; thêm / sửa / xóa việc chỉ người xử lý bước hoặc quản trị.

-- 1) RPC cũ: giao diện không còn gọi.
revoke execute on function public.process_workflow_instance(uuid, public.workflow_instance_action, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.process_workflow_instance_fast(uuid, public.workflow_instance_action, uuid, text)
  from public, anon, authenticated;

-- 2) Người xử lý bước hiện tại của phiếu RUNNING.
create or replace function app_private.workflow_instance_actor_can_process(p_instance_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and exists (
      select 1
      from public.workflow_instances instance_row
      left join public.workflow_templates template_row on template_row.id = instance_row.template_id
      where instance_row.id = p_instance_id
        and instance_row.status = 'RUNNING'
        and (
          app_private.workflow_has_action(
            'workflow.instance.administer', instance_row.created_by, null, p_actor_id
          )
          or app_private.workflow_instance_actor_is_current_assignee(instance_row.id, p_actor_id)
          or coalesce(template_row.managers, '{}'::text[]) @> array[p_actor_id::text]
        )
    );
$$;

create or replace function app_private.guard_generic_workflow_process_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generic boolean;
begin
  if new.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED') then
    select not exists (
      select 1 from public.request_instances request_row
      where request_row.workflow_instance_id = new.instance_id
    ) and not exists (
      select 1 from public.workflow_subjects subject_row
      where subject_row.workflow_instance_id = new.instance_id
    )
    into v_generic;
    if v_generic
       and coalesce(current_setting('app.workflow_command', true), '') <> 'cancel'
       and not app_private.workflow_instance_actor_can_process(new.instance_id, new.acted_by) then
      raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- 4) Thêm / sửa / xóa việc của bước: xem được phiếu và là người xử lý bước hiện tại, hoặc quản trị phiếu.
create or replace function app_private.workflow_step_task_actor_can_write(p_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.workflow_instance_actor_can_select(p_instance_id)
    and (
      app_private.workflow_instance_actor_can_process(p_instance_id, public.current_app_user_id())
      or exists (
        select 1
        from public.workflow_instances instance_row
        where instance_row.id = p_instance_id
          and app_private.workflow_has_action(
            'workflow.instance.administer', instance_row.created_by, null, public.current_app_user_id()
          )
      )
    );
$$;

-- 3) Tệp đính kèm Quy trình. Đường dẫn: <năm>/<id>-<tên> (trường tệp, tài liệu, tệp bước; gắn vào form_data
-- sau khi tải lên) hoặc step-tasks/<id phiếu>/<id>-<tên> (việc của bước).
create or replace function app_private.workflow_attachment_object_can_select(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) = 'step-tasks' then
      case
        when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then app_private.workflow_instance_actor_can_select(split_part(p_name, '/', 2)::uuid)
        else false
      end
    else exists (
      select 1
      from public.workflow_instances instance_row
      where jsonb_path_exists(
          instance_row.form_data,
          '$.** ? (@.storagePath == $path)',
          jsonb_build_object('path', p_name)
        )
        and app_private.workflow_instance_actor_can_select(instance_row.id)
    )
  end;
$$;

-- Tải lên <năm>/… xảy ra trước khi phiếu có (form tạo phiếu) nên kiểm theo người: có quyền tạo / xử lý /
-- quản trị phiếu, hoặc đang là người xử lý bước của một phiếu RUNNING (được giao đích danh dù chưa có quyền).
create or replace function app_private.workflow_attachment_object_can_insert(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_app_user_id() is not null
    and case
      when split_part(p_name, '/', 1) = 'step-tasks' then
        case
          when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and p_name ~ '^step-tasks/[^/]+/[^/]+$'
          then app_private.workflow_step_task_actor_can_write(split_part(p_name, '/', 2)::uuid)
          else false
        end
      when p_name ~ '^[0-9]{4}/[^/]+$' then
        app_private.workflow_has_action(
          'workflow.instance.create', public.current_app_user_id(), null, public.current_app_user_id()
        )
        or app_private.workflow_has_action(
          'workflow.instance.act_assigned', null, public.current_app_user_id(), public.current_app_user_id()
        )
        or app_private.workflow_has_action(
          'workflow.instance.administer', null, null, public.current_app_user_id()
        )
        or exists (
          select 1
          from public.workflow_instances instance_row
          where instance_row.status = 'RUNNING'
            and app_private.workflow_instance_actor_can_process(instance_row.id, public.current_app_user_id())
        )
      else false
    end;
$$;

revoke all on function app_private.workflow_step_task_actor_can_write(uuid) from public, anon;
revoke all on function app_private.workflow_attachment_object_can_select(text) from public, anon;
revoke all on function app_private.workflow_attachment_object_can_insert(text) from public, anon;
grant execute on function app_private.workflow_step_task_actor_can_write(uuid) to authenticated;
grant execute on function app_private.workflow_attachment_object_can_select(text) to authenticated;
grant execute on function app_private.workflow_attachment_object_can_insert(text) to authenticated;

-- Người tải lên luôn xem được tệp của mình (ngay sau khi tải, trước khi phiếu lưu đường dẫn).
drop policy if exists workflow_attachments_select on storage.objects;
create policy workflow_attachments_select on storage.objects
for select to authenticated
using (
  bucket_id = 'workflow-attachments'
  and (
    owner_id = (select auth.uid())::text
    or app_private.workflow_attachment_object_can_select(name)
  )
);

drop policy if exists workflow_attachments_insert on storage.objects;
create policy workflow_attachments_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'workflow-attachments'
  and app_private.workflow_attachment_object_can_insert(name)
);

-- 4) Việc của bước.
drop policy if exists workflow_step_tasks_instance_access on public.workflow_step_tasks;

create policy workflow_step_tasks_select on public.workflow_step_tasks
for select to authenticated
using (instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[]));

create policy workflow_step_tasks_insert on public.workflow_step_tasks
for insert to authenticated
with check (
  instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[])
  and created_by = (select public.current_app_user_id())
  and app_private.workflow_step_task_actor_can_write(instance_id)
);

create policy workflow_step_tasks_update on public.workflow_step_tasks
for update to authenticated
using (
  instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[])
  and app_private.workflow_step_task_actor_can_write(instance_id)
)
with check (
  instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[])
  and app_private.workflow_step_task_actor_can_write(instance_id)
);

create policy workflow_step_tasks_delete on public.workflow_step_tasks
for delete to authenticated
using (
  instance_id = any ((select app_private.workflow_visible_instance_ids())::uuid[])
  and app_private.workflow_step_task_actor_can_write(instance_id)
);

notify pgrst, 'reload schema';
