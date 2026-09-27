-- Run after notification_p2_1_enable_workflow_notifications. Simulates one
-- worker cycle as service_role and rolls back.
begin;
create temporary table p21_before on commit drop as select now() - interval '1 second' t;
create temporary table p21_claimed (item jsonb) on commit drop;
create temporary table p21_delivered (id uuid, result jsonb) on commit drop;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);

do $$ begin
  if not (select enabled from app_private.workflow_notification_settings where singleton) then raise exception 'gate still off'; end if;
  if exists (select 1 from app_private.workflow_notification_outbox o join public.workflow_subjects s on s.workflow_instance_id = o.instance_id
             where o.status = 'PENDING' and s.subject_type in ('request', 'project', 'material_request')) then
    raise exception 'subject-owned events still pending';
  end if;
end $$;

insert into p21_claimed select jsonb_array_elements(app_private.claim_workflow_notification_outbox(50) -> 'items');
insert into p21_delivered select (item ->> 'id')::uuid, app_private.deliver_workflow_notification((item ->> 'id')::uuid) from p21_claimed;

do $$
declare v_bad int;
begin
  -- Every delivered generic step reaches its assignee with a canonical link.
  select count(*) into v_bad from p21_delivered where (result ->> 'delivered')::int < 1;
  if v_bad > 0 then raise exception '% claimed events reached nobody', v_bad; end if;
  if exists (select 1 from public.notifications n where n.created_at >= (select t from p21_before) and n.module = 'WF' and coalesce(n.link, '') not like '/wf/%') then
    raise exception 'workflow notification without canonical link';
  end if;
end $$;
rollback;
