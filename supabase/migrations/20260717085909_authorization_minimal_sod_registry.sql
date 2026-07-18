-- Phase 2 typed Minimal SoD registry and deterministic decision engine.

create table public.authorization_sod_rules (
  rule_code text primary key,
  name text not null,
  description text not null,
  rule_type text not null
    check (rule_type in ('SELF_GRANT','PERMISSION_PAIR','SUBJECT_RELATION')),
  effect text not null
    check (effect in ('DENY','WARN','REQUIRE_OVERRIDE')),
  left_permission_code text references public.permission_actions(permission_code) on update cascade on delete restrict,
  right_permission_code text references public.permission_actions(permission_code) on update cascade on delete restrict,
  operation_code text,
  subject_type text,
  overridable boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effect <> 'DENY' or not overridable),
  check (effect <> 'REQUIRE_OVERRIDE' or overridable),
  check (
    rule_type <> 'PERMISSION_PAIR'
    or (left_permission_code is not null and right_permission_code is not null)
  ),
  check (
    rule_type <> 'SUBJECT_RELATION'
    or (operation_code is not null and subject_type is not null)
  )
);

create table public.authorization_sod_warning_acceptances (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null references public.authorization_sod_rules(rule_code) on delete restrict,
  command_type text not null,
  command_id uuid not null,
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  scope_type text not null,
  scope_id text not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  control_owner_user_id uuid not null references public.users(id) on delete restrict,
  compensating_controls text not null check (char_length(btrim(compensating_controls)) >= 10),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (rule_code, command_type, command_id, scope_type, scope_id)
);

create index authorization_sod_rules_active_effect_idx
  on public.authorization_sod_rules (effect, rule_type)
  where is_active;
create index authorization_sod_rules_left_permission_idx
  on public.authorization_sod_rules (left_permission_code)
  where left_permission_code is not null;
create index authorization_sod_rules_right_permission_idx
  on public.authorization_sod_rules (right_permission_code)
  where right_permission_code is not null;
create index authorization_sod_warning_target_idx
  on public.authorization_sod_warning_acceptances (target_user_id, created_at desc);
