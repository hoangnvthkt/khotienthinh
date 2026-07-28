-- Secure read APIs for the Request workspace.  The public functions are
-- invoker-only boundaries; all joins run in app_private after checking the
-- caller's request visibility.

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
    'avatarUrl', app_user.avatar,
    'position', null
  ) end
  from public.users app_user
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
      'dueAt', r.due_at,
      'createdAt', r.created_at,
      'updatedAt', r.updated_at
    )
  end
  from public.request_instances r
  left join public.request_templates template on template.id = r.request_template_id
  where r.id = p_request_id;
$$;

create or replace function app_private.request_list_payload(
  p_filters jsonb,
  p_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_view text := upper(coalesce(nullif(trim(p_filters ->> 'view'), ''), 'ALL'));
  v_status text := upper(nullif(trim(p_filters ->> 'status'), ''));
  v_search text := nullif(trim(p_filters ->> 'search'), '');
  v_template_id text := nullif(trim(p_filters ->> 'templateId'), '');
  v_overdue boolean;
  v_cursor_created_at timestamptz;
  v_cursor_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb := '[]'::jsonb;
  v_next_cursor jsonb := null;
begin
  if v_actor is null then
    return jsonb_build_object('items', '[]'::jsonb);
  end if;
  if v_view not in ('ALL', 'ASSIGNED_TO_ME', 'CREATED_BY_ME', 'WATCHING') then
    raise exception using errcode = '22023', message = 'REQUEST_QUERY_FILTER_INVALID';
  end if;
  if v_status is not null and v_status not in ('PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED') then
    raise exception using errcode = '22023', message = 'REQUEST_QUERY_FILTER_INVALID';
  end if;
  if nullif(trim(p_filters ->> 'cursorCreatedAt'), '') is not null then
    v_cursor_created_at := (p_filters ->> 'cursorCreatedAt')::timestamptz;
    v_cursor_id := nullif(trim(p_filters ->> 'cursorId'), '')::uuid;
  end if;
  if p_filters ? 'overdue' then
    v_overdue := (p_filters ->> 'overdue')::boolean;
  end if;

  with candidates as (
    select r.id, r.created_at
    from public.request_instances r
    where app_private.request_instance_can_select(r.id, v_actor)
      and (
        v_view = 'ALL'
        or (v_view = 'CREATED_BY_ME' and r.created_by = v_actor)
        or (v_view = 'ASSIGNED_TO_ME' and exists (
          select 1 from public.workflow_step_assignments assignment
          where assignment.workflow_subject_id = r.workflow_subject_id
            and assignment.assignee_user_id = v_actor
            and assignment.status = 'PENDING'
        ))
        or (v_view = 'WATCHING' and (
          exists (
            select 1 from public.workflow_participants participant
            where participant.workflow_subject_id = r.workflow_subject_id
              and participant.user_id = v_actor
              and participant.role = 'WATCHER'
              and coalesce(participant.is_active, true)
          )
          or exists (
            select 1 from public.request_template_watchers watcher
            where watcher.request_template_version_id = r.request_template_version_id
              and watcher.user_id = v_actor
          )
        ))
      )
      and (v_status is null or r.status = v_status)
      and (v_template_id is null or r.request_template_id::text = v_template_id)
      and (v_search is null or r.code ilike '%' || v_search || '%' or r.title ilike '%' || v_search || '%')
      and (
        v_overdue is not true
        or r.due_at < now()
        or exists (
          select 1 from public.workflow_step_assignments assignment
          where assignment.workflow_subject_id = r.workflow_subject_id
            and assignment.status = 'PENDING'
            and assignment.due_at < now()
        )
      )
      and (
        v_cursor_created_at is null
        or (r.created_at, r.id) < (v_cursor_created_at, v_cursor_id)
      )
    order by r.created_at desc, r.id desc
    limit v_limit + 1
  ), numbered as (
    select candidate.id, candidate.created_at,
           row_number() over (order by candidate.created_at desc, candidate.id desc) as row_number
    from candidates candidate
  ), page as (
    select numbered.id, numbered.created_at, numbered.row_number
    from numbered
    where numbered.row_number <= v_limit
  )
  select coalesce(jsonb_agg(app_private.request_list_item(page.id, v_actor)
                            order by page.created_at desc, page.id desc), '[]'::jsonb)
    into v_items
  from page;

  select jsonb_build_object('createdAt', numbered.created_at, 'id', numbered.id)
    into v_next_cursor
  from numbered
  where numbered.row_number = v_limit + 1;

  return case
    when v_next_cursor is null then jsonb_build_object('items', v_items)
    else jsonb_build_object('items', v_items, 'nextCursor', v_next_cursor)
  end;
end;
$$;

create or replace function app_private.request_detail_payload(
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
    when not app_private.request_instance_can_select(r.id, p_user_id) then null
    else app_private.request_list_item(r.id, p_user_id)
      || jsonb_build_object(
        'description', coalesce(r.description, ''),
        'templateVersionId', r.request_template_version_id,
        'templateVersionNumber', coalesce(version.version_number, 0),
        'flowMode', coalesce(r.approval_config_snapshot ->> 'flowMode', version.flow_mode),
        'completionPolicy', coalesce(r.approval_config_snapshot ->> 'completionPolicy', version.completion_policy),
        'formSchema', case when jsonb_typeof(r.form_schema_snapshot) = 'array'
          then r.form_schema_snapshot else '[]'::jsonb end,
        'formData', case when jsonb_typeof(r.form_data) = 'object'
          then r.form_data else '{}'::jsonb end,
        'approvalBlocks', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'key', block.block_key,
              'name', block.name,
              'sortOrder', block.sort_order,
              'status', case
                when exists (
                  select 1 from public.workflow_step_assignments returned_assignment
                  where returned_assignment.workflow_subject_id = r.workflow_subject_id
                    and returned_assignment.metadata ->> 'requestBlockKey' = block.block_key
                    and returned_assignment.status = 'RETURNED'
                ) then 'RETURNED'
                when exists (
                  select 1 from public.workflow_step_assignments pending_assignment
                  where pending_assignment.workflow_subject_id = r.workflow_subject_id
                    and pending_assignment.metadata ->> 'requestBlockKey' = block.block_key
                    and pending_assignment.status = 'PENDING'
                ) then 'ACTIVE'
                when exists (
                  select 1 from public.workflow_step_assignments completed_assignment
                  where completed_assignment.workflow_subject_id = r.workflow_subject_id
                    and completed_assignment.metadata ->> 'requestBlockKey' = block.block_key
                ) and not exists (
                  select 1 from public.workflow_step_assignments cancelled_assignment
                  where cancelled_assignment.workflow_subject_id = r.workflow_subject_id
                    and cancelled_assignment.metadata ->> 'requestBlockKey' = block.block_key
                    and cancelled_assignment.status = 'CANCELLED'
                ) then 'COMPLETED'
                when exists (
                  select 1 from public.workflow_step_assignments cancelled_assignment
                  where cancelled_assignment.workflow_subject_id = r.workflow_subject_id
                    and cancelled_assignment.metadata ->> 'requestBlockKey' = block.block_key
                    and cancelled_assignment.status = 'CANCELLED'
                ) then 'CANCELLED'
                else 'NOT_ACTIVE'
              end,
              'slaHours', block.sla_hours,
              'assignments', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', assignment.id,
                    'roundId', assignment.assignment_round_id,
                    'approver', app_private.request_user_snapshot(assignment.assignee_user_id),
                    'status', assignment.status,
                    'actedAt', assignment.acted_at,
                    'comment', assignment.action_comment
                  ) order by assignment.assigned_at, assignment.id
                )
                from public.workflow_step_assignments assignment
                where assignment.workflow_subject_id = r.workflow_subject_id
                  and assignment.metadata ->> 'requestBlockKey' = block.block_key
              ), '[]'::jsonb)
            ) order by block.sort_order, block.block_key
          )
          from public.request_approval_blocks block
          where block.request_template_version_id = r.request_template_version_id
        ), '[]'::jsonb),
        'watcherIds', coalesce((
          select jsonb_agg(participant.user_id order by participant.user_id)
          from public.workflow_participants participant
          where participant.workflow_subject_id = r.workflow_subject_id
            and participant.role = 'WATCHER'
            and coalesce(participant.is_active, true)
        ), '[]'::jsonb),
        'timeline', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', log.id,
              'eventType', log.action::text,
              'actor', app_private.request_user_snapshot(log.acted_by),
              'comment', log.comment,
              'createdAt', log.created_at
            ) order by log.created_at, log.id
          )
          from public.workflow_instance_logs log
          where log.instance_id = r.workflow_instance_id
        ), '[]'::jsonb),
        'printConfig', jsonb_build_object(
          'browserPrintEnabled', coalesce((r.print_config_snapshot ->> 'browserPrintEnabled')::boolean, true),
          'docxStoragePath', (
            select print_template.storage_path
            from public.request_print_templates print_template
            where print_template.request_template_version_id = r.request_template_version_id
              and print_template.validation_status = 'VALID'
            order by print_template.updated_at desc, print_template.id desc
            limit 1
          )
        ),
        'capabilities', jsonb_build_object(
          'canApprove', r.status = 'PENDING' and exists (
            select 1 from public.workflow_step_assignments assignment
            where assignment.workflow_subject_id = r.workflow_subject_id
              and assignment.assignee_user_id = p_user_id
              and assignment.status = 'PENDING'
          ),
          'canReject', r.status = 'PENDING' and exists (
            select 1 from public.workflow_step_assignments assignment
            where assignment.workflow_subject_id = r.workflow_subject_id
              and assignment.assignee_user_id = p_user_id
              and assignment.status = 'PENDING'
          ),
          'canReturn', r.status = 'PENDING' and exists (
            select 1 from public.workflow_step_assignments assignment
            where assignment.workflow_subject_id = r.workflow_subject_id
              and assignment.assignee_user_id = p_user_id
              and assignment.status = 'PENDING'
          ),
          'canResubmit', r.created_by = p_user_id and r.status = 'RETURNED',
          'canCancel', (r.created_by = p_user_id or app_private.request_action_is_admin(p_user_id))
            and r.status in ('PENDING', 'RETURNED'),
          'canReassign', app_private.request_user_can_manage(p_user_id)
            and r.status = 'PENDING'
            and exists (
              select 1 from public.workflow_step_assignments assignment
              where assignment.workflow_subject_id = r.workflow_subject_id
                and assignment.status = 'PENDING'
            ),
          'canPrint', coalesce((r.print_config_snapshot ->> 'browserPrintEnabled')::boolean, true)
            or exists (
              select 1
              from public.request_print_templates print_template
              where print_template.request_template_version_id = r.request_template_version_id
                and print_template.validation_status = 'VALID'
            )
        )
      )
  end
  from public.request_instances r
  left join public.request_template_versions version
    on version.id = r.request_template_version_id
  where r.id = p_request_id;
