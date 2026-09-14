-- Request discussion, immutable comment edit history, attachment reservations,
-- and private Storage access. All writes are mediated by app_private commands.
create table public.request_comments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.request_instances(id) on delete cascade,
  author_user_id uuid not null references public.users(id),
  parent_comment_id uuid,
  content_document jsonb not null,
  content_text text not null default '',
  lock_version bigint not null default 1 check (lock_version > 0),
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, id),
  foreign key (request_id, parent_comment_id)
    references public.request_comments(request_id, id) on delete restrict,
  check (jsonb_typeof(content_document) = 'object'),
  check (char_length(content_text) <= 10000),
  check (parent_comment_id is distinct from id)
);
create index request_comments_cursor_idx
  on public.request_comments(request_id, created_at desc, id desc);
create index request_comments_parent_idx
  on public.request_comments(parent_comment_id) where parent_comment_id is not null;

create table public.request_comment_edits (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  comment_id uuid not null,
  version bigint not null check (version > 0),
  content_document jsonb not null check (jsonb_typeof(content_document) = 'object'),
  content_text text not null,
  mentioned_user_ids uuid[] not null default '{}',
  edited_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, comment_id)
    references public.request_comments(request_id, id) on delete cascade,
  unique (comment_id, version)
);

create table public.request_comment_mentions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  comment_id uuid not null,
  mentioned_user_id uuid not null references public.users(id),
  mentioned_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, comment_id)
    references public.request_comments(request_id, id) on delete cascade,
  unique (comment_id, mentioned_user_id)
);
create index request_comment_mentions_user_idx
  on public.request_comment_mentions(mentioned_user_id, created_at desc);

create table public.request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.request_instances(id) on delete cascade,
  uploader_user_id uuid not null references public.users(id),
  comment_id uuid,
  kind text not null check (kind in ('discussion_file','discussion_image')),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  storage_path text not null unique,
  status text not null default 'pending'
    check (status in ('pending','processing','ready','failed','deleted')),
  variants jsonb not null default '{}'::jsonb check (jsonb_typeof(variants) = 'object'),
  reservation_expires_at timestamptz not null default (now() + interval '15 minutes'),
  finalized_at timestamptz,
  attached_at timestamptz,
  failure_code text,
  cleanup_token uuid,
  cleanup_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (request_id, comment_id)
    references public.request_comments(request_id, id) on delete restrict,
  check ((kind = 'discussion_image' and size_bytes <= 5242880)
      or kind = 'discussion_file')
);
create index request_attachments_cleanup_idx
  on public.request_attachments(status, reservation_expires_at, created_at)
  where comment_id is null and status <> 'deleted';
create index request_attachments_comment_idx
  on public.request_attachments(comment_id, created_at, id)
  where comment_id is not null;

alter table public.request_comments enable row level security;
alter table public.request_comment_edits enable row level security;
alter table public.request_comment_mentions enable row level security;
alter table public.request_attachments enable row level security;

create policy request_comments_select on public.request_comments
  for select to authenticated
  using (app_private.request_instance_can_select(request_id, public.current_app_user_id()));
create policy request_comment_edits_select on public.request_comment_edits
  for select to authenticated
  using (app_private.request_instance_can_select(request_id, public.current_app_user_id()));
create policy request_comment_mentions_select on public.request_comment_mentions
  for select to authenticated
  using (app_private.request_instance_can_select(request_id, public.current_app_user_id()));
create policy request_attachments_select on public.request_attachments
  for select to authenticated
  using (app_private.request_instance_can_select(request_id, public.current_app_user_id()));

revoke all on public.request_comments, public.request_comment_edits,
  public.request_comment_mentions, public.request_attachments
  from public, anon, authenticated;

