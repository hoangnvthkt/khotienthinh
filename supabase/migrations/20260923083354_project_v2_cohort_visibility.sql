-- Legacy /da picker may ask whether IDs it already loaded are in the active
-- V2 cohort. This exposes no project data and grants no V2 room access.
create or replace function public.list_project_v2_cohort_ids_v1(p_project_ids text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ids jsonb;
begin
  if public.current_app_user_id() is null then
    raise exception using errcode = '42501', message = 'PROJECT_V2_COHORT_READ_DENIED';
  end if;
  if array_length(p_project_ids, 1) > 100 then
    raise exception using errcode = '22023', message = 'PROJECT_V2_COHORT_SCOPE_INVALID';
  end if;
  select coalesce(jsonb_agg(ids.project_id order by ids.project_id), '[]'::jsonb)
    into v_ids from (
    select w.project_id
    from public.project_v2_workspaces w
    where (p_project_ids is null or w.project_id = any(p_project_ids))
      and w.lifecycle in ('pilot', 'active')
    limit 101
  ) ids;
  if jsonb_array_length(v_ids) > 100 then
    raise exception using errcode = '22023', message = 'PROJECT_V2_COHORT_RESULT_LIMIT';
  end if;
  return jsonb_build_object('projectIds', v_ids);
end;
$$;
revoke all on function public.list_project_v2_cohort_ids_v1(text[]) from public, anon, authenticated;
grant execute on function public.list_project_v2_cohort_ids_v1(text[]) to authenticated;

create or replace function public.list_project_v2_workspaces_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  with actor as (select public.current_app_user_id() as id),
  visible as (
    select w.id, w.project_id, w.primary_construction_site_id, w.lifecycle, w.version,
      p.name as project_name, p.code as project_code, p.client_name,
      site.name as construction_site_name
    from public.project_v2_workspaces w
    join public.projects p on p.id = w.project_id
    left join public.hrm_construction_sites site on site.id = w.primary_construction_site_id
    cross join actor a
    where a.id is not null and w.lifecycle <> 'archived'
      and (app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
        'project.v2_month_plan.view', a.id)
        or app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
          'project.v2_construction_plan.view', a.id)
        or app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
          'project.v2_material_plan.view', a.id))
  )
  select jsonb_build_object('asOf', now(),
    'workspaces', coalesce(jsonb_agg(to_jsonb(visible) order by project_name, id), '[]'::jsonb))
  from visible;
$$;
revoke all on function public.list_project_v2_workspaces_v1() from public, anon, authenticated;
grant execute on function public.list_project_v2_workspaces_v1() to authenticated;
