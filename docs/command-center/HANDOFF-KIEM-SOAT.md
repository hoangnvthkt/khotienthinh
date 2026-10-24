# HANDOFF — Kiểm soát viên AI (K0–K2 + dải cảnh báo) · cập nhật 24/10/2026

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

## 5. Trạng thái 18 luật trên prod (24/10)

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

1. Bật 8 luật còn ở chế độ shadow (bảng trên). Em đề xuất bật hết; hiện chỉ có lệch cũ, riêng `mr_completed_short` có 4 lệch mới.
2. Giao lệch **cũ** có tiền cho người xử lý (vào Việc của tôi, không báo đẩy):
   - `receipt_without_ap` 124,5 tr → kế toán.
   - `batch_vat_differs` 6 lệch cũ 11,4 tr → kế toán.
   - `batch_wms_status` → thủ kho.

   Cần sửa `control_can_view` / route cho từng luật, hoặc thêm cờ "giao cả dữ liệu cũ" trên `control_rules`.
3. PO-259 đợt 1, 854 tr, đã duyệt chất lượng nhưng chưa nhập kho: giao thủ kho hoàn tất, hoặc Mua hàng kết thúc thiếu.
4. 14 lệch đặt vượt cũ: (a) lập bảng thép thừa để chủ SP xem — đề xuất; hoặc (b) chấp nhận hàng loạt.

**Cần nói lại với chủ SP**: chủ SP nghĩ PO-609 và PO-671 là phiếu nháp sẽ bỏ, nhưng:
- **PO-609** đã giao, đã nhận hàng, bảng đối soát DCHD-202610-2865B0 đã ghi nợ. Muốn bỏ phải đảo đối soát + công nợ trước.
- **PO-671** đã duyệt, chưa nhận. Bỏ được bằng Kết thúc thiếu / Hủy.

Khi chủ SP bỏ xong, Chấp nhận 2 lệch với lý do "phiếu thử".

**Chờ người khác**:
- Kế toán: điều chỉnh 48,0 tr VAT thiếu (12 đợt) và ghi nợ 124,5 tr chưa ghi (3 đợt).
- Người mua (PO-315, PO-463 — đã trả lại 24/10): sửa SL về phần còn thiếu rồi gửi lại.
- Người mua PO-439: đối chiếu hóa đơn VAT (đơn 0%, đợt 10%).
- Thủ kho: chốt PO-116/163/181 đợt 1 ở Đối chiếu nhận hàng.

**Bước tiếp theo đã đề xuất**: **K3** phủ luật sang Kho / Tài chính / Nhân sự (~80 luật). Mỗi luật mới chạy shadow ít nhất 1 tuần, xem số lệch thật, sửa luật báo sai, rồi mới để chủ SP bật.

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

## 9. Quy tắc làm việc với chủ SP

- Xưng "em", gọi "anh"; trả lời tiếng Việt, ngắn: tiêu đề + số liệu, giải thích để trong tooltip.
- Có nhiều phương án thì đưa **chip bấm được** / câu hỏi có lựa chọn, kèm đề xuất.
- Hỏi trước khi chạy bộ kiểm model thật (nói số ca + ước lượt gọi). Được dùng subagent khi nhanh hơn.
- Ảnh xem thử giao diện để nền sáng. Giữ style UI hiện tại (`docs/ui/VIOO-UI-UX.md`).
- Chủ SP = Super Admin, tài khoản "Admin Hoàng", ADMIN duy nhất.
- Supabase Cloud only, không dùng local / Docker.
