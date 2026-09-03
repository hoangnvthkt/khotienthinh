-- Rich metadata for audit trail entries.
-- Existing columns keep the raw before/after snapshots; these additions make
-- filtering, review, and incident reconstruction faster without changing old rows.

alter table public.audit_trail
  add column if not exists record_label text,
  add column if not exists entity_type text,
  add column if not exists changed_fields text[] default '{}'::text[],
  add column if not exists change_count integer default 0,
  add column if not exists impact_level text default 'normal',
  add column if not exists context jsonb default '{}'::jsonb;

alter table public.audit_trail
  drop constraint if exists audit_trail_impact_level_check;

alter table public.audit_trail
  add constraint audit_trail_impact_level_check
  check (impact_level in ('low', 'normal', 'high', 'critical'));

update public.audit_trail
set
  changed_fields = case
    when action = 'UPDATE' and jsonb_typeof(changes) = 'object'
      then array(select jsonb_object_keys(changes))
    else coalesce(changed_fields, '{}'::text[])
  end,
  change_count = case
    when action = 'UPDATE' and jsonb_typeof(changes) = 'object'
      then (select count(*)::integer from jsonb_object_keys(changes))
    else coalesce(change_count, 0)
  end,
  record_label = coalesce(
    record_label,
    nullif(new_data->>'name', ''),
    nullif(new_data->>'full_name', ''),
    nullif(new_data->>'title', ''),
    nullif(new_data->>'sku', ''),
    nullif(old_data->>'name', ''),
    nullif(old_data->>'full_name', ''),
    nullif(old_data->>'title', ''),
    nullif(old_data->>'sku', ''),
    record_id
  ),
  entity_type = coalesce(entity_type, table_name),
  impact_level = coalesce(impact_level, 'normal'),
  context = coalesce(context, '{}'::jsonb)
where record_label is null
   or entity_type is null
   or changed_fields is null
   or change_count is null
   or impact_level is null
   or context is null;

create index if not exists idx_audit_trail_impact_created_at
  on public.audit_trail (impact_level, created_at desc);

create index if not exists idx_audit_trail_changed_fields
  on public.audit_trail using gin (changed_fields);

create index if not exists idx_audit_trail_context_gin
  on public.audit_trail using gin (context);