create function app_private.request_comment_document_text(p_document jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v_text text; v_node jsonb; v_child jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
    or p_document->>'version' <> '1' or p_document->>'type' <> 'doc'
    or jsonb_typeof(p_document->'content') <> 'array'
    or jsonb_array_length(p_document->'content') > 200 then
    raise exception using errcode='22023', message='REQUEST_COMMENT_DOCUMENT_INVALID';
  end if;
  v_text := '';
  for v_node in select value from jsonb_array_elements(p_document->'content') loop
    if v_node->>'type' <> 'paragraph' or jsonb_typeof(v_node->'content') <> 'array'
      or jsonb_array_length(v_node->'content') > 500 then
      raise exception using errcode='22023', message='REQUEST_COMMENT_DOCUMENT_INVALID';
    end if;
    for v_child in select value from jsonb_array_elements(v_node->'content') loop
      if v_child->>'type' = 'text' and jsonb_typeof(v_child->'text') = 'string'
        and v_child - array['type','text'] = '{}'::jsonb then
        v_text := v_text || (v_child->>'text');
      elsif v_child->>'type' = 'mention'
        and jsonb_typeof(v_child->'userId') = 'string'
        and jsonb_typeof(v_child->'label') = 'string'
        and v_child - array['type','userId','label'] = '{}'::jsonb then
        perform (v_child->>'userId')::uuid;
        v_text := v_text || '@' || (v_child->>'label');
      else
        raise exception using errcode='22023', message='REQUEST_COMMENT_DOCUMENT_INVALID';
      end if;
    end loop;
    v_text := v_text || E'\n';
  end loop;
  v_text := rtrim(v_text, E'\n');
  if char_length(v_text) > 10000 then
    raise exception using errcode='22023', message='REQUEST_COMMENT_TOO_LONG';
  end if;
  return v_text;
exception when invalid_text_representation then
  raise exception using errcode='22023', message='REQUEST_COMMENT_DOCUMENT_INVALID';
end $$;
revoke all on function app_private.request_comment_document_text(jsonb)
  from public, anon, authenticated;

create function app_private.request_comment_mention_ids(p_document jsonb)
returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct (child->>'userId')::uuid order by (child->>'userId')::uuid), '{}')
  from jsonb_array_elements(p_document->'content') paragraph
  cross join lateral jsonb_array_elements(paragraph->'content') child
  where child->>'type' = 'mention';
$$;
revoke all on function app_private.request_comment_mention_ids(jsonb)
  from public, anon, authenticated;

