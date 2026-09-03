-- Safety equipment document checklist
-- Reuses safety_equipment_documents as the per-equipment missing-document checklist.

alter table public.safety_equipment_documents
  add column if not exists is_done boolean not null default false,
  add column if not exists done_by text,
  add column if not exists done_at timestamptz,
  add column if not exists sort_order integer not null default 0;

update public.safety_equipment_documents
set
  is_done = true,
  done_at = coalesce(done_at, updated_at, created_at)
where status in ('submitted', 'approved')
  and is_done is distinct from true;

create index if not exists idx_safety_equipment_documents_checklist_order
  on public.safety_equipment_documents(equipment_id, sort_order, created_at);

create or replace function app_private.sync_safety_equipment_documents_status(p_equipment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_done integer;
  v_next_status text;
begin
  if p_equipment_id is null then
    return;
  end if;

  select count(*), count(*) filter (where is_done)
    into v_total, v_done
  from public.safety_equipment_documents
  where equipment_id = p_equipment_id;

  v_next_status := case
    when coalesce(v_total, 0) = 0 then 'missing'
    when v_done = v_total then 'complete'
    else 'partial'
  end;

  update public.safety_equipment
  set documents_status = v_next_status,
      updated_at = now()
  where id = p_equipment_id
    and documents_status is distinct from v_next_status;
end;
$$;

create or replace function app_private.normalize_safety_equipment_document_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_done then
    new.done_at := coalesce(new.done_at, now());
    new.done_by := coalesce(new.done_by, public.current_app_user_id()::text);
    if new.status = 'missing' then
      new.status := 'submitted';
    end if;
  else
    new.done_at := null;
    new.done_by := null;
    if new.status in ('submitted', 'approved') then
      new.status := 'missing';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.touch_safety_equipment_document_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform app_private.sync_safety_equipment_documents_status(old.equipment_id);
    return old;
  end if;

  perform app_private.sync_safety_equipment_documents_status(new.equipment_id);
  if tg_op = 'UPDATE' and old.equipment_id is distinct from new.equipment_id then
    perform app_private.sync_safety_equipment_documents_status(old.equipment_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_safety_equipment_documents_checklist_normalize on public.safety_equipment_documents;
create trigger trg_safety_equipment_documents_checklist_normalize
before insert or update of is_done, done_by, done_at, status on public.safety_equipment_documents
for each row execute function app_private.normalize_safety_equipment_document_checklist();

drop trigger if exists trg_safety_equipment_documents_checklist_status on public.safety_equipment_documents;
create trigger trg_safety_equipment_documents_checklist_status
after insert or update of equipment_id, is_done, status or delete on public.safety_equipment_documents
for each row execute function app_private.touch_safety_equipment_document_checklist();

do $$
declare
  v_equipment_id uuid;
begin
  for v_equipment_id in
    select id from public.safety_equipment
  loop
    perform app_private.sync_safety_equipment_documents_status(v_equipment_id);
  end loop;
end $$;
