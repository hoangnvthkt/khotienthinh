-- G2 identity/revision foundation. Public tables are Data API visible but have no
-- authenticated grants; mutations are owned by guarded source writes and later RPCs.

create table public.procurement_owner_contexts (
  id uuid primary key,
  context_type text not null check (context_type in ('company')),
  logical_key text not null unique,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.procurement_owner_contexts(id, context_type, logical_key, display_name)
values ('00000000-0000-4000-8000-000000000001', 'company', 'company_default', 'Company default')
on conflict (logical_key) do nothing;

create table public.procurement_source_documents (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  source_adapter text not null check (source_adapter in ('project_material_request', 'custom_material_request', 'material_budget', 'material_plan', 'purchase_order')),
  source_document_id text not null,
  source_code_snapshot text,
  project_id text,
  construction_site_id text,
  current_revision bigint not null check (current_revision > 0),
  source_hash text not null check (length(source_hash) = 64),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_context_id, source_adapter, source_document_id)
);

create table public.procurement_source_line_registry (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.procurement_source_documents(id) on delete restrict,
  source_line_id text not null check (btrim(source_line_id) <> ''),
  item_id text not null check (btrim(item_id) <> ''),
  unit text not null check (btrim(unit) <> ''),
  work_boq_item_id text references public.project_work_boq_items(id) on delete restrict,
  material_budget_item_id text references public.material_budget_items(id) on delete restrict,
  source_hash text not null check (length(source_hash) = 64),
  first_revision bigint not null check (first_revision > 0),
  last_revision bigint not null check (last_revision >= first_revision),
  downstream_locked boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_document_id, source_line_id)
);

create table public.procurement_source_revisions (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.procurement_source_documents(id) on delete restrict,
  revision bigint not null check (revision > 0),
  source_hash text not null check (length(source_hash) = 64),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_document_id, revision),
  unique (source_document_id, source_hash)
);

create table public.procurement_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  owner_context_id uuid not null references public.procurement_owner_contexts(id) on delete restrict,
  source_adapter text not null,
  source_document_ref text not null,
  source_line_ref text,
  issue_code text not null,
  severity text not null default 'blocking' check (severity in ('warning', 'blocking')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.procurement_owner_contexts enable row level security;
alter table public.procurement_source_documents enable row level security;
alter table public.procurement_source_line_registry enable row level security;
alter table public.procurement_source_revisions enable row level security;
alter table public.procurement_reconciliation_issues enable row level security;

revoke all on public.procurement_owner_contexts from public, anon, authenticated;
revoke all on public.procurement_source_documents from public, anon, authenticated;
revoke all on public.procurement_source_line_registry from public, anon, authenticated;
revoke all on public.procurement_source_revisions from public, anon, authenticated;
revoke all on public.procurement_reconciliation_issues from public, anon, authenticated;
grant all on public.procurement_owner_contexts to service_role;
grant all on public.procurement_source_documents to service_role;
grant all on public.procurement_source_line_registry to service_role;
grant all on public.procurement_source_revisions to service_role;
grant all on public.procurement_reconciliation_issues to service_role;

alter table public.requests
  add column content_revision bigint not null default 1 check (content_revision > 0),
  add column content_hash text,
  add column approved_content_revision bigint,
  add column approved_content_hash text,
  add constraint requests_content_hash_check check (content_hash is null or length(content_hash) = 64),
  add constraint requests_approved_revision_pair_check check (
    (approved_content_revision is null) = (approved_content_hash is null)
  ),
  add constraint requests_approved_revision_range_check check (
    approved_content_revision is null or approved_content_revision <= content_revision
  );

create or replace function app_private.procurement_project_request_content_hash(p_payload jsonb)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(jsonb_build_object(
    'projectId', coalesce(p_payload ->> 'projectId', ''),
    'constructionSiteId', coalesce(p_payload ->> 'constructionSiteId', ''),
    'siteWarehouseId', coalesce(p_payload ->> 'siteWarehouseId', ''),
    'fulfillmentMode', coalesce(p_payload ->> 'fulfillmentMode', ''),
    'expectedDate', coalesce(p_payload ->> 'expectedDate', ''),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(line.value ->> 'lineId', ''),
        'itemId', coalesce(line.value ->> 'itemId', ''),
        'requestQty', coalesce(line.value ->> 'requestQty', ''),
        'unit', coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit', ''),
        'workBoqItemId', coalesce(line.value ->> 'workBoqItemId', ''),
        'materialBudgetItemId', coalesce(line.value ->> 'materialBudgetItemId', '')
      ) order by line.value ->> 'lineId')
      from jsonb_array_elements(coalesce(p_payload -> 'items', '[]'::jsonb)) line(value)
    ), '[]'::jsonb)
  )::text, 'sha256'), 'hex');
