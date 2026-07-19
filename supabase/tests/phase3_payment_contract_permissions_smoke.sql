-- Phase 3 Payment, quantity, and contract permission smoke.
-- Run only after the payment/quantity transition migration, inside a rollback-only session.

begin;

do $$
declare
  required_codes text[] := array[
    'project.payment.view',
    'project.payment.create',
    'project.payment.verify',
    'project.payment.confirm',
    'project.payment.approve',
    'project.payment.mark_paid',
    'project.quantity_acceptance.view',
    'project.quantity_acceptance.create',
    'project.quantity_acceptance.verify',
    'project.quantity_acceptance.approve',
    'project.contract.view',
    'project.contract.create',
    'project.contract.approve',
    'project.contract_item.view',
    'project.contract_item.edit',
    'project.contract_variation.create',
    'project.contract_variation.submit',
    'project.contract_variation.verify',
    'project.contract_variation.approve'
  ];
  v_permission_code text;
begin
  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 3 Payment/Contract permission action: %', v_permission_code;
    end if;
  end loop;

  if exists (
    select 1
    from public.permission_actions pa
    where pa.permission_code in ('project.payment.verify', 'project.payment.mark_paid')
    group by pa.module_code
    having count(distinct pa.action) <> 2
  ) then
    raise exception 'Payment verify and mark_paid are not distinct actions';
  end if;

  if to_regprocedure('public.transition_project_payment_certificate_status(uuid,text,uuid,text,text,text,text,text)') is null then
    raise exception 'Missing transition_project_payment_certificate_status RPC';
  end if;
  if to_regprocedure('public.transition_project_quantity_acceptance_status(uuid,text,uuid,text,text,text,text,text)') is null then
    raise exception 'Missing transition_project_quantity_acceptance_status RPC';
  end if;
end $$;

create temp table phase3_payment_quantity_smoke_ids (
  project_id text not null,
  wrong_project_id text not null,
  site_id uuid not null,
  payment_contract_id uuid not null,
  quantity_contract_id uuid not null,
  contract_item_id uuid not null,
  payment_return_id uuid not null,
  payment_main_id uuid not null,
  payment_draft_id uuid not null,
  payment_wrong_scope_id uuid not null,
  payment_verify_adjacent_id uuid not null,
  payment_verify_wrong_scope_id uuid not null,
  payment_confirm_wrong_scope_id uuid not null,
  quantity_return_id uuid not null,
  quantity_main_id uuid not null,
  quantity_draft_id uuid not null,
  quantity_wrong_scope_id uuid not null,
  quantity_verify_adjacent_id uuid not null,
  quantity_verify_wrong_scope_id uuid not null,
  payment_creator_id uuid not null,
  payment_verifier_id uuid not null,
  payment_approver_id uuid not null,
  payment_confirmer_id uuid not null,
  quantity_creator_id uuid not null,
  quantity_verifier_id uuid not null,
  quantity_approver_id uuid not null
) on commit drop;

grant select on table phase3_payment_quantity_smoke_ids to authenticated;

