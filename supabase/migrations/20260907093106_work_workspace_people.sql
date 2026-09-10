-- Vioo Work Workspace people projections and source reconciliation (WS3).
--
-- This candidate is intentionally kept outside supabase/migrations until the
-- main agent reviews and applies WS2.  The browser receives only bounded,
-- guarded projections; HRM and project source tables remain read-only here.

-- A source reference is a stable identity for the linked source, rather than
-- a user supplied provenance token.  The WS2 mutation functions validate it
-- against the current Workspace before writing a source-origin membership.
create or replace function app_private.work_workspace_source_reference(
  p_workspace_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case w.kind
    when 'department' then w.department_id::text
    when 'project' then w.project_id
    else null
  end
  from public.work_workspaces w
  where w.id = p_workspace_id
$$;
revoke all on function app_private.work_workspace_source_reference(uuid)
  from public, anon, authenticated;

-- Minimal current-source rows.  The organization branch deliberately resolves
-- through effective slot assignments and position slots; employees.department_id
-- is a legacy display field and is never used to establish source membership.
create or replace function app_private.work_workspace_people_candidates(
  p_workspace_id uuid,
  p_source text
)
returns table (
  person_key text,
  user_id uuid,
  employee_id uuid,
  person_name text,
  avatar_url text,
  position_name text,
  source_label text,
  eligibility text,
  source_reference text,
  source_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
with workspace_row as (
  select w.id, w.kind, w.department_id, w.project_id
  from public.work_workspaces w
  where w.id = p_workspace_id
), source_rows as (
  select
    case when u.id is null then 'e:' || e.id::text else 'u:' || u.id::text end as person_key,
    u.id as user_id,
    e.id as employee_id,
    coalesce(nullif(btrim(e.full_name), ''), nullif(btrim(u.name), ''), 'Unknown') as person_name,
    coalesce(nullif(btrim(e.avatar_url), ''), nullif(btrim(u.avatar), '')) as avatar_url,
    pos.name as position_name,
    unit.name as source_label,
    case
      when u.id is null then 'NO_APP_ACCOUNT'
      when e.status is distinct from 'Đang làm việc' then 'EMPLOYEE_INACTIVE'
      when not u.is_active or u.account_status is distinct from 'ACTIVE' then 'ACCOUNT_INACTIVE'
      else 'ELIGIBLE'
    end as eligibility,
    w.department_id::text as source_reference,
    greatest(
      coalesce(a.updated_at, a.created_at, 'epoch'::timestamptz),
      coalesce(slot.updated_at, slot.created_at, 'epoch'::timestamptz),
      coalesce(e.updated_at, e.created_at, 'epoch'::timestamptz),
      coalesce(unit.created_at, 'epoch'::timestamptz)
    ) as source_at
  from workspace_row w
  join public.hrm_org_position_slots slot
    on slot.org_unit_id = w.department_id
   and slot.status = 'ACTIVE'
   and slot.effective_from <= current_date
   and (slot.effective_to is null or slot.effective_to >= current_date)
  join public.hrm_employee_slot_assignments a
    on a.slot_id = slot.id
   and a.status = 'ACTIVE'
   and a.effective_from <= current_date
   and (a.effective_to is null or a.effective_to >= current_date)
  join public.employees e on e.id = a.employee_id
  left join public.users u on u.id = e.user_id
  left join public.hrm_positions pos on pos.id = slot.position_id
  join public.org_units unit on unit.id = slot.org_unit_id and unit.is_active
  where p_source = 'organization'
    and w.kind = 'department'
    and w.department_id is not null

  union all

  select
    case when u.id is null then 's:' || ps.id::text else 'u:' || u.id::text end as person_key,
    u.id as user_id,
    e.id as employee_id,
    coalesce(nullif(btrim(e.full_name), ''), nullif(btrim(u.name), ''), 'Unknown') as person_name,
    coalesce(nullif(btrim(e.avatar_url), ''), nullif(btrim(u.avatar), '')) as avatar_url,
    pos.name as position_name,
    project.name as source_label,
    case
      when u.id is null then 'NO_APP_ACCOUNT'
      when e.id is not null and e.status is distinct from 'Đang làm việc' then 'EMPLOYEE_INACTIVE'
      when not u.is_active or u.account_status is distinct from 'ACTIVE' then 'ACCOUNT_INACTIVE'
      else 'ELIGIBLE'
    end as eligibility,
    w.project_id as source_reference,
    greatest(
      coalesce(ps.updated_at, ps.created_at, 'epoch'::timestamptz),
      coalesce(project.updated_at, project.created_at, 'epoch'::timestamptz),
      coalesce(e.updated_at, e.created_at, 'epoch'::timestamptz),
      coalesce(u.updated_at, u.created_at, 'epoch'::timestamptz)
    ) as source_at
  from workspace_row w
  join public.projects project on project.id = w.project_id
  join public.project_staff ps
    on ps.project_id = w.project_id
   and ps.start_date <= current_date
   and (ps.end_date is null or ps.end_date >= current_date)
  left join public.users u
    on u.id::text = nullif(btrim(ps.user_id), '')
  left join public.employees e on e.user_id = u.id
  left join public.hrm_positions pos on pos.id = ps.position_id
  where p_source = 'project'
    and w.kind = 'project'
    and w.project_id is not null
    and project.status in ('planning', 'active', 'paused')

  union all

  select
    case when u.id is null then 'e:' || e.id::text else 'u:' || u.id::text end as person_key,
    u.id as user_id,
    e.id as employee_id,
    coalesce(nullif(btrim(e.full_name), ''), 'Unknown') as person_name,
    coalesce(nullif(btrim(e.avatar_url), ''), nullif(btrim(u.avatar), '')) as avatar_url,
    current_slot.position_name,
    current_slot.source_label,
    case
      when u.id is null then 'NO_APP_ACCOUNT'
      when e.status is distinct from 'Đang làm việc' then 'EMPLOYEE_INACTIVE'
      when not u.is_active or u.account_status is distinct from 'ACTIVE' then 'ACCOUNT_INACTIVE'
      else 'ELIGIBLE'
    end as eligibility,
    null::text as source_reference,
    greatest(
      coalesce(e.updated_at, e.created_at, 'epoch'::timestamptz),
      coalesce(u.updated_at, u.created_at, 'epoch'::timestamptz),
      coalesce(current_slot.source_at, 'epoch'::timestamptz)
    ) as source_at
  from public.employees e
  left join public.users u on u.id = e.user_id
  left join lateral (
    select pos.name as position_name, unit.name as source_label,
      greatest(
        coalesce(a.updated_at, a.created_at, 'epoch'::timestamptz),
        coalesce(slot.updated_at, slot.created_at, 'epoch'::timestamptz),
        coalesce(unit.created_at, 'epoch'::timestamptz)
      ) as source_at,
      a.effective_from,
      case when a.assignment_type='ACTING' then 0 when a.assignment_type='PRIMARY' then 1 else 2 end as assignment_rank
    from public.hrm_employee_slot_assignments a
    join public.hrm_org_position_slots slot
      on slot.id=a.slot_id
     and slot.status='ACTIVE'
     and slot.effective_from<=current_date
     and (slot.effective_to is null or slot.effective_to>=current_date)
    left join public.hrm_positions pos on pos.id=slot.position_id
    left join public.org_units unit on unit.id=slot.org_unit_id and unit.is_active
    where a.employee_id=e.id
      and a.status='ACTIVE'
      and a.effective_from<=current_date
      and (a.effective_to is null or a.effective_to>=current_date)
    order by a.effective_from desc, assignment_rank, a.id
    limit 1
  ) current_slot on true
  where p_source = 'directory'

  union all

  select
    'u:' || u.id::text as person_key,
    u.id as user_id,
    null::uuid as employee_id,
    coalesce(nullif(btrim(u.name), ''), 'Unknown') as person_name,
    nullif(btrim(u.avatar), '') as avatar_url,
    null::text as position_name,
    null::text as source_label,
    case when not u.is_active or u.account_status is distinct from 'ACTIVE'
      then 'ACCOUNT_INACTIVE' else 'ELIGIBLE' end as eligibility,
    null::text as source_reference,
    greatest(coalesce(u.updated_at, u.created_at, 'epoch'::timestamptz)) as source_at
  from public.users u
  where p_source = 'directory'
    and not exists (
      select 1 from public.employees e where e.user_id = u.id
    )
), ranked as (
  select s.*,
    row_number() over (
      partition by s.person_key
      order by s.source_at desc, s.employee_id nulls last, s.person_key
    ) as rn
  from source_rows s
)
select r.person_key, r.user_id, r.employee_id, r.person_name, r.avatar_url,
  r.position_name, r.source_label, r.eligibility, r.source_reference, r.source_at
from ranked r
where r.rn = 1
$$;
revoke all on function app_private.work_workspace_people_candidates(uuid,text)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_validate_people_cursor(
  p_cursor jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sort text;
  v_id text;
begin
  if p_cursor is null then return; end if;
  if jsonb_typeof(p_cursor) is distinct from 'object'
     or p_cursor->>'sortAt' is null
     or p_cursor->>'id' is null
     or jsonb_typeof(p_cursor->'sortAt') is distinct from 'string'
     or jsonb_typeof(p_cursor->'id') is distinct from 'string'
     or (select count(*) from jsonb_object_keys(p_cursor)) <> 2 then
    raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
  end if;
  v_sort := p_cursor->>'sortAt';
  v_id := p_cursor->>'id';
  if v_sort !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}'
     or v_id !~* '^(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|((a:)?(u:|e:|s:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})|(m:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$' then
    raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
  end if;
  begin
    perform v_sort::timestamptz;
  exception when others then
    raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
  end;
end;
$$;
revoke all on function app_private.work_workspace_validate_people_cursor(jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_people(
  p_workspace_id uuid,
  p_source text,
  p_search text default '',
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_search text := btrim(coalesce(p_search,''));
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id text;
  v_rows jsonb;
  v_workspace public.work_workspaces%rowtype;
begin
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  select * into v_workspace from public.work_workspaces where id=p_workspace_id;
  if v_workspace.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if v_workspace.status <> 'active' or v_workspace.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
  end if;
  if p_source is null or p_source not in ('organization','project','directory')
     or char_length(v_search)>100 then
    raise exception 'WORK_INVALID_FILTER' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    perform app_private.work_workspace_validate_people_cursor(p_cursor);
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
    v_cursor_id := p_cursor->>'id';
    if btrim(v_cursor_id) = '' then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end if;
  end if;

  with candidates as (
    select x.*,
      exists(
        select 1 from public.work_workspace_members m
        where m.workspace_id=p_workspace_id and m.user_id=x.user_id
          and m.status='active' and m.starts_at<=now()
          and (m.expires_at is null or m.expires_at>now())
      ) as already_member
    from app_private.work_workspace_people_candidates(p_workspace_id,p_source) x
    where (v_search='' or lower(x.person_name) like '%'||lower(v_search)||'%'
      or lower(coalesce(x.position_name,'')) like '%'||lower(v_search)||'%'
      or lower(coalesce(x.source_label,'')) like '%'||lower(v_search)||'%')
      and (v_cursor_at is null or (x.source_at,x.person_key)<(v_cursor_at,v_cursor_id))
  ), page_rows as (
    select c.* from candidates c
    order by c.source_at desc,c.person_key desc
    limit v_limit+1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId',p.user_id,
      'employeeId',p.employee_id,
      'name',p.person_name,
      'avatarUrl',p.avatar_url,
      'position',p.position_name,
      'sourceLabel',p.source_label,
      'sourceReference',p.source_reference,
      'eligibility',p.eligibility,
      'alreadyMember',p.already_member,
      '__sortAt',p.source_at,
      '__id',p.person_key
    ) order by p.source_at desc,p.person_key desc),'[]'::jsonb)
    into v_rows from page_rows p;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - array['__sortAt','__id'] order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality<=v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'__id')
      else null end
  );
