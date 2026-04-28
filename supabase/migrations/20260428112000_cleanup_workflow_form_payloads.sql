-- Demo-data cleanup: remove embedded base64/Excel payloads from workflow JSON.
-- New attachments are stored in the workflow-attachments bucket instead.

create or replace function public.strip_workflow_file_payloads(value jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(value) = 'object' then
      coalesce((
        select jsonb_object_agg(key, public.strip_workflow_file_payloads(val))
        from jsonb_each(value) as e(key, val)
        where key not in ('data', 'excelData')
      ), '{}'::jsonb)
    when jsonb_typeof(value) = 'array' then
      coalesce((
        select jsonb_agg(public.strip_workflow_file_payloads(elem))
        from jsonb_array_elements(value) as a(elem)
      ), '[]'::jsonb)
    else value
  end
$$;

update public.workflow_instances
set form_data = public.strip_workflow_file_payloads(form_data)
where form_data is not null
  and (form_data::text like '%"data"%' or form_data::text like '%"excelData"%');

drop function public.strip_workflow_file_payloads(jsonb);
