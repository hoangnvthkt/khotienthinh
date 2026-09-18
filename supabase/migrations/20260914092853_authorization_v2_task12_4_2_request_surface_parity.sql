-- Task 12.4.2-E: Request template UI, route and API use the same canonical rights.

create or replace function app_private.request_user_can_manage(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and app_user.is_active
      and app_user.account_status = 'ACTIVE'
      and app_private.has_permission(
        p_user_id,
        'request.template.manage',
        'global',
        '*'
      )
  );
$$;

create or replace function app_private.request_user_can_view_templates(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and app_user.is_active
      and app_user.account_status = 'ACTIVE'
      and (
        app_private.has_permission(p_user_id, 'request.template.view', 'global', '*')
        or app_private.has_permission(p_user_id, 'request.template.manage', 'global', '*')
      )
  );
$$;

create or replace function app_private.request_template_can_select(
  p_request_template_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.request_user_can_view_templates(p_user_id)
    or exists (
      select 1
      from public.request_templates template
      join public.request_template_versions version
        on version.id = template.current_version_id
      where template.id = p_request_template_id
        and template.lifecycle_status = 'PUBLISHED'
        and version.status = 'PUBLISHED'
        and app_private.request_template_version_can_use(version.id, p_user_id)
    );
$$;

create or replace function app_private.request_template_version_can_select(
  p_request_template_version_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.request_user_can_view_templates(p_user_id)
    or exists (
      select 1
      from public.request_template_versions version
      join public.request_templates template
        on template.id = version.request_template_id
      where version.id = p_request_template_version_id
        and template.lifecycle_status = 'PUBLISHED'
        and version.status in ('PUBLISHED', 'SUPERSEDED')
        and app_private.request_template_version_can_use(version.id, p_user_id)
    );
$$;

create or replace function public.list_request_templates(p_filters jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'items',
    coalesce(jsonb_agg(item order by item->>'updatedAt' desc), '[]'::jsonb)
  )
  from (
    select app_private.request_template_summary(template.id) as item
    from public.request_templates template
    left join public.request_template_versions version
      on version.id = template.current_version_id
    where (
      app_private.request_user_can_view_templates(public.current_app_user_id())
      or (
        template.lifecycle_status = 'PUBLISHED'
        and version.status = 'PUBLISHED'
        and app_private.request_template_version_can_use(
          version.id,
          public.current_app_user_id()
        )
      )
    )
    and (
      nullif(p_filters->>'status', '') is null
      or template.lifecycle_status = p_filters->>'status'
    )
    and (
      nullif(trim(p_filters->>'search'), '') is null
      or template.name ilike '%' || trim(p_filters->>'search') || '%'
    )
  ) listed;
$$;

revoke all on function app_private.request_user_can_view_templates(uuid) from public, anon, authenticated;
grant execute on function app_private.request_user_can_view_templates(uuid) to authenticated, service_role;

-- Preserve the existing private helper grants while replacing its body.
revoke all on function app_private.request_user_can_manage(uuid) from public, anon;
grant execute on function app_private.request_user_can_manage(uuid) to authenticated, service_role;

revoke all on function public.list_request_templates(jsonb) from public, anon;
grant execute on function public.list_request_templates(jsonb) to authenticated, service_role;
