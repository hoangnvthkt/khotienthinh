# HRM Payroll 3P Metadata Source Of Truth Design

Date: 2026-07-05

## Purpose

Build the next HRM metadata layer so payroll can calculate employee income from canonical HRM metadata, the 2026 3P salary matrix, and editable employee compensation assignments.

This design extends the HRM metadata source of truth that was seeded from `danh-muc-goc.xlsx`. It uses:

- `/Users/admin/Downloads/Data_HR2026_1.xlsx` as the canonical 2026 3P salary matrix.
- `/Users/admin/Downloads/Data_HR2026_2.xlsx` as the canonical initial employee compensation assignment source for 117 employees.
- Existing software employee data as legacy data until HR remaps employees to canonical Excel employee codes.

## Business Decisions

- There is no P2 component.
- Standard total income is `P1 + P3 + PC`.
- `Data_HR2026_2.xlsx` is the source of truth to seed the first P3 assignment for 117 employees.
- HR must be able to edit each employee assignment after seeding.
- Employees without reviewed assignment use default P3 band `B3`.
- Months without KPI score use default KPI rating `B3`, with payroll multiplier `1.00`.
- Existing payroll and employee records remain readable; legacy columns and tables are not dropped in the first release.

## Source Data Findings

### `Data_HR2026_1.xlsx`

The workbook contains the canonical 2026 salary matrix:

- 11 salary grades: `E1` to `E11`.
- 16 P3 bands: `D1-D4`, `C1-C4`, `B1-B4`, `A1-A4`.
- P1 salary by grade.
- P3 standard salary by grade and band.
- KPI monthly rating bands and payroll multipliers.

The 101 salary titles in the matrix match the 101 canonical `hrm_positions` seeded in HRM metadata. Some names are duplicated across contexts, so mapping must use position code and org context, not name alone.

### `Data_HR2026_2.xlsx`

The workbook contains 117 employee rows and four block sections:

- Khoi 1 section: 40 people.
- Khoi 2 section: 32 people.
- Khoi 3 section: 40 people.
- Khoi 4 section: 5 people.

Key quality observations:

- One duplicated employee code: `TT0071`.
- One employee lacks level/P3 assignment: `TT0130 - Nguyen Thi Thu Hong`.
- One unknown position for current HRM metadata: `Nhan vien phien dich`.
- One level mismatch: `Can bo QS/QC` at `BCH RICO` is `L4` in the workbook, while canonical BCH context maps to `L5`.
- 23 rows contain warning or verification notes.

The workbook contains no Excel formulas, but values obey these formulas:

```text
legacy_total_income = base_salary + responsibility_allowance
p1_p3_standard_total = p1_salary + p3_standard_salary
standard_total_income_3p = p1_p3_standard_total
  + title_allowance
  + phone_allowance
  + attraction_support
  + meal_support
  + seniority_allowance
social_insurance_base = p1_salary + title_allowance + seniority_allowance
```

The workbook's P3 band and P3 amount match the 2026 salary matrix for all assigned employees.

## Data Model

### Compensation Plan

Create `hrm_compensation_plans`.

Required fields:

- `id`
- `code`, unique. Initial value: `3P_2026`.
- `name`
- `effective_from`
- `effective_to`
- `status`: `draft`, `active`, `archived`.
- `default_p3_band_code`: initial value `B3`.
- `default_kpi_rating_code`: initial value `B3`.
- `has_p2`: always `false` for this plan.
- `source`
- `metadata`
- timestamps

Purpose: version salary rules so future salary matrices do not mutate historical payroll.

### Salary Grades

Reuse existing `salary_grades`, but extend it for canonical 3P.

Add or normalize:

- `plan_id`
- `code`: `E1` to `E11`
- `hrm_level_code`: `L1` to `L11`
- `name`
- `group_name`
- `p1_salary_amount`
- `bhxh_coefficient`
- `regulated_salary`
- `source`
- `metadata`
- timestamps

`p1_salary_amount` is the canonical P1 value used by 3P payroll. Existing fields are preserved for compatibility.

### P3 Bands

Create `hrm_3p_bands`.

Required fields:

- `id`
- `plan_id`
- `code`: `D1-D4`, `C1-C4`, `B1-B4`, `A1-A4`
- `group_code`: `A`, `B`, `C`, `D`
- `p3_coefficient`
- `kpi_pay_multiplier`
- `market_bucket`: examples `Lag/P0-P25`, `Match/Mix/P50-P75`, `Lead/P75-P100`
- `ratio`
- `sort_order`
- `source`
- `metadata`

