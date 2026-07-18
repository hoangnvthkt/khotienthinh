create or replace function app_private.guard_payment_certificate_direct_workflow_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.status, 'draft') <> 'draft' then
      raise exception 'Payment Certificate workflow must start in draft.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if current_setting('app.project_document_transition_context', true) is distinct from 'on'
    and (
      old.status is distinct from new.status
      or old.submitted_by is distinct from new.submitted_by
      or old.submitted_at is distinct from new.submitted_at
      or old.approved_by is distinct from new.approved_by
      or old.approved_at is distinct from new.approved_at
      or old.paid_at is distinct from new.paid_at
      or old.returned_by is distinct from new.returned_by
      or old.returned_at is distinct from new.returned_at
      or old.return_reason is distinct from new.return_reason
      or old.submitted_to_user_id is distinct from new.submitted_to_user_id
      or old.submitted_to_name is distinct from new.submitted_to_name
      or old.submitted_to_permission is distinct from new.submitted_to_permission
      or old.submission_note is distinct from new.submission_note
    )
  then
    raise exception 'Payment Certificate workflow fields must be changed through transition_project_payment_certificate_status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_payment_certificate_direct_workflow_update on public.payment_certificates;
create trigger guard_payment_certificate_direct_workflow_update
  before insert or update on public.payment_certificates
  for each row execute function app_private.guard_payment_certificate_direct_workflow_update();

create or replace function app_private.guard_quantity_acceptance_direct_workflow_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.status, 'draft') <> 'draft' then
      raise exception 'Quantity Acceptance workflow must start in draft.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if current_setting('app.project_document_transition_context', true) is distinct from 'on'
    and (
      old.status is distinct from new.status
      or old.submitted_by is distinct from new.submitted_by
      or old.submitted_at is distinct from new.submitted_at
      or old.approved_by is distinct from new.approved_by
      or old.approved_at is distinct from new.approved_at
      or old.returned_by is distinct from new.returned_by
      or old.returned_at is distinct from new.returned_at
      or old.return_reason is distinct from new.return_reason
      or old.submitted_to_user_id is distinct from new.submitted_to_user_id
      or old.submitted_to_name is distinct from new.submitted_to_name
      or old.submitted_to_permission is distinct from new.submitted_to_permission
      or old.submission_note is distinct from new.submission_note
    )
  then
    raise exception 'Quantity Acceptance workflow fields must be changed through transition_project_quantity_acceptance_status.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_quantity_acceptance_direct_workflow_update on public.quantity_acceptances;
create trigger guard_quantity_acceptance_direct_workflow_update
  before insert or update on public.quantity_acceptances
  for each row execute function app_private.guard_quantity_acceptance_direct_workflow_update();

revoke all on function app_private.guard_payment_certificate_direct_workflow_update() from public, anon, authenticated;
revoke all on function app_private.guard_quantity_acceptance_direct_workflow_update() from public, anon, authenticated;

