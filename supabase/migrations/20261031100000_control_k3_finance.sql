-- Kiểm soát viên K3 đợt 2 — phủ luật sang phân hệ Tài chính (10 luật, chạy thử shadow).
--   Phạm vi: công nợ NCC ở mức chứng từ, đề nghị chi, ngân sách dự án, thu chi tiền.
--   Trạng thái dữ liệu prod 24/10: công nợ NCC có 60 chứng từ (7,4 tỷ ghi nhận) nhưng CHƯA ghi một đồng thanh toán nào;
--   đề nghị chi / ngân sách / thu chi tiền đều RỖNG. Nên chỉ `payable_recognized_over_committed` có lệch thật (3 ca);
--   9 luật còn lại là luật canh — đúng/sai được chứng minh bằng ca dựng trong smoke, không chờ có dữ liệu thật.
--   Chỉ viết luật cho bất biến mà CSDL không tự chặn được (số tiền > 0, chuyển cùng tài khoản, một ngân sách approved
--   mỗi dự án… đã có CHECK / unique index lo).
-- Không đổi bảng, không đổi bộ chạy — chỉ thêm 10 hàm luật + 10 dòng control_rules.

-- ── 1. Nợ ghi nhận vượt cam kết (3 lệch thật: 98,2 tr + 25,2 tr + 34 ng) ───────────────────────────────────────────
create or replace function app_private.control_rule_payable_over_committed()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'payovercommit:' || d.id::text, 'supplier_payable_document', d.id::text, coalesce(nullif(d.document_no, ''), d.code),
    d.project_id, null::text,
    format('%s · %s: nợ ghi nhận %s đ vượt cam kết %s đ — chênh %s đ',
      coalesce(nullif(d.document_no, ''), d.code), coalesce(d.supplier_name_snapshot, '—'),
      to_char(d.recognized_amount, 'FM999G999G999G990'), to_char(d.committed_amount, 'FM999G999G999G990'),
      to_char(d.recognized_amount - d.committed_amount, 'FM999G999G999G990')),
    jsonb_build_object('ncc', d.supplier_name_snapshot, 'cam_ket', d.committed_amount, 'ghi_nhan', d.recognized_amount,
      'chenh', d.recognized_amount - d.committed_amount, 'nguon', d.source_type, 'trang_thai', d.status),
    d.recognized_amount - d.committed_amount, d.document_date,
    '/finance/payables' || coalesce('?supplier=' || d.supplier_id, '')
  from public.supplier_payable_documents d
  where d.status in ('open', 'partial', 'paid')
    and coalesce(d.committed_amount, 0) > 0
    and coalesce(d.recognized_amount, 0) > coalesce(d.committed_amount, 0) + 1;
$$;

-- ── 2. Trả / giảm trừ vượt phần phải trả ───────────────────────────────────────────────────────────────────────────
--   `outstanding_amount` của view đã GREATEST(0, …) nên không bao giờ âm — phải tính lại từ các thành phần gốc.
create or replace function app_private.control_rule_payable_over_settled()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'payoversettle:' || b.id::text, 'supplier_payable_document', b.id::text, coalesce(nullif(b.document_no, ''), b.code),
    b.project_id, null::text,
    format('%s · %s: đã trả + giảm trừ %s đ, vượt giá trị ghi nhận %s đ — thừa %s đ (%s)',
      coalesce(nullif(b.document_no, ''), b.code), coalesce(b.supplier_name_snapshot, '—'),
      to_char(v.settled, 'FM999G999G999G990'), to_char(coalesce(b.recognized_amount, 0), 'FM999G999G999G990'),
      to_char(v.thua, 'FM999G999G999G990'), v.ca),
    jsonb_build_object('ncc', b.supplier_name_snapshot, 'ghi_nhan', b.recognized_amount,
      'da_tra', b.paid_amount, 'giam_tru_chung_tu', b.credit_amount, 'giam_tru_khi_tra', b.allocation_credit_amount,
      'da_tat_toan', v.settled, 'thua', v.thua, 'ca', v.ca),
    v.thua, b.document_date,
    '/finance/payables' || coalesce('?supplier=' || b.supplier_id, '')
  from public.supplier_payable_document_balances b
  cross join lateral (
    select coalesce(b.paid_amount, 0) + coalesce(b.credit_amount, 0) + coalesce(b.allocation_credit_amount, 0) settled,
      coalesce(b.paid_amount, 0) + coalesce(b.credit_amount, 0) + coalesce(b.allocation_credit_amount, 0) - coalesce(b.recognized_amount, 0) thua,
      case when coalesce(b.paid_amount, 0) > coalesce(b.recognized_amount, 0) then 'trả vượt' else 'giảm trừ vượt' end ca
  ) v
  where b.status <> 'cancelled' and v.thua > 1;
