-- Route only post-cutover WBS source creation through the Daily Log Room.
-- The legacy permission adapter and every other module remain unchanged.
create or replace function app_private.daily_log_contribution_insert_allowed_v1(
  p_project_id text, p_construction_site_id text, p_log_date date, p_author_user_id text
) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  select * into v_rollout from app_private.daily_log_wbs_rollout_scopes r
  where (r.project_id is null or r.project_id = p_project_id)
    and (r.construction_site_id is null or r.construction_site_id = p_construction_site_id)
  order by (r.project_id is not null) desc, (r.construction_site_id is not null) desc, r.updated_at desc
  limit 1;
  if found and v_rollout.mode in ('pilot', 'enforced') and p_log_date::date >= v_rollout.cutover_date then
    return p_author_user_id = public.current_app_user_id()::text
      and app_private.daily_log_has_action(p_project_id, p_construction_site_id, 'project.daily_log.create');
  end if;
  return app_private.daily_log_contribution_can_submit(p_project_id, p_construction_site_id, p_author_user_id);
end;
$$;
revoke all on function app_private.daily_log_contribution_insert_allowed_v1(text,text,date,text) from public, anon;
grant execute on function app_private.daily_log_contribution_insert_allowed_v1(text,text,date,text) to authenticated;
alter policy daily_log_contributions_insert on public.daily_log_contributions
with check (app_private.daily_log_contribution_insert_allowed_v1(project_id,construction_site_id,date,author_user_id));

create or replace function app_private.daily_log_contribution_transition_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id text := public.current_app_user_id()::text;
  v_can_review boolean;
  v_workflow_fields text[] := array['status','daily_log_id','included_in_daily_log_id','included_by',
    'included_at','last_action_by','last_action_at','updated_at'];
begin
  if public.is_admin() then return new; end if;
  -- A WBS publisher may only mark the unchanged source included in the already
  -- verified summary that owns its source card. This is not generic edit access.
  if old.status in ('submitted','included') and new.status='included'
    and (to_jsonb(new) - v_workflow_fields) = (to_jsonb(old) - v_workflow_fields)
    and new.daily_log_id = new.included_in_daily_log_id
    and new.included_by = v_user_id
    and app_private.current_actor_has_effective_room_action(old.project_id,old.construction_site_id,'daily_log','approve')
    and app_private.current_actor_has_effective_room_action(old.project_id,old.construction_site_id,'daily_log','publish_progress')
    and exists (
      select 1 from public.daily_logs log join public.daily_log_summary_sources source on source.daily_log_id=log.id
      where log.id=new.daily_log_id and log.status='verified' and log.summary_source_type='member_contributions'
        and log.project_id=old.project_id and log.construction_site_id is not distinct from old.construction_site_id
        and source.contribution_id=old.id and source.review_status='accepted'
        and exists(select 1 from public.daily_log_work_items item where item.daily_log_id=log.id and item.summary_source_id=source.id)
    ) then return new;
  end if;
  -- Unmodified legacy behavior outside the narrow normalized publication case.
  v_can_review := app_private.project_user_has_permission(old.project_id::text,old.construction_site_id::text,'verify')
    or app_private.project_user_has_permission(old.project_id::text,old.construction_site_id::text,'approve')
    or not app_private.daily_log_scope_has_staff(old.project_id::text,old.construction_site_id::text);
  if v_can_review then return new; end if;
  if old.author_user_id=v_user_id and old.status in ('draft','returned') and new.status in ('draft','submitted') then
    return new;
  end if;
  raise exception 'Báo cáo đã gửi/tổng hợp không thể chỉnh sửa trực tiếp.';
end;
$$;
