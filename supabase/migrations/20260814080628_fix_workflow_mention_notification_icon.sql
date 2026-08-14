-- Use a renderable emoji instead of the Lucide component name. Notification
-- surfaces render the icon column as text, so "MessageSquare" appeared verbatim.

create or replace function app_private.notify_workflow_instance_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author_name text;
  v_instance_code text;
  v_instance_title text;
  v_message text;
begin
  if jsonb_array_length(new.mentions) = 0 then
    return new;
  end if;

  select author.name
  into v_author_name
  from public.users author
  where author.id = new.author_user_id;

  select instance.code, instance.title
  into v_instance_code, v_instance_title
  from public.workflow_instances instance
  where instance.id = new.instance_id;

  v_message := format(
    '%s đã nhắc đến bạn trong quy trình %s%s.',
    coalesce(v_author_name, 'Một nhân viên'),
    coalesce(v_instance_code, ''),
    case
      when nullif(trim(coalesce(v_instance_title, '')), '') is null then ''
      when nullif(trim(coalesce(v_instance_code, '')), '') is null then v_instance_title
      else ' - ' || v_instance_title
    end
  );

  insert into public.notifications (
    user_id,
    title,
    body,
    type,
    priority,
    module,
    link,
    metadata,
    category,
    message,
    icon,
    severity,
    source_type,
    source_id,
    push_enabled,
    action_url,
    entity_type,
    entity_id
  )
  select
    mention ->> 'userId',
    'Bạn được nhắc đến trong thảo luận quy trình',
    v_message,
    'info',
    'normal',
    'WF',
    '/wf?instanceId=' || new.instance_id::text,
    jsonb_build_object(
      'instanceId', new.instance_id,
      'commentId', new.id,
      'authorUserId', new.author_user_id
    ),
    'workflow',
    v_message,
    '💬',
    'info',
    'workflow_comment_mention',
    new.instance_id::text,
    true,
    '/wf?instanceId=' || new.instance_id::text,
    'workflow_instance_comment',
    new.id
  from jsonb_array_elements(new.mentions) mention;

  return new;
end;
$$;

revoke all on function app_private.notify_workflow_instance_comment_mentions()
  from public, anon, authenticated, service_role;

update public.notifications
set icon = '💬'
where source_type = 'workflow_comment_mention'
  and icon is distinct from '💬';
