create or replace function app_private.list_usable_request_templates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(item order by item ->> 'name'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'templateId', template.id,
      'templateVersionId', version.id,
      'name', template.name,
      'description', template.description,
      'versionNumber', version.version_number,
      'formSchema', version.form_schema,
      'approvalBlocks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'key', block.block_key,
          'name', block.name,
          'source', block.approver_source,
          'minimumDynamicApprovers', block.minimum_dynamic_approvers,
          'sortOrder', block.sort_order
        ) order by block.sort_order)
        from public.request_approval_blocks block
        where block.request_template_version_id = version.id
      ), '[]'::jsonb)
    ) as item
    from public.request_templates template
    join public.request_template_versions version on version.id = template.current_version_id
    where template.lifecycle_status = 'PUBLISHED'
      and version.status = 'PUBLISHED'
      and app_private.request_template_version_can_use(
        version.id, public.current_app_user_id()
      )
  ) usable;
$$;

create or replace function public.list_usable_request_templates()
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select app_private.list_usable_request_templates(); $$;

revoke all on function app_private.list_usable_request_templates() from public, anon, authenticated;
grant execute on function app_private.list_usable_request_templates() to authenticated;
revoke all on function public.list_usable_request_templates() from public, anon;
grant execute on function public.list_usable_request_templates() to authenticated;