$$;

revoke all on function app_private.procurement_project_request_content_hash(jsonb) from public, anon, authenticated;

create or replace function app_private.procurement_request_row_payload(p_request public.requests)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'projectId', p_request.project_id,
    'constructionSiteId', p_request.construction_site_id,
    'siteWarehouseId', p_request.site_warehouse_id,
    'fulfillmentMode', p_request.fulfillment_mode,
    'expectedDate', p_request.expected_date,
    'items', p_request.items
  );
$$;

revoke all on function app_private.procurement_request_row_payload(public.requests) from public, anon, authenticated;

update public.requests request
set content_hash = app_private.procurement_project_request_content_hash(
  app_private.procurement_request_row_payload(request)
)
where request.content_hash is null;

alter table public.requests alter column content_hash set not null;

create or replace function app_private.procurement_guard_project_request_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_invalid boolean;
  v_context boolean := current_setting('app.material_transition_context', true) = 'on';
begin
  if coalesce(new.request_origin, 'wms') <> 'project' then
    if tg_op = 'INSERT' then
      new.content_revision := coalesce(new.content_revision, 1);
      new.content_hash := app_private.procurement_project_request_content_hash(
        app_private.procurement_request_row_payload(new)
      );
    end if;
    return new;
  end if;

  if jsonb_typeof(new.items) <> 'array' then
    raise exception using errcode = '22023', message = 'SOURCE_LINES_INVALID';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(new.items) line(value)
    where nullif(btrim(line.value ->> 'lineId'), '') is null
       or nullif(btrim(line.value ->> 'itemId'), '') is null
       or nullif(btrim(coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit')), '') is null
       or nullif(line.value ->> 'requestQty', '') is null
       or (line.value ->> 'requestQty') !~ '^\d+(\.\d{1,6})?$'
       or (line.value ->> 'requestQty')::numeric < 0
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '22023', message = 'SOURCE_LINE_IDENTITY_INVALID';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.items) line(value)
    group by line.value ->> 'lineId'
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'SOURCE_LINE_ID_DUPLICATE';
  end if;

  v_hash := app_private.procurement_project_request_content_hash(
    app_private.procurement_request_row_payload(new)
  );

  if tg_op = 'INSERT' then
    new.content_revision := 1;
    new.content_hash := v_hash;
    new.approved_content_revision := null;
    new.approved_content_hash := null;
  elsif v_hash is distinct from old.content_hash then
    new.content_revision := old.content_revision + 1;
    new.content_hash := v_hash;
    new.approved_content_revision := null;
    new.approved_content_hash := null;
  else
    new.content_revision := old.content_revision;
    new.content_hash := old.content_hash;
    if not v_context and (
      new.approved_content_revision is distinct from old.approved_content_revision
      or new.approved_content_hash is distinct from old.approved_content_hash
    ) then
      raise exception using errcode = '42501', message = 'SOURCE_APPROVAL_STAMP_FORBIDDEN';
    end if;
  end if;

  if v_context
     and new.status::text = 'APPROVED'
     and (tg_op = 'INSERT' or old.status::text is distinct from 'APPROVED') then
    new.approved_content_revision := new.content_revision;
    new.approved_content_hash := new.content_hash;
  end if;
  return new;
end;
$$;

revoke all on function app_private.procurement_guard_project_request_revision() from public, anon, authenticated;

create or replace function app_private.procurement_source_revision_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'SOURCE_REVISION_IMMUTABLE';
end;
$$;

revoke all on function app_private.procurement_source_revision_immutable() from public, anon, authenticated;

create trigger trg_procurement_source_revision_immutable
before update or delete on public.procurement_source_revisions
for each row execute function app_private.procurement_source_revision_immutable();

create or replace function app_private.procurement_sync_project_request_registry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_document_id uuid;
  v_line jsonb;
  v_line_id text;
  v_item_id text;
  v_unit text;
  v_line_hash text;
begin
  if coalesce(new.request_origin, 'wms') <> 'project' then return new; end if;

  select id into strict v_owner_id
  from public.procurement_owner_contexts
  where logical_key = 'company_default' and context_type = 'company' and is_active
  for share;

  insert into public.procurement_source_documents(
    owner_context_id, source_adapter, source_document_id, source_code_snapshot,
    project_id, construction_site_id, current_revision, source_hash, archived_at
  ) values (
    v_owner_id, 'project_material_request', new.id, new.code,
    new.project_id, new.construction_site_id, new.content_revision, new.content_hash, null
  )
  on conflict (owner_context_id, source_adapter, source_document_id) do update set
    source_code_snapshot = excluded.source_code_snapshot,
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    current_revision = excluded.current_revision,
    source_hash = excluded.source_hash,
    archived_at = null,
    updated_at = now()
  returning id into v_document_id;

  if exists (
    select 1
    from public.procurement_source_line_registry registry
    where registry.source_document_id = v_document_id
      and registry.downstream_locked
      and (
        not exists (
          select 1 from jsonb_array_elements(new.items) line(value)
          where line.value ->> 'lineId' = registry.source_line_id
        )
        or exists (
          select 1 from jsonb_array_elements(new.items) line(value)
          where line.value ->> 'lineId' = registry.source_line_id
            and (
              line.value ->> 'itemId' is distinct from registry.item_id
              or coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit') is distinct from registry.unit
              or nullif(line.value ->> 'workBoqItemId', '') is distinct from registry.work_boq_item_id
              or nullif(line.value ->> 'materialBudgetItemId', '') is distinct from registry.material_budget_item_id
            )
        )
      )
  ) then
    raise exception using errcode = '23514', message = 'SOURCE_LINE_IDENTITY_LOCKED';
  end if;

  update public.procurement_source_line_registry registry
  set archived_at = now(), last_revision = new.content_revision, updated_at = now()
  where registry.source_document_id = v_document_id
    and registry.archived_at is null
    and not exists (
      select 1 from jsonb_array_elements(new.items) line(value)
      where line.value ->> 'lineId' = registry.source_line_id
    );

  for v_line in select value from jsonb_array_elements(new.items)
  loop
    v_line_id := v_line ->> 'lineId';
    v_item_id := v_line ->> 'itemId';
    v_unit := coalesce(v_line ->> 'unitSnapshot', v_line ->> 'unit');
    v_line_hash := encode(extensions.digest(jsonb_build_object(
      'lineId', v_line_id,
      'itemId', v_item_id,
      'requestQty', v_line ->> 'requestQty',
      'unit', v_unit,
      'workBoqItemId', coalesce(v_line ->> 'workBoqItemId', ''),
      'materialBudgetItemId', coalesce(v_line ->> 'materialBudgetItemId', '')
    )::text, 'sha256'), 'hex');

    insert into public.procurement_source_line_registry(
      source_document_id, source_line_id, item_id, unit, work_boq_item_id,
      material_budget_item_id, source_hash, first_revision, last_revision, archived_at
    ) values (
      v_document_id, v_line_id, v_item_id, v_unit,
      nullif(v_line ->> 'workBoqItemId', ''), nullif(v_line ->> 'materialBudgetItemId', ''),
      v_line_hash, new.content_revision, new.content_revision, null
    )
    on conflict (source_document_id, source_line_id) do update set
      item_id = excluded.item_id,
      unit = excluded.unit,
      work_boq_item_id = excluded.work_boq_item_id,
      material_budget_item_id = excluded.material_budget_item_id,
      source_hash = excluded.source_hash,
      last_revision = excluded.last_revision,
      archived_at = null,
      updated_at = now();
  end loop;

  insert into public.procurement_source_revisions(
    source_document_id, revision, source_hash, payload, changed_by
  ) values (
    v_document_id, new.content_revision, new.content_hash,
    app_private.procurement_request_row_payload(new), public.current_app_user_id()
  ) on conflict (source_document_id, revision) do nothing;

  return new;
end;
$$;

revoke all on function app_private.procurement_sync_project_request_registry() from public, anon, authenticated;

create or replace function app_private.procurement_archive_project_request_registry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.request_origin, 'wms') = 'project' then
    if exists (
      select 1
      from public.procurement_source_documents document
      join public.procurement_source_line_registry line on line.source_document_id = document.id
      where document.source_adapter = 'project_material_request'
        and document.source_document_id = old.id
        and line.downstream_locked
    ) then
      raise exception using errcode = '23514', message = 'SOURCE_DOCUMENT_HAS_DOWNSTREAM';
    end if;
    update public.procurement_source_documents
    set archived_at = now(), updated_at = now()
    where source_adapter = 'project_material_request' and source_document_id = old.id;
    update public.procurement_source_line_registry line
    set archived_at = now(), updated_at = now()
    from public.procurement_source_documents document
    where line.source_document_id = document.id
      and document.source_adapter = 'project_material_request'
      and document.source_document_id = old.id;
  end if;
  return old;
