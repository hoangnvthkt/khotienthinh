-- Public RPC wrappers are SECURITY INVOKER by design. Allow authenticated users
-- to enter only the private SECURITY DEFINER commands that enforce request
-- visibility, ownership, feature gates and attachment state internally.
grant execute on function app_private.command_request_comment(text,jsonb,text) to authenticated;
grant execute on function app_private.list_request_comments(uuid,text,integer) to authenticated;
grant execute on function app_private.list_request_mention_candidates(uuid,text,text,integer) to authenticated;
grant execute on function app_private.list_request_activity(uuid,text,integer) to authenticated;
grant execute on function app_private.claim_request_attachment(uuid) to authenticated;
grant execute on function app_private.authorize_request_attachment(uuid,text) to authenticated;

-- Storage policies execute as the caller and therefore need explicit EXECUTE
-- on their private predicates. The functions still validate the reservation,
-- uploader and request visibility and app_private is not an exposed API schema.
grant execute on function app_private.request_attachment_storage_can_select(text,uuid) to authenticated;
grant execute on function app_private.request_attachment_storage_can_insert(text,uuid) to authenticated;

-- Keep the public anchor wrapper invoker-safe without exposing its lower-level
-- gate and visibility helpers directly to authenticated callers.
create function app_private.get_request_comment_anchor(p_request_id uuid,p_comment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when app_private.request_feature_enabled('discussion_read')
    and app_private.request_instance_can_select(p_request_id,public.current_app_user_id()) then
    (select jsonb_build_object('commentId',c.id,'rootCommentId',coalesce(c.parent_comment_id,c.id),
      'createdAt',c.created_at,'cursor',(c.created_at+interval '1 microsecond')::text||'|00000000-0000-0000-0000-000000000000')
      from public.request_comments c
      where c.request_id=p_request_id and c.id=p_comment_id)
    else null end;
$$;
revoke all on function app_private.get_request_comment_anchor(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.get_request_comment_anchor(uuid,uuid) to authenticated;

create or replace function public.get_request_comment_anchor(p_request_id uuid,p_comment_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.get_request_comment_anchor(p_request_id,p_comment_id);
$$;
revoke all on function public.get_request_comment_anchor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_request_comment_anchor(uuid,uuid) to authenticated;
