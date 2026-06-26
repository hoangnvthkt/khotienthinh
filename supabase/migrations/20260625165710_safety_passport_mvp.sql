-- Safety Passport MVP
-- Global worker safety records reusable across projects/sites.

create schema if not exists app_private;

insert into storage.buckets (id, name, public, file_size_limit)
values ('safety-passport-attachments', 'safety-passport-attachments', false, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create table if not exists public.safety_contractors (
  id uuid primary key default gen_random_uuid(),
  contractor_type text not null default 'subcontractor'
    check (contractor_type in ('subcontractor', 'team')),
  code text,
  name text not null,
  representative_name text,
  representative_phone text,
  tax_code text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'inactive')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_contractors_code_unique unique (code)
);

create table if not exists public.safety_worker_profiles (
  id uuid primary key default gen_random_uuid(),
  worker_code text not null,
  full_name text not null,
  photo_attachment jsonb not null default 'null'::jsonb,
  identity_type text not null default 'cccd'
    check (identity_type in ('cccd', 'passport', 'other')),
  identity_number text,
  identity_issue_date date,
  identity_attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(identity_attachments) = 'array'),
  phone text,
  emergency_contact text,
  contractor_id uuid references public.safety_contractors(id) on delete set null,
  team_name text,
  role_name text,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'inactive')),
  locked_reason text,
  note text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_worker_profiles_code_unique unique (worker_code)
);

create table if not exists public.safety_worker_documents (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.safety_worker_profiles(id) on delete cascade,
  document_type text not null default 'other',
  name text not null,
  issue_date date,
  expiry_date date,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'submitted'
    check (status in ('missing', 'submitted', 'approved', 'rejected', 'expired')),
  is_required boolean not null default false,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_certificate_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_required_default boolean not null default false,
  validity_days integer,
  applies_to_roles jsonb not null default '[]'::jsonb
    check (jsonb_typeof(applies_to_roles) = 'array'),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_certificate_types_code_unique unique (code)
);

create table if not exists public.safety_worker_certificates (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.safety_worker_profiles(id) on delete cascade,
  certificate_type_id uuid not null references public.safety_certificate_types(id) on delete restrict,
  certificate_no text,
  issue_date date,
  expiry_date date,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'rejected', 'revoked')),
  verified_by text,
  verified_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_project_assignments (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.safety_worker_profiles(id) on delete cascade,
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  contractor_id uuid references public.safety_contractors(id) on delete set null,
  team_name text,
  role_name text,
  start_date date not null default current_date,
  end_date date,
  site_training_status text not null default 'pending'
    check (site_training_status in ('pending', 'completed', 'expired')),
  commitment_status text not null default 'pending'
    check (commitment_status in ('pending', 'signed')),
  ppe_status text not null default 'missing'
    check (ppe_status in ('missing', 'partial', 'complete')),
  toolbox_status text not null default 'pending'
    check (toolbox_status in ('pending', 'completed', 'expired')),
  is_locked boolean not null default false,
  lock_reason text,
  eligibility_status text not null default 'missing_profile'
    check (eligibility_status in ('eligible', 'missing_profile', 'missing_certificate', 'expired_certificate', 'missing_site_requirement', 'suspended')),
  eligibility_checked_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_project_assignments_active_unique unique (worker_id, project_id, construction_site_id)
);

create table if not exists public.safety_site_inductions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.safety_project_assignments(id) on delete cascade,
  training_type text not null
    check (training_type in ('site_rules', 'toolbox', 'commitment', 'ppe')),
  completed_at timestamptz,
  expires_at date,
  trainer_user_id text,
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'expired')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_card_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  layout_json jsonb not null default '{}'::jsonb,
  background_attachment jsonb not null default 'null'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_cards (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.safety_project_assignments(id) on delete cascade,
  worker_id uuid not null references public.safety_worker_profiles(id) on delete cascade,
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  contractor_id uuid references public.safety_contractors(id) on delete set null,
  template_id uuid references public.safety_card_templates(id) on delete set null,
  card_code text not null,
  qr_token text not null default replace(gen_random_uuid()::text, '-', ''),
  issued_at timestamptz not null default now(),
  expires_at date not null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'expired', 'revoked')),
  printed_count integer not null default 0,
  revoked_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_cards_card_code_unique unique (card_code),
  constraint safety_cards_qr_token_unique unique (qr_token)
);

