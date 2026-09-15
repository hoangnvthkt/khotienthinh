-- The requests RLS policy calls v3. Legacy v1/v2 must not remain directly
-- executable, and their WMS branch must be isolated behind one private helper.
begin;

do $$
declare
  v1_definition text;
  v2_definition text;
  v3_definition text;
begin
  if to_regprocedure(
    'app_private.material_request_wms_can_delete_compatibility(text,uuid,text,text,text)'
  ) is null then
    raise exception 'Missing material-request WMS delete compatibility helper';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.material_request_wms_can_delete_compatibility(text,uuid,text,text,text)',
    'execute'
  ) then
    raise exception 'Authenticated can invoke WMS delete compatibility helper';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.material_request_can_delete(text,text,text,boolean,uuid,text,text,text)',
    'execute'
  ) then
    raise exception 'Authenticated can invoke obsolete material-request delete v1';
  end if;
  if has_function_privilege(
    'authenticated',
    'app_private.material_request_can_delete_v2(text,text,text,boolean,uuid,text,text,text,text)',
    'execute'
  ) then
    raise exception 'Authenticated can bypass v3 through material-request delete v2';
  end if;
  if not has_function_privilege(
    'authenticated',
    'app_private.material_request_can_delete_v3(text,text,text,text,boolean,uuid,text,text,text,text)',
    'execute'
  ) then
    raise exception 'Requests RLS role lost access to material-request delete v3';
  end if;

  v1_definition := pg_get_functiondef(
    'app_private.material_request_can_delete(text,text,text,boolean,uuid,text,text,text)'::regprocedure
  );
  v2_definition := pg_get_functiondef(
    'app_private.material_request_can_delete_v2(text,text,text,boolean,uuid,text,text,text,text)'::regprocedure
  );
  v3_definition := pg_get_functiondef(
    'app_private.material_request_can_delete_v3(text,text,text,text,boolean,uuid,text,text,text,text)'::regprocedure
  );

  if position('app_private.material_request_wms_can_delete_compatibility' in v1_definition) = 0
     or position('app_private.material_request_wms_can_delete_compatibility' in v2_definition) = 0 then
    raise exception 'Legacy delete helpers are not wired to WMS compatibility boundary';
  end if;
  if position('is_module_admin(''WMS'')' in v1_definition) > 0
     or position('is_module_admin(''WMS'')' in v2_definition) > 0 then
    raise exception 'Legacy delete helper still embeds WMS module-admin fallback';
  end if;
  if position('app_private.material_request_can_delete_v2' in v3_definition) = 0 then
    raise exception 'Material-request delete v3 no longer routes WMS through v2';
  end if;
end $$;

rollback;