create index authorization_sod_warning_actor_idx
  on public.authorization_sod_warning_acceptances (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index authorization_sod_warning_owner_expiry_idx
  on public.authorization_sod_warning_acceptances (control_owner_user_id, expires_at);

alter table public.authorization_sod_rules enable row level security;
alter table public.authorization_sod_warning_acceptances enable row level security;

revoke all privileges on table public.authorization_sod_rules from public, anon, authenticated;
revoke all privileges on table public.authorization_sod_warning_acceptances from public, anon, authenticated;
grant select on table public.authorization_sod_rules to authenticated;
grant select on table public.authorization_sod_warning_acceptances to authenticated;

create policy authorization_sod_rules_authorized_select
on public.authorization_sod_rules for select
to authenticated
using ((select app_private.has_permission(
  public.current_app_user_id(), 'system.authorization.view', 'global', '*'
)));

create policy authorization_sod_warning_authorized_select
on public.authorization_sod_warning_acceptances for select
to authenticated
using (
  actor_user_id = (select public.current_app_user_id())
  or target_user_id = (select public.current_app_user_id())
  or control_owner_user_id = (select public.current_app_user_id())
  or (select app_private.has_permission(
    public.current_app_user_id(), 'system.authorization.audit', 'global', '*'
  ))
);

insert into public.authorization_sod_rules (
  rule_code, name, description, rule_type, effect,
  left_permission_code, right_permission_code,
  operation_code, subject_type, overridable, metadata
)
values
  ('AUTHZ_SENSITIVE_SELF_GRANT','Chặn tự cấp quyền nhạy cảm','Permission Admin không được tự cấp permission sensitive','SELF_GRANT','DENY',null,null,'grant_sensitive_permission','user',false,'{}'::jsonb),
  ('WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL','Maker-checker final approval','Creator hoặc submitter không được final-approve chính subject','SUBJECT_RELATION','DENY',null,null,'final_approve','workflow_subject',false,'{}'::jsonb),
  ('PAYMENT_EXECUTOR_FINAL_APPROVAL','Payment executor final approval','Người thực thi thanh toán không được final-approve cùng payment','SUBJECT_RELATION','DENY',null,null,'final_approve','project_payment',false,'{}'::jsonb),
  ('VENDOR_MAINTAIN_PAYMENT_APPROVE','Nhà cung cấp và duyệt thanh toán','Kết hợp cần biện pháp kiểm tra bù trừ','PERMISSION_PAIR','WARN','contract.supplier.manage','project.payment.approve',null,null,false,'{}'::jsonb),
  ('PO_CREATE_APPROVE','Tạo và duyệt PO','Kết hợp cần owner kiểm soát','PERMISSION_PAIR','WARN','project.material_po.create','project.material_po.approve',null,null,false,'{}'::jsonb),
  ('PO_RECEIVE_PAYMENT_APPROVE','Nhận hàng và duyệt thanh toán','Kết hợp cần đối soát độc lập','PERMISSION_PAIR','WARN','project.material_po.receive','project.payment.approve',null,null,false,'{}'::jsonb),
  ('WAREHOUSE_MANAGE_ADJUST_APPROVE','Quản lý kho và duyệt điều chỉnh','Kết hợp cần kiểm kê bù trừ','PERMISSION_PAIR','WARN','wms.master_data.manage','wms.transaction.approve',null,null,false,'{}'::jsonb),
  ('WORKFLOW_CONTROLLED_EXCEPTION','Ngoại lệ workflow được kiểm soát','Override chỉ tạo bằng permission và RPC riêng','SUBJECT_RELATION','REQUIRE_OVERRIDE',null,null,'controlled_exception','workflow_subject',true,'{}'::jsonb)
on conflict (rule_code) do update
set name = excluded.name,
    description = excluded.description,
    rule_type = excluded.rule_type,
    effect = excluded.effect,
    left_permission_code = excluded.left_permission_code,
    right_permission_code = excluded.right_permission_code,
    operation_code = excluded.operation_code,
    subject_type = excluded.subject_type,
    overridable = excluded.overridable,
    metadata = excluded.metadata,
    is_active = true,
    updated_at = now();

create or replace function app_private.evaluate_authorization_change(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_proposed_permission_codes text[],
  p_scope_type text,
  p_scope_id text,
  p_change_mode text default 'ADD'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array['system.authorization.manage_roles','system.authorization.manage_grants'],
      'global', '*'
    )
  then
    raise exception 'Active authorization actor required' using errcode = '42501';
  end if;

  if p_change_mode not in ('ADD', 'REPLACE_DIRECT') then
    raise exception 'Unknown authorization change mode' using errcode = '22023';
  end if;

  return (
  with proposed as (
    select distinct code as permission_code
    from unnest(coalesce(p_proposed_permission_codes, '{}'::text[])) code
  ),
  current_codes as (
    select distinct source_row.permission_code
    from app_private.resolve_effective_permission_sources(
      p_target_user_id, null, p_scope_type, p_scope_id, now()
    ) source_row
    where p_change_mode <> 'REPLACE_DIRECT'
       or source_row.source_type <> 'DIRECT'
  ),
  resulting_codes as (
    select permission_code from current_codes
    union
    select permission_code from proposed
  ),
  self_grant_denies as (
    select jsonb_build_object(
      'ruleCode', rule_row.rule_code,
      'effect', rule_row.effect,
      'message', rule_row.description,
      'permissionCodes', jsonb_agg(action_row.permission_code order by action_row.permission_code),
      'scopeType', p_scope_type,
      'scopeId', p_scope_id
    ) finding
    from public.authorization_sod_rules rule_row
    join proposed proposed_row on true
    join public.permission_actions action_row
      on action_row.permission_code = proposed_row.permission_code
     and action_row.risk_level = 'sensitive'
    where rule_row.rule_code = 'AUTHZ_SENSITIVE_SELF_GRANT'
      and rule_row.is_active
      and p_actor_user_id = p_target_user_id
      and p_change_mode = 'ADD'
    group by rule_row.rule_code, rule_row.effect, rule_row.description
  ),
  pair_findings as (
    select
      rule_row.effect,
      jsonb_build_object(
        'ruleCode', rule_row.rule_code,
        'effect', rule_row.effect,
        'message', rule_row.description,
        'permissionCodes', jsonb_build_array(rule_row.left_permission_code, rule_row.right_permission_code),
        'scopeType', p_scope_type,
        'scopeId', p_scope_id
      ) finding
    from public.authorization_sod_rules rule_row
    where rule_row.is_active
      and rule_row.rule_type = 'PERMISSION_PAIR'
      and exists (select 1 from resulting_codes c where c.permission_code = rule_row.left_permission_code)
      and exists (select 1 from resulting_codes c where c.permission_code = rule_row.right_permission_code)
      and (
        exists (select 1 from proposed c where c.permission_code = rule_row.left_permission_code)
        or exists (select 1 from proposed c where c.permission_code = rule_row.right_permission_code)
      )
      and not (
        exists (select 1 from current_codes c where c.permission_code = rule_row.left_permission_code)
        and exists (select 1 from current_codes c where c.permission_code = rule_row.right_permission_code)
      )
  ),
  all_findings as (
    select 'DENY'::text as effect, finding from self_grant_denies
    union all
    select effect, finding from pair_findings
  )
  select jsonb_build_object(
    'hardDenies', coalesce(jsonb_agg(finding order by finding->>'ruleCode') filter (where effect = 'DENY'), '[]'::jsonb),
    'warnings', coalesce(jsonb_agg(finding order by finding->>'ruleCode') filter (where effect = 'WARN'), '[]'::jsonb)
  )
  from all_findings
  );
end;
$$;

revoke all on function app_private.evaluate_authorization_change(uuid,uuid,text[],text,text,text)
  from public, anon;
grant execute on function app_private.evaluate_authorization_change(uuid,uuid,text[],text,text,text)
  to authenticated;

create or replace function app_private.evaluate_authorization_change_set(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_proposed_grants jsonb,
  p_change_mode text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array['system.authorization.manage_roles','system.authorization.manage_grants'],
      'global', '*'
    )
  then
    raise exception 'Active authorization actor required' using errcode = '42501';
  end if;

  if p_change_mode not in ('ADD', 'REPLACE_DIRECT')
    or jsonb_typeof(coalesce(p_proposed_grants, '[]'::jsonb)) <> 'array'
  then
    raise exception 'Invalid authorization change set' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_proposed_grants, '[]'::jsonb)) item(
      "permissionCode" text,
      "scopeType" text,
      "scopeId" text
    )
    left join public.permission_actions action_row
      on action_row.permission_code = item."permissionCode"
     and action_row.is_active
    where action_row.permission_code is null
       or coalesce(nullif(item."scopeType", ''), 'global') <> all(action_row.scope_modes)
       or (
         coalesce(nullif(item."scopeType", ''), 'global') = 'global'
         and coalesce(nullif(item."scopeId", ''), '*') <> '*'
       )
  ) then
    raise exception 'Authorization change set contains an invalid permission scope'
      using errcode = '23514';
  end if;

  return (
    with proposed as (
      select distinct
        item."permissionCode" as permission_code,
        coalesce(nullif(item."scopeType", ''), 'global') as scope_type,
        coalesce(nullif(item."scopeId", ''), '*') as scope_id
      from jsonb_to_recordset(coalesce(p_proposed_grants, '[]'::jsonb)) item(
        "permissionCode" text,
        "scopeType" text,
        "scopeId" text
      )
    ),
    current_points as (
      select distinct source_row.scope_type, source_row.scope_id
      from app_private.resolve_effective_permission_sources(
        p_target_user_id, null, null, null, now()
      ) source_row
    ),
    candidate_points as (
      select distinct proposed_row.scope_type, proposed_row.scope_id
      from proposed proposed_row
      union
      select distinct current_row.scope_type, current_row.scope_id
      from current_points current_row
      where exists (
        select 1
        from proposed proposed_row
        where app_private.scope_covers(
          proposed_row.scope_type,
          proposed_row.scope_id,
          current_row.scope_type,
          current_row.scope_id
        )
      )
    ),
    point_permissions as (
      select
        point_row.scope_type,
        point_row.scope_id,
        array_agg(distinct proposed_row.permission_code order by proposed_row.permission_code) as permission_codes
      from candidate_points point_row
      join proposed proposed_row
        on app_private.scope_covers(
          proposed_row.scope_type,
          proposed_row.scope_id,
          point_row.scope_type,
          point_row.scope_id
        )
      group by point_row.scope_type, point_row.scope_id
    ),
    decisions as (
      select
        point_row.scope_type,
        point_row.scope_id,
        app_private.evaluate_authorization_change(
          p_actor_user_id,
          p_target_user_id,
          point_row.permission_codes,
          point_row.scope_type,
          point_row.scope_id,
          p_change_mode
        ) as decision
      from point_permissions point_row
    ),
    findings as (
      select 'DENY'::text as effect, finding.value as finding
      from decisions decision_row
      cross join lateral jsonb_array_elements(decision_row.decision -> 'hardDenies') finding
      union all
      select 'WARN'::text as effect, finding.value as finding
      from decisions decision_row
      cross join lateral jsonb_array_elements(decision_row.decision -> 'warnings') finding
    ),
    deduplicated as (
      select distinct on (
        finding_row.effect,
        finding_row.finding ->> 'ruleCode',
        finding_row.finding ->> 'scopeType',
        finding_row.finding ->> 'scopeId'
      )
        finding_row.effect,
        finding_row.finding
      from findings finding_row
      order by
        finding_row.effect,
        finding_row.finding ->> 'ruleCode',
        finding_row.finding ->> 'scopeType',
        finding_row.finding ->> 'scopeId'
    ),
    unsuppressed as (
      select candidate.effect, candidate.finding
      from deduplicated candidate
      where not exists (
        select 1
        from deduplicated broader
        where broader.effect = candidate.effect
          and broader.finding ->> 'ruleCode' = candidate.finding ->> 'ruleCode'
          and broader.finding is distinct from candidate.finding
          and (
            (
              broader.finding ->> 'scopeType' = 'global'
              and broader.finding ->> 'scopeId' = '*'
            )
            or (
              broader.finding ->> 'scopeType' = candidate.finding ->> 'scopeType'
              and broader.finding ->> 'scopeId' = '*'
              and candidate.finding ->> 'scopeId' <> '*'
            )
          )
      )
    )
    select jsonb_build_object(
      'hardDenies', coalesce(
        jsonb_agg(finding order by finding ->> 'ruleCode', finding ->> 'scopeType', finding ->> 'scopeId')
          filter (where effect = 'DENY'),
        '[]'::jsonb
      ),
      'warnings', coalesce(
        jsonb_agg(finding order by finding ->> 'ruleCode', finding ->> 'scopeType', finding ->> 'scopeId')
          filter (where effect = 'WARN'),
        '[]'::jsonb
      )
    )
    from unsuppressed
  );
