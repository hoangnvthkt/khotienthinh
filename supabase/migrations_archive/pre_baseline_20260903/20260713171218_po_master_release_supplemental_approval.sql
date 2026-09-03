-- PO master/release supplemental approval workflow.
-- A PO keeps its approved master ceiling while delivery batches/releases can carry
-- their own actual prices. Quantity over master is blocked; amount over ceiling is
-- saved as supplemental_pending and must be approved before WMS/QR creation.

create schema if not exists app_private;

alter table if exists public.purchase_orders
  add column if not exists approved_total_amount numeric,
  add column if not exists supplemental_approval_status text not null default 'none';

update public.purchase_orders
set approved_total_amount = coalesce(approved_total_amount, total_amount, 0)
where approved_total_amount is null
  and archived_at is null;

alter table if exists public.purchase_orders
  alter column approved_total_amount set default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_supplemental_approval_status_check'
      and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders
      add constraint purchase_orders_supplemental_approval_status_check
      check (supplemental_approval_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
end $$;

alter table if exists public.purchase_order_delivery_batches
  add column if not exists supplemental_approval_id uuid;

alter table if exists public.purchase_order_delivery_batches
  drop constraint if exists purchase_order_delivery_batches_status_check;

alter table if exists public.purchase_order_delivery_batches
  add constraint purchase_order_delivery_batches_status_check
  check (status in ('planned', 'supplemental_pending', 'wms_pending', 'received', 'cancelled'));

create table if not exists public.purchase_order_supplemental_approvals (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  delivery_batch_id uuid not null references public.purchase_order_delivery_batches(id) on delete cascade,
  project_id text references public.projects(id) on delete set null,
  construction_site_id text,
  previous_approved_amount numeric not null default 0 check (previous_approved_amount >= 0),
  requested_total_amount numeric not null default 0 check (requested_total_amount >= 0),
  over_amount numeric not null default 0 check (over_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  decision_note text,
  requested_by text,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  submitted_to_user_id text,
  submitted_to_name text,
  submitted_to_permission text,
  submission_note text,
  ever_submitted boolean not null default false,
  last_action_by text,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(delivery_batch_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'po_delivery_batches_supplemental_approval_fk'
      and conrelid = 'public.purchase_order_delivery_batches'::regclass
  ) then
    alter table public.purchase_order_delivery_batches
      add constraint po_delivery_batches_supplemental_approval_fk
      foreign key (supplemental_approval_id)
      references public.purchase_order_supplemental_approvals(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_po_supplemental_approvals_po
  on public.purchase_order_supplemental_approvals(purchase_order_id, status, created_at desc);

create index if not exists idx_po_supplemental_approvals_project
  on public.purchase_order_supplemental_approvals(project_id, status, created_at desc)
  where project_id is not null;

create index if not exists idx_po_supplemental_approvals_site
  on public.purchase_order_supplemental_approvals(construction_site_id, status, created_at desc)
  where construction_site_id is not null;

create or replace function app_private.set_po_supplemental_approval_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_po_supplemental_approval_updated_at
  on public.purchase_order_supplemental_approvals;
create trigger trg_po_supplemental_approval_updated_at
before update on public.purchase_order_supplemental_approvals
for each row execute function app_private.set_po_supplemental_approval_updated_at();

create or replace function app_private.sync_po_supplemental_approval_to_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.purchase_order_delivery_batches
  set supplemental_approval_id = new.id
  where id = new.delivery_batch_id
    and supplemental_approval_id is distinct from new.id;
  return new;
end;
$$;

drop trigger if exists trg_sync_po_supplemental_approval_to_batch
  on public.purchase_order_supplemental_approvals;
create trigger trg_sync_po_supplemental_approval_to_batch
after insert or update of delivery_batch_id on public.purchase_order_supplemental_approvals
for each row execute function app_private.sync_po_supplemental_approval_to_batch();

create or replace function app_private.guard_po_supplemental_direct_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.material_transition_context', true) = 'on'
     or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is distinct from old.status
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.rejected_by is distinct from old.rejected_by
    or new.rejected_at is distinct from old.rejected_at
    or new.decision_note is distinct from old.decision_note then
    raise exception 'Purchase Order supplemental approval status must be changed through the approval RPC.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_po_supplemental_direct_status_update
  on public.purchase_order_supplemental_approvals;
create trigger guard_po_supplemental_direct_status_update
before update on public.purchase_order_supplemental_approvals
for each row execute function app_private.guard_po_supplemental_direct_status_update();

create or replace function app_private.purchase_order_supplemental_can_view(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('DA')
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.project_doc_can_view(
            po.project_id::text,
            po.construction_site_id::text,
            po.submitted_to_user_id
          )
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.view',
            public.current_app_user_id()
          )
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.create',
            public.current_app_user_id()
          )
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.approve',
            public.current_app_user_id()
          )
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.receive',
            public.current_app_user_id()
          )
        )
    );
