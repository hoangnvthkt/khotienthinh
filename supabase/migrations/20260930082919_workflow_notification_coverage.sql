-- Quy trình notifications must reach everyone involved in a ticket, on time.
--
-- 1. People named on a ticket (creator, handler, watcher, @mentioned) can open
--    that ticket and receive its notifications even without the Quy trình
--    module permission (owner decision 30/09/2026). Access stays per ticket.
-- 2. @mention makes the person a participant (role MENTIONED) so the mention
--    is delivered and the link opens.
-- 3. Participants resync when a ticket changes stage (reopen / step watchers).
-- 4. Finishing a ticket sends one "đã hoàn tất" instead of also "đã duyệt".
-- 5. "Tất cả phải duyệt": each partial approval tells everyone, including the
--    co-approvers still pending, with progress (1/3).
-- 6. SLA reminders (sắp đến hạn / quá hạn) for Quy trình stages were never
--    enqueued; the worker tick now runs them and they go to current handlers.

-- 2. MENTIONED participant role -------------------------------------------
alter table public.workflow_instance_participants
  drop constraint if exists workflow_instance_participants_participant_role_check;
alter table public.workflow_instance_participants
  add constraint workflow_instance_participants_participant_role_check
  check (participant_role = any (array['CREATOR'::text, 'ASSIGNEE'::text, 'WATCHER'::text, 'MENTIONED'::text]));

create or replace function app_private.upsert_workflow_instance_participant(p_instance_id uuid, p_user_id uuid, p_participant_role text, p_source_ref text default null::text, p_ended_at timestamp with time zone default null::timestamp with time zone)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_participant_role not in ('CREATOR', 'ASSIGNEE', 'WATCHER', 'MENTIONED') then
    raise exception 'WORKFLOW_PARTICIPANT_ROLE_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.workflow_subjects
    where workflow_instance_id = p_instance_id
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.workflow_instances where id = p_instance_id
  ) then
    raise exception 'WORKFLOW_INSTANCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.users
    where id = p_user_id and is_active and account_status = 'ACTIVE'
  ) then
    raise exception 'WORKFLOW_PARTICIPANT_USER_INVALID' using errcode = '22023';
  end if;

  insert into public.workflow_instance_participants(
    instance_id, user_id, participant_role, source_ref, joined_at, last_confirmed_at, ended_at
  ) values (
    p_instance_id, p_user_id, p_participant_role, p_source_ref, now(), now(),
    case when p_participant_role = 'WATCHER' then p_ended_at else null end
  )
  on conflict (instance_id, user_id, participant_role) do update
  set source_ref = coalesce(excluded.source_ref, public.workflow_instance_participants.source_ref),
      last_confirmed_at = now(),
      ended_at = case
        when public.workflow_instance_participants.participant_role = 'WATCHER' then excluded.ended_at
        else null
      end,
      updated_at = now();
end;
$function$;

create or replace function app_private.notify_workflow_instance_comment_mentions()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_mentions uuid[];
  v_user uuid;
begin
  select coalesce(array_agg((mention_row ->> 'userId')::uuid), '{}') into v_mentions
  from jsonb_array_elements(new.mentions) mention_row
  where (mention_row ->> 'userId') ~* '^[0-9a-f-]{36}$';

  -- A mention invites the person into this ticket.
  foreach v_user in array v_mentions loop
    perform app_private.upsert_workflow_instance_participant(
      new.instance_id, v_user, 'MENTIONED', 'mention:' || new.id::text
    );
  end loop;

  perform app_private.enqueue_workflow_notification_event(
    new.instance_id, 'workflow.commented', new.author_user_id,
    'workflow.comment:' || new.id, jsonb_build_object('commentId', new.id)
  );
  if cardinality(v_mentions) > 0 then
    perform app_private.enqueue_workflow_notification_event(
      new.instance_id, 'workflow.mentioned', new.author_user_id,
      'workflow.mention:' || new.id, jsonb_build_object('commentId', new.id), v_mentions
    );
  end if;
  return new;
end;
$function$;