create function app_private.command_request_comment(
  p_command text, p_payload jsonb, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_request public.request_instances%rowtype;
  v_prior app_private.request_command_idempotency%rowtype;
  v_comment public.request_comments%rowtype;
  v_parent public.request_comments%rowtype;
  v_attachment public.request_attachments%rowtype;
  v_request_id uuid;
  v_comment_id uuid;
  v_hash text;
  v_text text;
  v_mentions uuid[] := '{}';
  v_old_mentions uuid[] := '{}';
  v_attachment_ids uuid[] := '{}';
  v_user uuid;
  v_response jsonb;
  v_kind text;
  v_mime text;
  v_size bigint;
  v_file_name text;
begin
  if v_actor is null or p_command not in ('create','edit','reserve_attachment')
    or jsonb_typeof(p_payload) <> 'object' or nullif(p_idempotency_key,'') is null
    or octet_length(p_payload::text) > 150000 then
    raise exception using errcode='22023', message='REQUEST_COMMENT_COMMAND_INVALID';
  end if;
  begin v_request_id := (p_payload->>'requestId')::uuid;
  exception when others then
    raise exception using errcode='22023', message='REQUEST_COMMENT_COMMAND_INVALID'; end;
  v_hash := encode(extensions.digest(jsonb_build_object('command',p_command,'payload',p_payload)::text,'sha256'),'hex');
  insert into app_private.request_command_idempotency(
    actor_id,idempotency_key,command_name,request_id,payload_hash
  ) values(v_actor,p_idempotency_key,'request_comment_'||p_command,v_request_id,v_hash)
  on conflict(actor_id,idempotency_key) do nothing;
  select * into strict v_prior from app_private.request_command_idempotency
    where actor_id=v_actor and idempotency_key=p_idempotency_key for update;
  if v_prior.command_name <> 'request_comment_'||p_command or v_prior.payload_hash <> v_hash then
    raise exception using errcode='40001', message='REQUEST_IDEMPOTENCY_CONFLICT';
  end if;
  if v_prior.result is not null then return v_prior.result; end if;
  if p_command='reserve_attachment' and not app_private.request_feature_enabled('attachments') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED';
  elsif p_command<>'reserve_attachment' and not app_private.request_feature_enabled('discussion_write') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;

  select * into v_request from public.request_instances where id=v_request_id;
  if not found or not app_private.request_instance_can_select(v_request_id,v_actor) then
    raise exception using errcode='42501', message='REQUEST_NOT_FOUND_OR_FORBIDDEN';
  end if;

  if p_command = 'reserve_attachment' then
    if p_payload - array['requestId','fileName','mimeType','sizeBytes','kind'] <> '{}'::jsonb then
      raise exception using errcode='22023', message='REQUEST_ATTACHMENT_INVALID'; end if;
    v_file_name := btrim(p_payload->>'fileName');
    v_mime := lower(btrim(p_payload->>'mimeType'));
    v_size := (p_payload->>'sizeBytes')::bigint;
    v_kind := p_payload->>'kind';
    if char_length(v_file_name) not between 1 and 255
      or v_kind not in ('discussion_file','discussion_image')
      or v_mime not in ('image/jpeg','image/png','image/webp','application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain')
      or v_size < 1 or v_size > (case when v_kind='discussion_image' then 5242880 else 26214400 end)
      or (v_kind='discussion_image' and v_mime not like 'image/%') then
      raise exception using errcode='22023', message='REQUEST_ATTACHMENT_INVALID';
    end if;
    v_attachment.id := gen_random_uuid();
    insert into public.request_attachments(id,request_id,uploader_user_id,kind,file_name,mime_type,size_bytes,storage_path)
    values(v_attachment.id,v_request_id,v_actor,v_kind,v_file_name,v_mime,v_size,
      v_request_id||'/'||v_actor||'/'||v_attachment.id||'/original') returning * into v_attachment;
    v_response := jsonb_build_object('attachmentId',v_attachment.id,'storagePath',v_attachment.storage_path,
      'expiresAt',v_attachment.reservation_expires_at,'status',v_attachment.status);
  else
    if p_command='create' and p_payload - array['requestId','content','parentCommentId','attachmentIds'] <> '{}'::jsonb
      or p_command='edit' and p_payload - array['requestId','commentId','expectedLockVersion','content'] <> '{}'::jsonb then
      raise exception using errcode='22023', message='REQUEST_COMMENT_COMMAND_INVALID'; end if;
    v_text := app_private.request_comment_document_text(p_payload->'content');
    v_mentions := app_private.request_comment_mention_ids(p_payload->'content');
    if exists(
      select 1 from jsonb_array_elements(p_payload->'content'->'content') paragraph
      cross join lateral jsonb_array_elements(paragraph->'content') child
      left join public.users mention_user on mention_user.id=(child->>'userId')::uuid
      where child->>'type'='mention' and (mention_user.id is null or child->>'label'<>mention_user.name)
    ) then raise exception using errcode='22023',message='REQUEST_MENTION_INVALID'; end if;
    if cardinality(v_mentions)>50 then
      raise exception using errcode='22023', message='REQUEST_MENTION_LIMIT'; end if;
    foreach v_user in array v_mentions loop
      if not exists(select 1 from public.users where id=v_user and is_active and account_status='ACTIVE')
        or not app_private.request_instance_can_select(v_request_id,v_user) then
        raise exception using errcode='42501', message='REQUEST_MENTION_INELIGIBLE'; end if;
    end loop;

    if p_command='create' then
      if p_payload ? 'attachmentIds' and jsonb_typeof(p_payload->'attachmentIds') <> 'array' then
        raise exception using errcode='22023', message='REQUEST_ATTACHMENT_INVALID'; end if;
      select coalesce(array_agg(value::uuid order by value::uuid),'{}') into v_attachment_ids
        from jsonb_array_elements_text(coalesce(p_payload->'attachmentIds','[]'));
      if cardinality(v_attachment_ids)>10 or (btrim(v_text)='' and cardinality(v_attachment_ids)=0) then
        raise exception using errcode='22023', message='REQUEST_COMMENT_EMPTY'; end if;
      if p_payload->>'parentCommentId' is not null then
        select * into v_parent from public.request_comments
          where id=(p_payload->>'parentCommentId')::uuid and request_id=v_request_id;
        if not found then raise exception using errcode='42501', message='REQUEST_PARENT_COMMENT_NOT_FOUND'; end if;
      end if;
      if cardinality(v_attachment_ids)>0 and (select count(*) from public.request_attachments
        where id=any(v_attachment_ids) and request_id=v_request_id and uploader_user_id=v_actor
          and status='ready' and comment_id is null and cleanup_token is null) <> cardinality(v_attachment_ids) then
        raise exception using errcode='42501', message='REQUEST_ATTACHMENT_NOT_READY'; end if;
      insert into public.request_comments(request_id,author_user_id,parent_comment_id,content_document,content_text)
      values(v_request_id,v_actor,coalesce(v_parent.parent_comment_id,v_parent.id),p_payload->'content',v_text)
      returning * into v_comment;
      update public.request_attachments set comment_id=v_comment.id,attached_at=now(),updated_at=now()
        where id=any(v_attachment_ids) and comment_id is null and cleanup_token is null;
    else
      v_comment_id := (p_payload->>'commentId')::uuid;
      select * into v_comment from public.request_comments
        where id=v_comment_id and request_id=v_request_id for update;
      if not found or v_comment.author_user_id<>v_actor then
        raise exception using errcode='42501', message='REQUEST_COMMENT_EDIT_FORBIDDEN'; end if;
      if v_comment.lock_version <> (p_payload->>'expectedLockVersion')::bigint then
        raise exception using errcode='40001', message='REQUEST_COMMENT_VERSION_CONFLICT'; end if;
      select coalesce(array_agg(mentioned_user_id order by mentioned_user_id),'{}') into v_old_mentions
        from public.request_comment_mentions where comment_id=v_comment.id;
      insert into public.request_comment_edits(request_id,comment_id,version,content_document,content_text,mentioned_user_ids,edited_by)
      values(v_request_id,v_comment.id,v_comment.lock_version,v_comment.content_document,v_comment.content_text,v_old_mentions,v_actor);
      update public.request_comments set content_document=p_payload->'content',content_text=v_text,
        edited_at=now(),updated_at=now(),lock_version=lock_version+1
        where id=v_comment.id returning * into v_comment;
    end if;
    delete from public.request_comment_mentions where comment_id=v_comment.id
      and not (mentioned_user_id=any(v_mentions));
    insert into public.request_comment_mentions(request_id,comment_id,mentioned_user_id,mentioned_by)
      select v_request_id,v_comment.id,x,v_actor from unnest(v_mentions) x
      on conflict(comment_id,mentioned_user_id) do nothing;
    foreach v_user in array v_mentions loop
      if v_user<>v_actor and not (v_user=any(v_old_mentions)) then
        insert into app_private.request_notification_outbox(event_key,request_id,recipient_user_id,event_type,payload)
        values('request-comment:'||v_comment.id||':mention:'||v_user,v_request_id,v_user,'REQUEST_COMMENT_MENTIONED',
          jsonb_build_object('requestId',v_request_id,'commentId',v_comment.id,
            'route','/rq/'||v_request_id||'?comment='||v_comment.id))
        on conflict(event_key) do nothing;
      end if;
    end loop;
    if p_command='create' then
      insert into app_private.request_notification_outbox(event_key,request_id,recipient_user_id,event_type,payload)
      select 'request-comment:'||v_comment.id||':activity:'||recipient.user_id,
        v_request_id,recipient.user_id,'REQUEST_COMMENT_CREATED',
        jsonb_build_object('requestId',v_request_id,'commentId',v_comment.id,
          'route','/rq/'||v_request_id||'?comment='||v_comment.id)
      from (
        select v_request.created_by user_id
        union select a.assignee_user_id from public.workflow_step_assignments a
          where a.workflow_subject_id=v_request.workflow_subject_id and a.status='PENDING'
        union select w.user_id from public.request_template_watchers w
          where w.request_template_version_id=v_request.request_template_version_id
      ) recipient
      where recipient.user_id<>v_actor and not (recipient.user_id=any(v_mentions))
      on conflict(event_key) do nothing;
    end if;
    v_response := jsonb_build_object('id',v_comment.id,'requestId',v_request_id,
      'lockVersion',v_comment.lock_version,'createdAt',v_comment.created_at,'editedAt',v_comment.edited_at);
  end if;
  update app_private.request_command_idempotency set result=v_response where id=v_prior.id;
  return v_response;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023', message='REQUEST_COMMENT_COMMAND_INVALID';
end $$;
revoke all on function app_private.command_request_comment(text,jsonb,text)
  from public,anon,authenticated;

create function public.command_request_comment(
  p_command text,p_payload jsonb,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.command_request_comment(p_command,p_payload,p_idempotency_key);
$$;
revoke all on function public.command_request_comment(text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.command_request_comment(text,jsonb,text) to authenticated;

create function app_private.list_request_comments(
  p_request_id uuid,p_cursor text,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_n integer:=least(100,greatest(1,coalesce(p_limit,30)));
  v_at timestamptz; v_id uuid; v_rows jsonb; v_total bigint;
begin
  if not app_private.request_feature_enabled('discussion_read') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;
  if not app_private.request_instance_can_select(p_request_id,public.current_app_user_id()) then
    raise exception using errcode='42501', message='REQUEST_NOT_FOUND_OR_FORBIDDEN'; end if;
  if p_cursor is not null then
    begin
      v_at:=split_part(p_cursor,'|',1)::timestamptz;
      v_id:=split_part(p_cursor,'|',2)::uuid;
    exception when others then raise exception using errcode='22023',message='REQUEST_CURSOR_INVALID'; end;
  end if;
  select count(*) into v_total from public.request_comments where request_id=p_request_id;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."createdAt" desc,q.id desc),'[]') into v_rows from (
    select c.id,c.request_id as "requestId",c.parent_comment_id as "parentCommentId",
      jsonb_build_object('id',u.id,'name',u.name,'avatarUrl',u.avatar,'position',null) as author,
      c.content_document as content,c.content_text as "contentText",c.lock_version as "lockVersion",
      c.created_at as "createdAt",c.edited_at as "editedAt",
      c.author_user_id=public.current_app_user_id() as "canEdit",
      coalesce((select jsonb_agg(m.mentioned_user_id order by m.mentioned_user_id)
        from public.request_comment_mentions m where m.comment_id=c.id),'[]') as "mentionedUserIds",
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'kind',a.kind,'fileName',a.file_name,
        'mimeType',a.mime_type,'sizeBytes',a.size_bytes,'status',a.status,'variants',a.variants)
        order by a.created_at,a.id) from public.request_attachments a
        where a.comment_id=c.id and a.status='ready'),'[]') as attachments
    from public.request_comments c join public.users u on u.id=c.author_user_id
    where c.request_id=p_request_id and (v_at is null or (c.created_at,c.id)<(v_at,v_id))
    order by c.created_at desc,c.id desc limit v_n+1
  ) q;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]')
      from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
    'total',v_total,
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then
      (v_rows->(v_n-1)->>'createdAt')||'|'||(v_rows->(v_n-1)->>'id') else null end);
