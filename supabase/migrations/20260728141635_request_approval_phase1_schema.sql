-- Request approval phase 1: versioned templates, workflow-backed instances,
-- private command support, and the read-only RLS boundary.

create extension if not exists pgcrypto;
create schema if not exists app_private;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create table if not exists public.request_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  lifecycle_status text not null default 'DRAFT',
  current_version_id uuid,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.request_template_versions (
  id uuid primary key default gen_random_uuid(),
  request_template_id uuid not null
    references public.request_templates(id) on delete cascade,
  version_number integer not null,
  workflow_template_version_id uuid
    references public.workflow_template_versions(id) on delete set null,
  form_schema jsonb not null default '[]'::jsonb,
  usage_scope jsonb not null default jsonb_build_object(
    'companyWide', false,
    'departmentIds', '[]'::jsonb,
    'orgUnitIds', '[]'::jsonb,
    'permissionCodes', '[]'::jsonb,
    'userIds', '[]'::jsonb
  ),
  flow_mode text not null default 'SEQUENTIAL',
  completion_policy text not null default 'ALL',
  request_sla_hours numeric,
  print_config jsonb not null default '{}'::jsonb,
  notification_config jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT',
  created_by uuid not null references public.users(id),
  published_by uuid references public.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_template_id, version_number)
);

create table if not exists public.request_approval_blocks (
  id uuid primary key default gen_random_uuid(),
  request_template_version_id uuid not null
    references public.request_template_versions(id) on delete cascade,
  block_key text not null,
  name text not null,
  sort_order integer not null,
  approver_source text not null,
  fixed_user_ids uuid[] not null default '{}'::uuid[],
  minimum_dynamic_approvers integer,
  sla_hours numeric,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (request_template_version_id, block_key)
);

create table if not exists public.request_template_watchers (
  request_template_version_id uuid not null
    references public.request_template_versions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_template_version_id, user_id)
);

create table if not exists public.request_sequence_counters (
  year integer primary key,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.request_instances
  add column if not exists request_template_id uuid,
  add column if not exists request_template_version_id uuid,
  add column if not exists workflow_template_version_id uuid,
  add column if not exists workflow_instance_id uuid,
  add column if not exists workflow_subject_id uuid,
  add column if not exists form_schema_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists approval_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists print_config_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists due_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Phase 1 requests no longer use the legacy category relation. Relaxing this
-- constraint preserves every legacy value while allowing workflow-backed rows.
alter table public.request_instances
  alter column category_id drop not null;

alter table public.request_print_templates
  add column if not exists request_template_version_id uuid,
  add column if not exists validation_status text not null default 'PENDING',
  add column if not exists placeholder_schema jsonb not null default '{}'::jsonb;

-- Version-owned DOCX metadata is derived from the canonical storage path and
-- does not require the legacy category/name/file columns.
alter table public.request_print_templates
  alter column category_id drop not null,
  alter column name drop not null,
  alter column file_name drop not null,
  alter column storage_path drop not null;

alter table public.workflow_step_assignments
  add column if not exists assignment_round_id uuid;

do $request_foreign_keys$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_templates'::regclass
      and conname = 'request_templates_current_version_id_fkey'
  ) then
    alter table public.request_templates
      add constraint request_templates_current_version_id_fkey
      foreign key (current_version_id)
      references public.request_template_versions(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_instances'::regclass
      and conname = 'request_instances_request_template_id_fkey'
  ) then
    alter table public.request_instances
      add constraint request_instances_request_template_id_fkey
      foreign key (request_template_id)
      references public.request_templates(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_instances'::regclass
      and conname = 'request_instances_request_template_version_id_fkey'
  ) then
    alter table public.request_instances
      add constraint request_instances_request_template_version_id_fkey
      foreign key (request_template_version_id)
      references public.request_template_versions(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_instances'::regclass
      and conname = 'request_instances_workflow_template_version_id_fkey'
  ) then
    alter table public.request_instances
      add constraint request_instances_workflow_template_version_id_fkey
      foreign key (workflow_template_version_id)
      references public.workflow_template_versions(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_instances'::regclass
      and conname = 'request_instances_workflow_instance_id_fkey'
  ) then
    alter table public.request_instances
      add constraint request_instances_workflow_instance_id_fkey
      foreign key (workflow_instance_id)
      references public.workflow_instances(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_instances'::regclass
      and conname = 'request_instances_workflow_subject_id_fkey'
  ) then
    alter table public.request_instances
      add constraint request_instances_workflow_subject_id_fkey
      foreign key (workflow_subject_id)
      references public.workflow_subjects(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.request_print_templates'::regclass
      and conname = 'request_print_templates_request_template_version_id_fkey'
  ) then
    alter table public.request_print_templates
      add constraint request_print_templates_request_template_version_id_fkey
      foreign key (request_template_version_id)
      references public.request_template_versions(id)
      on delete cascade;
  end if;
