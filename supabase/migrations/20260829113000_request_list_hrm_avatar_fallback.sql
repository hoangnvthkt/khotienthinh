-- Prefer the maintained HRM profile photo for request participants while
-- preserving the existing application-user avatar as a fallback.
create or replace function app_private.request_user_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when app_user.id is null then null else jsonb_build_object(
    'id', app_user.id,
    'name', coalesce(nullif(app_user.name, ''), app_user.username, app_user.email, app_user.id::text),
    'avatarUrl', coalesce(
      nullif(trim(employee.avatar_url), ''),
      nullif(trim(app_user.avatar), '')
    ),
    'position', null
  ) end
  from public.users app_user
  left join lateral (
    select profile.avatar_url
    from public.employees profile
    where profile.user_id = app_user.id
      and nullif(trim(profile.avatar_url), '') is not null
    order by profile.updated_at desc nulls last, profile.id
    limit 1
  ) employee on true
  where app_user.id = p_user_id;
$$;

create or replace function app_private.request_list_item(
  p_request_id uuid,
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
            'avatarUrl', coalesce(
              nullif(trim(employee.avatar_url), ''),
              nullif(trim(app_user.avatar), '')
            ),
            'position', null,
            'assignmentStatus', assignment.status
          ) order by assignment.assigned_at, assignment.id
        )
        from public.workflow_step_assignments assignment
        join public.users app_user on app_user.id = assignment.assignee_user_id
        left join lateral (
          select profile.avatar_url
          from public.employees profile
          where profile.user_id = app_user.id
            and nullif(trim(profile.avatar_url), '') is not null
          order by profile.updated_at desc nulls last, profile.id
          limit 1
        ) employee on true
        where assignment.workflow_subject_id = r.workflow_subject_id
          and assignment.status = 'PENDING'
      ), '[]'::jsonb),
      'dueAt', r.due_at,
      'createdAt', r.created_at,
      'updatedAt', r.updated_at
    )
  end
  from public.request_instances r
  left join public.request_templates template on template.id = r.request_template_id
  where r.id = p_request_id;
$$;
