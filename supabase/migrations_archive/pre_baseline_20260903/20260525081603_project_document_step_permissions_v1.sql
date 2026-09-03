-- Project document step permissions v1.
-- Add explicit step-holder metadata and replace broad project document RLS
-- with status-aware policies for approval documents.

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon;
revoke all on schema app_private from authenticated;

create or replace function app_private.project_user_has_permission(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.project_staff ps
      join public.project_staff_permissions psp
        on psp.staff_id = ps.id
       and coalesce(psp.is_active, true)
      join public.project_permission_types ppt
        on ppt.id = psp.permission_type_id
       and ppt.code = p_permission_code
       and coalesce(ppt.is_active, true)
      where ps.user_id::text = public.current_app_user_id()::text
        and ps.end_date is null
        and (
          (p_project_id is not null and ps.project_id::text = p_project_id)
          or (p_construction_site_id is not null and ps.construction_site_id::text = p_construction_site_id)
        )
    );
$$;

create or replace function app_private.project_user_has_any_permission(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or exists (
      select 1
      from public.project_staff ps
      join public.project_staff_permissions psp
        on psp.staff_id = ps.id
       and coalesce(psp.is_active, true)
      join public.project_permission_types ppt
        on ppt.id = psp.permission_type_id
       and coalesce(ppt.is_active, true)
      where ps.user_id::text = public.current_app_user_id()::text
        and ps.end_date is null
        and (
          (p_project_id is not null and ps.project_id::text = p_project_id)
          or (p_construction_site_id is not null and ps.construction_site_id::text = p_construction_site_id)
        )
    );
$$;

create or replace function app_private.project_doc_is_current_handler(
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      p_submitted_to_user_id is not null
      and p_submitted_to_user_id = public.current_app_user_id()::text
    );
$$;

create or replace function app_private.project_doc_can_view(
  p_project_id text,
  p_construction_site_id text,
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or app_private.project_doc_is_current_handler(p_submitted_to_user_id)
    or app_private.project_user_has_any_permission(p_project_id, p_construction_site_id);
$$;

create or replace function app_private.project_doc_can_edit(
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
  select coalesce(p_status, 'draft') in ('draft', 'returned', 'rejected')
    and (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
    );
$$;

create or replace function app_private.project_doc_can_update_step(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.project_doc_can_edit(p_project_id, p_construction_site_id, p_status)
    or (
      coalesce(p_status, 'draft') in ('submitted', 'pending', 'verified', 'approved', 'reviewed')
      and app_private.project_doc_is_current_handler(p_submitted_to_user_id)
    );
$$;

create or replace function app_private.project_doc_can_delete(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_ever_submitted boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_status, 'draft') = 'draft'
    and not coalesce(p_ever_submitted, false)
    and (
      public.is_admin()
      or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'delete')
    );
$$;

create or replace function app_private.project_doc_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.ever_submitted := coalesce(new.ever_submitted, false)
      or coalesce(new.status::text, 'draft') <> 'draft';
    new.last_action_by := coalesce(new.last_action_by, public.current_app_user_id()::text);
    new.last_action_at := coalesce(new.last_action_at, now());
    return new;
  end if;

  if old.status is distinct from new.status
     or old.submitted_to_user_id is distinct from new.submitted_to_user_id then
    new.last_action_by := coalesce(new.last_action_by, public.current_app_user_id()::text);
    new.last_action_at := coalesce(new.last_action_at, now());
  end if;

  if coalesce(new.status::text, 'draft') <> 'draft' then
    new.ever_submitted := true;
  end if;

  return new;
end;
$$;

create or replace function app_private.daily_log_step_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'submitted' then
    new.ever_submitted := true;
    new.submitted_to_user_id := coalesce(new.submitted_to_user_id, new.requested_verifier_id);
    new.submitted_to_name := coalesce(new.submitted_to_name, new.requested_verifier_name);
    new.submitted_to_permission := coalesce(new.submitted_to_permission, 'verify');
  elsif new.status = 'rejected' then
    new.submitted_to_user_id := coalesce(new.created_by_id, new.submitted_by_id, new.submitted_by);
    new.submitted_to_name := null;
    new.submitted_to_permission := 'edit';
    new.submission_note := coalesce(new.rejection_reason, new.submission_note);
  elsif new.status = 'verified' then
    new.submitted_to_user_id := null;
    new.submitted_to_name := null;
    new.submitted_to_permission := null;
    new.submission_note := null;
  end if;

  return new;
end;
$$;

do $$
declare
  tbl text;
  has_submitted_at boolean;
begin
  foreach tbl in array array[
    'daily_logs',
    'project_task_completion_requests',
    'boq_reconciliation_groups',
    'contract_variations',
    'quantity_acceptances',
    'payment_certificates',
    'project_material_requests',
    'purchase_orders'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;

    execute format('alter table public.%I add column if not exists submitted_to_user_id text', tbl);
    execute format('alter table public.%I add column if not exists submitted_to_name text', tbl);
    execute format('alter table public.%I add column if not exists submitted_to_permission text', tbl);
    execute format('alter table public.%I add column if not exists submission_note text', tbl);
    execute format('alter table public.%I add column if not exists ever_submitted boolean not null default false', tbl);
    execute format('alter table public.%I add column if not exists last_action_by text', tbl);
    execute format('alter table public.%I add column if not exists last_action_at timestamptz', tbl);

    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = tbl
        and column_name = 'submitted_at'
    ) into has_submitted_at;

    if has_submitted_at then
      execute format(
        'update public.%I set ever_submitted = true where coalesce(status::text, %L) <> %L or submitted_at is not null',
        tbl,
        'draft',
        'draft'
      );
    else
      execute format(
        'update public.%I set ever_submitted = true where coalesce(status::text, %L) <> %L',
        tbl,
        'draft',
        'draft'
      );
    end if;

    execute format(
      'create index if not exists %I on public.%I(submitted_to_user_id, status)',
      'idx_' || tbl || '_step_handler',
      tbl
    );
    execute format(
      'create index if not exists %I on public.%I(ever_submitted, status)',
      'idx_' || tbl || '_ever_submitted_status',
      tbl
    );
    execute format('drop trigger if exists trg_%I_project_doc_touch on public.%I', tbl, tbl);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function app_private.project_doc_touch()',
      'trg_' || tbl || '_project_doc_touch',
      tbl
    );
  end loop;
end;
$$;

update public.daily_logs
set submitted_to_user_id = coalesce(submitted_to_user_id, requested_verifier_id)
where submitted_to_user_id is null
  and requested_verifier_id is not null;

drop trigger if exists trg_daily_logs_step_touch on public.daily_logs;
create trigger trg_daily_logs_step_touch
  before insert or update on public.daily_logs
  for each row execute function app_private.daily_log_step_touch();

do $$
declare
  pol record;
  tbl text;
begin
  foreach tbl in array array[
    'daily_logs',
    'project_task_completion_requests',
    'boq_reconciliation_groups',
    'contract_variations',
    'quantity_acceptances',
    'payment_certificates',
    'project_material_requests',
    'purchase_orders',
    'quantity_acceptance_items',
    'payment_certificate_items',
    'payment_certificate_advance_recoveries',
    'contract_variation_items',
    'boq_reconciliation_contract_lines',
    'boq_reconciliation_work_lines'
  ]
  loop
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;

    execute format('revoke all on table public.%I from anon', tbl);
    execute format('revoke all on table public.%I from public', tbl);
    execute format('revoke all on table public.%I from authenticated', tbl);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', tbl);
  end loop;
end;
$$;

create policy daily_logs_select
  on public.daily_logs
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy daily_logs_insert
  on public.daily_logs
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
  );

create policy daily_logs_update
  on public.daily_logs
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy daily_logs_delete
  on public.daily_logs
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy project_task_completion_requests_select
  on public.project_task_completion_requests
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy project_task_completion_requests_insert
  on public.project_task_completion_requests
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy project_task_completion_requests_update
  on public.project_task_completion_requests
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy project_task_completion_requests_delete
  on public.project_task_completion_requests
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy boq_reconciliation_groups_select
  on public.boq_reconciliation_groups
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy boq_reconciliation_groups_insert
  on public.boq_reconciliation_groups
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy boq_reconciliation_groups_update
  on public.boq_reconciliation_groups
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy boq_reconciliation_groups_delete
  on public.boq_reconciliation_groups
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy contract_variations_select
  on public.contract_variations
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy contract_variations_insert
  on public.contract_variations
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy contract_variations_update
  on public.contract_variations
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy contract_variations_delete
  on public.contract_variations
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy quantity_acceptances_select
  on public.quantity_acceptances
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy quantity_acceptances_insert
  on public.quantity_acceptances
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy quantity_acceptances_update
  on public.quantity_acceptances
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy quantity_acceptances_delete
  on public.quantity_acceptances
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy payment_certificates_select
  on public.payment_certificates
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy payment_certificates_insert
  on public.payment_certificates
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy payment_certificates_update
  on public.payment_certificates
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy payment_certificates_delete
  on public.payment_certificates
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy project_material_requests_select
  on public.project_material_requests
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy project_material_requests_insert
  on public.project_material_requests
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy project_material_requests_update
  on public.project_material_requests
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy project_material_requests_delete
  on public.project_material_requests
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (app_private.project_doc_can_view(project_id::text, construction_site_id::text, submitted_to_user_id));

create policy purchase_orders_insert
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
  );

