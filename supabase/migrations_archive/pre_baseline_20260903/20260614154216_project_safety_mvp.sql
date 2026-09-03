-- Project Safety MVP
-- Adds the DA/Safety tab data model with PBAC-based RLS and private Storage.

create schema if not exists app_private;

-- ─────────────────────────────────────────────────────────────
-- Helpers
-- ─────────────────────────────────────────────────────────────

create or replace function app_private.safety_can_view(
  p_project_id text,
  p_construction_site_id text,
  p_assigned_to_user_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or (
      p_assigned_to_user_id is not null
      and p_assigned_to_user_id = public.current_app_user_id()::text
    )
    or app_private.project_doc_can_view(p_project_id, p_construction_site_id, p_assigned_to_user_id),
    false
  );
$$;

create or replace function app_private.safety_can_submit(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit', public.current_app_user_id())
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit', public.current_app_user_id()),
    false
  );
$$;

create or replace function app_private.safety_can_manage(
  p_project_id text,
  p_construction_site_id text,
  p_assigned_to_user_id text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or (
      p_assigned_to_user_id is not null
      and p_assigned_to_user_id = public.current_app_user_id()::text
    )
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit', public.current_app_user_id())
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'verify', public.current_app_user_id())
    or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve', public.current_app_user_id()),
    false
  );
$$;

create or replace function app_private.safety_can_delete(
  p_project_id text,
  p_construction_site_id text,
  p_status text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or (
      coalesce(p_status, 'new') in ('draft', 'new')
      and app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'delete', public.current_app_user_id())
    ),
    false
  );
$$;

create or replace function app_private.set_safety_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Storage
-- ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-safety-attachments', 'project-safety-attachments', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

-- ─────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────

