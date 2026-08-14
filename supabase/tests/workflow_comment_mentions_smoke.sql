begin;

create temporary table workflow_comment_mention_smoke_context on commit drop as
select
  gen_random_uuid() as comment_id,
  instance.id as instance_id,
  author.id as author_user_id,
  mentioned.id as mentioned_user_id,
  mentioned.name as mentioned_name
from public.workflow_instances instance
cross join lateral (
  select app_user.id
  from public.users app_user
  where app_user.is_active and app_user.account_status = 'ACTIVE'
  order by app_user.created_at
  limit 1
) author
cross join lateral (
  select app_user.id, app_user.name
  from public.users app_user
  where app_user.is_active
    and app_user.account_status = 'ACTIVE'
    and app_user.id <> author.id
  order by app_user.created_at
  limit 1
) mentioned
order by instance.created_at desc
limit 1;

insert into public.workflow_instance_comments (
  id, instance_id, author_user_id, body, mentions
)
select
  context.comment_id,
  context.instance_id,
  context.author_user_id,
  '@' || context.mentioned_name || ' kiểm tra giúp nội dung này.',
  jsonb_build_array(jsonb_build_object(
    'userId', context.mentioned_user_id,
    'displayName', 'Tên không đáng tin từ client'
  ))
from workflow_comment_mention_smoke_context context;

select
  exists (select 1 from workflow_comment_mention_smoke_context) as candidates_ready,
  coalesce((
    select comment.mentions = jsonb_build_array(jsonb_build_object(
      'userId', context.mentioned_user_id,
      'displayName', context.mentioned_name
    ))
    from workflow_comment_mention_smoke_context context
    join public.workflow_instance_comments comment on comment.id = context.comment_id
  ), false) as mention_canonicalized,
  exists (
    select 1
    from workflow_comment_mention_smoke_context context
    join public.notifications notification
      on notification.entity_id = context.comment_id
     and notification.user_id = context.mentioned_user_id::text
     and notification.source_type = 'workflow_comment_mention'
     and notification.action_url = '/wf?instanceId=' || context.instance_id::text
  ) as notification_created;

rollback;