create or replace function public.transition_project_payment_certificate_status(
  p_certificate_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_reason text default null,
  p_target_user_id text default null,
  p_target_name text default null,
  p_target_permission text default null,
  p_submission_note text default null
)
returns public.payment_certificates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_certificate public.payment_certificates%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_previous_guard text;
  v_expected_target_permission text;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id then
    raise exception 'Không xác định được người dùng chuyển trạng thái chứng từ thanh toán.'
      using errcode = '42501';
  end if;

  select *
  into v_certificate
  from public.payment_certificates
  where id = p_certificate_id
  for update;

  if not found then
    raise exception 'Không tìm thấy chứng từ thanh toán.';
  end if;

  v_required_permission := case p_status
    when 'submitted' then 'project.payment.submit'
    when 'returned' then 'project.payment.verify'
    when 'approved' then 'project.payment.approve'
    when 'cancelled' then 'project.payment.approve'
    when 'paid' then 'project.payment.confirm'
    else null
  end;

  if v_required_permission is null then
    raise exception 'Trạng thái chứng từ thanh toán không hợp lệ: %', p_status
      using errcode = '23514';
  end if;

  if (p_status = 'submitted' and coalesce(v_certificate.status, 'draft') not in ('draft', 'returned'))
    or (p_status in ('returned', 'approved') and v_certificate.status is distinct from 'submitted')
    or (p_status = 'paid' and v_certificate.status is distinct from 'approved')
    or (p_status = 'cancelled' and coalesce(v_certificate.status, 'draft') not in ('approved', 'paid'))
  then
    raise exception 'Chuyển trạng thái chứng từ thanh toán không hợp lệ: % -> %.', v_certificate.status, p_status
      using errcode = '23514';
  end if;

  if p_status in ('returned', 'cancelled') and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Cần nêu lý do trả lại hoặc hủy chứng từ thanh toán.'
      using errcode = '23514';
  end if;

  if p_status in ('submitted', 'approved', 'paid')
    and coalesce(jsonb_array_length(v_certificate.items), 0) = 0
    and not exists (
      select 1
      from public.payment_certificate_items item_row
      where item_row.payment_certificate_id = p_certificate_id
    )
  then
    raise exception 'Chứng từ thanh toán chưa có hạng mục.'
      using errcode = '23514';
  end if;

  if p_status = 'approved' and v_certificate.acceptance_id is not null and not exists (
    select 1
    from public.quantity_acceptances acceptance_row
    where acceptance_row.id = v_certificate.acceptance_id
      and acceptance_row.status = 'approved'
  ) then
    raise exception 'Phải duyệt nghiệm thu liên kết trước khi duyệt chứng từ thanh toán.'
      using errcode = '23514';
  end if;

  if not public.is_admin()
    and v_certificate.submitted_to_user_id is not null
    and p_status in ('returned', 'approved', 'paid')
    and v_certificate.submitted_to_user_id <> v_user_id::text
  then
    raise exception 'Bạn không phải người đang được giao xử lý chứng từ thanh toán.'
      using errcode = '42501';
  end if;

  if not app_private.project_has_permission_v2(
    v_certificate.project_id::text,
    v_certificate.construction_site_id::text,
    v_required_permission,
    v_user_id
  ) then
    raise exception 'Bạn cần quyền % để chuyển trạng thái chứng từ thanh toán.', v_required_permission
      using errcode = '42501';
  end if;

  v_expected_target_permission := case p_status
    when 'submitted' then 'project.payment.approve'
    when 'approved' then 'project.payment.confirm'
    else null
  end;

  if v_expected_target_permission is not null then
    if nullif(p_target_user_id, '') is null or p_target_permission is distinct from v_expected_target_permission then
      raise exception 'Cần chọn người nhận có quyền %.', v_expected_target_permission
        using errcode = '23514';
    end if;
    if not app_private.project_has_permission_v2(
      v_certificate.project_id::text,
      v_certificate.construction_site_id::text,
      p_target_permission,
      p_target_user_id::uuid
    ) then
      raise exception 'Người được chọn chưa có quyền % trong phạm vi dự án.', p_target_permission
        using errcode = '42501';
    end if;
  end if;

  v_previous_guard := current_setting('app.project_document_transition_context', true);
  perform set_config('app.project_document_transition_context', 'on', true);

  update public.payment_certificates
  set
    status = p_status,
    submitted_by = case when p_status = 'submitted' then v_user_id::text else submitted_by end,
    submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
    returned_by = case when p_status = 'returned' then v_user_id::text else returned_by end,
    returned_at = case when p_status = 'returned' then now() else returned_at end,
    return_reason = case when p_status = 'returned' then p_reason else return_reason end,
    approved_by = case when p_status = 'approved' then v_user_id::text else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    paid_at = case when p_status = 'paid' then now() else paid_at end,
    submitted_to_user_id = case
      when p_status in ('submitted', 'approved') then p_target_user_id
      when p_status = 'returned' then v_certificate.submitted_by
      when p_status in ('paid', 'cancelled') then null
      else submitted_to_user_id
    end,
    submitted_to_name = case
      when p_status in ('submitted', 'approved') then p_target_name
      when p_status = 'returned' then null
      when p_status in ('paid', 'cancelled') then null
      else submitted_to_name
    end,
    submitted_to_permission = case
      when p_status in ('submitted', 'approved') then p_target_permission
      when p_status = 'returned' then 'edit'
      when p_status in ('paid', 'cancelled') then null
      else submitted_to_permission
    end,
    submission_note = case
      when p_status in ('submitted', 'approved') then p_submission_note
      when p_status in ('returned', 'paid', 'cancelled') then p_reason
      else submission_note
    end,
    updated_at = now()
  where id = p_certificate_id
  returning * into v_certificate;

  perform set_config('app.project_document_transition_context', coalesce(v_previous_guard, ''), true);
  return v_certificate;
end;
$$;

