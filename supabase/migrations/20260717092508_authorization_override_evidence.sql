-- Phase 2 controlled, idempotent authorization override evidence.

create table public.authorization_override_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  rule_code text not null
    references public.authorization_sod_rules(rule_code) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id text not null,
  scope_type text not null
    check (scope_type in (
      'global','own','assigned','project','construction_site','warehouse','department'
    )),
  scope_id text not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  control_owner_user_id uuid not null references public.users(id) on delete restrict,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  revoked_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index authorization_override_subject_effective_idx
  on public.authorization_override_events (
    rule_code,
    subject_type,
    subject_id,
    actor_user_id,
    starts_at,
    expires_at
  ) where revoked_at is null;

create index authorization_override_owner_idx
  on public.authorization_override_events (control_owner_user_id, created_at desc);

alter table public.authorization_override_events enable row level security;

revoke all privileges on table public.authorization_override_events
  from public, anon, authenticated;
grant select on table public.authorization_override_events to authenticated;

create policy authorization_override_authorized_select
on public.authorization_override_events for select
to authenticated
using (
  actor_user_id = (select public.current_app_user_id())
  or control_owner_user_id = (select public.current_app_user_id())
  or (select app_private.has_permission(
    public.current_app_user_id(),
    'system.authorization.audit',
    'global',
    '*'
  ))
);

create or replace function app_private.record_authorization_override_impl(
  p_rule_code text,
  p_subject_type text,
  p_subject_id text,
  p_scope_type text,
  p_scope_id text,
  p_reason text,
  p_control_owner_user_id uuid,
  p_expires_at timestamptz,
  p_idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_rule_code text := btrim(coalesce(p_rule_code, ''));
  v_subject_type text := btrim(coalesce(p_subject_type, ''));
  v_subject_id text := btrim(coalesce(p_subject_id, ''));
  v_scope_type text := coalesce(
    nullif(btrim(coalesce(p_scope_type, '')), ''),
    'global'
  );
  v_scope_id text := coalesce(
    nullif(btrim(coalesce(p_scope_id, '')), ''),
    '*'
  );
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing public.authorization_override_events%rowtype;
  v_rule public.authorization_sod_rules%rowtype;
  v_override_id uuid := gen_random_uuid();
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.override'
  );

  if p_idempotency_key is null then
    raise exception 'Override idempotency key is required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'authorization_override:' || p_idempotency_key::text,
      0
    )
  );

  select *
  into v_existing
  from public.authorization_override_events
  where idempotency_key = p_idempotency_key
  for update;

  if v_existing.id is not null then
    if v_existing.actor_user_id <> v_actor_user_id
      or v_existing.rule_code <> v_rule_code
      or v_existing.subject_type <> v_subject_type
      or v_existing.subject_id <> v_subject_id
      or v_existing.scope_type <> v_scope_type
      or v_existing.scope_id <> v_scope_id
      or v_existing.reason <> v_reason
      or v_existing.control_owner_user_id <> p_control_owner_user_id
      or v_existing.expires_at <> p_expires_at
    then
      raise exception 'Idempotency key is already used for another override command'
        using errcode = '23505';
    end if;

    return v_existing.id;
  end if;

  select *
  into v_rule
  from public.authorization_sod_rules
  where rule_code = v_rule_code
    and is_active
    and effect = 'REQUIRE_OVERRIDE'
    and overridable
  for share;

  if v_rule.rule_code is null then
    raise exception 'Rule cannot be overridden'
      using errcode = '42501';
  end if;

  if v_subject_type !~ '^[a-z][a-z0-9_]*$'
    or v_rule.subject_type is distinct from v_subject_type
    or v_subject_id = ''
    or v_scope_type not in (
      'global','own','assigned','project','construction_site','warehouse','department'
    )
    or (v_scope_type = 'global' and v_scope_id <> '*')
    or (v_scope_type <> 'global' and v_scope_id = '')
    or char_length(v_reason) < 10
    or p_expires_at is null
    or p_expires_at <= now()
    or p_control_owner_user_id is null
    or p_control_owner_user_id = v_actor_user_id
    or not exists (
      select 1
      from public.users owner_row
      where owner_row.id = p_control_owner_user_id
        and owner_row.is_active
        and owner_row.account_status = 'ACTIVE'
        and app_private.has_permission(
          owner_row.id,
          'system.authorization.audit',
          'global',
          '*'
        )
    )
  then
    raise exception 'Invalid override control evidence'
      using errcode = '22023';
  end if;

  insert into public.authorization_override_events (
    id,
    idempotency_key,
    rule_code,
    actor_user_id,
    subject_type,
    subject_id,
    scope_type,
    scope_id,
    reason,
    control_owner_user_id,
    expires_at,
    metadata
  )
  values (
    v_override_id,
    p_idempotency_key,
    v_rule_code,
    v_actor_user_id,
    v_subject_type,
    v_subject_id,
    v_scope_type,
    v_scope_id,
    v_reason,
    p_control_owner_user_id,
    p_expires_at,
    jsonb_build_object('source', 'governed_authorization_override')
  );

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    v_actor_user_id,
    'authorization_override_recorded',
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'overrideId', v_override_id,
      'ruleCode', v_rule_code,
      'subjectType', v_subject_type,
      'scopeType', v_scope_type,
      'scopeId', v_scope_id,
      'controlOwnerUserId', p_control_owner_user_id,
      'expiresAt', p_expires_at,
      'reason', v_reason
    )
  );

  insert into public.notifications (
    user_id,
    type,
    category,
    title,
    message,
    icon,
    link,
    severity,
    source_type,
    source_id,
    priority,
    push_enabled,
    action_url,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_control_owner_user_id,
    'warning',
    'authorization',
    'Có override phân quyền cần giám sát',
    'Một ngoại lệ được kiểm soát vừa được ghi nhận. Mở quản trị phân quyền để xem chi tiết.',
    'shield-alert',
    '/settings',
    'warning',
    'authorization_override',
    v_override_id::text,
    'high',
    true,
    '/#/settings',
    'authorization_override',
    v_override_id,
    jsonb_build_object(
      'ruleCode', v_rule_code,
      'subjectType', v_subject_type
    )
  );

  return v_override_id;
