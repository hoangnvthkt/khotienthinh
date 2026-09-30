-- Request list: return every approver of the current approval round with
-- their status, so the list can show approved / rejected / returned /
-- waiting badges on the approver avatars. `activeApprovers` (pending only)
-- is kept for existing consumers.

create or replace function app_private.request_list_item(p_request_id uuid, p_user_id uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select case
    when p_user_id is distinct from public.current_app_user_id()
      or not app_private.request_instance_can_select(r.id, p_user_id) then null
    else jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'title', r.title,
      'status', r.status,
      'templateId', r.request_template_id,
      'templateName', coalesce(template.name, ''),
      'creator', app_private.request_user_snapshot(r.created_by),
      'activeApprovers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', app_user.id,
            'name', coalesce(nullif(app_user.name, ''), app_user.username, app_user.email, app_user.id::text),
            'avatarUrl', app_user.avatar,
            'position', null,
            'assignmentStatus', assignment.status
          ) order by assignment.assigned_at, assignment.id
        )
        from public.workflow_step_assignments assignment
        join public.users app_user on app_user.id = assignment.assignee_user_id
        where assignment.workflow_subject_id = r.workflow_subject_id
          and assignment.status = 'PENDING'
      ), '[]'::jsonb),
      -- Current round only; handed-over (CANCELLED) assignments are hidden.
      'approvers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', app_user.id,
            'name', coalesce(nullif(app_user.name, ''), app_user.username, app_user.email, app_user.id::text),
            'avatarUrl', app_user.avatar,
            'position', null,
            'assignmentStatus', assignment.status
          ) order by coalesce(block.sort_order, -1), assignment.assigned_at, assignment.id
        )
        from public.workflow_step_assignments assignment
        join public.users app_user on app_user.id = assignment.assignee_user_id
        left join public.request_approval_blocks block
          on block.request_template_version_id = r.request_template_version_id
         and block.block_key = assignment.metadata ->> 'requestBlockKey'
        where assignment.workflow_subject_id = r.workflow_subject_id
          and assignment.assignment_round_id::text = r.approval_config_snapshot ->> 'assignmentRoundId'
          and assignment.status <> 'CANCELLED'
      ), '[]'::jsonb),
      'dueAt', r.due_at,
      'createdAt', r.created_at,
      'updatedAt', r.updated_at
    )
  end
  from public.request_instances r
  left join public.request_templates template on template.id = r.request_template_id
  where r.id = p_request_id;
$function$;