end;
$$;
revoke all on function app_private.work_workspace_people(uuid,text,text,jsonb,integer)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_source_diff(
  p_workspace_id uuid,
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_limit integer := coalesce(p_limit,30);
  v_cursor_at timestamptz;
  v_cursor_id text;
  v_rows jsonb;
  v_fingerprint text;
  v_workspace public.work_workspaces%rowtype;
  v_source text;
  v_origin text;
  v_source_reference text;
begin
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  select * into v_workspace from public.work_workspaces where id=p_workspace_id;
  if v_workspace.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if v_workspace.status <> 'active' or v_workspace.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
  end if;
  if v_limit < 1 or v_limit > 50 then
    raise exception 'WORK_INVALID_LIMIT' using errcode = '22023';
  end if;
  if p_cursor is not null then
    perform app_private.work_workspace_validate_people_cursor(p_cursor);
    begin
      v_cursor_at := (p_cursor->>'sortAt')::timestamptz;
    exception when others then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end;
    v_cursor_id := p_cursor->>'id';
    if btrim(v_cursor_id) = '' then
      raise exception 'WORK_INVALID_CURSOR' using errcode = '22023';
    end if;
  end if;

  v_source := case when v_workspace.kind='department' then 'organization'
                   when v_workspace.kind='project' then 'project' end;
  v_origin := case when v_workspace.kind='department' then 'organization'
                   when v_workspace.kind='project' then 'project' end;
  v_source_reference := app_private.work_workspace_source_reference(p_workspace_id);
  v_fingerprint := app_private.work_workspace_source_fingerprint(p_workspace_id,null);

  -- The union keeps the diff bounded and allows a source departure to retain
  -- a safe directory card even though the person is no longer in the source.
  with current_source as (
    select p.*, true as current_source,
      exists(
        select 1 from public.work_workspace_members m
        where m.workspace_id=p_workspace_id and m.user_id=p.user_id
          and m.status='active' and m.starts_at<=now()
          and (m.expires_at is null or m.expires_at>now())
      ) as already_member
    from app_private.work_workspace_people_candidates(p_workspace_id,v_source) p
    where v_source is not null
      and p.user_id is not null
      and p.eligibility='ELIGIBLE'
      and not exists(
        select 1 from public.work_workspace_members m
        where m.workspace_id=p_workspace_id and m.user_id=p.user_id
          and m.status='active' and m.starts_at<=now()
          and (m.expires_at is null or m.expires_at>now())
      )
  ), source_members as (
    select
      m.user_id,
      m.updated_at as source_at,
      'm:' || m.id::text as person_key,
      m.origin,
      m.source_reference
    from public.work_workspace_members m
    where m.workspace_id=p_workspace_id
      and m.status='active'
      and m.starts_at<=now()
      and (m.expires_at is null or m.expires_at>now())
      and m.origin=v_origin
      and m.source_reference=v_source_reference
      and v_source is not null
      and not exists(
        select 1 from app_private.work_workspace_people_candidates(p_workspace_id,v_source) p
        where p.user_id=m.user_id
      )
  ), directory_cards as (
    select p.*,
      exists(
        select 1 from public.work_workspace_members m
        where m.workspace_id=p_workspace_id and m.user_id=p.user_id
          and m.status='active' and m.starts_at<=now()
          and (m.expires_at is null or m.expires_at>now())
      ) as already_member
    from app_private.work_workspace_people_candidates(p_workspace_id,'directory') p
    where p.user_id is not null
      and exists(select 1 from source_members m where m.user_id=p.user_id)
  ), departures as (
    select
      d.person_key,
      d.user_id,
      d.employee_id,
      d.person_name,
      d.avatar_url,
      d.position_name,
      d.source_label,
      d.eligibility,
      d.source_at,
      'left_source'::text as reason,
      jsonb_build_object(
        'operation','remove',
        'userId',d.user_id,
        'origin',v_origin,
        'sourceReference',v_source_reference
      ) as change
    from directory_cards d
    where d.already_member
  ), additions as (
    select
      'a:' || c.person_key as person_key,
      c.user_id,
      c.employee_id,
      c.person_name,
      c.avatar_url,
      c.position_name,
      c.source_label,
      c.eligibility,
      c.source_at,
      'joined_source'::text as reason,
      jsonb_build_object(
        'operation','add',
        'userId',c.user_id,
        'role','member',
        'origin',v_origin,
        'sourceReference',v_source_reference
      ) as change
    from current_source c
  ), diff_rows as (
    select a.* from additions a
    union all
    select d.* from departures d
  ), visible as (
    select * from diff_rows
    where v_cursor_at is null or (source_at,person_key)<(v_cursor_at, v_cursor_id)
  ), page_rows as (
    select * from visible
    order by source_at desc,person_key desc
    limit v_limit+1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'person',jsonb_build_object(
        'userId',p.user_id,
        'employeeId',p.employee_id,
        'name',p.person_name,
        'avatarUrl',p.avatar_url,
        'position',p.position_name,
        'sourceLabel',p.source_label,
        'sourceReference',case when p.reason='left_source' then null else v_source_reference end,
        'eligibility',p.eligibility,
        'alreadyMember',case when p.reason='left_source' then true else false end
      ),
      'change',p.change,
      'reason',p.reason,
      '__sortAt',p.source_at,
      '__id',p.person_key
    ) order by p.source_at desc,p.person_key desc),'[]'::jsonb)
    into v_rows from page_rows p;

  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(x.value - array['__sortAt','__id'] order by x.ordinality),'[]'::jsonb)
             from jsonb_array_elements(v_rows) with ordinality x(value,ordinality)
             where x.ordinality<=v_limit),
    'nextCursor',case when jsonb_array_length(v_rows)>v_limit then
      jsonb_build_object('sortAt',v_rows->(v_limit-1)->>'__sortAt','id',v_rows->(v_limit-1)->>'__id')
      else null end,
    'fingerprint',v_fingerprint
  );