end;
$$;

revoke all on function app_private.procurement_archive_project_request_registry() from public, anon, authenticated;

-- Preserve legacy rows without inventing line IDs. Valid identities are registered;
-- ambiguous rows are surfaced for reconciliation and blocked on their next write.
insert into public.procurement_source_documents(
  owner_context_id, source_adapter, source_document_id, source_code_snapshot,
  project_id, construction_site_id, current_revision, source_hash
)
select owner.id, 'project_material_request', request.id, request.code,
  request.project_id, request.construction_site_id, request.content_revision, request.content_hash
from public.requests request
join public.procurement_owner_contexts owner on owner.logical_key = 'company_default'
where request.request_origin = 'project'
on conflict (owner_context_id, source_adapter, source_document_id) do nothing;

insert into public.procurement_source_revisions(source_document_id, revision, source_hash, payload)
select document.id, request.content_revision, request.content_hash,
  app_private.procurement_request_row_payload(request)
from public.requests request
join public.procurement_source_documents document
  on document.source_adapter = 'project_material_request'
 and document.source_document_id = request.id
where request.request_origin = 'project'
on conflict (source_document_id, revision) do nothing;

insert into public.procurement_source_line_registry(
  source_document_id, source_line_id, item_id, unit, work_boq_item_id,
  material_budget_item_id, source_hash, first_revision, last_revision
)
select document.id, line.value ->> 'lineId', line.value ->> 'itemId',
  coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit'),
  nullif(line.value ->> 'workBoqItemId', ''), nullif(line.value ->> 'materialBudgetItemId', ''),
  encode(extensions.digest(line.value::text, 'sha256'), 'hex'),
  request.content_revision, request.content_revision
