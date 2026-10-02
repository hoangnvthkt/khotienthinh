-- ===========================================================================
-- K3a — Module Tài chính: Phải trả NCC toàn công ty (02/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md
--
-- Luật nghiệp vụ (chủ sản phẩm đã duyệt 01–02/10):
-- * Quyền mới system.finance.{view, record, confirm, manage}. view = xem công nợ TOÀN CÔNG TY.
--   record = ghi nhận (ghi nợ từ đối soát, lập đối chiếu đầu kỳ, ghi chi ngoài hệ thống, đề xuất hủy công nợ).
--   confirm = xác nhận các việc trên (luôn KHÁC người lập, kể cả Admin). manage = hạn thanh toán, ma trận duyệt chi.
-- * Hạn thanh toán: HĐ → NCC → mặc định công ty (30 ngày), tính từ ngày ghi nợ; lưu nguồn hạn (due_date_source).
--   Đổi điều khoản chỉ áp chứng từ mới, trừ khi người quản trị chọn "áp cho chứng từ đang mở" (có nhật ký).
-- * Mốc công nợ 01/10/2026. Đối chiếu đầu kỳ theo NCC × dự án: số MISA tại 30/09 vs số Vioo còn nợ trước mốc
--   (sau khi đã ghi các khoản chi ngoài hệ thống). MISA cao hơn → chứng từ "số dư đầu kỳ" (opening_balance, KHÔNG
--   sinh chi phí dự án vì chi phí đã có từ MISA). Vioo cao hơn → không chốt được: ghi thêm chi ngoài hệ thống / hủy.
-- * Chi ngoài hệ thống: đợt chi (supplier_payment_batches, metadata.external) có số UNC + ngày chi thật; người khác
--   xác nhận thì mới ghi sổ (dùng engine G7: chặn chi vượt, khóa kỳ, sinh dòng tiền ra). Đảo phải có lý do.
-- * Hủy công nợ (không phải nợ NCC, VD điều chuyển nội bộ RICO): lập đề xuất có lý do → người khác xác nhận;
--   chỉ khi chưa có khoản chi nào. Không xóa chứng từ — chuyển trạng thái cancelled + lưu lý do, người, thời điểm.
-- * Ma trận duyệt chi là KHUNG CẤU HÌNH có phiên bản (Admin / Quản trị Tài chính sửa); dùng từ K3b.
-- * Mọi thay đổi ghi vào finance_events (bất biến). Bảng công nợ không cho ghi thẳng qua API (chỉ qua hàm nghiệp vụ).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Quyền
-- ---------------------------------------------------------------------------
insert into public.permission_applications (code, name, description, sort_order, is_active, member_assignable)
values ('finance', 'Tài chính', 'Canonical product application: Finance', 25, true, true)
on conflict (code) do nothing;

insert into public.permission_modules (application_code, code, name, description, routes, legacy_module_key, sort_order, is_active)
values ('system', 'system.finance', 'Tài chính', 'Công nợ, chi tiền, dòng tiền toàn công ty', array['/finance'], 'FINANCE', 55, true)
on conflict (code) do nothing;

insert into public.permission_actions (module_code, action, permission_code, label, description, scope_modes, legacy_module_key,
  legacy_route, legacy_admin_only, sort_order, is_active, risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, grant_readiness, access_application_code, direct_grant_allowed)
values
  ('system.finance', 'view', 'system.finance.view', 'Xem công nợ toàn công ty', 'Xem module Tài chính: công nợ NCC mọi dự án',
    array['global'], 'FINANCE', '/finance', false, 10, true, 'important', false, false, false, 'enforced', 'finance', true),
  ('system.finance', 'record', 'system.finance.record', 'Ghi nhận', 'Ghi nợ từ đối soát, lập đối chiếu đầu kỳ, ghi chi ngoài hệ thống, đề xuất hủy công nợ',
    array['global'], 'FINANCE', '/finance', false, 20, true, 'important', true, false, false, 'enforced', 'finance', true),
  ('system.finance', 'confirm', 'system.finance.confirm', 'Xác nhận', 'Xác nhận đối chiếu đầu kỳ, chi ngoài hệ thống, hủy công nợ (khác người lập)',
    array['global'], 'FINANCE', '/finance', false, 30, true, 'sensitive', false, true, false, 'enforced', 'finance', true),
  ('system.finance', 'manage', 'system.finance.manage', 'Quản trị Tài chính', 'Hạn thanh toán, ma trận duyệt chi, ủy quyền',
    array['global'], 'FINANCE', '/finance', false, 40, true, 'sensitive', false, false, false, 'enforced', 'finance', true)
on conflict (permission_code) do nothing;

create function app_private.finance_can(p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_app_user_id() is not null and (public.is_admin()
    or app_private.has_permission(public.current_app_user_id(), 'system.finance.' || p_action)
    or (p_action = 'view' and (app_private.has_permission(public.current_app_user_id(), 'system.finance.record')
      or app_private.has_permission(public.current_app_user_id(), 'system.finance.confirm')
      or app_private.has_permission(public.current_app_user_id(), 'system.finance.manage'))));
$$;

-- Kế toán có quyền Tài chính — Ghi nhận cũng ghi được công nợ từ bảng đối soát HĐ (vẫn khác người chốt).
create or replace function app_private.procurement_statement_accountant_ok(p_actor uuid, p_project_id text, p_site_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_admin() or app_private.project_actor_has_effective_room_action(p_actor, p_project_id, p_site_id, 'payment', 'confirm')
    or app_private.has_permission(p_actor, 'system.finance.record');
$$;

-- Engine G7 kiểm quyền theo dự án; RPC của module Tài chính đã kiểm quyền + tách nhiệm rồi mới bật ngữ cảnh này.
create or replace function app_private.can_manage_supplier_payments(p_project_id text, p_construction_site_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_has_permission_v2(p_project_id, p_construction_site_id, 'project.cashflow.manage', public.current_app_user_id())
    or app_private.project_has_permission_v2(p_project_id, p_construction_site_id, 'project.payment.mark_paid', public.current_app_user_id())
    or coalesce(current_setting('app.finance_context', true), '') = 'on',
    false);
$$;

-- ---------------------------------------------------------------------------
-- 2. Bảng
-- ---------------------------------------------------------------------------
create table public.finance_settings (
  id smallint primary key default 1 check (id = 1),
  default_payment_days integer not null default 30 check (default_payment_days between 0 and 365),
  ap_cutover_date date not null default date '2026-10-01',
  row_version bigint not null default 1,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
insert into public.finance_settings default values;

create table public.supplier_payment_terms (
  supplier_id text primary key references public.business_partners(id),
  payment_days integer not null check (payment_days between 0 and 365),
  note text,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

alter table public.supplier_contracts
  add column payment_term_days integer check (payment_term_days between 0 and 365),
  add column require_invoice_before_payment boolean not null default false;

alter table public.supplier_payable_documents
  add column due_date_source text check (due_date_source in ('contract', 'supplier', 'default', 'manual'));

create table public.finance_internal_partners (
  supplier_id text primary key references public.business_partners(id),
  reason text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table public.finance_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  supplier_id text,
  action text not null,
  actor_id uuid references public.users(id),
  reason text,
  before jsonb,
  after jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index finance_events_entity_idx on public.finance_events (entity_type, entity_id, created_at);
create index finance_events_supplier_idx on public.finance_events (supplier_id, created_at);

create function app_private.trg_finance_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception using errcode = '42501', message = 'FINANCE_EVENTS_IMMUTABLE'; end $$;
create trigger finance_events_immutable before update or delete on public.finance_events
  for each row execute function app_private.trg_finance_events_immutable();

create table public.finance_opening_reconciliations (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null references public.business_partners(id),
  project_id text not null references public.projects(id),
  cutover_date date not null,
  misa_amount numeric(18,2) not null check (misa_amount >= 0),
  vioo_outstanding numeric(18,2),
  opening_amount numeric(18,2),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'confirmed', 'rejected', 'cancelled')),
  note text,
  attachments jsonb not null default '[]'::jsonb,
  reviewed_document_ids uuid[] not null default '{}',
  opening_document_id uuid references public.supplier_payable_documents(id),
  revision integer not null default 1,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references public.users(id),
  submitted_at timestamptz,
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_opening_one_active on public.finance_opening_reconciliations (supplier_id, project_id)
  where status in ('draft', 'submitted', 'rejected', 'confirmed');

create table public.finance_payable_adjustments (
  id uuid primary key default gen_random_uuid(),
  payable_document_id uuid not null references public.supplier_payable_documents(id),
  kind text not null check (kind in ('cancel')),
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'withdrawn')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_adjustment_one_open on public.finance_payable_adjustments (payable_document_id) where status = 'submitted';

create table public.finance_approval_matrix_versions (
  id uuid primary key default gen_random_uuid(),
  version_no integer not null unique,
  is_current boolean not null default false,
  note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create unique index finance_approval_matrix_one_current on public.finance_approval_matrix_versions (is_current) where is_current;

create table public.finance_approval_rules (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.finance_approval_matrix_versions(id),
  tier_no integer not null,
  min_amount numeric(18,2) not null check (min_amount >= 0),
  max_amount numeric(18,2) check (max_amount is null or max_amount > min_amount),
  steps jsonb not null,
  unique (version_id, tier_no)
);

create table public.finance_approval_delegations (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.users(id),
  to_user_id uuid not null references public.users(id) check (to_user_id <> from_user_id),
  valid_from date not null,
  valid_to date not null check (valid_to >= valid_from),
  reason text not null check (length(btrim(reason)) > 0),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  revoked_by uuid references public.users(id),
  revoked_at timestamptz,
  revoke_reason text
);

do $$ declare t text; begin
  foreach t in array array['finance_settings', 'supplier_payment_terms', 'finance_internal_partners', 'finance_events', 'finance_opening_reconciliations',
    'finance_payable_adjustments', 'finance_approval_matrix_versions', 'finance_approval_rules', 'finance_approval_delegations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Chứng từ đính kèm (UNC, biên bản đối chiếu NCC, sổ chi tiết MISA): bucket riêng, không công khai.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-attachments', 'finance-attachments', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy finance_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'finance-attachments' and app_private.finance_can('view'));
create policy finance_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'finance-attachments' and app_private.finance_can('record'));

-- ---------------------------------------------------------------------------
-- 3. Hạn thanh toán và bảo vệ bảng công nợ
-- ---------------------------------------------------------------------------
create function app_private.finance_due_for(p_supplier_id text, p_contract_id text, p_document_date date)
returns table (due_date date, source text)
language sql stable security definer set search_path = '' as $$
  with c as (select payment_term_days d from public.supplier_contracts where id = p_contract_id),
  s as (select payment_days d from public.supplier_payment_terms where supplier_id = p_supplier_id),
  g as (select default_payment_days d from public.finance_settings where id = 1)
  select p_document_date + coalesce((select d from c), (select d from s), (select d from g), 30),
    case when (select d from c) is not null then 'contract' when (select d from s) is not null then 'supplier' else 'default' end;
$$;

create function app_private.trg_supplier_payable_due()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.document_date is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.due_date is null then
      select * into r from app_private.finance_due_for(new.supplier_id, new.supplier_contract_id, new.document_date);
      new.due_date := r.due_date; new.due_date_source := r.source;
    elsif new.due_date_source is null then
      new.due_date_source := 'manual';
    end if;
  elsif coalesce(new.due_date_source, '') <> 'manual'
    and (new.document_date is distinct from old.document_date or new.supplier_id is distinct from old.supplier_id
      or new.supplier_contract_id is distinct from old.supplier_contract_id or new.due_date is null) then
    select * into r from app_private.finance_due_for(new.supplier_id, new.supplier_contract_id, new.document_date);
    new.due_date := r.due_date; new.due_date_source := r.source;
  end if;
  return new;
end $$;
create trigger trg_supplier_payable_due before insert or update on public.supplier_payable_documents
  for each row execute function app_private.trg_supplier_payable_due();

-- Chỉ ghi công nợ qua hàm nghiệp vụ (RPC); chặn sửa thẳng bảng qua API.
create function app_private.guard_supplier_payable_direct_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path', true), '');
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') and v_path <> '' and v_path not like '/rpc/%' then
    raise exception using errcode = '42501', message = 'SUPPLIER_PAYABLE_DIRECT_WRITE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_guard_supplier_payable_direct_write before insert or update or delete on public.supplier_payable_documents
  for each row execute function app_private.guard_supplier_payable_direct_write();

-- Gán hạn cho các chứng từ đang mở chưa có hạn (25 chứng từ ngày 02/10: đều theo mặc định 30 ngày).
update public.supplier_payable_documents d set due_date = f.due_date, due_date_source = f.source
from public.supplier_payable_documents x
cross join lateral app_private.finance_due_for(x.supplier_id, x.supplier_contract_id, x.document_date) f
where d.id = x.id and d.due_date is null and d.document_date is not null and d.status in ('draft', 'open', 'partial');
update public.supplier_payable_documents set due_date_source = 'manual' where due_date is not null and due_date_source is null;

-- Đơn vị nội bộ: "Công trình RICO" là công trình của công ty, không phải NCC (chủ sản phẩm xác nhận 02/10).
insert into public.finance_internal_partners (supplier_id, reason)
values ('5ecf36bb-ab2c-42fc-874b-4950859a91d7', 'Công trình của công ty — PO-462 là điều chuyển nội bộ RICO → DA29 (chủ sản phẩm xác nhận 02/10/2026)');

-- Ma trận duyệt chi ban đầu (chủ sản phẩm duyệt 01–02/10). Admin / Quản trị Tài chính sửa được.
with v as (insert into public.finance_approval_matrix_versions (version_no, is_current, note)
  values (1, true, 'Cấu hình ban đầu 02/10/2026: ≤100tr KTT; >100tr KTT kiểm tra + GĐ tài chính duyệt; ≥1 tỷ thêm TGĐ') returning id)
insert into public.finance_approval_rules (version_id, tier_no, min_amount, max_amount, steps)
select v.id, t.tier_no, t.min_amount, t.max_amount, t.steps from v cross join (values
  (1, 0::numeric, 100000000::numeric, '[{"label":"Kế toán trưởng duyệt","approverIds":["85b13472-d16c-4025-afac-ee8c8d1bf1f6"]}]'::jsonb),
  (2, 100000000, 1000000000, '[{"label":"Kế toán trưởng kiểm tra","approverIds":["85b13472-d16c-4025-afac-ee8c8d1bf1f6"]},{"label":"Giám đốc tài chính duyệt","approverIds":["1b7bd7cb-54c3-43b5-b0ff-44ce63b8bd11","928d3473-49a2-4427-a319-19729689a084"]}]'),
  (3, 1000000000, null, '[{"label":"Kế toán trưởng kiểm tra","approverIds":["85b13472-d16c-4025-afac-ee8c8d1bf1f6"]},{"label":"Giám đốc tài chính duyệt","approverIds":["1b7bd7cb-54c3-43b5-b0ff-44ce63b8bd11","928d3473-49a2-4427-a319-19729689a084"]},{"label":"Tổng giám đốc duyệt","approverIds":["d2c494c2-bbd4-4ea2-a194-ad3cb0faa6d5"]}]')
) t(tier_no, min_amount, max_amount, steps);

-- ---------------------------------------------------------------------------
-- 4. Hàm đọc
-- ---------------------------------------------------------------------------
create function app_private.finance_user_name(p_id uuid)
returns text language sql stable security definer set search_path = '' as $$ select name from public.users where id = p_id $$;

-- Chứng từ đang theo dõi (chưa hủy/đảo), kèm số đã chi, còn nợ, chi ngoài chờ xác nhận và các dấu hiệu cần xử lý.
create function app_private.finance_payable_rows()
returns table (id uuid, supplier_id text, supplier_name text, internal boolean, project_id text, project_code text, project_name text,
  construction_site_id text, source_type text, source_id text, code text, document_no text, document_date date, due_date date,
  due_date_source text, recognized numeric, credit numeric, paid numeric, outstanding numeric, pending_external numeric,
  status text, contract_id text, contract_code text, origin text, created_at timestamptz, issues text[])
language sql stable security definer set search_path = '' as $$
  with base as (
    select b.*, p.code project_code, p.name project_name,
      exists (select 1 from public.finance_internal_partners ip where ip.supplier_id = b.supplier_id) internal,
      coalesce((select sum(a.allocated_amount) from public.supplier_payment_allocations a join public.supplier_payment_batches pb on pb.id = a.payment_batch_id
        where a.payable_document_id = b.id and pb.status = 'submitted'), 0) pending_external
    from public.supplier_payable_document_balances b
    left join public.projects p on p.id = b.project_id
    where b.status not in ('cancelled', 'reversed', 'draft')
  )
  select b.id, b.supplier_id, b.supplier_name_snapshot, b.internal, b.project_id, b.project_code, b.project_name, b.construction_site_id,
    b.source_type, b.source_id, b.code, b.document_no, b.document_date, b.due_date, d.due_date_source,
    b.recognized_amount, b.credit_amount, b.paid_amount, b.outstanding_amount, b.pending_external, b.status,
    b.supplier_contract_id, b.supplier_contract_code, b.metadata->>'origin', b.created_at,
    array_remove(array[
      case when b.internal then 'internal_partner' end,
      case when b.recognized_amount - b.credit_amount between 0.01 and 9999.99 then 'tiny_amount' end,
      case when b.source_type = 'supplier_delivery_statement' and exists (select 1 from public.supplier_delivery_statements st
        where st.id::text = b.source_id and st.created_by is not null and st.created_by = st.posted_by) then 'same_person_statement' end,
      case when b.source_type <> 'opening_balance' and exists (select 1 from public.finance_opening_reconciliations o
        where o.supplier_id = b.supplier_id and o.project_id = b.project_id and o.status = 'confirmed'
          and b.document_date < o.cutover_date and b.created_at > o.decided_at) then 'after_opening' end,
      case when exists (select 1 from public.finance_payable_adjustments j where j.payable_document_id = b.id and j.status = 'submitted') then 'pending_cancel' end
    ], null)
  from base b join public.supplier_payable_documents d on d.id = b.id;
$$;

create function app_private.finance_can_flags()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('view', app_private.finance_can('view'), 'record', app_private.finance_can('record'),
    'confirm', app_private.finance_can('confirm'), 'manage', app_private.finance_can('manage'));
$$;

create function public.list_finance_payables_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_set public.finance_settings%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return (with r as (
      select x.*, case when x.outstanding <= 0 then 'settled' when x.due_date is null then 'none'
        when x.due_date < v_today then 'overdue' when x.due_date <= v_today + 7 then 'soon' else 'later' end tone
      from app_private.finance_payable_rows() x
      where (nullif(p_filter->>'projectId', '') is null or x.project_id = p_filter->>'projectId')
        and (nullif(p_filter->>'source', '') is null or x.source_type = p_filter->>'source'
          or (p_filter->>'source' = 'receipt_reconciliation' and x.origin = 'receipt_reconciliation'))),
    open_r as (select * from r where outstanding > 0),
    sup as (
      select o.supplier_id, min(o.supplier_name) supplier_name, bool_or(o.internal) internal, sum(o.outstanding) owed,
        sum(o.outstanding) filter (where tone = 'overdue') overdue, sum(o.outstanding) filter (where tone = 'soon') soon,
        sum(o.pending_external) pending_external, count(*) doc_count, min(o.due_date) next_due,
        array_agg(distinct o.project_code) projects, count(*) filter (where cardinality(o.issues) > 0) issues,
        count(distinct o.project_id) filter (where o.document_date < v_set.ap_cutover_date and o.source_type <> 'opening_balance') pre_projects,
        count(distinct o.project_id) filter (where o.document_date < v_set.ap_cutover_date and o.source_type <> 'opening_balance'
          and exists (select 1 from public.finance_opening_reconciliations f where f.supplier_id = o.supplier_id and f.project_id = o.project_id and f.status = 'confirmed')) done_projects,
        bool_or(exists (select 1 from public.finance_opening_reconciliations f where f.supplier_id = o.supplier_id and f.project_id = o.project_id and f.status = 'submitted')) opening_pending
      from open_r o group by o.supplier_id)
    select jsonb_build_object(
      'today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'defaultPaymentDays', v_set.default_payment_days,
      'can', app_private.finance_can_flags(),
      'totals', jsonb_build_object(
        'owed', coalesce((select sum(outstanding) from open_r), 0), 'docCount', (select count(*) from open_r),
        'supplierCount', (select count(*) from sup),
        'overdue', coalesce((select sum(outstanding) from open_r where tone = 'overdue'), 0), 'overdueCount', (select count(*) from open_r where tone = 'overdue'),
        'soon', coalesce((select sum(outstanding) from open_r where tone = 'soon'), 0), 'soonCount', (select count(*) from open_r where tone = 'soon'),
        'noDueCount', (select count(*) from open_r where tone = 'none'),
        'issues', (select count(*) from open_r where cardinality(issues) > 0),
        'openingPendingSuppliers', (select count(*) from sup where done_projects < pre_projects),
        'pendingExternal', coalesce((select sum(pending_external) from sup), 0)),
      'pendingStatements', jsonb_build_object(
        'count', (select count(*) from public.supplier_delivery_statements st where st.status = 'confirmed'),
        'amount', coalesce((select sum(st.total_amount) from public.supplier_delivery_statements st where st.status = 'confirmed'), 0)),
      'projects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name))
        from public.projects p where p.id in (select project_id from r)), '[]'::jsonb),
      'suppliers', coalesce((select jsonb_agg(jsonb_build_object(
          'supplierId', s.supplier_id, 'name', s.supplier_name, 'internal', s.internal, 'owed', s.owed,
          'overdue', coalesce(s.overdue, 0), 'soon', coalesce(s.soon, 0), 'pendingExternal', s.pending_external,
          'docCount', s.doc_count, 'nextDue', s.next_due, 'projects', s.projects, 'issues', s.issues,
          'opening', case when s.pre_projects = 0 then 'not_needed' when s.done_projects >= s.pre_projects then 'done'
            when s.opening_pending then 'pending' else 'todo' end,
          'worst', case when coalesce(s.overdue, 0) > 0 then 'overdue' when coalesce(s.soon, 0) > 0 then 'soon' else 'later' end)
          order by coalesce(s.overdue, 0) desc, s.owed desc) from sup s), '[]'::jsonb)));
end;
$$;

create function public.get_finance_supplier_v1(p_supplier_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id();
  v_bp public.business_partners%rowtype; v_set public.finance_settings%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_bp from public.business_partners where id = p_supplier_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return jsonb_build_object(
    'today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'defaultPaymentDays', v_set.default_payment_days,
    'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'supplier', jsonb_build_object('id', v_bp.id, 'name', v_bp.name, 'code', v_bp.code, 'taxCode', v_bp.tax_code,
      'bankName', v_bp.bank_name, 'bankAccount', v_bp.bank_account,
      'internal', exists (select 1 from public.finance_internal_partners ip where ip.supplier_id = v_bp.id),
      'internalReason', (select ip.reason from public.finance_internal_partners ip where ip.supplier_id = v_bp.id),
      'terms', (select jsonb_build_object('paymentDays', t.payment_days, 'note', t.note, 'updatedAt', t.updated_at,
        'updatedByName', app_private.finance_user_name(t.updated_by)) from public.supplier_payment_terms t where t.supplier_id = v_bp.id)),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status,
        'paymentTermDays', c.payment_term_days, 'paymentTermsText', c.payment_terms, 'requireInvoice', c.require_invoice_before_payment) order by c.code)
      from public.supplier_contracts c where c.supplier_id = v_bp.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'documentNo', r.document_no, 'sourceType', r.source_type, 'origin', r.origin,
        'projectId', r.project_id, 'projectCode', r.project_code, 'projectName', r.project_name,
        'contractId', r.contract_id, 'contractCode', r.contract_code,
        'documentDate', r.document_date, 'dueDate', r.due_date, 'dueSource', r.due_date_source,
        'recognized', r.recognized, 'credit', r.credit, 'paid', r.paid, 'outstanding', r.outstanding,
        'pendingExternal', r.pending_external, 'status', r.status, 'issues', to_jsonb(r.issues), 'createdAt', r.created_at,
        'provenance', case r.source_type
          when 'purchase_delivery_receipt' then (select jsonb_build_object('poNumber', po.po_number, 'poId', po.id, 'deliveryNo', b.delivery_no,
              'warehouse', (select w.name from public.transactions t join public.warehouses w on w.id = t.target_warehouse_id where t.id = b.wms_transaction_id),
              'receivedAt', b.received_at, 'receivedByName', app_private.finance_user_name(b.received_by))
            from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id where b.id::text = r.source_id)
          when 'supplier_delivery_statement' then (select jsonb_build_object('statementCode', st.code, 'periodMonth', st.period_month,
              'notes', (select count(distinct l.delivery_note_id) from public.supplier_direct_delivery_lines l where l.statement_id = st.id),
              'createdByName', app_private.finance_user_name(st.created_by), 'confirmedByName', st.metadata->>'confirmedByName',
              'postedByName', app_private.finance_user_name(st.posted_by), 'postedAt', st.posted_at)
            from public.supplier_delivery_statements st where st.id::text = r.source_id)
          when 'opening_balance' then (select jsonb_build_object('reconciliationId', o.id, 'misaAmount', o.misa_amount,
              'createdByName', app_private.finance_user_name(o.created_by), 'confirmedByName', app_private.finance_user_name(o.decided_by), 'confirmedAt', o.decided_at)
            from public.finance_opening_reconciliations o where o.id::text = r.source_id)
          else null end,
        'pendingAdjustment', (select jsonb_build_object('id', j.id, 'kind', j.kind, 'reason', j.reason, 'createdBy', j.created_by,
            'createdByName', app_private.finance_user_name(j.created_by), 'createdAt', j.created_at)
          from public.finance_payable_adjustments j where j.payable_document_id = r.id and j.status = 'submitted'))
        order by r.project_code, r.contract_code nulls last, r.document_date, r.document_no)
      from app_private.finance_payable_rows() r where r.supplier_id = v_bp.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'code', pb.code, 'status', pb.status, 'rowVersion', pb.row_version,
        'external', coalesce((pb.metadata->>'external')::boolean, false), 'projectId', pb.project_id,
        'projectCode', (select code from public.projects where id = pb.project_id), 'paymentDate', pb.payment_date, 'amount', pb.payment_amount,
        'method', pb.payment_method, 'documentRef', pb.document_ref, 'note', pb.note, 'attachments', pb.attachments,
        'createdBy', pb.created_by, 'createdByName', app_private.finance_user_name(pb.created_by), 'createdAt', pb.created_at,
        'paidByName', app_private.finance_user_name(pb.paid_by), 'paidAt', pb.paid_at, 'rejection', pb.metadata->'rejection',
        'reversal', pb.metadata->>'g7ReversalReason',
        'allocations', (select jsonb_agg(jsonb_build_object('documentId', a.payable_document_id, 'documentNo', a.document_no_snapshot, 'amount', a.allocated_amount))
          from public.supplier_payment_allocations a where a.payment_batch_id = pb.id)) order by pb.payment_date desc, pb.created_at desc)
      from public.supplier_payment_batches pb where pb.supplier_id = v_bp.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'projectId', o.project_id,
        'projectCode', (select code from public.projects where id = o.project_id), 'status', o.status, 'revision', o.revision,
        'cutoverDate', o.cutover_date, 'misaAmount', o.misa_amount, 'viooOutstanding', o.vioo_outstanding, 'openingAmount', o.opening_amount,
        'note', o.note, 'attachments', o.attachments, 'reviewedDocumentIds', to_jsonb(o.reviewed_document_ids),
        'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by), 'createdAt', o.created_at,
        'submittedByName', app_private.finance_user_name(o.submitted_by), 'submittedAt', o.submitted_at,
        'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'openingDocumentId', o.opening_document_id) order by o.created_at desc)
      from public.finance_opening_reconciliations o where o.supplier_id = v_bp.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'entityType', e.entity_type, 'actorName', app_private.finance_user_name(e.actor_id),
        'reason', e.reason, 'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where supplier_id = v_bp.id order by created_at desc limit 100) e), '[]'::jsonb));
