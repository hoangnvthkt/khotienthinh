# HANDOFF — Kiểm soát viên AI (K0–K3 đợt 3) · cập nhật 24/10/2026

Đọc file này trước khi làm tiếp phần **Kiểm soát viên** (luật phát hiện lệch dữ liệu, chặn lúc lưu, dải cảnh báo trên chứng từ).
Chi tiết kỹ thuật từng đợt: [16-kiem-soat-vien-k0.md](16-kiem-soat-vien-k0.md). Lộ trình K0–K5 chủ SP đã xem:
artifact "Kiểm soát viên AI Vioo" (https://claude.ai/artifact/GHfZTprBFqy85g9SMDYzpc).

> Repo GitHub đang **public**: không ghi tên nhân viên thật, email, khóa vào file trong repo. Tra tên người qua Cloud khi cần.

## 1. Chủ SP muốn gì

Chủ SP muốn AI trong Vioo hoạt động như **chuyên viên kiểm soát** ở từng ngõ ngách nghiệp vụ: tự phát hiện dữ liệu lệch, báo đúng người, hướng dẫn sửa, báo Admin. Không muốn Trợ lý chỉ hỏi đáp.

Hai vòng:
- **Phát hiện**: luật SQL chạy 15 phút một lần, không gọi AI, ghi vào sổ phát hiện.
- **Chặn từ gốc**: lệch P0 mà người thao tác sửa được ngay thì bắt lý do hoặc xác nhận lúc lưu, không chặn cứng việc đúng.

5 quyết định chủ SP chốt (23/10):

| Câu | Đã chốt |
|---|---|
| Ai xử lý | Người phụ trách khâu theo dự án / kho. Quá 3 ngày thì lên trưởng bộ phận. Admin thấy hết |
| Từ khi nào | Luật báo từ 01/10. Dữ liệu cũ chỉ Admin thấy, dọn một lần |
| Kênh báo | P0: thông báo đẩy ngay cho người xử lý + Admin. Mọi mức: Việc của tôi + bản tin 07:00. Không gửi từng thông báo cho P1/P2 |
| Chặn hay cảnh báo | Chặn khi người thao tác sửa được ngay (bắt lý do); cần bộ phận khác thì cảnh báo |
| Ai chấp nhận lệch | Trưởng bộ phận của khâu, người Quản trị phân hệ, Admin. Lý do ≥ 10 ký tự, lưu vĩnh viễn |

## 2. Đã lên prod

| PR | Nội dung | Migration |
|---|---|---|
| #313 | Đợt 1 hỗ trợ Trợ lý: màn vừa mở, từ điển lỗi, `quyen_cua_toi`, sổ tay 168 mục | 20261028150000 |
| #319 | **K0**: `control_rules` / `control_findings` / `control_runs`, 18 luật, cron 15', tab Kiểm soát ở Trung tâm AI | 20261028190000 |
| #334 | **K1**: giao người xử lý, P0 báo ngay, Việc của tôi (nguồn `control`), bản tin 07:00, màn `/kiem-soat`, công cụ Trợ lý `lech_kiem_soat` | 20261029200000 |
| #336 | **K2**: chặn lúc lưu 6 ca P0 (mục 4) + sửa 5 luật K0 + sửa dữ liệu PO-272 đợt 2 | 20261030100000 |
| #337 | Dọn VAT: 12 đợt chưa nhận về VAT đơn; PO-259 đợt 1 tính lại giá trị | 20261030110000 |
| #340 | **Dải cảnh báo trên chứng từ** (ngăn Đơn hàng + Tiến độ cung ứng đề xuất) | 20261030170000 |
| #344 | **K3 đợt 1**: 9 luật phân hệ Kho, tất cả `shadow`; link mở sẵn mã vật tư / phiên kiểm kê | 20261031090000 |
| #345 | **K3 đợt 2**: 10 luật phân hệ Tài chính, tất cả `shadow`; smoke dựng ca thay dữ liệu thật | 20261031100000 |
| #346 | **K3 đợt 3**: 14 luật phân hệ Nhân sự, tất cả `shadow`; route mới `hr` | 20261031110000 |

`ai-gateway` đã deploy sau #336, gồm 6 mã lỗi K2 trong `errorGuide.ts`.

## 3. Kiến trúc trong 1 phút

- **Luật**: mỗi luật là hàm `app_private.control_rule_<mã>()` trả 11 cột chung (`object_key`, `object_type`, `object_id`, `object_code`, `project_id`, `warehouse_id`, `title`, `detail`, `amount`, `happened_on`, `link`). `link` dạng `/procurement?po=<id>`.
- **Sổ**: `control_findings` có khóa `rule_code + object_key`, trạng thái open / accepted / resolved. Trường `legacy` = phát sinh trước `since_date` 01/10.
- **Bộ chạy** `app_private.control_run(rule, trigger)`: khóa tư vấn; lệch mới thì mở, hết lệch thì tự đóng; cron `control-findings-every-15-minutes`.
- **Giao người**: `control_rules.route` có 3 giá trị:
  - `buyer` → người lập PO.
  - `warehouse` → thủ kho của kho.
  - `payable` → người có quyền Tài chính · Ghi nhận / Xác nhận.

  Không xác định được người thì chỉ giao Admin. `control_route_pending` giao lại 6 giờ một lần.
- **Báo**: chỉ luật `mode = live` mới báo.
  - `control_notify_p0`: báo P0 một lần cho mỗi lệch.
  - `control_daily_digest`: cron `control-daily-digest`, chạy 0h UTC = 07:00 VN.
  - Nguồn `control` trong `vcc_my_work_items_v1`.
- **Quyền xem**: `app_private.control_can_view(f)`. Admin thấy hết; người xử lý / trưởng bộ phận thấy lệch của mình ở luật live, không thấy lệch cũ. `control_can_accept(f)` quyết định ai được Chấp nhận.
- **RPC**: `control_overview_v1`, `control_findings_v1`, `control_finding_accept_v1`, `control_finding_reopen_v1`, `control_run_now_v1`, `control_rule_set_mode_v1`, `control_findings_for_code_v1` (Trợ lý), `control_findings_for_doc_v1` (dải trên chứng từ).
- **Màn**:
  - Trung tâm AI → tab **Kiểm soát**: `components/aiCenter/AiControlPanel.tsx`, `lib/controlFindings.ts`.
  - `/kiem-soat`: `pages/ControlFindingsPage.tsx`.
  - Dải trên chứng từ: `components/control/ControlDocStrip.tsx`, gắn ở `components/procurement/hub/OrderDrawer.tsx` và `components/project/material/MaterialRequestSupplyPanel.tsx`.

## 4. Chặn lúc lưu (K2) — mã lỗi

| Ca | Hàm máy chủ | Mã lỗi | Màn |
|---|---|---|---|
| Giá đối soát ≠ giá NCC ghi trên phiếu giao (HĐ chưa có giá) | `save_procurement_contract_statement_v1`, `post_supplier_delivery_statement` | `PROCUREMENT_STATEMENT_NOTE_PRICE_REASON` | ContractsView: chip "Dùng giá phiếu giao" / lý do |
| Kết thúc đề xuất / đóng nhu cầu khi PO còn mở | `end_material_request_supply_v1`, `app_private.procurement_legacy_close_v1` (+ `openPoAck`) | `MR_SUPPLY_OPEN_PO` (details = danh sách đơn) | EndSupplyDialog: ô "Vẫn kết thúc" |
| Gửi / duyệt đơn mà mọi đề xuất đã kết thúc | `transition_procurement_hub_po_v1` | `PROCUREMENT_PO_NEED_ENDED` | — |
| VAT đợt ≠ VAT đơn, chỉ khi lập đợt / đổi VAT | trigger `trg_delivery_vat_reason_guard` (cột `vat_reason`); `save_procurement_delivery_v1` nhận `vatReason` | `PURCHASE_DELIVERY_VAT_REASON` | DeliveryEditor: ô lý do + chip |
| Đặt vượt nhu cầu (cộng đơn TRƯỚC, ×1,02), chỉ đơn lập tại Mua hàng | `transition_procurement_hub_po_v1` (gửi; duyệt nhận `excessReason`), `procurement_legacy_save_po_v1` (`allocations[].excessReason`) | `PROCUREMENT_PO_EXCESS_REASON_REQUIRED` (details = dòng vượt) | OrderEditor: dòng "Vượt… · lý do"; OrderDrawer: hộp lý do khi duyệt |
| Sửa số nhận < số đã / đang trả NCC | `correct_purchase_receipt_v1` | `PURCHASE_FIX_RETURN_PENDING` | hộp Sửa số nhận |
| Sửa số nhận không giảm giá trị đợt | `correct_purchase_receipt_v1` giảm `accepted_gross_amount` (không đụng `status`); `post_purchase_receipt_finance_v2` so với gross + `purchase_receipt_corrected_amount(metadata)` | — | — |

Bộ sinh migration K2 dựng từ định nghĩa hàm prod và chỉ chèn kiểm tra (`gen.py` ở scratchpad phiên 4c15fcb3, sẽ mất). Lần sau làm lại cùng cách: dump hàm prod bằng `pg_get_functiondef`, rồi thay chuỗi, mỗi chỗ thay phải khớp đúng 1 lần.

## 5. Trạng thái 51 luật trên prod (24/10)

| Luật | Mức | Chế độ | Mở mới | Mở cũ | Ghi chú |
|---|---|---|---:|---:|---|
| batch_wms_status | P0 | live | 0 | 3 | PO-116/163/181 đợt 1: thủ kho chốt ở Kho → Đối chiếu nhận hàng |
| ledger_vs_accepted | P0 | live | 0 | 0 | ca Sika PO-272 đã tự đóng sau K2 |
| ap_vs_accepted | P0 | live | 0 | 0 | |
| ap_without_receipt | P0 | live | 0 | 0 | |
| receipt_without_ap | P0 | live | 0 | 3 | PO-253 / 274 / 217: 124,5 tr chưa ghi nợ |
| statement_price_no_reason | P0 | live | 1 | 0 | PO-609 (xem mục 6) |
| batch_vat_differs | P1 | live | 6 | 6 | 48,0 tr VAT thiếu, danh sách ở doc 16 |
| return_no_resolution | P1 | live | 0 | 0 | 4 lệch phiếu trả tháng 6 đã Chấp nhận ("dữ liệu thử") |
| mr_ended_po_open | P1 | live | 1 | 0 | MR-2026-9833 / PO-671 |
| order_over_need | P2 | live | 2 | 14 | PO-694 (mới); PO-110/116 thép MR-2026-2671 đặt chồng nhiều đơn |
| po_total_mismatch | P1 | shadow | 0 | 7 | |
| po_received_mismatch | P1 | shadow | 0 | 22 | |
| accepted_value_calc | P1 | shadow | 0 | 0 | |
| return_over_received | P0 | shadow | 0 | 0 | |
| ledger_double_post | P0 | shadow | 0 | 0 | |
| mr_completed_short | P1 | shadow | 4 | 0 | |
| received_over | P2 | shadow | 0 | 1 | |
| batch_quality_stuck | P1 | shadow | 0 | 1 | PO-259 đợt 1, 854 tr, chờ nhập kho từ tháng 8 |
| **K3 đợt 1 — Kho (mới 24/10, tất cả shadow)** | | | | | |
| stock_vs_ledger | P0 | shadow | 0 | 0 | bất biến gốc: tồn = tổng sổ; smoke bắt buộc = 0 |
| stock_negative | P0 | shadow | 0 | 0 | bất biến gốc; smoke bắt buộc = 0 |
| ledger_negative_after | P0 | shadow | 0 | 34 | ghi sổ làm tồn âm; mới nhất 13/07 |
| stock_value_negative | P0 | shadow | 0 | 4 | −11.306.988 đ |
| stock_no_value | P1 | shadow | 0 | 25 | có hàng mà giá trị tồn 0 |
| wms_adjust_no_reason | P1 | shadow | 0 | 4 | điều chỉnh / hao hụt không lý do |
| count_open_stale | P2 | shadow | 1 | 0 | KK-20261012-B2078 mở 12 ngày |
| count_variance_no_reason | P1 | shadow | 0 | 0 | |
| transfer_not_received | P1 | shadow | 0 | 0 | `wms_transfer_lines` còn rỗng |
| **K3 đợt 2 — Tài chính (mới 24/10, tất cả shadow)** | | | | | |
| payable_over_committed | P1 | shadow | 0 | 3 | 123.428.082 đ nợ vượt cam kết, đều tháng 8 |
| payable_over_settled | P0 | shadow | 0 | 0 | luật canh; view chặn số còn nợ ở 0 nên phải tự tính lại |
| payable_status_vs_balance | P0 | shadow | 0 | 0 | luật canh |
| payable_no_due_date | P1 | shadow | 0 | 0 | luật canh; ảnh hưởng dự báo chi |
| payable_orphan_source | P0 | shadow | 0 | 0 | luật canh |
| pr_amount_vs_lines | P0 | shadow | 0 | 0 | **chưa có đề nghị chi nào trên prod** |
| pr_over_outstanding | P0 | shadow | 0 | 0 | luật canh |
| pr_stuck_pending | P2 | shadow | 0 | 0 | luật canh |
| budget_total_vs_lines | P1 | shadow | 0 | 0 | **chưa có ngân sách nào trên prod** |
| cash_entry_mismatch | P0 | shadow | 0 | 0 | **chưa có phiếu tiền nào trên prod** |
| **K3 đợt 3 — Nhân sự (mới 24/10, tất cả shadow)** | | | | | |
| att_future_date | P0 | shadow | 2 | 0 | bản ghi chấm công ngày sau hôm nay |
| att_checkout_before_checkin | P0 | shadow | 0 | 0 | luật canh |
| att_suspicion_unresolved | P1 | shadow | 6 | 0 | chung thiết bị 5 + cùng điểm GPS 1 (đã bỏ `no_passkey`) |
| att_out_of_range_pending | P1 | shadow | 0 | 0 | luật canh |
| att_proposal_stuck | P2 | shadow | 0 | 0 | 9 đề xuất chờ nhưng đều mới |
| att_after_exit | P0 | shadow | 0 | 0 | mù tới khi HR ghi ngày nghỉ việc |
| employee_resigned_no_exit_date | P1 | shadow | 3 | 0 | đúng 3 người HR còn treo ngày nghỉ việc |
| leave_balance_vs_ledger | P0 | shadow | 0 | 0 | bất biến gốc; smoke bắt buộc = 0 |
| leave_ledger_running | P0 | shadow | 0 | 0 | bất biến gốc; smoke bắt buộc = 0 |
| leave_approved_no_ledger | P0 | shadow | 6 | 0 | phép có lương đã duyệt chưa trừ sổ |
| leave_vs_attendance | P1 | shadow | 11 | 0 | nghỉ phép mà vẫn chấm công |
| leave_overlap | P1 | shadow | 0 | 0 | luật canh |
| leave_stuck_pending | P2 | shadow | 7 | 0 | đơn phép treo duyệt |
| payroll_net_vs_gross | P0 | shadow | 0 | 0 | luật canh |

Lấy số mới nhất:

```sql
select r.code, r.severity, r.mode,
  count(f.id) filter (where f.status='open' and not f.legacy) moi,
  count(f.id) filter (where f.status='open' and f.legacy) cu
from public.control_rules r
left join public.control_findings f on f.rule_code = r.code
group by 1, 2, 3, r.sort_order order by r.sort_order;
```

## 6. Việc đang chờ

**Chờ chủ SP trả lời** (đã hỏi 24/10, chưa trả lời):

1. Bật 8 luật Mua hàng / Công nợ còn ở chế độ shadow (bảng trên). Em đề xuất bật hết; hiện chỉ có lệch cũ, riêng `mr_completed_short` có 4 lệch mới.
1b. 9 luật Kho (K3 đợt 1) **chạy shadow từ 24/10**: để đủ 1 tuần (tới 31/10) rồi xem lại số lệch mới trước khi bật. Riêng
   `count_open_stale` có 1 lệch mới thật (KK-20261012-B2078 mở 12 ngày) — có thể bật sớm vì chỉ báo thủ kho của kho đó.
1c. 10 luật Tài chính (K3 đợt 2) **chạy shadow từ 24/10**. Chỉ `payable_over_committed` có lệch thật (3 chứng từ,
   123,4 tr); 9 luật kia số 0 vì **chưa có dữ liệu**, không phải vì sạch — xem mục tiếp theo.
1d. 14 luật Nhân sự (K3 đợt 3) **chạy shadow từ 24/10**: 35 lệch thật trên 6 luật (chấm công ngày tương lai 2,
   dấu hiệu chấm hộ 6, nghỉ việc chưa ghi ngày 3, phép duyệt chưa vào sổ 6, nghỉ phép mà vẫn chấm công 11,
   đơn phép treo duyệt 7). Em đề xuất bật sớm `leave_approved_no_ledger` (P0, HR sửa được ngay) và
   `employee_resigned_no_exit_date` (P1, mở đường cho luật chấm công sau ngày nghỉ việc).
2. Giao lệch **cũ** có tiền cho người xử lý (vào Việc của tôi, không báo đẩy):
   - `receipt_without_ap` 124,5 tr → kế toán.
   - `batch_vat_differs` 6 lệch cũ 11,4 tr → kế toán.
   - `batch_wms_status` → thủ kho.

   Cần sửa `control_can_view` / route cho từng luật, hoặc thêm cờ "giao cả dữ liệu cũ" trên `control_rules`.
3. PO-259 đợt 1, 854 tr, đã duyệt chất lượng nhưng chưa nhập kho: giao thủ kho hoàn tất, hoặc Mua hàng kết thúc thiếu.
4. 14 lệch đặt vượt cũ: (a) lập bảng thép thừa để chủ SP xem — đề xuất; hoặc (b) chấp nhận hàng loạt.

**Cần nói với chủ SP — phân hệ Tài chính chưa được dùng thật** (phát hiện khi làm K3 đợt 2, 24/10). Trên prod:
công nợ NCC có 62 chứng từ (7,4 tỷ ghi nhận) nhưng `supplier_payment_allocations` = **0** (chưa ghi một đồng thanh
toán NCC nào), `finance_payment_requests` = 0 (chưa có đề nghị chi), `finance_project_budgets` = 0 (chưa có ngân
sách), `finance_cash_movements` / `finance_cash_entries` = 0 (chưa có thu chi tiền). Nghĩa là phần thu chi / đề nghị
chi / ngân sách của Vioo đang chưa chạy — có thể kế toán vẫn làm trên MISA. Cần hỏi chủ SP: định dùng Vioo cho phần
này từ khi nào, có cần nhập số dư đầu kỳ không. Trước khi có dữ liệu thì 9 luật canh Tài chính không đo được, chỉ
chứng minh bằng ca dựng trong smoke.

**Cần nói lại với chủ SP**: chủ SP nghĩ PO-609 và PO-671 là phiếu nháp sẽ bỏ, nhưng:
- **PO-609** đã giao, đã nhận hàng, bảng đối soát DCHD-202610-2865B0 đã ghi nợ. Muốn bỏ phải đảo đối soát + công nợ trước.
- **PO-671** đã duyệt, chưa nhận. Bỏ được bằng Kết thúc thiếu / Hủy.

Khi chủ SP bỏ xong, Chấp nhận 2 lệch với lý do "phiếu thử".

**Việc mới cho HR (từ K3 đợt 3, 24/10)**: 11 ngày nghỉ phép đã duyệt mà nhân viên vẫn chấm công đi làm, 6 đơn phép
có lương đã duyệt mà chưa trừ sổ phép, 2 bản ghi chấm công ngày tương lai, 6 bản ghi có dấu hiệu chấm hộ (chung thiết bị
/ cùng điểm GPS), 3 người đã nghỉ việc chưa ghi ngày nghỉ. Chi tiết từng ca xem tab Kiểm soát, lọc phân hệ **Nhân sự**.

**Chờ người khác**:
- Kế toán: điều chỉnh 48,0 tr VAT thiếu (12 đợt) và ghi nợ 124,5 tr chưa ghi (3 đợt).
- Người mua (PO-315, PO-463 — đã trả lại 24/10): sửa SL về phần còn thiếu rồi gửi lại.
- Người mua PO-439: đối chiếu hóa đơn VAT (đơn 0%, đợt 10%).
- Thủ kho: chốt PO-116/163/181 đợt 1 ở Đối chiếu nhận hàng.

**Bước tiếp theo**: K3 đợt 1 (Kho) + đợt 2 (Tài chính) + đợt 3 (Nhân sự) đã xong 24/10 — xem mục K3 trong [16-kiem-soat-vien-k0.md](16-kiem-soat-vien-k0.md),
gồm cả 3 luật đã **bỏ sau khi đo** vì sẽ thành nhiễu (đừng viết lại). Còn ~70 luật: Tài chính (thu chi, đề nghị chi, ngân sách),
Dự án / Tiến độ, Quy trình, Yêu cầu / Đề xuất, Danh mục vật tư. Mỗi luật mới chạy shadow ít nhất 1 tuần, xem số lệch
thật, sửa luật báo sai, rồi mới để chủ SP bật. Còn ~45 luật.

**Cách thêm một đợt luật** (đã dùng cho K3 đợt 1): dò số lệch thật bằng `scripts/cloud-sql.mjs` TRƯỚC khi viết hàm luật;
luật nào báo phần lớn dữ liệu bình thường thì bỏ và ghi lý do vào doc 16; `link` phải mở đúng chỗ sửa
(`?q=` cho màn có `useSearchParamPrefill`, `?tx=` cho phiếu kho, `?supplier=` / `?request=` / `?project=` cho Trung tâm
Tài chính, `?tab=&q=&month=&year=` cho chấm công, `?person=` cho hồ sơ nhân sự); smoke phải chốt số lệch thật + bất biến nào bắt buộc = 0. **Rà `pg_constraint` trước**: CHECK / unique index
đã chặn thì đừng viết luật (mã chết). **Luật đọc view phải kiểm biểu thức của view** — `outstanding_amount` có
`GREATEST(0, …)` nên điều kiện "< 0" không bao giờ đúng. Phân hệ chưa có dữ liệu thật thì **dựng ca lệch trong smoke**
(như đợt 2), và chạy `control_run` TRƯỚC khi dựng ca, nếu không dữ liệu dựng làm luật live cũ sinh thông báo.

## 7. Cách làm việc (lệnh hay dùng)

Môi trường:
- Worktree: `/Users/admin/khotienthinh/.worktrees/control-k0`. Tạo nhánh mới từ `origin/main` cho mỗi PR.
- Preview: launch `control-k0`, cổng 4250. Màn thật cần đăng nhập — **không nhập mật khẩu thay chủ SP**; kiểm giao diện bằng fixture `tests/procurement/*-fixture.html` (tạo tạm, xóa trước khi commit).
- Supabase Cloud ref `ftciqmqhmfvjtwoycswe`. Khóa nằm trong `/Users/admin/khotienthinh/.env`, không in ra.

Lệnh:

```bash
# Đọc Cloud (chỉ đọc)
CLOUD_SQL_ENV=/Users/admin/khotienthinh/.env node scripts/cloud-sql.mjs "select …"
# Ghi Cloud (file tự begin; … commit;) — chỉ khi chủ SP đã bảo làm
CLOUD_SQL_ENV=/Users/admin/khotienthinh/.env node scripts/cloud-sql.mjs --file x.sql --write
# Chạy thử migration + smoke trong giao dịch tự hủy
set -a; . /Users/admin/khotienthinh/.env; set +a
node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe --migration supabase/migrations/<file>.sql --smoke supabase/tests/<smoke>.sql
# Kiểm trước PR
npm run check:supabase-migrations && npm run lint && npm run check:supabase-queries && TZ=UTC npx vitest run && npm run build
npx playwright test -c tests/center/playwright.config.ts tests/e2e/center-ai-admin.spec.ts --project=desktop
# Deploy ai-gateway (từ checkout origin/main; lỗi "closed pipe" thì chạy lại)
npx -y supabase@2.95.6 functions deploy ai-gateway --project-ref ftciqmqhmfvjtwoycswe --use-api
```

**Thao tác thay Admin** (bật luật, Chấp nhận lệch, trả lại đơn chủ SP là người duyệt): gọi đúng RPC của màn để `audit_trail` ghi tên Admin. Thứ tự lệnh trong file SQL:

```sql
begin;
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true)
from public.users where name = 'Admin Hoàng' and auth_id is not null limit 1;   -- ĐẶT TRƯỚC set role (sau đó RLS ẩn bảng users)
set local role authenticated;
select public.control_rule_set_mode_v1('<mã luật>', 'live');   -- hoặc control_finding_accept_v1(id, 'lý do ≥ 10 ký tự')
reset role;
select app_private.control_run('<mã luật>', 'manual');          -- giao người ngay, không chờ 15 phút
commit;
```

Người dùng giả trong smoke cần cả `sub` và `email` trong claims, thiếu thì `current_app_user_id()` trả null.

**Ship PR** (chủ SP 23/10: PR đã duyệt thì tự chờ CI, xanh là merge):
1. `gh` ở `/opt/homebrew/bin/gh`.
2. Migration mới: thêm tên vào `supabase/baseline/current.json` → `allowedPostBaselineFiles`. Xung đột file này thì lấy bản main (`git show :3:…`), parse JSON, thêm tên của mình.
3. Số migration phải **lớn hơn mọi migration trên main**; main có số mới hơn thì đổi số.
4. `gh pr checks <SỐ PR CỦA MÌNH> --watch`. Coi chừng xem nhầm PR khác — 24/10 đã xem nhầm #338.
5. "Typecheck, test and build" xanh thì `gh pr merge N --squash`.
6. Kiểm `supabase_migrations.schema_migrations` có version mới (tự áp sau merge).

## 8. Bẫy đã gặp

- Hàm SQL trả boolean dùng `and` / `or` với tham số NULL → `if not <null>` bỏ qua chặn. Luôn `coalesce(…, false)`. Đã gặp ở `material_request_open_pos_acked`.
- Migration sửa dữ liệu thật phải **bỏ qua khi CSDL trống**: Supabase Preview dựng CSDL mới, không có PO-xxx. #337 đỏ vì `raise` khi khớp 0 dòng.
- Supabase Preview chạy lại sau khi gộp main có thể báo trùng `schema_migrations` (mã cũ 20260929180000). Đó là lỗi hạ tầng; lần đẩy đầu đạt là được.
- Trigger `trg_post_purchase_receipt_finance_v2` chạy mỗi khi `UPDATE … SET status` (kể cả giữ nguyên giá trị). Muốn sửa giá trị đợt mà không ghi nợ lại thì dùng câu lệnh riêng không đụng `status`.
- `control_findings_k0_smoke.sql` đã cũ từ K1 (K1 mở RPC cho mọi người dùng): chạy riêng sẽ đỏ, không phải lỗi mới.
- Vòng chờ bằng `grep` trên JSON: `json_build_object` in `"key" : value` (có dấu cách trước `:`).
- PostgREST: lỗi xung đột phiên bản dùng `PT409`, không dùng `40001` (vòng lặp vô hạn, sự cố 11/10).
- `declare p record` trong plpgsql **che bí danh bảng** `pg_proc p` → lỗi "record p is not assigned yet" hoặc
  "record r has no field id". Đặt tên biến khác mọi bí danh bảng trong cùng block (đã gặp 2 lần: 24/10 đợt 1 và đợt 3).
- **Bảng `hrm_*` trỏ `employees(id)`, KHÔNG phải `users(id)`** (trừ `created_by` / `updated_by`). Join sai bảng vẫn chạy
  không lỗi, chỉ trả 0 dòng — luật thành mã chết mà trông như "dữ liệu sạch". Tên: `employees.full_name`,
  mã: `employees.employee_code`, trạng thái: `employees.status`.
- `trg_hrm_leave_balance_write_ledger` tự ghi dòng sổ khi sửa số dư phép: muốn dựng ca lệch số dư ↔ sổ thì phải sửa
  từ phía sổ, không phải phía số dư.
- `hrm_employee_employment_events.status` nhận `ACTIVE` / `VOID` (không phải `active` / `cancelled`).

## 9. Quy tắc làm việc với chủ SP

- Xưng "em", gọi "anh"; trả lời tiếng Việt, ngắn: tiêu đề + số liệu, giải thích để trong tooltip.
- Có nhiều phương án thì đưa **chip bấm được** / câu hỏi có lựa chọn, kèm đề xuất.
- Hỏi trước khi chạy bộ kiểm model thật (nói số ca + ước lượt gọi). Được dùng subagent khi nhanh hơn.
- Ảnh xem thử giao diện để nền sáng. Giữ style UI hiện tại (`docs/ui/VIOO-UI-UX.md`).
- Chủ SP = Super Admin, tài khoản "Admin Hoàng", ADMIN duy nhất.
- Supabase Cloud only, không dùng local / Docker.
