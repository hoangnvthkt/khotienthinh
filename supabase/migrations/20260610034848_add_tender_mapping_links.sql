create table if not exists public.tender_internal_mapping_links (
  id text primary key default gen_random_uuid()::text,
  mapping_id text not null references public.tender_internal_mappings(id) on delete cascade,
  package_id text not null references public.tender_packages(id) on delete cascade,
  external_line_id text not null references public.tender_external_boq_lines(id) on delete cascade,
  template_id text references public.cost_templates(id) on delete set null,
  template_section_id text references public.cost_template_sections(id) on delete set null,
  template_item_id text references public.cost_template_items(id) on delete set null,
  work_code text,
  norm_group_code text,
  allocation_type text not null default 'inherit_quantity'
    check (allocation_type in ('inherit_quantity', 'percent', 'fixed_quantity', 'formula')),
  allocation_value numeric(18, 6),
  quantity_formula text,
  note text,
  mapping_source text not null default 'user'
    check (mapping_source in ('ai', 'user', 'rule', 'local')),
  confidence_score numeric(5, 4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tender_pricing_lines
  add column if not exists mapping_link_id text references public.tender_internal_mapping_links(id) on delete set null;

create index if not exists idx_tender_internal_mapping_links_mapping
  on public.tender_internal_mapping_links(mapping_id);
create index if not exists idx_tender_internal_mapping_links_package
  on public.tender_internal_mapping_links(package_id, external_line_id);
create index if not exists idx_tender_internal_mapping_links_template_item
  on public.tender_internal_mapping_links(template_item_id);
create index if not exists idx_tender_pricing_lines_mapping_link
  on public.tender_pricing_lines(mapping_link_id);

drop trigger if exists trg_tender_internal_mapping_links_updated_at on public.tender_internal_mapping_links;
create trigger trg_tender_internal_mapping_links_updated_at
before update on public.tender_internal_mapping_links
for each row execute function public.set_updated_at();

alter table public.tender_internal_mapping_links enable row level security;

grant select, insert, update, delete on public.tender_internal_mapping_links to authenticated;

drop policy if exists tender_internal_mapping_links_access on public.tender_internal_mapping_links;
create policy tender_internal_mapping_links_access on public.tender_internal_mapping_links
for all to authenticated
using (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('TENDER_AI')
        or p.created_by = public.current_app_user_id()
      )
  )
)
with check (
  exists (
    select 1 from public.tender_packages p
    where p.id = package_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('TENDER_AI')
        or p.created_by = public.current_app_user_id()
      )
  )
);

insert into public.tender_internal_mapping_links (
  mapping_id,
  package_id,
  external_line_id,
  template_id,
  template_section_id,
  template_item_id,
  work_code,
  norm_group_code,
  allocation_type,
  mapping_source,
  confidence_score,
  reason,
  metadata,
  created_by
)
select
  m.id,
  m.package_id,
  m.external_line_id,
  m.template_id,
  m.template_section_id,
  m.template_item_id,
  m.work_code,
  m.norm_group_code,
  'inherit_quantity',
  m.mapping_source,
  m.confidence_score,
  m.reason,
  jsonb_build_object('backfilled_from_tender_internal_mappings', true),
  m.reviewed_by
from public.tender_internal_mappings m
where m.template_item_id is not null
  and not exists (
    select 1 from public.tender_internal_mapping_links l
    where l.mapping_id = m.id
      and l.template_item_id = m.template_item_id
  );