end;
$$;

revoke all on function app_private.evaluate_authorization_change_set(uuid,uuid,jsonb,text)
  from public, anon, authenticated;

create or replace function public.preview_authorization_change(
  p_target_user_id uuid,
  p_proposed_permission_codes text[],
  p_scope_type text default 'global',
  p_scope_id text default '*',
  p_change_mode text default 'ADD'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not app_private.has_any_permission(
    v_actor_user_id,
    array['system.authorization.manage_roles','system.authorization.manage_grants'],
    'global', '*'
  ) then
    raise exception 'Not allowed to preview authorization changes' using errcode = '42501';
  end if;
  return app_private.evaluate_authorization_change(
    v_actor_user_id,
    p_target_user_id,
    p_proposed_permission_codes,
    coalesce(nullif(p_scope_type, ''), 'global'),
    coalesce(nullif(p_scope_id, ''), '*'),
    p_change_mode
  );
end;
$$;

revoke all on function public.preview_authorization_change(uuid,text[],text,text,text)
  from public, anon;
grant execute on function public.preview_authorization_change(uuid,text[],text,text,text)
  to authenticated;

create or replace function app_private.assert_subject_sod(
  p_rule_code text,
  p_actor_user_id uuid,
  p_creator_user_id uuid,
  p_submitter_user_id uuid,
  p_executor_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.authorization_sod_rules%rowtype;
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
  then
    raise exception 'Active workflow actor required' using errcode = '42501';
  end if;

  select * into v_rule
  from public.authorization_sod_rules
  where rule_code = p_rule_code
    and is_active
    and effect = 'DENY'
    and rule_type = 'SUBJECT_RELATION';

  if v_rule.rule_code is null then
    raise exception 'Unknown hard SoD rule' using errcode = '22023';
  end if;

  if p_rule_code = 'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL'
    and p_actor_user_id is not null
    and p_actor_user_id in (p_creator_user_id, p_submitter_user_id)
  then
    raise exception 'Maker-checker separation required' using errcode = '42501';
  end if;

  if p_rule_code = 'PAYMENT_EXECUTOR_FINAL_APPROVAL'
    and p_actor_user_id is not null
    and p_actor_user_id = p_executor_user_id
  then
    raise exception 'Payment executor cannot final-approve the same payment' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_subject_sod(text,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
