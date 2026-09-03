-- Company-level procurement and global material-request numbering.

create schema if not exists app_private;

-- Purchase orders created by the company procurement desk have no single
-- project/site owner. Individual request-line links keep the project/site scope.
alter table if exists public.purchase_orders
  drop constraint if exists purchase_orders_source_mode_check;

alter table if exists public.purchase_orders
  add constraint purchase_orders_source_mode_check
  check (source_mode in ('from_request', 'proactive_project', 'proactive_stock', 'company_consolidated'));

create index if not exists idx_purchase_orders_company_procurement_created
  on public.purchase_orders(source_mode, created_at desc, id desc)
  where archived_at is null and source_mode = 'company_consolidated';

-- Historical duplicate PO numbers must be normalized before enforcing global
-- uniqueness. Keep the oldest row and assign new system numbers to later rows.
do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.purchase_orders'::regclass
      and tgname = 'trg_enforce_purchase_order_number_v2'
      and not tgisinternal
  ) then
    alter table public.purchase_orders disable trigger trg_enforce_purchase_order_number_v2;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.purchase_orders'::regclass
      and tgname = 'trg_enforce_purchase_order_archive_update'
      and not tgisinternal
  ) then
    alter table public.purchase_orders disable trigger trg_enforce_purchase_order_archive_update;
  end if;
end $$;

do $$
declare
  v_row record;
  v_new_po_number text;
begin
  for v_row in
    with ranked as (
      select
        po.id,
        po.po_number,
        row_number() over (
          partition by po.po_number
          order by coalesce(po.created_at, now()), po.id
        ) as rn
      from public.purchase_orders po
      where nullif(trim(po.po_number), '') is not null
    )
    select id, po_number
    from ranked
    where rn > 1
    order by po_number, id
  loop
    v_new_po_number := public.next_purchase_order_number_v2();

    update public.purchase_orders po
    set
      po_number = v_new_po_number,
      note = trim(both from concat_ws(E'\n',
        nullif(po.note, ''),
        '[system] Renumbered duplicate PO from ' || v_row.po_number || ' to ' || v_new_po_number || ' on 2026-06-20.'
      ))
    where po.id = v_row.id;

    update app_private.purchase_order_number_registry registry
    set purchase_order_id = v_row.id::text
    where registry.po_number = v_new_po_number;
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.purchase_orders'::regclass
      and tgname = 'trg_enforce_purchase_order_number_v2'
      and not tgisinternal
  ) then
    alter table public.purchase_orders enable trigger trg_enforce_purchase_order_number_v2;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.purchase_orders'::regclass
      and tgname = 'trg_enforce_purchase_order_archive_update'
      and not tgisinternal
  ) then
    alter table public.purchase_orders enable trigger trg_enforce_purchase_order_archive_update;
  end if;
end $$;

create unique index if not exists idx_purchase_orders_po_number_unique_global
  on public.purchase_orders(po_number)
  where nullif(trim(po_number), '') is not null;

