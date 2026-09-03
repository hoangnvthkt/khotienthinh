-- Existing document services write their workflow status directly. These
-- BEFORE UPDATE triggers make Room membership an additional server-side gate,
-- including calls that bypass the React recipient picker.

create or replace function app_private.enforce_daily_log_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_target_action text;
begin
  if new.status is not distinct from old.status
    and new.submitted_to_user_id is not distinct from old.submitted_to_user_id
    and new.submitted_to_permission is not distinct from old.submitted_to_permission then
    return new;
  end if;

  if new.status is not distinct from old.status and new.status = 'submitted' then
    v_action := 'submit';
    v_target_action := case when new.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  elsif new.status = 'submitted' then
    v_action := 'submit';
    v_target_action := case when new.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  elsif new.status = 'verified' then
    v_action := case when old.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  elsif new.status = 'rejected' then
    v_action := case when old.submitted_to_permission = 'approve' then 'approve' else 'verify' end;
  else
    return new;
  end if;

  perform app_private.assert_project_permission_room_action(
    new.project_id::text, new.construction_site_id::text, 'daily_log', v_action
  );

  if new.status = 'submitted' and nullif(new.submitted_to_user_id, '') is not null then
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'daily_log', v_target_action,
      new.submitted_to_user_id::uuid
    );
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_quality_checklist_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_action := case
    when new.status = 'submitted' then 'submit'
    when new.status in ('approved', 'returned', 'cancelled') then 'approve'
    else null
  end;
  if v_action is null then return new; end if;
  perform app_private.assert_project_permission_room_action(
    new.project_id::text, new.construction_site_id::text, 'quality', v_action
  );
  if new.status = 'submitted' then
    if nullif(new.submitted_to_user_id, '') is null then
      raise exception 'Vui lòng chọn người duyệt hồ sơ chất lượng trong Room.' using errcode = '42501';
    end if;
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'quality', 'approve', new.submitted_to_user_id::uuid
    );
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_quantity_acceptance_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_action := case
    when new.status = 'submitted' then 'submit'
    when new.status in ('approved', 'returned', 'cancelled') then 'approve'
    else null
  end;
  if v_action is null then return new; end if;
  perform app_private.assert_project_permission_room_action(
    new.project_id::text, new.construction_site_id::text, 'quantity_acceptance', v_action
  );
  if new.status = 'submitted' then
    if nullif(new.submitted_to_user_id, '') is null then
      raise exception 'Vui lòng chọn người duyệt nghiệm thu trong Room.' using errcode = '42501';
    end if;
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'quantity_acceptance', 'approve', new.submitted_to_user_id::uuid
    );
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_payment_certificate_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_target_action text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_action := case
    when new.status = 'submitted' then 'submit'
    when new.status in ('approved', 'returned', 'cancelled') then 'approve'
    when new.status = 'paid' then 'confirm'
    else null
  end;
  if v_action is null then return new; end if;
  perform app_private.assert_project_permission_room_action(
    new.project_id::text, new.construction_site_id::text, 'payment', v_action
  );
  if new.status in ('submitted', 'approved') and nullif(new.submitted_to_user_id, '') is not null then
    v_target_action := case when new.status = 'approved' then 'confirm' else 'approve' end;
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'payment', v_target_action, new.submitted_to_user_id::uuid
    );
  elsif new.status = 'submitted' then
    raise exception 'Vui lòng chọn người duyệt chứng từ thanh toán trong Room.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_contract_variation_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_action := case
    when new.status = 'submitted' then 'submit'
    when new.status in ('approved', 'rejected', 'cancelled') then 'approve'
    else null
  end;
  if v_action is null then return new; end if;
  perform app_private.assert_project_permission_room_action(
    new.project_id::text, new.construction_site_id::text, 'boq_reconciliation', v_action
  );
  if new.status = 'submitted' then
    if nullif(new.submitted_to_user_id, '') is null then
      raise exception 'Vui lòng chọn người duyệt phát sinh trong Room.' using errcode = '42501';
    end if;
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'boq_reconciliation', 'approve', new.submitted_to_user_id::uuid
    );
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_boq_reconciliation_room_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status is not distinct from old.status then return new; end if;
  v_action := case
    when new.status = 'submitted' then 'submit'
    when new.status = 'reviewed' then 'verify'
    when new.status = 'locked' then 'approve'
    else null
  end;
  if v_action is null then return new; end if;
  perform app_private.assert_project_permission_room_action(
    new.project_id::text, new.construction_site_id::text, 'boq_reconciliation', v_action
  );
  if new.status = 'submitted' then
    if nullif(new.submitted_to_user_id, '') is null then
      raise exception 'Vui lòng chọn người rà soát BOQ trong Room.' using errcode = '42501';
    end if;
    perform app_private.assert_project_permission_room_action(
      new.project_id::text, new.construction_site_id::text, 'boq_reconciliation', 'verify', new.submitted_to_user_id::uuid
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_daily_log_room_status on public.daily_logs;
create trigger trg_enforce_daily_log_room_status
  before update of status, submitted_to_user_id, submitted_to_permission on public.daily_logs
  for each row execute function app_private.enforce_daily_log_room_status();

drop trigger if exists trg_enforce_quality_checklist_room_status on public.quality_checklists;
create trigger trg_enforce_quality_checklist_room_status
  before update of status on public.quality_checklists
  for each row execute function app_private.enforce_quality_checklist_room_status();

drop trigger if exists trg_enforce_quantity_acceptance_room_status on public.quantity_acceptances;
create trigger trg_enforce_quantity_acceptance_room_status
  before update of status on public.quantity_acceptances
  for each row execute function app_private.enforce_quantity_acceptance_room_status();

drop trigger if exists trg_enforce_payment_certificate_room_status on public.payment_certificates;
create trigger trg_enforce_payment_certificate_room_status
  before update of status on public.payment_certificates
  for each row execute function app_private.enforce_payment_certificate_room_status();

drop trigger if exists trg_enforce_contract_variation_room_status on public.contract_variations;
create trigger trg_enforce_contract_variation_room_status
  before update of status on public.contract_variations
  for each row execute function app_private.enforce_contract_variation_room_status();

drop trigger if exists trg_enforce_boq_reconciliation_room_status on public.boq_reconciliation_groups;
create trigger trg_enforce_boq_reconciliation_room_status
  before update of status on public.boq_reconciliation_groups
  for each row execute function app_private.enforce_boq_reconciliation_room_status();