Important: do not overwrite existing `kpi_rating_configs.coefficient`, because that table currently stores KPI threshold semantics. Payroll multiplier belongs in the 3P band metadata.

### Grade-Band Matrix

Create `hrm_3p_grade_band_rates`.

Required fields:

- `id`
- `plan_id`
- `salary_grade_id`
- `p3_band_id`
- `p1_salary_amount`
- `p3_standard_amount`
- `standard_total_amount`
- `source`
- `metadata`

Constraint:

- Unique `(plan_id, salary_grade_id, p3_band_id)`.

Derived rule:

```text
standard_total_amount = p1_salary_amount + p3_standard_amount
```

### Position Salary Mapping

Create `hrm_position_salary_mappings`.

Required fields:

- `id`
- `plan_id`
- `position_id`
- `position_code_snapshot`
- `org_unit_code_snapshot`
- `salary_grade_id`
- `confidence`: `exact`, `contextual`, `manual_review`
- `source`
- `metadata`

Purpose: map canonical HRM positions to salary grades. Mapping must not rely on position name alone.

### Employee Compensation Assignment

Create `hrm_employee_compensation_assignments`.

Required fields:

- `id`
- `employee_id`
- `employee_code_snapshot`
- `employee_name_snapshot`
- `plan_id`
- `position_id`
- `org_unit_id`
- `salary_grade_id`
- `p3_band_id`
- `effective_from`
- `effective_to`
- `status`: `draft`, `active`, `superseded`
- `source`: `excel_seed`, `manual`, `legacy_default`
- `review_status`: `pending`, `approved`, `needs_review`
- `review_note`
- `metadata`
- timestamps

Initial seed rule:

- If an employee row from `Data_HR2026_2.xlsx` has a valid P3 band and can be matched to an employee, seed that P3 band.
- If an employee is matched but lacks a P3 band, seed default `B3` with `source = legacy_default` and `review_status = needs_review`.
- If an employee cannot be matched, keep the row in staging and do not create a canonical assignment until HR maps the employee.
- HR can edit `position`, `grade`, and `P3 band` later.

### Payroll Components

Create `hrm_payroll_components` as canonical metadata for recurring formula components.

Initial components:

- `P1`
- `P3_STANDARD`
- `PC_CHUC_DANH`
- `PC_DIEN_THOAI`
- `HO_TRO_THU_HUT`
- `HO_TRO_AN_CA`
- `PC_THAM_NIEN`
- `BHXH_BASE`
- `KPI_MULTIPLIER`

Component formulas:

```text
P3_ACTUAL = P3_STANDARD * KPI_MULTIPLIER
STANDARD_TOTAL_INCOME = P1 + P3_STANDARD + recurring_allowances
PAYROLL_TOTAL_INCOME = P1 + P3_ACTUAL + recurring_allowances + period_adjustments
BHXH_BASE = P1 + PC_CHUC_DANH + PC_THAM_NIEN
```

Meal support and period adjustments can still be edited per payroll period.

### Import Staging

Create:

- `hrm_payroll_import_batches`
- `hrm_payroll_import_rows`

Batch fields:

- `id`
- `source_file_name`
- `source_file_hash`
- `import_type`: `employee_compensation_seed`
- `status`: `uploaded`, `validated`, `partially_approved`, `applied`, `rejected`
- `metadata`
- timestamps

Row fields:

- `id`
- `batch_id`
- `source_row_number`
- `raw_payload`
- `normalized_payload`
- `matched_employee_id`
- `matched_position_id`
- `matched_org_unit_id`
- `matched_salary_grade_id`
- `matched_p3_band_id`
- `validation_status`: `valid`, `warning`, `error`
- `validation_messages`
- `apply_status`: `pending`, `applied`, `skipped`

Purpose: Excel data is reviewed before it mutates canonical HRM/payroll data.

## Import Rules

### Employee Matching

Primary match:

- `employee_code` from Excel to canonical employee code.

Fallback match:

- full name + date of birth + CCCD.

Legacy rule:

- Existing software employee data is treated as legacy until HR remaps it to canonical Excel employee codes.
- Do not auto-merge ambiguous employees.
- Duplicate Excel employee code must produce a blocking validation error.

### Metadata Matching

Org unit:

- Match by `Mã BP` to `org_units.code`.
- Match `Mã khối` to `hrm_org_blocks.code`.

Position:

