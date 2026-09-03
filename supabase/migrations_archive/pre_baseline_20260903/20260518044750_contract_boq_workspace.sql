-- Contract workspace: BOQ versions, appendices and linked payment schedules.
-- This migration extends the existing FastCons contract tables instead of
-- creating a parallel BOQ data model.

do $$
begin
  if to_regclass('public.contract_items') is not null then
    alter table public.contract_items
      add column if not exists project_id text,
      add column if not exists description text,
      add column if not exists category text,
      add column if not exists brand text,
      add column if not exists origin text,
      add column if not exists technical_spec text,
      add column if not exists length numeric default 0,
      add column if not exists width numeric default 0,
      add column if not exists height numeric default 0,
      add column if not exists material_unit_price numeric default 0,
      add column if not exists labor_unit_price numeric default 0,
      add column if not exists machine_unit_price numeric default 0,
      add column if not exists original_quantity numeric,
      add column if not exists original_unit_price numeric,
      add column if not exists original_total_price numeric,
      add column if not exists variation_quantity numeric not null default 0,
      add column if not exists variation_amount numeric not null default 0,
      add column if not exists revised_quantity numeric,
      add column if not exists revised_unit_price numeric,
      add column if not exists revised_total_price numeric,
      add column if not exists is_locked boolean not null default false,
      add column if not exists locked_at timestamptz,
      add column if not exists work_code text;

    update public.contract_items
      set original_quantity = coalesce(original_quantity, quantity),
          original_unit_price = coalesce(original_unit_price, unit_price),
          original_total_price = coalesce(original_total_price, total_price),
          revised_quantity = coalesce(revised_quantity, quantity + coalesce(variation_quantity, 0)),
          revised_unit_price = coalesce(revised_unit_price, unit_price),
          revised_total_price = coalesce(revised_total_price, total_price + coalesce(variation_amount, 0));

    create index if not exists idx_contract_items_contract_code
      on public.contract_items(contract_id, contract_type, code);
  end if;
end $$;