-- Material-request numbers are issued globally across all projects/sites and
-- are reserved forever, just like PO numbers.
create table if not exists app_private.material_request_code_counters (
  year integer primary key,
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists app_private.material_request_code_registry (
  code text primary key,
  request_id text,
  issued_at timestamptz not null default now()
);

insert into app_private.material_request_code_registry(code, request_id, issued_at)
select distinct on (r.code)
  r.code,
  r.id::text,
  coalesce(r.created_at, r.created_date, now())
from public.requests r
where nullif(trim(r.code), '') is not null
  and r.code ~ '^MR-[0-9]{4}-[0-9]+$'
order by r.code, coalesce(r.created_at, r.created_date, now()), r.id
on conflict (code) do nothing;

insert into app_private.material_request_code_counters(year, value)
select
  substring(r.code from '^MR-([0-9]{4})-[0-9]+$')::integer as year,
  max(substring(r.code from '^MR-[0-9]{4}-([0-9]+)$')::bigint) as value
from public.requests r
where r.code ~ '^MR-[0-9]{4}-[0-9]+$'
group by substring(r.code from '^MR-([0-9]{4})-[0-9]+$')::integer
on conflict (year) do update
set
  value = greatest(app_private.material_request_code_counters.value, excluded.value),
  updated_at = now();

create or replace function public.next_material_request_code_v1(p_year integer default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_year integer := coalesce(p_year, extract(year from now())::integer);
  v_next bigint;
  v_code text;
begin
  if v_year < 2000 or v_year > 2999 then
    raise exception 'Invalid material request year %.', v_year
      using errcode = '22023';
  end if;

  loop
    insert into app_private.material_request_code_counters(year, value, updated_at)
    values (v_year, 1, now())
    on conflict (year) do update
      set value = app_private.material_request_code_counters.value + 1,
          updated_at = now()
    returning value into v_next;

    v_code := 'MR-' || v_year::text || '-' || lpad(v_next::text, 4, '0');

    insert into app_private.material_request_code_registry(code)
    values (v_code)
    on conflict (code) do nothing;

    if found and not exists (
      select 1
      from public.requests r
      where r.code = v_code
    ) then
      return v_code;
    end if;
  end loop;
end;
$$;

do $$
declare
  v_row record;
  v_new_code text;
  v_target_year integer;
begin
  for v_row in
    with ranked as (
      select
        r.id,
        r.code,
        row_number() over (
          partition by r.code
          order by coalesce(r.created_at, r.created_date, now()), r.id
        ) as rn
      from public.requests r
      where nullif(trim(r.code), '') is not null
    )
    select id, code
    from ranked
    where rn > 1
    order by code, id
  loop
    v_target_year := nullif(substring(v_row.code from '^MR-([0-9]{4})-[0-9]+$'), '')::integer;
    if v_target_year is null or v_target_year < 2000 or v_target_year > 2999 then
      v_target_year := extract(year from now())::integer;
    end if;
    v_new_code := public.next_material_request_code_v1(v_target_year);

    update public.requests r
    set
      code = v_new_code,
      note = trim(both from concat_ws(E'\n',
        nullif(r.note, ''),
        '[system] Renumbered duplicate MR from ' || v_row.code || ' to ' || v_new_code || ' on 2026-06-20.'
      ))
    where r.id = v_row.id;

    update app_private.material_request_code_registry registry
    set request_id = v_row.id::text
    where registry.code = v_new_code;
  end loop;
end $$;

create unique index if not exists idx_requests_code_unique_global
  on public.requests(code)
  where nullif(trim(code), '') is not null;

create or replace function app_private.enforce_material_request_code_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.code is distinct from new.code then
      raise exception 'Material request code is system-generated and cannot be edited.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Supabase upsert fires the INSERT trigger before resolving an existing id.
  if exists (
    select 1
    from public.requests r
    where r.id = new.id
      and r.code = new.code
  ) then
    return new;
  end if;

  if nullif(trim(coalesce(new.code, '')), '') is null then
    new.code := public.next_material_request_code_v1();
  end if;

  if new.code !~ '^MR-[0-9]{4}-[0-9]{4,}$' then
    raise exception 'Invalid material request code %. The system must issue MR-YYYY-0001 style codes.', new.code
      using errcode = '23514';
  end if;

  update app_private.material_request_code_registry registry
  set request_id = new.id::text
  where registry.code = new.code
    and registry.request_id is null;

  if not found then
    raise exception 'Material request code % was not issued or has already been used.', new.code
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_material_request_code_v1 on public.requests;
create trigger trg_enforce_material_request_code_v1
  before insert or update of code on public.requests
  for each row execute function app_private.enforce_material_request_code_v1();

-- Company procurement authorization.
create or replace function app_private.company_procurement_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('PROCUREMENT')
    or app_private.current_user_is_global_wms_keeper();
$$;

create or replace function app_private.purchase_order_link_can_access(
  p_purchase_order_id text,
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.company_procurement_can_manage()
    or app_private.project_doc_can_view(p_project_id, p_construction_site_id, null)
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and po.archived_at is null
        and (
          (
            po.source_mode = 'company_consolidated'
            and app_private.company_procurement_can_manage()
          )
          or app_private.project_doc_can_view(po.project_id, po.construction_site_id, po.submitted_to_user_id)
        )
    );
$$;

create or replace function app_private.company_purchase_order_can_view_from_links(
  p_purchase_order_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_order_request_lines porl
    where porl.purchase_order_id = p_purchase_order_id
      and app_private.project_doc_can_view(
        porl.project_id,
        porl.construction_site_id,
        null
      )
  );
$$;

create or replace function app_private.purchase_order_delivery_group_can_access(
  p_purchase_order_id text,
  p_project_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.company_procurement_can_manage()
    or app_private.project_doc_can_view(p_project_id, null, null)
    or exists (
      select 1
      from public.purchase_orders po
      where po.id = p_purchase_order_id
        and po.archived_at is null
        and (
          (
            po.source_mode = 'company_consolidated'
            and app_private.company_procurement_can_manage()
          )
          or app_private.project_doc_can_view(po.project_id, po.construction_site_id, po.submitted_to_user_id)
        )
    );
$$;

-- Extend project material request visibility/update for the procurement desk.
create or replace function app_private.material_request_can_select(
  p_request_origin text,
  p_project_id text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then
      p_project_id is not null
      and (
        app_private.project_doc_can_view(p_project_id, null, p_submitted_to_user_id)
        or app_private.company_procurement_can_manage()
      )
    else app_private.wms_request_can_access(
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_can_update(
  p_request_origin text,
  p_project_id text,
  p_status text,
  p_requester_id uuid,
  p_submitted_to_user_id text,
  p_source_warehouse_id text,
  p_site_warehouse_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_request_origin, 'wms') = 'project' then
      app_private.company_procurement_can_manage()
      or app_private.project_request_can_write(p_project_id)
      or app_private.project_doc_can_update_step(p_project_id, null, p_status, p_submitted_to_user_id)
    else app_private.wms_request_can_access(
      p_requester_id,
      p_submitted_to_user_id,
      p_source_warehouse_id,
      p_site_warehouse_id
    )
  end;
$$;

create or replace function app_private.material_request_fulfillment_can_view(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.company_procurement_can_manage()
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and (
          r.requester_id::text = public.current_app_user_id()::text
          or r.submitted_to_user_id = public.current_app_user_id()::text
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(r.source_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(r.site_warehouse_id)
          or app_private.project_doc_can_view(
            r.project_id::text,
            r.construction_site_id::text,
            r.submitted_to_user_id
          )
        )
    );
$$;

create or replace function app_private.material_request_fulfillment_can_mutate(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_admin()
    or public.is_module_admin('WMS')
    or app_private.company_procurement_can_manage()
    or exists (
      select 1
      from public.requests r
      where r.id = p_request_id
        and (
          (
            r.submitted_to_user_id is not null
            and r.submitted_to_user_id = public.current_app_user_id()::text
          )
          or app_private.project_request_can_write(r.project_id)
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(r.source_warehouse_id)
          or app_private.current_user_is_wms_keeper_for(r.site_warehouse_id)
        )
    );
$$;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select
  on public.purchase_orders
  for select
  to authenticated
  using (
    archived_at is null
    and (
      app_private.project_doc_can_view(project_id, construction_site_id, submitted_to_user_id)
      or app_private.current_user_is_global_wms_keeper()
      or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
      or (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
      or (source_mode = 'company_consolidated' and app_private.company_purchase_order_can_view_from_links(id))
    )
  );

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    public.is_admin()
    or (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
    or app_private.project_user_has_permission(project_id, construction_site_id, 'submit')
    or app_private.project_user_has_permission(project_id, construction_site_id, 'edit')
  );

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update
  on public.purchase_orders
  for update
  to authenticated
  using (
    archived_at is null
    and (
      (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
      or app_private.project_po_can_update(project_id, construction_site_id, status, submitted_to_user_id)
      or (
        status in ('in_transit', 'partial')
        and (
          app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
        )
      )
    )
  )
  with check (
    archived_at is null
    and (
      (source_mode = 'company_consolidated' and app_private.company_procurement_can_manage())
      or (
        (project_id is not null or construction_site_id is not null or public.is_admin())
        and (
          app_private.project_po_can_update(project_id, construction_site_id, status, submitted_to_user_id)
          or app_private.current_user_is_global_wms_keeper()
          or app_private.current_user_is_wms_keeper_for(target_warehouse_id)
        )
      )
    )
  );

drop policy if exists purchase_order_request_lines_project_access
  on public.purchase_order_request_lines;
create policy purchase_order_request_lines_project_access
  on public.purchase_order_request_lines
  for all
  to authenticated
  using (
    app_private.purchase_order_link_can_access(
      purchase_order_id,
      project_id,
      construction_site_id
    )
  )
  with check (
    app_private.purchase_order_link_can_access(
      purchase_order_id,
      project_id,
      construction_site_id
    )
  );

revoke all on table app_private.material_request_code_counters from public, anon, authenticated;
revoke all on table app_private.material_request_code_registry from public, anon, authenticated;
revoke all on function public.next_material_request_code_v1(integer) from public, anon;
grant execute on function public.next_material_request_code_v1(integer) to authenticated;
revoke all on function app_private.enforce_material_request_code_v1() from public, anon, authenticated;
revoke all on function app_private.company_procurement_can_manage() from public, anon, authenticated;
revoke all on function app_private.company_purchase_order_can_view_from_links(text) from public, anon, authenticated;
revoke all on function app_private.purchase_order_link_can_access(text, text, text) from public, anon, authenticated;
revoke all on function app_private.purchase_order_delivery_group_can_access(text, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