from public.requests request
join public.procurement_source_documents document
  on document.source_adapter = 'project_material_request'
 and document.source_document_id = request.id
cross join lateral jsonb_array_elements(request.items) line(value)
where request.request_origin = 'project'
  and nullif(btrim(line.value ->> 'lineId'), '') is not null
  and nullif(btrim(line.value ->> 'itemId'), '') is not null
  and nullif(btrim(coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit')), '') is not null
  and not exists (
    select 1 from jsonb_array_elements(request.items) duplicate(value)
    where duplicate.value ->> 'lineId' = line.value ->> 'lineId'
    group by duplicate.value ->> 'lineId' having count(*) > 1
  )
on conflict (source_document_id, source_line_id) do nothing;

insert into public.procurement_reconciliation_issues(
  owner_context_id, source_adapter, source_document_ref, issue_code, details
)
select owner.id, 'project_material_request', request.id, 'LEGACY_LINE_IDENTITY_AMBIGUOUS',
  jsonb_build_object('requestCode', request.code)
from public.requests request
join public.procurement_owner_contexts owner on owner.logical_key = 'company_default'
where request.request_origin = 'project'
  and exists (
    select 1 from jsonb_array_elements(request.items) line(value)
    where nullif(btrim(line.value ->> 'lineId'), '') is null
       or nullif(btrim(line.value ->> 'itemId'), '') is null
       or nullif(btrim(coalesce(line.value ->> 'unitSnapshot', line.value ->> 'unit')), '') is null
       or exists (
         select 1 from jsonb_array_elements(request.items) duplicate(value)
         where duplicate.value ->> 'lineId' = line.value ->> 'lineId'
         group by duplicate.value ->> 'lineId' having count(*) > 1
       )
  );

create trigger trg_procurement_guard_project_request_revision
before insert or update on public.requests
for each row execute function app_private.procurement_guard_project_request_revision();

create trigger trg_procurement_sync_project_request_registry
after insert or update on public.requests
for each row execute function app_private.procurement_sync_project_request_registry();

create trigger trg_procurement_archive_project_request_registry
before delete on public.requests
for each row execute function app_private.procurement_archive_project_request_registry();

create index procurement_source_documents_scope_idx
  on public.procurement_source_documents(project_id, construction_site_id, source_adapter)
  where archived_at is null;
create index procurement_source_lines_item_idx
  on public.procurement_source_line_registry(item_id, unit)
  where archived_at is null;
create index procurement_reconciliation_open_idx
  on public.procurement_reconciliation_issues(owner_context_id, status, created_at)
  where status = 'open';