$$;

create or replace function app_private.purchase_order_supplemental_can_create(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('DA')
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and app_private.material_has_action(
          po.project_id::text,
          po.construction_site_id::text,
          'project.material_po.create',
          public.current_app_user_id()
        )
    );
$$;

create or replace function app_private.purchase_order_supplemental_can_approve(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('DA')
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and app_private.material_has_action(
          po.project_id::text,
          po.construction_site_id::text,
          'project.material_po.approve',
          public.current_app_user_id()
        )
    );
$$;

revoke all on function app_private.purchase_order_supplemental_can_view(text) from public;
revoke all on function app_private.purchase_order_supplemental_can_view(text) from anon;
grant execute on function app_private.purchase_order_supplemental_can_view(text) to authenticated;

revoke all on function app_private.purchase_order_supplemental_can_create(text) from public;
revoke all on function app_private.purchase_order_supplemental_can_create(text) from anon;
grant execute on function app_private.purchase_order_supplemental_can_create(text) to authenticated;

revoke all on function app_private.purchase_order_supplemental_can_approve(text) from public;
revoke all on function app_private.purchase_order_supplemental_can_approve(text) from anon;
grant execute on function app_private.purchase_order_supplemental_can_approve(text) to authenticated;

alter table public.purchase_order_supplemental_approvals enable row level security;

drop policy if exists po_supplemental_approvals_select
  on public.purchase_order_supplemental_approvals;
create policy po_supplemental_approvals_select
on public.purchase_order_supplemental_approvals
for select to authenticated
using (app_private.purchase_order_supplemental_can_view(purchase_order_id));

drop policy if exists po_supplemental_approvals_insert
  on public.purchase_order_supplemental_approvals;
create policy po_supplemental_approvals_insert
on public.purchase_order_supplemental_approvals
for insert to authenticated
with check (
  status = 'pending'
  and app_private.purchase_order_supplemental_can_create(purchase_order_id)
);

drop policy if exists po_supplemental_approvals_update
  on public.purchase_order_supplemental_approvals;
create policy po_supplemental_approvals_update
on public.purchase_order_supplemental_approvals
for update to authenticated
using (
  app_private.purchase_order_supplemental_can_create(purchase_order_id)
  or app_private.purchase_order_supplemental_can_approve(purchase_order_id)
)
with check (
  app_private.purchase_order_supplemental_can_create(purchase_order_id)
  or app_private.purchase_order_supplemental_can_approve(purchase_order_id)
);

drop policy if exists po_supplemental_approvals_delete
  on public.purchase_order_supplemental_approvals;
create policy po_supplemental_approvals_delete
on public.purchase_order_supplemental_approvals
for delete to authenticated
using (app_private.purchase_order_supplemental_can_create(purchase_order_id));

