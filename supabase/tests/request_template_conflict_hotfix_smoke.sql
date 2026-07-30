begin;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (
      select app_user.auth_id
      from public.users app_user
      where app_user.id = '928d3473-49a2-4427-a319-19729689a084'
    ),
    'role', 'authenticated'
  )::text,
  true
);

select set_config(
  'request.template_conflict_test_id',
  (
    select template.id::text
    from public.request_templates template
    where template.lifecycle_status = 'DRAFT'
    order by template.updated_at desc
    limit 1
  ),
  true
);

set local role authenticated;

do $$
declare
  v_template_id uuid;
  v_draft jsonb;
  v_payload jsonb;
  v_expected_sqlstate constant text := 'PT409';
begin
  v_template_id := nullif(
    current_setting('request.template_conflict_test_id', true),
    ''
  )::uuid;

  if v_template_id is null then
    raise exception 'request template conflict smoke requires one draft template';
  end if;

  v_draft := public.get_request_template_draft(v_template_id);
  if v_draft is null then
    raise exception 'request template conflict smoke actor cannot load draft %', v_template_id;
  end if;

  v_payload := (v_draft -> 'payload') || jsonb_build_object(
    'templateId', v_template_id,
    'expectedUpdatedAt', '2000-01-01T00:00:00Z'
  );

  begin
    perform public.save_request_template_draft(v_payload - 'expectedUpdatedAt');
    raise exception 'save_request_template_draft accepted a missing concurrency token';
  exception
    when sqlstate '22023' then
      if sqlerrm <> 'REQUEST_TEMPLATE_EXPECTED_UPDATED_AT_REQUIRED' then
        raise exception 'save_request_template_draft returned unexpected validation error: %',
          sqlerrm;
      end if;
    when others then
      raise exception 'save_request_template_draft expected missing-token SQLSTATE 22023, got %',
        sqlstate;
  end;

  begin
    perform public.save_request_template_draft(v_payload);
    raise exception 'save_request_template_draft accepted a stale concurrency token';
  exception
    when sqlstate 'PT409' then null;
    when others then
      raise exception 'save_request_template_draft expected SQLSTATE %, got %',
        v_expected_sqlstate, sqlstate;
  end;

  begin
    perform public.publish_request_template_version(
      v_template_id,
      '2000-01-01T00:00:00Z'
    );
    raise exception 'publish_request_template_version accepted a stale concurrency token';
  exception
    when sqlstate 'PT409' then null;
    when others then
      raise exception 'publish_request_template_version expected SQLSTATE %, got %',
        v_expected_sqlstate, sqlstate;
  end;

  begin
    perform public.deactivate_request_template(
      v_template_id,
      '2000-01-01T00:00:00Z'
    );
    raise exception 'deactivate_request_template accepted a stale concurrency token';
  exception
    when sqlstate 'PT409' then null;
    when others then
      raise exception 'deactivate_request_template expected SQLSTATE %, got %',
        v_expected_sqlstate, sqlstate;
  end;
end;
$$;

rollback;
