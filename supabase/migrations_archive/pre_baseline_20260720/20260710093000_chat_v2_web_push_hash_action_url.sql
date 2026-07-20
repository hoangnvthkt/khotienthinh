create or replace function app_private.chat_v2_notify_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_name text;
  v_conversation_name text;
  v_title text;
  v_message text;
begin
  if new.kind = 'system' or new.deleted_at is not null or new.legacy_message_id is not null then
    return new;
  end if;

  select coalesce(u.name, u.email, 'Người dùng')
  into v_sender_name
  from public.users u
  where u.id = new.sender_id;

  select c.name
  into v_conversation_name
  from public.chat_v2_conversations c
  where c.id = new.conversation_id;

  v_title := coalesce(v_conversation_name, v_sender_name);
  v_message := case
    when nullif(trim(new.body), '') is not null then v_sender_name || ': ' || left(trim(new.body), 140)
    else v_sender_name || ' đã gửi tệp đính kèm'
  end;

  insert into public.notifications (
    user_id,
    type,
    category,
    title,
    message,
    icon,
    link,
    severity,
    source_type,
    source_id,
    priority,
    push_enabled,
    action_url,
    entity_type,
    entity_id,
    metadata
  )
  select
    p.user_id,
    'info',
    'chat',
    v_title,
    v_message,
    '💬',
    '/chat?conversation=' || new.conversation_id::text,
    'info',
    'chat_v2_message',
    new.id::text,
    'normal',
    true,
    '/#/chat?conversation=' || new.conversation_id::text,
    'chat_v2_message',
    new.id,
    jsonb_build_object(
      'conversationId', new.conversation_id,
      'messageId', new.id,
      'senderId', new.sender_id
    )
  from public.chat_v2_participants p
  where p.conversation_id = new.conversation_id
    and p.left_at is null
    and p.is_muted is false
    and p.user_id <> new.sender_id;

  return new;
end;
$$;