end;
$$;
revoke all on function app_private.work_workspace_source_diff(uuid,jsonb,integer)
  from public, anon, authenticated;

-- Public entry points stay invoker functions so PostgREST never receives a
-- broad table privilege.  Each calls one private guarded implementation.
create or replace function public.list_work_workspace_people(
  p_workspace_id uuid,
  p_source text,
  p_search text default '',
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.work_workspace_people(p_workspace_id,p_source,p_search,p_cursor,p_limit)
$$;
revoke all on function public.list_work_workspace_people(uuid,text,text,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.list_work_workspace_people(uuid,text,text,jsonb,integer)
  to authenticated;

create or replace function public.preview_work_workspace_source_diff(
  p_workspace_id uuid,
  p_cursor jsonb default null,
  p_limit integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.work_workspace_source_diff(p_workspace_id,p_cursor,p_limit)
$$;
revoke all on function public.preview_work_workspace_source_diff(uuid,jsonb,integer)
  from public, anon, authenticated;
grant execute on function public.preview_work_workspace_source_diff(uuid,jsonb,integer)
  to authenticated;

-- Replace the compact candidate-based fingerprint with a raw effective-source
-- snapshot.  This retains every effective assignment/slot identity, including
-- a secondary assignment that is hidden by the one-card-per-user projection.
create or replace function app_private.work_workspace_source_fingerprint(
  p_workspace_id uuid,
  p_user_ids uuid[] default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_rows jsonb;
begin
  select w.kind into v_kind
  from public.work_workspaces w
  where w.id=p_workspace_id;
  if v_kind is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if v_kind='department' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'identity','o:'||a.id::text,
        'assignmentId',a.id,
        'slotId',slot.id,
        'employeeId',e.id,
        'userId',u.id,
        'assignmentType',a.assignment_type,
        'assignmentStatus',a.status,
        'assignmentFrom',a.effective_from,
        'assignmentTo',a.effective_to,
        'slotStatus',slot.status,
        'slotFrom',slot.effective_from,
        'slotTo',slot.effective_to,
        'positionId',slot.position_id,
        'position',pos.name,
        'sourceLabel',unit.name,
        'employeeStatus',e.status,
        'accountActive',u.is_active,
        'accountStatus',u.account_status,
        'eligibility',case
          when u.id is null then 'NO_APP_ACCOUNT'
          when e.status is distinct from 'Đang làm việc' then 'EMPLOYEE_INACTIVE'
          when not u.is_active or u.account_status is distinct from 'ACTIVE' then 'ACCOUNT_INACTIVE'
          else 'ELIGIBLE' end,
        'assignmentUpdatedAt',a.updated_at,
        'slotUpdatedAt',slot.updated_at
      ) order by a.id),'[]'::jsonb)
    into v_rows
    from public.work_workspaces w
    join public.hrm_org_position_slots slot
      on slot.org_unit_id=w.department_id
     and slot.status='ACTIVE'
     and slot.effective_from<=current_date
     and (slot.effective_to is null or slot.effective_to>=current_date)
    join public.hrm_employee_slot_assignments a
      on a.slot_id=slot.id
     and a.status='ACTIVE'
     and a.effective_from<=current_date
     and (a.effective_to is null or a.effective_to>=current_date)
    join public.employees e on e.id=a.employee_id
    left join public.users u on u.id=e.user_id
    left join public.hrm_positions pos on pos.id=slot.position_id
    join public.org_units unit on unit.id=slot.org_unit_id and unit.is_active
    where w.id=p_workspace_id
      and (p_user_ids is null or u.id=any(p_user_ids));
  elsif v_kind='project' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'identity','p:'||ps.id::text,
        'staffId',ps.id,
        'projectId',ps.project_id,
        'staffUserReference',ps.user_id,
        'employeeId',e.id,
        'userId',u.id,
        'startDate',ps.start_date,
        'endDate',ps.end_date,
        'positionId',ps.position_id,
        'position',pos.name,
        'projectStatus',project.status,
        'employeeStatus',e.status,
        'accountActive',u.is_active,
        'accountStatus',u.account_status,
        'eligibility',case
          when u.id is null then 'NO_APP_ACCOUNT'
          when e.id is not null and e.status is distinct from 'Đang làm việc' then 'EMPLOYEE_INACTIVE'
          when not u.is_active or u.account_status is distinct from 'ACTIVE' then 'ACCOUNT_INACTIVE'
          else 'ELIGIBLE' end,
        'staffUpdatedAt',ps.updated_at,
        'projectUpdatedAt',project.updated_at
      ) order by ps.id),'[]'::jsonb)
    into v_rows
    from public.work_workspaces w
    join public.projects project on project.id=w.project_id
    join public.project_staff ps
      on ps.project_id=w.project_id
     and ps.start_date<=current_date
     and (ps.end_date is null or ps.end_date>=current_date)
    left join public.users u on u.id::text=nullif(btrim(ps.user_id),'')
    left join public.employees e on e.user_id=u.id
    left join public.hrm_positions pos on pos.id=ps.position_id
    where w.id=p_workspace_id
      and project.status in ('planning','active','paused')
      and (p_user_ids is null or u.id=any(p_user_ids));
  else
    v_rows := '[]'::jsonb;
  end if;
  return md5(jsonb_build_object(
    'workspaceId',p_workspace_id,
    'sourceKind',v_kind,
    'effectiveRows',v_rows
  )::text);