create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

create policy purchase_orders_delete
  on public.purchase_orders
  for delete
  to authenticated
  using (
    app_private.project_doc_can_delete(project_id::text, construction_site_id::text, status::text, ever_submitted)
  );

create policy quantity_acceptance_items_select
  on public.quantity_acceptance_items
  for select
  to authenticated
  using (exists (
    select 1 from public.quantity_acceptances qa
    where qa.id = quantity_acceptance_items.acceptance_id
      and app_private.project_doc_can_view(qa.project_id::text, qa.construction_site_id::text, qa.submitted_to_user_id)
  ));

create policy quantity_acceptance_items_write
  on public.quantity_acceptance_items
  for all
  to authenticated
  using (exists (
    select 1 from public.quantity_acceptances qa
    where qa.id = quantity_acceptance_items.acceptance_id
      and app_private.project_doc_can_edit(qa.project_id::text, qa.construction_site_id::text, qa.status::text)
  ))
  with check (exists (
    select 1 from public.quantity_acceptances qa
    where qa.id = quantity_acceptance_items.acceptance_id
      and app_private.project_doc_can_edit(qa.project_id::text, qa.construction_site_id::text, qa.status::text)
  ));

create policy payment_certificate_items_select
  on public.payment_certificate_items
  for select
  to authenticated
  using (exists (
    select 1 from public.payment_certificates pc
    where pc.id = payment_certificate_items.payment_certificate_id
      and app_private.project_doc_can_view(pc.project_id::text, pc.construction_site_id::text, pc.submitted_to_user_id)
  ));