$$;

-- ── 3. Trạng thái chứng từ nợ không khớp số còn nợ ─────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_payable_status_vs_balance()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'paystatus:' || b.id::text, 'supplier_payable_document', b.id::text, coalesce(nullif(b.document_no, ''), b.code),
    b.project_id, null::text,
    format('%s · %s: trạng thái "%s" nhưng còn nợ %s đ',
      coalesce(nullif(b.document_no, ''), b.code), coalesce(b.supplier_name_snapshot, '—'), b.status,
      to_char(coalesce(b.outstanding_amount, 0), 'FM999G999G999G990')),
    jsonb_build_object('ncc', b.supplier_name_snapshot, 'trang_thai', b.status, 'con_no', b.outstanding_amount,
      'ghi_nhan', b.recognized_amount, 'da_tra', b.paid_amount,
      'ca', case when b.status = 'paid' then 'đã trả xong mà còn dư' else 'còn nợ mà số dư đã hết' end),
    abs(coalesce(b.outstanding_amount, 0)), b.document_date,
    '/finance/payables' || coalesce('?supplier=' || b.supplier_id, '')
  from public.supplier_payable_document_balances b
  where (b.status = 'paid' and coalesce(b.outstanding_amount, 0) > 1)
     or (b.status in ('open', 'partial') and coalesce(b.outstanding_amount, 0) <= 1 and coalesce(b.recognized_amount, 0) > 1);
$$;

-- ── 4. Chứng từ nợ còn dư mà không có hạn trả (không dự báo chi được) ──────────────────────────────────────────────
create or replace function app_private.control_rule_payable_no_due_date()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'paynodue:' || b.id::text, 'supplier_payable_document', b.id::text, coalesce(nullif(b.document_no, ''), b.code),
    b.project_id, null::text,
    format('%s · %s: còn nợ %s đ nhưng chưa có hạn trả',
      coalesce(nullif(b.document_no, ''), b.code), coalesce(b.supplier_name_snapshot, '—'),
      to_char(b.outstanding_amount, 'FM999G999G999G990')),
    jsonb_build_object('ncc', b.supplier_name_snapshot, 'con_no', b.outstanding_amount, 'ngay_chung_tu', b.document_date,
      'nguon', b.source_type),
    b.outstanding_amount, b.document_date,
    '/finance/payables' || coalesce('?supplier=' || b.supplier_id, '')
  from public.supplier_payable_document_balances b
  where b.status in ('open', 'partial') and b.due_date is null and coalesce(b.outstanding_amount, 0) > 1;
$$;

