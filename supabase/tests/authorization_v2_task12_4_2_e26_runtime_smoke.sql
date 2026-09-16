-- Cloud-only rollback smoke for E26 Request lifecycle guards and SUPER_ADMIN.
begin;

create temporary table e26_actor(
  kind text primary key,
  id uuid not null,
  auth_id uuid not null,
  email text not null
) on commit drop;

insert into e26_actor
select kind,gen_random_uuid(),gen_random_uuid(),
  'e26-'||kind||'-'||gen_random_uuid()::text||'@vioo.local'
from (values
  ('permission_admin'),('super_one'),('super_two'),
  ('request_exact'),('request_compat'),('denied')
) actor(kind);

insert into public.users(id,name,email,username,role,is_active,account_status)
select id,'E26 '||kind,email,email,'EMPLOYEE'::public.user_role,true,'ACTIVE'
from e26_actor;

insert into public.principal_role_assignments(
  principal_type,principal_id,role_template_id,scope_type,scope_id,
  status,assigned_by,assigned_reason
)
select 'user',actor.id,template_row.id,'global','*','ACTIVE',actor.id,
  'E26 rollback fixture permission administrator'
from e26_actor actor
join public.role_permission_templates template_row on template_row.code='PERMISSION_ADMIN'
where actor.kind='permission_admin';

insert into public.principal_role_assignments(
  principal_type,principal_id,role_template_id,scope_type,scope_id,
  status,assigned_by,assigned_reason
)
select 'user',actor.id,template_row.id,'global','*','ACTIVE',actor.id,
  'E26 rollback fixture independent audit owner'
from e26_actor actor
join public.role_permission_templates template_row on template_row.code='AUDITOR'
where actor.kind='denied';

select set_config('app.authorization_permission_command','on',true);
insert into public.user_permission_grants(
  user_id,permission_code,scope_type,scope_id,is_active,grant_reason,expires_at
)
select actor.id,grant_row.permission_code,grant_row.scope_type,
  case when grant_row.scope_type in ('own','assigned') then actor.id::text else '*' end,
  true,'E26 rollback fixture exact lifecycle capability',
  case when grant_row.permission_code in (
    'request.instance.approve_assigned','request.instance.reject_assigned',
    'request.instance.reassign'
  ) then now()+interval '1 day' end
from e26_actor actor
cross join (values
  ('request.instance.approve_assigned','assigned'),
  ('request.instance.reject_assigned','assigned'),
  ('request.instance.return_assigned','assigned'),
  ('request.instance.resubmit_own','own'),
  ('request.instance.cancel','own'),
  ('request.instance.reassign','global'),
  ('request.instance.edit_own_content','own')
) grant_row(permission_code,scope_type)
where actor.kind='request_exact';

insert into public.user_permission_grants(
  user_id,permission_code,scope_type,scope_id,is_active,grant_reason
)
select id,'system.rq.view','global','*',true,'E26 rollback compatibility fixture'
from e26_actor where kind='request_compat';

create temporary table e26_request(
  kind text primary key,
  id uuid not null,
  subject_id uuid
) on commit drop;
insert into e26_request(kind,id)
values
  ('exact_pending',gen_random_uuid()),
  ('exact_returned',gen_random_uuid()),
  ('compat_pending',gen_random_uuid()),
  ('denied_pending',gen_random_uuid()),
  ('assignment',gen_random_uuid());

insert into public.request_instances(id,code,title,created_by,status)
select request_row.id,'E26-'||upper(request_row.kind)||'-'||substr(request_row.id::text,1,8),
  'E26 '||request_row.kind,
  case when request_row.kind='compat_pending' then compat.id
       when request_row.kind='denied_pending' then denied.id else exact_actor.id end,
  case when request_row.kind='exact_returned' then 'RETURNED' else 'PENDING' end
from e26_request request_row
cross join lateral (select id from e26_actor where kind='request_exact') exact_actor
cross join lateral (select id from e26_actor where kind='request_compat') compat
cross join lateral (select id from e26_actor where kind='denied') denied;

update public.request_instances request_instance
set created_by=creator.id
from e26_request request_row
cross join lateral (select id from e26_actor where kind='super_one') creator
where request_instance.id=request_row.id and request_row.kind='assignment';

insert into public.workflow_subjects(subject_type,subject_id,status,created_by)
select 'request',request_row.id::text,'RUNNING',exact_actor.id
from e26_request request_row
cross join lateral (select id from e26_actor where kind='request_exact') exact_actor
where request_row.kind='assignment'
returning id;

update e26_request request_row
set subject_id=subject.id
from public.workflow_subjects subject
where request_row.kind='assignment' and subject.subject_id=request_row.id::text;
update public.request_instances request_instance
set workflow_subject_id=request_row.subject_id
from e26_request request_row
where request_instance.id=request_row.id and request_row.kind='assignment';

