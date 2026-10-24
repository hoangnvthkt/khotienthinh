# Kiểm soát viên K0–K2 — bộ luật, sổ phát hiện, đưa lệch tới đúng người, chặn lúc lưu (23/10/2026)

Chủ SP 22/10: muốn AI trong Vioo tự theo dõi dữ liệu như chuyên viên kiểm soát, phát hiện lệch, báo Admin. Đánh giá + lộ trình K0–K5:
artifact "Kiểm soát viên AI Vioo" (https://claude.ai/artifact/GHfZTprBFqy85g9SMDYzpc). K0 = nền + 18 luật Mua hàng → Kho → Công nợ → Đề xuất,
**không gọi AI**, chỉ Admin thấy (chạy thử).

## Cách chạy

| Phần | Ở đâu |
|---|---|
| Bảng | `control_rules` (luật, mức P0/P1/P2, chế độ shadow / live / off, `since_date` 01/10), `control_findings` (mỗi lệch một hồ sơ, khóa `rule_code + object_key`), `control_runs` |
| Luật | hàm `app_private.control_rule_<mã>()` trả các dòng đang lệch (11 cột chung) |
| Bộ chạy | `app_private.control_run(p_rule, p_trigger)`: khóa tư vấn (trùng lượt thì bỏ), lỗi một luật không dừng luật khác, lệch mới → mở, hết lệch → tự đóng, đóng rồi lệch lại → mở lại; cron `control-findings-every-15-minutes` |
| Admin | Trung tâm AI → tab **Kiểm soát** (`components/aiCenter/AiControlPanel.tsx`, `lib/controlFindings.ts`): ô số Lệch mới / Dữ liệu cũ / Đã chấp nhận / Tự đóng 7 ngày, lọc phân hệ, nhóm theo luật, **Mở** chứng từ, **Chấp nhận** (lý do ≥ 10 ký tự, ghi `audit_trail`), **Mở lại**, **Chạy lại** |
| RPC | `control_overview_v1`, `control_findings_v1`, `control_finding_accept_v1`, `control_finding_reopen_v1`, `control_run_now_v1` — đều `is_admin()` |
| Kiểm | `supabase/tests/control_findings_k0_smoke.sql` (giao dịch tự hủy trên Cloud: mọi luật chạy không lỗi, có PO-609 / MR-2026-9833 / PO-116·163·181, chạy lần 2 không mở trùng, tự đóng, quyền), `lib/__tests__/controlFindings.test.ts`, e2e `center-ai-admin.spec.ts` (Kiểm soát) |

## 18 luật (số lệch trên dữ liệu thật 23/10, trước khi sửa)

| Mã | Mức | Luật | Mới | Cũ |
|---|---|---|---|---|
| po_total_mismatch | P1 | Tổng tiền đơn khác tổng các dòng | 0 | 7 |
| po_received_mismatch | P1 | Số đã nhận trên đơn khác tổng các đợt nhận | 0 | 22 |
| batch_wms_status | P0 | Đợt giao và phiếu nhập kho lệch trạng thái (PO-116/163/181) | 0 | 3 |
| ledger_vs_accepted | P0 | Sổ kho nhập khác số thực nhận (PO-272 Sika: nhận 21.000, sổ 35.930) | 1 | 0 |
| ap_vs_accepted | P0 | Công nợ đợt khác giá trị hàng nhận | 0 | 0 |
| accepted_value_calc | P1 | Giá trị chấp nhận đợt tính sai, đã cộng chốt giá (PO-272 đợt 2: ghi 201,2 tr, tính lại 117,6 tr) | 1 | 0 |
| ap_without_receipt | P0 | Có công nợ mà hàng chưa nhận | 0 | 0 |
| receipt_without_ap | P0 | Đã nhận hàng mà chưa ghi công nợ (PO-217/253/274 trước mốc 01/10) | 0 | 3 |
| batch_vat_differs | P1 | VAT đợt nhận khác VAT đơn | 6 | 6 |
| statement_price_no_reason | P0 | Giá đối soát khác giá phiếu giao, không lý do (PO-609) | 1 | 0 |
| return_no_resolution | P1 | Trả NCC xong chưa chọn giao bù / giảm nợ | 0 | 4 |
| return_over_received | P0 | Trả NCC vượt số đã nhận | 0 | 0 |
| ledger_double_post | P0 | Phiếu kho ghi sổ hai lần | 0 | 0 |
| mr_completed_short | P1 | Đề xuất hoàn tất nhưng còn thiếu hàng | 4 | 0 |
| mr_ended_po_open | P1 | Đề xuất đã kết thúc nhưng đơn mua còn mở (MR-2026-9833 / PO-671) | 1 | 0 |
| order_over_need | P2 | Đặt vượt nhu cầu không ghi lý do | 2 | 2 |
| received_over | P2 | Nhận dư so với kế hoạch đợt | 0 | 1 |
| batch_quality_stuck | P1 | Đợt đã duyệt chất lượng > 3 ngày chưa nhập kho (PO-259: 67 ngày, 776,6 tr) | 0 | 1 |

"Cũ" = phát sinh trước `since_date` (01/10) — dọn một lần; "Mới" = từ 01/10.

## Thêm một luật

1. Viết hàm `app_private.control_rule_<mã>()` trả đúng 11 cột (`object_key` duy nhất trong luật, `title` câu ngắn có mã chứng từ + số, `link` đường dẫn trong app).
2. Thêm dòng `control_rules` (mức, nguyên tắc, cách xử lý, ai xử lý, `fn`), mặc định `shadow`.
3. Chạy smoke trên Cloud (giao dịch tự hủy) để xem số lệch thật; luật báo sai nhiều thì sửa trước khi bật (bài học 22/10: luật giá bản đầu báo 35 dòng, 34 sai).

## K1 — đưa lệch tới đúng người (chủ SP chốt 5 câu 23/10, migration `20261029200000_control_k1_routing`)

| Câu | Cách làm |
|---|---|
| Ai xử lý | `control_rules.route`: `buyer` → người lập PO (đề xuất chưa có đơn → người được giao dòng ở hộp thư Mua hàng); `warehouse` → thủ kho của kho (`wms_warehouse_keepers`); `payable` → người có quyền Tài chính · Ghi nhận / Xác nhận. Không xác định được → chỉ Admin (không rải cho mọi Quản trị phân hệ). Trưởng bộ phận = quản lý trực tiếp của người xử lý (`resolve_active_direct_manager`), không có thì Quản trị phân hệ. `app_private.control_route_pending` giao lại 6 giờ một lần |
| Dữ liệu cũ | Lệch trước `since_date` (01/10) không giao ai; Admin dọn ở tab Kiểm soát |
| Kênh | Chỉ luật đã bật **Báo người xử lý** (`mode = live`, Admin bật từng luật ở tab Kiểm soát). P0: thông báo đẩy ngay cho người xử lý + Admin, mỗi lệch một lần (`control_notify_p0`). Mọi lệch: nguồn `control` trong Việc của tôi (`vcc_my_work_items_v1`, hạn = 3 ngày từ lúc phát hiện) và bản tin 07:00 mỗi người một tin (`control_daily_digest`, cron `control-daily-digest`). Quá 3 ngày → trưởng bộ phận cũng nhận |
| Chặn hay cảnh báo | Chặn khi sửa được tại chỗ → K2 (chưa làm) |
| Chấp nhận lệch | Trưởng bộ phận của lệch, người Quản trị phân hệ, Admin (`control_can_accept`); lý do ≥ 10 ký tự, `audit_trail` |

Màn: `/kiem-soat` **Lệch cần sửa** (mọi người dùng; máy chủ chỉ trả lệch của người xem, Admin thấy hết) — cùng thành phần với tab Kiểm soát. Việc của tôi: bấm lệch mở thẳng đơn trong tab Mua hàng. Trợ lý: công cụ `lech_kiem_soat` ("PO-609 có gì lệch?", RPC `control_findings_for_code_v1`). Sổ tay: `docs/so-tay/chung-lech-can-sua.md`. Kiểm: `supabase/tests/control_k1_routing_smoke.sql` (giao người, P0 báo một lần, bản tin không trùng, người xử lý / người ngoài / Admin).

Kết quả giao người trên dữ liệu thật (smoke 23/10): PO-609 → 4 người quyền Tài chính; MR-2026-9833 → người lập PO-671; lệch kho → thủ kho; lệch không rõ người (đơn cũ, đề xuất chưa có đơn) → Admin.

## K2 — chặn lúc lưu (chủ SP 23/10 "làm cả 6 ca", migration `20261030100000_control_k2_save_guards`)

Nguyên tắc: người thao tác sửa được ngay thì **bắt lý do / xác nhận**, không chặn cứng việc đúng; đợt / đơn cũ đang chạy không bị kẹt.

| Ca (lệch thật) | Chặn ở đâu | Người dùng thấy gì |
|---|---|---|
| 1. Giá đối soát ≠ giá NCC ghi trên phiếu giao, HĐ chưa có giá (PO-609) | `save_procurement_contract_statement_v1` + `post_supplier_delivery_statement` → `PROCUREMENT_STATEMENT_NOTE_PRICE_REASON`; đúng giá HĐ thì miễn | Bảng đối soát: "Phiếu giao X" + chip **Dùng giá phiếu giao** / lý do nhanh |
| 2. Kết thúc đề xuất khi đơn mua còn mở (MR-2026-9833 / PO-671) | `end_material_request_supply_v1`, `procurement_legacy_close_v1` → `MR_SUPPLY_OPEN_PO` (details = danh sách đơn), gửi lại kèm `openPoAck`; `transition_procurement_hub_po_v1` gửi / duyệt đơn mà mọi đề xuất đã kết thúc → `PROCUREMENT_PO_NEED_ENDED` | Hộp Kết thúc liệt kê đơn mở + ô **Vẫn kết thúc** (đơn đã duyệt vẫn giao thành tồn kho công trường; đơn chưa duyệt không duyệt được); người lập đơn được báo |
| 3. VAT đợt ≠ VAT đơn không lý do (32/137 đợt) | trigger `trg_delivery_vat_reason_guard` (cột mới `vat_reason`): chỉ khi lập đợt / đổi VAT; lập đợt không truyền VAT (mặc định 0) mà đơn có VAT → lấy VAT đơn; giao tiếp cùng VAT → kế thừa lý do. `save_procurement_delivery_v1` mặc định VAT đơn, nhận `vatReason` → `PURCHASE_DELIVERY_VAT_REASON` | Lập đợt giao: chọn VAT khác đơn → ô lý do + chip |
| 4. Đặt vượt nhu cầu không lý do (PO-694) | `transition_procurement_hub_po_v1`: gửi duyệt → `PROCUREMENT_PO_EXCESS_REASON_REQUIRED` (details = dòng vượt); duyệt nhận `excessReason` ghi vào dòng. Vượt = SL đơn này + các đơn lập TRƯỚC > cần × 1,02. `procurement_legacy_save_po_v1` nhận `allocations[].excessReason`. Chỉ đơn lập tại Mua hàng (đơn cũ ở dự án: luật vẫn báo) | Lập đơn: dòng "Vượt … · lý do" + chip; người duyệt gặp đơn vượt → hộp ghi lý do chấp nhận rồi duyệt |
| 5. Sửa số nhận thấp hơn số đang trả NCC | `correct_purchase_receipt_v1` → `PURCHASE_FIX_RETURN_PENDING` (so receivedQty sau sửa với trả chờ + xong) | Câu báo trong hộp Sửa số nhận |
| 6. Sửa số nhận không giảm giá trị đợt (PO-272 đợt 2 ghi 201,2 tr) | `correct_purchase_receipt_v1` giảm `accepted_gross_amount` bằng câu lệnh riêng (không đụng status → trigger ghi nợ không chạy lại); `post_purchase_receipt_finance_v2` so chi phí / công nợ gốc với giá trị đợt + phần đã sửa (`purchase_receipt_corrected_amount`); sửa dữ liệu PO-272 đợt 2 → 117,6 tr | — |

Luật K0 đi cùng: `statement_price_no_reason` miễn khi đúng giá HĐ; `ledger_vs_accepted` trừ phần xuất điều chỉnh khi sửa số nhận (ca Sika PO-272 hết báo nhầm); `ap_vs_accepted` trừ phần giảm do sửa số nhận; `batch_vat_differs` bỏ đợt có lý do; `order_over_need` cộng các đơn trước, dung sai 2%. Trợ lý: 6 mã lỗi mới trong `errorGuide.ts`.

Kiểm: `supabase/tests/control_k2_save_guards_smoke.sql` (giao dịch tự hủy, dữ liệu thật: PO-609, MR-2026-9885 / PO-696, PO-701, PO-272), `lib/__tests__/controlK2SaveGuards.test.ts`. (`control_findings_k0_smoke.sql` đã cũ từ K1 — mở RPC cho người dùng.)

### Dọn 32 đợt VAT lệch cũ (chủ SP 23/10 chọn "Sửa theo đơn + điều chỉnh nợ", migration `20261030110000_control_k2_vat_cleanup`)

- **12 đợt chưa ghi nhận hàng / công nợ → VAT theo đơn**: PO-315, PO-384 (lập), PO-259 đợt 1–3, PO-263, PO-281, PO-387, PO-446-01, PO-499, PO-116, PO-163. PO-259 đợt 1 đã duyệt chất lượng: giá trị 776.583.237 → 854.241.561 đ (VAT 10%).
- **12 đợt đã nhận có giá trị → kế toán ghi điều chỉnh công nợ có chứng từ** (VAT thiếu = tiền hàng × VAT đơn):

| Đơn · đợt | Tiền hàng | VAT đơn | VAT thiếu |
|---|---:|---:|---:|
| PO-145 · 1 | 198.965.403 | 10% | 19.896.540 |
| PO-272 · 2 | 117.600.000 | 8% | 9.408.000 |
| PO-265 · 1 | 62.284.250 | 8% | 4.982.740 |
| PO-272 · 1 | 52.080.000 | 8% | 4.166.400 |
| PO-272 · 3 | 33.600.000 | 8% | 2.688.000 |
| PO-324 · 1 | 19.334.000 | 8% | 1.546.720 |
| PO-270 · 1 | 18.360.000 | 8% | 1.468.800 |
| PO-449 · 1 | 21.175.000 | 6% | 1.270.500 |
| PO-143 · 1 | 10.095.177 | 10% | 1.009.518 |
| PO-477 · 1 | 8.600.000 | 10% | 860.000 |
| PO-217 · 1 (chưa có chứng từ nợ) | 5.525.000 | 8% | 442.000 |
| PO-375 · 1 | 3.400.150 | 8% | 272.012 |
| **Cộng** | | | **48.011.230** |

  Đối chiếu hóa đơn NCC trước: hóa đơn thực tế không VAT thì ghi lý do VAT ở đợt thay vì điều chỉnh. Bật **Báo người xử lý** cho luật `batch_vat_differs` thì từng đợt vào Việc của tôi của người quyền Tài chính.
- **Không sửa**: PO-439 (đơn 0%, đợt 10% — Mua hàng kiểm VAT đơn), PO-373 (đã hủy), 6 đợt cũ PO-038/044/054/057/089/110 (nhận ngoài kho, tiền hàng 0).

## K3 đợt 1 — phủ luật sang phân hệ Kho (24/10, migration `20261031090000_control_k3_wms`)

9 luật mới, **mặc định shadow** (không báo ai, chỉ Admin thấy ở tab Kiểm soát). Cách làm: mỗi luật là một bất biến của sổ kho;
đo số lệch trên dữ liệu thật trước khi đưa vào, luật nào báo phần lớn dữ liệu bình thường thì bỏ (xem "Đã bỏ" bên dưới).

| Mã | Mức | Luật | Mới | Cũ | Ghi chú |
|---|---|---|---:|---:|---|
| stock_vs_ledger | P0 | Tồn kho khác tổng sổ kho | 0 | 0 | bất biến gốc; smoke bắt buộc = 0 |
| stock_negative | P0 | Tồn kho âm | 0 | 0 | bất biến gốc; smoke bắt buộc = 0 |
| ledger_negative_after | P0 | Ghi sổ làm tồn âm tại thời điểm | 0 | 34 | gom theo phiếu; mới nhất 13/07 |
| stock_value_negative | P0 | Giá trị tồn kho âm | 0 | 4 | −11.306.988 đ |
| stock_no_value | P1 | Có hàng trong kho mà giá trị tồn 0 | 0 | 25 | hệ quả của nhập kho giá 0 (hết phát sinh sau 03/10) |
| wms_adjust_no_reason | P1 | Phiếu điều chỉnh / hao hụt kho không ghi lý do | 0 | 4 | |
| count_open_stale | P2 | Phiên kiểm kê mở lâu chưa chốt | 1 | 0 | KK-20261012-B2078, mở 12 ngày |
| count_variance_no_reason | P1 | Dòng kiểm kê lệch chưa ghi nguyên nhân | 0 | 0 | |
| transfer_not_received | P1 | Điều chuyển đã gửi chưa nhận đủ | 0 | 0 | `wms_transfer_lines` còn rỗng; luật canh sẵn |

Tổng: **68 lệch** (1 mới, 67 cũ). Route `{warehouse}` → thủ kho của kho; không xác định được thì chỉ Admin.

**Đường dẫn mở đúng chỗ sửa**: luật tồn kho → `/inventory?q=<sku>` (màn Kho tự chuyển tab Tồn kho và tìm sẵn mã,
qua `useSearchParamPrefill`); luật phiếu → `/operations?tx=<id>`; luật kiểm kê → `/audit?q=<số phiên>`
(đã thêm `useSearchParamPrefill` vào `StockCountView`).

**Đã bỏ sau khi đo** (báo phần lớn dữ liệu bình thường → sẽ thành nhiễu):
- *Xuất cho dự án không gắn yêu cầu*: 54/80 phiếu không gắn — đó là cách làm thường, không phải lệch.
- *Phiếu nhập kho PENDING quá 3 ngày*: 38 phiếu, nhưng phần lớn là đợt giao hàng chưa về thật; ca lệch thật
  (đợt đã nhận mà phiếu kho chưa xong) đã có luật `batch_wms_status`.
- *Phiếu kho có dòng đơn giá 0 (per phiếu)*: 115 phiếu nhập + 65 phiếu xuất, hết phát sinh sau 03/10 — hệ quả đã
  được `stock_no_value` / `stock_value_negative` báo ở đúng mức sửa (mã vật tư + kho, sửa bằng phiếu điều chỉnh giá trị).
  Để lại cho đợt sau, sau khi dọn xong dữ liệu cũ.

Kiểm: `supabase/tests/control_k3_wms_smoke.sql` (giao dịch tự hủy trên Cloud: 9 luật chạy không lỗi, `object_key` không trùng,
2 bất biến gốc = 0, hai luật giá trị không chồng nhau, mọi dòng có đường dẫn mở được, bộ chạy không mở trùng,
luật shadow không sinh thông báo, cờ lệch cũ khớp `since_date`).

## K3 đợt 2 — phủ luật sang phân hệ Tài chính (24/10, migration `20261031100000_control_k3_finance`)

10 luật mới, **mặc định shadow**. Phạm vi: công nợ NCC ở mức chứng từ, đề nghị chi, ngân sách dự án, thu chi tiền.

### Hiện trạng dữ liệu Tài chính trên prod (24/10) — đọc trước khi đọc bảng luật

| Bảng | Số dòng |
|---|---:|
| `supplier_payable_documents` | 62 chứng từ (7,4 tỷ ghi nhận) |
| `supplier_payment_allocations` | **0** — chưa ghi một đồng thanh toán NCC nào |
| `finance_payment_requests` | **0** |
| `finance_project_budgets` | **0** |
| `finance_cash_movements` / `finance_cash_entries` | **0** |

Nên **chỉ 1 luật có lệch thật**; 9 luật còn lại là luật canh, số lệch 0 vì chưa có dữ liệu, không phải vì dữ liệu sạch.
Cần nói rõ việc này với chủ SP: phần thu chi / đề nghị chi / ngân sách của Vioo chưa được dùng thật.

| Mã | Mức | Luật | Mới | Cũ |
|---|---|---|---:|---:|
| payable_over_committed | P1 | Nợ ghi nhận vượt cam kết | 0 | 3 |
| payable_over_settled | P0 | Trả / giảm trừ vượt phần phải trả | 0 | 0 |
| payable_status_vs_balance | P0 | Trạng thái chứng từ nợ không khớp số còn nợ | 0 | 0 |
| payable_no_due_date | P1 | Chứng từ nợ còn dư mà chưa có hạn trả | 0 | 0 |
| payable_orphan_source | P0 | Chứng từ nợ trỏ tới nguồn không còn | 0 | 0 |
| pr_amount_vs_lines | P0 | Số tiền đề nghị chi khác tổng các dòng | 0 | 0 |
| pr_over_outstanding | P0 | Đang đề nghị chi vượt số còn nợ | 0 | 0 |
| pr_stuck_pending | P2 | Đề nghị chi treo ở bước duyệt quá 3 ngày | 0 | 0 |
| budget_total_vs_lines | P1 | Tổng ngân sách khác tổng các dòng | 0 | 0 |
| cash_entry_mismatch | P0 | Phiếu tiền và sổ quỹ không khớp | 0 | 0 |

3 lệch thật của `payable_over_committed` (đều tháng 8 → cũ): **123.428.082 đ** ghi nhận vượt cam kết —
AP-REC…1606fb (+98,2 tr), AP-REC…ababce (+25,2 tr), AP-REC…e6763b (+34 ng). Route `{payable}` → người có quyền
Tài chính · Ghi nhận / Xác nhận.

**Đường dẫn**: dùng tham số deep-link sẵn có của Trung tâm Tài chính, không phải sửa giao diện —
công nợ → `/finance/payables?supplier=<id>`, đề nghị chi → `/finance/requests?request=<id>`,
ngân sách → `/finance/cost?project=<id>`, thu chi → `/finance/cash`.

### Chỉ viết luật cho bất biến mà CSDL KHÔNG tự chặn

Rà `pg_constraint` trước khi viết. Các ca sau đã có CHECK / unique index lo, viết luật là mã chết — **đã bỏ**:
số tiền ≤ 0 (`amount > 0` trên đề nghị chi, phiếu tiền, bút toán quỹ), chuyển tiền cùng một tài khoản
(`kind <> 'transfer' or from_account_id <> to_account_id`), ngân sách thiếu lý do (`length(btrim(reason)) > 0`),
**một dự án có nhiều ngân sách approved** (`finance_project_budgets_one_current` unique index),
nhiều ngân sách chờ duyệt (`finance_project_budgets_one_pending`).

### Bẫy đã gặp: view chặn số âm làm luật thành mã chết

Bản đầu của `payable_over_settled` đọc `supplier_payable_document_balances.outstanding_amount < 0`. View đó tính
`GREATEST(0, recognized − credit − paid − non_cash_credit)` nên **không bao giờ âm** — luật sẽ không bao giờ báo, và
phần trả/giảm trừ thừa cũng không hiện trên màn công nợ. Ca dựng trong smoke bắt được lỗi này; luật đã sửa để tự tính
lại từ các thành phần gốc. Bài học: luật đọc view phải kiểm biểu thức của view, đừng tin tên cột.

### Kiểm: ca dựng thay cho dữ liệu thật

`supabase/tests/control_k3_finance_smoke.sql` (giao dịch tự hủy trên Cloud). Vì 9 luật không có dữ liệu thật để đo,
smoke **tự dựng ca lệch** rồi kiểm luật bắt đúng và bỏ ca đi thì sạch:

| Ca dựng | Kiểm |
|---|---|
| Đặt chứng từ còn nợ sang trạng thái "đã trả" | `payable_status_vs_balance` bắt đúng, đưa về "open" thì sạch |
| Giảm trừ vượt giá trị ghi nhận | `payable_over_settled` bắt đúng + ghi đúng nguyên nhân + đúng số thừa; kiểm cả việc view vẫn trả 0 |
| Đổi `source_id` sang uuid lạ | `payable_orphan_source` bắt đúng |
| Đề nghị chi: số tiền ≠ tổng dòng, dòng vượt số còn nợ, nộp 10 ngày trước | 3 luật đề nghị chi bắt đúng; sửa cho khớp thì luật số tiền sạch |
| Ngân sách tổng 5 tr, dòng 3 tr | `budget_total_vs_lines` bắt đúng, khớp lại thì sạch |
| Phiếu tiền `confirmed` không có bút toán quỹ | `cash_entry_mismatch` bắt đúng + ghi đúng nguyên nhân |

**Thứ tự quan trọng**: bộ chạy (`control_run`) phải chạy **trước** khi dựng ca — dữ liệu dựng làm các luật K0 đang
`live` báo và sinh thông báo, làm khẳng định "shadow không báo ai" đỏ oan.

Ngoài ra smoke kiểm: 10 luật chạy không lỗi, `object_key` không trùng, mọi dòng có đường dẫn `/finance…`,
chạy lần hai không mở trùng, không sinh thông báo nào, và ghi lại hiện trạng số dòng 5 bảng Tài chính để lần sau so.

## K3 đợt 3 — phủ luật sang phân hệ Nhân sự (24/10, migration `20261031120000_control_k3_hrm`)

14 luật mới, **mặc định shadow**. Phạm vi: chấm công, phép, lương. Dữ liệu thật đầy đủ (1.988 bản ghi chấm công,
269 đề xuất, 42 đơn phép, 97 dòng sổ phép, 35 bảng lương) nên đo được số lệch thật: **35 lệch trên 6 luật**.

| Mã | Mức | Luật | Lệch thật |
|---|---|---|---:|
| att_future_date | P0 | Chấm công ngày tương lai | **2** |
| att_checkout_before_checkin | P0 | Giờ ra trước giờ vào | 0 |
| att_suspicion_unresolved | P1 | Chấm công có dấu hiệu nhờ người khác chấm | **6** |
| att_out_of_range_pending | P1 | Chấm công ngoài phạm vi chưa ai duyệt | 0 |
| att_proposal_stuck | P2 | Đề xuất chấm công treo chờ duyệt > 3 ngày | 0 |
| att_after_exit | P0 | Chấm công sau ngày nghỉ việc | 0 (mù tới khi HR ghi ngày) |
| employee_resigned_no_exit_date | P1 | Đã nghỉ việc mà chưa ghi ngày nghỉ việc | **3** |
| leave_balance_vs_ledger | P0 | Số dư phép khác sổ phép | 0 — bất biến gốc |
| leave_ledger_running | P0 | Số dư lũy kế trên sổ phép không khớp | 0 — bất biến gốc |
| leave_approved_no_ledger | P0 | Phép có lương đã duyệt mà chưa vào sổ phép | **6** |
| leave_vs_attendance | P1 | Nghỉ phép đã duyệt mà vẫn chấm công đi làm | **11** |
| leave_overlap | P1 | Hai đơn phép trùng ngày | 0 |
| leave_stuck_pending | P2 | Đơn phép treo duyệt quá 3 ngày | **7** |
| payroll_net_vs_gross | P0 | Lương thực nhận khác lương gộp trừ các khoản | 0 |

`att_after_exit` và `employee_resigned_no_exit_date` đi theo cặp: chưa có ngày nghỉ việc thì luật kia không soi được.
3 người đang bị báo đúng là 3 người HR còn treo ngày nghỉ việc (xem [[hrm-exit-date-events]]).

### Route mới `hr`

`control_route` thêm một nhánh: `'hr'` → `alert_module_manager_ids(array['HRM'])` (5 người có quyền Nhân sự · Quản trị
trên prod). Phép và lương là dữ liệu riêng tư nên **không giao cho quản lý trực tiếp** của nhân viên bị báo, chỉ HR và
Admin. Các nhánh `buyer` / `warehouse` / `payable` giữ nguyên — smoke khẳng định route của luật Kho và Công nợ không đổi.

Luật lương để các con số lương trong `detail`, **tiêu đề chỉ nói số lệch** (smoke kiểm điều này) để lệch hiện trên
danh sách mà không phô lương gộp.

### Bẫy lớn nhất đợt này: HRM trỏ `employees(id)`, không phải `users(id)`

Bản đầu join `public.users` — khớp **0/1.988** dòng. Hậu quả: mọi tiêu đề ra "—" và luật "chấm công của người đã khóa
tài khoản" thành mã chết, mà vẫn chạy không lỗi nên trông như "0 lệch, dữ liệu sạch". Một phép đo giả (`cham_cong_nguoi_khoa = 0`)
cũng từ đây. Mọi bảng `hrm_*` dùng `employees(id)`; tên là `employees.full_name`, mã là `employees.employee_code`,
trạng thái là `employees.status` ('Đang làm việc' / 'Đã nghỉ việc'). `hrm_employee_employment_events.created_by` thì lại
là `users(id)`. Smoke nay có khẳng định riêng: tiêu đề luật phải có mã / tên nhân viên thật.

Vì phát hiện này, luật 7 đã đổi từ "chấm công của người đã khóa tài khoản" (đo bằng `users.is_active`, sai bảng) sang
**"đã nghỉ việc mà chưa ghi ngày nghỉ việc"** — đo được 3 người, và là việc HR làm được ngay.

### Đã bỏ sau khi đo

- *Chấm vào mà không chấm ra*: 206/1.988 bản ghi (79 người-tháng) — 10% toàn bộ, là thói quen chung của công trường
  chứ không phải lệch từng bản ghi; hôm nay riêng ngày 24/10 có 46 ca là người còn đang làm. Thuộc **báo cáo chấm công**
  (tỷ lệ thiếu chấm ra theo tháng), không thuộc sổ lệch.
- *Cờ `no_passkey`*: 299/1.988 — chưa cài passkey là tình trạng thiết bị, không phải lệch. Luật dấu hiệu chấm hộ chỉ
  tính `shared_device` và `same_gps_fix` (6 ca).
- *Số ngày công bảng lương khác số ngày chấm công*: 34/35 bảng lương — lương nhập từ file, không suy ra từ chấm công.
- *Chấm công trùng ngày* (`unique_employee_date`), *bảng lương trùng tháng* (`unique_employee_month_year`),
  *số dư phép trùng năm* (`unique_employee_year_balance`), *số ngày phép không bội 0,5* (CHECK) — CSDL đã chặn.

### Kiểm

`supabase/tests/control_k3_hrm_smoke.sql` (giao dịch tự hủy trên Cloud): 14 luật chạy không lỗi, `object_key` không trùng,
mọi dòng có đường dẫn `/hrm/…`, tiêu đề có mã / tên nhân viên, 2 bất biến phép = 0, 6 luật có lệch thật đều bắt được,
route `hr` ra đúng người và route cũ không đổi, bộ chạy không mở trùng, không sinh thông báo nào. Thêm **8 ca dựng** cho
các luật đang bằng 0: giờ ra trước giờ vào, chấm ngoài phạm vi (duyệt rồi thì sạch), chấm công sau ngày nghỉ việc
(sự kiện `VOID` thì sạch), sổ phép bị sửa dòng (bắt cả hai luật bất biến), hai đơn phép trùng ngày, lương thực nhận lệch
(kiểm cả việc tiêu đề không in lương), đề xuất chấm công treo, ghi ngày nghỉ việc thì luật sạch.

**Không phá được bất biến phép từ phía số dư**: trigger `trg_hrm_leave_balance_write_ledger` tự ghi dòng sổ cho mọi lần
sửa số dư. Lỗi thật chỉ đến từ phía sổ (dòng bị sửa / xóa), nên ca dựng sửa một dòng sổ giữa.

**Đường dẫn**: chấm công → `/hrm/attendance?tab=timesheet&q=<mã NV>&month=&year=` (đã thêm prefill `?q=` + tháng/năm vào
`pages/hrm/Attendance.tsx`; ô tìm khớp cả mã và tên); đề xuất → `?tab=proposals&proposal=<id>`; phép → `/hrm/leave?request=<id>`
hoặc `?tab=balances`; hồ sơ → `/hrm/employees?view=roster&person=<id>`; lương → `/hrm/payroll`.

## Trợ lý đọc được sổ lệch (24/10, migration `20261031150000_control_findings_search`)

Chủ SP 24/10 hỏi Trợ lý *"3 người đã nghỉ việc mà chưa ghi ngày nghỉ là ai"* → Trợ lý trả lời **không có danh sách** và
chỉ sang màn Nhân sự, dù sổ lệch lúc đó đang giữ đúng 3 cái tên.

**Vì sao**: công cụ `lech_kiem_soat` chỉ có `control_findings_for_code_v1(p_code)` — **bắt buộc mã chứng từ**
(PO-…, MR-…). Câu hỏi này không có mã nào. Lời nhắc còn ghi thẳng: hỏi chung "tôi có lệch nào cần sửa" thì
*chỉ sang màn /kiem-soat*. Nên Trợ lý làm đúng như được dặn — nó quay sang `bien_dong_nhan_su`, công cụ này
trả **con số** chứ không trả danh sách tên. Nói cách khác: 51 luật dạy máy chủ rất nhiều, nhưng Trợ lý chưa biết hỏi lại.

**RPC mới** `control_findings_search_v1(p_rule, p_who, p_module, p_severity, p_limit)`:

| Tra theo | Tham số | Ví dụ câu hỏi |
|---|---|---|
| Mã chứng từ | `p_who` (hoặc đường cũ `ma`) | "PO-609 có gì lệch" |
| Luật | `p_rule` — mã luật hoặc **chữ trong tên luật** | "ai đã nghỉ việc mà chưa ghi ngày" → `nghỉ việc` |
| Người / vật tư | `p_who` — **không dấu cũng tìm được** (`unaccent`) | "anh Long đang bị lệch gì" → `long` |
| Nhóm | `p_module` + `p_severity` | "Kho có lệch P0 nào" |
| Không lọc | — | "tôi có lệch nào cần sửa" → bảng tổng hợp theo luật |

Không lọc thì **chỉ trả bảng tổng hợp**, không trả danh sách dài (danh sách đầy đủ vừa dài vừa không giúp người hỏi).

**Quyền không đổi**: dùng lại `app_private.control_can_view` — Admin thấy hết; người khác chỉ thấy lệch **của mình**
ở luật **đã bật**, không thấy dữ liệu cũ và không thấy luật đang chạy thử. Nghĩa là 39 luật shadow vẫn chỉ Admin đọc
được qua Trợ lý, không rò sang nhân viên.

**Lời nhắc** (`chat.ts`) đổi từ "đẩy sang màn Lệch cần sửa" thành: gọi công cụ, và **công cụ trả ai / chứng từ nào thì
phải liệt kê ra**, không được chỉ nói số lượng rồi bảo người dùng tự đi tìm. Màn `/kiem-soat` chỉ còn là bước làm tiếp theo.

Hàm phải là **CTE, không dùng bảng tạm**: `create temp table` không chạy được trong hàm `STABLE`
(`0A000: CREATE TABLE is not allowed in a non-volatile function`).

Kiểm: `supabase/tests/control_findings_search_smoke.sql` (Cloud, giao dịch tự hủy — Admin tra đủ 6 kiểu, người ngoài
không thấy gì, người xử lý chỉ thấy lệch của mình và không thấy dữ liệu cũ / luật chạy thử, chưa đăng nhập thì chặn)
và `lib/__tests__/assistantControlLedger.test.ts` (9 ca: đúng câu chủ SP hỏi, mã chứng từ vẫn đi đường cũ,
không lọc → tổng hợp, không có kết quả thì nói "không thấy trong phạm vi xem được" chứ không khẳng định sạch).

## Trợ lý · "tình hình hôm nay của một nhóm" (24/10, migration `20261031160000_assistant_today_status`)

Đo độ phủ trên **82 câu hỏi thật** của 8 người (17–24/10) cho thấy Trợ lý lệch nặng giữa 3 tầng:
tìm được **20 loại** hồ sơ, đọc chi tiết được **5 loại**, và gần như **không có** dạng "nhóm người / hôm nay" —
dạng người dùng hỏi hằng ngày. 10/82 câu nhận "chưa có công cụ", 3 câu tìm sai cách, 5 câu bị đẩy sang màn khác.

RPC `assistant_today_status_v1(p_kind, p_scope, p_date, p_days, p_limit)` — 4 loại:

| loai | Trả lời câu | Số thật 24/10 |
|---|---|---|
| `cham_cong` | "hôm nay phòng X ai chưa chấm công" | HCNS 14 người: 6 đã chấm, 8 chưa; toàn công ty 38/89 |
| `nghi_phep` | "hôm nay ai nghỉ" | 3 người |
| `nhat_ky` | "công trường nào chưa gửi nhật ký" | 2 công trường đang dùng, cả 2 chưa gửi |
| `phieu_dung` | "phiếu nào đang tắc" | 19 phiếu đứng im ≥ 7 ngày |

**Quyền dùng lại helper sẵn có, không tự nới**: `current_actor_hrm_visible_employee_ids(<mã quyền>)` cho chấm công
(`hrm.attendance.view`) và nghỉ phép (`hrm.leave.view`) — helper này tự xử lý phạm vi global / của mình /
**cấp dưới trực tiếp**, nên trưởng phòng hỏi được về người của mình mà không cần quyền HR toàn công ty;
`project_scope_has_any_grant_v2` cho nhật ký; `workflow_visible_instance_ids()` cho phiếu quy trình.
Smoke khẳng định nhân viên thường chỉ thấy **1 người** (chính mình) và **0** đơn nghỉ.

**Hai chỗ dễ báo sai, đã xử lý**:
- *Nghỉ phép đã duyệt không tính là chưa chấm công* — nếu không sẽ gọi tên người đang nghỉ đúng phép.
- *Nhật ký chỉ tính công trường ĐANG dùng* (có phiếu trong 30 ngày): 7 công trường nhưng chỉ 2 dùng thật,
  tính cả 7 sẽ báo nhầm 5 cái không ai ghi bao giờ.

**`app_private.vi_match(text, query)`**: khớp tiếng Việt theo **từng từ** chứ không theo nguyên chuỗi.
Người dùng gõ "hành chính nhân sự" phải khớp "Phòng Hành chính **-** Nhân sự" (có gạch ngang) — bản đầu dùng
`like '%…%'` nên trượt sạch, Admin tra ra 0 người. Gõ không dấu cũng ra như gõ có dấu (smoke kiểm cả hai).

**Bẫy kiểu dữ liệu**: `daily_logs.construction_site_id` là `text` còn `hrm_construction_sites.id` là `uuid` —
phải ép `s.id::text`.

Kiểm: `supabase/tests/assistant_today_status_smoke.sql` (Cloud, giao dịch tự hủy — 4 loại trên dữ liệu thật,
lọc có dấu / không dấu ra như nhau, người nghỉ phép không bị tính, nhật ký không báo công trường chưa dùng bao giờ,
ngưỡng ngày có tác dụng, chặn loại sai và ngày tương lai, nhân viên thường chỉ thấy mình, chưa đăng nhập thì chặn)
và `lib/__tests__/assistantTodayStatus.test.ts` (8 ca).

Còn thiếu sau đợt này (xếp theo độ phủ đã đo): đọc chi tiết **nhật ký / phiếu quy trình / yêu cầu** (828 bản ghi
chỉ tìm được, không đọc được; riêng nhật ký còn chưa có trong `tim_ho_so`), tra theo **chức danh / đơn vị** thay vì
theo tên, **việc của người khác**, **tổng quan + dự báo một dự án**, **soạn nháp đề nghị thanh toán**.

## Việc tiếp (K3 đợt 4+)

Còn ~45 luật: Dự án / Tiến độ, Quy trình, Yêu cầu / Đề xuất, Danh mục vật tư.
Mỗi luật mới vào shadow tối thiểu 1 tuần, xem số lệch thật, sửa luật báo sai, rồi mới để chủ SP bật Báo người xử lý.
Phân hệ chưa có dữ liệu thật thì làm như đợt 2: dựng ca trong smoke để chứng minh luật, và nói rõ số 0 là "chưa dùng",
không phải "sạch".