-- ── 5. Chứng từ nợ trỏ tới nguồn không còn ─────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_payable_orphan_source()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'payorphan:' || d.id::text, 'supplier_payable_document', d.id::text, coalesce(nullif(d.document_no, ''), d.code),
    d.project_id, null::text,
    format('%s · %s: chứng từ nợ %s đ trỏ tới %s không còn trong hệ thống',
      coalesce(nullif(d.document_no, ''), d.code), coalesce(d.supplier_name_snapshot, '—'),
      to_char(d.recognized_amount, 'FM999G999G999G990'),
      case d.source_type when 'purchase_delivery_receipt' then 'đợt giao hàng' else 'bảng đối soát' end),
    jsonb_build_object('ncc', d.supplier_name_snapshot, 'nguon', d.source_type, 'ma_nguon', d.source_id,
      'ghi_nhan', d.recognized_amount, 'trang_thai', d.status),
    d.recognized_amount, d.document_date,
    '/finance/payables' || coalesce('?supplier=' || d.supplier_id, '')
  from public.supplier_payable_documents d
  where d.status <> 'cancelled' and d.source_id is not null
    and ((d.source_type = 'purchase_delivery_receipt'
          and not exists (select 1 from public.purchase_order_delivery_batches x where x.id::text = d.source_id))
      or (d.source_type = 'supplier_delivery_statement'
          and not exists (select 1 from public.supplier_delivery_statements x where x.id::text = d.source_id)));
$$;