end;
$$;
revoke all on function app_private.work_workspace_source_fingerprint(uuid,uuid[])
  from public, anon, authenticated;

-- WS2 extension: provenance is part of the canonical normalized change.  It
-- remains optional for manual membership changes and is validated against the
-- linked source by the guarded preview/apply functions below.
create or replace function app_private.work_workspace_normalize_changes(
  p_changes jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_operation text;
  v_user_id uuid;
  v_role text;
  v_expiry text;
  v_origin text;
  v_source_reference text;
  v_result jsonb;
begin
  if jsonb_typeof(p_changes) is distinct from 'array'
     or jsonb_array_length(p_changes)>100 then
    raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or v_item - array['operation','userId','role','expiresAt','origin','sourceReference'] <> '{}'::jsonb
       or jsonb_typeof(v_item->'operation') is distinct from 'string'
       or jsonb_typeof(v_item->'userId') is distinct from 'string'
       or (v_item ? 'role' and v_item->'role' is not null and jsonb_typeof(v_item->'role') is distinct from 'string')
       or (v_item ? 'expiresAt' and jsonb_typeof(v_item->'expiresAt') not in ('string','null'))
       or (v_item ? 'origin' and jsonb_typeof(v_item->'origin') not in ('string','null'))
       or (v_item ? 'sourceReference' and jsonb_typeof(v_item->'sourceReference') not in ('string','null')) then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_operation := v_item->>'operation';
    begin v_user_id := (v_item->>'userId')::uuid;
    exception when others then raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023'; end;
    if v_operation not in ('add','remove','set_role') then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_role := case when v_operation='add' then coalesce(nullif(v_item->>'role',''),'member') else v_item->>'role' end;
    if v_operation='set_role' and v_role is null then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    if v_role is not null and v_role not in ('admin','member') then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    if v_operation='remove' and v_item ? 'expiresAt' then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_expiry := case when v_item ? 'expiresAt' then v_item->>'expiresAt' end;
    if v_expiry is not null then
      begin perform v_expiry::timestamptz;
      exception when others then raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023'; end;
    end if;
    v_origin := v_item->>'origin';
    if v_origin is not null and v_origin not in ('manual','organization','project') then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
    v_source_reference := v_item->>'sourceReference';
    if v_source_reference is not null
       and char_length(btrim(v_source_reference)) not between 1 and 255 then
      raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023';
    end if;
  end loop;
  if exists (
    select 1 from (
      select lower((value->>'userId')::uuid::text) as user_id,
        count(*) over(partition by lower((value->>'userId')::uuid::text)) as n
      from jsonb_array_elements(p_changes) value
    ) x where x.n>1
  ) then
    raise exception 'WORK_DUPLICATE_USERS' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(
      jsonb_build_object('operation',x.operation,'userId',x.user_id)
      || case when x.role is null then '{}'::jsonb else jsonb_build_object('role',x.role) end
      || case when x.has_expires then jsonb_build_object('expiresAt',x.expires_at) else '{}'::jsonb end
      || case when x.has_origin then jsonb_build_object('origin',x.origin) else '{}'::jsonb end
      || case when x.has_source_reference then jsonb_build_object('sourceReference',x.source_reference) else '{}'::jsonb end
      order by x.user_id,x.operation,x.role,coalesce(x.expires_at,''),coalesce(x.origin,''),coalesce(x.source_reference,'')),'[]'::jsonb)
    into v_result
  from (
    select value->>'operation' as operation,
      lower((value->>'userId')::uuid::text) as user_id,
      case when value->>'operation'='add' then coalesce(nullif(value->>'role',''),'member') else value->>'role' end as role,
      case when value ? 'expiresAt' then value->>'expiresAt' end as expires_at,
      value ? 'expiresAt' as has_expires,
      value->>'origin' as origin,
      value ? 'origin' as has_origin,
      value->>'sourceReference' as source_reference,
      value ? 'sourceReference' as has_source_reference
    from jsonb_array_elements(p_changes) value
  ) x;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_normalize_changes(jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_membership_fingerprint(
  p_workspace_id uuid,
  p_changes jsonb,
  p_at timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.work_workspaces%rowtype;
  v_changes jsonb := app_private.work_workspace_normalize_changes(p_changes);
  v_members jsonb;
  v_users jsonb;
  v_user_ids uuid[];
  v_source text;
  v_result text;
begin
  select * into w from public.work_workspaces where id=p_workspace_id;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  select coalesce(array_agg((value->>'userId')::uuid order by (value->>'userId')::uuid),'{}'::uuid[])
    into v_user_ids
  from jsonb_array_elements(v_changes) value;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.user_id,m.id),'[]'::jsonb)
    into v_members
  from public.work_workspace_members m
  where m.workspace_id=p_workspace_id
    and m.user_id = any(v_user_ids);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',u.id,'isActive',u.is_active,'accountStatus',u.account_status
    ) order by u.id),'[]'::jsonb)
    into v_users
  from public.users u
  where u.id = any(v_user_ids);
  v_source := app_private.work_workspace_source_fingerprint(p_workspace_id,v_user_ids);
  v_result := md5(jsonb_build_object(
    'workspaceId',w.id,
    'lockVersion',w.lock_version,
    'status',w.status,
    'accessMode',w.access_mode,
    'changes',v_changes,
    'members',v_members,
    'users',v_users,
    'source',v_source
  )::text);
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_membership_fingerprint(uuid,jsonb,timestamptz)
  from public, anon, authenticated;

