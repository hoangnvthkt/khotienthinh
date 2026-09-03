-- Update RLS policies for budget and expense tables to allow EX module administrators and Admins to perform CRUD.

-- 1. budget_categories
alter table public.budget_categories enable row level security;

drop policy if exists budget_cat_delete on public.budget_categories;
drop policy if exists budget_cat_update on public.budget_categories;
drop policy if exists budget_cat_write on public.budget_categories;

create policy budget_cat_delete
  on public.budget_categories
  for delete
  to public
  using (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

create policy budget_cat_update
  on public.budget_categories
  for update
  to public
  using (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  )
  with check (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

create policy budget_cat_write
  on public.budget_categories
  for insert
  to public
  with check (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

-- 2. budget_entries
alter table public.budget_entries enable row level security;

drop policy if exists budget_entries_delete on public.budget_entries;
drop policy if exists budget_entries_update on public.budget_entries;
drop policy if exists budget_entries_write on public.budget_entries;

create policy budget_entries_delete
  on public.budget_entries
  for delete
  to public
  using (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

create policy budget_entries_update
  on public.budget_entries
  for update
  to public
  using (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  )
  with check (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

create policy budget_entries_write
  on public.budget_entries
  for insert
  to public
  with check (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

-- 3. expense_records
alter table public.expense_records enable row level security;

drop policy if exists expense_records_delete on public.expense_records;
drop policy if exists expense_records_update on public.expense_records;
drop policy if exists expense_records_write on public.expense_records;

create policy expense_records_delete
  on public.expense_records
  for delete
  to public
  using (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

create policy expense_records_update
  on public.expense_records
  for update
  to public
  using (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  )
  with check (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );

create policy expense_records_write
  on public.expense_records
  for insert
  to public
  with check (
    public.is_admin() 
    or public.is_module_admin('EX'::text)
  );
