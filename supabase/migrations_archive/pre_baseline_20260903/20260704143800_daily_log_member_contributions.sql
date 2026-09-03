-- Daily log member contributions v1.
-- Many field reports can feed one official daily_logs row while preserving user traceability.

create table if not exists public.daily_log_contributions (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  construction_site_id text,
  daily_log_id text references public.daily_logs(id) on delete set null,
  date date not null,
  author_user_id text not null,
  author_name text,
  content text not null default '',
  issues text,
  photos jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'returned', 'included')),
  submitted_to_user_id text,
  submitted_to_name text,
  submitted_at timestamptz,
  returned_by text,
  returned_by_name text,
  returned_at timestamptz,
  return_reason text,
  included_in_daily_log_id text references public.daily_logs(id) on delete set null,
  included_by text,
  included_at timestamptz,
  last_action_by text,
  last_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_log_contributions_scope_check
    check (project_id is not null or construction_site_id is not null)
);

create unique index if not exists ux_daily_log_contrib_scope_day_author
  on public.daily_log_contributions (
    coalesce(project_id, ''),
    coalesce(construction_site_id, ''),
    date,
    author_user_id
  );

create index if not exists idx_daily_log_contrib_project_date
  on public.daily_log_contributions(project_id, date desc);

create index if not exists idx_daily_log_contrib_site_date
  on public.daily_log_contributions(construction_site_id, date desc);

create index if not exists idx_daily_log_contrib_author_date
  on public.daily_log_contributions(author_user_id, date desc);

create index if not exists idx_daily_log_contrib_status
  on public.daily_log_contributions(status, submitted_to_user_id);

drop trigger if exists trg_daily_log_contributions_updated_at on public.daily_log_contributions;
create trigger trg_daily_log_contributions_updated_at
  before update on public.daily_log_contributions
  for each row execute function public.set_updated_at();

create or replace function app_private.daily_log_scope_has_staff(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_staff ps
    where ps.end_date is null
      and (
        (p_project_id is not null and ps.project_id::text = p_project_id)
        or (p_construction_site_id is not null and ps.construction_site_id::text = p_construction_site_id)
      )
  );
$$;

create or replace function app_private.daily_log_contribution_transition_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id text := public.current_app_user_id()::text;
  v_can_review boolean;
begin
  if public.is_admin() then
    return new;
  end if;

  v_can_review :=
    app_private.project_user_has_permission(old.project_id::text, old.construction_site_id::text, 'verify')
    or app_private.project_user_has_permission(old.project_id::text, old.construction_site_id::text, 'approve')
    or not app_private.daily_log_scope_has_staff(old.project_id::text, old.construction_site_id::text);

  if v_can_review then
    return new;
  end if;

  if old.author_user_id = v_user_id and old.status in ('draft', 'returned') and new.status in ('draft', 'submitted') then
    return new;
  end if;

  raise exception 'Báo cáo đã gửi/tổng hợp không thể chỉnh sửa trực tiếp.';
end;
$$;

revoke all on function app_private.daily_log_contribution_transition_guard() from public, anon, authenticated;
grant execute on function app_private.daily_log_contribution_transition_guard() to authenticated;

drop trigger if exists trg_daily_log_contributions_transition_guard on public.daily_log_contributions;
create trigger trg_daily_log_contributions_transition_guard
  before update on public.daily_log_contributions
  for each row execute function app_private.daily_log_contribution_transition_guard();

create table if not exists public.daily_log_summary_sources (
  id uuid primary key default gen_random_uuid(),
  daily_log_id text not null references public.daily_logs(id) on delete cascade,
  contribution_id uuid not null references public.daily_log_contributions(id) on delete cascade,
  source_user_id text,
  source_user_name text,
  included_text boolean not null default true,
  included_photos jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  unique (daily_log_id, contribution_id)
);

create index if not exists idx_daily_log_summary_sources_log
  on public.daily_log_summary_sources(daily_log_id);

create index if not exists idx_daily_log_summary_sources_contribution
  on public.daily_log_summary_sources(contribution_id);

alter table if exists public.daily_logs
  add column if not exists summarized_by_id text,
  add column if not exists summarized_by_name text,
  add column if not exists summarized_at timestamptz,
  add column if not exists summary_source_type text,
  add column if not exists summary_source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists summary_contribution_count integer not null default 0;

create index if not exists idx_daily_logs_summary_source_type
  on public.daily_logs(summary_source_type, date desc);

