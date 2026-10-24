-- Kiểm soát viên K3 đợt 2 (Tài chính): 10 luật trên dữ liệu thật + ca dựng, giao dịch tự hủy.
-- Prod 24/10 chỉ có công nợ NCC (60 chứng từ, 0 lần trả); đề nghị chi / ngân sách / thu chi tiền còn rỗng.
-- Nên 9 luật canh được chứng minh bằng ca dựng trong chính giao dịch này, không chờ có dữ liệu thật.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261031100000_control_k3_finance.sql --smoke supabase/tests/control_k3_finance_smoke.sql
begin;
create temp table k3f(buoc text primary key, ket_qua text) on commit drop;

do $$
declare
  r record; n bigint; dup bigint; res jsonb; v_mode text; v_before bigint; v_after bigint;
  v_user uuid; v_project text; v_fund uuid; v_cost uuid;
  v_doc uuid; v_supplier text; v_out numeric; v_rec numeric;
  v_pr uuid; v_budget uuid; v_move uuid;
begin
  -- ── 1. Mọi luật chạy không lỗi, object_key không trùng, đường dẫn mở được màn Tài chính ──
  for r in select code, fn from public.control_rules where module_key = 'FINANCE' and sort_order between 280 and 370 order by sort_order loop
    execute format('select count(*), count(*) - count(distinct object_key) from app_private.%I()', r.fn) into n, dup;
    if dup > 0 then raise exception 'FAIL 1 luật % có % object_key trùng', r.code, dup; end if;
    execute format('select count(*) from app_private.%I() where link is null or link not like ''/finance%%''', r.fn) into dup;
    if dup > 0 then raise exception 'FAIL 1b luật % có % dòng thiếu đường dẫn Tài chính', r.code, dup; end if;
    insert into k3f values ('luat:' || r.code, n || ' dòng');
  end loop;

  -- ── 2. Cả 10 luật phải ở shadow: chưa báo ai ──
  select string_agg(distinct mode, ',') into v_mode from public.control_rules where module_key = 'FINANCE' and sort_order between 280 and 370;
  if v_mode <> 'shadow' then raise exception 'FAIL 2 luật K3 Tài chính phải ở shadow, đang %', v_mode; end if;
  insert into k3f values ('che_do', v_mode);

  -- ── 3. Luật duy nhất có lệch thật hôm nay: nợ ghi nhận vượt cam kết ──
  select count(*) into n from app_private.control_rule_payable_over_committed();
  if n = 0 then raise exception 'FAIL 3 luật vượt cam kết không bắt được chứng từ nào'; end if;
  insert into k3f values ('vuot_cam_ket', n || ' chứng từ, '
    || (select to_char(sum(amount), 'FM999G999G999G990') from app_private.control_rule_payable_over_committed()) || ' đ');

  -- ── 4. Ghi lại hiện trạng dữ liệu Tài chính để lần sau so (9 luật canh = 0 vì chưa có dữ liệu) ──
  insert into k3f values ('hien_trang',
    (select count(*) from public.supplier_payable_documents) || ' chứng từ nợ · '
    || (select count(*) from public.supplier_payment_allocations) || ' lần trả · '
    || (select count(*) from public.finance_payment_requests) || ' đề nghị chi · '
    || (select count(*) from public.finance_project_budgets) || ' ngân sách · '
    || (select count(*) from public.finance_cash_movements) || ' phiếu tiền');

  -- ── 5. Bộ chạy trên dữ liệu thật SẠCH (phải chạy trước khi dựng ca, vì dữ liệu dựng làm luật live cũ báo): mọi luật chạy sạch, chạy lần hai không mở trùng, luật shadow không sinh thông báo ──
  select count(*) into v_before from public.notifications;
  res := app_private.control_run(null, 'smoke');
  if jsonb_array_length(res->'errors') > 0 then raise exception 'FAIL 5 bộ chạy lỗi: %', res->'errors'; end if;
  select count(*) into n from public.control_findings f join public.control_rules x on x.code = f.rule_code
    where x.module_key = 'FINANCE' and x.sort_order between 280 and 370 and f.status = 'open';
  if n = 0 then raise exception 'FAIL 5b sổ phát hiện không có lệch Tài chính nào'; end if;
  res := app_private.control_run(null, 'smoke');
  select count(*) into v_after from public.control_findings f join public.control_rules x on x.code = f.rule_code
    where x.module_key = 'FINANCE' and x.sort_order between 280 and 370 and f.status = 'open';
  if v_after <> n then raise exception 'FAIL 5c chạy lần hai đổi số lệch: % -> %', n, v_after; end if;
  select count(*) into v_after from public.notifications;
  if v_after <> v_before then raise exception 'FAIL 5d luật shadow sinh % thông báo', v_after - v_before; end if;
  if exists (select 1 from public.control_findings f join public.control_rules x on x.code = f.rule_code
             where x.module_key = 'FINANCE' and x.sort_order between 280 and 370 and f.notified_at is not null) then
    raise exception 'FAIL 5e luật Tài chính đang shadow mà đã báo người xử lý'; end if;
  insert into k3f values ('bo_chay', n || ' lệch mở trên dữ liệu thật, chạy lại không trùng, không báo ai');
  -- ── 6. Ca dựng: chứng minh từng luật canh bắt đúng (giao dịch tự hủy nên không để lại gì) ──
  select id into v_user from public.users where is_active and account_status = 'ACTIVE' order by created_at limit 1;
  select id into v_project from public.projects order by created_at limit 1;
  select id into v_fund from public.cash_funds limit 1;
  select id into v_cost from public.contract_cost_items limit 1;
  select b.id, b.supplier_id, b.outstanding_amount, b.recognized_amount into v_doc, v_supplier, v_out, v_rec
  from public.supplier_payable_document_balances b
  where b.status = 'open' and b.source_type = 'purchase_delivery_receipt' and b.outstanding_amount > 1000000
  order by b.outstanding_amount desc limit 1;
  if v_user is null or v_project is null or v_fund is null or v_cost is null or v_doc is null then
    raise exception 'FAIL 6 thiếu dữ liệu nền dựng ca thử (user %, dự án %, quỹ %, khoản mục %, chứng từ nợ %)',
      v_user, v_project, v_fund, v_cost, v_doc; end if;

  -- 5a. Trạng thái "đã trả" mà còn dư → luật phải bắt; đưa về "open" thì phải sạch.
  update public.supplier_payable_documents set status = 'paid' where id = v_doc;
  if not exists (select 1 from app_private.control_rule_payable_status_vs_balance() where object_id = v_doc::text) then
    raise exception 'FAIL 6a luật trạng thái không bắt ca "đã trả mà còn dư"'; end if;
  update public.supplier_payable_documents set status = 'open' where id = v_doc;
  if exists (select 1 from app_private.control_rule_payable_status_vs_balance() where object_id = v_doc::text) then
    raise exception 'FAIL 6a2 luật trạng thái báo nhầm chứng từ bình thường'; end if;
  insert into k3f values ('ca_dung:trang_thai_vs_so_du', 'bắt đúng, bình thường thì sạch');

  -- 5b. Giảm trừ vượt giá trị ghi nhận. `outstanding_amount` của view đã chặn ở 0 nên màn công nợ KHÔNG hiện phần
  -- thừa này — luật phải tự tính lại từ các thành phần gốc mới thấy (đã sửa 24/10 sau khi ca dựng bắt lỗi).
  if exists (select 1 from app_private.control_rule_payable_over_settled() where object_id = v_doc::text) then
    raise exception 'FAIL 6b0 chứng từ nền đã bị báo trước khi dựng ca'; end if;
  update public.supplier_payable_documents set credit_amount = v_rec + 1000000 where id = v_doc;
  if (select outstanding_amount from public.supplier_payable_document_balances where id = v_doc) <> 0 then
    raise exception 'FAIL 6b1 view không còn chặn số còn nợ ở 0 — xem lại luật'; end if;
  if not exists (select 1 from app_private.control_rule_payable_over_settled() where object_id = v_doc::text) then
    raise exception 'FAIL 6b luật trả / giảm trừ vượt không bắt ca giảm trừ vượt'; end if;
  if not exists (select 1 from app_private.control_rule_payable_over_settled()
                 where object_id = v_doc::text and detail->>'ca' = 'giảm trừ vượt' and amount > 999999) then
    raise exception 'FAIL 6b2 luật trả / giảm trừ vượt ghi sai nguyên nhân hoặc sai số thừa'; end if;
  update public.supplier_payable_documents set credit_amount = 0 where id = v_doc;
  if exists (select 1 from app_private.control_rule_payable_over_settled() where object_id = v_doc::text) then
    raise exception 'FAIL 6b3 luật vẫn báo sau khi bỏ giảm trừ'; end if;
  insert into k3f values ('ca_dung:tra_giam_tru_vuot', 'bắt đúng (view chặn ở 0 vẫn thấy), bỏ ra thì sạch');

  -- 5c. Chứng từ nợ trỏ nguồn không còn.
  update public.supplier_payable_documents set source_id = gen_random_uuid()::text where id = v_doc;
  if not exists (select 1 from app_private.control_rule_payable_orphan_source() where object_id = v_doc::text) then
    raise exception 'FAIL 6c luật mất nguồn không bắt'; end if;
  insert into k3f values ('ca_dung:mat_nguon', 'bắt đúng');

  -- 5d. Đề nghị chi: số tiền khác tổng dòng + dòng vượt số còn nợ + treo duyệt quá 3 ngày.
  insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, planned_date, amount, note, status,
    threshold_amount, current_step, route, kind, project_id, created_by, submitted_at)
  values ('KSTEST-PR-1', v_supplier, 'NCC thử', 'bank_transfer', current_date + 7, v_out + 5000000, 'ca dựng kiểm soát', 'pending',
    0, 0, jsonb_build_array(jsonb_build_object('label', 'Kế toán trưởng')), 'payable', v_project, v_user, now() - interval '10 days')
  returning id into v_pr;
  insert into public.finance_payment_request_lines (request_id, payable_document_id, project_id, document_no, outstanding_snapshot, amount)
  values (v_pr, v_doc, v_project, 'ca dựng', v_out, v_out + 1000000);
  if not exists (select 1 from app_private.control_rule_pr_amount_vs_lines() where object_id = v_pr::text) then
    raise exception 'FAIL 6d luật số tiền khác tổng dòng không bắt'; end if;
  if not exists (select 1 from app_private.control_rule_pr_over_outstanding() where object_id = v_doc::text) then
    raise exception 'FAIL 6d2 luật đề nghị chi vượt số còn nợ không bắt'; end if;
  if not exists (select 1 from app_private.control_rule_pr_stuck_pending() where object_id = v_pr::text) then
    raise exception 'FAIL 6d3 luật đề nghị chi treo duyệt không bắt'; end if;
  -- Sửa số tiền cho khớp tổng dòng thì luật số tiền phải sạch, hai luật kia vẫn báo.
  update public.finance_payment_requests set amount = v_out + 1000000 where id = v_pr;
  if exists (select 1 from app_private.control_rule_pr_amount_vs_lines() where object_id = v_pr::text) then
    raise exception 'FAIL 6d4 luật số tiền vẫn báo sau khi đã khớp'; end if;
  insert into k3f values ('ca_dung:de_nghi_chi', '3 luật bắt đúng, khớp lại thì sạch');

  -- 5e. Ngân sách: tổng khác tổng dòng.
  insert into public.finance_project_budgets (project_id, version_no, reason, material_budget, other_total, created_by, status)
  values (v_project, 9999, 'ca dựng kiểm soát', 0, 5000000, v_user, 'submitted') returning id into v_budget;
  insert into public.finance_project_budget_lines (budget_id, cost_item_id, amount, note)
  values (v_budget, v_cost, 3000000, 'ca dựng');
  if not exists (select 1 from app_private.control_rule_budget_total_vs_lines() where object_id = v_budget::text) then
    raise exception 'FAIL 6e luật tổng ngân sách khác tổng dòng không bắt'; end if;
  update public.finance_project_budgets set other_total = 3000000 where id = v_budget;
  if exists (select 1 from app_private.control_rule_budget_total_vs_lines() where object_id = v_budget::text) then
    raise exception 'FAIL 6e2 luật ngân sách vẫn báo sau khi đã khớp'; end if;
  insert into k3f values ('ca_dung:ngan_sach', 'bắt đúng, khớp lại thì sạch');

  -- 5f. Phiếu tiền đã xác nhận mà chưa vào sổ quỹ.
  insert into public.finance_cash_movements (code, kind, category, to_account_id, amount, movement_date, description, project_id, status, created_by)
  values ('KSTEST-CM-1', 'receipt', 'other', v_fund, 2000000, current_date, 'ca dựng kiểm soát', v_project, 'confirmed', v_user)
  returning id into v_move;
  if not exists (select 1 from app_private.control_rule_cash_entry_mismatch() where object_id = v_move::text) then
    raise exception 'FAIL 6f luật phiếu tiền chưa vào sổ quỹ không bắt'; end if;
  if not exists (select 1 from app_private.control_rule_cash_entry_mismatch()
                 where object_id = v_move::text and detail->>'ca' = 'chưa vào sổ quỹ') then
    raise exception 'FAIL 6f2 luật phiếu tiền ghi sai nguyên nhân'; end if;
  insert into k3f values ('ca_dung:phieu_tien', 'bắt đúng + ghi đúng nguyên nhân');

end $$;

select buoc, ket_qua from k3f order by buoc;
rollback;
