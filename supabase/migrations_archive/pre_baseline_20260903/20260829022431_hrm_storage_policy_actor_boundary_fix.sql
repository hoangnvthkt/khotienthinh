begin;

-- storage.objects hosts every application bucket. PostgreSQL may evaluate HRM
-- storage policies even when another bucket policy ultimately authorizes the
-- row, so those policies must only call the actor-bound helper executable by
-- authenticated clients. Keep the arbitrary-user helper private.
alter policy hr_documents_template_select on storage.objects
using (
  bucket_id = 'hr-documents'
  and app_private.current_user_has_hrm_template_permission('hrm.document.view')
);

alter policy hr_documents_template_insert on storage.objects
with check (
  bucket_id = 'hr-documents'
  and app_private.current_user_has_hrm_template_permission('hrm.document.manage')
);

alter policy hr_documents_template_update on storage.objects
using (
  bucket_id = 'hr-documents'
  and app_private.current_user_has_hrm_template_permission('hrm.document.manage')
)
with check (
  bucket_id = 'hr-documents'
  and app_private.current_user_has_hrm_template_permission('hrm.document.manage')
);

alter policy hr_documents_template_delete on storage.objects
using (
  bucket_id = 'hr-documents'
  and app_private.current_user_has_hrm_template_permission('hrm.document.manage')
);

alter policy hrm_private_import_insert on storage.objects
with check (
  bucket_id = 'hrm-private-imports'
  and split_part(name, '/', 1) = public.current_app_user_id()::text
  and app_private.current_user_has_hrm_template_permission('hrm.employee.import')
);

alter policy hrm_private_import_select on storage.objects
using (
  bucket_id = 'hrm-private-imports'
  and split_part(name, '/', 1) = public.current_app_user_id()::text
  and app_private.current_user_has_hrm_template_permission('hrm.employee.import')
);

alter policy hrm_private_import_delete on storage.objects
using (
  bucket_id = 'hrm-private-imports'
  and split_part(name, '/', 1) = public.current_app_user_id()::text
  and app_private.current_user_has_hrm_template_permission('hrm.employee.import')
);

notify pgrst, 'reload schema';

commit;
