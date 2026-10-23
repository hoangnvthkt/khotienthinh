# Kiểm soát viên K0 — bộ luật + sổ phát hiện (23/10/2026)

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

## Việc tiếp (K1)

Đưa lệch tới đúng người (dải cảnh báo trên chứng từ, mục Cần sửa ở Việc của tôi, bản tin 07:00, P0 đẩy ngay), Trợ lý trả lời "PO-609 có gì lệch?".
Chờ chủ SP chốt 5 câu ở artifact (người xử lý, dữ liệu cũ, kênh báo, chặn hay cảnh báo, ai được chấp nhận lệch) — K0 dùng đề xuất mặc định:
dữ liệu cũ tách riêng từ 01/10, chỉ Admin chấp nhận.
