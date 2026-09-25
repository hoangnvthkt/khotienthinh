-- The legacy project picker may request all active V2 cohort IDs. Return only
-- workspaces this session actor can open in Project V2; the project ID itself
-- must not disclose cohort membership to an unrelated authenticated account.
create or replace function public.list_project_v2_cohort_ids_v1(p_project_ids text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_ids jsonb;
begin
  if v_actor is null then
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
      and (app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
        'project.v2_month_plan.view', v_actor)
        or app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
          'project.v2_construction_plan.view', v_actor)
        or app_private.project_has_permission_v2(w.project_id, w.primary_construction_site_id::text,
          'project.v2_material_plan.view', v_actor))
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
