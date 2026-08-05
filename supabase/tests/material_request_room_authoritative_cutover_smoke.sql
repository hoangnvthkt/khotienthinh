begin;

do $$
declare
  v_pilot_count integer;
  v_verify_status text;
  v_required_actions text[];
begin
  select count(*) into v_pilot_count
  from app_private.project_permission_room_action_bindings
  where room_code = 'material_request'
    and action_code in ('view','edit','delete','submit','approve','confirm','view_available_stock')
    and enforcement_status = 'pilot'
    and not pbac_fallback_enabled
    and (action_code = 'view' or prerequisite_action_codes = array['view']::text[]);
  if v_pilot_count <> 7 then
    raise exception 'Expected seven authoritative Material Request pilot actions, got %', v_pilot_count;
  end if;

  select enforcement_status into v_verify_status
  from app_private.project_permission_room_action_bindings
  where room_code = 'material_request' and action_code = 'verify';
  if v_verify_status <> 'audit_only' then
    raise exception 'Material Request verify must remain audit_only';
  end if;

  select required_actions into v_required_actions
  from public.project_permission_rooms where code = 'material_request';
  if cardinality(v_required_actions) <> 0 then
    raise exception 'Material Request Room must allow an empty configuration';
  end if;

  if to_regprocedure('public.list_project_material_request_procurement_demand(text,text)') is null
    or to_regprocedure('public.get_project_material_request_aggregate(text,text)') is null
    or to_regprocedure('public.get_project_material_request_available_stock(text,text,text,text[])') is null then
    raise exception 'Material Request least-privilege projections are missing';
  end if;
end;
$$;

rollback;
