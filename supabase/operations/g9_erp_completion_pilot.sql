\set ON_ERROR_STOP on

-- Required psql variables: release_id, scope_key, project_id,
-- construction_site_id, warehouse_ids_csv, supplier_ids_csv, starts_at,
-- expires_at, release_owner, support_owner, reason and six *_user_id
-- variables. Dry-run is the default.
\if :{?commit_changes}
\else
  \set commit_changes false
\endif
\if :{?target_mode}
\else
  \set target_mode read_only
\endif
\if :{?release_id}
\else
  \set release_id REQUIRED_RELEASE_ID
\endif
\if :{?scope_key}
\else
  \set scope_key REQUIRED_SCOPE_KEY
\endif
\if :{?project_id}
\else
  \set project_id REQUIRED_PROJECT_ID
\endif
\if :{?construction_site_id}
\else
  \set construction_site_id REQUIRED_SITE_ID
\endif
\if :{?warehouse_ids_csv}
\else
  \set warehouse_ids_csv REQUIRED_WAREHOUSE_ID
\endif
\if :{?supplier_ids_csv}
\else
  \set supplier_ids_csv REQUIRED_SUPPLIER_ID
\endif
\if :{?starts_at}
\else
  \set starts_at REQUIRED_START_TIME
\endif
\if :{?expires_at}
\else
  \set expires_at REQUIRED_EXPIRY_TIME
\endif
\if :{?release_owner}
\else
  \set release_owner REQUIRED_RELEASE_OWNER
\endif
\if :{?support_owner}
\else
  \set support_owner REQUIRED_SUPPORT_OWNER
\endif
\if :{?reason}
\else
  \set reason REQUIRED_AUDIT_REASON
\endif
\if :{?buyer_user_id}
\else
  \set buyer_user_id 00000000-0000-0000-0000-000000000000
\endif
\if :{?qs_user_id}
\else
  \set qs_user_id 00000000-0000-0000-0000-000000000000
\endif
\if :{?warehouse_user_id}
\else
  \set warehouse_user_id 00000000-0000-0000-0000-000000000000
\endif
\if :{?qc_user_id}
\else
  \set qc_user_id 00000000-0000-0000-0000-000000000000
\endif
\if :{?accountant_user_id}
\else
  \set accountant_user_id 00000000-0000-0000-0000-000000000000
\endif
\if :{?manager_user_id}
\else
  \set manager_user_id 00000000-0000-0000-0000-000000000000
\endif

begin;

create temp table g9_rollout_input on commit drop as
select
  :'release_id'::text as release_id,
  :'scope_key'::text as scope_key,
  :'project_id'::text as project_id,
  nullif(:'construction_site_id','')::text as construction_site_id,
  regexp_split_to_array(:'warehouse_ids_csv','\s*,\s*')::text[] as warehouse_ids,
  regexp_split_to_array(:'supplier_ids_csv','\s*,\s*')::text[] as supplier_ids,
  :'target_mode'::text as target_mode,
  :'starts_at'::timestamptz as starts_at,
  :'expires_at'::timestamptz as expires_at,
  :'release_owner'::text as release_owner,
  :'support_owner'::text as support_owner,
  :'reason'::text as reason;

create temp table g9_rollout_actor_input(persona text,user_id uuid) on commit drop;
insert into g9_rollout_actor_input values
('buyer',:'buyer_user_id'::uuid),
('qs',:'qs_user_id'::uuid),
('warehouse',:'warehouse_user_id'::uuid),
('qc',:'qc_user_id'::uuid),
('accountant',:'accountant_user_id'::uuid),
('manager',:'manager_user_id'::uuid);

