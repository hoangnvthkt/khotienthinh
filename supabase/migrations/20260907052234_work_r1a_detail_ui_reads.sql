-- Task 9 subject reads. No new mutation permissions or task lifecycle rules.
create function app_private.work_assignment_candidate_ok(p_task_id uuid,p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 perform app_private.work_assert_assignment_recipient(p_task_id,p_user_id);
 return true;
exception when insufficient_privilege then return false;
end $$;
revoke all on function app_private.work_assignment_candidate_ok(uuid,uuid) from public,anon,authenticated;

create function app_private.work_assignment_candidates(p_task_id uuid,p_action text,p_search text,p_cursor uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_caps jsonb:=app_private.work_task_capabilities(p_task_id); v_rows jsonb; v_n integer:=coalesce(p_limit,30);
begin
 if p_action is null or p_action not in ('transfer','add_assignees') or length(coalesce(p_search,''))>100 or v_n not between 1 and 50 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
 if not coalesce((v_caps->>(case when p_action='transfer' then 'canTransfer' else 'canAddAssignees' end))::boolean,false) then raise exception 'WORK_COMMAND_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q."userId"),'[]') into v_rows from (
  select u.id as "userId",u.name from public.users u
  where u.is_active and u.account_status='ACTIVE' and (p_cursor is null or u.id>p_cursor)
   and (nullif(btrim(p_search),'') is null or strpos(lower(u.name),lower(btrim(p_search)))>0)
   and not exists(select 1 from public.work_task_assignments a where a.task_id=p_task_id and a.user_id=u.id and a.ended_at is null)
   and app_private.work_assignment_candidate_ok(p_task_id,u.id)
  order by u.id limit v_n+1
 ) q;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
  'nextCursor',case when jsonb_array_length(v_rows)>v_n then v_rows->(v_n-1)->'userId' else null end);
end $$;
revoke all on function app_private.work_assignment_candidates(uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function app_private.work_assignment_candidates(uuid,text,text,uuid,integer) to authenticated;
create function public.list_work_task_assignment_candidates(p_task_id uuid,p_action text,p_search text default '',p_cursor uuid default null,p_limit integer default 30)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_assignment_candidates(p_task_id,p_action,p_search,p_cursor,p_limit); $$;
revoke all on function public.list_work_task_assignment_candidates(uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_work_task_assignment_candidates(uuid,text,text,uuid,integer) to authenticated;

create function app_private.work_ui_context(p_task_id uuid,p_user_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.work_tasks%rowtype; v_names jsonb; v_scope text; v_bucket text;
begin
 if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
 if coalesce(cardinality(p_user_ids),0)>100 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
 select * into strict t from public.work_tasks where id=p_task_id;
 select coalesce(jsonb_object_agg(u.id::text,u.name),'{}') into v_names from public.users u where u.id=any(p_user_ids) and (
  u.id=t.created_by or u.id=t.reviewer_user_id
  or exists(select 1 from public.work_task_assignments a where a.task_id=t.id and (a.user_id=u.id or a.assigned_by=u.id))
  or exists(select 1 from public.work_task_participants p where p.task_id=t.id and (p.user_id=u.id or p.added_by=u.id))
  or exists(select 1 from public.work_task_comments c where c.task_id=t.id and c.author_user_id=u.id)
  or exists(select 1 from public.work_task_mentions m where m.task_id=t.id and m.mentioned_user_id=u.id)
  or exists(select 1 from public.work_task_submissions s where s.task_id=t.id and (s.submitted_by=u.id or s.reviewed_by=u.id))
  or exists(select 1 from public.work_task_attachments f where f.task_id=t.id and f.uploader_user_id=u.id and f.status='ready' and f.deleted_at is null)
  or (app_private.work_task_actor_can_audit(t.id) and exists(select 1 from public.work_task_events e where e.task_id=t.id and e.actor_user_id=u.id))
 );
 v_scope:=case t.scope_type when 'direct' then 'Trực tiếp' when 'department' then (select name from public.org_units where id=t.department_id) else (select name from public.projects where id=t.project_id) end;
 select name into v_bucket from public.work_task_groups where id=t.task_group_id;
 return jsonb_build_object('names',v_names,'scopeName',v_scope,'bucketName',v_bucket);
end $$;
revoke all on function app_private.work_ui_context(uuid,uuid[]) from public,anon,authenticated;
grant execute on function app_private.work_ui_context(uuid,uuid[]) to authenticated;
create function public.get_work_task_ui_context(p_task_id uuid,p_user_ids uuid[] default '{}') returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_ui_context(p_task_id,p_user_ids); $$;
revoke all on function public.get_work_task_ui_context(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.get_work_task_ui_context(uuid,uuid[]) to authenticated;

create function app_private.work_comment_anchor(p_task_id uuid,p_comment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_c public.work_task_comments%rowtype; v_rows jsonb; v_can boolean;
begin
 if not app_private.work_task_actor_can_view(p_task_id) then raise exception 'WORK_TASK_NOT_FOUND' using errcode='42501'; end if;
 select * into v_c from public.work_task_comments where task_id=p_task_id and id=p_comment_id;
 if v_c.id is null then raise exception 'WORK_COMMENT_NOT_FOUND' using errcode='42501'; end if;
 v_can:=(app_private.work_task_capabilities(p_task_id)->>'canComment')::boolean;
 select jsonb_object_agg(c.id::text,to_jsonb(c)||jsonb_build_object('can_edit',v_can and c.author_user_id=public.current_app_user_id(),'mentionedUserIds',coalesce((select jsonb_agg(m.mentioned_user_id) from public.work_task_mentions m where m.comment_id=c.id),'[]'))) into v_rows
 from public.work_task_comments c where c.task_id=p_task_id and c.id in (v_c.id,v_c.parent_comment_id);
 return jsonb_build_object('comment',v_rows->v_c.id::text,'parent',v_rows->v_c.parent_comment_id::text);
end $$;
revoke all on function app_private.work_comment_anchor(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.work_comment_anchor(uuid,uuid) to authenticated;
create function public.get_work_task_comment_anchor(p_task_id uuid,p_comment_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_comment_anchor(p_task_id,p_comment_id); $$;
revoke all on function public.get_work_task_comment_anchor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_work_task_comment_anchor(uuid,uuid) to authenticated;
