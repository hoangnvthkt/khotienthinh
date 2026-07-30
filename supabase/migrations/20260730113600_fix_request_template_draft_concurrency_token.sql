-- Keep draft editor concurrency aligned with save/publish commands.
-- Those commands compare request_templates.updated_at, so the load RPC must
-- return the same token instead of request_template_versions.updated_at.
create or replace function public.get_request_template_draft(p_request_template_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select case
    when app_private.request_user_can_manage(public.current_app_user_id()) then
      jsonb_build_object(
        'id', version.request_template_id,
        'draftVersionId', version.id,
        'status', version.status,
        'versionNumber', version.version_number,
        'updatedAt', template.updated_at,
        'payload', app_private.request_template_draft_payload(version.id)
      )
    else null
  end
  from public.request_template_versions version
  join public.request_templates template
    on template.id = version.request_template_id
  where version.request_template_id = p_request_template_id
    and version.status = 'DRAFT'
  order by version.version_number desc
  limit 1;
$$;

revoke all on function public.get_request_template_draft(uuid) from public, anon;
grant execute on function public.get_request_template_draft(uuid) to authenticated;