create or replace function app_private.daily_log_scope_has_staff(
  p_project_id text,
  p_construction_site_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_staff ps
    where ps.end_date is null
      and (
        (p_project_id is not null and ps.project_id::text = p_project_id)
        or (p_construction_site_id is not null and ps.construction_site_id::text = p_construction_site_id)
      )
  );
$$;

create or replace function app_private.daily_log_contribution_can_view(
  p_project_id text,
  p_construction_site_id text,
  p_author_user_id text,
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or p_author_user_id = public.current_app_user_id()::text
    or p_submitted_to_user_id = public.current_app_user_id()::text
    or app_private.project_user_has_any_permission(p_project_id, p_construction_site_id)
    or not app_private.daily_log_scope_has_staff(p_project_id, p_construction_site_id);
$$;

create or replace function public.daily_log_user_has_project_permission(
  p_user_id text,
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id::text = p_user_id
      and u.role = 'ADMIN'
      and coalesce(u.is_active, true)
  )
  or not app_private.daily_log_scope_has_staff(p_project_id, p_construction_site_id)
  or exists (
    select 1
    from public.project_staff ps
    join public.project_staff_permissions psp
      on psp.staff_id = ps.id
     and coalesce(psp.is_active, true)
    join public.project_permission_types ppt
      on ppt.id = psp.permission_type_id
     and ppt.code = p_permission_code
     and coalesce(ppt.is_active, true)
    where ps.user_id::text = p_user_id
      and ps.end_date is null
      and (
        (p_project_id is not null and ps.project_id::text = p_project_id)
        or (p_construction_site_id is not null and ps.construction_site_id::text = p_construction_site_id)
      )
  );
$$;

revoke all on function public.daily_log_user_has_project_permission(text, text, text, text) from public;
grant execute on function public.daily_log_user_has_project_permission(text, text, text, text) to authenticated;

create or replace function app_private.daily_log_contribution_can_submit(
  p_project_id text,
  p_construction_site_id text,
  p_author_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      p_author_user_id = public.current_app_user_id()::text
      and (
        app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'submit')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'edit')
        or not app_private.daily_log_scope_has_staff(p_project_id, p_construction_site_id)
      )
    );
$$;

create or replace function app_private.daily_log_contribution_can_update(
  p_project_id text,
  p_construction_site_id text,
  p_author_user_id text,
  p_status text,
  p_submitted_to_user_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      p_author_user_id = public.current_app_user_id()::text
      and coalesce(p_status, 'draft') in ('draft', 'returned', 'submitted')
    )
    or (
      coalesce(p_status, 'draft') in ('submitted', 'included', 'returned')
      and (
        p_submitted_to_user_id = public.current_app_user_id()::text
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'verify')
        or app_private.project_user_has_permission(p_project_id, p_construction_site_id, 'approve')
      )
    )
    or (
      not app_private.daily_log_scope_has_staff(p_project_id, p_construction_site_id)
      and app_private.daily_log_contribution_can_view(p_project_id, p_construction_site_id, p_author_user_id, p_submitted_to_user_id)
    );
$$;

revoke all on function app_private.daily_log_scope_has_staff(text, text) from public, anon, authenticated;
revoke all on function app_private.daily_log_contribution_can_view(text, text, text, text) from public, anon, authenticated;
revoke all on function app_private.daily_log_contribution_can_submit(text, text, text) from public, anon, authenticated;
revoke all on function app_private.daily_log_contribution_can_update(text, text, text, text, text) from public, anon, authenticated;
grant execute on function app_private.daily_log_scope_has_staff(text, text) to authenticated;
grant execute on function app_private.daily_log_contribution_can_view(text, text, text, text) to authenticated;
grant execute on function app_private.daily_log_contribution_can_submit(text, text, text) to authenticated;
grant execute on function app_private.daily_log_contribution_can_update(text, text, text, text, text) to authenticated;

alter table public.daily_log_contributions enable row level security;
alter table public.daily_log_summary_sources enable row level security;

revoke all on table public.daily_log_contributions from anon, public, authenticated;
revoke all on table public.daily_log_summary_sources from anon, public, authenticated;
grant select, insert, update, delete on table public.daily_log_contributions to authenticated;
grant select, insert, update, delete on table public.daily_log_summary_sources to authenticated;