create policy payment_certificate_items_write
  on public.payment_certificate_items
  for all
  to authenticated
  using (exists (
    select 1 from public.payment_certificates pc
    where pc.id = payment_certificate_items.payment_certificate_id
      and app_private.project_doc_can_edit(pc.project_id::text, pc.construction_site_id::text, pc.status::text)
  ))
  with check (exists (
    select 1 from public.payment_certificates pc
    where pc.id = payment_certificate_items.payment_certificate_id
      and app_private.project_doc_can_edit(pc.project_id::text, pc.construction_site_id::text, pc.status::text)
  ));

create policy payment_certificate_advance_recoveries_select
  on public.payment_certificate_advance_recoveries
  for select
  to authenticated
  using (exists (
    select 1 from public.payment_certificates pc
    where pc.id = payment_certificate_advance_recoveries.payment_certificate_id
      and app_private.project_doc_can_view(pc.project_id::text, pc.construction_site_id::text, pc.submitted_to_user_id)
  ));

create policy payment_certificate_advance_recoveries_write
  on public.payment_certificate_advance_recoveries
  for all
  to authenticated
  using (exists (
    select 1 from public.payment_certificates pc
    where pc.id = payment_certificate_advance_recoveries.payment_certificate_id
      and app_private.project_doc_can_edit(pc.project_id::text, pc.construction_site_id::text, pc.status::text)
  ))
  with check (exists (
    select 1 from public.payment_certificates pc
    where pc.id = payment_certificate_advance_recoveries.payment_certificate_id
      and app_private.project_doc_can_edit(pc.project_id::text, pc.construction_site_id::text, pc.status::text)
  ));

create policy contract_variation_items_select
  on public.contract_variation_items
  for select
  to authenticated
  using (exists (
    select 1 from public.contract_variations cv
    where cv.id = contract_variation_items.variation_id
      and app_private.project_doc_can_view(cv.project_id::text, cv.construction_site_id::text, cv.submitted_to_user_id)
  ));

create policy contract_variation_items_write
  on public.contract_variation_items
  for all
  to authenticated
  using (exists (
    select 1 from public.contract_variations cv
    where cv.id = contract_variation_items.variation_id
      and app_private.project_doc_can_edit(cv.project_id::text, cv.construction_site_id::text, cv.status::text)
  ))
  with check (exists (
    select 1 from public.contract_variations cv
    where cv.id = contract_variation_items.variation_id
      and app_private.project_doc_can_edit(cv.project_id::text, cv.construction_site_id::text, cv.status::text)
  ));

create policy boq_reconciliation_contract_lines_select
  on public.boq_reconciliation_contract_lines
  for select
  to authenticated
  using (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_contract_lines.group_id
      and app_private.project_doc_can_view(g.project_id::text, g.construction_site_id::text, g.submitted_to_user_id)
  ));

create policy boq_reconciliation_contract_lines_write
  on public.boq_reconciliation_contract_lines
  for all
  to authenticated
  using (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_contract_lines.group_id
      and app_private.project_doc_can_edit(g.project_id::text, g.construction_site_id::text, g.status::text)
  ))
  with check (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_contract_lines.group_id
      and app_private.project_doc_can_edit(g.project_id::text, g.construction_site_id::text, g.status::text)
  ));

create policy boq_reconciliation_work_lines_select
  on public.boq_reconciliation_work_lines
  for select
  to authenticated
  using (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_work_lines.group_id
      and app_private.project_doc_can_view(g.project_id::text, g.construction_site_id::text, g.submitted_to_user_id)
  ));

create policy boq_reconciliation_work_lines_write
  on public.boq_reconciliation_work_lines
  for all
  to authenticated
  using (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_work_lines.group_id
      and app_private.project_doc_can_edit(g.project_id::text, g.construction_site_id::text, g.status::text)
  ))
  with check (exists (
    select 1 from public.boq_reconciliation_groups g
    where g.id = boq_reconciliation_work_lines.group_id
      and app_private.project_doc_can_edit(g.project_id::text, g.construction_site_id::text, g.status::text)
  ));

notify pgrst, 'reload schema';
