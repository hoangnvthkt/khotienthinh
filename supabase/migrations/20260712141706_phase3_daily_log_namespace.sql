-- Phase 3.2 Daily Log namespace refactor.
-- Daily Log mutations now require explicit project.daily_log.* PBAC v2 grants.

create schema if not exists app_private;

revoke all on schema app_private from public;
revoke all on schema app_private from anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.daily_log_has_action(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'project.daily_log.%'
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or app_private.project_has_permission_v2(
        p_project_id,
        p_construction_site_id,
        p_permission_code,
        p_user_id
      )
    );
$$;

revoke all on function app_private.daily_log_has_action(text, text, text, uuid) from public;
revoke all on function app_private.daily_log_has_action(text, text, text, uuid) from anon;
grant execute on function app_private.daily_log_has_action(text, text, text, uuid) to authenticated;

create or replace function app_private.daily_log_has_any_action(
  p_project_id text,
  p_construction_site_id text,
  p_permission_codes text[],
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from unnest(coalesce(p_permission_codes, '{}'::text[])) as permission_code
    where app_private.daily_log_has_action(
      p_project_id,
      p_construction_site_id,
      permission_code,
      p_user_id
    )
  );
$$;

revoke all on function app_private.daily_log_has_any_action(text, text, text[], uuid) from public;
revoke all on function app_private.daily_log_has_any_action(text, text, text[], uuid) from anon;
grant execute on function app_private.daily_log_has_any_action(text, text, text[], uuid) to authenticated;

