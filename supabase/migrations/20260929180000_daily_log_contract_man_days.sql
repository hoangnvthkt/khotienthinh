-- Daily Log batch 2C-3 (owner-approved 29/09/2026): acceptance by man-days.
--
-- For a labor subcontract and period, count công per contract line from
-- labor lines linked to that line, only in CHT-approved (verified) logs:
--   * source-slip workflow: the approved summary's copy of the linked source
--     line (what the CHT approved), in a verified log that no revision replaced;
--   * older logs: linked lines of verified logs, ignoring an individual log on
--     a day that already has a verified summary, so a day is never counted twice.
-- Conversion follows the contract line: hours_8 (default) = hours / 8,
-- person_day = people. Acceptance items keep the labor line ids they came from.

alter table public.quantity_acceptance_items
  add column if not exists source_daily_log_labor_ids uuid[] not null default '{}'::uuid[];

create or replace function public.get_daily_log_contract_man_days_v1(
  p_contract_id text, p_construction_site_id text, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_project text;
begin
  select sc.project_id into v_project from public.subcontractor_contracts sc where sc.id = p_contract_id;
  if v_project is null then raise exception using errcode = 'P0002', message = 'SUBCONTRACT_NOT_FOUND'; end if;
  if public.current_app_user_id() is null or not (public.is_admin() or app_private.current_actor_has_effective_room_action(
    v_project, nullif(p_construction_site_id, ''), 'quantity_acceptance', 'view')) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_CONTRACT_LINK_DENIED';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception using errcode = '22023', message = 'ACCEPTANCE_PERIOD_REQUIRED';
  end if;

  return coalesce((
    with items as (
      select item.id, coalesce(item.labor_day_basis, 'hours_8') basis
      from public.contract_items item
      where item.contract_type = 'subcontractor' and item.contract_id::text = p_contract_id
    ),
    counted as (
      -- Source-slip workflow: the approved summary copy of each linked source line.
      select source.contract_item_id, copy.id line_id, left(log.date, 10)::date as log_day,
        coalesce(copy.people_count, copy.count, 0) people, coalesce(copy.total_labor_hours, 0) hours
      from public.daily_log_labor source
      join public.daily_log_labor copy on copy.source_labor_line_id = source.id
      join public.daily_logs log on log.id = copy.daily_log_id
      where source.contract_item_id in (select id from items)
        and source.contribution_id is not null
        and log.status = 'verified' and log.superseded_by_daily_log_id is null
        and log.project_id = v_project
        and left(log.date, 10)::date between p_from and p_to
      union all
      -- Older logs: linked lines of verified logs; an individual log yields to a verified summary that day.
      select labor.contract_item_id, labor.id, left(log.date, 10)::date,
        coalesce(labor.people_count, labor.count, 0), coalesce(labor.total_labor_hours, coalesce(labor.count, 0) * coalesce(labor.hours, 8))
      from public.daily_log_labor labor
      join public.daily_logs log on log.id = labor.daily_log_id
      where labor.contract_item_id in (select id from items)
        and coalesce(labor.resource_semantics_version, 1) <> 2
        and log.status = 'verified' and log.project_id = v_project
        and left(log.date, 10)::date between p_from and p_to
        and (log.summary_source_type = 'member_contributions' or not exists (
          select 1 from public.daily_logs summary
          where summary.project_id = log.project_id and left(summary.date, 10) = left(log.date, 10)
            and summary.summary_source_type = 'member_contributions' and summary.status = 'verified'
            and summary.superseded_by_daily_log_id is null))
    )
    select jsonb_agg(jsonb_build_object('contractItemId', t.contract_item_id, 'basis', t.basis,
      'manDays', round(t.man_days, 2), 'people', t.people, 'laborHours', t.hours, 'days', t.days, 'lineIds', t.line_ids)
      order by t.contract_item_id)
    from (
      select c.contract_item_id, i.basis,
        sum(case when i.basis = 'person_day' then c.people else c.hours / 8 end) man_days,
        sum(c.people) people, sum(c.hours) hours, count(distinct c.log_day)::int days, array_agg(c.line_id) line_ids
      from counted c join items i on i.id = c.contract_item_id
      group by c.contract_item_id, i.basis
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_daily_log_contract_man_days_v1(text, text, date, date) from public, anon;
grant execute on function public.get_daily_log_contract_man_days_v1(text, text, date, date) to authenticated;