-- Keep the last-admin calculation effective at the current instant.  An
-- expired historical row may be reactivated by an add, but it must not count
-- as an existing effective member while calculating the post-batch total.
create or replace function app_private.work_workspace_membership_blockers(
  p_workspace_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := app_private.work_workspace_normalize_changes(p_changes);
  v_after_admin_count integer;
  v_rows jsonb;
begin
  with requested as (
    select value->>'operation' operation,(value->>'userId')::uuid user_id,
      value->>'role' role,value ? 'expiresAt' has_expires,
      case when value->>'expiresAt' is null then null::timestamptz else (value->>'expiresAt')::timestamptz end expires_at
    from jsonb_array_elements(v_changes) value
  ), effective_members as (
    select m.user_id,
      case when r.operation='set_role' then r.role else m.role end role,
      case when r.has_expires then r.expires_at else m.expires_at end expires_at
    from public.work_workspace_members m
    join public.users u on u.id=m.user_id
    left join requested r on r.user_id=m.user_id
    where m.workspace_id=p_workspace_id and m.status='active'
      and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
      and u.is_active and u.account_status='ACTIVE'
      and coalesce(r.operation,'') <> 'remove'
    union all
    select r.user_id,r.role,r.expires_at
    from requested r
    join public.users u on u.id=r.user_id and u.is_active and u.account_status='ACTIVE'
    where r.operation='add'
      and not exists(
        select 1 from public.work_workspace_members m
        where m.workspace_id=p_workspace_id and m.user_id=r.user_id
          and m.status='active' and m.starts_at<=now()
          and (m.expires_at is null or m.expires_at>now())
      )
  )
  select count(*)::integer into v_after_admin_count
  from effective_members e
  where e.role='admin' and (e.expires_at is null or e.expires_at>now());
  with requested as (
    select value->>'operation' operation,(value->>'userId')::uuid user_id,value->>'role' role
    from jsonb_array_elements(v_changes) value
  ), blockers as (
    select r.user_id,'WORK_LAST_ADMIN'::text code,0::integer open_assignment_count,0::integer open_review_count
    from requested r
    where r.operation in ('remove','set_role')
      and (r.operation='remove' or r.role='member')
      and v_after_admin_count<=0
      and exists(select 1 from public.work_workspace_members m join public.users u on u.id=m.user_id
        where m.workspace_id=p_workspace_id and m.user_id=r.user_id and m.role='admin' and m.status='active'
          and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now())
          and u.is_active and u.account_status='ACTIVE')
    union all
    select r.user_id,'WORK_MEMBER_OPEN_ASSIGNMENTS',app_private.work_workspace_open_assignment_count(p_workspace_id,r.user_id),app_private.work_workspace_open_review_count(p_workspace_id,r.user_id)
    from requested r
    where r.operation='remove'
      and (app_private.work_workspace_open_assignment_count(p_workspace_id,r.user_id)>0
        or app_private.work_workspace_open_review_count(p_workspace_id,r.user_id)>0)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId',b.user_id,
      'code',b.code,
      'openAssignmentCount',b.open_assignment_count,
      'openReviewCount',b.open_review_count
    ) order by b.user_id,b.code),'[]'::jsonb)
    into v_rows from blockers b;
  return v_rows;