end;
$$;

create function public.list_finance_pending_statements_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', st.id, 'code', st.code, 'supplierId', st.supplier_id,
      'supplierName', st.supplier_name_snapshot, 'contractCode', st.supplier_contract_code, 'projectId', st.project_id,
      'projectCode', (select code from public.projects where id = st.project_id), 'periodMonth', st.period_month,
      'statementDate', st.statement_date, 'grossAmount', st.gross_amount, 'vatAmount', st.vat_amount, 'totalAmount', st.total_amount,
      'createdByName', app_private.finance_user_name(st.created_by), 'confirmedByName', st.metadata->>'confirmedByName',
      'confirmedAt', st.metadata->>'confirmedAt',
      'canPost', app_private.procurement_statement_accountant_ok(v_actor, st.project_id, st.construction_site_id)
        and coalesce(st.metadata->>'confirmedBy', '') <> v_actor::text) order by st.statement_date, st.code)
    from public.supplier_delivery_statements st where st.status = 'confirmed'), '[]'::jsonb);
end;
$$;

create function public.get_finance_settings_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_set public.finance_settings%rowtype; v_version public.finance_approval_matrix_versions%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  select * into v_version from public.finance_approval_matrix_versions where is_current;
  return jsonb_build_object('can', app_private.finance_can_flags(),
    'settings', jsonb_build_object('defaultPaymentDays', v_set.default_payment_days, 'cutoverDate', v_set.ap_cutover_date,
      'rowVersion', v_set.row_version, 'updatedAt', v_set.updated_at, 'updatedByName', app_private.finance_user_name(v_set.updated_by)),
    'matrix', jsonb_build_object('id', v_version.id, 'versionNo', v_version.version_no, 'note', v_version.note,
      'createdAt', v_version.created_at, 'createdByName', app_private.finance_user_name(v_version.created_by),
      'rules', coalesce((select jsonb_agg(jsonb_build_object('tierNo', r.tier_no, 'minAmount', r.min_amount, 'maxAmount', r.max_amount,
          'steps', (select jsonb_agg(jsonb_build_object('label', s.value->>'label',
              'approvers', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'active', coalesce(u.is_active, true)))
                from jsonb_array_elements_text(s.value->'approverIds') a join public.users u on u.id = a::uuid)) order by s.ordinality)
            from jsonb_array_elements(r.steps) with ordinality s)) order by r.tier_no)
        from public.finance_approval_rules r where r.version_id = v_version.id), '[]'::jsonb)),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('versionNo', v.version_no, 'note', v.note, 'createdAt', v.created_at,
        'createdByName', app_private.finance_user_name(v.created_by), 'current', v.is_current) order by v.version_no desc)
      from public.finance_approval_matrix_versions v), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'fromUserId', d.from_user_id, 'fromName', app_private.finance_user_name(d.from_user_id),
        'toUserId', d.to_user_id, 'toName', app_private.finance_user_name(d.to_user_id), 'validFrom', d.valid_from, 'validTo', d.valid_to,
        'reason', d.reason, 'createdByName', app_private.finance_user_name(d.created_by), 'revokedAt', d.revoked_at, 'revokeReason', d.revoke_reason)
        order by d.valid_from desc) from public.finance_approval_delegations d), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Hạn thanh toán (Quản trị Tài chính)