create or replace function app_private.daily_log_is_owner(
  p_created_by_id text,
  p_submitted_by_id text,
  p_submitted_by text,
  p_created_by text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id::text in (
      coalesce(p_created_by_id, ''),
      coalesce(p_submitted_by_id, ''),
      coalesce(p_submitted_by, ''),
      coalesce(p_created_by, '')
    );
$$;

revoke all on function app_private.daily_log_is_owner(text, text, text, text, uuid) from public;
revoke all on function app_private.daily_log_is_owner(text, text, text, text, uuid) from anon;
grant execute on function app_private.daily_log_is_owner(text, text, text, text, uuid) to authenticated;

create or replace function app_private.daily_log_can_select(
  p_project_id text,
  p_construction_site_id text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_module_admin('DA')
    or not app_private.daily_log_scope_has_staff(p_project_id, p_construction_site_id)
    or app_private.project_scope_has_any_grant_v2(p_project_id, p_construction_site_id, p_user_id)
    or app_private.daily_log_has_any_action(
      p_project_id,
      p_construction_site_id,
      array[
        'project.daily_log.view',
        'project.daily_log.create',
        'project.daily_log.edit_own',
        'project.daily_log.edit_all',
        'project.daily_log.delete_own',
        'project.daily_log.delete_all',
        'project.daily_log.submit',
        'project.daily_log.return',
        'project.daily_log.verify',
        'project.daily_log.approve',
        'project.daily_log.summarize'
      ],
      p_user_id
    );
$$;

revoke all on function app_private.daily_log_can_select(text, text, uuid) from public;
revoke all on function app_private.daily_log_can_select(text, text, uuid) from anon;
grant execute on function app_private.daily_log_can_select(text, text, uuid) to authenticated;

create or replace function app_private.daily_log_can_insert(
  p_project_id text,
  p_construction_site_id text,
  p_summary_source_type text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_summary_source_type, '') = 'member_contributions' then
      app_private.daily_log_has_action(
        p_project_id,
        p_construction_site_id,
        'project.daily_log.summarize',
        p_user_id
      )
    else
      app_private.daily_log_has_action(
        p_project_id,
        p_construction_site_id,
        'project.daily_log.create',
        p_user_id
      )
  end;
$$;

revoke all on function app_private.daily_log_can_insert(text, text, text, uuid) from public;
revoke all on function app_private.daily_log_can_insert(text, text, text, uuid) from anon;
grant execute on function app_private.daily_log_can_insert(text, text, text, uuid) to authenticated;

create or replace function app_private.daily_log_can_edit(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_summary_source_type text,
  p_created_by_id text,
  p_submitted_by_id text,
  p_submitted_by text,
  p_created_by text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_status, 'draft') in ('draft', 'rejected')
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or (
        coalesce(p_summary_source_type, '') = 'member_contributions'
        and app_private.daily_log_has_action(
          p_project_id,
          p_construction_site_id,
          'project.daily_log.summarize',
          p_user_id
        )
      )
      or (
        coalesce(p_summary_source_type, '') <> 'member_contributions'
        and (
          app_private.daily_log_has_action(
            p_project_id,
            p_construction_site_id,
            'project.daily_log.edit_all',
            p_user_id
          )
          or (
            app_private.daily_log_is_owner(
              p_created_by_id,
              p_submitted_by_id,
              p_submitted_by,
              p_created_by,
              p_user_id
            )
            and app_private.daily_log_has_action(
              p_project_id,
              p_construction_site_id,
              'project.daily_log.edit_own',
              p_user_id
            )
          )
        )
      )
    );
$$;

revoke all on function app_private.daily_log_can_edit(text, text, text, text, text, text, text, text, uuid) from public;
revoke all on function app_private.daily_log_can_edit(text, text, text, text, text, text, text, text, uuid) from anon;
grant execute on function app_private.daily_log_can_edit(text, text, text, text, text, text, text, text, uuid) to authenticated;

create or replace function app_private.daily_log_can_delete(
  p_project_id text,
  p_construction_site_id text,
  p_status text,
  p_summary_source_type text,
  p_created_by_id text,
  p_submitted_by_id text,
  p_submitted_by text,
  p_created_by text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_status, 'draft') in ('draft', 'rejected')
    and (
      public.is_admin()
      or public.is_module_admin('DA')
      or (
        coalesce(p_summary_source_type, '') = 'member_contributions'
        and app_private.daily_log_has_action(
          p_project_id,
          p_construction_site_id,
          'project.daily_log.summarize',
          p_user_id
        )
      )
      or (
        coalesce(p_summary_source_type, '') <> 'member_contributions'
        and (
          app_private.daily_log_has_action(
            p_project_id,
            p_construction_site_id,
            'project.daily_log.delete_all',
            p_user_id
          )
          or (
            app_private.daily_log_is_owner(
              p_created_by_id,
              p_submitted_by_id,
              p_submitted_by,
              p_created_by,
              p_user_id
            )
            and app_private.daily_log_has_action(
              p_project_id,
              p_construction_site_id,
              'project.daily_log.delete_own',
              p_user_id
            )
          )
        )
      )
    );
$$;

revoke all on function app_private.daily_log_can_delete(text, text, text, text, text, text, text, text, uuid) from public;
revoke all on function app_private.daily_log_can_delete(text, text, text, text, text, text, text, text, uuid) from anon;
grant execute on function app_private.daily_log_can_delete(text, text, text, text, text, text, text, text, uuid) to authenticated;

create or replace function app_private.daily_log_transition_context_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_setting('app.daily_log_transition_context', true) = 'on';
$$;

revoke all on function app_private.daily_log_transition_context_enabled() from public;
revoke all on function app_private.daily_log_transition_context_enabled() from anon;
grant execute on function app_private.daily_log_transition_context_enabled() to authenticated;

create or replace function app_private.guard_daily_log_direct_status_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app_private.daily_log_transition_context_enabled() then
    return new;
  end if;

  if new.status is distinct from old.status
    or new.verified is distinct from old.verified
    or new.submitted_by is distinct from old.submitted_by
    or new.submitted_by_id is distinct from old.submitted_by_id
    or new.submitted_at is distinct from old.submitted_at
    or new.requested_verifier_id is distinct from old.requested_verifier_id
    or new.requested_verifier_name is distinct from old.requested_verifier_name
    or new.submitted_to_user_id is distinct from old.submitted_to_user_id
    or new.submitted_to_name is distinct from old.submitted_to_name
    or new.submitted_to_permission is distinct from old.submitted_to_permission
    or new.submission_note is distinct from old.submission_note
    or new.verified_by is distinct from old.verified_by
    or new.verified_by_id is distinct from old.verified_by_id
    or new.verified_at is distinct from old.verified_at
    or new.rejected_by is distinct from old.rejected_by
    or new.rejected_by_id is distinct from old.rejected_by_id
    or new.rejected_at is distinct from old.rejected_at
    or new.rejection_reason is distinct from old.rejection_reason then
    raise exception 'Daily Log workflow fields must be changed through transition_daily_log_status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_daily_log_direct_status_update() from public;
revoke all on function app_private.guard_daily_log_direct_status_update() from anon;
grant execute on function app_private.guard_daily_log_direct_status_update() to authenticated;

drop trigger if exists guard_daily_log_direct_status_update on public.daily_logs;
create trigger guard_daily_log_direct_status_update
  before update on public.daily_logs
  for each row
  execute function app_private.guard_daily_log_direct_status_update();

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
set search_path = ''
as $$
declare
  v_log public.daily_logs%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_user_id_text text := public.current_app_user_id()::text;
  v_actor_name text;
  v_owner_id text;
  v_target_handler_id text;
  v_target_permission text;
  v_required_permission text;
  v_is_admin_or_module_admin boolean := public.is_admin() or public.is_module_admin('DA');
  v_previous_guard text;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng đang thao tác.'
      using errcode = '42501';
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
  where u.id = v_user_id;

  v_owner_id := coalesce(v_log.created_by_id, v_log.submitted_by_id, v_log.submitted_by, v_log.created_by);
  v_target_handler_id := coalesce(v_log.requested_verifier_id, v_log.submitted_to_user_id);
  v_target_permission := coalesce(nullif(v_log.submitted_to_permission, ''), 'verify');

  if v_target_permission not in ('verify', 'approve') then
    v_target_permission := 'verify';
  end if;

  if p_status = 'submitted' then
    if coalesce(v_log.status, 'draft') not in ('draft', 'rejected') then
      raise exception 'Chỉ nhật ký nháp hoặc bị trả lại mới được gửi xác nhận.';
    end if;

    if not v_is_admin_or_module_admin and coalesce(v_owner_id, '') <> v_user_id_text then
      raise exception 'Chỉ người lập nhật ký mới được gửi xác nhận.'
        using errcode = '42501';
    end if;

    if not app_private.daily_log_has_action(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      'project.daily_log.submit',
      v_user_id
    ) then
      raise exception 'Bạn cần quyền project.daily_log.submit để gửi nhật ký.'
        using errcode = '42501';
    end if;

    if nullif(p_requested_verifier_id, '') is null then
      raise exception 'Vui lòng chọn người xác nhận nhật ký.';
    end if;

    v_required_permission := case
      when v_target_permission = 'approve' then 'project.daily_log.approve'
      else 'project.daily_log.verify'
    end;

    if not app_private.daily_log_has_action(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_required_permission,
      p_requested_verifier_id::uuid
    ) then
      raise exception 'Người được chọn chưa có quyền % trong Tổ chức dự án.', v_required_permission
        using errcode = '42501';
    end if;

    v_previous_guard := current_setting('app.daily_log_transition_context', true);
    perform set_config('app.daily_log_transition_context', 'on', true);

    update public.daily_logs
    set
      status = 'submitted',
      verified = false,
      submitted_by = v_user_id_text,
      submitted_by_id = v_user_id_text,
      submitted_at = now(),
      requested_verifier_id = p_requested_verifier_id,
      requested_verifier_name = nullif(p_requested_verifier_name, ''),
      submitted_to_user_id = p_requested_verifier_id,
      submitted_to_name = nullif(p_requested_verifier_name, ''),
      submitted_to_permission = v_target_permission,
      submission_note = null,
      ever_submitted = true,
      rejected_by = null,
      rejected_by_id = null,
      rejected_at = null,
      rejection_reason = null,
      last_action_by = v_user_id_text,
      last_action_at = now()
    where id = p_log_id;

    perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
    return;
  end if;

  if p_status = 'verified' then
    if coalesce(v_log.status, 'draft') <> 'submitted' then
      raise exception 'Chỉ nhật ký đang chờ xử lý mới được xác nhận/duyệt.';
    end if;

    v_required_permission := case
      when v_target_permission = 'approve' then 'project.daily_log.approve'
      else 'project.daily_log.verify'
    end;
  else
    if coalesce(v_log.status, 'draft') not in ('submitted', 'verified') then
      raise exception 'Chỉ nhật ký đang chờ xử lý hoặc đã xác nhận mới được trả lại.';
    end if;

    if nullif(coalesce(p_rejection_reason, ''), '') is null then
      raise exception 'Vui lòng nhập lý do trả lại nhật ký.';
    end if;

    v_required_permission := 'project.daily_log.return';
  end if;

  if not v_is_admin_or_module_admin then
    if nullif(v_target_handler_id, '') is null or v_target_handler_id <> v_user_id_text then
      raise exception 'Bạn không phải người được giao xử lý nhật ký này.'
        using errcode = '42501';
    end if;

    if not app_private.daily_log_has_action(
      v_log.project_id::text,
      v_log.construction_site_id::text,
      v_required_permission,
      v_user_id
    ) then
      raise exception 'Bạn cần quyền % để xử lý nhật ký này.', v_required_permission
        using errcode = '42501';
    end if;
  end if;

  v_previous_guard := current_setting('app.daily_log_transition_context', true);
  perform set_config('app.daily_log_transition_context', 'on', true);

  if p_status = 'verified' then
    update public.daily_logs
    set
      status = 'verified',
      verified = true,
      verified_by = coalesce(v_actor_name, v_user_id_text),
      verified_by_id = v_user_id_text,
      verified_at = now(),
      rejected_by = null,
      rejected_by_id = null,
      rejected_at = null,
      rejection_reason = null,
      last_action_by = v_user_id_text,
      last_action_at = now()
    where id = p_log_id;
  else
    update public.daily_logs
    set
      status = 'rejected',
      verified = false,
      rejected_by = coalesce(v_actor_name, v_user_id_text),
      rejected_by_id = v_user_id_text,
      rejected_at = now(),
      rejection_reason = p_rejection_reason,
      submitted_to_user_id = coalesce(v_log.created_by_id, v_log.submitted_by_id, v_log.submitted_by, v_log.created_by),
      submitted_to_name = coalesce(v_log.created_by, v_log.submitted_by),
      submitted_to_permission = 'edit',
      submission_note = p_rejection_reason,
      last_action_by = v_user_id_text,
      last_action_at = now()
    where id = p_log_id;
  end if;

  perform set_config('app.daily_log_transition_context', coalesce(v_previous_guard, ''), true);
end;
$$;

revoke all on function public.transition_daily_log_status(text, text, text, text, text) from public;
revoke all on function public.transition_daily_log_status(text, text, text, text, text) from anon;
grant execute on function public.transition_daily_log_status(text, text, text, text, text) to authenticated;

alter table if exists public.daily_logs enable row level security;
alter table if exists public.daily_log_volumes enable row level security;
alter table if exists public.daily_log_materials enable row level security;
alter table if exists public.daily_log_labor enable row level security;
alter table if exists public.daily_log_machines enable row level security;
alter table if exists public.daily_log_summary_sources enable row level security;

revoke all on table public.daily_logs from anon;
revoke all on table public.daily_log_volumes from anon;
revoke all on table public.daily_log_materials from anon;
revoke all on table public.daily_log_labor from anon;
revoke all on table public.daily_log_machines from anon;
revoke all on table public.daily_log_summary_sources from anon;

grant select, insert, update, delete on table public.daily_logs to authenticated;
grant select, insert, update, delete on table public.daily_log_volumes to authenticated;
grant select, insert, update, delete on table public.daily_log_materials to authenticated;
grant select, insert, update, delete on table public.daily_log_labor to authenticated;
grant select, insert, update, delete on table public.daily_log_machines to authenticated;
grant select, insert, update, delete on table public.daily_log_summary_sources to authenticated;

drop policy if exists daily_logs_select on public.daily_logs;
create policy daily_logs_select
  on public.daily_logs
  for select
  to authenticated
  using (
    app_private.daily_log_can_select(
      project_id::text,
      construction_site_id::text,
      public.current_app_user_id()
    )
  );

drop policy if exists daily_logs_insert on public.daily_logs;
create policy daily_logs_insert
  on public.daily_logs
  for insert
  to authenticated
  with check (
    app_private.daily_log_can_insert(
      project_id::text,
      construction_site_id::text,
      summary_source_type,
      public.current_app_user_id()
    )
  );

drop policy if exists daily_logs_update on public.daily_logs;
create policy daily_logs_update
  on public.daily_logs
  for update
  to authenticated
  using (
    app_private.daily_log_can_edit(
      project_id::text,
      construction_site_id::text,
      status::text,
      summary_source_type,
      created_by_id,
      submitted_by_id,
      submitted_by,
      created_by,
      public.current_app_user_id()
    )
  )
  with check (
    app_private.daily_log_can_edit(
      project_id::text,
      construction_site_id::text,
      status::text,
      summary_source_type,
      created_by_id,
      submitted_by_id,
      submitted_by,
      created_by,
      public.current_app_user_id()
    )
  );

drop policy if exists daily_logs_delete on public.daily_logs;
create policy daily_logs_delete
  on public.daily_logs
  for delete
  to authenticated
  using (
    app_private.daily_log_can_delete(
      project_id::text,
      construction_site_id::text,
      status::text,
      summary_source_type,
      created_by_id,
      submitted_by_id,
      submitted_by,
      created_by,
      public.current_app_user_id()
    )
  );

drop policy if exists "daily_log_volumes_site_access" on public.daily_log_volumes;
drop policy if exists "daily_log_volumes_project_access" on public.daily_log_volumes;
drop policy if exists daily_log_volumes_select on public.daily_log_volumes;
create policy daily_log_volumes_select
  on public.daily_log_volumes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_select(dl.project_id::text, dl.construction_site_id::text, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_volumes_insert on public.daily_log_volumes;
create policy daily_log_volumes_insert
  on public.daily_log_volumes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_volumes_update on public.daily_log_volumes;
create policy daily_log_volumes_update
  on public.daily_log_volumes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  )
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_volumes_delete on public.daily_log_volumes;
create policy daily_log_volumes_delete
  on public.daily_log_volumes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists "daily_log_materials_site_access" on public.daily_log_materials;
drop policy if exists "daily_log_materials_project_access" on public.daily_log_materials;
drop policy if exists daily_log_materials_select on public.daily_log_materials;
create policy daily_log_materials_select
  on public.daily_log_materials
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_select(dl.project_id::text, dl.construction_site_id::text, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_materials_insert on public.daily_log_materials;
create policy daily_log_materials_insert
  on public.daily_log_materials
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_materials_update on public.daily_log_materials;
create policy daily_log_materials_update
  on public.daily_log_materials
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  )
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_materials_delete on public.daily_log_materials;
create policy daily_log_materials_delete
  on public.daily_log_materials
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists "daily_log_labor_site_access" on public.daily_log_labor;
drop policy if exists "daily_log_labor_project_access" on public.daily_log_labor;
drop policy if exists daily_log_labor_select on public.daily_log_labor;
create policy daily_log_labor_select
  on public.daily_log_labor
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_select(dl.project_id::text, dl.construction_site_id::text, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_labor_insert on public.daily_log_labor;
create policy daily_log_labor_insert
  on public.daily_log_labor
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_labor_update on public.daily_log_labor;
create policy daily_log_labor_update
  on public.daily_log_labor
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  )
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_labor_delete on public.daily_log_labor;
create policy daily_log_labor_delete
  on public.daily_log_labor
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists "daily_log_machines_site_access" on public.daily_log_machines;
drop policy if exists "daily_log_machines_project_access" on public.daily_log_machines;
drop policy if exists daily_log_machines_select on public.daily_log_machines;
create policy daily_log_machines_select
  on public.daily_log_machines
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_select(dl.project_id::text, dl.construction_site_id::text, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_machines_insert on public.daily_log_machines;
create policy daily_log_machines_insert
  on public.daily_log_machines
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_machines_update on public.daily_log_machines;
create policy daily_log_machines_update
  on public.daily_log_machines
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  )
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_machines_delete on public.daily_log_machines;
create policy daily_log_machines_delete
  on public.daily_log_machines
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_summary_sources_select on public.daily_log_summary_sources;
create policy daily_log_summary_sources_select
  on public.daily_log_summary_sources
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_select(dl.project_id::text, dl.construction_site_id::text, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_summary_sources_insert on public.daily_log_summary_sources;
create policy daily_log_summary_sources_insert
  on public.daily_log_summary_sources
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_summary_sources_update on public.daily_log_summary_sources;
create policy daily_log_summary_sources_update
  on public.daily_log_summary_sources
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  )
  with check (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

drop policy if exists daily_log_summary_sources_delete on public.daily_log_summary_sources;
create policy daily_log_summary_sources_delete
  on public.daily_log_summary_sources
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.daily_logs dl
      where dl.id = daily_log_id
        and app_private.daily_log_can_edit(dl.project_id::text, dl.construction_site_id::text, dl.status::text, dl.summary_source_type, dl.created_by_id, dl.submitted_by_id, dl.submitted_by, dl.created_by, public.current_app_user_id())
    )
  );

notify pgrst, 'reload schema';