-- 1. Per-ticket access for people named on it ------------------------------
create or replace function app_private.workflow_instance_user_can_select(p_instance_id uuid, p_user_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.workflow_instances instance_row
    join public.users user_row on user_row.id = p_user_id
      and user_row.is_active
      and user_row.account_status = 'ACTIVE'
    where instance_row.id = p_instance_id
      and not exists (
        select 1 from public.workflow_subjects subject_row
        where subject_row.workflow_instance_id = instance_row.id
      )
      and (
        app_private.has_permission(p_user_id, 'workflow.instance.view', 'global', '*')
        or app_private.has_permission(p_user_id, 'workflow.instance.administer', 'global', '*')
        -- Creator, handler, watcher or @mentioned person on this ticket.
        or exists (
          select 1
          from public.workflow_instance_participants participant_row
          where participant_row.instance_id = instance_row.id
            and participant_row.user_id = p_user_id
            and participant_row.ended_at is null
        )
      )
  );
$function$;

-- The ticket page needs the template's stages to render; participants of a
-- ticket may read the template it runs on.
create or replace function app_private.workflow_template_actor_can_view(p_template_id uuid, p_actor_id uuid default current_app_user_id())
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.workflow_templates template_row
    where template_row.id = p_template_id
      and p_actor_id is not null
      and (
        public.is_admin()
        or app_private.workflow_has_action(
          'workflow.template.view', template_row.created_by, null, p_actor_id
        )
        or (
          p_actor_id::text = any(coalesce(template_row.managers, '{}'::text[]))
          and app_private.has_permission(
            p_actor_id, 'workflow.template.view', 'assigned', p_actor_id::text
          )
        )
        or (
          not app_private.workflow_action_is_enforced('workflow.template.view')
          and p_actor_id = public.current_app_user_id()
          and app_private.can_access_module('WF')
        )
        or exists (
          select 1
          from public.workflow_subjects subject_row
          where subject_row.workflow_instance_id in (
            select instance_row.id
            from public.workflow_instances instance_row
            where instance_row.template_id = template_row.id
          )
            and app_private.project_workflow_actor_can_select(subject_row.id)
        )
        or app_private.project_owned_workflow_actor_has_room_action(template_row.id, p_actor_id, 'view')
        or exists (
          select 1
          from public.workflow_instances instance_row
          join public.workflow_instance_participants participant_row
            on participant_row.instance_id = instance_row.id
           and participant_row.user_id = p_actor_id
           and participant_row.ended_at is null
          where instance_row.template_id = template_row.id
        )
      )
  );
$function$;

-- 3. Resync participants when the stage changes ----------------------------
drop trigger if exists trg_sync_workflow_instance_participants on public.workflow_instances;
create trigger trg_sync_workflow_instance_participants
  after insert or update of created_by, watchers, step_assignees, current_node_id
  on public.workflow_instances
  for each row execute function app_private.sync_workflow_instance_participants();

-- 4 + 5. Log → notification events -----------------------------------------
create or replace function app_private.enqueue_workflow_log_notification()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  i public.workflow_instances%rowtype;
  v_event text;
  v_extra uuid[] := '{}';
  v_current jsonb;
  v_payload jsonb;
  v_held boolean := false;