-- ---------------------------------------------------------------------------
create function app_private.finance_recompute_due(p_supplier_id text, p_contract_id text, p_sources text[], p_actor uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; d record; f record;
begin
  for d in select x.* from public.supplier_payable_documents x
    where x.status in ('open', 'partial') and x.document_date is not null
      and (p_supplier_id is null or x.supplier_id = p_supplier_id) and (p_contract_id is null or x.supplier_contract_id = p_contract_id)
      and coalesce(x.due_date_source, 'default') = any (p_sources)
    for update
  loop
    select * into f from app_private.finance_due_for(d.supplier_id, d.supplier_contract_id, d.document_date);
    if f.due_date is distinct from d.due_date or f.source is distinct from d.due_date_source then
      update public.supplier_payable_documents set due_date = f.due_date, due_date_source = f.source where id = d.id;
      insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
      values ('payable', d.id::text, d.supplier_id, 'due_recompute', p_actor, p_reason,
        jsonb_build_object('dueDate', d.due_date, 'source', d.due_date_source), jsonb_build_object('dueDate', f.due_date, 'source', f.source));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create function public.save_finance_supplier_terms_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId';
  v_days integer := nullif(p_input->>'paymentDays', '')::integer; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_before jsonb; v_n integer := 0;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if not exists (select 1 from public.business_partners where id = v_supplier) then
    raise exception using errcode = 'PT404', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  if v_days is not null and (v_days < 0 or v_days > 365) then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select to_jsonb(t) into v_before from public.supplier_payment_terms t where supplier_id = v_supplier;
  if v_days is null then
    delete from public.supplier_payment_terms where supplier_id = v_supplier;
  else
    insert into public.supplier_payment_terms (supplier_id, payment_days, note, updated_by, updated_at)
    values (v_supplier, v_days, nullif(btrim(p_input->>'note'), ''), v_actor, now())
    on conflict (supplier_id) do update set payment_days = excluded.payment_days, note = excluded.note, updated_by = v_actor, updated_at = now();
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
  values ('supplier_terms', v_supplier, v_supplier, 'terms_save', v_actor, v_reason, v_before,
    case when v_days is null then null else jsonb_build_object('paymentDays', v_days, 'note', nullif(btrim(p_input->>'note'), '')) end);
  if coalesce((p_input->>'applyToOpen')::boolean, false) then
    v_n := app_private.finance_recompute_due(v_supplier, null, array['default', 'supplier'], v_actor, v_reason);
  end if;
  return jsonb_build_object('supplierId', v_supplier, 'recomputed', v_n);
end $$;

create function public.save_finance_contract_terms_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_c public.supplier_contracts%rowtype;
  v_days integer := nullif(p_input->>'paymentDays', '')::integer; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_days is not null and (v_days < 0 or v_days > 365) then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  update public.supplier_contracts set payment_term_days = v_days,
    require_invoice_before_payment = coalesce((p_input->>'requireInvoice')::boolean, require_invoice_before_payment)
  where id = v_c.id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
  values ('contract_terms', v_c.id, v_c.supplier_id, 'contract_terms_save', v_actor, v_reason,
    jsonb_build_object('paymentDays', v_c.payment_term_days, 'requireInvoice', v_c.require_invoice_before_payment, 'contractCode', v_c.code),
    jsonb_build_object('paymentDays', v_days, 'requireInvoice', coalesce((p_input->>'requireInvoice')::boolean, v_c.require_invoice_before_payment), 'contractCode', v_c.code));
  if coalesce((p_input->>'applyToOpen')::boolean, false) then
    v_n := app_private.finance_recompute_due(null, v_c.id, array['default', 'supplier', 'contract'], v_actor, v_reason);
  end if;
  return jsonb_build_object('contractId', v_c.id, 'recomputed', v_n);
end $$;

create function public.set_finance_payable_due_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_d public.supplier_payable_documents%rowtype;
  v_due date := nullif(p_input->>'dueDate', '')::date; v_reason text := nullif(btrim(p_input->>'reason'), ''); f record;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_d from public.supplier_payable_documents where id = (p_input->>'documentId')::uuid for update;
  if not found or v_d.status not in ('open', 'partial') then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_STATE'; end if;
  if v_due is null then
    select * into f from app_private.finance_due_for(v_d.supplier_id, v_d.supplier_contract_id, v_d.document_date);
    update public.supplier_payable_documents set due_date = f.due_date, due_date_source = f.source where id = v_d.id;
  else
    if v_due < v_d.document_date then raise exception using errcode = '22023', message = 'FINANCE_DUE_BEFORE_DOCUMENT'; end if;
    update public.supplier_payable_documents set due_date = v_due, due_date_source = 'manual' where id = v_d.id;
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after)
  values ('payable', v_d.id::text, v_d.supplier_id, 'due_set', v_actor, v_reason,
    jsonb_build_object('dueDate', v_d.due_date, 'source', v_d.due_date_source),
    (select jsonb_build_object('dueDate', due_date, 'source', due_date_source) from public.supplier_payable_documents where id = v_d.id));
  return jsonb_build_object('documentId', v_d.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Chi ngoài hệ thống (đã trả NCC ngoài Vioo) — lập → người khác xác nhận → ghi sổ qua engine G7
-- ---------------------------------------------------------------------------
create function public.save_finance_external_payment_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_supplier text := p_input->>'supplierId'; v_project text := p_input->>'projectId';
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), '');
  v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer');
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_id uuid := gen_random_uuid(); v_total numeric := 0; v_recognized numeric := 0; v_site text; v_name text;
  a jsonb; d record; v_amount numeric;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_REQUIRED'; end if;
  if v_method not in ('bank_transfer', 'cash', 'other') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if jsonb_typeof(p_input->'allocations') is distinct from 'array' or jsonb_array_length(p_input->'allocations') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATIONS_REQUIRED'; end if;
  if exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  if exists (select 1 from public.supplier_payment_batches where supplier_id = v_supplier and document_ref = v_ref and status in ('submitted', 'paid')) then
    raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_DUPLICATE'; end if;

  create temp table if not exists pg_temp.fin_alloc (doc_id uuid, amount numeric, doc_no text, recognized numeric, paid numeric, outstanding numeric,
    source_type text, source_id text, site text) on commit drop;
  truncate pg_temp.fin_alloc;
  for a in select value from jsonb_array_elements(p_input->'allocations') loop
    v_amount := round(nullif(a->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    select r.* into d from app_private.finance_payable_rows() r where r.id = (a->>'documentId')::uuid;
    if not found or d.supplier_id is distinct from v_supplier or d.project_id is distinct from v_project then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if v_amount > d.outstanding - d.pending_external + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_OVER_OUTSTANDING'; end if;
    perform 1 from public.supplier_payable_documents where id = d.id for update;
    insert into pg_temp.fin_alloc values (d.id, v_amount, d.document_no, d.recognized, d.paid, d.outstanding, d.source_type, d.source_id, d.construction_site_id);
  end loop;
  if exists (select 1 from pg_temp.fin_alloc group by doc_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
  select sum(amount), sum(recognized), min(site) into v_total, v_recognized, v_site from pg_temp.fin_alloc;
  if app_private.finance_period_is_locked(v_project, v_site, 'VND', v_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
  select name into v_name from public.business_partners where id = v_supplier;

  insert into public.supplier_payment_batches (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
    payment_date, payment_method, document_ref, total_recognized_snapshot, payment_amount, currency, allocation_mode, status,
    attachments, metadata, created_by, note)
  values (v_id, 'CNB-' || to_char(v_today, 'YYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 5)), v_project, v_site,
    v_supplier, v_name, v_date, v_method, v_ref, v_recognized, v_total, 'VND', 'manual', 'submitted',
    p_input->'attachments', jsonb_build_object('external', true, 'kind', 'external_payment'), v_actor, nullif(btrim(p_input->>'note'), ''));
  insert into public.supplier_payment_allocations (payment_batch_id, payable_document_id, source_type, source_id, document_no_snapshot,
    recognized_amount_snapshot, paid_before_snapshot, outstanding_before_snapshot, allocated_amount, allocation_mode, note)
  select v_id, doc_id, source_type, source_id, doc_no, recognized, paid, outstanding, amount, 'manual', 'Chi ngoài hệ thống' from pg_temp.fin_alloc;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('external_payment', v_id::text, v_supplier, 'external_payment_submit', v_actor,
    jsonb_build_object('amount', v_total, 'paymentDate', v_date, 'documentRef', v_ref, 'projectId', v_project,
      'documents', (select jsonb_agg(jsonb_build_object('documentNo', doc_no, 'amount', amount)) from pg_temp.fin_alloc)));
  return jsonb_build_object('paymentId', v_id, 'amount', v_total);
end $$;

create function public.decide_finance_external_payment_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_b public.supplier_payment_batches%rowtype;
begin
  select * into v_b from public.supplier_payment_batches where id = (p_input->>'paymentId')::uuid for update;
  if not found or not coalesce((v_b.metadata->>'external')::boolean, false) then
    raise exception using errcode = 'PT404', message = 'FINANCE_PAYMENT_NOT_FOUND'; end if;
  if v_b.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_action = 'withdraw' then
    if v_b.status <> 'submitted' or v_b.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.supplier_payment_batches set status = 'cancelled', metadata = metadata || jsonb_build_object('withdrawnAt', now()) where id = v_b.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_b.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_STATE'; end if;
    if v_b.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.supplier_payment_batches set status = 'cancelled',
        metadata = metadata || jsonb_build_object('rejection', jsonb_build_object('reason', v_reason, 'by', v_actor,
          'byName', app_private.finance_user_name(v_actor), 'at', now())) where id = v_b.id;
    else
      update public.supplier_payment_batches set approved_by = v_actor, approved_at = now() where id = v_b.id;
      perform set_config('app.finance_context', 'on', true);
      perform app_private.post_supplier_payment_batch(v_b.id, v_actor);
      perform set_config('app.finance_context', 'off', true);
    end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_b.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    perform set_config('app.finance_context', 'on', true);
    perform app_private.reverse_supplier_payment_batch(v_b.id, v_actor);
    perform set_config('app.finance_context', 'off', true);
    update public.supplier_payment_batches set metadata = metadata || jsonb_build_object('g7ReversalReason', v_reason) where id = v_b.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('external_payment', v_b.id::text, v_b.supplier_id, 'external_payment_' || v_action, v_actor, v_reason,
    jsonb_build_object('code', v_b.code, 'amount', v_b.payment_amount, 'documentRef', v_b.document_ref));
  select * into v_b from public.supplier_payment_batches where id = v_b.id;
  return jsonb_build_object('paymentId', v_b.id, 'status', v_b.status);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Đối chiếu đầu kỳ theo NCC × dự án
-- ---------------------------------------------------------------------------
create function app_private.finance_pre_cutover_outstanding(p_supplier_id text, p_project_id text, p_cutover date)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(r.outstanding), 0) from app_private.finance_payable_rows() r
  where r.supplier_id = p_supplier_id and r.project_id = p_project_id and r.document_date < p_cutover and r.source_type <> 'opening_balance';
$$;

create function public.save_finance_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_o public.finance_opening_reconciliations%rowtype;
  v_misa numeric := round(nullif(p_input->>'misaAmount', '')::numeric, 2); v_cutover date := (select ap_cutover_date from public.finance_settings where id = 1);
  v_reviewed uuid[] := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_input->'reviewedDocumentIds', '[]'::jsonb)) x), '{}');
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_misa is null or v_misa < 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if nullif(p_input->>'id', '') is null then
    if not exists (select 1 from public.business_partners where id = p_input->>'supplierId')
      or not exists (select 1 from public.projects where id = p_input->>'projectId') then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if exists (select 1 from public.finance_opening_reconciliations where supplier_id = p_input->>'supplierId' and project_id = p_input->>'projectId'
      and status in ('draft', 'submitted', 'rejected', 'confirmed')) then
      raise exception using errcode = '22023', message = 'FINANCE_OPENING_EXISTS'; end if;
    insert into public.finance_opening_reconciliations (supplier_id, project_id, cutover_date, misa_amount, note, attachments, reviewed_document_ids, created_by)
    values (p_input->>'supplierId', p_input->>'projectId', v_cutover, v_misa, nullif(btrim(p_input->>'note'), ''),
      coalesce(p_input->'attachments', '[]'::jsonb), v_reviewed, v_actor)
    returning * into v_o;
  else
    select * into v_o from public.finance_opening_reconciliations where id = (p_input->>'id')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_OPENING_NOT_FOUND'; end if;
    if v_o.status not in ('draft', 'rejected') then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if v_o.revision is distinct from nullif(p_input->>'expectedRevision', '')::integer then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    update public.finance_opening_reconciliations set misa_amount = v_misa, note = nullif(btrim(p_input->>'note'), ''),
      attachments = coalesce(p_input->'attachments', '[]'::jsonb), reviewed_document_ids = v_reviewed, status = 'draft', revision = revision + 1
    where id = v_o.id returning * into v_o;
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('opening', v_o.id::text, v_o.supplier_id, 'opening_save', v_actor,
    jsonb_build_object('projectId', v_o.project_id, 'misaAmount', v_o.misa_amount, 'reviewed', cardinality(v_o.reviewed_document_ids)));
  return jsonb_build_object('id', v_o.id, 'revision', v_o.revision);
