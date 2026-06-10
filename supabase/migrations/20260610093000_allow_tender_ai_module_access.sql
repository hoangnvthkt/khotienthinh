-- Allow the new top-level Tender AI module to reuse Cost Library and Tender BOQ
-- data without requiring broad HD module admin permissions.

drop policy if exists cost_templates_select on public.cost_templates;
create policy cost_templates_select on public.cost_templates
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or public.is_module_admin('TENDER_AI')
  or status = 'active'
);

drop policy if exists cost_templates_manage on public.cost_templates;
create policy cost_templates_manage on public.cost_templates
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists cost_template_sections_select on public.cost_template_sections;
create policy cost_template_sections_select on public.cost_template_sections
for select to authenticated
using (
  exists (
    select 1 from public.cost_templates t
    where t.id = template_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or public.is_module_admin('TENDER_AI')
        or t.status = 'active'
      )
  )
);

drop policy if exists cost_template_sections_manage on public.cost_template_sections;
create policy cost_template_sections_manage on public.cost_template_sections
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists cost_template_items_select on public.cost_template_items;
create policy cost_template_items_select on public.cost_template_items
for select to authenticated
using (
  exists (
    select 1 from public.cost_templates t
    where t.id = template_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or public.is_module_admin('TENDER_AI')
        or t.status = 'active'
      )
  )
);

drop policy if exists cost_template_items_manage on public.cost_template_items;
create policy cost_template_items_manage on public.cost_template_items
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists cost_template_parameters_select on public.cost_template_parameters;
create policy cost_template_parameters_select on public.cost_template_parameters
for select to authenticated
using (
  exists (
    select 1 from public.cost_templates t
    where t.id = template_id
      and (
        public.is_admin()
        or public.is_module_admin('HD')
        or public.is_module_admin('DA')
        or public.is_module_admin('TENDER_AI')
        or t.status = 'active'
      )
  )
);

drop policy if exists cost_template_parameters_manage on public.cost_template_parameters;
create policy cost_template_parameters_manage on public.cost_template_parameters
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists internal_price_book_select on public.internal_price_book;
create policy internal_price_book_select on public.internal_price_book
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists internal_price_book_manage on public.internal_price_book;
create policy internal_price_book_manage on public.internal_price_book
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists internal_norms_select on public.internal_norms;
create policy internal_norms_select on public.internal_norms
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('DA')
  or public.is_module_admin('TENDER_AI')
);

drop policy if exists internal_norms_manage on public.internal_norms;
create policy internal_norms_manage on public.internal_norms
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists tender_packages_select on public.tender_packages;
create policy tender_packages_select on public.tender_packages
for select to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
  or created_by = public.current_app_user_id()
);

drop policy if exists tender_packages_insert on public.tender_packages;
create policy tender_packages_insert on public.tender_packages
for insert to authenticated
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
  or created_by = public.current_app_user_id()
);

drop policy if exists tender_packages_update on public.tender_packages;
create policy tender_packages_update on public.tender_packages
for update to authenticated
using (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
  or created_by = public.current_app_user_id()
)
with check (
  public.is_admin()
  or public.is_module_admin('HD')
  or public.is_module_admin('TENDER_AI')
  or created_by = public.current_app_user_id()
);

drop policy if exists tender_packages_delete on public.tender_packages;
create policy tender_packages_delete on public.tender_packages
for delete to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists tender_pricing_lines_select on public.tender_pricing_lines;
create policy tender_pricing_lines_select on public.tender_pricing_lines
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists tender_pricing_lines_manage on public.tender_pricing_lines;
create policy tender_pricing_lines_manage on public.tender_pricing_lines
for all to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'))
with check (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));

drop policy if exists tender_ai_logs_select on public.tender_ai_logs;
create policy tender_ai_logs_select on public.tender_ai_logs
for select to authenticated
using (public.is_admin() or public.is_module_admin('HD') or public.is_module_admin('TENDER_AI'));