- Prefer exact `(position name, org unit context)`.
- If duplicate names exist, require org context or manual review.
- If position is unknown, keep staging row as warning/error and allow HR to map manually.

Contract type:

- `KXĐ`, `12 tháng`, `12T`, `Thử việc`, `Chuyên gia` map to `labor_contract_type`.

Education:

- Map by code/name to `education_level`.

Social insurance:

- `Tham gia`, `Chưa tham gia`, `Hưu trí` map to `social_insurance_status`.
- Missing BHXH status remains warning, not automatic error.

### Assignment Seed

For each valid row:

- Create or update employee profile fields only after HR approval.
- Create active `hrm_employee_compensation_assignments` from Excel P3 band.
- Snapshot source values from Excel into metadata for audit.

For rows needing review:

- Do not silently create canonical assignment.
- Preserve raw row in staging and show review action.

## Payroll Generation Flow

1. Select month/year and compensation plan.
2. Resolve active employees.
3. Resolve active employee compensation assignment.
4. If assignment is missing, use default `B3` only if payroll policy allows fallback.
5. Resolve KPI score for the period.
6. If KPI score is missing, use default `B3 = 1.00`.
7. Calculate payroll components.
8. Write payroll record with full snapshot:
   - plan
   - grade
   - P3 band
   - KPI rating
   - P1
   - P3 standard
   - P3 actual
   - recurring allowances
   - period adjustments

Historical payroll records must not change if metadata is later edited.

## UI Scope

### Settings HRM Metadata

Add payroll metadata tabs:

- Compensation plans
- Salary grades
- P3 bands
- Grade-band matrix
- Payroll components

### Employee HRM

Add compensation assignment section:

- Current plan
- Position
- Level/grade
- P3 band
- Source
- Review status
- Effective date

### Payroll

Enhance payroll generation:

- Use 3P assignment by default.
- Show fallback/default warnings.
- Show component breakdown.
- Preserve manual adjustments for period-specific additions/deductions.

### Import Review

Add staging review screen:

- Upload Excel
- Validate
- Show valid/warning/error rows
- Allow HR to map unknown position or employee
- Apply approved rows

## Compatibility

- Keep existing `hrm_salary_policies`, `hrm_payroll_templates`, `hrm_payrolls`, `hrm_labor_contracts`, and `salary_grades`.
- Existing payroll template logic remains readable.
- New 3P payroll should be canonical for new payroll generation after rollout.
- Existing payroll records remain historical legacy records.

## Data Quality Gates

Block apply:

- Duplicate employee code in the same import batch.
- Unknown employee when the action is "update existing employee".
- Unknown salary grade or P3 band.
- Ambiguous position mapping without HR selection.

Warn but allow review:

- Missing BHXH status.
- Missing CCCD/phone/date of birth.
- Workbook warning notes.
- Org section label differing from `Mã khối`.
- Position context differs from suggested canonical org unit but still has exact title/level match.

## Test Plan

Unit tests:

- Parse `Data_HR2026_1.xlsx` into 11 grades, 16 bands, and 176 matrix rates.
- Parse `Data_HR2026_2.xlsx` into 117 employee rows and four section headers.
- Detect duplicate employee code `TT0071`.
- Detect missing assignment for `TT0130`.
- Verify `AF = AG + AP`.
- Verify `AQ = AF + AH + AI + AK + AM + AN`.
- Verify `AR = AG + AH + AN`.
- Verify P3 amount matches matrix for all assigned rows.

Database smoke tests:

- Seed one active compensation plan `3P_2026`.
- Seed 11 salary grades.
- Seed 16 P3 bands.
- Seed 176 grade-band matrix rows.
- Ensure default band/rating `B3` exists.
- Ensure employee assignment has no orphan FK.

App smoke tests:

- Settings shows 3P metadata.
- Import review shows valid/warning/error rows.
- HR can approve a valid row.
- HR can manually map an unknown/ambiguous row.
- Employee profile shows active assignment.
- Payroll generation uses assignment, default KPI `B3`, and snapshots values.

## Rollout Plan

Phase 1:

- Add database metadata and staging tables.
- Seed compensation plan, salary grades, P3 bands, and matrix.

Phase 2:

- Add import parser and staging review for `Data_HR2026_2.xlsx`.
- Seed initial assignments for approved rows.

Phase 3:

- Update employee profile and payroll generation to use 3P assignments.
- Keep legacy payroll templates available as fallback/read-only compatibility.

Phase 4:

- Add reporting and audit views for salary changes, assignment changes, and payroll snapshots.
