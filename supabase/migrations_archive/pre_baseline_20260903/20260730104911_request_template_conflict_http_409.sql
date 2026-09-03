-- Business-level optimistic concurrency conflicts must not use SQLSTATE 40001.
-- PostgREST maps class 40 errors to HTTP 500, which clients or intermediaries
-- may retry. Keep the private implementation intact and translate the exposed
-- RPC boundary to an explicit HTTP 409.

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
  if nullif(p_payload ->> 'templateId', '') is not null
     and nullif(p_payload ->> 'expectedUpdatedAt', '') is null then
    raise exception using
      errcode = '22023',
      message = 'REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED';
  end if;

  v_saved := app_private.save_request_template_draft(p_payload);

  select version.id into v_draft_version_id
  from public.request_template_versions version
  where version.request_template_id = (v_saved ->> 'id')::uuid
    and version.status = 'DRAFT'
  order by version.version_number desc
  limit 1;

  return v_saved || jsonb_build_object('draftVersionId', v_draft_version_id);
exception
  when serialization_failure then
    raise sqlstate 'PT409' using message = 'CONFLICT';
end;
$$;

create or replace function public.publish_request_template_version(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.publish_request_template_version(
    p_request_template_id,
    p_expected_updated_at
  );
exception
  when serialization_failure then
    raise sqlstate 'PT409' using message = 'CONFLICT';
end;
$$;

create or replace function public.deactivate_request_template(
  p_request_template_id uuid,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return app_private.deactivate_request_template(
    p_request_template_id,
    p_expected_updated_at
  );
exception
  when serialization_failure then
    raise sqlstate 'PT409' using message = 'CONFLICT';
end;
$$;