end $$;

create function public.transition_finance_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_o public.finance_opening_reconciliations%rowtype;
  v_vioo numeric; v_doc uuid; v_site text; v_name text;
begin
  select * into v_o from public.finance_opening_reconciliations where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_OPENING_NOT_FOUND'; end if;
  if v_o.revision is distinct from nullif(p_input->>'expectedRevision', '')::integer then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  v_vioo := app_private.finance_pre_cutover_outstanding(v_o.supplier_id, v_o.project_id, v_o.cutover_date);

  if v_action = 'submit' then
    if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
    if v_o.status not in ('draft', 'rejected') then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if exists (select 1 from app_private.finance_payable_rows() r where r.supplier_id = v_o.supplier_id and r.project_id = v_o.project_id
        and r.document_date < v_o.cutover_date and (r.pending_external > 0 or 'pending_cancel' = any (r.issues))) then
      raise exception using errcode = '22023', message = 'FINANCE_OPENING_PENDING_ITEMS'; end if;
    if v_o.misa_amount < v_vioo - 0.005 then raise exception using errcode = '22023', message = 'FINANCE_OPENING_VIOO_HIGHER'; end if;
    update public.finance_opening_reconciliations set status = 'submitted', vioo_outstanding = v_vioo, opening_amount = misa_amount - v_vioo,
      submitted_by = v_actor, submitted_at = now(), revision = revision + 1, decision_note = null
    where id = v_o.id returning * into v_o;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_o.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if v_actor in (v_o.created_by, v_o.submitted_by) then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.finance_opening_reconciliations set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason,
        revision = revision + 1 where id = v_o.id returning * into v_o;
    else
      if abs(v_vioo - v_o.vioo_outstanding) > 0.005 then raise exception using errcode = '40001', message = 'FINANCE_OPENING_STALE'; end if;
      if v_o.opening_amount > 0 then
        select construction_site_id::text into v_site from public.projects where id = v_o.project_id;
        select name into v_name from public.business_partners where id = v_o.supplier_id;
        insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id,
          supplier_name_snapshot, document_no, document_date, committed_amount, recognized_amount, credit_amount, status, metadata, created_by)
        values ('AP-OPEN-' || replace(v_o.id::text, '-', ''), 'opening_balance', v_o.id::text, v_o.project_id, v_site, v_o.supplier_id,
          v_name, 'ĐK-' || to_char(v_o.cutover_date - 1, 'DDMMYY') || '-' || upper(left(replace(v_o.id::text, '-', ''), 5)),
          v_o.cutover_date - 1, v_o.opening_amount, v_o.opening_amount, 0, 'open',
          jsonb_build_object('origin', 'opening_reconciliation', 'reconciliationId', v_o.id, 'misaAmount', v_o.misa_amount,
            'viooOutstanding', v_o.vioo_outstanding), v_actor)
        returning id into v_doc;
      end if;
      update public.finance_opening_reconciliations set status = 'confirmed', decided_by = v_actor, decided_at = now(),
        decision_note = v_reason, opening_document_id = v_doc, revision = revision + 1 where id = v_o.id returning * into v_o;
    end if;
  elsif v_action = 'cancel' then
    -- Hủy phiên chưa chốt (người lập) hoặc đảo phiên đã chốt (người xác nhận, khi số dư đầu kỳ chưa được chi).
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if v_o.status in ('draft', 'rejected') then
      if v_o.created_by is distinct from v_actor and not app_private.finance_can('confirm') then
        raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    elsif v_o.status = 'confirmed' then
      if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
      if v_o.opening_document_id is not null then
        if exists (select 1 from public.supplier_payment_allocations a join public.supplier_payment_batches b on b.id = a.payment_batch_id
          where a.payable_document_id = v_o.opening_document_id and b.status in ('submitted', 'approved', 'paid')) then
          raise exception using errcode = '22023', message = 'FINANCE_OPENING_HAS_PAYMENTS'; end if;
        update public.supplier_payable_documents set status = 'cancelled',
          metadata = metadata || jsonb_build_object('cancel', jsonb_build_object('reason', v_reason, 'by', v_actor, 'at', now(), 'via', 'opening_reverse'))
        where id = v_o.opening_document_id;
      end if;
    else
      raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE';
    end if;
    update public.finance_opening_reconciliations set status = 'cancelled', decided_by = v_actor, decided_at = now(), decision_note = v_reason,
      revision = revision + 1 where id = v_o.id returning * into v_o;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('opening', v_o.id::text, v_o.supplier_id, 'opening_' || v_action, v_actor, v_reason,
    jsonb_build_object('projectId', v_o.project_id, 'misaAmount', v_o.misa_amount, 'viooOutstanding', v_vioo,
      'openingAmount', v_o.opening_amount, 'openingDocumentId', v_o.opening_document_id));
  return jsonb_build_object('id', v_o.id, 'status', v_o.status, 'revision', v_o.revision, 'openingDocumentId', v_o.opening_document_id);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Hủy công nợ (không phải nợ NCC)