$$;

create or replace function app_private.request_summary_payload(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select r.*
    from public.request_instances r
    where app_private.request_instance_can_select(r.id, p_user_id)
  ), counts as (
    select
      count(*)::integer as all_count,
      count(*) filter (where exists (
        select 1 from public.workflow_step_assignments assignment
        where assignment.workflow_subject_id = visible.workflow_subject_id
          and assignment.assignee_user_id = p_user_id
          and assignment.status = 'PENDING'
      ))::integer as assigned_count,
      count(*) filter (where visible.created_by = p_user_id)::integer as created_count,
      count(*) filter (where exists (
        select 1 from public.workflow_participants participant
        where participant.workflow_subject_id = visible.workflow_subject_id
          and participant.user_id = p_user_id
          and participant.role = 'WATCHER'
          and coalesce(participant.is_active, true)
      ) or exists (
        select 1 from public.request_template_watchers watcher
        where watcher.request_template_version_id = visible.request_template_version_id
          and watcher.user_id = p_user_id
      ))::integer as watching_count,
      count(*) filter (where visible.status = 'PENDING')::integer as pending_count,
      count(*) filter (where visible.status = 'RETURNED')::integer as returned_count,
      count(*) filter (where visible.status = 'APPROVED')::integer as approved_count,
      count(*) filter (where visible.status = 'REJECTED')::integer as rejected_count,
      count(*) filter (where visible.due_at < now()
        or exists (
          select 1 from public.workflow_step_assignments assignment
          where assignment.workflow_subject_id = visible.workflow_subject_id
            and assignment.status = 'PENDING'
            and assignment.due_at < now()
        ))::integer as overdue_count
    from visible
  )
  select jsonb_build_object(
    'all', all_count,
    'assignedToMe', assigned_count,
    'createdByMe', created_count,
    'watching', watching_count,
    'pending', pending_count,
    'returned', returned_count,
    'overdue', overdue_count,
    'approved', approved_count,
    'rejected', rejected_count
  )
  from counts
  where p_user_id is not distinct from public.current_app_user_id();
