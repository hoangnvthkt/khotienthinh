-- Persist explicit workflow comment mentions and notify each mentioned user.
-- Notifications are created at the database boundary so in-app realtime and
-- web-push delivery share the existing public.notifications pipeline.

alter table public.workflow_instance_comments
  add column if not exists mentions jsonb not null default '[]'::jsonb;

alter table public.workflow_instance_comments
  drop constraint if exists workflow_instance_comments_mentions_check;

alter table public.workflow_instance_comments
  add constraint workflow_instance_comments_mentions_check check (
    jsonb_typeof(mentions) = 'array'
    and jsonb_array_length(mentions) <= 20
  );

comment on column public.workflow_instance_comments.mentions is
  'Canonical [{userId, displayName}] entries selected from the workflow comment mention picker.';

create or replace function app_private.normalize_workflow_instance_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(
    jsonb_agg(
      jsonb_build_object('userId', candidate.user_id, 'displayName', candidate.display_name)
      order by candidate.display_name, candidate.user_id
    ),
    '[]'::jsonb
  )
  into new.mentions
  from (
    select distinct on (mentioned_user.id)
      mentioned_user.id as user_id,
      mentioned_user.name as display_name
    from jsonb_array_elements(coalesce(new.mentions, '[]'::jsonb)) mention
    join public.users mentioned_user
      on mentioned_user.id::text = nullif(mention ->> 'userId', '')
     and mentioned_user.is_active
     and mentioned_user.account_status = 'ACTIVE'
    where mentioned_user.id <> new.author_user_id
      and position(('@' || mentioned_user.name) in new.body) > 0
    order by mentioned_user.id
    limit 20
  ) candidate;

  return new;
end;
$$;

revoke all on function app_private.normalize_workflow_instance_comment_mentions()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_normalize_workflow_instance_comment_mentions
  on public.workflow_instance_comments;
create trigger trg_normalize_workflow_instance_comment_mentions
before insert or update of body, mentions
on public.workflow_instance_comments
for each row
execute function app_private.normalize_workflow_instance_comment_mentions();

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
    'MessageSquare',
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

drop trigger if exists trg_notify_workflow_instance_comment_mentions
  on public.workflow_instance_comments;
create trigger trg_notify_workflow_instance_comment_mentions
after insert
on public.workflow_instance_comments
for each row
execute function app_private.notify_workflow_instance_comment_mentions();