-- ---------------------------------------------------------------------------
create function public.request_finance_payable_cancel_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_d record; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_id uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_d from app_private.finance_payable_rows() where id = (p_input->>'documentId')::uuid;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_DOCUMENT_NOT_FOUND'; end if;
  if v_d.paid > 0 or v_d.pending_external > 0 then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_HAS_PAYMENTS'; end if;
  insert into public.finance_payable_adjustments (payable_document_id, kind, reason, created_by)
  values (v_d.id, 'cancel', v_reason, v_actor) returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payable', v_d.id::text, v_d.supplier_id, 'cancel_request', v_actor, v_reason,
    jsonb_build_object('adjustmentId', v_id, 'documentNo', v_d.document_no, 'amount', v_d.outstanding));
  return jsonb_build_object('adjustmentId', v_id);
exception when unique_violation then
  raise exception using errcode = '22023', message = 'FINANCE_ADJUSTMENT_PENDING';
end $$;

create function public.decide_finance_payable_adjustment_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_j public.finance_payable_adjustments%rowtype; v_d record;
begin
  select * into v_j from public.finance_payable_adjustments where id = (p_input->>'adjustmentId')::uuid for update;
  if not found or v_j.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_ADJUSTMENT_STATE'; end if;
  select * into v_d from app_private.finance_payable_rows() where id = v_j.payable_document_id;
  if v_action = 'withdraw' then
    if v_j.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.finance_payable_adjustments set status = 'withdrawn', decided_by = v_actor, decided_at = now() where id = v_j.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_j.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.finance_payable_adjustments set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = v_j.id;
    else
      if v_d.id is null or v_d.paid > 0 or v_d.pending_external > 0 then
        raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_HAS_PAYMENTS'; end if;
      update public.supplier_payable_documents set status = 'cancelled',
        metadata = metadata || jsonb_build_object('cancel', jsonb_build_object('reason', v_j.reason, 'requestedBy', v_j.created_by,
          'confirmedBy', v_actor, 'at', now(), 'adjustmentId', v_j.id))
      where id = v_j.payable_document_id;
      update public.finance_payable_adjustments set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = v_j.id;
    end if;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payable', v_j.payable_document_id::text, v_d.supplier_id, 'cancel_' || v_action, v_actor, coalesce(v_reason, v_j.reason),
    jsonb_build_object('adjustmentId', v_j.id, 'documentNo', v_d.document_no, 'amount', v_d.outstanding));
  return jsonb_build_object('adjustmentId', v_j.id, 'action', v_action);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Thiết lập: hạn mặc định, ma trận duyệt chi (phiên bản), ủy quyền
