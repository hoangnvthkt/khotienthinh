create or replace function app_private.can_act_on_subject_impl(
  p_subject_type text,
  p_subject_id text,
  p_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_log public.daily_logs%rowtype;
  v_owner_id uuid;
  v_required_permission text;
  v_responsibilities text[];
begin
  if v_actor_user_id is null or not app_private.can_view_subject_impl(p_subject_type, p_subject_id) then
    return false;
  end if;

  if p_subject_type <> 'daily_log' then
    return false;
  end if;

  select * into v_log from public.daily_logs where id = p_subject_id;
  if not found then
    return false;
  end if;

  if p_action = 'view' then
    return true;
  end if;

  if p_action = 'submit' then
    select owner_user.id
    into v_owner_id
    from public.users owner_user
    where owner_user.id::text = coalesce(
      nullif(v_log.created_by_id, ''),
      nullif(v_log.submitted_by_id, ''),
      nullif(v_log.submitted_by, ''),
      nullif(v_log.created_by, '')
    )
    limit 1;

    return coalesce(v_log.status, 'draft') in ('draft', 'rejected')
      and (
        (
          v_owner_id = v_actor_user_id
          and app_private.daily_log_has_action(
            v_log.project_id::text,
            v_log.construction_site_id::text,
            'project.daily_log.submit',
            v_actor_user_id
          )
        )
        or (
          v_log.summary_source_type = 'member_contributions'
          and (
            app_private.daily_log_has_action(
              v_log.project_id::text,
              v_log.construction_site_id::text,
              'project.daily_log.summarize',
              v_actor_user_id
            )
            or app_private.daily_log_has_action(
              v_log.project_id::text,
              v_log.construction_site_id::text,
              'project.daily_log.submit',
              v_actor_user_id
            )
          )
        )
      );
  end if;

  if p_action = 'verify' then
    v_required_permission := 'project.daily_log.verify';
    v_responsibilities := array['current_verifier'];
  elsif p_action = 'approve' then
    v_required_permission := 'project.daily_log.approve';
    v_responsibilities := array['current_approver'];
  elsif p_action = 'return' then
    v_required_permission := 'project.daily_log.return';
    v_responsibilities := array['current_verifier', 'current_approver'];
  else
    return false;
  end if;

  return coalesce(v_log.status, 'draft') = 'submitted'
    and app_private.daily_log_has_action(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_required_permission,
      v_actor_user_id
    )
    and app_private.daily_log_assignment_is_active(
      p_subject_id,
      v_actor_user_id,
      v_responsibilities,
      case when p_action = 'return' then null else v_required_permission end
    );
end;
$$;

revoke all on function app_private.can_act_on_subject_impl(text, text, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