-- ── 6. Số tiền đề nghị chi khác tổng các dòng ──────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_pr_amount_vs_lines()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'pramount:' || r.id::text, 'finance_payment_request', r.id::text, r.code, r.project_id, null::text,
    format('Đề nghị chi %s: số tiền %s đ khác tổng %s dòng (%s đ)',
      r.code, to_char(r.amount, 'FM999G999G999G990'), v.n, to_char(v.total, 'FM999G999G999G990')),
    jsonb_build_object('ncc', r.supplier_name, 'so_tien', r.amount, 'tong_dong', v.total, 'so_dong', v.n,
      'chenh', r.amount - v.total, 'trang_thai', r.status),
    abs(r.amount - v.total), (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Ho_Chi_Minh')::date,
    '/finance/requests?request=' || r.id::text
  from public.finance_payment_requests r
  cross join lateral (select coalesce(sum(l.amount), 0) total, count(*) n
    from public.finance_payment_request_lines l where l.request_id = r.id) v
  where r.kind = 'payable' and r.status in ('pending', 'returned', 'approved', 'paid')
    and v.n > 0 and abs(r.amount - v.total) > 1;
$$;

-- ── 7. Đang đề nghị chi vượt số còn nợ của chứng từ ────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_pr_over_outstanding()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'proverout:' || b.id::text, 'supplier_payable_document', b.id::text, coalesce(nullif(b.document_no, ''), b.code),
    b.project_id, null::text,
    format('%s · %s: đang đề nghị chi %s đ nhưng chỉ còn nợ %s đ',
      coalesce(nullif(b.document_no, ''), b.code), coalesce(b.supplier_name_snapshot, '—'),
      to_char(v.total, 'FM999G999G999G990'), to_char(coalesce(b.outstanding_amount, 0), 'FM999G999G999G990')),
    jsonb_build_object('ncc', b.supplier_name_snapshot, 'dang_de_nghi', v.total, 'con_no', b.outstanding_amount,
      'vuot', v.total - coalesce(b.outstanding_amount, 0), 'cac_de_nghi', v.codes),
    v.total - coalesce(b.outstanding_amount, 0), b.document_date,
    '/finance/payables' || coalesce('?supplier=' || b.supplier_id, '')
  from public.supplier_payable_document_balances b
  cross join lateral (select coalesce(sum(l.amount), 0) total, jsonb_agg(distinct r.code) codes
    from public.finance_payment_request_lines l
    join public.finance_payment_requests r on r.id = l.request_id
    where l.payable_document_id = b.id and r.status in ('pending', 'returned', 'approved')) v
  where v.total > coalesce(b.outstanding_amount, 0) + 1;
$$;

-- ── 8. Đề nghị chi treo ở bước duyệt quá 3 ngày ────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_pr_stuck_pending()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'prstuck:' || r.id::text, 'finance_payment_request', r.id::text, r.code, r.project_id, null::text,
    format('Đề nghị chi %s (%s đ) chờ duyệt %s ngày ở bước "%s"',
      r.code, to_char(r.amount, 'FM999G999G999G990'),
      (current_date - (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Ho_Chi_Minh')::date),
      coalesce(r.route -> r.current_step ->> 'label', 'duyệt')),
    jsonb_build_object('ncc', r.supplier_name, 'so_tien', r.amount, 'buoc', r.current_step,
      'ten_buoc', r.route -> r.current_step ->> 'label',
      'so_ngay', current_date - (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Ho_Chi_Minh')::date,
      'ngay_du_kien_chi', r.planned_date),
    r.amount, (coalesce(r.submitted_at, r.created_at) at time zone 'Asia/Ho_Chi_Minh')::date,
    '/finance/requests?request=' || r.id::text
  from public.finance_payment_requests r
  where r.status = 'pending' and coalesce(r.submitted_at, r.created_at) < now() - interval '3 days';
$$;

-- ── 9. Tổng ngân sách khác tổng các dòng ───────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_budget_total_vs_lines()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'budgettotal:' || b.id::text, 'finance_project_budget', b.id::text,
    coalesce(nullif(p.code, ''), p.name, b.project_id) || ' · bản ' || b.version_no, b.project_id, null::text,
    format('Ngân sách %s bản %s: tổng chi phí khác %s đ so với tổng %s dòng (%s đ)',
      coalesce(nullif(p.code, ''), p.name, '—'), b.version_no,
      to_char(coalesce(b.other_total, 0), 'FM999G999G999G990'), v.n, to_char(v.total, 'FM999G999G999G990')),
    jsonb_build_object('tong_ghi', b.other_total, 'tong_dong', v.total, 'so_dong', v.n,
      'chenh', coalesce(b.other_total, 0) - v.total, 'trang_thai', b.status),
    abs(coalesce(b.other_total, 0) - v.total), (b.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
    '/finance/cost' || coalesce('?project=' || b.project_id, '')
  from public.finance_project_budgets b
  left join public.projects p on p.id = b.project_id
  cross join lateral (select coalesce(sum(l.amount), 0) total, count(*) n
    from public.finance_project_budget_lines l where l.budget_id = b.id) v
  where b.status in ('submitted', 'approved') and abs(coalesce(b.other_total, 0) - v.total) > 1;
$$;

-- ── 10. Phiếu tiền và sổ quỹ không khớp ────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_rule_cash_entry_mismatch()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
  title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'cashmove:' || m.id::text, 'finance_cash_movement', m.id::text, m.code, m.project_id, null::text,
    case when m.reversed_at is null
      then format('Phiếu tiền %s (%s đ) đã xác nhận nhưng chưa vào sổ quỹ', m.code, to_char(m.amount, 'FM999G999G999G990'))
      else format('Phiếu tiền %s (%s đ) đã đảo nhưng sổ quỹ còn %s dòng hiệu lực', m.code, to_char(m.amount, 'FM999G999G999G990'), v.live)
    end,
    jsonb_build_object('loai', m.kind, 'so_tien', m.amount, 'trang_thai', m.status,
      'so_dong_so_quy', v.n, 'so_dong_con_hieu_luc', v.live, 'da_dao', m.reversed_at is not null,
      'ca', case when m.reversed_at is null then 'chưa vào sổ quỹ' else 'đã đảo mà sổ quỹ chưa đảo' end),
    m.amount, m.movement_date, '/finance/cash'
  from public.finance_cash_movements m
  cross join lateral (select count(*) n,
      count(*) filter (where e.reversal_of is null
        and not exists (select 1 from public.finance_cash_entries y where y.reversal_of = e.id)) live
    from public.finance_cash_entries e
    where e.source_type in ('cash_movement', 'cash_transfer') and e.source_id = m.id::text) v
  where (m.status = 'confirmed' and m.reversed_at is null and v.live = 0)
     or (m.reversed_at is not null and v.live > 0);
$$;

-- ── Danh mục luật K3 đợt 2 (mặc định shadow: chưa báo ai) ──────────────────────────────────────────────────────────
insert into public.control_rules (code, module, module_key, title, principle, fix_hint, owner_hint, severity, fn, route, sort_order) values
  ('payable_over_committed', 'Công nợ', 'FINANCE', 'Nợ ghi nhận vượt cam kết',
    'Nợ NCC ghi nhận không được vượt giá trị đã cam kết trên đơn / hợp đồng; vượt là nhận dư, đổi giá hoặc tính sai mà chưa có chứng từ điều chỉnh.',
    'Kế toán đối chiếu đơn và phiếu giao: nhận dư thật thì ghi điều chỉnh cam kết có lý do, tính sai thì sửa giá trị chứng từ nợ.',
    'Kế toán công nợ', 'P1', 'control_rule_payable_over_committed', '{payable}', 280),
  ('payable_over_settled', 'Công nợ', 'FINANCE', 'Trả / giảm trừ vượt phần phải trả',
    'Tổng đã trả + các khoản giảm trừ của một chứng từ nợ không được vượt giá trị ghi nhận; vượt là trả trùng, phân bổ sai chứng từ, hoặc ghi giảm trừ quá tay. Màn công nợ hiển thị số còn nợ đã chặn ở 0 nên phần thừa không tự hiện ra.',
    'Kế toán mở chứng từ, kiểm các lần trả đã phân bổ và các khoản giảm trừ; trả trùng thì đảo phân bổ, giảm trừ quá thì sửa chứng từ giảm trừ.',
    'Kế toán công nợ', 'P0', 'control_rule_payable_over_settled', '{payable}', 290),
  ('payable_status_vs_balance', 'Công nợ', 'FINANCE', 'Trạng thái chứng từ nợ không khớp số còn nợ',
    'Chứng từ "đã trả" phải hết dư, chứng từ "còn nợ" phải còn dư — báo cáo công nợ và dự báo chi đọc theo trạng thái.',
    'Kế toán mở chứng từ và chạy lại chốt trạng thái; lệch do phân bổ tay thì sửa phân bổ.',
    'Kế toán công nợ', 'P0', 'control_rule_payable_status_vs_balance', '{payable}', 300),
  ('payable_no_due_date', 'Công nợ', 'FINANCE', 'Chứng từ nợ còn dư mà chưa có hạn trả',
    'Mọi khoản còn nợ phải có hạn trả, nếu không sẽ rơi khỏi dự báo dòng tiền và không ai biết khi nào phải chi.',
    'Kế toán đặt hạn trả theo hợp đồng / điều khoản NCC, hoặc ghi hạn thủ công có căn cứ.',
    'Kế toán công nợ', 'P1', 'control_rule_payable_no_due_date', '{payable}', 310),
  ('payable_orphan_source', 'Công nợ', 'FINANCE', 'Chứng từ nợ trỏ tới nguồn không còn',
    'Mỗi chứng từ nợ phải lần được về đợt giao / bảng đối soát sinh ra nó; mất nguồn là không còn đối chiếu được.',
    'Báo Admin tìm nguồn đã bị xóa; nếu khoản nợ vẫn đúng thì chuyển sang chứng từ điều chỉnh tay có lý do.',
    'Kế toán công nợ + Admin', 'P0', 'control_rule_payable_orphan_source', '{payable}', 320),
  ('pr_amount_vs_lines', 'Tài chính', 'FINANCE', 'Số tiền đề nghị chi khác tổng các dòng',
    'Số tiền đề nghị chi phải bằng tổng các dòng chứng từ nợ được chọn; lệch là duyệt một số rồi chi một số khác.',
    'Mở đề nghị chi, chọn lại dòng hoặc sửa số tiền cho khớp rồi gửi lại.',
    'Kế toán công nợ', 'P0', 'control_rule_pr_amount_vs_lines', '{payable}', 330),
  ('pr_over_outstanding', 'Tài chính', 'FINANCE', 'Đang đề nghị chi vượt số còn nợ',
    'Tổng các đề nghị chi còn hiệu lực trên một chứng từ nợ không vượt số còn nợ; vượt là chi trùng.',
    'Kế toán kiểm các đề nghị chi đang mở của chứng từ; bỏ đề nghị trùng hoặc giảm số tiền.',
    'Kế toán công nợ', 'P0', 'control_rule_pr_over_outstanding', '{payable}', 340),
  ('pr_stuck_pending', 'Tài chính', 'FINANCE', 'Đề nghị chi treo ở bước duyệt quá lâu',
    'Đề nghị chi treo làm chậm trả NCC và sai dự báo dòng tiền; phải duyệt, trả lại hoặc rút.',
    'Nhắc người duyệt ở bước đang treo; không chi nữa thì rút đề nghị có lý do.',
    'Kế toán công nợ', 'P2', 'control_rule_pr_stuck_pending', '{payable}', 350),
  ('budget_total_vs_lines', 'Tài chính', 'FINANCE', 'Tổng ngân sách khác tổng các dòng',
    'Tổng chi phí của một bản ngân sách phải bằng tổng các dòng khoản mục; lệch là dòng bị sửa ngoài lệnh lưu.',
    'Mở ngân sách dự án, lập bản mới với các dòng đúng (bản cũ tự thành phiên bản trước).',
    'Kế toán chi phí', 'P1', 'control_rule_budget_total_vs_lines', '{payable}', 360),
  ('cash_entry_mismatch', 'Tài chính', 'FINANCE', 'Phiếu tiền và sổ quỹ không khớp',
    'Phiếu tiền đã xác nhận phải có bút toán trong sổ quỹ, phiếu đã đảo phải có bút toán đảo — số dư quỹ đọc từ sổ.',
    'Báo Admin chạy lại ghi sổ cho phiếu; không ghi tay bút toán quỹ để bù.',
    'Kế toán + Admin', 'P0', 'control_rule_cash_entry_mismatch', '{payable}', 370)
on conflict (code) do update set module = excluded.module, module_key = excluded.module_key, title = excluded.title,
  principle = excluded.principle, fix_hint = excluded.fix_hint, owner_hint = excluded.owner_hint,
  severity = excluded.severity, fn = excluded.fn, route = excluded.route, sort_order = excluded.sort_order, updated_at = now();

-- Quyền: như K0 — hàm luật chỉ bộ chạy (security definer) dùng, không mở cho người dùng.
do $$
declare fx record;
begin
  for fx in select n.nspname, pr.proname from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'app_private' and pr.proname in ('control_rule_payable_over_committed', 'control_rule_payable_over_settled',
      'control_rule_payable_status_vs_balance', 'control_rule_payable_no_due_date', 'control_rule_payable_orphan_source',
      'control_rule_pr_amount_vs_lines', 'control_rule_pr_over_outstanding', 'control_rule_pr_stuck_pending',
      'control_rule_budget_total_vs_lines', 'control_rule_cash_entry_mismatch') loop
    execute format('revoke all on function %I.%I() from public, anon, authenticated', fx.nspname, fx.proname);
  end loop;
end $$;

-- Chạy ngay để sổ phát hiện có số lệch thật cho Admin xem (shadow: không báo ai).
select app_private.control_run(code, 'migration') from public.control_rules
where code in ('payable_over_committed', 'payable_over_settled', 'payable_status_vs_balance', 'payable_no_due_date',
  'payable_orphan_source', 'pr_amount_vs_lines', 'pr_over_outstanding', 'pr_stuck_pending',
  'budget_total_vs_lines', 'cash_entry_mismatch');