$$;

create or replace function public.list_request_instances(
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.request_list_payload(coalesce(p_filters, '{}'::jsonb), p_limit);
$$;

create or replace function public.get_request_detail(p_request_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.request_detail_payload(p_request_id, public.current_app_user_id());
$$;

create or replace function public.get_request_summary()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.request_summary_payload(public.current_app_user_id());
$$;

revoke all on function app_private.request_user_snapshot(uuid) from public, anon, authenticated;
revoke all on function app_private.request_list_item(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.request_list_payload(jsonb, integer) from public, anon, authenticated;
revoke all on function app_private.request_detail_payload(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.request_summary_payload(uuid) from public, anon, authenticated;
grant execute on function app_private.request_list_payload(jsonb, integer) to authenticated;
grant execute on function app_private.request_detail_payload(uuid, uuid) to authenticated;
grant execute on function app_private.request_summary_payload(uuid) to authenticated;

revoke all on function public.list_request_instances(jsonb, integer) from public, anon;
revoke all on function public.get_request_detail(uuid) from public, anon;
revoke all on function public.get_request_summary() from public, anon;
grant execute on function public.list_request_instances(jsonb, integer) to authenticated;
grant execute on function public.get_request_detail(uuid) to authenticated;
grant execute on function public.get_request_summary() to authenticated;