-- ---------------------------------------------------------------------------
create function app_private.finance_notify_admins(p_title text, p_message text, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select u.id::text, 'info', 'finance', p_title, p_message, p_message, 'info', '🏦', '/#/finance?section=settings', 'finance_settings',
    'finance_settings:' || gen_random_uuid(), 'normal', true, '{}'::jsonb, 'responsible'
  from public.users u where u.id <> p_actor and coalesce(u.is_active, true)
    and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.manage'));
$$;

create function public.save_finance_settings_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype;
  v_days integer := nullif(p_input->>'defaultPaymentDays', '')::integer; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_days is null or v_days < 0 or v_days > 365 then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into v_set from public.finance_settings where id = 1 for update;
  if v_set.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.finance_settings set default_payment_days = v_days, row_version = row_version + 1, updated_by = v_actor, updated_at = now() where id = 1;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after)
  values ('settings', '1', 'settings_save', v_actor, v_reason, jsonb_build_object('defaultPaymentDays', v_set.default_payment_days),
    jsonb_build_object('defaultPaymentDays', v_days));
  if coalesce((p_input->>'applyToOpen')::boolean, false) then
    v_n := app_private.finance_recompute_due(null, null, array['default'], v_actor, v_reason);
  end if;
  perform app_private.finance_notify_admins('Đổi hạn thanh toán mặc định', v_set.default_payment_days || ' → ' || v_days || ' ngày: ' || v_reason, v_actor);
  return jsonb_build_object('defaultPaymentDays', v_days, 'recomputed', v_n);
