-- E27 versioned role-template commands and dynamic impact preview. Rollback only.
begin;

create temporary table e27_actor(kind text primary key,id uuid,auth_id uuid,email text) on commit drop;
insert into e27_actor
select kind,gen_random_uuid(),gen_random_uuid(),'e27-'||kind||'-'||gen_random_uuid()::text||'@vioo.local'
from (values('permission_admin'),('auditor'),('target_one'),('target_two')) actor(kind);
insert into public.users(id,name,email,username,role,is_active,account_status)
select id,'E27 '||kind,email,email,'EMPLOYEE'::public.user_role,true,'ACTIVE' from e27_actor;

insert into public.principal_role_assignments(
  principal_type,principal_id,role_template_id,scope_type,scope_id,status,assigned_by,assigned_reason
)
select 'user',actor.id,template_row.id,'global','*','ACTIVE',actor.id,'E27 rollback fixture governed operator'
from e27_actor actor join public.role_permission_templates template_row
  on template_row.code=case actor.kind when 'permission_admin' then 'PERMISSION_ADMIN' else 'AUDITOR' end
where actor.kind in('permission_admin','auditor');

do $$
declare
  operator_row e27_actor%rowtype;
  auditor_row e27_actor%rowtype;
  target_one e27_actor%rowtype;
  target_two e27_actor%rowtype;
  super_id uuid;
  preview_row jsonb;
  acceptances jsonb;
  receipt jsonb;
  first_assignment uuid;
  second_assignment uuid;
  role_receipt jsonb;
  test_role_id uuid;
  snapshot_row jsonb;
  blocked boolean;
begin
  select * into operator_row from e27_actor where kind='permission_admin';
  select * into auditor_row from e27_actor where kind='auditor';
  select * into target_one from e27_actor where kind='target_one';
  select * into target_two from e27_actor where kind='target_two';
  select id into super_id from public.role_permission_templates where code='SUPER_ADMIN';
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',operator_row.auth_id,'email',operator_row.email,'role','authenticated'
  )::text,true);

  snapshot_row:=public.get_business_role_admin_snapshot();
  if not exists(
    select 1 from jsonb_array_elements(snapshot_row->'templates') template_row
    where template_row->>'code'='SUPER_ADMIN'
      and (template_row->>'dynamic')::boolean
      and (template_row->>'effectiveActionCount')::integer=384
  ) then raise exception 'E27 snapshot did not expose protected dynamic SUPER_ADMIN'; end if;

  preview_row:=public.preview_business_role_assignment_v2(target_one.id,super_id,'global','*');
  if not (preview_row->>'dynamic')::boolean
     or (preview_row->>'permissionCount')::integer<>384
     or jsonb_array_length(preview_row->'warnings')=0
     or coalesce(preview_row->>'fingerprint','')='' then
    raise exception 'E27 SUPER_ADMIN impact preview is incomplete';
  end if;

  blocked:=false;
  begin
    perform public.assign_business_role_v2(
      target_one.id,super_id,(preview_row->>'roleVersion')::integer,'global','*',now(),null,
      'E27 stale preview must fail','[]'::jsonb,'wrong-fingerprint'
    );
  exception when sqlstate '40001' then blocked:=sqlerrm='AUTHORIZATION_STALE_ASSIGNMENT_PREVIEW'; end;
  if not blocked then raise exception 'E27 stale assignment preview was not rejected'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleCode',warning->>'ruleCode','scopeType',warning->>'scopeType','scopeId',warning->>'scopeId',
    'reason','E27 reviewed protected root warning','controlOwnerUserId',auditor_row.id,
    'compensatingControls','E27 independent audit monitoring','expiresAt',now()+interval '1 day'
  )),'[]'::jsonb) into acceptances from jsonb_array_elements(preview_row->'warnings') warning;
  receipt:=public.assign_business_role_v2(
    target_one.id,super_id,(preview_row->>'roleVersion')::integer,'global','*',now(),null,
    'E27 protected root assignment one',acceptances,preview_row->>'fingerprint'
  );
  first_assignment:=(receipt->>'assignmentId')::uuid;

  preview_row:=public.preview_business_role_assignment_v2(target_two.id,super_id,'global','*');
  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleCode',warning->>'ruleCode','scopeType',warning->>'scopeType','scopeId',warning->>'scopeId',
    'reason','E27 reviewed protected root warning','controlOwnerUserId',auditor_row.id,
    'compensatingControls','E27 independent audit monitoring','expiresAt',now()+interval '1 day'
  )),'[]'::jsonb) into acceptances from jsonb_array_elements(preview_row->'warnings') warning;
  receipt:=public.assign_business_role_v2(
    target_two.id,super_id,(preview_row->>'roleVersion')::integer,'global','*',now(),null,
    'E27 protected root assignment two',acceptances,preview_row->>'fingerprint'
  );
  second_assignment:=(receipt->>'assignmentId')::uuid;
  if not app_private.has_permission(target_one.id,'request.instance.reassign','global','*') then
    raise exception 'E27 assigned SUPER_ADMIN did not resolve dynamically';
  end if;
  perform public.revoke_business_role_assignment(first_assignment,'E27 revoke with another root remaining');

  role_receipt:=public.save_business_role_v2(
    null,0,'E27_TEST_OPERATOR','E27 Test Operator','Rollback-only E27 template',
    jsonb_build_array(jsonb_build_object(
      'permission_code','request.template.view','scope_type','global','scope_id','*','sort_order',0
    )),'E27 create versioned test template'
  );
  test_role_id:=(role_receipt->>'roleTemplateId')::uuid;
  blocked:=false;
  begin
    perform public.save_business_role_v2(
      test_role_id,0,'E27_TEST_OPERATOR','E27 stale update','Rollback-only E27 template',
      jsonb_build_array(jsonb_build_object(
        'permission_code','request.template.view','scope_type','global','scope_id','*','sort_order',0
      )),'E27 stale version must be rejected'
    );
  exception when sqlstate '40001' then blocked:=sqlerrm='AUTHORIZATION_STALE_ROLE_VERSION'; end;
  if not blocked then raise exception 'E27 stale template version was not rejected'; end if;

  role_receipt:=public.save_business_role_v2(
    test_role_id,1,'E27_TEST_OPERATOR','E27 Test Operator v2','Rollback-only E27 template',
    jsonb_build_array(jsonb_build_object(
      'permission_code','request.template.view','scope_type','global','scope_id','*','sort_order',0
    )),'E27 valid optimistic template update'
  );
  if (role_receipt->>'version')::integer<>2 then raise exception 'E27 version did not advance'; end if;

  if has_function_privilege('authenticated','public.save_business_role(uuid,text,text,text,jsonb,text)','EXECUTE')
     or has_function_privilege('authenticated','public.assign_business_role(uuid,uuid,text,text,timestamptz,timestamptz,text,jsonb)','EXECUTE') then
    raise exception 'E27 legacy mutation RPC remains callable by authenticated';
  end if;
  if second_assignment is null then raise exception 'E27 second protected assignment missing'; end if;
end;
$$;

select 'authorization_v2_task12_4_2_e27_runtime_smoke_passed' result;
rollback;
