-- Quy trình: người đã xử lý xong bước của mình có tiếp tục theo dõi phiếu tới khi hoàn thành không.
-- Cài theo từng mẫu, mặc định BẬT (giữ hành vi cũ). TẮT: qua bước là không thấy phiếu và không nhận
-- thông báo các bước sau, trừ khi là người tạo, được gắn theo dõi hoặc được @nhắc trong bình luận.

alter table public.workflow_templates
  add column if not exists handlers_follow_after_step boolean not null default true;
comment on column public.workflow_templates.handlers_follow_after_step is
  'true: người xử lý tiếp tục theo dõi phiếu sau khi qua bước; false: chỉ thấy khi đang tới lượt, trừ người tạo/theo dõi/@nhắc.';

-- 1. Ai đang "theo dõi" một phiếu -------------------------------------------
create or replace function app_private.workflow_instance_user_follows(p_instance_id uuid, p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.workflow_instances instance_row
    join public.workflow_instance_participants participant_row
      on participant_row.instance_id = instance_row.id
     and participant_row.user_id = p_user_id
     and participant_row.ended_at is null
    left join public.workflow_templates template_row on template_row.id = instance_row.template_id
    left join public.workflow_nodes node_row on node_row.id = instance_row.current_node_id
    where instance_row.id = p_instance_id
      and (
        participant_row.participant_role <> 'ASSIGNEE'
        or coalesce(template_row.handlers_follow_after_step, true)
        -- Đang tới lượt mình ở bước hiện tại.
        or (
          instance_row.status = 'RUNNING'
          and (
            instance_row.step_assignees ->> instance_row.current_node_id::text = p_user_id::text
            or coalesce(instance_row.step_assignees -> instance_row.current_node_id::text, '[]'::jsonb) ? p_user_id::text
            or node_row.config ->> 'assigneeUserId' = p_user_id::text
          )
        )
        -- Được giao nhưng chưa xử lý bước nào.
        or not exists (
          select 1 from public.workflow_instance_logs log_row
          where log_row.instance_id = instance_row.id
            and log_row.acted_by = p_user_id
            and log_row.action in ('APPROVED', 'REJECTED', 'REVISION_REQUESTED')
        )
      )
  );
$function$;

revoke all on function app_private.workflow_instance_user_follows(uuid, uuid)
  from public, anon, authenticated, service_role;

-- 2. Quyền xem phiếu dùng cùng quy tắc -----------------------------------
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
    where instance_row.id = p_instance_id
      and not exists (
        select 1 from public.workflow_subjects subject_row
        where subject_row.workflow_instance_id = instance_row.id
      )
      and (
        app_private.has_permission(p_user_id, 'workflow.instance.view', 'global', '*')
        or app_private.has_permission(p_user_id, 'workflow.instance.administer', 'global', '*')
        -- Người tạo, người theo dõi, người được @nhắc; người xử lý theo cài đặt của mẫu.
        or app_private.workflow_instance_user_follows(instance_row.id, p_user_id)
      )
  );
$function$;