revoke all on table public.purchase_order_supplemental_approvals from anon;
revoke all on table public.purchase_order_supplemental_approvals from public;
revoke all on table public.purchase_order_supplemental_approvals from authenticated;
grant select, insert, update, delete on table public.purchase_order_supplemental_approvals to authenticated;

create or replace function app_private.purchase_order_delivery_can_mutate(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or public.is_module_admin('DA')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.create',
            public.current_app_user_id()
          )
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.receive',
            public.current_app_user_id()
          )
        )
    );
$$;

grant execute on function app_private.purchase_order_delivery_can_mutate(text) to authenticated;

create or replace function app_private.purchase_order_can_receive(p_purchase_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or public.is_module_admin('DA')
    or app_private.current_user_is_global_wms_keeper()
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and (
          app_private.current_user_is_wms_keeper_for(po.target_warehouse_id)
          or app_private.material_has_action(
            po.project_id::text,
            po.construction_site_id::text,
            'project.material_po.receive',
            public.current_app_user_id()
          )
        )
    );
$$;

create or replace function app_private.purchase_order_can_receive_by_delivery_batch(p_delivery_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.id = p_delivery_batch_id
      and app_private.purchase_order_can_receive(batch.purchase_order_id)
  );
$$;

revoke all on function app_private.purchase_order_can_receive(text) from public;
revoke all on function app_private.purchase_order_can_receive(text) from anon;
grant execute on function app_private.purchase_order_can_receive(text) to authenticated;

revoke all on function app_private.purchase_order_can_receive_by_delivery_batch(uuid) from public;
revoke all on function app_private.purchase_order_can_receive_by_delivery_batch(uuid) from anon;
grant execute on function app_private.purchase_order_can_receive_by_delivery_batch(uuid) to authenticated;

drop policy if exists material_request_fulfillment_batches_insert
  on public.material_request_fulfillment_batches;
create policy material_request_fulfillment_batches_insert
  on public.material_request_fulfillment_batches
  for insert
  to authenticated
  with check (
    app_private.material_request_fulfillment_can_mutate(material_request_id)
    or (
      po_delivery_batch_id is not null
      and app_private.purchase_order_can_receive_by_delivery_batch(po_delivery_batch_id)
    )
  );

drop policy if exists material_request_fulfillment_lines_insert
  on public.material_request_fulfillment_lines;
create policy material_request_fulfillment_lines_insert
  on public.material_request_fulfillment_lines
  for insert
  to authenticated
  with check (
    app_private.material_request_fulfillment_line_can_mutate(material_request_id, batch_id)
    or (
      po_id is not null
      and app_private.purchase_order_can_receive(po_id)
    )
  );

