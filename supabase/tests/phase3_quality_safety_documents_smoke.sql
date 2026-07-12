-- Phase 3 Quality, Safety, Documents, and Reports permission smoke.

do $$
declare
  required_codes text[] := array[
    'project.quality.template_manage',
    'project.quality.checklist_create',
    'project.quality.checklist_edit_own',
    'project.quality.checklist_edit_all',
    'project.quality.submit',
    'project.quality.return',
    'project.quality.verify',
    'project.quality.approve',
    'project.quality.delete',
    'project.safety.worker_manage',
    'project.safety.issue_create',
    'project.safety.issue_edit_own',
    'project.safety.issue_edit_all',
    'project.safety.issue_close',
    'project.safety.training_manage',
    'project.safety.document_verify',
    'project.documents.upload',
    'project.documents.edit_metadata',
    'project.documents.delete_own',
    'project.documents.delete_all',
    'project.documents.approve',
    'project.report.export',
    'project.dashboard.view_financials',
    'project.dashboard.view_progress',
    'project.dashboard.view_risk'
  ];
  v_permission_code text;
begin
  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 3 quality/safety/document/report permission action: %', v_permission_code;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in (
        'quality_checklists',
        'quality_inspection_attempts',
        'inspection_categories',
        'inspection_work_types',
        'inspection_templates',
        'inspection_template_items',
        'quality_checklist_templates'
      )
      and g.grantee = 'anon'
      and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'anon still has Quality table privileges';
  end if;
end $$;