end $$;
revoke all on function app_private.list_request_comments(uuid,text,integer)
  from public,anon,authenticated;

create function public.list_request_comments(p_request_id uuid,p_cursor text default null,p_limit integer default 30)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.list_request_comments(p_request_id,p_cursor,p_limit);
$$;
revoke all on function public.list_request_comments(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_request_comments(uuid,text,integer) to authenticated;

create function app_private.list_request_mention_candidates(
  p_request_id uuid,p_search text,p_cursor text,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_n integer:=least(50,greatest(1,coalesce(p_limit,20))); v_rows jsonb; v_cursor uuid;
begin
  if not app_private.request_feature_enabled('discussion_write') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;
  if not app_private.request_instance_can_select(p_request_id,public.current_app_user_id()) then
    raise exception using errcode='42501', message='REQUEST_NOT_FOUND_OR_FORBIDDEN'; end if;
  if char_length(coalesce(p_search,''))>100 then
    raise exception using errcode='22023',message='REQUEST_SEARCH_INVALID'; end if;
  begin v_cursor:=nullif(p_cursor,'')::uuid;
  exception when others then raise exception using errcode='22023',message='REQUEST_CURSOR_INVALID'; end;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."userId"),'[]') into v_rows from (
    select u.id as "userId",u.name,u.avatar as "avatarUrl",null::text as position
    from public.users u where u.is_active and u.account_status='ACTIVE'
      and (v_cursor is null or u.id>v_cursor)
      and (nullif(btrim(p_search),'') is null or u.name ilike '%'||btrim(p_search)||'%'
        or u.username ilike '%'||btrim(p_search)||'%')
      and app_private.request_instance_can_select(p_request_id,u.id)
    order by u.id limit v_n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]')
      from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then v_rows->(v_n-1)->>'userId' else null end);