insert into phase3_payment_quantity_smoke_ids
values (
  'phase3-payment-quantity-' || gen_random_uuid()::text,
  'phase3-payment-quantity-wrong-' || gen_random_uuid()::text,
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

insert into public.users (id, name, email, username, role, is_active, allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules)
select user_id, label, user_id::text || '@vioo.local', label, 'EMPLOYEE'::public.user_role, true,
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase3_payment_quantity_smoke_ids s
cross join lateral (
  values
    (s.payment_creator_id, 'phase3-payment-creator'),
    (s.payment_verifier_id, 'phase3-payment-verifier'),
    (s.payment_approver_id, 'phase3-payment-approver'),
    (s.payment_confirmer_id, 'phase3-payment-confirmer'),
    (s.quantity_creator_id, 'phase3-quantity-creator'),
    (s.quantity_verifier_id, 'phase3-quantity-verifier'),
    (s.quantity_approver_id, 'phase3-quantity-approver')
) as fixture(user_id, label);

insert into public.projects (id, code, name, source)
select project_id, 'P3-PQ-' || left(project_id, 12), 'Phase 3 Payment Quantity Smoke', 'manual'
from phase3_payment_quantity_smoke_ids
union all
select wrong_project_id, 'P3-PQ-W-' || left(wrong_project_id, 10), 'Phase 3 Payment Quantity Wrong Scope', 'manual'
from phase3_payment_quantity_smoke_ids;

insert into public.user_permission_grants (user_id, permission_code, scope_type, scope_id, is_active)
select payment_creator_id, 'project.payment.submit', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_creator_id, 'project.payment.submit', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_verifier_id, 'project.payment.verify', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_verifier_id, 'project.payment.approve', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_verifier_id, 'project.payment.approve', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_approver_id, 'project.payment.approve', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_approver_id, 'project.payment.approve', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_confirmer_id, 'project.payment.confirm', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select payment_confirmer_id, 'project.payment.confirm', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_creator_id, 'project.quantity_acceptance.submit', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_creator_id, 'project.quantity_acceptance.submit', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_verifier_id, 'project.quantity_acceptance.verify', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_verifier_id, 'project.quantity_acceptance.approve', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_verifier_id, 'project.quantity_acceptance.approve', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_approver_id, 'project.quantity_acceptance.approve', 'project', project_id, true from phase3_payment_quantity_smoke_ids
union all select quantity_approver_id, 'project.quantity_acceptance.approve', 'project', wrong_project_id, true from phase3_payment_quantity_smoke_ids;

insert into public.contract_items (
  id, contract_id, contract_type, project_id, construction_site_id,
  code, name, unit, quantity, unit_price, total_price
)
select contract_item_id, quantity_contract_id, 'customer', project_id, site_id,
       'P3-PQ-ITEM', 'Phase 3 Payment Quantity Item', 'item', 1, 100, 100
from phase3_payment_quantity_smoke_ids;

insert into public.payment_certificates (
  id, contract_id, contract_type, project_id, construction_site_id,
  period_number, period_start, period_end, items, status
)
select payment_return_id, payment_contract_id, 'customer', project_id, site_id,
       1, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-return')), 'draft'
from phase3_payment_quantity_smoke_ids
union all
select payment_main_id, payment_contract_id, 'customer', project_id, site_id,
       2, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-main')), 'draft'
from phase3_payment_quantity_smoke_ids
union all
select payment_draft_id, payment_contract_id, 'customer', project_id, site_id,
       3, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-draft')), 'draft'
from phase3_payment_quantity_smoke_ids
union all
select payment_wrong_scope_id, payment_contract_id, 'customer', wrong_project_id, site_id,
       4, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-wrong-scope')), 'draft'
from phase3_payment_quantity_smoke_ids
union all
select payment_verify_adjacent_id, payment_contract_id, 'customer', project_id, site_id,
       5, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-verify-adjacent')), 'draft'
from phase3_payment_quantity_smoke_ids
union all
select payment_verify_wrong_scope_id, payment_contract_id, 'customer', wrong_project_id, site_id,
       6, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-verify-wrong-scope')), 'draft'
from phase3_payment_quantity_smoke_ids
union all
select payment_confirm_wrong_scope_id, payment_contract_id, 'customer', wrong_project_id, site_id,
       7, current_date, current_date, jsonb_build_array(jsonb_build_object('fixture', 'payment-confirm-wrong-scope')), 'draft'
from phase3_payment_quantity_smoke_ids;

insert into public.quantity_acceptances (
  id, contract_id, contract_type, project_id, construction_site_id,
  period_number, period_start, period_end, status
)
select quantity_return_id, quantity_contract_id, 'customer', project_id, site_id,
       1, current_date, current_date, 'draft'
from phase3_payment_quantity_smoke_ids
union all
select quantity_main_id, quantity_contract_id, 'customer', project_id, site_id,
       2, current_date, current_date, 'draft'
from phase3_payment_quantity_smoke_ids
union all
select quantity_draft_id, quantity_contract_id, 'customer', project_id, site_id,
       3, current_date, current_date, 'draft'
from phase3_payment_quantity_smoke_ids
union all
select quantity_wrong_scope_id, quantity_contract_id, 'customer', wrong_project_id, site_id,
       4, current_date, current_date, 'draft'
from phase3_payment_quantity_smoke_ids
union all
select quantity_verify_adjacent_id, quantity_contract_id, 'customer', project_id, site_id,
       5, current_date, current_date, 'draft'
from phase3_payment_quantity_smoke_ids
union all
select quantity_verify_wrong_scope_id, quantity_contract_id, 'customer', wrong_project_id, site_id,
       6, current_date, current_date, 'draft'
from phase3_payment_quantity_smoke_ids;

insert into public.quantity_acceptance_items (
  acceptance_id, contract_item_id, contract_item_code, contract_item_name, unit,
  previous_accepted_quantity, proposed_quantity, accepted_quantity,
  cumulative_accepted_quantity, unit_price, accepted_amount
)
select acceptance_id, s.contract_item_id, 'P3-PQ-ITEM', 'Phase 3 Payment Quantity Item', 'item',
       0, 1, 1, 1, 100, 100
from phase3_payment_quantity_smoke_ids s
cross join lateral (
  values
    (s.quantity_return_id),
    (s.quantity_main_id),
    (s.quantity_draft_id),
    (s.quantity_wrong_scope_id),
    (s.quantity_verify_adjacent_id),
    (s.quantity_verify_wrong_scope_id)
) as fixture(acceptance_id);

-- Run the direct-write guard as the owner so RLS cannot mask a missing trigger.
do $$
declare
  v_blocked boolean := false;
begin
  begin
    update public.payment_certificates
    set status = 'submitted'
    where id = (select payment_draft_id from phase3_payment_quantity_smoke_ids);
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Direct Payment Certificate workflow update was not blocked';
  end if;

  v_blocked := false;
  begin
    update public.quantity_acceptances
    set status = 'submitted'
    where id = (select quantity_draft_id from phase3_payment_quantity_smoke_ids);
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Direct Quantity Acceptance workflow update was not blocked';
  end if;
end $$;

set role authenticated;

create or replace function pg_temp.phase3_payment_quantity_smoke_set_user(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.email', p_user_id::text || '@vioo.local', true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'email', p_user_id::text || '@vioo.local', 'sub', p_user_id::text)::text,
    true
  );
end;
$$;

do $$
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_creator_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_payment_certificate_status(
    (select payment_return_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select payment_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_verifier_id::text from phase3_payment_quantity_smoke_ids),
    'Payment verifier',
    'project.payment.approve',
    'Payment return fixture'
  );

  perform public.transition_project_payment_certificate_status(
    (select payment_main_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select payment_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_approver_id::text from phase3_payment_quantity_smoke_ids),
    'Payment approver',
    'project.payment.approve',
    'Payment approval fixture'
  );

  perform public.transition_project_payment_certificate_status(
    (select payment_wrong_scope_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select payment_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_approver_id::text from phase3_payment_quantity_smoke_ids),
    'Payment wrong-scope approver',
    'project.payment.approve',
    'Payment wrong-scope fixture'
  );

  perform public.transition_project_payment_certificate_status(
    (select payment_verify_adjacent_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select payment_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_verifier_id::text from phase3_payment_quantity_smoke_ids),
    'Payment verifier',
    'project.payment.approve',
    'Payment verify adjacent fixture'
  );

  perform public.transition_project_payment_certificate_status(
    (select payment_verify_wrong_scope_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select payment_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_verifier_id::text from phase3_payment_quantity_smoke_ids),
    'Payment verifier',
    'project.payment.approve',
    'Payment verify wrong-scope fixture'
  );

  perform public.transition_project_payment_certificate_status(
    (select payment_confirm_wrong_scope_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select payment_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_approver_id::text from phase3_payment_quantity_smoke_ids),
    'Payment approver',
    'project.payment.approve',
    'Payment confirm wrong-scope fixture'
  );
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_creator_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_main_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select payment_creator_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.submit incorrectly allowed approval';
  end if;
end $$;

do $$
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_verifier_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_payment_certificate_status(
    (select payment_return_id from phase3_payment_quantity_smoke_ids),
    'returned',
    (select payment_verifier_id from phase3_payment_quantity_smoke_ids),
    'Payment verification return',
    null, null, null, null
  );
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_verifier_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_draft_id from phase3_payment_quantity_smoke_ids),
      'returned',
      (select payment_verifier_id from phase3_payment_quantity_smoke_ids),
      'Invalid payment verification state',
      null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.verify incorrectly bypassed draft state';
  end if;
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_approver_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_payment_certificate_status(
    (select payment_main_id from phase3_payment_quantity_smoke_ids),
    'approved',
    (select payment_approver_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_confirmer_id::text from phase3_payment_quantity_smoke_ids),
    'Payment confirmer',
    'project.payment.confirm',
    'Payment confirmation fixture'
  );

  perform public.transition_project_payment_certificate_status(
    (select payment_confirm_wrong_scope_id from phase3_payment_quantity_smoke_ids),
    'approved',
    (select payment_approver_id from phase3_payment_quantity_smoke_ids),
    null,
    (select payment_confirmer_id::text from phase3_payment_quantity_smoke_ids),
    'Payment confirmer',
    'project.payment.confirm',
    'Payment confirm wrong-scope approval fixture'
  );

  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_main_id from phase3_payment_quantity_smoke_ids),
      'paid',
      (select payment_approver_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.approve incorrectly allowed payment confirmation';
  end if;

  v_blocked := false;
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_draft_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select payment_approver_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.approve incorrectly bypassed draft state';
  end if;
end $$;

do $$
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_confirmer_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_payment_certificate_status(
    (select payment_main_id from phase3_payment_quantity_smoke_ids),
    'paid',
    (select payment_confirmer_id from phase3_payment_quantity_smoke_ids),
    null, null, null, null, null
  );
end $$;

reset role;

delete from public.user_permission_grants
where user_id = (select payment_approver_id from phase3_payment_quantity_smoke_ids)
  and permission_code = 'project.payment.approve'
  and scope_type = 'project'
  and scope_id = (select wrong_project_id from phase3_payment_quantity_smoke_ids);

delete from public.user_permission_grants
where user_id = (select payment_verifier_id from phase3_payment_quantity_smoke_ids)
  and permission_code = 'project.payment.approve'
  and scope_type = 'project'
  and scope_id = (select project_id from phase3_payment_quantity_smoke_ids);

delete from public.user_permission_grants
where user_id = (select payment_confirmer_id from phase3_payment_quantity_smoke_ids)
  and permission_code = 'project.payment.confirm'
  and scope_type = 'project'
  and scope_id = (select wrong_project_id from phase3_payment_quantity_smoke_ids);

set role authenticated;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_verifier_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_verify_adjacent_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select payment_verifier_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.verify incorrectly allowed approval';
  end if;

  v_blocked := false;
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_verify_wrong_scope_id from phase3_payment_quantity_smoke_ids),
      'returned',
      (select payment_verifier_id from phase3_payment_quantity_smoke_ids),
      'Wrong scope payment verification',
      null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.verify incorrectly crossed project scope';
  end if;
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_confirmer_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_draft_id from phase3_payment_quantity_smoke_ids),
      'paid',
      (select payment_confirmer_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.confirm incorrectly bypassed draft state';
  end if;

  v_blocked := false;
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_confirm_wrong_scope_id from phase3_payment_quantity_smoke_ids),
      'paid',
      (select payment_confirmer_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.confirm incorrectly crossed project scope';
  end if;
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select payment_approver_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_payment_certificate_status(
      (select payment_wrong_scope_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select payment_approver_id from phase3_payment_quantity_smoke_ids),
      null,
      (select payment_confirmer_id::text from phase3_payment_quantity_smoke_ids),
      'Payment confirmer',
      'project.payment.confirm',
      'Wrong scope payment fixture'
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.payment.approve incorrectly crossed project scope';
  end if;
end $$;

do $$
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_quantity_acceptance_status(
    (select quantity_return_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select quantity_verifier_id::text from phase3_payment_quantity_smoke_ids),
    'Quantity verifier',
    'project.quantity_acceptance.approve',
    'Quantity return fixture'
  );

  perform public.transition_project_quantity_acceptance_status(
    (select quantity_main_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select quantity_approver_id::text from phase3_payment_quantity_smoke_ids),
    'Quantity approver',
    'project.quantity_acceptance.approve',
    'Quantity approval fixture'
  );

  perform public.transition_project_quantity_acceptance_status(
    (select quantity_wrong_scope_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select quantity_approver_id::text from phase3_payment_quantity_smoke_ids),
    'Quantity wrong-scope approver',
    'project.quantity_acceptance.approve',
    'Quantity wrong-scope fixture'
  );

  perform public.transition_project_quantity_acceptance_status(
    (select quantity_verify_adjacent_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select quantity_verifier_id::text from phase3_payment_quantity_smoke_ids),
    'Quantity verifier',
    'project.quantity_acceptance.approve',
    'Quantity verify adjacent fixture'
  );

  perform public.transition_project_quantity_acceptance_status(
    (select quantity_verify_wrong_scope_id from phase3_payment_quantity_smoke_ids),
    'submitted',
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids),
    null,
    (select quantity_verifier_id::text from phase3_payment_quantity_smoke_ids),
    'Quantity verifier',
    'project.quantity_acceptance.approve',
    'Quantity verify wrong-scope fixture'
  );
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_creator_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_quantity_acceptance_status(
      (select quantity_main_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select quantity_creator_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.quantity_acceptance.submit incorrectly allowed approval';
  end if;
end $$;

do $$
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_verifier_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_quantity_acceptance_status(
    (select quantity_return_id from phase3_payment_quantity_smoke_ids),
    'returned',
    (select quantity_verifier_id from phase3_payment_quantity_smoke_ids),
    'Quantity verification return',
    null, null, null, null
  );
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_verifier_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_quantity_acceptance_status(
      (select quantity_draft_id from phase3_payment_quantity_smoke_ids),
      'returned',
      (select quantity_verifier_id from phase3_payment_quantity_smoke_ids),
      'Invalid quantity verification state',
      null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.quantity_acceptance.verify incorrectly bypassed draft state';
  end if;
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_approver_id from phase3_payment_quantity_smoke_ids)
  );
  perform public.transition_project_quantity_acceptance_status(
    (select quantity_main_id from phase3_payment_quantity_smoke_ids),
    'approved',
    (select quantity_approver_id from phase3_payment_quantity_smoke_ids),
    null, null, null, null, null
  );

  begin
    perform public.transition_project_quantity_acceptance_status(
      (select quantity_draft_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select quantity_approver_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.quantity_acceptance.approve incorrectly bypassed draft state';
  end if;
end $$;

reset role;

delete from public.user_permission_grants
where user_id = (select quantity_approver_id from phase3_payment_quantity_smoke_ids)
  and permission_code = 'project.quantity_acceptance.approve'
  and scope_type = 'project'
  and scope_id = (select wrong_project_id from phase3_payment_quantity_smoke_ids);

delete from public.user_permission_grants
where user_id = (select quantity_verifier_id from phase3_payment_quantity_smoke_ids)
  and permission_code = 'project.quantity_acceptance.approve'
  and scope_type = 'project'
  and scope_id = (select project_id from phase3_payment_quantity_smoke_ids);

set role authenticated;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_verifier_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_quantity_acceptance_status(
      (select quantity_verify_adjacent_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select quantity_verifier_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.quantity_acceptance.verify incorrectly allowed approval';
  end if;

  v_blocked := false;
  begin
    perform public.transition_project_quantity_acceptance_status(
      (select quantity_verify_wrong_scope_id from phase3_payment_quantity_smoke_ids),
      'returned',
      (select quantity_verifier_id from phase3_payment_quantity_smoke_ids),
      'Wrong scope quantity verification',
      null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.quantity_acceptance.verify incorrectly crossed project scope';
  end if;
end $$;

do $$
declare
  v_blocked boolean := false;
begin
  perform pg_temp.phase3_payment_quantity_smoke_set_user(
    (select quantity_approver_id from phase3_payment_quantity_smoke_ids)
  );
  begin
    perform public.transition_project_quantity_acceptance_status(
      (select quantity_wrong_scope_id from phase3_payment_quantity_smoke_ids),
      'approved',
      (select quantity_approver_id from phase3_payment_quantity_smoke_ids),
      null, null, null, null, null
    );
  exception
    when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'project.quantity_acceptance.approve incorrectly crossed project scope';
  end if;
end $$;

select 'phase02_task3_payment_quantity_readiness_smoke_passed' as checkpoint;

rollback;