end $$;

create function public.save_finance_approval_matrix_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_note text := nullif(btrim(p_input->>'note'), '');
  v_id uuid := gen_random_uuid(); v_no integer; r jsonb; s jsonb; v_prev_max numeric := 0; v_tier integer := 0; v_last boolean := false;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_note is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_input->'rules') is distinct from 'array' or jsonb_array_length(p_input->'rules') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_MATRIX_INVALID'; end if;
  select coalesce(max(version_no), 0) + 1 into v_no from public.finance_approval_matrix_versions;
  update public.finance_approval_matrix_versions set is_current = false where is_current;
  insert into public.finance_approval_matrix_versions (id, version_no, is_current, note, created_by) values (v_id, v_no, true, v_note, v_actor);
  for r in select value from jsonb_array_elements(p_input->'rules') loop
    v_tier := v_tier + 1;
    if v_last then raise exception using errcode = '22023', message = 'FINANCE_MATRIX_INVALID'; end if;
    -- Mức liền nhau từ 0, không chồng lấn; mức cuối không có trần.
    if coalesce(nullif(r->>'minAmount', '')::numeric, -1) <> v_prev_max then raise exception using errcode = '22023', message = 'FINANCE_MATRIX_GAP'; end if;
    if nullif(r->>'maxAmount', '') is null then v_last := true;
    elsif (r->>'maxAmount')::numeric <= v_prev_max then raise exception using errcode = '22023', message = 'FINANCE_MATRIX_INVALID';
    else v_prev_max := (r->>'maxAmount')::numeric; end if;
    if jsonb_typeof(r->'steps') is distinct from 'array' or jsonb_array_length(r->'steps') = 0 then
      raise exception using errcode = '22023', message = 'FINANCE_MATRIX_STEP_REQUIRED'; end if;
    for s in select value from jsonb_array_elements(r->'steps') loop
      if nullif(btrim(s->>'label'), '') is null or jsonb_typeof(s->'approverIds') is distinct from 'array' or jsonb_array_length(s->'approverIds') = 0
        or exists (select 1 from jsonb_array_elements_text(s->'approverIds') a
          where not exists (select 1 from public.users u where u.id = a::uuid and coalesce(u.is_active, true))) then
        raise exception using errcode = '22023', message = 'FINANCE_MATRIX_STEP_REQUIRED'; end if;
    end loop;
    insert into public.finance_approval_rules (version_id, tier_no, min_amount, max_amount, steps)
    values (v_id, v_tier, (r->>'minAmount')::numeric, nullif(r->>'maxAmount', '')::numeric,
      (select jsonb_agg(jsonb_build_object('label', btrim(x.value->>'label'), 'approverIds', x.value->'approverIds')) from jsonb_array_elements(r->'steps') x));
  end loop;
  if not v_last then raise exception using errcode = '22023', message = 'FINANCE_MATRIX_OPEN_END'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, after)
  values ('approval_matrix', v_id::text, 'matrix_save', v_actor, v_note, jsonb_build_object('versionNo', v_no, 'rules', p_input->'rules'));
  perform app_private.finance_notify_admins('Ma trận duyệt chi đổi sang phiên bản ' || v_no, v_note, v_actor);
  return jsonb_build_object('id', v_id, 'versionNo', v_no);