end $$;
revoke all on function app_private.list_request_mention_candidates(uuid,text,text,integer)
  from public,anon,authenticated;

create function public.list_request_mention_candidates(
  p_request_id uuid,p_search text default '',p_cursor text default null,p_limit integer default 20
) returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.list_request_mention_candidates(p_request_id,p_search,p_cursor,p_limit);
$$;
revoke all on function public.list_request_mention_candidates(uuid,text,text,integer)
  from public,anon,authenticated;
grant execute on function public.list_request_mention_candidates(uuid,text,text,integer) to authenticated;

create function public.get_request_comment_anchor(p_request_id uuid,p_comment_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select case when app_private.request_feature_enabled('discussion_read')
    and app_private.request_instance_can_select(p_request_id,public.current_app_user_id()) then
    (select jsonb_build_object('commentId',c.id,'rootCommentId',coalesce(c.parent_comment_id,c.id),
      'createdAt',c.created_at,'cursor',(c.created_at+interval '1 microsecond')::text||'|00000000-0000-0000-0000-000000000000') from public.request_comments c
      where c.request_id=p_request_id and c.id=p_comment_id) else null end;
$$;
revoke all on function public.get_request_comment_anchor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_request_comment_anchor(uuid,uuid) to authenticated;

create function app_private.list_request_activity(p_request_id uuid,p_cursor text,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_n integer:=least(100,greatest(1,coalesce(p_limit,40))); v_at timestamptz; v_type text; v_id uuid; v_rows jsonb;
begin
  if not app_private.request_feature_enabled('discussion_read')
    or not app_private.request_instance_can_select(p_request_id,public.current_app_user_id()) then
    raise exception using errcode='42501',message='REQUEST_NOT_FOUND_OR_FORBIDDEN'; end if;
  if p_cursor is not null then begin
    v_at:=split_part(p_cursor,'|',1)::timestamptz;v_type:=split_part(p_cursor,'|',2);v_id:=split_part(p_cursor,'|',3)::uuid;
  exception when others then raise exception using errcode='22023',message='REQUEST_CURSOR_INVALID';end;end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."createdAt" desc,q."itemType" desc,q.id desc),'[]') into v_rows from (
    select * from (
      select c.id,'comment'::text as "itemType",c.created_at as "createdAt",
        jsonb_build_object('commentId',c.id,'authorUserId',c.author_user_id,'isReply',c.parent_comment_id is not null) payload
      from public.request_comments c where c.request_id=p_request_id
      union all
      select r.id,'revision',r.created_at,jsonb_build_object('revision',r.revision,'changedBy',r.changed_by)
        from public.request_content_revisions r where r.request_id=p_request_id
      union all
      select l.id,'workflow',l.created_at,jsonb_build_object('action',l.action,'actedBy',l.acted_by,'comment',l.comment)
        from public.workflow_instance_logs l where l.instance_id=(select workflow_instance_id from public.request_instances where id=p_request_id)
    ) source where v_at is null or (source."createdAt",source."itemType",source.id)<(v_at,v_type,v_id)
    order by source."createdAt" desc,source."itemType" desc,source.id desc limit v_n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then (v_rows->(v_n-1)->>'createdAt')||'|'||(v_rows->(v_n-1)->>'itemType')||'|'||(v_rows->(v_n-1)->>'id') else null end);