begin
  select * into strict i from public.workflow_instances where id = new.instance_id;
  -- The constraint trigger runs after the lifecycle command commits its update.
  -- Resolve the assignment from the post-transition current node, not the log's
  -- historical node, so a forwarded step reaches the new assignee.
  v_current := i.step_assignees -> i.current_node_id::text;
  select coalesce(array_agg(distinct x.value::uuid), '{}') into v_extra
  from (
    select case when jsonb_typeof(v_current) = 'string' then v_current #>> '{}' end as value
    union all
    select value from jsonb_array_elements_text(
      case when jsonb_typeof(v_current) = 'array' then v_current else '[]'::jsonb end
    )
  ) x
  where x.value ~* '^[0-9a-f-]{36}$';

  -- "Tất cả phải duyệt": an approval that left the ticket on the same stage.
  v_held := new.action = 'APPROVED'
    and i.status = 'RUNNING'
    and i.current_node_id = new.node_id;

  v_event := case new.action
    when 'SUBMITTED' then 'workflow.submitted'
    -- Finishing the ticket is reported once, as workflow.completed.
    when 'APPROVED' then case when i.status = 'COMPLETED' then null else 'workflow.step_approved' end
    when 'REJECTED' then case when i.status = 'CANCELLED' then 'workflow.cancelled' else 'workflow.rejected' end
    when 'REVISION_REQUESTED' then 'workflow.revision_requested'
    when 'REOPENED' then 'workflow.reopened'
    else null
  end;

  v_payload := jsonb_build_object('nodeId', coalesce(i.current_node_id, new.node_id), 'outgoingNodeId', new.node_id);
  if v_held then
    v_payload := v_payload || jsonb_build_object(
      'held', true,
      'approvedCount', case
        when jsonb_typeof(i.step_approvals -> new.node_id::text) = 'array'
        then jsonb_array_length(i.step_approvals -> new.node_id::text) else 0 end,
      'requiredCount', cardinality(v_extra)
    );
  end if;

  if v_event is not null then
    perform app_private.enqueue_workflow_notification_event(
      i.id, v_event, new.acted_by, 'workflow.log:' || new.id, v_payload, v_extra
    );
  end if;

  if new.action = 'SUBMITTED' and i.status = 'RUNNING' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action in ('APPROVED', 'REVISION_REQUESTED')
    and i.status = 'RUNNING'
    and i.current_node_id is distinct from new.node_id then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action = 'REOPENED' and i.status = 'RUNNING' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.step_assigned', new.acted_by, 'workflow.assigned:' || new.id,
      jsonb_build_object('nodeId', i.current_node_id, 'outgoingNodeId', new.node_id), v_extra
    );
  elsif new.action = 'APPROVED' and i.status = 'COMPLETED' then
    perform app_private.enqueue_workflow_notification_event(
      i.id, 'workflow.completed', new.acted_by, 'workflow.completed:' || new.id,
      jsonb_build_object('nodeId', new.node_id)
    );
  end if;
  return new;
end;
$function$;

