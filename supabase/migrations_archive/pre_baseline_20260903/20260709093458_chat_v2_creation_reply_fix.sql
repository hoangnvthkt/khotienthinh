-- Chat v2 creation fixes:
-- - Avoid multi-row participant inserts under RLS.
-- - Provide a group creation RPC with the same safe insert pattern.
-- - Guard reply targets so quoted messages cannot cross conversations.

create or replace function public.chat_v2_get_or_create_direct_conversation(p_target_user_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_low uuid;
  v_high uuid;
  v_conversation_id uuid;
begin
  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;
  if p_target_user_id is null or p_target_user_id = v_actor then
    raise exception 'Người nhận không hợp lệ.';
  end if;
  if not exists (select 1 from public.users u where u.id = p_target_user_id and coalesce(u.is_active, true)) then
    raise exception 'Người nhận không tồn tại hoặc đã bị khóa.';
  end if;

  v_low := least(v_actor, p_target_user_id);
  v_high := greatest(v_actor, p_target_user_id);

  perform pg_advisory_xact_lock(hashtext(v_low::text || ':' || v_high::text));

  select dp.conversation_id
  into v_conversation_id
  from public.chat_v2_direct_pairs dp
  where dp.user_low_id = v_low
    and dp.user_high_id = v_high;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.chat_v2_conversations(type, created_by, metadata)
  values (
    'direct',
    v_actor,
    jsonb_build_object('directUserIds', jsonb_build_array(v_low, v_high))
  )
  returning id into v_conversation_id;

  insert into public.chat_v2_participants(conversation_id, user_id, role, last_read_at)
  values (v_conversation_id, v_actor, 'owner', now())
  on conflict (conversation_id, user_id) do nothing;

  insert into public.chat_v2_participants(conversation_id, user_id, role, last_read_at)
  values (v_conversation_id, p_target_user_id, 'member', null)
  on conflict (conversation_id, user_id) do nothing;

  insert into public.chat_v2_direct_pairs(user_low_id, user_high_id, conversation_id)
  values (v_low, v_high, v_conversation_id);

  return v_conversation_id;
end;
$$;

revoke all on function public.chat_v2_get_or_create_direct_conversation(uuid) from public;
grant execute on function public.chat_v2_get_or_create_direct_conversation(uuid) to authenticated;

create or replace function public.chat_v2_create_group_conversation(
  p_name text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_member_ids uuid[];
  v_member_id uuid;
  v_conversation_id uuid;
  v_group_name text;
begin
  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;

  select array_agg(distinct member_id)
  into v_member_ids
  from unnest(coalesce(p_member_ids, array[]::uuid[]) || array[v_actor]) as member_id
  where member_id is not null;

  if coalesce(array_length(v_member_ids, 1), 0) < 2 then
    raise exception 'Nhóm cần ít nhất 2 thành viên.';
  end if;

  foreach v_member_id in array v_member_ids
  loop
    if not app_private.chat_v2_has_app_access(v_member_id) then
      raise exception 'Thành viên không tồn tại, đã bị khóa hoặc chưa có quyền chat.';
    end if;
  end loop;

  v_group_name := nullif(trim(coalesce(p_name, '')), '');
  if v_group_name is null then
    v_group_name := 'Nhóm ' || array_length(v_member_ids, 1)::text || ' thành viên';
  end if;

  insert into public.chat_v2_conversations(type, name, created_by)
  values ('group', v_group_name, v_actor)
  returning id into v_conversation_id;

  insert into public.chat_v2_participants(conversation_id, user_id, role, last_read_at)
  values (v_conversation_id, v_actor, 'owner', now())
  on conflict (conversation_id, user_id) do nothing;

  foreach v_member_id in array v_member_ids
  loop
    if v_member_id <> v_actor then
      insert into public.chat_v2_participants(conversation_id, user_id, role, last_read_at)
      values (v_conversation_id, v_member_id, 'member', null)
      on conflict (conversation_id, user_id) do nothing;
    end if;
  end loop;

  return v_conversation_id;
end;
$$;

revoke all on function public.chat_v2_create_group_conversation(text, uuid[]) from public;
grant execute on function public.chat_v2_create_group_conversation(text, uuid[]) to authenticated;

create or replace function app_private.guard_chat_v2_reply_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reply_conversation_id uuid;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;

  if new.id = new.reply_to_message_id then
    raise exception 'Không thể trả lời chính tin nhắn này.';
  end if;

  select m.conversation_id
  into v_reply_conversation_id
  from public.chat_v2_messages m
  where m.id = new.reply_to_message_id
    and m.deleted_at is null;

  if v_reply_conversation_id is null then
    raise exception 'Tin nhắn được trả lời không tồn tại hoặc đã bị xóa.';
  end if;

  if v_reply_conversation_id is distinct from new.conversation_id then
    raise exception 'Tin nhắn được trả lời phải cùng hội thoại.';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_chat_v2_reply_target() from public;
grant execute on function app_private.guard_chat_v2_reply_target() to authenticated;

drop trigger if exists trg_guard_chat_v2_reply_target on public.chat_v2_messages;
create trigger trg_guard_chat_v2_reply_target
  before insert or update of conversation_id, reply_to_message_id on public.chat_v2_messages
  for each row execute function app_private.guard_chat_v2_reply_target();