end $$;
revoke all on function app_private.list_request_activity(uuid,text,integer) from public,anon,authenticated;
create function public.list_request_activity(p_request_id uuid,p_cursor text default null,p_limit integer default 40)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.list_request_activity(p_request_id,p_cursor,p_limit);
$$;
revoke all on function public.list_request_activity(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_request_activity(uuid,text,integer) to authenticated;

-- Edge workers call these as service_role after validating the object bytes.
create function app_private.claim_request_attachment(p_attachment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_attachment public.request_attachments%rowtype; v_actor uuid:=public.current_app_user_id();
begin
  if not app_private.request_feature_enabled('attachments') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;
  select * into v_attachment from public.request_attachments where id=p_attachment_id for update;
  if not found or v_attachment.uploader_user_id<>v_actor
    or not app_private.request_instance_can_select(v_attachment.request_id,v_actor) then
    raise exception using errcode='42501',message='REQUEST_ATTACHMENT_FORBIDDEN'; end if;
  if v_attachment.status='ready' then return jsonb_build_object('id',v_attachment.id,'status','ready'); end if;
  if v_attachment.status<>'pending' or v_attachment.reservation_expires_at<=now() then
    raise exception using errcode='22023',message='REQUEST_ATTACHMENT_NOT_PENDING'; end if;
  update public.request_attachments set status='processing',updated_at=now()
    where id=v_attachment.id returning * into v_attachment;
  return jsonb_build_object('id',v_attachment.id,'status',v_attachment.status,
    'sourcePath',v_attachment.storage_path,'outputPrefix',v_attachment.request_id||'/'||v_attachment.uploader_user_id||'/'||v_attachment.id||'/',
    'mimeType',v_attachment.mime_type,'sizeBytes',v_attachment.size_bytes,'kind',v_attachment.kind);
end $$;
revoke all on function app_private.claim_request_attachment(uuid) from public,anon,authenticated;

create function public.claim_request_attachment(p_attachment_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select app_private.claim_request_attachment(p_attachment_id);
$$;
revoke all on function public.claim_request_attachment(uuid) from public,anon,authenticated;
grant execute on function public.claim_request_attachment(uuid) to authenticated;

create function app_private.authorize_request_attachment(p_attachment_id uuid,p_variant text default 'original')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_attachment public.request_attachments%rowtype; v_path text;
begin
  if not app_private.request_feature_enabled('discussion_read') then
    raise exception using errcode='42501',message='REQUEST_FEATURE_DISABLED'; end if;
  select * into v_attachment from public.request_attachments where id=p_attachment_id;
  if not found or v_attachment.status<>'ready'
    or not app_private.request_instance_can_select(v_attachment.request_id,public.current_app_user_id()) then
    raise exception using errcode='42501',message='REQUEST_ATTACHMENT_FORBIDDEN'; end if;
  v_path:=case when p_variant='original' then v_attachment.storage_path
    else v_attachment.variants->p_variant->>'path' end;
  if v_path is null then raise exception using errcode='22023',message='REQUEST_ATTACHMENT_VARIANT_INVALID'; end if;
  return jsonb_build_object('path',v_path,'fileName',v_attachment.file_name,
    'mimeType',coalesce(v_attachment.variants->p_variant->>'mimeType',v_attachment.mime_type),
    'download',p_variant='original' or v_attachment.kind='discussion_file');
end $$;
revoke all on function app_private.authorize_request_attachment(uuid,text) from public,anon,authenticated;

create function public.authorize_request_attachment(p_attachment_id uuid,p_variant text default 'original')
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.authorize_request_attachment(p_attachment_id,p_variant);
$$;
revoke all on function public.authorize_request_attachment(uuid,text) from public,anon,authenticated;
grant execute on function public.authorize_request_attachment(uuid,text) to authenticated;

create function app_private.finalize_request_attachment(
  p_attachment_id uuid,p_success boolean,p_variants jsonb default '{}',p_failure_code text default null
) returns void language plpgsql security definer set search_path='' as $$
begin
  update public.request_attachments set status=case when p_success then 'ready' else 'failed' end,
    variants=coalesce(p_variants,'{}'),failure_code=case when p_success then null else p_failure_code end,
    finalized_at=case when p_success then now() end,updated_at=now()
  where id=p_attachment_id and status in ('pending','processing');
end $$;
revoke all on function app_private.finalize_request_attachment(uuid,boolean,jsonb,text)
  from public,anon,authenticated;
grant execute on function app_private.finalize_request_attachment(uuid,boolean,jsonb,text) to service_role;

create function app_private.claim_request_attachment_cleanup(p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_rows jsonb;
begin
  with candidates as (
    select id from public.request_attachments
    where comment_id is null and status in ('pending','processing','ready','failed')
      and (cleanup_token is null or cleanup_claimed_at<now()-interval '15 minutes')
      and ((status in ('pending','processing','failed') and reservation_expires_at<now())
        or (status='ready' and created_at<now()-interval '24 hours'))
    order by created_at,id for update skip locked limit least(100,greatest(1,coalesce(p_limit,30)))
  ), claimed as (
    update public.request_attachments a set cleanup_token=gen_random_uuid(),cleanup_claimed_at=now(),updated_at=now()
    from candidates c where a.id=c.id
    returning a.id,a.storage_path as path,a.cleanup_token as token,
      coalesce((select jsonb_agg(value->>'path') from jsonb_each(a.variants) where value ? 'path'),'[]') as "variantPaths"
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into v_rows from claimed;
  return v_rows;
end $$;
revoke all on function app_private.claim_request_attachment_cleanup(integer) from public,anon,authenticated;
grant execute on function app_private.claim_request_attachment_cleanup(integer) to service_role;

create function app_private.finish_request_attachment_cleanup(p_id uuid,p_token uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_success then
    update public.request_attachments set status='deleted',cleanup_token=null,cleanup_claimed_at=null,updated_at=now()
      where id=p_id and cleanup_token=p_token and comment_id is null;
  else
    update public.request_attachments set cleanup_token=null,cleanup_claimed_at=null,updated_at=now()
      where id=p_id and cleanup_token=p_token and comment_id is null;
  end if;
  return found;
end $$;
revoke all on function app_private.finish_request_attachment_cleanup(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.finish_request_attachment_cleanup(uuid,uuid,boolean) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('request-attachments','request-attachments',false,26214400,array[
  'image/jpeg','image/png','image/webp','application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create function app_private.request_attachment_storage_can_select(p_name text,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.request_attachments a
    where a.storage_path=p_name and a.status='ready'
      and app_private.request_instance_can_select(a.request_id,p_user));
$$;
create function app_private.request_attachment_storage_can_insert(p_name text,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.request_attachments a
    where a.storage_path=p_name and a.uploader_user_id=p_user and a.status='pending'
      and a.reservation_expires_at>now());
$$;
revoke all on function app_private.request_attachment_storage_can_select(text,uuid),
  app_private.request_attachment_storage_can_insert(text,uuid) from public,anon,authenticated;

create policy request_attachments_storage_insert on storage.objects for insert to authenticated
  with check(bucket_id='request-attachments' and
    app_private.request_attachment_storage_can_insert(name,public.current_app_user_id()));
create or replace function app_private.deliver_request_notification(p_outbox_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_outbox app_private.request_notification_outbox%rowtype; v_request public.request_instances%rowtype;
  v_notification_id uuid; v_allowed boolean; v_link text; v_title text; v_message text;
begin
  perform app_private.require_request_notification_worker();
  select * into v_outbox from app_private.request_notification_outbox where id=p_outbox_id for update;
  if not found or v_outbox.status='DELIVERED' then return jsonb_build_object('delivered',false);end if;
  if v_outbox.status<>'PROCESSING' then raise exception using errcode='P0001',message='REQUEST_NOTIFICATION_NOT_CLAIMED';end if;
  select * into v_request from public.request_instances where id=v_outbox.request_id;
  if not found then raise exception using errcode='P0001',message='REQUEST_NOTIFICATION_REQUEST_MISSING';end if;
  v_allowed:=app_private.request_instance_can_select(v_request.id,v_outbox.recipient_user_id);
  if not v_allowed and v_outbox.event_type<>'REQUEST_APPROVAL_RESTARTED' then
    update app_private.request_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null where id=v_outbox.id;
    return jsonb_build_object('delivered',false,'suppressed','permission');
  end if;
  v_title:=case v_outbox.event_type when 'REQUEST_COMMENT_MENTIONED' then 'Bạn được nhắc trong thảo luận'
    when 'REQUEST_COMMENT_CREATED' then 'Đề xuất có thảo luận mới'
    when 'REQUEST_APPROVAL_RESTARTED' then 'Nhiệm vụ duyệt đã được cập nhật'
    when 'REQUEST_SUBMITTED' then 'Đề xuất mới cần duyệt' when 'REQUEST_APPROVAL_REQUIRED' then 'Bạn có đề xuất cần duyệt'
    when 'REQUEST_REASSIGNED' then 'Đề xuất được chuyển người duyệt' when 'REQUEST_RETURNED' then 'Đề xuất đã được trả lại'
    when 'REQUEST_APPROVED' then 'Đề xuất đã được chấp thuận' when 'REQUEST_REJECTED' then 'Đề xuất đã bị từ chối'
    else 'Cập nhật đề xuất' end;
  v_link:=case when v_allowed then coalesce(v_outbox.payload->>'route','/rq/'||v_request.id) else '/rq' end;
  v_message:=case when v_allowed then v_request.code||' · '||v_request.title else 'Nhiệm vụ duyệt trước đó đã kết thúc.' end;
  insert into public.notifications(user_id,type,category,title,message,link,severity,source_type,source_id,priority,push_enabled,action_url,entity_type,entity_id,metadata)
  values(v_outbox.recipient_user_id,'info','request',v_title,v_message,v_link,'info','request_instance',v_request.id::text,
    case when v_outbox.event_type in ('REQUEST_COMMENT_MENTIONED','REQUEST_APPROVAL_REQUIRED') then 'high' else 'normal' end,
    true,v_link,'request_instance',v_request.id,jsonb_build_object('requestInstanceId',v_request.id,'requestCode',case when v_allowed then v_request.code end,
      'eventType',v_outbox.event_type,'eventKey',v_outbox.event_key,'commentId',v_outbox.payload->>'commentId')) returning id into v_notification_id;
  update app_private.request_notification_outbox set status='DELIVERED',delivered_at=now(),locked_at=null,last_error=null where id=v_outbox.id;
  return jsonb_build_object('delivered',true,'notificationId',v_notification_id);
end $$;
revoke all on function app_private.deliver_request_notification(uuid) from public,anon,authenticated;
grant execute on function app_private.deliver_request_notification(uuid) to service_role;