end
$request_foreign_keys$;

create table if not exists app_private.request_command_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(id) on delete cascade,
  idempotency_key text not null,
  command_name text not null,
  request_id uuid references public.request_instances(id) on delete cascade,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (actor_id, idempotency_key)
);

create table if not exists app_private.request_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  request_id uuid not null
    references public.request_instances(id) on delete cascade,
  recipient_user_id uuid not null
    references public.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.request_export_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null
    references public.request_instances(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  format text not null,
  request_template_version_id uuid
    references public.request_template_versions(id) on delete set null,
  result text not null,
  error_message text,
  client_action_id uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_id, client_action_id)
);

do $request_check_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_templates'::regclass
      and conname = 'request_templates_lifecycle_status_check'
  ) then
    alter table public.request_templates
      add constraint request_templates_lifecycle_status_check
      check (lifecycle_status in ('DRAFT', 'PUBLISHED', 'DEACTIVATED'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_version_number_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_version_number_check
      check (version_number > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_form_schema_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_form_schema_check
      check (jsonb_typeof(form_schema) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_usage_scope_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_usage_scope_check
      check (jsonb_typeof(usage_scope) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_flow_mode_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_flow_mode_check
      check (flow_mode in ('SEQUENTIAL', 'PARALLEL'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_completion_policy_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_completion_policy_check
      check (completion_policy in ('ALL', 'ANY_ONE'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_sla_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_sla_check
      check (request_sla_hours is null or request_sla_hours >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_template_versions'::regclass
      and conname = 'request_template_versions_status_check'
  ) then
    alter table public.request_template_versions
      add constraint request_template_versions_status_check
      check (status in ('DRAFT', 'PUBLISHED', 'SUPERSEDED'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_approval_blocks'::regclass
      and conname = 'request_approval_blocks_sort_order_check'
  ) then
    alter table public.request_approval_blocks
      add constraint request_approval_blocks_sort_order_check
      check (sort_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_approval_blocks'::regclass
      and conname = 'request_approval_blocks_approver_source_check'
  ) then
    alter table public.request_approval_blocks
      add constraint request_approval_blocks_approver_source_check
      check (
        approver_source in (
          'FIXED_SINGLE',
          'FIXED_MULTI',
          'DIRECT_MANAGER',
          'DYNAMIC_CREATOR_SELECT'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_approval_blocks'::regclass
      and conname = 'request_approval_blocks_dynamic_minimum_check'
  ) then
    alter table public.request_approval_blocks
      add constraint request_approval_blocks_dynamic_minimum_check
      check (
        minimum_dynamic_approvers is null
        or minimum_dynamic_approvers > 0
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_approval_blocks'::regclass
      and conname = 'request_approval_blocks_sla_check'
  ) then
    alter table public.request_approval_blocks
      add constraint request_approval_blocks_sla_check
      check (sla_hours is null or sla_hours >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_sequence_counters'::regclass
      and conname = 'request_sequence_counters_year_check'
  ) then
    alter table public.request_sequence_counters
      add constraint request_sequence_counters_year_check
      check (year between 2000 and 9999);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_sequence_counters'::regclass
      and conname = 'request_sequence_counters_last_value_check'
  ) then
    alter table public.request_sequence_counters
      add constraint request_sequence_counters_last_value_check
      check (last_value >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_print_templates'::regclass
      and conname = 'request_print_templates_validation_status_check'
  ) then
    alter table public.request_print_templates
      add constraint request_print_templates_validation_status_check
      check (validation_status in ('PENDING', 'VALID', 'INVALID'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.request_notification_outbox'::regclass
      and conname = 'request_notification_outbox_status_check'
  ) then
    alter table app_private.request_notification_outbox
      add constraint request_notification_outbox_status_check
      check (status in ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.request_notification_outbox'::regclass
      and conname = 'request_notification_outbox_attempt_count_check'
  ) then
    alter table app_private.request_notification_outbox
      add constraint request_notification_outbox_attempt_count_check
      check (attempt_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.request_export_audit'::regclass
      and conname = 'request_export_audit_format_check'
  ) then
    alter table app_private.request_export_audit
      add constraint request_export_audit_format_check
      check (format in ('PRINT', 'PDF', 'WORD'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app_private.request_export_audit'::regclass
      and conname = 'request_export_audit_result_check'
  ) then
    alter table app_private.request_export_audit
      add constraint request_export_audit_result_check
      check (result in ('SUCCEEDED', 'FAILED'));
  end if;
end
$request_check_constraints$;

do $request_shared_workflow_checks$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.workflow_subjects'::regclass
      and conname = 'workflow_subjects_subject_type_check'
  ) then
    alter table public.workflow_subjects
      drop constraint workflow_subjects_subject_type_check;
  end if;

  alter table public.workflow_subjects
    add constraint workflow_subjects_subject_type_check
    check (
      subject_type in (
        'material_request',
        'custom_material_request',
        'request'
      )
    );

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.workflow_step_assignments'::regclass
      and conname = 'workflow_step_assignments_status_check'
  ) then
    alter table public.workflow_step_assignments
      drop constraint workflow_step_assignments_status_check;
  end if;

  alter table public.workflow_step_assignments
    add constraint workflow_step_assignments_status_check
    check (
      status in (
        'PENDING',
        'APPROVED',
        'RETURNED',
        'REJECTED',
        'SKIPPED',
        'CANCELLED'
      )
    );

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.request_instances'::regclass
      and conname = 'request_instances_status_check'
  ) then
    alter table public.request_instances
      drop constraint request_instances_status_check;
  end if;

  alter table public.request_instances
    add constraint request_instances_status_check
    check (
      status in (
        'DRAFT',
        'PENDING',
        'RETURNED',
        'APPROVED',
        'REJECTED',
        'CANCELLED',
        'IN_PROGRESS',
        'DONE'
      )
    );
end
$request_shared_workflow_checks$;

create unique index if not exists ux_request_instances_code
  on public.request_instances(code);
create index if not exists idx_request_instances_created_cursor
  on public.request_instances(created_at desc, id desc);
create index if not exists idx_request_instances_status_cursor
  on public.request_instances(status, created_at desc, id desc);
create index if not exists idx_request_instances_pending_due
  on public.request_instances(due_at, id)
  where status = 'PENDING' and due_at is not null;
create index if not exists idx_request_instances_creator_cursor
  on public.request_instances(created_by, created_at desc, id desc);
create index if not exists idx_request_instances_request_template
  on public.request_instances(request_template_id);
create index if not exists idx_request_instances_request_template_version
  on public.request_instances(request_template_version_id);
create index if not exists idx_request_instances_workflow_template_version
  on public.request_instances(workflow_template_version_id);
create unique index if not exists ux_request_instances_workflow_instance
  on public.request_instances(workflow_instance_id)
  where workflow_instance_id is not null;
create unique index if not exists ux_request_instances_workflow_subject
  on public.request_instances(workflow_subject_id)
  where workflow_subject_id is not null;

create index if not exists idx_request_templates_created_by
  on public.request_templates(created_by);
create index if not exists idx_request_templates_current_version
  on public.request_templates(current_version_id)
  where current_version_id is not null;
create index if not exists idx_request_template_versions_template
  on public.request_template_versions(request_template_id, version_number desc);
create index if not exists idx_request_template_versions_workflow_version
  on public.request_template_versions(workflow_template_version_id)
  where workflow_template_version_id is not null;
create index if not exists idx_request_template_versions_created_by
  on public.request_template_versions(created_by);
create index if not exists idx_request_template_versions_published_by
  on public.request_template_versions(published_by)
  where published_by is not null;
create index if not exists idx_request_blocks_version_order
  on public.request_approval_blocks(request_template_version_id, sort_order);
create index if not exists idx_request_template_watchers_user
  on public.request_template_watchers(user_id, request_template_version_id);
create index if not exists idx_request_template_scope_gin
  on public.request_template_versions using gin(usage_scope jsonb_path_ops);
create index if not exists idx_request_print_templates_version
  on public.request_print_templates(request_template_version_id)
  where request_template_version_id is not null;

create index if not exists idx_request_idempotency_request
  on app_private.request_command_idempotency(request_id)
  where request_id is not null;
create index if not exists idx_request_idempotency_actor
  on app_private.request_command_idempotency(actor_id, created_at desc);
create index if not exists idx_request_outbox_recipient_pending
  on app_private.request_notification_outbox(recipient_user_id, available_at, id)
  where status in ('PENDING', 'FAILED');
create index if not exists idx_request_outbox_recipient
  on app_private.request_notification_outbox(recipient_user_id);
create index if not exists idx_request_outbox_request
  on app_private.request_notification_outbox(request_id, created_at desc);
create index if not exists idx_request_export_audit_request
  on app_private.request_export_audit(request_id, created_at desc);
create index if not exists idx_request_export_audit_template_version
  on app_private.request_export_audit(request_template_version_id)
  where request_template_version_id is not null;

create index if not exists idx_workflow_participants_request_visibility
  on public.workflow_participants(user_id, workflow_subject_id)
  where role in ('ASSIGNEE', 'WATCHER');
create index if not exists idx_workflow_assignments_request_visibility
  on public.workflow_step_assignments(assignee_user_id, workflow_subject_id)
  where assignee_user_id is not null;
create index if not exists idx_workflow_step_assignments_round
  on public.workflow_step_assignments(workflow_subject_id, assignment_round_id)
  where assignment_round_id is not null;

create or replace function app_private.set_request_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.set_request_updated_at()
  from public, anon, authenticated;

drop trigger if exists request_templates_set_updated_at
  on public.request_templates;
create trigger request_templates_set_updated_at
before update on public.request_templates
for each row execute function app_private.set_request_updated_at();

drop trigger if exists request_template_versions_set_updated_at
  on public.request_template_versions;
create trigger request_template_versions_set_updated_at
before update on public.request_template_versions
for each row execute function app_private.set_request_updated_at();

drop trigger if exists request_notification_outbox_set_updated_at
  on app_private.request_notification_outbox;
create trigger request_notification_outbox_set_updated_at
before update on app_private.request_notification_outbox
for each row execute function app_private.set_request_updated_at();

create or replace function app_private.request_user_can_manage(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
      and app_private.has_permission(
        p_user_id,
        'request.template.manage',
        'global',
        '*'
      )
  );
$$;

create or replace function app_private.request_template_version_can_use(
  p_request_template_version_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.request_template_versions version
    join public.users app_user
      on app_user.id = p_user_id
     and coalesce(app_user.is_active, true)
     and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    where version.id = p_request_template_version_id
      and (
        version.usage_scope @> '{"companyWide": true}'::jsonb
        or version.usage_scope @> jsonb_build_object(
          'userIds',
          jsonb_build_array(p_user_id::text)
        )
        or exists (
          select 1
          from public.employees employee
          where employee.user_id = p_user_id
            and (
              (
                employee.department_id is not null
                and version.usage_scope @> jsonb_build_object(
                  'departmentIds',
                  jsonb_build_array(employee.department_id::text)
                )
              )
              or (
                employee.org_unit_id is not null
                and version.usage_scope @> jsonb_build_object(
                  'orgUnitIds',
                  jsonb_build_array(employee.org_unit_id::text)
                )
              )
            )
        )
        or exists (
          select 1
          from public.user_permission_grants permission_grant
          where permission_grant.user_id = p_user_id
            and coalesce(permission_grant.is_active, false)
            and (
              permission_grant.expires_at is null
              or permission_grant.expires_at > now()
            )
            and version.usage_scope @> jsonb_build_object(
              'permissionCodes',
              jsonb_build_array(permission_grant.permission_code)
            )
        )
      )
  );
$$;

create or replace function app_private.request_template_version_can_select(
  p_request_template_version_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.request_user_can_manage(p_user_id)
    or exists (
      select 1
      from public.request_template_versions version
      join public.request_templates template
        on template.id = version.request_template_id
      where version.id = p_request_template_version_id
        and template.lifecycle_status = 'PUBLISHED'
        and version.status in ('PUBLISHED', 'SUPERSEDED')
        and app_private.request_template_version_can_use(
          version.id,
          p_user_id
        )
    );
$$;

create or replace function app_private.request_template_can_select(
  p_request_template_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.request_user_can_manage(p_user_id)
    or exists (
      select 1
      from public.request_templates template
      join public.request_template_versions version
        on version.id = template.current_version_id
      where template.id = p_request_template_id
        and template.lifecycle_status = 'PUBLISHED'
        and version.status = 'PUBLISHED'
        and app_private.request_template_version_can_use(
          version.id,
          p_user_id
        )
    );
$$;

create or replace function app_private.request_instance_can_select(
  p_request_instance_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  )
  and (
    app_private.request_user_can_manage(p_user_id)
    or exists (
      select 1
      from public.request_instances request_instance
      where request_instance.id = p_request_instance_id
        and (
          request_instance.created_by = p_user_id
          or exists (
            select 1
            from public.workflow_participants participant
            where participant.workflow_subject_id =
              request_instance.workflow_subject_id
              and participant.user_id = p_user_id
              and participant.role in ('ASSIGNEE', 'WATCHER')
          )
          or exists (
            select 1
            from public.workflow_step_assignments assignment
            where assignment.workflow_subject_id =
              request_instance.workflow_subject_id
              and assignment.assignee_user_id = p_user_id
          )
          or exists (
            select 1
            from public.request_template_watchers watcher
            where watcher.request_template_version_id =
              request_instance.request_template_version_id
              and watcher.user_id = p_user_id
          )
          or (
            request_instance.workflow_subject_id is null
            and request_instance.request_template_version_id is null
            and (
              request_instance.assigned_to::text = p_user_id::text
              or request_instance.approver_id::text = p_user_id::text
              or exists (
                select 1
                from jsonb_array_elements(
                  case
                    when jsonb_typeof(request_instance.approvers) = 'array'
                    then request_instance.approvers
                    else '[]'::jsonb
                  end
                ) legacy_approver
                where legacy_approver ->> 'userId' = p_user_id::text
              )
            )
          )
        )
    )
  );
$$;

create or replace function app_private.request_print_template_can_select(
  p_request_print_template_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.request_user_can_manage(p_user_id)
    or exists (
      select 1
      from public.request_print_templates print_template
      join public.request_instances request_instance
        on request_instance.request_template_version_id =
          print_template.request_template_version_id
      where print_template.id = p_request_print_template_id
        and app_private.request_instance_can_select(
          request_instance.id,
          p_user_id
        )
    );
$$;

create or replace function app_private.request_template_docx_version_id(
  p_object_name text
)
returns uuid
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_object_name ~
      '^request-template-versions/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/template[.]docx$'
    then split_part(p_object_name, '/', 2)::uuid
    else null
  end;
$$;

create or replace function app_private.request_template_docx_can_manage(
  p_object_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.request_user_can_manage(p_user_id)
    and exists (
      select 1
      from public.request_template_versions version
      where version.id =
        app_private.request_template_docx_version_id(p_object_name)
        and version.status = 'DRAFT'
    );
$$;

create or replace function app_private.request_template_docx_can_select(
  p_object_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.request_template_versions version
    where version.id =
      app_private.request_template_docx_version_id(p_object_name)
      and (
        app_private.request_user_can_manage(p_user_id)
        or exists (
          select 1
          from public.request_instances request_instance
          where request_instance.request_template_version_id = version.id
            and app_private.request_instance_can_select(
              request_instance.id,
              p_user_id
            )
        )
      )
  );
$$;

revoke all on function app_private.request_user_can_manage(uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_template_version_can_use(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_template_version_can_select(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_template_can_select(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_instance_can_select(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_print_template_can_select(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_template_docx_version_id(text)
  from public, anon, authenticated;
revoke all on function app_private.request_template_docx_can_manage(text, uuid)
  from public, anon, authenticated;
revoke all on function app_private.request_template_docx_can_select(text, uuid)
  from public, anon, authenticated;

grant execute on function app_private.request_user_can_manage(uuid)
  to authenticated;
grant execute on function app_private.request_template_version_can_use(uuid, uuid)
  to authenticated;
grant execute on function app_private.request_template_version_can_select(uuid, uuid)
  to authenticated;
grant execute on function app_private.request_template_can_select(uuid, uuid)
  to authenticated;
grant execute on function app_private.request_instance_can_select(uuid, uuid)
  to authenticated;
grant execute on function app_private.request_print_template_can_select(uuid, uuid)
  to authenticated;
grant execute on function app_private.request_template_docx_version_id(text)
  to authenticated;
grant execute on function app_private.request_template_docx_can_manage(text, uuid)
  to authenticated;
grant execute on function app_private.request_template_docx_can_select(text, uuid)
  to authenticated;

alter table public.request_templates enable row level security;
alter table public.request_template_versions enable row level security;
alter table public.request_approval_blocks enable row level security;
alter table public.request_template_watchers enable row level security;
alter table public.request_sequence_counters enable row level security;
alter table public.request_instances enable row level security;
alter table public.request_print_templates enable row level security;
alter table app_private.request_command_idempotency enable row level security;
alter table app_private.request_notification_outbox enable row level security;
alter table app_private.request_export_audit enable row level security;

do $request_remove_old_policies$
declare
  policy_record record;
begin
  for policy_record in
    select
      namespace.nspname as schema_name,
      class.relname as table_name,
      policy.polname as policy_name
    from pg_policy policy
    join pg_class class on class.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in (
        'request_templates',
        'request_template_versions',
        'request_approval_blocks',
        'request_template_watchers',
        'request_sequence_counters',
        'request_instances',
        'request_print_templates'
      )
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_record.policy_name,
      policy_record.schema_name,
      policy_record.table_name
    );
  end loop;
end
$request_remove_old_policies$;

create policy request_templates_select
on public.request_templates
for select
to authenticated
using (
  app_private.request_template_can_select(
    id,
    (select public.current_app_user_id())
  )
);

create policy request_template_versions_select
on public.request_template_versions
for select
to authenticated
using (
  app_private.request_template_version_can_select(
    id,
    (select public.current_app_user_id())
  )
);

create policy request_approval_blocks_select
on public.request_approval_blocks
for select
to authenticated
using (
  app_private.request_template_version_can_select(
    request_template_version_id,
    (select public.current_app_user_id())
  )
);

create policy request_template_watchers_select
on public.request_template_watchers
for select
to authenticated
using (
  app_private.request_template_version_can_select(
    request_template_version_id,
    (select public.current_app_user_id())
  )
);

create policy request_instance_can_select
on public.request_instances
for select
to authenticated
using (
  app_private.request_instance_can_select(
    id,
    (select public.current_app_user_id())
  )
);

create policy request_print_templates_select
on public.request_print_templates
for select
to authenticated
using (
  app_private.request_print_template_can_select(
    id,
    (select public.current_app_user_id())
  )
);

revoke all privileges on table
  public.request_templates,
  public.request_template_versions,
  public.request_approval_blocks,
  public.request_template_watchers,
  public.request_sequence_counters,
  public.request_instances,
  public.request_print_templates
from public, anon;

revoke all privileges on table
  public.request_templates,
  public.request_template_versions,
  public.request_approval_blocks,
  public.request_template_watchers,
  public.request_sequence_counters,
  public.request_instances,
  public.request_print_templates
from authenticated;

revoke insert, update, delete on table
  public.request_templates,
  public.request_template_versions,
  public.request_approval_blocks,
  public.request_template_watchers,
  public.request_sequence_counters,
  public.request_instances,
  public.request_print_templates
from authenticated;

grant select on table
  public.request_templates,
  public.request_template_versions,
  public.request_approval_blocks,
  public.request_template_watchers,
  public.request_sequence_counters,
  public.request_instances,
  public.request_print_templates
to authenticated;

revoke all privileges on table
  app_private.request_command_idempotency,
  app_private.request_notification_outbox,
  app_private.request_export_audit
from public, anon, authenticated;

insert into storage.buckets (id, name, public)
values ('workflow-templates', 'workflow-templates', false)
on conflict (id) do update
set public = false;

drop policy if exists request_template_docx_insert on storage.objects;
drop policy if exists request_template_docx_update on storage.objects;
drop policy if exists request_template_docx_select on storage.objects;
drop policy if exists request_template_docx_insert_gate on storage.objects;
drop policy if exists request_template_docx_update_gate on storage.objects;
drop policy if exists request_template_docx_select_gate on storage.objects;
drop policy if exists request_template_docx_delete_gate on storage.objects;
drop policy if exists request_template_docx_delete on storage.objects;

-- Storage policies are permissive by default. These restrictive gates prevent
-- any broader legacy workflow-template policy from exposing the request path.
create policy request_template_docx_insert_gate
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id <> 'workflow-templates'
  or name not like 'request-template-versions/%'
  or app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_update_gate
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id <> 'workflow-templates'
  or name not like 'request-template-versions/%'
  or app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
)
with check (
  bucket_id <> 'workflow-templates'
  or name not like 'request-template-versions/%'
  or app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_select_gate
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id <> 'workflow-templates'
  or name not like 'request-template-versions/%'
  or app_private.request_template_docx_can_select(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_delete_gate
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id <> 'workflow-templates'
  or name not like 'request-template-versions/%'
  or app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workflow-templates'
  and app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'workflow-templates'
  and app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
)
with check (
  bucket_id = 'workflow-templates'
  and app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workflow-templates'
  and app_private.request_template_docx_can_select(
    name,
    (select public.current_app_user_id())
  )
);

create policy request_template_docx_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'workflow-templates'
  and app_private.request_template_docx_can_manage(
    name,
    (select public.current_app_user_id())
  )
);