create or replace function public.approve_purchase_order_supplemental_approval(
  p_approval_id uuid,
  p_actor_id text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.purchase_order_supplemental_approvals%rowtype;
  v_po public.purchase_orders%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_actor_id text := coalesce(nullif(p_actor_id, ''), v_user_id::text);
  v_previous_guard text;
begin
  select *
    into v_approval
  from public.purchase_order_supplemental_approvals
  where id = p_approval_id
  for update;

  if not found then
    raise exception 'Không tìm thấy yêu cầu duyệt bổ sung PO.';
  end if;

  select *
    into v_po
  from public.purchase_orders
  where id = v_approval.purchase_order_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO của yêu cầu duyệt bổ sung.';
  end if;

  if not app_private.purchase_order_supplemental_can_approve(v_po.id::text) then
    raise exception 'Bạn cần quyền duyệt PO để duyệt bổ sung.'
      using errcode = '42501';
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_order_supplemental_approvals
  set status = 'approved',
      approved_by = v_actor_id,
      approved_at = now(),
      rejected_by = null,
      rejected_at = null,
      decision_note = nullif(p_note, ''),
      last_action_by = v_actor_id,
      last_action_at = now()
  where id = p_approval_id;

  update public.purchase_orders
  set approved_total_amount = greatest(
        coalesce(approved_total_amount, total_amount, 0),
        coalesce(v_approval.requested_total_amount, 0)
      ),
      supplemental_approval_status = case
        when exists (
          select 1
          from public.purchase_order_supplemental_approvals pending
          where pending.purchase_order_id = v_po.id
            and pending.id <> p_approval_id
            and pending.status = 'pending'
        ) then 'pending'
        else 'approved'
      end,
      last_action_by = v_actor_id,
      last_action_at = now()
  where id = v_po.id;

  update public.purchase_order_delivery_batches
  set status = case when status = 'supplemental_pending' then 'planned' else status end,
      supplemental_approval_id = p_approval_id
  where id = v_approval.delivery_batch_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

create or replace function public.reject_purchase_order_supplemental_approval(
  p_approval_id uuid,
  p_actor_id text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval public.purchase_order_supplemental_approvals%rowtype;
  v_po public.purchase_orders%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_actor_id text := coalesce(nullif(p_actor_id, ''), v_user_id::text);
  v_previous_guard text;
begin
  select *
    into v_approval
  from public.purchase_order_supplemental_approvals
  where id = p_approval_id
  for update;

  if not found then
    raise exception 'Không tìm thấy yêu cầu duyệt bổ sung PO.';
  end if;

  select *
    into v_po
  from public.purchase_orders
  where id = v_approval.purchase_order_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO của yêu cầu duyệt bổ sung.';
  end if;

  if not app_private.purchase_order_supplemental_can_approve(v_po.id::text) then
    raise exception 'Bạn cần quyền duyệt PO để từ chối duyệt bổ sung.'
      using errcode = '42501';
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_order_supplemental_approvals
  set status = 'rejected',
      rejected_by = v_actor_id,
      rejected_at = now(),
      approved_by = null,
      approved_at = null,
      decision_note = nullif(p_note, ''),
      last_action_by = v_actor_id,
      last_action_at = now()
  where id = p_approval_id;

  update public.purchase_orders
  set supplemental_approval_status = case
        when exists (
          select 1
          from public.purchase_order_supplemental_approvals pending
          where pending.purchase_order_id = v_po.id
            and pending.id <> p_approval_id
            and pending.status = 'pending'
        ) then 'pending'
        else 'rejected'
      end,
      last_action_by = v_actor_id,
      last_action_at = now()
  where id = v_po.id;

  update public.purchase_order_delivery_batches
  set status = 'supplemental_pending',
      supplemental_approval_id = p_approval_id
  where id = v_approval.delivery_batch_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$$;

revoke all on function public.approve_purchase_order_supplemental_approval(uuid, text, text) from public;
revoke all on function public.approve_purchase_order_supplemental_approval(uuid, text, text) from anon;
grant execute on function public.approve_purchase_order_supplemental_approval(uuid, text, text) to authenticated;

revoke all on function public.reject_purchase_order_supplemental_approval(uuid, text, text) from public;
revoke all on function public.reject_purchase_order_supplemental_approval(uuid, text, text) from anon;
grant execute on function public.reject_purchase_order_supplemental_approval(uuid, text, text) to authenticated;

create or replace function app_private.guard_po_supplemental_pending_wms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.po_delivery_batch_id is null then
    return new;
  end if;

  if exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.id = new.po_delivery_batch_id
      and batch.status = 'supplemental_pending'
  ) then
    raise exception 'Đợt mua đang chờ duyệt bổ sung nên chưa thể tạo WMS/QR.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.material_request_fulfillment_batches') is not null then
    drop trigger if exists guard_po_supplemental_pending_wms
      on public.material_request_fulfillment_batches;
    create trigger guard_po_supplemental_pending_wms
    before insert or update of po_delivery_batch_id
    on public.material_request_fulfillment_batches
    for each row execute function app_private.guard_po_supplemental_pending_wms();
  end if;
end $$;

revoke all on function app_private.guard_po_supplemental_pending_wms() from public;
revoke all on function app_private.guard_po_supplemental_pending_wms() from anon;
