begin;
create temporary table work_inline_people(name text primary key,id uuid,email text) on commit drop;
create temporary table work_inline_data(key text primary key,value jsonb) on commit drop;
grant select on work_inline_people to authenticated;
grant all on work_inline_data to authenticated;
insert into work_inline_people select name,gen_random_uuid(),'inline-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','author','first','second','outsider']) name;
insert into public.users(id,name,username,email,role,is_active,account_status)
select id,case when name in ('first','second') then 'Trùng Tên' else name end,'inline-'||id,email,'EMPLOYEE',true,'ACTIVE' from work_inline_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','inline rollback smoke' from work_inline_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,code,'global','*','inline rollback smoke' from work_inline_people cross join unnest(array['work.task.view_related','work.task.assign_user','work.task.review']) code where name<>'outsider';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.create','own','*','inline rollback smoke' from work_inline_people where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.manage_scope','global','*','inline rollback smoke' from work_inline_people where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.audit_view','global','*','inline rollback smoke' from work_inline_people where name='author';
insert into public.work_sla_calendars(name,workday_start,workday_end,is_default,created_by)
select 'Inline mention calendar','08:00','17:00',true,id from work_inline_people where name='creator';
create function pg_temp.work_as(p_name text) returns void language plpgsql security invoker set search_path='' as $$ begin
 perform set_config('request.jwt.claims',(select jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text from pg_temp.work_inline_people where name=p_name),true);
end $$;
create function pg_temp.doc(p_text text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',p_text)))));
$$;
create function pg_temp.mention_doc(p_prefix text,p_user uuid,p_label text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',p_prefix),jsonb_build_object('type','mention','userId',p_user,'label',p_label)))));
$$;
set local role authenticated;
select pg_temp.work_as('creator');
do $$ declare i jsonb;p jsonb;r jsonb; begin
 i:=jsonb_build_object('title','Inline mention task','description',pg_temp.doc('fixture'),'scope','{"type":"direct"}'::jsonb,
 'recipientSources',jsonb_build_array(jsonb_build_object('type','user','id',(select id from work_inline_people where name='first'))),
 'watcherUserIds',jsonb_build_array((select id from work_inline_people where name='author')),
 'reviewPolicy','reviewer_review','reviewerUserId',(select id from work_inline_people where name='second'),
 'priority','normal','privacy','standard','labels','[]'::jsonb,'checklist','[]'::jsonb);
 p:=public.preview_work_task_recipients(i->'recipientSources',i->'scope'); r:=public.create_work_task(i,gen_random_uuid(),p->>'fingerprint');
 insert into work_inline_data values('task',r);
end $$;
select pg_temp.work_as('author');
do $$ declare t uuid:=(select (value->>'taskId')::uuid from work_inline_data where key='task'); r jsonb; c uuid; k uuid:=gen_random_uuid(); first_id uuid:=(select id from work_inline_people where name='first'); second_id uuid:=(select id from work_inline_people where name='second'); begin
 r:=public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.mention_doc('Nhờ ',first_id,'Trùng Tên'),'mentionedUserIds',jsonb_build_array(second_id)),k);
 c:=(r->'comment'->>'id')::uuid; insert into work_inline_data values('comment',to_jsonb(c));
 if r->'comment'->'mentionedUserIds'<>jsonb_build_array(first_id) or r->'comment'->>'content_text'<>'Nhờ @Trùng Tên' then raise exception 'TEST_DERIVED_MENTION %',r; end if;
 if (select count(*) from public.work_task_mentions where comment_id=c)<>1 then raise exception 'TEST_MENTION_ROW'; end if;
 if (select count(*) from public.work_task_events where task_id=t and event_type='comment.mentioned')<>1 then raise exception 'TEST_MENTION_EVENT'; end if;
 if public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.mention_doc('Nhờ ',first_id,'Trùng Tên'),'mentionedUserIds',jsonb_build_array(second_id)),k) is distinct from r then raise exception 'TEST_RETRY'; end if;
 r:=public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.doc('Gõ @Trùng Tên nhưng không chọn')),gen_random_uuid());
 if jsonb_array_length(r->'comment'->'mentionedUserIds')<>0 then raise exception 'TEST_TYPED_TEXT_AUTHORITY'; end if;
 r:=public.command_work_task_collaboration(t,'comment_edit',jsonb_build_object('commentId',c,'expectedLockVersion',1,'content',jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','mention','userId',first_id,'label','Trùng Tên'),jsonb_build_object('type','mention','userId',first_id,'label','Trùng Tên'),jsonb_build_object('type','mention','userId',second_id,'label','Trùng Tên')))))),gen_random_uuid());
 if jsonb_array_length(r->'comment'->'mentionedUserIds')<>2 then raise exception 'TEST_DEDUPE_OR_SAME_NAME'; end if;
 if (select count(*) from public.work_task_events where task_id=t and event_type='comment.mentioned')<>2 then raise exception 'TEST_ONLY_NEW_MENTION_EVENT'; end if;
 r:=public.command_work_task_collaboration(t,'comment_edit',jsonb_build_object('commentId',c,'expectedLockVersion',2,'content',pg_temp.mention_doc('Giữ ',second_id,'Trùng Tên')),gen_random_uuid());
 if (select count(*) from public.work_task_events where task_id=t and event_type='comment.mentioned')<>2 then raise exception 'TEST_RETAIN_REMOVE_RENOTIFIED'; end if;
 begin perform public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"html","text":"x"}]}]}'::jsonb),gen_random_uuid()); raise exception 'TEST_UNKNOWN_NODE'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link"}]}]}]}'::jsonb),gen_random_uuid()); raise exception 'TEST_UNKNOWN_MARK'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.mention_doc('X ',first_id,repeat('x',201))),gen_random_uuid()); raise exception 'TEST_LABEL_LENGTH'; exception when invalid_parameter_value then null; end;
 begin perform public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content',pg_temp.mention_doc('X ',(select id from work_inline_people where name='outsider'),'Outsider')),gen_random_uuid()); raise exception 'TEST_INELIGIBLE'; exception when insufficient_privilege then null; end;
 if exists(select 1 from public.work_task_mentions where task_id=t and mentioned_user_id=(select id from work_inline_people where name='outsider')) then raise exception 'TEST_INELIGIBLE_ATOMICITY'; end if;
 begin perform public.command_work_task_collaboration(t,'comment_create',jsonb_build_object('content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","userId":"bad","label":"x"}]}]}'::jsonb),gen_random_uuid()); raise exception 'TEST_BAD_UUID'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ declare t uuid:=(select (value->>'taskId')::uuid from work_inline_data where key='task'); begin
 if (select count(*) from app_private.work_notification_outbox where task_id=t and event_type='comment.mentioned')<>2 then raise exception 'TEST_RETRY_OR_EDIT_OUTBOX'; end if;
end $$;
rollback;
