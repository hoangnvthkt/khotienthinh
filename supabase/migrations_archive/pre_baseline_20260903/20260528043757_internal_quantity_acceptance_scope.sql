alter table public.quantity_acceptances
  add column if not exists acceptance_scope text not null default 'contract';

update public.quantity_acceptances
set acceptance_scope = 'contract'
where acceptance_scope is null;

alter table public.quantity_acceptances
  drop constraint if exists quantity_acceptances_acceptance_scope_check;

alter table public.quantity_acceptances
  add constraint quantity_acceptances_acceptance_scope_check
  check (acceptance_scope in ('internal', 'contract'));

create index if not exists idx_quantity_acceptances_contract_scope
  on public.quantity_acceptances(contract_id, contract_type, acceptance_scope, period_number);

alter table public.quantity_acceptance_items
  alter column contract_item_id drop not null,
  add column if not exists task_id text references public.project_tasks(id) on delete set null,
  add column if not exists task_name text,
  add column if not exists work_boq_item_id text references public.project_work_boq_items(id) on delete set null,
  add column if not exists work_boq_item_name text;

create index if not exists idx_quantity_acceptance_items_task
  on public.quantity_acceptance_items(task_id);

create index if not exists idx_quantity_acceptance_items_work_boq
  on public.quantity_acceptance_items(work_boq_item_id);

alter table public.quantity_acceptance_items
  drop constraint if exists quantity_acceptance_items_scope_ref_check;

alter table public.quantity_acceptance_items
  add constraint quantity_acceptance_items_scope_ref_check
  check (
    contract_item_id is not null
    or task_id is not null
    or work_boq_item_id is not null
  );

notify pgrst, 'reload schema';
