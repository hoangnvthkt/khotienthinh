-- ═══════════════════════════════════════════════════════════════
--  AI Tool: Search Employee (ai_tool_employee_search)
-- ═══════════════════════════════════════════════════════════════

create or replace function public.ai_tool_employee_search(
  p_keyword text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_kw text := '%' || lower(trim(coalesce(p_keyword, ''))) || '%';
  v_kw_unaccent text := '%' || lower(unaccent(trim(coalesce(p_keyword, '')))) || '%';
begin
  select jsonb_build_object(
    'keyword', trim(coalesce(p_keyword, '')),
    'total_found', count(*),
    'employees', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'employee_code', e.employee_code,
        'full_name', e.full_name,
        'title', e.title,
        'gender', e.gender,
        'phone', e.phone,
        'email', e.email,
        'date_of_birth', e.date_of_birth,
        'start_date', e.start_date,
        'official_date', e.official_date,
        'status', coalesce(e.status, 'active'),
        'marital_status', e.marital_status,
        'avatar_url', e.avatar_url,
        'department_name', ou.name,
        'position_name', hp.name,
        'site_name', hcs.name
      )
      order by e.full_name
    ), '[]'::jsonb)
  )
  into v_result
  from (
    select emp.*
    from employees emp
    where lower(emp.full_name) like v_kw
       or lower(unaccent(coalesce(emp.full_name, ''))) like v_kw_unaccent
       or lower(emp.employee_code) like v_kw
    limit 20
  ) e
  left join org_units ou on ou.id = e.org_unit_id
  left join hrm_positions hp on hp.id = e.position_id
  left join hrm_construction_sites hcs on hcs.id = e.construction_site_id;

  return v_result;
end;
$$;

revoke all on function public.ai_tool_employee_search(text) from public, anon, authenticated;
grant execute on function public.ai_tool_employee_search(text) to service_role;

notify pgrst, 'reload schema';