create or replace function public.transition_project_quantity_acceptance_status(
  p_acceptance_id uuid,
  p_status text,
  p_actor_user_id uuid,
  p_reason text default null,
  p_target_user_id text default null,
  p_target_name text default null,
  p_target_permission text default null,
  p_submission_note text default null
)
returns public.quantity_acceptances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acceptance public.quantity_acceptances%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_previous_guard text;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id then
    raise exception 'Không xác định được người dùng chuyển trạng thái nghiệm thu.'
      using errcode = '42501';
  end if;

  select *
  into v_acceptance
  from public.quantity_acceptances
  where id = p_acceptance_id
  for update;

  if not found then
    raise exception 'Không tìm thấy nghiệm thu.';
  end if;

  v_required_permission := case p_status
    when 'submitted' then 'project.quantity_acceptance.submit'
    when 'returned' then 'project.quantity_acceptance.verify'
    when 'approved' then 'project.quantity_acceptance.approve'
    when 'cancelled' then 'project.quantity_acceptance.approve'
    else null
  end;

  if v_required_permission is null then
    raise exception 'Trạng thái nghiệm thu không hợp lệ: %', p_status
      using errcode = '23514';
  end if;

  if (p_status = 'submitted' and coalesce(v_acceptance.status, 'draft') not in ('draft', 'returned'))
    or (p_status in ('returned', 'approved') and v_acceptance.status is distinct from 'submitted')
    or (p_status = 'cancelled' and v_acceptance.status is distinct from 'approved')
  then
    raise exception 'Chuyển trạng thái nghiệm thu không hợp lệ: % -> %.', v_acceptance.status, p_status
      using errcode = '23514';
  end if;

  if p_status in ('returned', 'cancelled') and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Cần nêu lý do trả lại hoặc hủy nghiệm thu.'
      using errcode = '23514';
  end if;

  if p_status in ('submitted', 'approved') and not exists (
    select 1
    from public.quantity_acceptance_items item_row
    where item_row.acceptance_id = p_acceptance_id
  ) then
    raise exception 'Nghiệm thu chưa có hạng mục.'
      using errcode = '23514';
  end if;

  if p_status = 'cancelled' and exists (
    select 1
    from public.payment_certificates certificate_row
    where certificate_row.acceptance_id = p_acceptance_id
  ) then
    raise exception 'Không thể hủy nghiệm thu vì đã có chứng từ thanh toán liên kết.'
      using errcode = '23514';
  end if;

  if not public.is_admin()
    and v_acceptance.submitted_to_user_id is not null
    and p_status in ('returned', 'approved')
    and v_acceptance.submitted_to_user_id <> v_user_id::text
  then
    raise exception 'Bạn không phải người đang được giao xử lý nghiệm thu.'
      using errcode = '42501';
  end if;

  if not app_private.project_has_permission_v2(
    v_acceptance.project_id::text,
    v_acceptance.construction_site_id::text,
    v_required_permission,
    v_user_id
  ) then
    raise exception 'Bạn cần quyền % để chuyển trạng thái nghiệm thu.', v_required_permission
      using errcode = '42501';
  end if;

  if p_status = 'submitted' then
    if nullif(p_target_user_id, '') is null or p_target_permission is distinct from 'project.quantity_acceptance.approve' then
      raise exception 'Cần chọn người nhận có quyền project.quantity_acceptance.approve.'
        using errcode = '23514';
    end if;
    if not app_private.project_has_permission_v2(
      v_acceptance.project_id::text,
      v_acceptance.construction_site_id::text,
      p_target_permission,
      p_target_user_id::uuid
    ) then
      raise exception 'Người được chọn chưa có quyền % trong phạm vi dự án.', p_target_permission
        using errcode = '42501';
    end if;
  end if;

  v_previous_guard := current_setting('app.project_document_transition_context', true);
  perform set_config('app.project_document_transition_context', 'on', true);

  update public.quantity_acceptances
  set
    status = p_status,
    submitted_by = case when p_status = 'submitted' then v_user_id::text else submitted_by end,
    submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
    returned_by = case when p_status = 'returned' then v_user_id::text else returned_by end,
    returned_at = case when p_status = 'returned' then now() else returned_at end,
    return_reason = case when p_status = 'returned' then p_reason else return_reason end,
    approved_by = case when p_status = 'approved' then v_user_id::text else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    submitted_to_user_id = case
      when p_status = 'submitted' then p_target_user_id
      when p_status = 'returned' then v_acceptance.submitted_by
      when p_status in ('approved', 'cancelled') then null
      else submitted_to_user_id
    end,
    submitted_to_name = case
      when p_status = 'submitted' then p_target_name
      when p_status = 'returned' then null
      when p_status in ('approved', 'cancelled') then null
      else submitted_to_name
    end,
    submitted_to_permission = case
      when p_status = 'submitted' then p_target_permission
      when p_status = 'returned' then 'edit'
      when p_status in ('approved', 'cancelled') then null
      else submitted_to_permission
    end,
    submission_note = case
      when p_status = 'submitted' then p_submission_note
      when p_status in ('returned', 'cancelled') then p_reason
      else submission_note
    end,
    updated_at = now()
  where id = p_acceptance_id
  returning * into v_acceptance;

  perform set_config('app.project_document_transition_context', coalesce(v_previous_guard, ''), true);
  return v_acceptance;
end;
$$;

revoke all on function public.transition_project_payment_certificate_status(uuid, text, uuid, text, text, text, text, text) from public;
revoke all on function public.transition_project_payment_certificate_status(uuid, text, uuid, text, text, text, text, text) from anon;
grant execute on function public.transition_project_payment_certificate_status(uuid, text, uuid, text, text, text, text, text) to authenticated;

revoke all on function public.transition_project_quantity_acceptance_status(uuid, text, uuid, text, text, text, text, text) from public;
revoke all on function public.transition_project_quantity_acceptance_status(uuid, text, uuid, text, text, text, text, text) from anon;
grant execute on function public.transition_project_quantity_acceptance_status(uuid, text, uuid, text, text, text, text, text) to authenticated;
