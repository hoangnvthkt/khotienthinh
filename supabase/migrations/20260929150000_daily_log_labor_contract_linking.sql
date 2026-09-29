-- Daily Log batch 2C-2 (owner-approved 29/09/2026): QS links labor lines to a
-- labor subcontract line, so man-days can be paid from CHT-approved logs.
--
--  * Candidates: engineers' source lines flagged pending_contract, plus older
--    (semantics v1) log lines that name a crew. Summary copies are skipped;
--    they follow their source line. Lines that only say "Tổ đội" cannot be
--    attributed and are left out.
--  * Names are grouped after lower-casing, removing accents and leading words
--    such as "tổ", "đội", "nhân công", so "tổ Phan Hữu Trịnh", "Phan Hữu Trịnh"
--    and a mistyped "tổ Đổ Duy Ích" land together.
--  * Linking and unlinking require Room quantity_acceptance "edit" (or admin),
--    check the contract line is a signed/active labor subcontract line of the
--    project, and write one audit row per action with the before state.

create table if not exists public.daily_log_labor_contract_link_events (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  action text not null check (action in ('link', 'unlink')),
  labor_line_ids uuid[] not null,
  contract_item_id uuid,
  subcontract_id text,
  reason text,
  before_state jsonb not null default '[]'::jsonb,
  actor_user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.daily_log_labor_contract_link_events enable row level security;
revoke all on public.daily_log_labor_contract_link_events from anon, authenticated;
create index if not exists daily_log_labor_contract_link_events_project_idx
  on public.daily_log_labor_contract_link_events(project_id, created_at desc);

create or replace function app_private.daily_log_crew_name_key(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(lower(public.unaccent(btrim(coalesce(p_name, '')))),
      '^((to doi|to|doi|nhan cong|cong nhat|mr|anh)\s+)+', ''),
    '\s+', ' ', 'g'));
$$;

-- Lines QS may link: the project's source lines and legacy log lines, never summary copies.
create or replace function app_private.daily_log_linkable_labor(p_project_id text, p_construction_site_id text)
returns table (id uuid, log_date date, crew_name text, name_key text, people numeric, labor_hours numeric,
  legacy boolean, contract_item_id uuid, contract_link_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select labor.id,
    coalesce(contribution.date, left(log.date, 10)::date),
    btrim(coalesce(nullif(labor.manual_provider_name, ''), nullif(labor.partner_name, ''), labor.labor_type)),
    app_private.daily_log_crew_name_key(coalesce(nullif(labor.manual_provider_name, ''), nullif(labor.partner_name, ''), labor.labor_type)),
    coalesce(labor.people_count, labor.count, 0),
    coalesce(labor.total_labor_hours, coalesce(labor.count, 0) * coalesce(labor.hours, 8)),
    coalesce(labor.resource_semantics_version, 1) <> 2,
    labor.contract_item_id,
    labor.contract_link_status
  from public.daily_log_labor labor
  left join public.daily_log_contributions contribution on contribution.id = labor.contribution_id
  left join public.daily_logs log on log.id = labor.daily_log_id
  where labor.project_id = p_project_id
    and (nullif(p_construction_site_id, '') is null or labor.construction_site_id is null
      or labor.construction_site_id = p_construction_site_id)
    and (
      (labor.contribution_id is not null and labor.resource_semantics_version = 2)
      or (coalesce(labor.resource_semantics_version, 1) <> 2 and labor.daily_log_id is not null)
    );
$$;

create or replace function app_private.assert_daily_log_contract_linker(p_project_id text, p_construction_site_id text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not (public.is_admin() or app_private.current_actor_has_effective_room_action(
    p_project_id, nullif(p_construction_site_id, ''), 'quantity_acceptance', 'edit')) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_CONTRACT_LINK_DENIED';
  end if;
  return v_actor;
end;
$$;

create or replace function public.list_daily_log_crew_labor_links_v1(p_project_id text, p_construction_site_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_daily_log_contract_linker(p_project_id, p_construction_site_id);
  return jsonb_build_object(
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object('key', g.name_key, 'names', g.names, 'lineIds', g.ids, 'lines', g.lines,
        'people', g.people, 'laborHours', g.hours, 'firstDate', g.first_date, 'lastDate', g.last_date, 'legacyLines', g.legacy)
        order by g.lines desc, g.name_key)
      from (
        select name_key, array_agg(distinct crew_name) names, array_agg(id) ids, count(*)::int lines,
          sum(people) people, sum(labor_hours) hours, min(log_date) first_date, max(log_date) last_date,
          count(*) filter (where legacy)::int legacy
        from app_private.daily_log_linkable_labor(p_project_id, p_construction_site_id)
        where contract_item_id is null
          and (legacy or contract_link_status = 'pending_contract')
          and name_key not in ('', 'doi', 'to', 'to doi', 'nhan cong', 'cong nhan')
        group by name_key
      ) g), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object('contractItemId', l.contract_item_id, 'contractCode', sc.code,
        'crewName', coalesce(partner.name, sc.subcontractor_name), 'lineCode', item.code, 'lineName', item.name, 'unit', item.unit,
        'names', l.names, 'lineIds', l.ids, 'lines', l.lines, 'people', l.people, 'laborHours', l.hours)
        order by sc.code, item.code)
      from (
        select contract_item_id, array_agg(distinct crew_name) names, array_agg(id) ids, count(*)::int lines,
          sum(people) people, sum(labor_hours) hours
        from app_private.daily_log_linkable_labor(p_project_id, p_construction_site_id)
        where contract_item_id is not null
        group by contract_item_id
      ) l
      join public.contract_items item on item.id = l.contract_item_id
      join public.subcontractor_contracts sc on sc.id = item.contract_id::text
      left join public.business_partners partner on partner.id = sc.partner_id), '[]'::jsonb),
    'contractLines', coalesce((
      select jsonb_agg(jsonb_build_object('id', item.id, 'code', item.code, 'name', item.name, 'unit', item.unit,
        'laborDayBasis', item.labor_day_basis, 'contractId', sc.id, 'contractCode', sc.code,
        'crewName', coalesce(partner.name, sc.subcontractor_name)) order by sc.code, item."order", item.code)
      from public.subcontractor_contracts sc
      join public.contract_items item on item.contract_type = 'subcontractor' and item.contract_id::text = sc.id
      left join public.business_partners partner on partner.id = sc.partner_id
      where sc.project_id = p_project_id and sc.status in ('signed', 'active')), '[]'::jsonb)
  );
