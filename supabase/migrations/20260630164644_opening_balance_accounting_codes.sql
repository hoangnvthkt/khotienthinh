-- Preserve accounting material codes for project opening balance imports.

alter table if exists public.items
  add column if not exists accounting_code text;

create index if not exists idx_items_accounting_code
  on public.items(accounting_code)
  where accounting_code is not null;

alter table if exists public.project_opening_balance_lines
  add column if not exists accounting_code text;

create index if not exists idx_project_opening_balance_lines_accounting_code
  on public.project_opening_balance_lines(accounting_code)
  where accounting_code is not null;

comment on column public.items.accounting_code is
  'Accounting/source material code used to group multiple stock SKUs or specifications under one accounting item.';

comment on column public.project_opening_balance_lines.accounting_code is
  'Accounting/source material code from the imported opening-balance workbook.';

notify pgrst, 'reload schema';
