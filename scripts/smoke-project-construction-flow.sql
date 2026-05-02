-- Smoke test for the construction project workflow.
-- Run with: npm run smoke:project
--
-- The script exercises the remote Supabase schema inside a transaction and
-- rolls everything back. It verifies that new data can follow the intended
-- flow:
-- BOQ -> WBS link -> verified daily log -> approved acceptance -> payment
-- certificate -> advance recovery/retention -> locked BOQ snapshot.

BEGIN;

SET LOCAL search_path = public;

CREATE TEMP TABLE _project_smoke_result (
  check_order integer PRIMARY KEY,
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

DO $$
DECLARE
  v_site_id uuid := gen_random_uuid();
  v_site_text text := v_site_id::text;
  v_project_id text := 'smoke-project-' || replace(gen_random_uuid()::text, '-', '');
  v_no_site_project_id text := 'smoke-project-nosite-' || replace(gen_random_uuid()::text, '-', '');
  v_project_staff_id uuid;
  v_smoke_user_id uuid := gen_random_uuid();
  v_smoke_position_id uuid := gen_random_uuid();
  v_contract_id uuid := gen_random_uuid();
  v_task_id text := 'smoke-task-' || replace(gen_random_uuid()::text, '-', '');
  v_daily_log_id text := 'smoke-log-' || replace(gen_random_uuid()::text, '-', '');
  v_contract_item_id uuid;
  v_daily_log_volume_id uuid;
  v_acceptance_id uuid;
  v_acceptance_item_id uuid;
  v_payment_id uuid;
  v_advance_id uuid;
  v_variation_id uuid;
  v_contract_qty numeric := 1000;
  v_variation_qty numeric := 100;
  v_revised_qty numeric := 1100;
  v_unit_price numeric := 450000000;
  v_current_qty numeric := 120;
  v_gross numeric := 54000000000;
  v_retention numeric := 2700000000;
  v_advance_recovery numeric := 16200000000;
  v_payable numeric := 35100000000;
  v_advance_remaining numeric := 33800000000;
BEGIN
  INSERT INTO hrm_construction_sites (id, name)
  VALUES (v_site_id, 'Smoke HRM construction site');

  INSERT INTO hrm_positions (id, name, level)
  VALUES (v_smoke_position_id, 'Smoke project position', 99);

  INSERT INTO projects (
    id,
    code,
    name,
    status,
    construction_site_id,
    source
  )
  VALUES
    (v_project_id, 'SMOKE-LINKED-' || substr(replace(v_project_id, '-', ''), 1, 8), 'Smoke linked project', 'active', v_site_id, 'manual'),
    (v_no_site_project_id, 'SMOKE-NOSITE-' || substr(replace(v_no_site_project_id, '-', ''), 1, 8), 'Smoke project without site', 'planning', NULL, 'manual');

  INSERT INTO project_staff (
    project_id,
    construction_site_id,
    user_id,
    position_id,
    start_date,
    note
  )
  VALUES (
    v_no_site_project_id,
    NULL,
    v_smoke_user_id,
    v_smoke_position_id,
    '2026-05-01',
    'Smoke staff assigned before HRM site link'
  )
  RETURNING id INTO v_project_staff_id;

  IF NOT EXISTS (
    SELECT 1
    FROM projects p
    JOIN project_staff ps ON ps.project_id = p.id
    WHERE p.id = v_no_site_project_id
      AND p.construction_site_id IS NULL
      AND ps.id = v_project_staff_id
      AND ps.construction_site_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Project master or project-level staff setup failed';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (5, 'project_master_optional_site', 'PASS', 'Project can be created without HRM site and staff can be assigned by project_id.');

  INSERT INTO contract_items (
    contract_id,
    contract_type,
    construction_site_id,
    code,
    name,
    unit,
    quantity,
    unit_price,
    total_price,
    original_quantity,
    original_unit_price,
    original_total_price,
    revised_quantity,
    revised_total_price
  )
  VALUES (
    v_contract_id,
    'customer',
    v_site_id,
    'RICO-BOQ-001',
    'Concrete structure package',
    'm3',
    v_contract_qty,
    v_unit_price,
    v_contract_qty * v_unit_price,
    v_contract_qty,
    v_unit_price,
    v_contract_qty * v_unit_price,
    v_contract_qty,
    v_contract_qty * v_unit_price
  )
  RETURNING id INTO v_contract_item_id;

  INSERT INTO project_tasks (
    id,
    construction_site_id,
    name,
    start_date,
    end_date,
    duration,
    progress,
    dependencies,
    sort_order,
    progress_mode,
    baseline_version,
    baseline_change_reason
  )
  VALUES (
    v_task_id,
    v_site_text,
    'RICO smoke WBS task',
    '2026-05-01',
    '2026-05-20',
    20,
    0,
    '[{"taskId":"gate-design","requiresGateApproval":true}]'::jsonb,
    1,
    'derived_from_acceptance',
    'baseline-0',
    'Original baseline'
  );

  INSERT INTO task_contract_items (
    task_id,
    contract_item_id,
    construction_site_id,
    weight_percent,
    note
  )
  VALUES (
    v_task_id,
    v_contract_item_id,
    v_site_text,
    100,
    'Smoke WBS-to-BOQ link'
  );

  IF EXISTS (
    SELECT 1
    FROM project_tasks
    WHERE id = v_task_id
      AND (
        code IS NOT NULL
        OR quantity IS NOT NULL
        OR unit IS NOT NULL
        OR unit_price IS NOT NULL
        OR total_price IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'WBS task wrote legacy BOQ commercial fields';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (10, 'wbs_boq_separation', 'PASS', 'Task uses task_contract_items and leaves legacy BOQ fields empty.');

  INSERT INTO contract_variations (
    contract_id,
    contract_type,
    construction_site_id,
    code,
    title,
    status,
    reason,
    total_amount_delta,
    submitted_by,
    submitted_at,
    approved_by,
    approved_at
  )
  VALUES (
    v_contract_id,
    'customer',
    v_site_id,
    'RICO-VO-001',
    'Additional concrete volume',
    'approved',
    'Owner-approved scope increase',
    v_variation_qty * v_unit_price,
    'smoke.qs',
    now(),
    'smoke.pm',
    now()
  )
  RETURNING id INTO v_variation_id;

  INSERT INTO contract_variation_items (
    variation_id,
    contract_item_id,
    code,
    name,
    unit,
    quantity_delta,
    unit_price,
    amount_delta,
    note
  )
  VALUES (
    v_variation_id,
    v_contract_item_id,
    'RICO-BOQ-001-VO',
    'Additional concrete volume',
    'm3',
    v_variation_qty,
    v_unit_price,
    v_variation_qty * v_unit_price,
    'Smoke approved variation item'
  );

  UPDATE contract_items
  SET
    variation_quantity = v_variation_qty,
    variation_amount = v_variation_qty * v_unit_price,
    revised_quantity = v_revised_qty,
    revised_total_price = v_revised_qty * v_unit_price
  WHERE id = v_contract_item_id;

  IF NOT EXISTS (
    SELECT 1
    FROM contract_items
    WHERE id = v_contract_item_id
      AND revised_quantity = v_revised_qty
      AND revised_total_price = v_revised_qty * v_unit_price
  ) THEN
    RAISE EXCEPTION 'Approved variation did not update revised BOQ values';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (20, 'approved_variation_revises_boq', 'PASS', 'Approved VO changes revised quantity/value without overwriting original quantity/value.');

  INSERT INTO daily_logs (
    id,
    construction_site_id,
    date,
    weather,
    worker_count,
    description,
    issues,
    photos,
    created_by,
    verified,
    status,
    submitted_by,
    submitted_at,
    verified_by,
    verified_at
  )
  VALUES (
    v_daily_log_id,
    v_site_text,
    '2026-05-05',
    'sunny',
    42,
    'Smoke verified field production log',
    NULL,
    '[]'::jsonb,
    'smoke.site-engineer',
    true,
    'verified',
    'smoke.site-engineer',
    now(),
    'smoke.pm',
    now()
  );

  INSERT INTO daily_log_volumes (
    daily_log_id,
    construction_site_id,
    contract_item_id,
    contract_item_name,
    task_id,
    quantity,
    unit,
    note,
    source_index
  )
  VALUES (
    v_daily_log_id,
    v_site_text,
    v_contract_item_id,
    'Concrete structure package',
    v_task_id,
    v_current_qty,
    'm3',
    'Smoke measured quantity',
    1
  )
  RETURNING id INTO v_daily_log_volume_id;

  IF NOT EXISTS (
    SELECT 1
    FROM daily_logs dl
    JOIN daily_log_volumes dlv ON dlv.daily_log_id = dl.id
    WHERE dl.id = v_daily_log_id
      AND dl.status = 'verified'
      AND dlv.contract_item_id = v_contract_item_id
      AND dlv.quantity = v_current_qty
  ) THEN
    RAISE EXCEPTION 'Verified daily log volume was not recorded correctly';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (30, 'verified_daily_log_volume', 'PASS', 'Daily log is verified before its measured quantity is used for acceptance.');

  IF v_current_qty > v_revised_qty THEN
    RAISE EXCEPTION 'Accepted quantity would exceed revised contract quantity';
  END IF;

  INSERT INTO quantity_acceptances (
    contract_id,
    contract_type,
    construction_site_id,
    period_number,
    period_start,
    period_end,
    description,
    status,
    total_accepted_amount,
    submitted_by,
    submitted_at,
    approved_by,
    approved_at
  )
  VALUES (
    v_contract_id,
    'customer',
    v_site_id,
    1,
    '2026-05-01',
    '2026-05-31',
    'Smoke acceptance period 1',
    'approved',
    v_gross,
    'smoke.qs',
    now(),
    'smoke.pm',
    now()
  )
  RETURNING id INTO v_acceptance_id;

  INSERT INTO quantity_acceptance_items (
    acceptance_id,
    contract_item_id,
    contract_item_code,
    contract_item_name,
    unit,
    previous_accepted_quantity,
    proposed_quantity,
    accepted_quantity,
    cumulative_accepted_quantity,
    unit_price,
    accepted_amount,
    source_daily_log_volume_ids,
    note
  )
  VALUES (
    v_acceptance_id,
    v_contract_item_id,
    'RICO-BOQ-001',
    'Concrete structure package',
    'm3',
    0,
    v_current_qty,
    v_current_qty,
    v_current_qty,
    v_unit_price,
    v_gross,
    ARRAY[v_daily_log_volume_id],
    'Smoke approved acceptance item'
  )
  RETURNING id INTO v_acceptance_item_id;

  IF NOT EXISTS (
    SELECT 1
    FROM quantity_acceptances qa
    JOIN quantity_acceptance_items qai ON qai.acceptance_id = qa.id
    WHERE qa.id = v_acceptance_id
      AND qa.status = 'approved'
      AND qai.accepted_amount = v_gross
      AND qai.cumulative_accepted_quantity <= v_revised_qty
  ) THEN
    RAISE EXCEPTION 'Approved quantity acceptance is inconsistent';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (40, 'approved_quantity_acceptance', 'PASS', 'Acceptance records approved quantity and remains within revised BOQ quantity.');

  INSERT INTO advance_payments (
    contract_id,
    contract_type,
    construction_site_id,
    amount,
    date,
    recovery_percent,
    recovered_amount,
    remaining_amount,
    status,
    note
  )
  VALUES (
    v_contract_id,
    'customer',
    v_site_id,
    50000000000,
    '2026-05-01',
    30,
    0,
    50000000000,
    'active',
    'Smoke advance'
  )
  RETURNING id INTO v_advance_id;

  INSERT INTO payment_certificates (
    contract_id,
    contract_type,
    construction_site_id,
    period_number,
    period_start,
    period_end,
    description,
    items,
    total_contract_value,
    total_completed_value,
    current_completed_value,
    advance_recovery,
    retention_percent,
    retention_amount,
    penalty_amount,
    deduction_amount,
    previous_certified_amount,
    current_payable_amount,
    status,
    submitted_by,
    submitted_at,
    approved_by,
    approved_at,
    paid_at,
    acceptance_id,
    gross_this_period,
    gross_cumulative,
    advance_recovery_this_period,
    advance_recovery_cumulative,
    retention_this_period,
    retention_cumulative,
    payable_this_period
  )
  VALUES (
    v_contract_id,
    'customer',
    v_site_id,
    1,
    '2026-05-01',
    '2026-05-31',
    'Smoke payment certificate period 1',
    '[]'::jsonb,
    v_revised_qty * v_unit_price,
    v_gross,
    v_gross,
    v_advance_recovery,
    5,
    v_retention,
    0,
    0,
    0,
    v_payable,
    'approved',
    'smoke.qs',
    now(),
    'smoke.pm',
    now(),
    NULL,
    v_acceptance_id,
    v_gross,
    v_gross,
    v_advance_recovery,
    v_advance_recovery,
    v_retention,
    v_retention,
    v_payable
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO payment_certificate_items (
    payment_certificate_id,
    contract_item_id,
    contract_item_code,
    contract_item_name,
    unit,
    contract_quantity,
    revised_contract_quantity,
    previous_quantity,
    current_quantity,
    cumulative_quantity,
    unit_price,
    current_amount,
    cumulative_amount,
    source_acceptance_item_id,
    note
  )
  VALUES (
    v_payment_id,
    v_contract_item_id,
    'RICO-BOQ-001',
    'Concrete structure package',
    'm3',
    v_contract_qty,
    v_revised_qty,
    0,
    v_current_qty,
    v_current_qty,
    v_unit_price,
    v_gross,
    v_gross,
    v_acceptance_item_id,
    'Smoke payment snapshot'
  );

  INSERT INTO payment_certificate_advance_recoveries (
    payment_certificate_id,
    advance_payment_id,
    recovery_amount
  )
  VALUES (
    v_payment_id,
    v_advance_id,
    v_advance_recovery
  );

  UPDATE payment_certificates
  SET status = 'paid', paid_at = now()
  WHERE id = v_payment_id
    AND payable_this_period > 0;

  UPDATE advance_payments
  SET
    recovered_amount = recovered_amount + v_advance_recovery,
    remaining_amount = remaining_amount - v_advance_recovery,
    status = CASE
      WHEN remaining_amount - v_advance_recovery <= 0 THEN 'fully_recovered'
      ELSE 'active'
    END
  WHERE id = v_advance_id;

  UPDATE contract_items
  SET is_locked = true, locked_at = now()
  WHERE id = v_contract_item_id;

  IF NOT EXISTS (
    SELECT 1
    FROM payment_certificates pc
    JOIN payment_certificate_items pci ON pci.payment_certificate_id = pc.id
    JOIN payment_certificate_advance_recoveries pcar ON pcar.payment_certificate_id = pc.id
    JOIN advance_payments ap ON ap.id = pcar.advance_payment_id
    JOIN contract_items ci ON ci.id = pci.contract_item_id
    WHERE pc.id = v_payment_id
      AND pc.status = 'paid'
      AND pc.gross_this_period = v_gross
      AND pc.retention_this_period = v_retention
      AND pc.advance_recovery_this_period = v_advance_recovery
      AND pc.payable_this_period = v_payable
      AND pci.current_quantity = v_current_qty
      AND pci.current_amount = v_gross
      AND pcar.recovery_amount = v_advance_recovery
      AND ap.remaining_amount = v_advance_remaining
      AND ci.is_locked = true
  ) THEN
    RAISE EXCEPTION 'Payment certificate formula, advance recovery, or BOQ lock is inconsistent';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (
    50,
    'payment_formula_and_paid_flow',
    'PASS',
    'Gross 54B, retention 2.7B, advance recovery 16.2B, payable 35.1B, advance remaining 33.8B.'
  );

  INSERT INTO project_cost_actuals (
    construction_site_id,
    category,
    source,
    source_ref,
    amount,
    description,
    date
  )
  VALUES (
    v_site_id,
    'materials',
    'manual',
    v_payment_id::text,
    32000000000,
    'Smoke official cost actual',
    '2026-05-31'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM project_cost_actuals
    WHERE construction_site_id = v_site_id
      AND category = 'materials'
      AND source = 'manual'
      AND amount = 32000000000
  ) THEN
    RAISE EXCEPTION 'Official cost actual was not recorded correctly';
  END IF;

  INSERT INTO _project_smoke_result
  VALUES (60, 'financial_actual_mapping', 'PASS', 'Cost actual is stored separately from certified revenue and cash flow.');
END $$;

SELECT check_order, check_name, status, detail
FROM _project_smoke_result
ORDER BY check_order;

ROLLBACK;