end;
$$;

create or replace function public.link_daily_log_labor_to_contract_v1(
  p_project_id text, p_construction_site_id text, p_line_ids uuid[], p_contract_item_id uuid, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_daily_log_contract_linker(p_project_id, p_construction_site_id);
  v_subcontract text;
  v_before jsonb;
  v_count integer;
begin
  select sc.id into v_subcontract
  from public.contract_items item
  join public.subcontractor_contracts sc on sc.id = item.contract_id::text
  where item.id = p_contract_item_id and item.contract_type = 'subcontractor'
    and sc.project_id = p_project_id and sc.status in ('signed', 'active');
  if v_subcontract is null then raise exception using errcode = '22023', message = 'DAILY_LOG_LABOR_CONTRACT_INVALID'; end if;
  if coalesce(cardinality(p_line_ids), 0) = 0 or exists (
    select 1 from unnest(p_line_ids) requested(id)
    where not exists (select 1 from app_private.daily_log_linkable_labor(p_project_id, p_construction_site_id) line where line.id = requested.id)
  ) then raise exception using errcode = '22023', message = 'DAILY_LOG_LABOR_LINES_OUT_OF_SCOPE'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'contractItemId', contract_item_id, 'status', contract_link_status)), '[]'::jsonb)
  into v_before from public.daily_log_labor where id = any(p_line_ids);
  -- Source lines are validated by the stamp trigger (crew must match); legacy lines are set here.
  update public.daily_log_labor
  set contract_item_id = p_contract_item_id,
      subcontract_id = v_subcontract,
      contract_link_status = 'linked'
  where id = any(p_line_ids);
  get diagnostics v_count = row_count;
  insert into public.daily_log_labor_contract_link_events(project_id, action, labor_line_ids, contract_item_id, subcontract_id, reason, before_state, actor_user_id)
  values (p_project_id, 'link', p_line_ids, p_contract_item_id, v_subcontract, nullif(btrim(p_reason), ''), v_before, v_actor);
  return jsonb_build_object('linked', v_count, 'subcontractId', v_subcontract);
end;
$$;

create or replace function public.unlink_daily_log_labor_contract_v1(
  p_project_id text, p_construction_site_id text, p_line_ids uuid[], p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.assert_daily_log_contract_linker(p_project_id, p_construction_site_id);
  v_before jsonb;
  v_count integer;
begin
  if nullif(btrim(p_reason), '') is null then raise exception using errcode = '22023', message = 'DAILY_LOG_CONTRACT_UNLINK_REASON_REQUIRED'; end if;
  if coalesce(cardinality(p_line_ids), 0) = 0 or exists (
    select 1 from unnest(p_line_ids) requested(id)
    where not exists (select 1 from app_private.daily_log_linkable_labor(p_project_id, p_construction_site_id) line where line.id = requested.id)
  ) then raise exception using errcode = '22023', message = 'DAILY_LOG_LABOR_LINES_OUT_OF_SCOPE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'contractItemId', contract_item_id, 'status', contract_link_status)), '[]'::jsonb)
  into v_before from public.daily_log_labor where id = any(p_line_ids);
  update public.daily_log_labor
  set contract_item_id = null, subcontract_id = null,
      contract_link_status = 'pending_contract'
  where id = any(p_line_ids);
  get diagnostics v_count = row_count;
  insert into public.daily_log_labor_contract_link_events(project_id, action, labor_line_ids, reason, before_state, actor_user_id)
  values (p_project_id, 'unlink', p_line_ids, btrim(p_reason), v_before, v_actor);
  return jsonb_build_object('unlinked', v_count);
end;
$$;

revoke all on function app_private.daily_log_crew_name_key(text) from public, anon, authenticated;
revoke all on function app_private.daily_log_linkable_labor(text, text) from public, anon, authenticated;
revoke all on function app_private.assert_daily_log_contract_linker(text, text) from public, anon, authenticated;
revoke all on function public.list_daily_log_crew_labor_links_v1(text, text) from public, anon;
revoke all on function public.link_daily_log_labor_to_contract_v1(text, text, uuid[], uuid, text) from public, anon;
revoke all on function public.unlink_daily_log_labor_contract_v1(text, text, uuid[], text) from public, anon;
grant execute on function public.list_daily_log_crew_labor_links_v1(text, text) to authenticated;
grant execute on function public.link_daily_log_labor_to_contract_v1(text, text, uuid[], uuid, text) to authenticated;
grant execute on function public.unlink_daily_log_labor_contract_v1(text, text, uuid[], text) to authenticated;