drop policy if exists daily_logs_insert on public.daily_logs;
create policy daily_logs_insert
  on public.daily_logs
  for insert
  to authenticated
  with check (
    public.is_admin()
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'edit')
    or app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'submit')
    or (
      summary_source_type = 'member_contributions'
      and (
        app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'verify')
        or not app_private.daily_log_scope_has_staff(project_id::text, construction_site_id::text)
      )
    )
  );

drop policy if exists daily_logs_update on public.daily_logs;
create policy daily_logs_update
  on public.daily_logs
  for update
  to authenticated
  using (
    app_private.project_doc_can_update_step(project_id::text, construction_site_id::text, status::text, submitted_to_user_id)
    or (
      summary_source_type = 'member_contributions'
      and coalesce(status::text, 'draft') in ('draft', 'rejected')
      and (
        app_private.project_user_has_permission(project_id::text, construction_site_id::text, 'verify')
        or not app_private.daily_log_scope_has_staff(project_id::text, construction_site_id::text)
      )
    )
  )
  with check (project_id is not null or construction_site_id is not null or public.is_admin());

drop policy if exists daily_log_contributions_select on public.daily_log_contributions;
create policy daily_log_contributions_select
  on public.daily_log_contributions
  for select
  to authenticated
  using (
    app_private.daily_log_contribution_can_view(
      project_id::text,
      construction_site_id::text,
      author_user_id,
      submitted_to_user_id
    )
  );

drop policy if exists daily_log_contributions_insert on public.daily_log_contributions;
create policy daily_log_contributions_insert
  on public.daily_log_contributions
  for insert
  to authenticated
  with check (
    app_private.daily_log_contribution_can_submit(
      project_id::text,
      construction_site_id::text,
      author_user_id
    )
  );

drop policy if exists daily_log_contributions_update on public.daily_log_contributions;
create policy daily_log_contributions_update
  on public.daily_log_contributions
  for update
  to authenticated
  using (
    app_private.daily_log_contribution_can_update(
      project_id::text,
      construction_site_id::text,
      author_user_id,
      status,
      submitted_to_user_id
    )
  )
  with check (
    app_private.daily_log_contribution_can_update(
      project_id::text,
      construction_site_id::text,
      author_user_id,
      status,
      submitted_to_user_id
    )
  );

drop policy if exists daily_log_contributions_delete on public.daily_log_contributions;
create policy daily_log_contributions_delete
  on public.daily_log_contributions
  for delete
  to authenticated
  using (
    public.is_admin()
    or (
      author_user_id = public.current_app_user_id()::text
      and status = 'draft'
    )
  );

drop policy if exists daily_log_summary_sources_select on public.daily_log_summary_sources;
create policy daily_log_summary_sources_select
  on public.daily_log_summary_sources
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.project_doc_can_view(dl.project_id::text, dl.construction_site_id::text, dl.submitted_to_user_id)
    )
    or exists (
      select 1
      from public.daily_log_contributions c
      where c.id = contribution_id
        and app_private.daily_log_contribution_can_view(c.project_id::text, c.construction_site_id::text, c.author_user_id, c.submitted_to_user_id)
    )
  );

drop policy if exists daily_log_summary_sources_insert on public.daily_log_summary_sources;
create policy daily_log_summary_sources_insert
  on public.daily_log_summary_sources
  for insert
  to authenticated
  with check (
    public.is_admin()
    or exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and (
          app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'verify')
          or app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'edit')
          or not app_private.daily_log_scope_has_staff(dl.project_id::text, dl.construction_site_id::text)
        )
    )
  );

drop policy if exists daily_log_summary_sources_update on public.daily_log_summary_sources;
create policy daily_log_summary_sources_update
  on public.daily_log_summary_sources
  for update
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and (
          app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'verify')
          or app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'edit')
          or not app_private.daily_log_scope_has_staff(dl.project_id::text, dl.construction_site_id::text)
        )
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and (
          app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'verify')
          or app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'edit')
          or not app_private.daily_log_scope_has_staff(dl.project_id::text, dl.construction_site_id::text)
        )
    )
  );

drop policy if exists daily_log_summary_sources_delete on public.daily_log_summary_sources;
create policy daily_log_summary_sources_delete
  on public.daily_log_summary_sources
  for delete
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and (
          app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'verify')
          or app_private.project_user_has_permission(dl.project_id::text, dl.construction_site_id::text, 'edit')
          or not app_private.daily_log_scope_has_staff(dl.project_id::text, dl.construction_site_id::text)
        )
    )
  );