create table if not exists public.contract_item_resources (
  id uuid primary key default gen_random_uuid(),
  contract_item_id uuid not null references public.contract_items(id) on delete cascade,
  resource_type text not null check (resource_type in ('material', 'labor', 'machine')),
  code text,
  name text not null,
  unit text,
  norm numeric not null default 0,
  coefficient numeric not null default 1,
  quantity numeric not null default 0,
  unit_price numeric not null default 0,
  total_price numeric not null default 0,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_item_resources_item
  on public.contract_item_resources(contract_item_id);

create table if not exists public.contract_appendices (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  contract_type text not null check (contract_type in ('customer', 'subcontractor')),
  project_id text,
  construction_site_id uuid,
  appendix_number text not null,
  name text not null,
  signed_date date,
  value numeric not null default 0,
  status text not null default 'draft' check (status in ('draft', 'signed', 'active', 'cancelled')),
  variation_ids jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contract_appendices_contract
  on public.contract_appendices(contract_id, contract_type);
create index if not exists idx_contract_appendices_site
  on public.contract_appendices(construction_site_id);

do $$
begin
  if to_regclass('public.contract_variations') is not null then
    alter table public.contract_variations
      add column if not exists adjustment_date date default current_date,
      add column if not exists version_number integer,
      add column if not exists discount_percent numeric not null default 0,
      add column if not exists discount_amount numeric not null default 0,
      add column if not exists overhead_cost numeric not null default 0,
      add column if not exists vat_percent numeric not null default 0,
      add column if not exists vat_amount numeric not null default 0,
      add column if not exists contract_value_after numeric not null default 0,
      add column if not exists attachments jsonb not null default '[]'::jsonb,
      add column if not exists appendix_id uuid references public.contract_appendices(id) on delete set null;

    create index if not exists idx_contract_variations_version
      on public.contract_variations(contract_id, contract_type, version_number);
  end if;

  if to_regclass('public.contract_variation_items') is not null then
    alter table public.contract_variation_items
      add column if not exists action_type text not null default 'update_quantity'
        check (action_type in ('update_quantity', 'update_price', 'add_item', 'reduce_remove')),
      add column if not exists before_quantity numeric,
      add column if not exists after_quantity numeric,
      add column if not exists before_unit_price numeric,
      add column if not exists after_unit_price numeric,
      add column if not exists before_amount numeric,
      add column if not exists after_amount numeric,
      add column if not exists metadata jsonb not null default '{}'::jsonb;
  end if;
end $$;

do $$
begin
  if to_regclass('public.payment_schedules') is not null then
    alter table public.payment_schedules
      add column if not exists contract_id uuid,
      add column if not exists contract_type text check (contract_type in ('customer', 'subcontractor')),
      add column if not exists appendix_id uuid references public.contract_appendices(id) on delete set null;

    create index if not exists idx_payment_schedules_contract
      on public.payment_schedules(contract_id, contract_type);
    create index if not exists idx_payment_schedules_appendix
      on public.payment_schedules(appendix_id);
  end if;
end $$;

create or replace function public.approve_contract_variation(
  p_variation_id uuid,
  p_user_id text default null
) returns void
language plpgsql
as $$
declare
  v record;
  line record;
  next_order integer;
  new_item_id uuid;
  new_variation_quantity numeric;
  new_variation_amount numeric;
  base_unit_price numeric;
  contract_project_id text;
begin
  select *
    into v
    from public.contract_variations
    where id = p_variation_id
    for update;

  if not found then
    raise exception 'Không tìm thấy phiếu điều chỉnh BOQ.';
  end if;

  if v.status in ('approved', 'cancelled') then
    raise exception 'Phiếu điều chỉnh đã kết thúc, không thể duyệt lại.';
  end if;

  update public.contract_variations
    set status = 'approved',
        approved_by = p_user_id,
        approved_at = now(),
        updated_at = now()
    where id = p_variation_id;

  if v.contract_type = 'customer' then
    select project_id::text into contract_project_id
      from public.customer_contracts
      where id = v.contract_id;
  elsif v.contract_type = 'subcontractor' then
    select project_id::text into contract_project_id
      from public.subcontractor_contracts
      where id = v.contract_id;
  end if;

  for line in
    select *
      from public.contract_variation_items
      where variation_id = p_variation_id
      order by created_at asc
  loop
    if line.contract_item_id is not null then
      select
        coalesce(variation_quantity, 0) + coalesce(line.quantity_delta, 0),
        coalesce(variation_amount, 0) + coalesce(line.amount_delta, 0),
        coalesce(line.after_unit_price, revised_unit_price, unit_price)
        into new_variation_quantity, new_variation_amount, base_unit_price
        from public.contract_items
        where id = line.contract_item_id
        for update;

      update public.contract_items
        set variation_quantity = new_variation_quantity,
            variation_amount = new_variation_amount,
            revised_quantity = coalesce(quantity, 0) + new_variation_quantity,
            revised_unit_price = base_unit_price,
            revised_total_price = coalesce(total_price, 0) + new_variation_amount
        where id = line.contract_item_id;
    else
      select coalesce(max("order"), 0) + 1
        into next_order
        from public.contract_items
        where contract_id = v.contract_id
          and contract_type = v.contract_type;

      insert into public.contract_items (
        contract_id, contract_type, project_id, construction_site_id,
        code, name, unit, quantity, unit_price, total_price,
        original_quantity, original_unit_price, original_total_price,
        variation_quantity, variation_amount, revised_quantity,
        revised_unit_price, revised_total_price,
        description, category, brand, origin, technical_spec,
        length, width, height,
        material_unit_price, labor_unit_price, machine_unit_price,
        work_code, "order", note
      )
      values (
        v.contract_id, v.contract_type, contract_project_id, v.construction_site_id,
        line.code, line.name, line.unit,
        0, coalesce(line.unit_price, line.after_unit_price, 0), 0,
        0, coalesce(line.unit_price, line.after_unit_price, 0), 0,
        coalesce(line.quantity_delta, line.after_quantity, 0),
        coalesce(line.amount_delta, line.after_amount, 0),
        coalesce(line.quantity_delta, line.after_quantity, 0),
        coalesce(line.after_unit_price, line.unit_price, 0),
        coalesce(line.amount_delta, line.after_amount, 0),
        nullif(line.metadata->>'description', ''),
        nullif(line.metadata->>'category', ''),
        nullif(line.metadata->>'brand', ''),
        nullif(line.metadata->>'origin', ''),
        nullif(line.metadata->>'technicalSpec', ''),
        coalesce(nullif(line.metadata->>'length', '')::numeric, 0),
        coalesce(nullif(line.metadata->>'width', '')::numeric, 0),
        coalesce(nullif(line.metadata->>'height', '')::numeric, 0),
        coalesce(nullif(line.metadata->>'materialUnitPrice', '')::numeric, 0),
        coalesce(nullif(line.metadata->>'laborUnitPrice', '')::numeric, 0),
        coalesce(nullif(line.metadata->>'machineUnitPrice', '')::numeric, 0),
        nullif(line.metadata->>'workCode', ''),
        next_order,
        'Tạo từ điều chỉnh BOQ ' || v.code
      )
      returning id into new_item_id;

      update public.contract_variation_items
        set contract_item_id = new_item_id,
            before_quantity = coalesce(before_quantity, 0),
            after_quantity = coalesce(after_quantity, quantity_delta, 0),
            before_amount = coalesce(before_amount, 0),
            after_amount = coalesce(after_amount, amount_delta, 0)
        where id = line.id;
    end if;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('public.contract_item_resources') is not null then
    alter table public.contract_item_resources enable row level security;
    drop policy if exists "contract_item_resources_access" on public.contract_item_resources;
    create policy "contract_item_resources_access"
      on public.contract_item_resources
      for all to authenticated
      using (true)
      with check (true);
  end if;

  if to_regclass('public.contract_appendices') is not null then
    alter table public.contract_appendices enable row level security;
    drop policy if exists "contract_appendices_access" on public.contract_appendices;
    create policy "contract_appendices_access"
      on public.contract_appendices
      for all to authenticated
      using (true)
      with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.contract_item_resources to authenticated;
grant select, insert, update, delete on public.contract_appendices to authenticated;
grant execute on function public.approve_contract_variation(uuid, text) to authenticated;

notify pgrst, 'reload schema';