do $$
declare v_input g9_rollout_input%rowtype;
begin
  select * into strict v_input from g9_rollout_input;
  if v_input.release_id like 'REQUIRED_%' or v_input.scope_key like 'REQUIRED_%'
     or v_input.project_id like 'REQUIRED_%'
     or v_input.release_owner like 'REQUIRED_%'
     or v_input.support_owner like 'REQUIRED_%'
     or v_input.reason like 'REQUIRED_%' then
    raise exception 'G9_OPERATION_INPUT_REQUIRED';
  end if;
  if v_input.target_mode not in ('read_only','pilot','paused') then
    raise exception 'G9_OPERATION_MODE_INVALID';
  end if;
  if v_input.expires_at <= v_input.starts_at or v_input.expires_at <= statement_timestamp() then
    raise exception 'G9_OPERATION_WINDOW_INVALID';
  end if;
  if not exists(select 1 from public.projects where id=v_input.project_id) then
    raise exception 'G9_OPERATION_PROJECT_NOT_FOUND';
  end if;
  if v_input.construction_site_id is not null and not exists(
    select 1 from public.projects project
    join public.hrm_construction_sites site on site.id=project.construction_site_id
    where project.id=v_input.project_id and site.id::text=v_input.construction_site_id
  ) then raise exception 'G9_OPERATION_SITE_SCOPE_INVALID'; end if;
  if exists(
    select 1 from unnest(v_input.warehouse_ids) wanted(id)
    left join public.warehouses warehouse on warehouse.id=wanted.id
    where warehouse.id is null or warehouse.is_archived
      or warehouse.project_id is distinct from v_input.project_id
      or (v_input.construction_site_id is not null
        and warehouse.construction_site_id::text is distinct from v_input.construction_site_id)
  ) then raise exception 'G9_OPERATION_WAREHOUSE_SCOPE_INVALID'; end if;
  if exists(
    select 1 from unnest(v_input.supplier_ids) wanted(id)
    left join public.business_partners supplier on supplier.id=wanted.id
    where supplier.id is null or not ('supplier'=any(supplier.classifications))
  ) then raise exception 'G9_OPERATION_SUPPLIER_INVALID'; end if;
  if (select count(*) from g9_rollout_actor_input actor
      join public.users app_user on app_user.id=actor.user_id
      where app_user.is_active and app_user.account_status='ACTIVE') <> 6 then
    raise exception 'G9_OPERATION_NAMED_ACTORS_INVALID';
  end if;
  if (select count(distinct user_id) from g9_rollout_actor_input) <> 6 then
    raise exception 'G9_OPERATION_DISTINCT_ACTORS_REQUIRED';
  end if;
  if exists(select 1 from app_private.erp_completion_rollout_scopes
    where scope_key=v_input.scope_key or release_id=v_input.release_id) then
    raise exception 'G9_OPERATION_SCOPE_ALREADY_EXISTS';
  end if;
end;
$$;

select set_config('app.erp_completion_rollout_reason',(select reason from g9_rollout_input),true);

with created as (
  insert into app_private.erp_completion_rollout_scopes(
    scope_key,project_id,construction_site_id,warehouse_ids,supplier_ids,mode,
    enabled_commands,completion_commands,starts_at,expires_at,release_id,
    owner,support_owner,reason
  )
  select scope_key,project_id,construction_site_id,warehouse_ids,supplier_ids,target_mode,
    array[
      'material_plan.save','material_plan.convert','procurement.assign',
      'procurement.allocate','procurement.po.create','wms.transfer.dispatch',
      'wms.transfer.receive','wms.transfer.dispose','wms.inventory_count.start',
      'wms.inventory_count.post','finance.invoice.record','finance.invoice.reverse',
      'finance.payment.post','finance.payment.reverse'
    ]::text[],
    array['wms.transfer.receive','wms.transfer.dispose','wms.inventory_count.post',
      'finance.invoice.reverse','finance.payment.reverse']::text[],
    starts_at,expires_at,release_id,release_owner,support_owner,reason
  from g9_rollout_input
  returning id
)
insert into app_private.erp_completion_rollout_actors(scope_id,user_id,persona)
select created.id,actor.user_id,actor.persona from created cross join g9_rollout_actor_input actor;

select scope.scope_key,scope.release_id,scope.mode,scope.project_id,
  scope.construction_site_id,scope.warehouse_ids,scope.supplier_ids,
  scope.starts_at,scope.expires_at,scope.enabled_commands,scope.completion_commands,
  jsonb_agg(jsonb_build_object('persona',actor.persona,'userId',actor.user_id)
    order by actor.persona) as actors
from app_private.erp_completion_rollout_scopes scope
join app_private.erp_completion_rollout_actors actor on actor.scope_id=scope.id
where scope.scope_key=:'scope_key'
group by scope.id;

\if :commit_changes
  commit;
\else
  rollback;
  \echo 'G9 dry-run complete; no rollout configuration was persisted.'
\endif
