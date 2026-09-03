-- Harden daily log status transitions and ownership edits.
-- Cloud-only migration: apply with `npx supabase db query --linked -f ...`.

alter table if exists public.daily_logs
  add column if not exists created_by_id text,
  add column if not exists submitted_by_id text,
  add column if not exists submitted_to_user_id text,
  add column if not exists verified_by_id text,
  add column if not exists rejected_by_id text,
  add column if not exists requested_verifier_id text,
  add column if not exists requested_verifier_name text;

create index if not exists idx_daily_logs_created_by_id
  on public.daily_logs(created_by_id);

create index if not exists idx_daily_logs_submitted_to_user_id
  on public.daily_logs(submitted_to_user_id);

create index if not exists idx_daily_logs_requested_verifier
  on public.daily_logs(requested_verifier_id);

update public.daily_logs dl
set created_by_id = u.id::text
from public.users u
where dl.created_by_id is null
  and (
    dl.created_by = u.id::text
    or lower(coalesce(dl.created_by, '')) = lower(coalesce(u.name, ''))
    or lower(coalesce(dl.created_by, '')) = lower(coalesce(u.username, ''))
    or lower(coalesce(dl.created_by, '')) = lower(coalesce(u.email, ''))
  );

update public.daily_logs
set submitted_by_id = submitted_by
where submitted_by_id is null
  and submitted_by is not null;

update public.daily_logs
set submitted_to_user_id = requested_verifier_id
where submitted_to_user_id is null
  and requested_verifier_id is not null;

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
  v_can_verify boolean;
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

    if p_requested_verifier_id = v_user_id and not v_is_admin then
      raise exception 'Người xác nhận phải khác người gửi.';
    end if;

    if not public.daily_log_user_has_project_permission(
      p_requested_verifier_id,
      v_log.project_id::text,
      v_log.construction_site_id::text,
      'verify'
    ) then
      raise exception 'Người được chọn chưa có quyền verify trong Tổ chức dự án.';
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

  v_can_verify := v_is_admin
    or (
      nullif(v_target_verifier_id, '') is not null
      and v_target_verifier_id = v_user_id
      and public.daily_log_user_has_project_permission(
        v_user_id,
        v_log.project_id::text,
        v_log.construction_site_id::text,
        'verify'
      )
    )
    or (
      nullif(v_target_verifier_id, '') is null
      and public.daily_log_user_has_project_permission(
        v_user_id,
        v_log.project_id::text,
        v_log.construction_site_id::text,
        'verify'
      )
    );

  if not v_can_verify then
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

alter table if exists public.daily_logs enable row level security;

drop policy if exists daily_logs_update on public.daily_logs;
create policy daily_logs_update
  on public.daily_logs
  for update
  to authenticated
  using (
    public.is_admin()
    or (
      coalesce(created_by_id, submitted_by_id, submitted_by) = public.current_app_user_id()::text
      and coalesce(status, 'draft') in ('draft', 'rejected')
    )
  )
  with check (
    public.is_admin()
    or (
      coalesce(created_by_id, submitted_by_id, submitted_by) = public.current_app_user_id()::text
      and coalesce(status, 'draft') in ('draft', 'rejected')
    )
  );

drop policy if exists daily_logs_delete on public.daily_logs;
create policy daily_logs_delete
  on public.daily_logs
  for delete
  to authenticated
  using (
    public.is_admin()
    or (
      coalesce(created_by_id, submitted_by_id, submitted_by) = public.current_app_user_id()::text
      and coalesce(status, 'draft') in ('draft', 'rejected')
    )
  );

notify pgrst, 'reload schema';