-- 5 + 6. Recipients: held approvals reach pending co-approvers; reminders go
-- to the explicit handlers passed in.
create or replace function app_private.enqueue_workflow_notification_event(p_instance_id uuid, p_event_type text, p_actor_id uuid, p_event_key text, p_payload jsonb default '{}'::jsonb, p_recipient_user_ids uuid[] default null::uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  i public.workflow_instances%rowtype;
  v_recipients uuid[] := '{}';
  v_current_assignees uuid[] := '{}';
  v_held boolean := coalesce((p_payload ->> 'held')::boolean, false);
begin
  if exists (select 1 from public.request_instances r where r.workflow_instance_id = p_instance_id)
    or exists (
      select 1 from public.workflow_subjects s
      where s.workflow_instance_id = p_instance_id
        and s.subject_type in ('request', 'project')
    ) then
    return 0;
  end if;

  select * into strict i from public.workflow_instances where id = p_instance_id;

  select coalesce(array_agg(distinct x.value::uuid), '{}') into v_current_assignees
  from (
    select case when jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'string'
      then i.step_assignees -> i.current_node_id::text #>> '{}' end as value
    union all
    select value
    from jsonb_array_elements_text(
      case when jsonb_typeof(i.step_assignees -> i.current_node_id::text) = 'array'
        then i.step_assignees -> i.current_node_id::text else '[]'::jsonb end
    )
  ) x
  where x.value ~* '^[0-9a-f-]{36}$';

  if p_event_type = 'workflow.mentioned' then
    v_recipients := coalesce(p_recipient_user_ids, '{}');
  elsif p_event_type in ('workflow.step_assigned', 'workflow.step_due_soon', 'workflow.step_overdue') then
    v_recipients := coalesce(p_recipient_user_ids, v_current_assignees);
  else
    select coalesce(array_agg(distinct participant_row.user_id), '{}') into v_recipients
    from public.workflow_instance_participants participant_row
    where participant_row.instance_id = i.id
      and participant_row.ended_at is null
      and (
        v_held
        or p_event_type not in (
          'workflow.submitted', 'workflow.step_approved',
          'workflow.revision_requested', 'workflow.reopened'
        )
        or not (participant_row.user_id = any(v_current_assignees))
      );

    if p_event_type in ('workflow.watchers_added', 'workflow.watchers_removed')
      and cardinality(coalesce(p_recipient_user_ids, '{}')) > 0 then
      select coalesce(array_agg(distinct recipient.user_id), '{}') into v_recipients
      from (
        select unnest(coalesce(v_recipients, '{}')) as user_id
        union all
        select unnest(coalesce(p_recipient_user_ids, '{}')) as user_id
      ) recipient;
    end if;
  end if;

  insert into app_private.workflow_notification_outbox(
    event_key, instance_id, event_type, actor_user_id, recipient_user_ids, payload
  ) values (
    p_event_key, p_instance_id, p_event_type, p_actor_id,
    coalesce(v_recipients, '{}'), coalesce(p_payload, '{}') || jsonb_build_object('eventKey', p_event_key)
  ) on conflict(event_key) do nothing;
  return case when found then 1 else 0 end;
end;
$function$;

-- 5. Wording for a held approval ("Đã duyệt 1/3").
do $migration$
declare
  v_def text;
  v_anchor text := E'  v_message := case when o.event_type';
  v_patch text := E'  if o.event_type = ''workflow.step_approved'' and coalesce((o.payload ->> ''held'')::boolean, false) then\n    v_action := format(''Đã %s %s/%s'',\n      case when v_action = ''Đã hoàn thành bước'' then ''hoàn thành'' else ''duyệt'' end,\n      coalesce(o.payload ->> ''approvedCount'', ''?''), coalesce(o.payload ->> ''requiredCount'', ''?''));\n    v_phrase := format(''đã %s (%s/%s người) giai đoạn hiện tại của'',\n      case when v_phrase = ''đã hoàn thành một bước của'' then ''hoàn thành'' else ''duyệt'' end,\n      coalesce(o.payload ->> ''approvedCount'', ''?''), coalesce(o.payload ->> ''requiredCount'', ''?''));\n  end if;\n';
begin
  v_def := pg_get_functiondef('app_private.workflow_notification_content(uuid)'::regprocedure);
  if strpos(v_def, E'(o.payload ->> ''held'')') > 0 then
    raise notice 'workflow_notification_content already handles held approvals';
  elsif strpos(v_def, v_anchor) = 0 then
    raise exception 'workflow_notification_content anchor not found';
  else
    execute replace(v_def, v_anchor, v_patch || v_anchor);
  end if;
end
$migration$;

-- 6. SLA reminders for Quy trình stages -------------------------------------
create or replace function app_private.enqueue_workflow_notification_reminders(p_limit integer)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare c record; v_kind text; v_key text; v_count integer:=0; v_limit integer := least(100, greatest(1, coalesce(p_limit, 50)));
begin
  perform app_private.workflow_require_notification_worker();
  if not(select enabled from app_private.workflow_notification_settings where singleton) then return 0; end if;

  -- Stages tracked with explicit assignment rows (legacy path).
  for c in
    select a.id assignment_id,a.workflow_instance_id instance_id,a.node_id,a.assignee_user_id,a.due_at
    from public.workflow_step_assignments a join public.workflow_instances i on i.id=a.workflow_instance_id
    where a.status='PENDING' and a.due_at is not null and a.due_at<=now()+interval '60 minutes'
      and i.status='RUNNING'
      and not exists(select 1 from public.request_instances r where r.workflow_instance_id=i.id)
      and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id and s.subject_type='request')
    order by a.due_at,a.id limit v_limit
  loop
    v_kind:=case when c.due_at<=now() then 'workflow.step_overdue' else 'workflow.step_due_soon' end;
    v_key:='workflow-reminder:'||c.assignment_id||':'||v_kind||':'||extract(epoch from c.due_at)::bigint
      ||case when v_kind='workflow.step_overdue' then ':'||(now() at time zone 'Asia/Ho_Chi_Minh')::date else '' end;
    insert into app_private.workflow_notification_reminder_keys values(v_key,now()) on conflict do nothing;
    if not found then continue; end if;
    perform app_private.enqueue_workflow_notification_event(c.instance_id,v_kind,null,v_key,
      jsonb_build_object('dueAt',c.due_at,'nodeId',c.node_id),array[c.assignee_user_id]);
    v_count:=v_count+1;
  end loop;

  -- Quy trình tickets: due = time the ticket entered its current stage + slaHours.
  for c in
    select i.id instance_id, i.current_node_id node_id,
      coalesce(entered.at, i.created_at) + (n.config ->> 'slaHours')::numeric * interval '1 hour' as due_at
    from public.workflow_instances i
    join public.workflow_nodes n on n.id = i.current_node_id
    cross join lateral (
      select max(l.created_at) as at
      from public.workflow_instance_logs l
      where l.instance_id = i.id
        and (l.node_id is distinct from i.current_node_id or l.action in ('SUBMITTED', 'REOPENED'))
    ) entered
    where i.status = 'RUNNING'
      and coalesce(n.config ->> 'slaHours', '') ~ '^[0-9]+(\.[0-9]+)?$'
      and (n.config ->> 'slaHours')::numeric > 0
      and coalesce(entered.at, i.created_at) + (n.config ->> 'slaHours')::numeric * interval '1 hour'
        <= now() + interval '60 minutes'
      and not exists(select 1 from public.request_instances r where r.workflow_instance_id=i.id)
      and not exists(select 1 from public.workflow_subjects s where s.workflow_instance_id=i.id)
    order by 3, i.id limit v_limit
  loop
    v_kind:=case when c.due_at<=now() then 'workflow.step_overdue' else 'workflow.step_due_soon' end;
    v_key:='workflow-reminder:stage:'||c.instance_id||':'||c.node_id||':'||v_kind||':'||extract(epoch from c.due_at)::bigint
      ||case when v_kind='workflow.step_overdue' then ':'||(now() at time zone 'Asia/Ho_Chi_Minh')::date else '' end;
    insert into app_private.workflow_notification_reminder_keys values(v_key,now()) on conflict do nothing;
    if not found then continue; end if;
    perform app_private.enqueue_workflow_notification_event(c.instance_id,v_kind,null,v_key,
      jsonb_build_object('dueAt',c.due_at,'nodeId',c.node_id), null);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $function$;