end;
$$;
revoke all on function app_private.work_workspace_membership_blockers(uuid,jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_preview_members(
  p_workspace_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  w public.work_workspaces%rowtype;
  v_actor_expires timestamptz;
  v_changes jsonb;
  v_item jsonb;
  v_member public.work_workspace_members%rowtype;
  v_person record;
  v_expiry timestamptz;
  v_has_expiry boolean;
  v_role text;
  v_item_origin text;
  v_item_source_reference text;
  v_expected_origin text;
  v_expected_source_reference text;
  v_source_kind text;
  v_blockers jsonb;
  v_fingerprint text;
begin
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  select * into w from public.work_workspaces where id=p_workspace_id;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  if w.status <> 'active' or w.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
  end if;
  v_expected_origin := case when w.kind='department' then 'organization'
                            when w.kind='project' then 'project' end;
  v_source_kind := v_expected_origin;
  v_expected_source_reference := app_private.work_workspace_source_reference(p_workspace_id);
  v_changes := app_private.work_workspace_normalize_changes(p_changes);
  if jsonb_array_length(v_changes)=0 then
    raise exception 'WORK_EMPTY_MEMBERSHIP_BATCH' using errcode = '22023';
  end if;
  select m.expires_at into v_actor_expires
  from public.work_workspace_members m
  where m.workspace_id=p_workspace_id and m.user_id=v_actor and m.status='active'
    and m.starts_at<=now() and (m.expires_at is null or m.expires_at>now());

  for v_item in select value from jsonb_array_elements(v_changes) loop
    v_role := v_item->>'role';
    v_item_origin := v_item->>'origin';
    v_item_source_reference := v_item->>'sourceReference';
    if v_item_origin is null and v_item_source_reference is not null then
      raise exception 'WORK_SOURCE_REFERENCE_MISMATCH' using errcode = '22023';
    end if;
    if v_item_origin is not null and v_item_origin='manual' and v_item_source_reference is not null then
      raise exception 'WORK_SOURCE_REFERENCE_MISMATCH' using errcode = '22023';
    end if;
    if v_item_origin is not null and v_item_origin <> 'manual' then
      if v_item_origin is distinct from v_expected_origin
         or v_item_source_reference is distinct from v_expected_source_reference then
        raise exception 'WORK_SOURCE_REFERENCE_MISMATCH' using errcode = '42501';
      end if;
      if v_item->>'operation'='add' then
        select p.* into v_person
        from app_private.work_workspace_people_candidates(p_workspace_id,v_source_kind) p
        where p.user_id=(v_item->>'userId')::uuid
          and p.eligibility='ELIGIBLE'
        order by p.source_at desc,p.person_key
        limit 1;
        if not found then
          raise exception 'WORK_SOURCE_PERSON_INELIGIBLE' using errcode = '42501';
        end if;
      end if;
    end if;
    if v_item->>'operation' in ('add','set_role')
       and not exists(select 1 from public.users u where u.id=(v_item->>'userId')::uuid and u.is_active and u.account_status='ACTIVE') then
      raise exception 'WORK_MEMBER_USER_INACTIVE' using errcode = '42501';
    end if;
    select * into v_member
    from public.work_workspace_members m
    where m.workspace_id=p_workspace_id and m.user_id=(v_item->>'userId')::uuid;
    if v_item->>'operation' in ('remove','set_role')
       and v_item_origin is not null and v_item_origin <> 'manual'
       and (v_member.origin is distinct from v_item_origin
         or v_member.source_reference is distinct from v_item_source_reference) then
      raise exception 'WORK_SOURCE_MEMBERSHIP_MISMATCH' using errcode = '42501';
    end if;
    v_has_expiry := v_item ? 'expiresAt';
    if v_has_expiry and v_item->>'expiresAt' is not null then
      begin v_expiry := (v_item->>'expiresAt')::timestamptz;
      exception when others then raise exception 'WORK_INVALID_MEMBERSHIP_BATCH' using errcode = '22023'; end;
      if v_expiry <= now() then
        raise exception 'WORK_MEMBERSHIP_EXPIRY_INVALID' using errcode = '22023';
      end if;
      if v_actor_expires is not null and v_expiry > v_actor_expires then
        raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
      end if;
    elsif v_actor_expires is not null
      and v_item->>'operation' in ('add','set_role')
      and v_has_expiry and v_item->>'expiresAt' is null then
      raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
    elsif v_item->>'operation'='add' and v_actor_expires is not null then
      raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
    end if;
    if v_item->>'operation'='set_role' and v_role='admin' and v_actor_expires is not null then
      if (v_has_expiry and v_item->>'expiresAt' is null)
         or (not v_has_expiry and v_member.expires_at is null)
         or (v_has_expiry and v_item->>'expiresAt' is not null and v_expiry > v_actor_expires)
         or (not v_has_expiry and v_member.expires_at > v_actor_expires) then
        raise exception 'WORK_MEMBERSHIP_EXPIRY_EXCEEDS_ACTOR' using errcode = '42501';
      end if;
    end if;
    if v_item->>'operation'='add' and v_member.id is not null and v_member.status='active'
       and v_member.starts_at<=now()
       and (v_member.expires_at is null or v_member.expires_at>now()) then
      raise exception 'WORK_MEMBER_ALREADY_ACTIVE' using errcode = '22023';
    elsif v_item->>'operation'='add' and v_member.id is not null and v_member.status='active'
      and v_member.starts_at>now() then
      raise exception 'WORK_MEMBER_ALREADY_ACTIVE' using errcode = '22023';
    elsif v_item->>'operation'='remove'
      and (v_member.id is null or v_member.status <> 'active' or v_member.starts_at>now()) then
      raise exception 'WORK_MEMBER_NOT_FOUND' using errcode = '42501';
    elsif v_item->>'operation'='set_role'
      and (v_member.id is null or v_member.status <> 'active'
        or v_member.starts_at>now() or (v_member.expires_at is not null and v_member.expires_at<=now())) then
      raise exception 'WORK_MEMBER_NOT_FOUND' using errcode = '42501';
    end if;
  end loop;
  v_blockers := app_private.work_workspace_membership_blockers(p_workspace_id,v_changes);
  v_fingerprint := app_private.work_workspace_membership_fingerprint(p_workspace_id,v_changes,now());
  return jsonb_build_object(
    'fingerprint',v_fingerprint,
    'changes',v_changes,
    'blockers',v_blockers
  );
end;
$$;
revoke all on function app_private.work_workspace_preview_members(uuid,jsonb)
  from public, anon, authenticated;

create or replace function app_private.work_workspace_apply_members(
  p_workspace_id uuid,
  p_preview jsonb,
  p_expected_version bigint,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.work_workspace_active_actor();
  v_existing app_private.work_command_idempotency%rowtype;
  v_hash text;
  w public.work_workspaces%rowtype;
  v_changes jsonb;
  v_fresh jsonb;
  v_blockers jsonb;
  v_item jsonb;
  v_member public.work_workspace_members%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_expiry timestamptz;
  v_has_expiry boolean;
  v_origin text;
  v_source_reference text;
  v_event_kind text;
  v_changed integer := 0;
  v_result jsonb;
begin
  if p_idempotency_key is null or p_expected_version is null
     or p_preview is null or jsonb_typeof(p_preview) is distinct from 'object'
     or char_length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  perform app_private.work_workspace_assert_member(p_workspace_id,v_actor);
  v_hash := md5(jsonb_build_object(
    'workspaceId',p_workspace_id,'preview',p_preview,
    'expectedVersion',p_expected_version,'reason',btrim(p_reason)
  )::text);
  insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash)
    values(v_actor,p_idempotency_key,'apply_work_workspace_members',v_hash)
    on conflict (actor_user_id,idempotency_key) do nothing;
  select * into strict v_existing
  from app_private.work_command_idempotency
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key
  for update;
  if v_existing.command_name <> 'apply_work_workspace_members' or v_existing.request_hash <> v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_existing.response_payload is not null then
    if app_private.work_workspace_member_role(p_workspace_id,v_actor) is null
       or not app_private.has_permission(v_actor,'work.module.access','global','*') then
      raise exception 'WORK_ACCESS_DENIED' using errcode = '42501';
    end if;
    return v_existing.response_payload;
  end if;
  if p_preview - array['fingerprint','changes','blockers'] <> '{}'::jsonb
     or jsonb_typeof(p_preview->'fingerprint') is distinct from 'string'
     or jsonb_typeof(p_preview->'changes') is distinct from 'array'
     or jsonb_typeof(p_preview->'blockers') is distinct from 'array' then
    raise exception 'WORK_INVALID_MEMBERSHIP_PREVIEW' using errcode = '22023';
  end if;

  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  -- One Workspace row remains the serialization fence for the entire batch.
  select * into w from public.work_workspaces where id=p_workspace_id for update;
  if w.id is null then
    raise exception 'WORK_WORKSPACE_NOT_FOUND' using errcode = '42501';
  end if;
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  if w.status <> 'active' or w.access_mode <> 'workspace' then
    raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode = '42501';
  end if;
  if w.lock_version <> p_expected_version then
    raise exception 'WORK_VERSION_CONFLICT';
  end if;
  perform app_private.work_workspace_assert_admin(p_workspace_id,v_actor);
  v_changes := app_private.work_workspace_normalize_changes(p_preview->'changes');
  -- Compare the selected source/account snapshot before re-running semantic
  -- eligibility validation.  A person whose source ended after preview must
  -- receive the stale-preview error rather than a misleading eligibility
  -- error, while unrelated company changes remain outside this fence.
  if app_private.work_workspace_membership_fingerprint(p_workspace_id,v_changes,now())
       <> p_preview->>'fingerprint' then
    raise exception 'WORK_MEMBERSHIP_PREVIEW_STALE';
  end if;
  v_fresh := app_private.work_workspace_preview_members(p_workspace_id,v_changes);
  if v_fresh->>'fingerprint' <> p_preview->>'fingerprint' then
    raise exception 'WORK_MEMBERSHIP_PREVIEW_STALE';
  end if;
  v_blockers := v_fresh->'blockers';
  if jsonb_array_length(v_blockers)>0 then
    raise exception '%',v_blockers->0->>'code' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(v_changes) loop
    v_before := null;
    v_after := null;
    v_event_kind := null;
    v_member := null;
    v_has_expiry := v_item ? 'expiresAt';
    v_expiry := case when v_has_expiry and v_item->>'expiresAt' is not null
      then (v_item->>'expiresAt')::timestamptz end;
    v_origin := coalesce(v_item->>'origin','manual');
    v_source_reference := case when v_origin='manual' then null else v_item->>'sourceReference' end;
    select * into v_member
    from public.work_workspace_members m
    where m.workspace_id=p_workspace_id and m.user_id=(v_item->>'userId')::uuid
    for update;
    if v_item->>'operation'='add' then
      if v_member.id is null then
        insert into public.work_workspace_members(
          workspace_id,user_id,role,status,starts_at,expires_at,added_by,origin,source_reference,lock_version
        ) values(
          p_workspace_id,(v_item->>'userId')::uuid,v_item->>'role','active',now(),v_expiry,v_actor,
          v_origin,v_source_reference,1
        ) returning * into v_member;
        v_before := null;
        v_event_kind := 'membership.added';
      else
        v_before := to_jsonb(v_member);
        update public.work_workspace_members
        set role=v_item->>'role',status='active',starts_at=now(),
          expires_at=v_expiry,added_by=v_actor,origin=v_origin,source_reference=v_source_reference,
          lock_version=lock_version+1,updated_at=now()
        where id=v_member.id
        returning * into v_member;
        v_event_kind := 'membership.added';
      end if;
      v_after := to_jsonb(v_member);
      v_changed := v_changed+1;
    elsif v_item->>'operation'='remove' then
      v_before := to_jsonb(v_member);
      update public.work_workspace_members
      set status='removed',lock_version=lock_version+1,updated_at=now()
      where id=v_member.id
      returning * into v_member;
      v_after := to_jsonb(v_member);
      v_event_kind := 'membership.removed';
      v_changed := v_changed+1;
    else
      if v_member.role is distinct from v_item->>'role'
         or (v_has_expiry and v_member.expires_at is distinct from v_expiry) then
        v_before := to_jsonb(v_member);
        update public.work_workspace_members
        set role=v_item->>'role',
          expires_at=case when v_has_expiry then v_expiry else expires_at end,
          lock_version=lock_version+1,updated_at=now()
        where id=v_member.id
        returning * into v_member;
        v_after := to_jsonb(v_member);
        v_event_kind := 'membership.role_changed';
        v_changed := v_changed+1;
      end if;
    end if;
    if v_changed > 0 and v_after is not null then
      insert into app_private.work_workspace_events(
        actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
      ) values(v_actor,p_workspace_id,v_event_kind,v_before,v_after,btrim(p_reason),p_idempotency_key);
    end if;
  end loop;
  if v_changed>0 then
    update public.work_workspaces
    set lock_version=lock_version+1,updated_at=now()
    where id=p_workspace_id
    returning * into w;
  end if;
  v_result := jsonb_build_object('lockVersion',w.lock_version);
  update app_private.work_command_idempotency
  set response_payload=v_result,completed_at=now()
  where actor_user_id=v_actor and idempotency_key=p_idempotency_key;
  return v_result;
end;
$$;
revoke all on function app_private.work_workspace_apply_members(uuid,jsonb,bigint,text,uuid)
  from public, anon, authenticated;

-- Guarded private entries may be called directly by the trusted client layer;
-- arbitrary-user/source helpers remain private and revoked.
grant execute on function app_private.work_workspace_people(uuid,text,text,jsonb,integer)
  to authenticated;
grant execute on function app_private.work_workspace_source_diff(uuid,jsonb,integer)
  to authenticated;
grant execute on function app_private.work_workspace_preview_members(uuid,jsonb)
  to authenticated;
grant execute on function app_private.work_workspace_apply_members(uuid,jsonb,bigint,text,uuid)
  to authenticated;
