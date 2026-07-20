-- Per-user access control for the ChatV2 application.
-- Existing explicitly-configured users keep their current chat access after rollout.

update public.users
set allowed_modules = array_append(allowed_modules, 'CHAT')
where allowed_modules is not null
  and not ('CHAT' = any(allowed_modules));

create or replace function app_private.chat_v2_has_app_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and (
        u.role::text = 'ADMIN'
        or u.allowed_modules is null
        or 'CHAT' = any(u.allowed_modules)
      )
  );
$$;

revoke all on function app_private.chat_v2_has_app_access(uuid) from public;
grant execute on function app_private.chat_v2_has_app_access(uuid) to authenticated;

drop policy if exists chat_v2_app_access on public.chat_v2_conversations;
create policy chat_v2_app_access
  on public.chat_v2_conversations as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_participants;
create policy chat_v2_app_access
  on public.chat_v2_participants as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_messages;
create policy chat_v2_app_access
  on public.chat_v2_messages as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_attachments;
create policy chat_v2_app_access
  on public.chat_v2_attachments as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_reactions;
create policy chat_v2_app_access
  on public.chat_v2_reactions as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_direct_pairs;
create policy chat_v2_app_access
  on public.chat_v2_direct_pairs as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_poll_votes;
create policy chat_v2_app_access
  on public.chat_v2_poll_votes as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_checklist_items;
create policy chat_v2_app_access
  on public.chat_v2_checklist_items as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_app_access on public.chat_v2_quick_confirm_responses;
create policy chat_v2_app_access
  on public.chat_v2_quick_confirm_responses as restrictive for all to authenticated
  using (app_private.chat_v2_has_app_access(public.current_app_user_id()))
  with check (app_private.chat_v2_has_app_access(public.current_app_user_id()));

drop policy if exists chat_v2_storage_app_access on storage.objects;
create policy chat_v2_storage_app_access
  on storage.objects as restrictive for all to authenticated
  using (
    bucket_id <> 'chat-attachments'
    or app_private.chat_v2_has_app_access(public.current_app_user_id())
  )
  with check (
    bucket_id <> 'chat-attachments'
    or app_private.chat_v2_has_app_access(public.current_app_user_id())
  );
