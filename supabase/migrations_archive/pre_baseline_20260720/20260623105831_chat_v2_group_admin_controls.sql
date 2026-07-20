-- Chat v2 group administration and message edit/delete guards.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

drop policy if exists chat_v2_participants_insert on public.chat_v2_participants;
create policy chat_v2_participants_insert
  on public.chat_v2_participants for insert to authenticated
  with check (
    public.is_admin()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
    or exists (
      select 1
      from public.chat_v2_conversations c
      where c.id = chat_v2_participants.conversation_id
        and c.created_by = public.current_app_user_id()
        and c.deleted_at is null
    )
  );

drop policy if exists chat_v2_participants_update on public.chat_v2_participants;
create policy chat_v2_participants_update
  on public.chat_v2_participants for update to authenticated
  using (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  )
  with check (
    public.is_admin()
    or user_id = public.current_app_user_id()
    or app_private.chat_v2_can_manage(conversation_id, public.current_app_user_id())
  );

drop policy if exists chat_v2_participants_delete on public.chat_v2_participants;
create policy chat_v2_participants_delete
  on public.chat_v2_participants for delete to authenticated
  using (public.is_admin());

drop policy if exists chat_v2_messages_delete on public.chat_v2_messages;
create policy chat_v2_messages_delete
  on public.chat_v2_messages for delete to authenticated
  using (public.is_admin());

create or replace function app_private.guard_chat_v2_participant_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_conversation_id uuid := coalesce(new.conversation_id, old.conversation_id);
  v_conversation_type text;
  v_is_manager boolean;
  v_is_creator boolean;
  v_active_owner_count integer;
begin
  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;

  select c.type, c.created_by = v_actor
  into v_conversation_type, v_is_creator
  from public.chat_v2_conversations c
  where c.id = v_conversation_id
    and c.deleted_at is null;

  if v_conversation_type is null then
    raise exception 'Hội thoại không tồn tại hoặc đã bị xóa.';
  end if;

  if public.is_admin() then
    return coalesce(new, old);
  end if;

  v_is_manager := app_private.chat_v2_can_manage(v_conversation_id, v_actor);

  if tg_op = 'INSERT' then
    if not (v_is_manager or v_is_creator) then
      raise exception 'Bạn không có quyền thêm thành viên vào nhóm này.';
    end if;
    if v_conversation_type = 'direct' and not v_is_creator then
      raise exception 'Không thể thêm thành viên vào hội thoại cá nhân.';
    end if;
    if new.role = 'owner' and not v_is_creator then
      raise exception 'Không thể tự tạo quyền chủ nhóm.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.conversation_id is distinct from old.conversation_id
      or new.user_id is distinct from old.user_id
      or new.joined_at is distinct from old.joined_at then
      raise exception 'Không thể thay đổi danh tính thành viên.';
    end if;

    if old.user_id = v_actor and not v_is_manager then
      if new.role is distinct from old.role then
        raise exception 'Bạn không thể tự thay đổi quyền nhóm.';
      end if;
      if old.role = 'owner' and old.left_at is null and new.left_at is not null then
        select count(*)
        into v_active_owner_count
        from public.chat_v2_participants p
        where p.conversation_id = old.conversation_id
          and p.role = 'owner'
          and p.left_at is null
          and p.user_id <> old.user_id;
        if coalesce(v_active_owner_count, 0) = 0 then
          raise exception 'Không thể rời nhóm khi bạn là chủ nhóm cuối cùng.';
        end if;
      end if;
      return new;
    end if;

    if not v_is_manager then
      raise exception 'Bạn không có quyền quản trị thành viên nhóm này.';
    end if;

    if v_conversation_type = 'direct' and (
      new.role is distinct from old.role
      or new.left_at is distinct from old.left_at
      or new.user_id is distinct from old.user_id
    ) then
      raise exception 'Không thể quản trị thành viên trong hội thoại cá nhân.';
    end if;

    if new.role = 'owner' and old.role is distinct from 'owner' then
      raise exception 'Chỉ được gán quyền quản trị viên nhóm, không được tạo thêm chủ nhóm.';
    end if;

    if old.role = 'owner' and (
      new.role is distinct from 'owner'
      or (old.left_at is null and new.left_at is not null)
    ) then
      select count(*)
      into v_active_owner_count
      from public.chat_v2_participants p
      where p.conversation_id = old.conversation_id
        and p.role = 'owner'
        and p.left_at is null
        and p.user_id <> old.user_id;
      if coalesce(v_active_owner_count, 0) = 0 then
        raise exception 'Không thể hạ quyền hoặc loại bỏ chủ nhóm cuối cùng.';
      end if;
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Không xóa cứng thành viên chat; hãy dùng left_at để loại khỏi nhóm.';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_chat_v2_participant_mutation on public.chat_v2_participants;
create trigger trg_guard_chat_v2_participant_mutation
  before insert or update or delete on public.chat_v2_participants
  for each row execute function app_private.guard_chat_v2_participant_mutation();

create or replace function app_private.guard_chat_v2_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_is_manager boolean;
begin
  if v_actor is null then
    raise exception 'Không xác định được người dùng hiện tại.';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if new.conversation_id is distinct from old.conversation_id
    or new.sender_id is distinct from old.sender_id
    or new.kind is distinct from old.kind
    or new.reply_to_message_id is distinct from old.reply_to_message_id
    or new.created_at is distinct from old.created_at then
    raise exception 'Không thể thay đổi dữ liệu gốc của tin nhắn.';
  end if;

  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'Không thể khôi phục tin nhắn đã xóa.';
  end if;

  v_is_manager := app_private.chat_v2_can_manage(old.conversation_id, v_actor);

  if new.body is distinct from old.body or new.edited_at is distinct from old.edited_at then
    if old.sender_id <> v_actor then
      raise exception 'Bạn chỉ có thể sửa tin nhắn của mình.';
    end if;
    if old.deleted_at is not null then
      raise exception 'Không thể sửa tin nhắn đã xóa.';
    end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
    if old.sender_id <> v_actor and not v_is_manager then
      raise exception 'Bạn không có quyền xóa tin nhắn này.';
    end if;
    if new.deleted_at is not null and new.deleted_by is distinct from v_actor then
      raise exception 'Người xóa tin nhắn không hợp lệ.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_chat_v2_message_update on public.chat_v2_messages;
create trigger trg_guard_chat_v2_message_update
  before update on public.chat_v2_messages
  for each row execute function app_private.guard_chat_v2_message_update();

revoke all on function app_private.guard_chat_v2_participant_mutation() from public;
revoke all on function app_private.guard_chat_v2_message_update() from public;

notify pgrst, 'reload schema';