create table if not exists public.safety_card_print_logs (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.safety_cards(id) on delete cascade,
  printed_by text,
  printed_at timestamptz not null default now(),
  template_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.safety_violations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.safety_worker_profiles(id) on delete set null,
  assignment_id uuid references public.safety_project_assignments(id) on delete set null,
  project_id text references public.projects(id) on delete cascade,
  construction_site_id text,
  violation_type text not null default 'safety',
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'resolved', 'closed')),
  occurred_at timestamptz not null default now(),
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.safety_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id text,
  action text not null,
  target_type text not null,
  target_id uuid,
  project_id text,
  construction_site_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_safety_worker_profiles_search
  on public.safety_worker_profiles(lower(full_name), worker_code);
create index if not exists idx_safety_worker_profiles_contractor
  on public.safety_worker_profiles(contractor_id, status);
create index if not exists idx_safety_worker_documents_worker
  on public.safety_worker_documents(worker_id, status, expiry_date);
create index if not exists idx_safety_worker_certificates_worker
  on public.safety_worker_certificates(worker_id, certificate_type_id, expiry_date);
create index if not exists idx_safety_worker_certificates_expiry
  on public.safety_worker_certificates(expiry_date) where expiry_date is not null;
create index if not exists idx_safety_project_assignments_scope
  on public.safety_project_assignments(project_id, construction_site_id, eligibility_status, created_at desc);
create index if not exists idx_safety_project_assignments_worker
  on public.safety_project_assignments(worker_id, project_id, construction_site_id);
create index if not exists idx_safety_site_inductions_assignment
  on public.safety_site_inductions(assignment_id, training_type);
create index if not exists idx_safety_cards_assignment
  on public.safety_cards(assignment_id, status, expires_at);
create index if not exists idx_safety_cards_qr
  on public.safety_cards(qr_token);
create index if not exists idx_safety_audit_logs_target
  on public.safety_audit_logs(target_type, target_id, created_at desc);

create or replace function app_private.set_safety_passport_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app_private.safety_passport_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_admin() or public.is_module_admin('DA'), false);
$$;

create or replace function app_private.safety_passport_can_view_project_assignment(
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
    app_private.safety_passport_can_manage()
    or app_private.project_doc_can_view(p_project_id, p_construction_site_id, null),
    false
  );
$$;

create or replace function app_private.safety_passport_can_view_basic(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.safety_passport_can_manage()
    or exists (
      select 1
      from public.safety_project_assignments spa
      where spa.worker_id = p_worker_id
        and app_private.safety_passport_can_view_project_assignment(spa.project_id, spa.construction_site_id)
    ),
    false
  );
$$;

create or replace function app_private.safety_passport_can_view_sensitive(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app_private.safety_passport_can_manage(), false);
$$;

create or replace function app_private.safety_required_certificate_type_applies(
  p_applies_to_roles jsonb,
  p_role_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_array_length(p_applies_to_roles), 0) = 0
    or exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_applies_to_roles, '[]'::jsonb)) role_value
      where lower(role_value) = lower(coalesce(p_role_name, ''))
    );
$$;