create table if not exists public.safety_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  code text not null,
  name text not null,
  description text,
  category text,
  risk_level text not null default 'medium'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  template_id uuid not null references public.safety_checklist_templates(id) on delete cascade,
  item_name text not null,
  description text,
  requirement text,
  default_risk_level text not null default 'medium'
    check (default_risk_level in ('low', 'medium', 'high', 'critical')),
  requires_photo boolean not null default false,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_workers (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  employee_id text,
  user_id text,
  team_id uuid,
  subcontractor_id uuid,
  full_name text not null,
  worker_code text,
  phone text,
  role_name text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  training_status text not null default 'not_trained'
    check (training_status in ('not_trained', 'trained', 'expired')),
  ppe_status text not null default 'missing'
    check (ppe_status in ('missing', 'partial', 'complete')),
  eligibility_status text not null default 'not_eligible'
    check (eligibility_status in ('eligible', 'not_eligible', 'suspended')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_teams (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  subcontractor_id uuid,
  code text,
  name text not null,
  supervisor_name text,
  supervisor_phone text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'suspended')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_subcontractors (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  name text not null,
  code text,
  representative_name text,
  representative_phone text,
  work_scope text,
  status text not null default 'pending_documents'
    check (status in ('pending_documents', 'approved', 'active', 'suspended', 'completed')),
  documents_status text not null default 'missing'
    check (documents_status in ('missing', 'partial', 'complete')),
  violation_count integer not null default 0,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_subcontractor_documents (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  subcontractor_id uuid not null references public.safety_subcontractors(id) on delete cascade,
  document_type text not null,
  name text not null,
  status text not null default 'missing'
    check (status in ('missing', 'submitted', 'approved', 'rejected', 'expired')),
  issue_date date,
  expiry_date date,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_equipment (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  subcontractor_id uuid references public.safety_subcontractors(id) on delete set null,
  owner_name text,
  equipment_code text,
  name text not null,
  model text,
  serial_number text,
  operator_worker_id uuid references public.safety_workers(id) on delete set null,
  operator_name text,
  inspection_expiry_date date,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'active', 'expired', 'suspended', 'removed')),
  documents_status text not null default 'missing'
    check (documents_status in ('missing', 'partial', 'complete')),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_equipment_documents (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  equipment_id uuid not null references public.safety_equipment(id) on delete cascade,
  document_type text not null,
  name text not null,
  status text not null default 'missing'
    check (status in ('missing', 'submitted', 'approved', 'rejected', 'expired')),
  issue_date date,
  expiry_date date,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_issues (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  code text not null,
  title text not null,
  type text not null default 'hazard'
    check (type in ('hazard', 'violation', 'near_miss', 'minor_incident', 'serious_incident', 'corrective_action')),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'new'
    check (status in ('new', 'assigned', 'in_progress', 'waiting_verification', 'resolved', 'closed', 'rejected', 'overdue')),
  area text,
  description text,
  before_photos jsonb not null default '[]'::jsonb check (jsonb_typeof(before_photos) = 'array'),
  after_photos jsonb not null default '[]'::jsonb check (jsonb_typeof(after_photos) = 'array'),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  assigned_to_user_id text,
  assigned_to_name text,
  due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  contractor_id uuid references public.safety_subcontractors(id) on delete set null,
  equipment_id uuid references public.safety_equipment(id) on delete set null,
  worker_id uuid references public.safety_workers(id) on delete set null,
  source_inspection_id uuid,
  source_inspection_item_id uuid,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, code)
);

create table if not exists public.safety_issue_comments (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  issue_id uuid not null references public.safety_issues(id) on delete cascade,
  body text not null,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_issue_status_logs (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  issue_id uuid not null references public.safety_issues(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.safety_inspections (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  code text not null,
  template_id uuid references public.safety_checklist_templates(id) on delete set null,
  inspection_date date not null default current_date,
  area text,
  inspector_user_id text,
  inspector_name text,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  summary text,
  score numeric(5,2),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, code)
);

create table if not exists public.safety_inspection_items (
  id uuid primary key default gen_random_uuid(),
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  inspection_id uuid not null references public.safety_inspections(id) on delete cascade,
  template_item_id uuid references public.safety_checklist_template_items(id) on delete set null,
  item_name text not null,
  requirement text,
  result text not null default 'na'
    check (result in ('pass', 'fail', 'na')),
  risk_level text not null default 'medium'
    check (risk_level in ('low', 'medium', 'high', 'critical')),
  note text,
  photos jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array'),
  assigned_to_user_id text,
  assigned_to_name text,
  due_at timestamptz,
  generated_issue_id uuid references public.safety_issues(id) on delete set null,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.safety_workers
  drop constraint if exists safety_workers_team_fk;

alter table public.safety_workers
  add constraint safety_workers_team_fk
  foreign key (team_id) references public.safety_teams(id) on delete set null;

alter table public.safety_workers
  drop constraint if exists safety_workers_subcontractor_fk;

alter table public.safety_workers
  add constraint safety_workers_subcontractor_fk
  foreign key (subcontractor_id) references public.safety_subcontractors(id) on delete set null;

alter table public.safety_teams
  drop constraint if exists safety_teams_subcontractor_fk;

alter table public.safety_teams
  add constraint safety_teams_subcontractor_fk
  foreign key (subcontractor_id) references public.safety_subcontractors(id) on delete set null;

alter table public.safety_issues
  drop constraint if exists safety_issues_source_inspection_fk;

alter table public.safety_issues
  add constraint safety_issues_source_inspection_fk
  foreign key (source_inspection_id) references public.safety_inspections(id) on delete set null;

alter table public.safety_issues
  drop constraint if exists safety_issues_source_inspection_item_fk;

alter table public.safety_issues
  add constraint safety_issues_source_inspection_item_fk
  foreign key (source_inspection_item_id) references public.safety_inspection_items(id) on delete set null;

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_safety_templates_project_created
  on public.safety_checklist_templates(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_template_items_template
  on public.safety_checklist_template_items(template_id, sort_order);
create index if not exists idx_safety_workers_project_created
  on public.safety_workers(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_workers_team
  on public.safety_workers(team_id);
create index if not exists idx_safety_workers_subcontractor
  on public.safety_workers(subcontractor_id);
create index if not exists idx_safety_teams_project_created
  on public.safety_teams(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_teams_subcontractor
  on public.safety_teams(subcontractor_id);
create index if not exists idx_safety_subcontractors_project_created
  on public.safety_subcontractors(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_subcontractors_project_status
  on public.safety_subcontractors(project_id, status);
create index if not exists idx_safety_subcontractor_documents_subcontractor
  on public.safety_subcontractor_documents(subcontractor_id);
create index if not exists idx_safety_equipment_project_created
  on public.safety_equipment(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_equipment_project_expiry
  on public.safety_equipment(project_id, inspection_expiry_date);
create index if not exists idx_safety_equipment_subcontractor
  on public.safety_equipment(subcontractor_id);
create index if not exists idx_safety_equipment_documents_equipment
  on public.safety_equipment_documents(equipment_id);
create index if not exists idx_safety_issues_project_created
  on public.safety_issues(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_issues_project_status_severity_due
  on public.safety_issues(project_id, status, severity, due_at);
create index if not exists idx_safety_issues_assigned
  on public.safety_issues(assigned_to_user_id, status, due_at)
  where assigned_to_user_id is not null;
create index if not exists idx_safety_issue_comments_issue
  on public.safety_issue_comments(issue_id, created_at);
create index if not exists idx_safety_issue_status_logs_issue
  on public.safety_issue_status_logs(issue_id, created_at desc);
create index if not exists idx_safety_inspections_project_created
  on public.safety_inspections(project_id, construction_site_id, created_at desc);
create index if not exists idx_safety_inspections_project_date
  on public.safety_inspections(project_id, inspection_date desc);
create index if not exists idx_safety_inspection_items_inspection
  on public.safety_inspection_items(inspection_id, sort_order);
create index if not exists idx_safety_inspection_items_generated_issue
  on public.safety_inspection_items(generated_issue_id)
  where generated_issue_id is not null;

-- ─────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'safety_checklist_templates',
    'safety_checklist_template_items',
    'safety_workers',
    'safety_teams',
    'safety_subcontractors',
    'safety_subcontractor_documents',
    'safety_equipment',
    'safety_equipment_documents',
    'safety_issues',
    'safety_issue_comments',
    'safety_inspections',
    'safety_inspection_items'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', tbl, tbl);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function app_private.set_safety_updated_at()',
      tbl,
      tbl
    );
  end loop;
end $$;

create or replace function app_private.log_safety_issue_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.safety_issue_status_logs(
      project_id,
      construction_site_id,
      issue_id,
      from_status,
      to_status,
      metadata,
      created_by
    )
    values (
      new.project_id,
      new.construction_site_id,
      new.id,
      null,
      new.status,
      jsonb_build_object('event', 'created'),
      coalesce(public.current_app_user_id()::text, new.created_by)
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.safety_issue_status_logs(
      project_id,
      construction_site_id,
      issue_id,
      from_status,
      to_status,
      metadata,
      created_by
    )
    values (
      new.project_id,
      new.construction_site_id,
      new.id,
      old.status,
      new.status,
      jsonb_build_object('event', 'status_changed'),
      coalesce(public.current_app_user_id()::text, new.created_by)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_safety_issue_status_log on public.safety_issues;
create trigger trg_safety_issue_status_log
after insert or update of status on public.safety_issues
for each row execute function app_private.log_safety_issue_status_change();

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'safety_checklist_templates',
    'safety_checklist_template_items',
    'safety_workers',
    'safety_teams',
    'safety_subcontractors',
    'safety_subcontractor_documents',
    'safety_equipment',
    'safety_equipment_documents',
    'safety_issues',
    'safety_issue_comments',
    'safety_issue_status_logs',
    'safety_inspections',
    'safety_inspection_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from anon', tbl);
    execute format('revoke all on table public.%I from public', tbl);
    execute format('revoke all on table public.%I from authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);
  end loop;
end $$;

-- Template metadata
drop policy if exists safety_checklist_templates_select on public.safety_checklist_templates;
create policy safety_checklist_templates_select
  on public.safety_checklist_templates for select to authenticated
  using (app_private.safety_can_view(project_id, construction_site_id, null));

drop policy if exists safety_checklist_templates_insert on public.safety_checklist_templates;
create policy safety_checklist_templates_insert
  on public.safety_checklist_templates for insert to authenticated
  with check (app_private.safety_can_submit(project_id, construction_site_id));

drop policy if exists safety_checklist_templates_update on public.safety_checklist_templates;
create policy safety_checklist_templates_update
  on public.safety_checklist_templates for update to authenticated
  using (app_private.safety_can_manage(project_id, construction_site_id, null))
  with check (app_private.safety_can_manage(project_id, construction_site_id, null));

drop policy if exists safety_checklist_templates_delete on public.safety_checklist_templates;
create policy safety_checklist_templates_delete
  on public.safety_checklist_templates for delete to authenticated
  using (app_private.safety_can_delete(project_id, construction_site_id, 'draft'));

drop policy if exists safety_checklist_template_items_select on public.safety_checklist_template_items;
create policy safety_checklist_template_items_select
  on public.safety_checklist_template_items for select to authenticated
  using (app_private.safety_can_view(project_id, construction_site_id, null));

drop policy if exists safety_checklist_template_items_insert on public.safety_checklist_template_items;
create policy safety_checklist_template_items_insert
  on public.safety_checklist_template_items for insert to authenticated
  with check (app_private.safety_can_submit(project_id, construction_site_id));

drop policy if exists safety_checklist_template_items_update on public.safety_checklist_template_items;
create policy safety_checklist_template_items_update
  on public.safety_checklist_template_items for update to authenticated
  using (app_private.safety_can_manage(project_id, construction_site_id, null))
  with check (app_private.safety_can_manage(project_id, construction_site_id, null));

drop policy if exists safety_checklist_template_items_delete on public.safety_checklist_template_items;
create policy safety_checklist_template_items_delete
  on public.safety_checklist_template_items for delete to authenticated
  using (app_private.safety_can_delete(project_id, construction_site_id, 'draft'));

-- Master/detail records without per-row assignee
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'safety_workers',
    'safety_teams',
    'safety_subcontractors',
    'safety_subcontractor_documents',
    'safety_equipment',
    'safety_equipment_documents'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_select', tbl);
    execute format(
      'create policy %I on public.%I for select to authenticated using (app_private.safety_can_view(project_id, construction_site_id, null))',
      tbl || '_select',
      tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app_private.safety_can_submit(project_id, construction_site_id))',
      tbl || '_insert',
      tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
    execute format(
      'create policy %I on public.%I for update to authenticated using (app_private.safety_can_manage(project_id, construction_site_id, null)) with check (app_private.safety_can_manage(project_id, construction_site_id, null))',
      tbl || '_update',
      tbl
    );

    execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (app_private.safety_can_delete(project_id, construction_site_id, status))',
      tbl || '_delete',
      tbl
    );
  end loop;
end $$;

-- Issues
drop policy if exists safety_issues_select on public.safety_issues;
create policy safety_issues_select
  on public.safety_issues for select to authenticated
  using (app_private.safety_can_view(project_id, construction_site_id, assigned_to_user_id));

drop policy if exists safety_issues_insert on public.safety_issues;
create policy safety_issues_insert
  on public.safety_issues for insert to authenticated
  with check (app_private.safety_can_submit(project_id, construction_site_id));

drop policy if exists safety_issues_update on public.safety_issues;
create policy safety_issues_update
  on public.safety_issues for update to authenticated
  using (app_private.safety_can_manage(project_id, construction_site_id, assigned_to_user_id))
  with check (app_private.safety_can_manage(project_id, construction_site_id, assigned_to_user_id));

drop policy if exists safety_issues_delete on public.safety_issues;
create policy safety_issues_delete
  on public.safety_issues for delete to authenticated
  using (app_private.safety_can_delete(project_id, construction_site_id, status));

-- Issue comments/logs inherit issue visibility.
drop policy if exists safety_issue_comments_select on public.safety_issue_comments;
create policy safety_issue_comments_select
  on public.safety_issue_comments for select to authenticated
  using (
    exists (
      select 1
      from public.safety_issues issue
      where issue.id = issue_id
        and app_private.safety_can_view(issue.project_id, issue.construction_site_id, issue.assigned_to_user_id)
    )
  );

drop policy if exists safety_issue_comments_insert on public.safety_issue_comments;
create policy safety_issue_comments_insert
  on public.safety_issue_comments for insert to authenticated
  with check (
    exists (
      select 1
      from public.safety_issues issue
      where issue.id = issue_id
        and app_private.safety_can_view(issue.project_id, issue.construction_site_id, issue.assigned_to_user_id)
    )
  );

drop policy if exists safety_issue_comments_update on public.safety_issue_comments;
create policy safety_issue_comments_update
  on public.safety_issue_comments for update to authenticated
  using (created_by = public.current_app_user_id()::text or public.is_admin() or public.is_module_admin('DA'))
  with check (created_by = public.current_app_user_id()::text or public.is_admin() or public.is_module_admin('DA'));

drop policy if exists safety_issue_comments_delete on public.safety_issue_comments;
create policy safety_issue_comments_delete
  on public.safety_issue_comments for delete to authenticated
  using (created_by = public.current_app_user_id()::text or public.is_admin() or public.is_module_admin('DA'));

drop policy if exists safety_issue_status_logs_select on public.safety_issue_status_logs;
create policy safety_issue_status_logs_select
  on public.safety_issue_status_logs for select to authenticated
  using (
    exists (
      select 1
      from public.safety_issues issue
      where issue.id = issue_id
        and app_private.safety_can_view(issue.project_id, issue.construction_site_id, issue.assigned_to_user_id)
    )
  );

drop policy if exists safety_issue_status_logs_insert on public.safety_issue_status_logs;
create policy safety_issue_status_logs_insert
  on public.safety_issue_status_logs for insert to authenticated
  with check (
    exists (
      select 1
      from public.safety_issues issue
      where issue.id = issue_id
        and app_private.safety_can_view(issue.project_id, issue.construction_site_id, issue.assigned_to_user_id)
    )
  );

drop policy if exists safety_issue_status_logs_update on public.safety_issue_status_logs;
create policy safety_issue_status_logs_update
  on public.safety_issue_status_logs for update to authenticated
  using (public.is_admin() or public.is_module_admin('DA'))
  with check (public.is_admin() or public.is_module_admin('DA'));

drop policy if exists safety_issue_status_logs_delete on public.safety_issue_status_logs;
create policy safety_issue_status_logs_delete
  on public.safety_issue_status_logs for delete to authenticated
  using (public.is_admin() or public.is_module_admin('DA'));

-- Inspections
drop policy if exists safety_inspections_select on public.safety_inspections;
create policy safety_inspections_select
  on public.safety_inspections for select to authenticated
  using (app_private.safety_can_view(project_id, construction_site_id, inspector_user_id));

drop policy if exists safety_inspections_insert on public.safety_inspections;
create policy safety_inspections_insert
  on public.safety_inspections for insert to authenticated
  with check (app_private.safety_can_submit(project_id, construction_site_id));

drop policy if exists safety_inspections_update on public.safety_inspections;
create policy safety_inspections_update
  on public.safety_inspections for update to authenticated
  using (app_private.safety_can_manage(project_id, construction_site_id, inspector_user_id))
  with check (app_private.safety_can_manage(project_id, construction_site_id, inspector_user_id));

drop policy if exists safety_inspections_delete on public.safety_inspections;
create policy safety_inspections_delete
  on public.safety_inspections for delete to authenticated
  using (app_private.safety_can_delete(project_id, construction_site_id, status));

drop policy if exists safety_inspection_items_select on public.safety_inspection_items;
create policy safety_inspection_items_select
  on public.safety_inspection_items for select to authenticated
  using (
    app_private.safety_can_view(project_id, construction_site_id, assigned_to_user_id)
  );

drop policy if exists safety_inspection_items_insert on public.safety_inspection_items;
create policy safety_inspection_items_insert
  on public.safety_inspection_items for insert to authenticated
  with check (app_private.safety_can_submit(project_id, construction_site_id));

drop policy if exists safety_inspection_items_update on public.safety_inspection_items;
create policy safety_inspection_items_update
  on public.safety_inspection_items for update to authenticated
  using (app_private.safety_can_manage(project_id, construction_site_id, assigned_to_user_id))
  with check (app_private.safety_can_manage(project_id, construction_site_id, assigned_to_user_id));

drop policy if exists safety_inspection_items_delete on public.safety_inspection_items;
create policy safety_inspection_items_delete
  on public.safety_inspection_items for delete to authenticated
  using (app_private.safety_can_delete(project_id, construction_site_id, 'draft'));

-- Storage policies. Path: {projectId}/{recordType}/{recordId}/{timestamp}-{safeFileName}
drop policy if exists project_safety_attachments_select on storage.objects;
create policy project_safety_attachments_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'project-safety-attachments'
  and split_part(name, '/', 1) <> ''
  and app_private.safety_can_view(split_part(name, '/', 1), null, null)
);

drop policy if exists project_safety_attachments_insert on storage.objects;
create policy project_safety_attachments_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-safety-attachments'
  and split_part(name, '/', 1) <> ''
  and app_private.safety_can_submit(split_part(name, '/', 1), null)
);

drop policy if exists project_safety_attachments_delete on storage.objects;
create policy project_safety_attachments_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-safety-attachments'
  and split_part(name, '/', 1) <> ''
  and app_private.safety_can_manage(split_part(name, '/', 1), null, null)
);

notify pgrst, 'reload schema';
