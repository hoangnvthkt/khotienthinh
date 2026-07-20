-- Fix PO creation after the removal workflow changed project_doc_touch to call
-- a private helper, and make PO numbers non-reusable within each project/site.

create schema if not exists app_private;

create or replace function app_private.project_doc_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marks_submitted boolean := false;
begin
  if tg_table_name = 'purchase_orders' then
    v_marks_submitted := app_private.project_po_status_marks_submitted(new.status::text);

    if tg_op = 'UPDATE'
       and old.archived_at is null
       and new.archived_at is not null
       and old.status is not distinct from new.status
       and old.submitted_to_user_id is not distinct from new.submitted_to_user_id
    then
      return new;
    end if;
  else
    v_marks_submitted := coalesce(new.status::text, 'draft') <> 'draft';
  end if;

  if tg_op = 'INSERT' then
    new.ever_submitted := coalesce(new.ever_submitted, false) or v_marks_submitted;
    new.last_action_by := coalesce(new.last_action_by, public.current_app_user_id()::text);
    new.last_action_at := coalesce(new.last_action_at, now());
    return new;
  end if;

  if old.status is distinct from new.status
     or old.submitted_to_user_id is distinct from new.submitted_to_user_id then
    new.last_action_by := coalesce(new.last_action_by, public.current_app_user_id()::text);
    new.last_action_at := coalesce(new.last_action_at, now());
  end if;

  new.ever_submitted := coalesce(old.ever_submitted, false)
    or coalesce(new.ever_submitted, false)
    or v_marks_submitted;

  return new;
end;
$$;

revoke all on function app_private.project_doc_touch() from public, anon, authenticated;

create unique index if not exists idx_purchase_orders_scope_po_number_unique
on public.purchase_orders (
  coalesce(project_id, ''),
  coalesce(construction_site_id, ''),
  po_number
);

create or replace function public.next_purchase_order_number_v1(
  p_project_id text default null,
  p_construction_site_id text default null,
  p_prefix text default 'PO'
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text := upper(nullif(regexp_replace(trim(coalesce(p_prefix, 'PO')), '[^A-Za-z0-9]+', '-', 'g'), ''));
  v_next integer := 1;
begin
  v_prefix := coalesce(v_prefix, 'PO');

  select coalesce(max((regexp_match(po.po_number, '^' || v_prefix || '-([0-9]+)(?:$|-)'))[1]::integer), 0) + 1
    into v_next
  from public.purchase_orders po
  where coalesce(po.project_id, '') = coalesce(p_project_id, '')
    and coalesce(po.construction_site_id, '') = coalesce(p_construction_site_id, '')
    and po.po_number ~ ('^' || v_prefix || '-[0-9]+($|-)');

  return v_prefix || '-' || lpad(v_next::text, 3, '0');
end;
$$;

revoke all on function public.next_purchase_order_number_v1(text, text, text) from public, anon;
grant execute on function public.next_purchase_order_number_v1(text, text, text) to authenticated;

notify pgrst, 'reload schema';