create or replace function app_private.safety_worker_certificate_status(p_expiry_date date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_expiry_date is null then 'valid'
    when p_expiry_date < current_date then 'expired'
    when p_expiry_date <= current_date + 30 then 'expiring_soon'
    else 'valid'
  end;
$$;

create or replace function app_private.safety_assignment_eligibility_status(p_assignment_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_assignment public.safety_project_assignments%rowtype;
  v_worker public.safety_worker_profiles%rowtype;
  v_required_count integer := 0;
  v_missing_count integer := 0;
  v_expired_count integer := 0;
begin
  select * into v_assignment
  from public.safety_project_assignments
  where id = p_assignment_id;

  if not found then
    return 'missing_profile';
  end if;

  select * into v_worker
  from public.safety_worker_profiles
  where id = v_assignment.worker_id;

  if not found then
    return 'missing_profile';
  end if;

  if v_worker.status = 'suspended' or v_assignment.is_locked then
    return 'suspended';
  end if;

  if v_worker.status <> 'active'
    or nullif(trim(v_worker.full_name), '') is null
    or nullif(trim(v_worker.worker_code), '') is null
    or v_worker.photo_attachment = 'null'::jsonb
    or nullif(trim(coalesce(v_worker.identity_number, '')), '') is null
    or jsonb_array_length(coalesce(v_worker.identity_attachments, '[]'::jsonb)) = 0
  then
    return 'missing_profile';
  end if;

  select count(*)
    into v_required_count
  from public.safety_certificate_types sct
  where sct.is_active
    and sct.is_required_default
    and app_private.safety_required_certificate_type_applies(sct.applies_to_roles, coalesce(v_assignment.role_name, v_worker.role_name));

  if v_required_count > 0 then
    select
      count(*) filter (where swc.id is null),
      count(*) filter (where swc.id is not null and coalesce(swc.status, 'submitted') <> 'rejected' and swc.expiry_date is not null and swc.expiry_date < current_date)
      into v_missing_count, v_expired_count
    from public.safety_certificate_types sct
    left join lateral (
      select c.*
      from public.safety_worker_certificates c
      where c.worker_id = v_worker.id
        and c.certificate_type_id = sct.id
        and c.status <> 'rejected'
      order by c.expiry_date desc nulls last, c.created_at desc
      limit 1
    ) swc on true
    where sct.is_active
      and sct.is_required_default
      and app_private.safety_required_certificate_type_applies(sct.applies_to_roles, coalesce(v_assignment.role_name, v_worker.role_name));

    if v_missing_count > 0 then
      return 'missing_certificate';
    end if;
    if v_expired_count > 0 then
      return 'expired_certificate';
    end if;
  end if;

  if v_assignment.site_training_status <> 'completed'
    or v_assignment.commitment_status <> 'signed'
    or v_assignment.ppe_status <> 'complete'
    or v_assignment.toolbox_status <> 'completed'
  then
    return 'missing_site_requirement';
  end if;

  return 'eligible';
end;
$$;

create or replace function app_private.recompute_safety_assignment_eligibility(p_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next text;
begin
  v_next := app_private.safety_assignment_eligibility_status(p_assignment_id);

  update public.safety_project_assignments
  set eligibility_status = v_next,
      eligibility_checked_at = now(),
      updated_at = now()
  where id = p_assignment_id;

  return v_next;
end;
$$;

create or replace function app_private.recompute_safety_worker_assignments(p_worker_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment_id uuid;
begin
  for v_assignment_id in
    select id from public.safety_project_assignments where worker_id = p_worker_id
  loop
    perform app_private.recompute_safety_assignment_eligibility(v_assignment_id);
  end loop;
end;
$$;

create or replace function public.recompute_safety_assignment_eligibility(p_assignment_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.safety_project_assignments%rowtype;
begin
  select * into v_assignment
  from public.safety_project_assignments
  where id = p_assignment_id;

  if not found then
    raise exception 'Không tìm thấy phân công nhân công.';
  end if;

  if not (
    app_private.safety_passport_can_manage()
    or app_private.safety_passport_can_view_project_assignment(v_assignment.project_id, v_assignment.construction_site_id)
  ) then
    raise exception 'Không có quyền kiểm tra điều kiện nhân công.';
  end if;

  return app_private.recompute_safety_assignment_eligibility(p_assignment_id);
end;
$$;

revoke execute on function public.recompute_safety_assignment_eligibility(uuid) from public;
revoke execute on function public.recompute_safety_assignment_eligibility(uuid) from anon;
grant execute on function public.recompute_safety_assignment_eligibility(uuid) to authenticated;

create or replace function app_private.touch_safety_assignment_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  perform app_private.recompute_safety_assignment_eligibility(new.id);
  return new;
end;
$$;

create or replace function app_private.touch_safety_worker_assignment_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.recompute_safety_worker_assignments(old.worker_id);
    return old;
  end if;

  perform app_private.recompute_safety_worker_assignments(new.worker_id);
  if tg_op = 'UPDATE' and old.worker_id is distinct from new.worker_id then
    perform app_private.recompute_safety_worker_assignments(old.worker_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.sync_safety_site_induction_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.safety_project_assignments
  set site_training_status = case
        when new.training_type = 'site_rules' and new.status = 'completed' then 'completed'
        when new.training_type = 'site_rules' and new.status = 'expired' then 'expired'
        else site_training_status
      end,
      toolbox_status = case
        when new.training_type = 'toolbox' and new.status = 'completed' then 'completed'
        when new.training_type = 'toolbox' and new.status = 'expired' then 'expired'
        else toolbox_status
      end,
      commitment_status = case
        when new.training_type = 'commitment' and new.status = 'completed' then 'signed'
        else commitment_status
      end,
      ppe_status = case
        when new.training_type = 'ppe' and new.status = 'completed' then 'complete'
        else ppe_status
      end,
      updated_at = now()
  where id = new.assignment_id;
  return new;
end;
$$;

create or replace function app_private.increment_safety_card_print_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.safety_cards
  set printed_count = printed_count + 1,
      updated_at = now()
  where id = new.card_id;
  return new;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'safety_contractors',
    'safety_worker_profiles',
    'safety_worker_documents',
    'safety_certificate_types',
    'safety_worker_certificates',
    'safety_project_assignments',
    'safety_site_inductions',
    'safety_card_templates',
    'safety_cards',
    'safety_violations'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', tbl, tbl);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function app_private.set_safety_passport_updated_at()',
      tbl,
      tbl
    );
  end loop;
end $$;

drop trigger if exists trg_safety_assignment_recompute on public.safety_project_assignments;
create trigger trg_safety_assignment_recompute
after insert or update of worker_id, role_name, site_training_status, commitment_status, ppe_status, toolbox_status, is_locked on public.safety_project_assignments
for each row execute function app_private.touch_safety_assignment_eligibility();

drop trigger if exists trg_safety_worker_profile_recompute on public.safety_worker_profiles;
create trigger trg_safety_worker_profile_recompute
after update of full_name, worker_code, photo_attachment, identity_number, identity_attachments, status, role_name on public.safety_worker_profiles
for each row execute function app_private.touch_safety_worker_assignment_eligibility();

drop trigger if exists trg_safety_worker_certificate_recompute on public.safety_worker_certificates;
create trigger trg_safety_worker_certificate_recompute
after insert or update or delete on public.safety_worker_certificates
for each row execute function app_private.touch_safety_worker_assignment_eligibility();

drop trigger if exists trg_safety_site_induction_sync on public.safety_site_inductions;
create trigger trg_safety_site_induction_sync
after insert or update of training_type, status on public.safety_site_inductions
for each row execute function app_private.sync_safety_site_induction_assignment();

drop trigger if exists trg_safety_card_print_count on public.safety_card_print_logs;
create trigger trg_safety_card_print_count
after insert on public.safety_card_print_logs
for each row execute function app_private.increment_safety_card_print_count();

insert into public.safety_certificate_types (code, name, is_required_default, sort_order)
values
  ('SAFETY_ORIENTATION', 'Huấn luyện an toàn cơ bản', true, 10),
  ('WORK_AT_HEIGHT', 'Chứng chỉ làm việc trên cao', false, 20),
  ('EQUIPMENT_OPERATOR', 'Chứng chỉ vận hành thiết bị', false, 30)
on conflict (code) do nothing;

insert into public.safety_card_templates (name, layout_json, is_default, is_active)
values (
  'Phôi thẻ an toàn mặc định',
  '{"version":1,"fields":["photo","workerName","workerCode","contractor","project","cardCode","expiresAt","qr"]}'::jsonb,
  true,
  true
)
on conflict do nothing;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'safety_contractors',
    'safety_worker_profiles',
    'safety_worker_documents',
    'safety_certificate_types',
    'safety_worker_certificates',
    'safety_project_assignments',
    'safety_site_inductions',
    'safety_cards',
    'safety_card_templates',
    'safety_card_print_logs',
    'safety_violations',
    'safety_audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on table public.%I from anon', tbl);
    execute format('revoke all on table public.%I from public', tbl);
    execute format('revoke all on table public.%I from authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);
  end loop;
end $$;

drop policy if exists safety_contractors_select on public.safety_contractors;
create policy safety_contractors_select
  on public.safety_contractors for select to authenticated
  using (true);
drop policy if exists safety_contractors_write on public.safety_contractors;
create policy safety_contractors_write
  on public.safety_contractors for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_worker_profiles_select on public.safety_worker_profiles;
create policy safety_worker_profiles_select
  on public.safety_worker_profiles for select to authenticated
  using (app_private.safety_passport_can_view_basic(id));
drop policy if exists safety_worker_profiles_write on public.safety_worker_profiles;
create policy safety_worker_profiles_write
  on public.safety_worker_profiles for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_worker_documents_select on public.safety_worker_documents;
create policy safety_worker_documents_select
  on public.safety_worker_documents for select to authenticated
  using (app_private.safety_passport_can_view_sensitive(worker_id));
drop policy if exists safety_worker_documents_write on public.safety_worker_documents;
create policy safety_worker_documents_write
  on public.safety_worker_documents for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_worker_certificates_select on public.safety_worker_certificates;
create policy safety_worker_certificates_select
  on public.safety_worker_certificates for select to authenticated
  using (app_private.safety_passport_can_view_sensitive(worker_id));
drop policy if exists safety_worker_certificates_write on public.safety_worker_certificates;
create policy safety_worker_certificates_write
  on public.safety_worker_certificates for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_certificate_types_select on public.safety_certificate_types;
create policy safety_certificate_types_select
  on public.safety_certificate_types for select to authenticated
  using (true);
drop policy if exists safety_certificate_types_write on public.safety_certificate_types;
create policy safety_certificate_types_write
  on public.safety_certificate_types for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_project_assignments_select on public.safety_project_assignments;
create policy safety_project_assignments_select
  on public.safety_project_assignments for select to authenticated
  using (app_private.safety_passport_can_view_project_assignment(project_id, construction_site_id));
drop policy if exists safety_project_assignments_write on public.safety_project_assignments;
create policy safety_project_assignments_write
  on public.safety_project_assignments for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_site_inductions_select on public.safety_site_inductions;
create policy safety_site_inductions_select
  on public.safety_site_inductions for select to authenticated
  using (
    exists (
      select 1 from public.safety_project_assignments spa
      where spa.id = assignment_id
        and app_private.safety_passport_can_view_project_assignment(spa.project_id, spa.construction_site_id)
    )
  );
drop policy if exists safety_site_inductions_write on public.safety_site_inductions;
create policy safety_site_inductions_write
  on public.safety_site_inductions for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_cards_select on public.safety_cards;
create policy safety_cards_select
  on public.safety_cards for select to authenticated
  using (app_private.safety_passport_can_view_project_assignment(project_id, construction_site_id));
drop policy if exists safety_cards_write on public.safety_cards;
create policy safety_cards_write
  on public.safety_cards for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_card_templates_select on public.safety_card_templates;
create policy safety_card_templates_select
  on public.safety_card_templates for select to authenticated
  using (is_active or app_private.safety_passport_can_manage());
drop policy if exists safety_card_templates_write on public.safety_card_templates;
create policy safety_card_templates_write
  on public.safety_card_templates for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_card_print_logs_select on public.safety_card_print_logs;
create policy safety_card_print_logs_select
  on public.safety_card_print_logs for select to authenticated
  using (
    exists (
      select 1
      from public.safety_cards sc
      where sc.id = card_id
        and app_private.safety_passport_can_view_project_assignment(sc.project_id, sc.construction_site_id)
    )
  );
drop policy if exists safety_card_print_logs_write on public.safety_card_print_logs;
create policy safety_card_print_logs_write
  on public.safety_card_print_logs for insert to authenticated
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_violations_select on public.safety_violations;
create policy safety_violations_select
  on public.safety_violations for select to authenticated
  using (app_private.safety_passport_can_view_project_assignment(project_id, construction_site_id));
drop policy if exists safety_violations_write on public.safety_violations;
create policy safety_violations_write
  on public.safety_violations for all to authenticated
  using (app_private.safety_passport_can_manage())
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_audit_logs_select on public.safety_audit_logs;
create policy safety_audit_logs_select
  on public.safety_audit_logs for select to authenticated
  using (app_private.safety_passport_can_manage());
drop policy if exists safety_audit_logs_insert on public.safety_audit_logs;
create policy safety_audit_logs_insert
  on public.safety_audit_logs for insert to authenticated
  with check (app_private.safety_passport_can_manage());

drop policy if exists safety_passport_storage_select on storage.objects;
create policy safety_passport_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'safety-passport-attachments'
    and app_private.safety_passport_can_manage()
  );

drop policy if exists safety_passport_storage_insert on storage.objects;
create policy safety_passport_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'safety-passport-attachments'
    and app_private.safety_passport_can_manage()
  );

drop policy if exists safety_passport_storage_update on storage.objects;
create policy safety_passport_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'safety-passport-attachments'
    and app_private.safety_passport_can_manage()
  )
  with check (
    bucket_id = 'safety-passport-attachments'
    and app_private.safety_passport_can_manage()
  );

drop policy if exists safety_passport_storage_delete on storage.objects;
create policy safety_passport_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'safety-passport-attachments'
    and app_private.safety_passport_can_manage()
  );
