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

## Việc tiếp (K3 đợt 2+)

Còn ~70 luật: Tài chính (thu chi, đề nghị chi, ngân sách), Nhân sự (chấm công, phép, lương), Dự án / Tiến độ, Quy trình.
Mỗi luật mới vào shadow tối thiểu 1 tuần, xem số lệch thật, sửa luật báo sai, rồi mới để chủ SP bật Báo người xử lý.