-- The worker's claim (every minute) now also enqueues due reminders first.
create or replace function app_private.claim_workflow_notification_outbox(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare r record; v_items jsonb:='[]'; v_limit integer:=least(greatest(coalesce(p_limit,50),1),50); v_rollout timestamptz;
begin
  perform app_private.workflow_require_notification_worker();
  select rollout_started_at into v_rollout from app_private.workflow_notification_settings where singleton;
  if v_rollout is not null then
    update app_private.workflow_notification_outbox set status='SUPPRESSED',last_error='pre_rollout_backlog',updated_at=now()
      where status='PENDING' and created_at<v_rollout;
  end if;
  if not (select enabled from app_private.workflow_notification_settings where singleton) then
    return jsonb_build_object('enabled',false,'items','[]'::jsonb);
  end if;
  begin
    perform app_private.enqueue_workflow_notification_reminders(50);
  exception when others then
    -- A reminder problem must never block delivery of normal events.
    raise warning 'workflow reminders skipped: %', sqlerrm;
  end;
  update app_private.workflow_notification_outbox set status='PENDING',locked_at=null,updated_at=now()
    where status='PROCESSING' and locked_at<now()-interval '2 minutes' and attempt_count<10;
  update app_private.workflow_notification_outbox set status='FAILED',last_error='retry_exhausted',locked_at=null,updated_at=now()
    where status in ('PENDING','PROCESSING') and attempt_count>=10;
  for r in
    select id from app_private.workflow_notification_outbox
    where status='PENDING' and attempt_count<10 and available_at<=now()
    order by available_at,created_at,id limit v_limit for update skip locked
  loop
    update app_private.workflow_notification_outbox set status='PROCESSING',attempt_count=attempt_count+1,
      locked_at=now(),last_error=null,updated_at=now() where id=r.id;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('id',r.id));
  end loop;
  return jsonb_build_object('enabled',true,'items',v_items);
end $function$;