do $$
declare
  permission_admin e26_actor%rowtype;
  super_one e26_actor%rowtype;
  super_two e26_actor%rowtype;
  exact_actor e26_actor%rowtype;
  compat_actor e26_actor%rowtype;
  denied_actor e26_actor%rowtype;
  request_row e26_request%rowtype;
  super_template_id uuid;
  permission_template_id uuid;
  first_assignment uuid;
  second_assignment uuid;
  assignment_id uuid;
  preview_row jsonb;
  warning_acceptances jsonb;
  assignment_receipt jsonb;
  blocked boolean;
begin
  select * into permission_admin from e26_actor where kind='permission_admin';
  select * into super_one from e26_actor where kind='super_one';
  select * into super_two from e26_actor where kind='super_two';
  select * into exact_actor from e26_actor where kind='request_exact';
  select * into compat_actor from e26_actor where kind='request_compat';
  select * into denied_actor from e26_actor where kind='denied';
  select id into super_template_id from public.role_permission_templates where code='SUPER_ADMIN';
  select id into permission_template_id from public.role_permission_templates where code='PERMISSION_ADMIN';

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',permission_admin.auth_id,'email',permission_admin.email,'role','authenticated'
  )::text,true);

  blocked:=false;
  begin
    preview_row:=public.preview_business_role_assignment_v2(
      permission_admin.id,super_template_id,'global','*'
    );
    perform public.assign_business_role_v2(
      permission_admin.id,super_template_id,(preview_row->>'roleVersion')::integer,
      'global','*',now(),null,'E26 must reject self assignment','[]'::jsonb,
      preview_row->>'fingerprint'
    );
  exception when sqlstate '42501' then blocked:=true; end;
  if not blocked then raise exception 'SUPER_ADMIN self assignment was not blocked'; end if;

  preview_row:=public.preview_business_role_assignment_v2(super_one.id,super_template_id,'global','*');
  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleCode',warning->>'ruleCode','scopeType',warning->>'scopeType',
    'scopeId',warning->>'scopeId','reason','E26 reviewed root assignment warning',
    'controlOwnerUserId',denied_actor.id,'compensatingControls','E26 independent audit monitoring',
    'expiresAt',now()+interval '1 day'
  )),'[]'::jsonb) into warning_acceptances
  from jsonb_array_elements(preview_row->'warnings') warning;
  assignment_receipt:=public.assign_business_role_v2(
    super_one.id,super_template_id,(preview_row->>'roleVersion')::integer,
    'global','*',now(),null,'E26 protected root role assignment one',warning_acceptances,
    preview_row->>'fingerprint'
  );
  first_assignment:=(assignment_receipt->>'assignmentId')::uuid;

  preview_row:=public.preview_business_role_assignment_v2(super_two.id,super_template_id,'global','*');
  select coalesce(jsonb_agg(jsonb_build_object(
    'ruleCode',warning->>'ruleCode','scopeType',warning->>'scopeType',
    'scopeId',warning->>'scopeId','reason','E26 reviewed root assignment warning',
    'controlOwnerUserId',denied_actor.id,'compensatingControls','E26 independent audit monitoring',
    'expiresAt',now()+interval '1 day'
  )),'[]'::jsonb) into warning_acceptances
  from jsonb_array_elements(preview_row->'warnings') warning;
  assignment_receipt:=public.assign_business_role_v2(
    super_two.id,super_template_id,(preview_row->>'roleVersion')::integer,
    'global','*',now(),null,'E26 protected root role assignment two',warning_acceptances,
    preview_row->>'fingerprint'
  );
  second_assignment:=(assignment_receipt->>'assignmentId')::uuid;

  if not app_private.has_permission(super_one.id,'wms.transaction.reverse','global','*')
     or not exists (
       select 1 from app_private.resolve_effective_permission_sources(
         super_one.id,'wms.transaction.reverse','global','*',now()
       ) source_row where source_row.source_code='SUPER_ADMIN' and source_row.metadata->>'dynamic'='true'
     ) then
    raise exception 'SUPER_ADMIN did not receive the active catalog dynamically';
  end if;

  perform set_config('app.authorization_permission_command','on',true);
  insert into public.permission_actions(
    module_code,action,permission_code,label,scope_modes,is_active,risk_level,
    is_business_action,is_business_approval,direct_grant_requires_expiry,
    grant_readiness,access_application_code,direct_grant_allowed
  ) values(
    'system.authorization','e26_future_test','system.authorization.e26_future_test',
    'E26 future action',array['global']::text[],true,'normal',false,false,false,
    'enforced','settings',false
  );
  if not app_private.has_permission(super_one.id,'system.authorization.e26_future_test','global','*') then
    raise exception 'SUPER_ADMIN did not auto-include a future capability';
  end if;

  blocked:=false;
  begin
    update public.principal_role_assignments
    set role_template_id=permission_template_id where id=first_assignment;
  exception when sqlstate '55000' then blocked:=sqlerrm='SUPER_ADMIN_ASSIGNMENT_IMMUTABLE'; end;
  if not blocked then raise exception 'SUPER_ADMIN role-template mutation was not blocked'; end if;

  perform public.revoke_business_role_assignment(first_assignment,'E26 revoke with another root remaining');
  blocked:=false;
  begin
    delete from public.principal_role_assignments where id=second_assignment;
  exception when sqlstate '55000' then blocked:=sqlerrm='LAST_SUPER_ADMIN_REQUIRED'; end;
  if not blocked then raise exception 'Last SUPER_ADMIN direct deletion was not blocked'; end if;
  blocked:=false;
  begin
    perform public.revoke_business_role_assignment(second_assignment,'E26 must keep the final protected root');
  exception when sqlstate '55000' then blocked:=sqlerrm='LAST_SUPER_ADMIN_REQUIRED'; end;
  if not blocked then raise exception 'Last SUPER_ADMIN revocation was not blocked'; end if;

  blocked:=false;
  begin
    update public.role_permission_templates set description='tampered' where id=super_template_id;
  exception when sqlstate '42501' then blocked:=sqlerrm='SUPER_ADMIN_TEMPLATE_LOCKED'; end;
  if not blocked then raise exception 'SUPER_ADMIN template mutation was not blocked'; end if;

  blocked:=false;
  begin
    insert into public.role_permission_template_items(template_id,permission_code,scope_type,scope_id)
    values(super_template_id,'system.authorization.view','global','*');
  exception when sqlstate '42501' then blocked:=sqlerrm='SUPER_ADMIN_TEMPLATE_ITEMS_FORBIDDEN'; end;
  if not blocked then raise exception 'SUPER_ADMIN item expansion was not blocked'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',exact_actor.auth_id,'email',exact_actor.email,'role','authenticated'
  )::text,true);
  select * into request_row from e26_request where kind='exact_pending';
  update public.request_instances set title='E26 exact edit' where id=request_row.id;
  update public.request_instances set status='CANCELLED' where id=request_row.id;
  select * into request_row from e26_request where kind='exact_returned';
  update public.request_instances set status='PENDING' where id=request_row.id;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',compat_actor.auth_id,'email',compat_actor.email,'role','authenticated'
  )::text,true);
  select * into request_row from e26_request where kind='compat_pending';
  update public.request_instances set title='E26 compatibility edit' where id=request_row.id;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',denied_actor.auth_id,'email',denied_actor.email,'role','authenticated'
  )::text,true);
  select * into request_row from e26_request where kind='denied_pending';
  blocked:=false;
  begin
    update public.request_instances set title='forbidden edit' where id=request_row.id;
  exception when sqlstate '42501' then blocked:=sqlerrm='REQUEST_EDIT_FORBIDDEN'; end;
  if not blocked then raise exception 'Request content guard allowed an unauthorized creator'; end if;

  select * into request_row from e26_request where kind='assignment';
  insert into public.workflow_step_assignments(
    workflow_subject_id,assignee_user_id,assigned_by,status,metadata
  ) values(request_row.subject_id,exact_actor.id,exact_actor.id,'PENDING','{}'::jsonb)
  returning id into assignment_id;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',exact_actor.auth_id,'email',exact_actor.email,'role','authenticated'
  )::text,true);
  update public.workflow_step_assignments set status='APPROVED' where id=assignment_id;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',compat_actor.auth_id,'email',compat_actor.email,'role','authenticated'
  )::text,true);
  insert into public.workflow_step_assignments(
    workflow_subject_id,assignee_user_id,assigned_by,status,metadata
  ) values(request_row.subject_id,compat_actor.id,exact_actor.id,'PENDING','{}'::jsonb)
  returning id into assignment_id;
  update public.workflow_step_assignments set status='REJECTED' where id=assignment_id;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',denied_actor.auth_id,'email',denied_actor.email,'role','authenticated'
  )::text,true);
  insert into public.workflow_step_assignments(
    workflow_subject_id,assignee_user_id,assigned_by,status,metadata
  ) values(request_row.subject_id,denied_actor.id,exact_actor.id,'PENDING','{}'::jsonb)
  returning id into assignment_id;
  blocked:=false;
  begin
    update public.workflow_step_assignments set status='APPROVED' where id=assignment_id;
  exception when sqlstate '42501' then blocked:=sqlerrm='REQUEST_ACTION_FORBIDDEN'; end;
  if not blocked then raise exception 'Assigned lifecycle guard allowed an unauthorized actor'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',exact_actor.auth_id,'email',exact_actor.email,'role','authenticated'
  )::text,true);
  insert into public.workflow_step_assignments(
    workflow_subject_id,assignee_user_id,assigned_by,status,metadata
  ) values(request_row.subject_id,super_two.id,exact_actor.id,'PENDING',
    jsonb_build_object('reassignedFrom',denied_actor.id));
end;
$$;

select 'authorization_v2_task12_4_2_e26_runtime_smoke_passed' as result;
rollback;
