create table if not exists public.custom_material_import_mapping_profiles (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null default 'company' check (scope_type in ('company')),
  scope_id text not null default 'default',
  template_key text not null check (template_key in ('generic', 'xa_go')),
  signature_hash text not null,
  mapping_json jsonb not null default '{}'::jsonb,
  sample_headers jsonb not null default '[]'::jsonb,
  confidence_score numeric not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  success_count integer not null default 0 check (success_count >= 0),
  last_used_at timestamptz,
  created_by uuid default public.current_app_user_id() references public.users(id) on delete set null,
  updated_by uuid default public.current_app_user_id() references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_id, template_key, signature_hash)
);

create index if not exists custom_material_import_mapping_profiles_template_last_used_idx
  on public.custom_material_import_mapping_profiles (template_key, last_used_at desc);

drop trigger if exists custom_material_import_mapping_profiles_updated_at on public.custom_material_import_mapping_profiles;
create trigger custom_material_import_mapping_profiles_updated_at
before update on public.custom_material_import_mapping_profiles
for each row execute function public.set_project_workflow_updated_at();

alter table public.custom_material_import_mapping_profiles enable row level security;

drop policy if exists custom_material_import_mapping_profiles_select on public.custom_material_import_mapping_profiles;
create policy custom_material_import_mapping_profiles_select
on public.custom_material_import_mapping_profiles
for select
to authenticated
using (
  public.is_admin()
  or public.is_module_admin('DA')
  or public.is_module_admin('WMS')
  or app_private.company_procurement_can_manage()
  or created_by = public.current_app_user_id()
);

drop policy if exists custom_material_import_mapping_profiles_insert on public.custom_material_import_mapping_profiles;
create policy custom_material_import_mapping_profiles_insert
on public.custom_material_import_mapping_profiles
for insert
to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('DA')
  or public.is_module_admin('WMS')
  or app_private.company_procurement_can_manage()
  or created_by = public.current_app_user_id()
);

drop policy if exists custom_material_import_mapping_profiles_update on public.custom_material_import_mapping_profiles;
create policy custom_material_import_mapping_profiles_update
on public.custom_material_import_mapping_profiles
for update
to authenticated
using (
  public.is_admin()
  or public.is_module_admin('DA')
  or public.is_module_admin('WMS')
  or app_private.company_procurement_can_manage()
  or created_by = public.current_app_user_id()
)
with check (
  public.is_admin()
  or public.is_module_admin('DA')
  or public.is_module_admin('WMS')
  or app_private.company_procurement_can_manage()
  or created_by = public.current_app_user_id()
);

drop policy if exists custom_material_import_mapping_profiles_delete on public.custom_material_import_mapping_profiles;
create policy custom_material_import_mapping_profiles_delete
on public.custom_material_import_mapping_profiles
for delete
to authenticated
using (
  public.is_admin()
  or public.is_module_admin('DA')
  or public.is_module_admin('WMS')
  or app_private.company_procurement_can_manage()
  or created_by = public.current_app_user_id()
);

revoke all on public.custom_material_import_mapping_profiles from anon;
revoke all on public.custom_material_import_mapping_profiles from public;
grant select, insert, update, delete on public.custom_material_import_mapping_profiles to authenticated;

notify pgrst, 'reload schema';