end $$;

create function public.save_finance_delegation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_from uuid := (p_input->>'fromUserId')::uuid; v_to uuid := (p_input->>'toUserId')::uuid;
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_id uuid; v_d public.finance_approval_delegations%rowtype;
begin
  if p_input->>'action' = 'revoke' then
    select * into v_d from public.finance_approval_delegations where id = (p_input->>'id')::uuid for update;
    if not found or v_d.revoked_at is not null then raise exception using errcode = '22023', message = 'FINANCE_DELEGATION_STATE'; end if;
    if not (app_private.finance_can('manage') or v_d.from_user_id = v_actor) then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_approval_delegations set revoked_by = v_actor, revoked_at = now(), revoke_reason = v_reason where id = v_d.id;
    insert into public.finance_events (entity_type, entity_id, action, actor_id, reason) values ('delegation', v_d.id::text, 'delegation_revoke', v_actor, v_reason);
    return jsonb_build_object('id', v_d.id);
  end if;
  if not (app_private.finance_can('manage') or v_from = v_actor) then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_from = v_to or not exists (select 1 from public.users where id = v_to and coalesce(is_active, true)) then
    raise exception using errcode = '22023', message = 'FINANCE_DELEGATION_INVALID'; end if;
  insert into public.finance_approval_delegations (from_user_id, to_user_id, valid_from, valid_to, reason, created_by)
  values (v_from, v_to, (p_input->>'validFrom')::date, (p_input->>'validTo')::date, v_reason, v_actor) returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, after)
  values ('delegation', v_id::text, 'delegation_create', v_actor, v_reason, p_input - 'action');
  perform app_private.finance_notify_admins('Ủy quyền duyệt chi mới', app_private.finance_user_name(v_from) || ' → ' || app_private.finance_user_name(v_to)
    || ' (' || (p_input->>'validFrom') || ' – ' || (p_input->>'validTo') || ')', v_actor);
  return jsonb_build_object('id', v_id);
exception when check_violation then
  raise exception using errcode = '22023', message = 'FINANCE_DELEGATION_INVALID';
end $$;

-- ---------------------------------------------------------------------------
-- 10. Quyền gọi hàm
-- ---------------------------------------------------------------------------
revoke all on function app_private.finance_can(text), app_private.finance_due_for(text, text, date), app_private.trg_supplier_payable_due(),
  app_private.guard_supplier_payable_direct_write(), app_private.trg_finance_events_immutable(), app_private.finance_user_name(uuid),
  app_private.finance_payable_rows(), app_private.finance_can_flags(), app_private.finance_recompute_due(text, text, text[], uuid, text),
  app_private.finance_pre_cutover_outstanding(text, text, date), app_private.finance_notify_admins(text, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.finance_can(text) to authenticated;
revoke all on function public.list_finance_payables_v1(jsonb), public.get_finance_supplier_v1(text), public.list_finance_pending_statements_v1(),
  public.get_finance_settings_v1(), public.save_finance_supplier_terms_v1(jsonb), public.save_finance_contract_terms_v1(jsonb),
  public.set_finance_payable_due_v1(jsonb), public.save_finance_external_payment_v1(jsonb), public.decide_finance_external_payment_v1(jsonb),
  public.save_finance_opening_v1(jsonb), public.transition_finance_opening_v1(jsonb), public.request_finance_payable_cancel_v1(jsonb),
  public.decide_finance_payable_adjustment_v1(jsonb), public.save_finance_settings_v1(jsonb), public.save_finance_approval_matrix_v1(jsonb),
  public.save_finance_delegation_v1(jsonb) from public, anon;
grant execute on function public.list_finance_payables_v1(jsonb), public.get_finance_supplier_v1(text), public.list_finance_pending_statements_v1(),
  public.get_finance_settings_v1(), public.save_finance_supplier_terms_v1(jsonb), public.save_finance_contract_terms_v1(jsonb),
  public.set_finance_payable_due_v1(jsonb), public.save_finance_external_payment_v1(jsonb), public.decide_finance_external_payment_v1(jsonb),
  public.save_finance_opening_v1(jsonb), public.transition_finance_opening_v1(jsonb), public.request_finance_payable_cancel_v1(jsonb),
  public.decide_finance_payable_adjustment_v1(jsonb), public.save_finance_settings_v1(jsonb), public.save_finance_approval_matrix_v1(jsonb),
  public.save_finance_delegation_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
