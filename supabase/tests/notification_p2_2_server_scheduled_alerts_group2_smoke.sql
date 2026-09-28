-- Run after notification_p2_2_server_scheduled_alerts_group2. Uses synthetic
-- rows and rolls back.
begin;
create temporary table p22b_ctx on commit drop as
select m.project_id, m.construction_site_id::text site_id
from public.project_permission_room_members m
join public.project_permission_room_member_actions a on a.room_member_id = m.id and a.is_active and a.action_code in ('confirm', 'approve')
where m.is_active and m.room_code = 'payment' and m.construction_site_id is not null
limit 1;
create temporary table p22b_before on commit drop as select now() - interval '1 second' t;

update public.notification_alert_rules set cooldown_minutes = 1440, is_enabled = true,
  recipient_config = case when alert_key = 'slow_progress'
    then '{"mode":"project_permission","projectPermissionCodes":["edit"],"includeAdmins":true,"fallbackToAdmin":true}'::jsonb
    else recipient_config end
where alert_key in ('budget_overrun', 'slow_progress', 'material_waste', 'overdue_request', 'safety_critical');

-- Finance row over budget and behind schedule; waste item over threshold.
insert into public.project_finances (id, project_id, construction_site_id, "constructionSiteId", "contractValue", "actualMaterials", "progressPercent", status)
select 'p22b-smoke-fin', project_id, site_id, site_id, 100, 120, 5, 'active' from p22b_ctx;
insert into public.material_budget_items (id, project_id, construction_site_id, category, unit, item_name, waste_percent, waste_threshold)
select 'p22b-smoke-mbi', project_id, site_id, 'smoke', 'kg', 'P2.2b smoke', 12, 5 from p22b_ctx;
-- One pending request past its due date.
update public.request_instances set due_date = '2000-01-01'
where id = (select id from public.request_instances where upper(status) = 'PENDING' limit 1);

create temporary table p22b_run on commit drop as select app_private.run_scheduled_alerts() r;
create temporary table p22b_run2 on commit drop as select app_private.run_scheduled_alerts() r;

do $$
declare
  v_run jsonb := (select r from p22b_run);
  v_run2 jsonb := (select r from p22b_run2);
  v_key text;
  v_expected uuid[];
  v_got uuid[];
  v_rule public.notification_alert_rules;
begin
  foreach v_key in array array['budget_overrun', 'slow_progress', 'material_waste', 'overdue_request', 'safety_critical'] loop
    if coalesce((v_run ->> v_key)::int, 0) < 1 then raise exception '% not alerted: %', v_key, v_run; end if;
    if (v_run2 ->> v_key)::int <> 0 then raise exception '% ignored the cooldown: %', v_key, v_run2; end if;
  end loop;

  -- Budget → finance viewers of the project + Admins.
  select array(select distinct unnest(app_private.alert_finance_recipient_ids(project_id, array['confirm','approve']) || app_private.alert_admin_ids()) order by 1)
    into v_expected from p22b_ctx;
  select array(select distinct user_id::uuid from public.notifications
               where created_at >= (select t from p22b_before) and metadata ->> 'alertKey' = 'budget_overrun' order by 1) into v_got;
  if v_got is distinct from v_expected then raise exception 'budget recipients differ: got % expected %', cardinality(v_got), cardinality(v_expected); end if;
  if cardinality(v_expected) <= cardinality(app_private.alert_admin_ids()) then
    raise exception 'budget reached Admins only; finance viewers missing';
  end if;

  -- Waste → Room material_planning editors + Admins (rule updated to edit).
  select array(select distinct unnest(app_private.alert_room_recipient_ids(project_id, site_id, 'material_planning', array['edit']) || app_private.alert_admin_ids()) order by 1)
    into v_expected from p22b_ctx;
  select array(select distinct user_id::uuid from public.notifications
               where created_at >= (select t from p22b_before) and metadata ->> 'alertKey' = 'material_waste' and source_id = 'waste_p22b-smoke-mbi' order by 1) into v_got;
  if v_got is distinct from v_expected then raise exception 'waste recipients differ: got % expected %', cardinality(v_got), cardinality(v_expected); end if;

  -- Safety → Room safety approvers of each issue's project + Admins.
  if exists (
    select 1 from public.safety_issues i
    where i.status not in ('resolved', 'closed', 'rejected') and (i.severity = 'critical' or i.status = 'overdue')
      and array(select distinct unnest(app_private.alert_room_recipient_ids(i.project_id, i.construction_site_id, 'safety', array['confirm','approve']) || app_private.alert_admin_ids()) order by 1)
        is distinct from array(select distinct n.user_id::uuid from public.notifications n
                               where n.created_at >= (select t from p22b_before) and n.source_id = 'safety_critical_issue_' || i.id order by 1)
  ) then
    raise exception 'safety issue recipients differ';
  end if;

  -- Recipient modes offered in Settings.
  select * into v_rule from public.notification_alert_rules where alert_key = 'overdue_request';
  v_rule.recipient_config := '{"mode":"roles","roles":["ADMIN"],"fallbackToAdmin":false}'::jsonb;
  if array(select unnest(app_private.alert_resolve_recipients(v_rule)) order by 1)
     is distinct from array(select unnest(app_private.alert_admin_ids()) order by 1) then
    raise exception 'roles mode differs from Admins';
  end if;
  v_rule.recipient_config := '{"mode":"users","userIds":["00000000-0000-0000-0000-000000000000"],"fallbackToAdmin":false}'::jsonb;
  if cardinality(app_private.alert_resolve_recipients(v_rule)) <> 0 then raise exception 'users mode kept an unknown account'; end if;
end $$;
rollback;