create or replace function public.transition_daily_log_status(
  p_log_id text,
  p_status text,
  p_requested_verifier_id text default null,
  p_requested_verifier_name text default null,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.daily_logs%rowtype;
  v_user_id text := public.current_app_user_id()::text;
  v_is_admin boolean := public.is_admin();
  v_actor_name text;
  v_owner_id text;
  v_target_verifier_id text;
  v_target_permission text;
  v_can_review boolean;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.';
  end if;

  if p_status not in ('submitted', 'verified', 'rejected') then
    raise exception 'Trạng thái nhật ký không hợp lệ: %', p_status;
  end if;

  select *
  into v_log
  from public.daily_logs
  where id = p_log_id
  for update;

  if not found then
    raise exception 'Không tìm thấy nhật ký công trường.';
  end if;

  select coalesce(u.name, u.username, u.email, u.id::text)
  into v_actor_name
  from public.users u
  where u.id::text = v_user_id;

  v_owner_id := coalesce(v_log.created_by_id, v_log.submitted_by_id, v_log.submitted_by);
  v_target_verifier_id := coalesce(v_log.requested_verifier_id, v_log.submitted_to_user_id);
  v_target_permission := coalesce(nullif(v_log.submitted_to_permission, ''), 'verify');

  if v_target_permission not in ('verify', 'approve') then
    v_target_permission := 'verify';
  end if;

  if p_status = 'submitted' then
    if coalesce(v_log.status, 'draft') not in ('draft', 'rejected') then
      raise exception 'Chỉ nhật ký nháp hoặc bị trả lại mới được gửi xác nhận.';
    end if;

    if not v_is_admin and coalesce(v_owner_id, '') <> v_user_id then
      raise exception 'Chỉ người lập nhật ký mới được gửi xác nhận.';
    end if;

    if nullif(p_requested_verifier_id, '') is null then
      raise exception 'Vui lòng chọn người xác nhận nhật ký.';
    end if;

    if not public.daily_log_user_has_project_permission(
      p_requested_verifier_id,
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_target_permission
    ) then
      raise exception 'Người được chọn chưa có quyền % trong Tổ chức dự án.', v_target_permission;
    end if;

    update public.daily_logs
    set
      status = 'submitted',
      verified = false,
      submitted_by = v_user_id,
      submitted_by_id = v_user_id,
      submitted_at = now(),
      requested_verifier_id = p_requested_verifier_id,
      submitted_to_user_id = p_requested_verifier_id,
      requested_verifier_name = nullif(p_requested_verifier_name, ''),
      submitted_to_name = nullif(p_requested_verifier_name, ''),
      submitted_to_permission = v_target_permission,
      rejected_by = null,
      rejected_by_id = null,
      rejected_at = null,
      rejection_reason = null
    where id = p_log_id;

    return;
  end if;

  if coalesce(v_log.status, 'draft') <> 'submitted' then
    raise exception 'Chỉ nhật ký đang chờ xác nhận mới được duyệt hoặc trả lại.';
  end if;

  v_can_review := v_is_admin
    or (
      nullif(v_target_verifier_id, '') is not null
      and v_target_verifier_id = v_user_id
      and public.daily_log_user_has_project_permission(
        v_user_id,
        v_log.project_id::text,
        v_log.construction_site_id::text,
        v_target_permission
      )
    )
    or (
      nullif(v_target_verifier_id, '') is null
      and public.daily_log_user_has_project_permission(
        v_user_id,
        v_log.project_id::text,
        v_log.construction_site_id::text,
        v_target_permission
      )
    );

  if not v_can_review then
    raise exception 'Bạn không phải người được giao xác nhận nhật ký này.';
  end if;

  if p_status = 'verified' then
    update public.daily_logs
    set
      status = 'verified',
      verified = true,
      verified_by = coalesce(v_actor_name, v_user_id),
      verified_by_id = v_user_id,
      verified_at = now(),
      rejected_by = null,
      rejected_by_id = null,
      rejected_at = null,
      rejection_reason = null
    where id = p_log_id;
  else
    update public.daily_logs
    set
      status = 'rejected',
      verified = false,
      rejected_by = coalesce(v_actor_name, v_user_id),
      rejected_by_id = v_user_id,
      rejected_at = now(),
      rejection_reason = coalesce(nullif(p_rejection_reason, ''), 'Cần bổ sung/kiểm tra lại')
    where id = p_log_id;
  end if;
end;
$$;

revoke all on function public.transition_daily_log_status(text, text, text, text, text) from public;
grant execute on function public.transition_daily_log_status(text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