end;
$$;

create or replace function public.record_authorization_override(
  p_rule_code text,
  p_subject_type text,
  p_subject_id text,
  p_scope_type text,
  p_scope_id text,
  p_reason text,
  p_control_owner_user_id uuid,
  p_expires_at timestamptz,
  p_idempotency_key uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.record_authorization_override_impl(
    p_rule_code,
    p_subject_type,
    p_subject_id,
    p_scope_type,
    p_scope_id,
    p_reason,
    p_control_owner_user_id,
    p_expires_at,
    p_idempotency_key
  );
$$;

create or replace function app_private.has_valid_authorization_override(
  p_override_id uuid,
  p_rule_code text,
  p_actor_user_id uuid,
  p_subject_type text,
  p_subject_id text,
  p_scope_type text,
  p_scope_id text,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.authorization_override_events override_row
    join public.authorization_sod_rules rule_row
      on rule_row.rule_code = override_row.rule_code
     and rule_row.effect = 'REQUIRE_OVERRIDE'
     and rule_row.overridable
     and rule_row.is_active
    where override_row.id = p_override_id
      and p_actor_user_id = public.current_app_user_id()
      and override_row.rule_code = p_rule_code
      and override_row.actor_user_id = p_actor_user_id
      and override_row.subject_type = p_subject_type
      and override_row.subject_id = p_subject_id
      and override_row.scope_type = coalesce(nullif(p_scope_type, ''), 'global')
      and override_row.scope_id = coalesce(nullif(p_scope_id, ''), '*')
      and override_row.revoked_at is null
      and override_row.starts_at <= p_at
      and override_row.expires_at > p_at
  );
$$;

revoke all on function app_private.record_authorization_override_impl(
  text,text,text,text,text,text,uuid,timestamptz,uuid
) from public, anon;
grant execute on function app_private.record_authorization_override_impl(
  text,text,text,text,text,text,uuid,timestamptz,uuid
) to authenticated;
revoke all on function public.record_authorization_override(
  text,text,text,text,text,text,uuid,timestamptz,uuid
) from public, anon;
grant execute on function public.record_authorization_override(
  text,text,text,text,text,text,uuid,timestamptz,uuid
) to authenticated;
revoke all on function app_private.has_valid_authorization_override(
  uuid,text,uuid,text,text,text,text,timestamptz
) from public, anon, authenticated;
