-- Run only on the approved non-production Cloud branch inside an outer transaction.
-- The harness must ROLLBACK after this script.

alter table public.requests disable trigger trg_enforce_material_request_code_v1;

insert into public.users(id, name, email, username)
values ('11111111-1111-4111-8111-111111111111', 'G2 Actor', 'g2@example.invalid', 'g2-actor');
insert into public.projects(id, code, name)
values ('g2-project', 'G2P', 'G2 Project');
insert into public.warehouse_types(code, name)
values ('G2_TEST', 'G2 test warehouse');
insert into public.warehouses(id, name, address, type)
values ('g2-warehouse', 'G2 Warehouse', 'Test', 'G2_TEST');

insert into public.requests(
  id, code, title, site_warehouse_id, requester_id, status, items,
  created_date, expected_date, project_id, construction_site_id,
  request_origin, workflow_step
) values (
  'g2-mr', 'MR-2026-9999', 'G2 test', 'g2-warehouse',
  '11111111-1111-4111-8111-111111111111', 'DRAFT',
  '[{"lineId":"line-a","itemId":"item-a","requestQty":100,"unitSnapshot":"kg"},{"lineId":"line-b","itemId":"item-b","requestQty":5,"unitSnapshot":"bao"}]',
  now(), now(), 'g2-project', 'g2-site', 'project', 'draft'
);

do $$
declare v_request public.requests%rowtype; v_count integer;
begin
  select * into strict v_request from public.requests where id = 'g2-mr';
  if v_request.content_revision <> 1 or v_request.approved_content_revision is not null then
    raise exception 'G2_T2_INITIAL_REVISION_FAILED';
  end if;
  select count(*) into v_count
  from public.procurement_source_line_registry line
  join public.procurement_source_documents document on document.id = line.source_document_id
  where document.source_document_id = 'g2-mr' and line.archived_at is null;
  if v_count <> 2 then raise exception 'G2_T2_REGISTRY_FAILED'; end if;
end $$;

update public.requests
set items = '[{"lineId":"line-b","itemId":"item-b","requestQty":5,"unitSnapshot":"bao"},{"lineId":"line-a","itemId":"item-a","requestQty":100,"unitSnapshot":"kg"}]'
where id = 'g2-mr';

do $$
begin
  if (select content_revision from public.requests where id = 'g2-mr') <> 1 then
    raise exception 'G2_T2_REORDER_CHANGED_REVISION';
  end if;
end $$;

select set_config('app.material_transition_context', 'on', true);
update public.requests set status = 'APPROVED', workflow_step = 'batch_planning' where id = 'g2-mr';
select set_config('app.material_transition_context', '', true);

do $$
begin
  if exists (
    select 1 from public.requests
    where id = 'g2-mr'
      and (approved_content_revision is distinct from content_revision
        or approved_content_hash is distinct from content_hash)
  ) then raise exception 'G2_T2_APPROVAL_BINDING_FAILED'; end if;
end $$;

update public.requests
set items = '[{"lineId":"line-a","itemId":"item-a","requestQty":150,"unitSnapshot":"kg"},{"lineId":"line-b","itemId":"item-b","requestQty":5,"unitSnapshot":"bao"}]'
where id = 'g2-mr';

do $$
begin
  if not exists (
    select 1 from public.requests
    where id = 'g2-mr' and content_revision = 2
      and approved_content_revision is null and approved_content_hash is null
  ) then raise exception 'G2_T2_EDIT_DID_NOT_INVALIDATE_APPROVAL'; end if;

  begin
    update public.requests
    set items = '[{"lineId":"same","itemId":"a","requestQty":1,"unitSnapshot":"kg"},{"lineId":"same","itemId":"b","requestQty":1,"unitSnapshot":"kg"}]'
    where id = 'g2-mr';
    raise exception 'G2_T2_DUPLICATE_NOT_REJECTED';
  exception when sqlstate '22023' then
    if sqlerrm <> 'SOURCE_LINE_ID_DUPLICATE' then raise; end if;
  end;

  begin
    update public.requests
    set approved_content_revision = content_revision, approved_content_hash = content_hash
    where id = 'g2-mr';
    raise exception 'G2_T2_DIRECT_APPROVAL_STAMP_NOT_REJECTED';
  exception when sqlstate '42501' then
    if sqlerrm <> 'SOURCE_APPROVAL_STAMP_FORBIDDEN' then raise; end if;
  end;
end $$;

update public.procurement_source_line_registry line
set downstream_locked = true
from public.procurement_source_documents document
where line.source_document_id = document.id
  and document.source_document_id = 'g2-mr'
  and line.source_line_id = 'line-a';

do $$
begin
  begin
    update public.requests
    set items = '[{"lineId":"line-a","itemId":"item-changed","requestQty":150,"unitSnapshot":"kg"},{"lineId":"line-b","itemId":"item-b","requestQty":5,"unitSnapshot":"bao"}]'
    where id = 'g2-mr';
    raise exception 'G2_T2_LOCKED_IDENTITY_NOT_REJECTED';
  exception when sqlstate '23514' then
    if sqlerrm <> 'SOURCE_LINE_IDENTITY_LOCKED' then raise; end if;
  end;
end $$;