-- 3. Thông báo diễn biến phiếu chỉ gửi người đang theo dõi -------------------
CREATE OR REPLACE FUNCTION app_private.enqueue_workflow_notification_event(p_instance_id uuid, p_event_type text, p_actor_id uuid, p_event_key text, p_payload jsonb DEFAULT '{}'::jsonb, p_recipient_user_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  i public.workflow_instances%rowtype;
  v_recipients uuid[] := '{}';
  v_current_assignees uuid[] := '{}';
  v_held boolean := coalesce((p_payload ->> 'held')::boolean, false);
begin
  if exists (select 1 from public.request_instances r where r.workflow_instance_id = p_instance_id)
    or exists (
      select 1 from public.workflow_subjects s
      where s.workflow_instance_id = p_instance_id
        and s.subject_type in ('request', 'project')
    ) then
    return 0;
  end if;

  select * into strict i from public.workflow_instances where id = p_instance_id;

  select coalesce(array_agg(distinct x.value::uuid), '{}') into v_current_assignees
  from (
    select case when jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'string'
      then i.step_assignees -> i.current_node_id::text #>> '{}' end as value
    union all
    select value
    from jsonb_array_elements_text(
      case when jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'array'
        then i.step_assignees -> i.current_node_id::text else '[]'::jsonb end
    )
  ) x
  where x.value ~* '^[0-9a-f-]{36}$';

  if p_event_type = 'workflow.mentioned' then
    v_recipients := coalesce(p_recipient_user_ids, '{}');
  elsif p_event_type in ('workflow.step_assigned', 'workflow.step_due_soon', 'workflow.step_overdue') then
    v_recipients := coalesce(p_recipient_user_ids, v_current_assignees);
  else
    select coalesce(array_agg(distinct participant_row.user_id), '{}') into v_recipients
    from public.workflow_instance_participants participant_row
    where participant_row.instance_id = i.id
      and participant_row.ended_at is null
      and app_private.workflow_instance_user_follows(i.id, participant_row.user_id)
      and (
        v_held
        or p_event_type not in (
          'workflow.submitted', 'workflow.step_approved',
          'workflow.revision_requested', 'workflow.reopened'
        )
        or not (participant_row.user_id = any(v_current_assignees))
      );

    if p_event_type in ('workflow.watchers_added', 'workflow.watchers_removed')
      and cardinality(coalesce(p_recipient_user_ids, '{}')) > 0 then
      select coalesce(array_agg(distinct recipient.user_id), '{}') into v_recipients
      from (
        select unnest(coalesce(v_recipients, '{}')) as user_id
        union all
        select unnest(coalesce(p_recipient_user_ids, '{}')) as user_id
      ) recipient;
    end if;
  end if;

  insert into app_private.workflow_notification_outbox(
    event_key, instance_id, event_type, actor_user_id, recipient_user_ids, payload
  ) values (
    p_event_key, p_instance_id, p_event_type, p_actor_id,
    coalesce(v_recipients, '{}'), coalesce(p_payload, '{}') || jsonb_build_object('eventKey', p_event_key)
  ) on conflict(event_key) do nothing;
  return case when found then 1 else 0 end;
end;
$function$;

-- 4. Đổi công tắc trên mẫu (cùng quyền với sửa mẫu) --------------------------
create or replace function public.set_workflow_template_handlers_follow(p_template_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := app_private.workflow_notification_actor();
begin
  if p_enabled is null then
    raise exception 'WORKFLOW_SETTING_REQUIRED' using errcode = '22023';
  end if;
  if not app_private.workflow_template_actor_can_edit(p_template_id, v_actor) then
    raise exception 'WORKFLOW_COMMAND_FORBIDDEN' using errcode = '42501';
  end if;
  update public.workflow_templates
  set handlers_follow_after_step = p_enabled, updated_at = now()
  where id = p_template_id;
  if not found then
    raise exception 'WORKFLOW_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return p_enabled;
end;
$function$;

revoke all on function public.set_workflow_template_handlers_follow(uuid, boolean) from public, anon;
grant execute on function public.set_workflow_template_handlers_follow(uuid, boolean) to authenticated;

-- 5. Nhân bản mẫu giữ nguyên cài đặt ----------------------------------------
do $migration$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.clone_workflow_template(uuid,text,uuid,uuid)'::regprocedure);
  if strpos(v_def, 'handlers_follow_after_step') > 0 then
    raise notice 'clone_workflow_template already copies handlers_follow_after_step';
  elsif strpos(v_def, E'    category_id, cloned_from_template_id\n  )') = 0
     or strpos(v_def, E'    p_category_id,\n    v_source.id\n  )') = 0 then
    raise exception 'clone_workflow_template anchor not found';
  else
    v_def := replace(v_def, E'    category_id, cloned_from_template_id\n  )',
      E'    category_id, cloned_from_template_id, handlers_follow_after_step\n  )');
    v_def := replace(v_def, E'    p_category_id,\n    v_source.id\n  )',
      E'    p_category_id,\n    v_source.id,\n    v_source.handlers_follow_after_step\n  )');
    execute v_def;
  end if;
end
$migration$;

-- 6. Sửa mẫu có hai trường trùng mã: bảng "Thông tin chi tiết" và tệp "Tệp đính kèm" cùng
--    "thông_tin_chi_tiết" nên ghi đè dữ liệu của nhau. Phiếu cũ lưu bảng dưới mã này → giữ cho bảng.
update public.workflow_templates template_row
set custom_fields = (
  select jsonb_agg(
    case when field ->> 'id' = '1d8ed94f-62df-406f-ac86-a33036e9c4e2'
      then jsonb_set(field, '{name}', to_jsonb('tệp_đính_kèm'::text)) else field end
    order by ordinality)
  from jsonb_array_elements(template_row.custom_fields) with ordinality as entry(field, ordinality)
)
where template_row.id = '4f47fc16-bba8-448f-803b-19d5c042b98d'
  and exists (
    select 1 from jsonb_array_elements(template_row.custom_fields) field
    where field ->> 'id' = '1d8ed94f-62df-406f-ac86-a33036e9c4e2' and field ->> 'name' = 'thông_tin_chi_tiết'
  );
