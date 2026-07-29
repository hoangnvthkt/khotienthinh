-- A request template owns a mutable DRAFT version before publishing.  Storage
-- policy is scoped to that version, so the editor needs this identifier rather
-- than only the public request_template_id.
create or replace function public.save_request_template_draft(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_saved jsonb;
  v_draft_version_id uuid;
begin
  v_saved := app_private.save_request_template_draft(p_payload);
  select version.id into v_draft_version_id
  from public.request_template_versions version
  where version.request_template_id = (v_saved ->> 'id')::uuid
    and version.status = 'DRAFT'
  order by version.version_number desc
  limit 1;

  return v_saved || jsonb_build_object('draftVersionId', v_draft_version_id);
end;
$$;

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
        'updatedAt', version.updated_at,
        'payload', app_private.request_template_draft_payload(version.id)
      )
    else null
  end
  from public.request_template_versions version
  where version.request_template_id = p_request_template_id
    and version.status = 'DRAFT'
  order by version.version_number desc
  limit 1;
$$;

-- The browser uploads only to the version-specific private object path.  This
-- security-definer command records the validated metadata; direct DML remains
-- revoked from authenticated users.
create or replace function app_private.register_request_template_docx_draft(
  p_request_template_version_id uuid,
  p_storage_path text,
  p_placeholder_schema jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_expected_path text;
  v_print_template public.request_print_templates%rowtype;
begin
  if v_actor is null or not app_private.request_user_can_manage(v_actor) then
    raise exception using errcode = '42501', message = 'REQUEST_TEMPLATE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.request_template_versions version
    where version.id = p_request_template_version_id and version.status = 'DRAFT'
  ) then
    raise exception using errcode = '22023', message = 'REQUEST_TEMPLATE_DRAFT_VERSION_REQUIRED';
  end if;
  v_expected_path := format('request-template-versions/%s/template.docx', p_request_template_version_id);
  if p_storage_path <> v_expected_path or jsonb_typeof(p_placeholder_schema) <> 'object' then
    raise exception using errcode = '22023', message = 'REQUEST_PRINT_TEMPLATE_INVALID';
  end if;

  delete from public.request_print_templates
  where request_template_version_id = p_request_template_version_id;

  insert into public.request_print_templates(
    request_template_version_id, name, file_name, storage_path,
    validation_status, placeholder_schema
  ) values (
    p_request_template_version_id, 'Mẫu DOCX đề xuất', 'template.docx',
    p_storage_path, 'VALID', p_placeholder_schema
  ) returning * into v_print_template;

  return jsonb_build_object(
    'id', v_print_template.id,
    'storagePath', v_print_template.storage_path,
    'validationStatus', v_print_template.validation_status,
    'placeholderSchema', v_print_template.placeholder_schema
  );
end;
$$;

create or replace function public.register_request_template_docx_draft(
  p_request_template_version_id uuid,
  p_storage_path text,
  p_placeholder_schema jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.register_request_template_docx_draft(
    p_request_template_version_id, p_storage_path, p_placeholder_schema
  );
$$;

revoke all on function app_private.register_request_template_docx_draft(uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function app_private.register_request_template_docx_draft(uuid, text, jsonb) to authenticated;
revoke all on function public.register_request_template_docx_draft(uuid, text, jsonb) from public, anon;
grant execute on function public.register_request_template_docx_draft(uuid, text, jsonb) to authenticated;
