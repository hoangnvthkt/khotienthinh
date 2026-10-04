# HANDOFF 04/10/2026 — Module Tài chính (đợt 1 → 3b-2)

Người đọc: phiên Claude mới tiếp nhận **module Tài chính** của Vioo. Đọc hết file này trước khi làm.

Trạng thái lúc bàn giao: không có việc Tài chính nào đang code dở. Bốn đợt Tài chính cuối (#86, #87, #89, #91, #93) **đã lên production và đã merge**. Việc tiếp theo do chủ SP chọn (gợi ý ở mục 9).

**Không phải việc của phiên này:** Module Vật tư (kho) do một phiên khác làm ở worktree `project-loop`, nhánh `feature/wms-v1-3-variants`, PR #92. Không đụng vào nhánh, worktree hay migration `20261008137200`, `20261008137300` của phiên đó. Nếu chủ SP nhắn việc Vật tư nhầm sang đây thì hỏi lại.

---

## 0. Đọc ngay

1. **Sổ việc:** memory `owner-task-ledger.md` (nạp qua `MEMORY.md`). Đầu phiên đọc sổ. Nhận việc hay xong việc đều cập nhật sổ. Mỗi báo cáo cuối lượt liệt kê việc còn treo.
2. **Tài liệu thiết kế Tài chính:** `docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md`. Mục 15–19 là các đợt trong file này; mỗi mục có quyết định của chủ SP, mô hình dữ liệu và kịch bản đã kiểm thử.
3. **Memory liên quan:** `finance-hub-k3-decisions.md`, `ui-theme-fastcons-green.md`, `feedback-ui-style-keep.md`, `preview-light-mode.md`, `pr-shipping-checklist.md`, `verify-chains-pipefail.md`, `erp-exception-flows-clean-history.md`, `permission-tiers-rule.md`.

---

## 1. Cách làm việc với chủ sản phẩm (hoangnvthkt)

- **Ngôn ngữ:** tiếng Việt; chủ SP xưng "anh", gọi agent là "em". Trả lời ngắn, có số liệu thật.
- **Quy trình mỗi việc lớn:**
  1. Khảo sát dữ liệu thật trên production (chỉ đọc).
  2. Làm mockup trên dữ liệu thật, kèm câu hỏi đánh số và phương án đề xuất (a).
  3. Chủ SP trả lời kiểu "Đồng ý cả N, chọn a".
  4. Code.
  5. Test rollback trên production.
  6. Walkthrough desktop + điện thoại, **nền sáng**.
  7. Mở PR.
  8. Chủ SP **tự chạy** lệnh deploy (dry-run rồi `--apply`).
  9. Em kiểm tra production (chỉ đọc), squash-merge, cập nhật sổ việc.
- **Mỗi việc cần duyệt riêng:** deploy migration, merge, sửa dữ liệu thật, cấp quyền. "Bắt đầu code" ≠ được deploy.
- **Không được tự làm:**
  - Bộ phân loại tự động **chặn agent chạy `prod-push … --apply`** và các script ghi dữ liệu `--commit`. Đưa lệnh cho chủ SP chạy.
  - **Cấp quyền cho người:** đề nghị chủ SP làm ở Cài đặt → Phân quyền (có nhật ký), không ghi thẳng vào bảng quyền.
  - Không nhập mật khẩu; không mở hay in token trong `.env`.
- **Quy tắc repo (AGENTS.md):** chỉ Supabase Cloud (không local / Docker); **không dùng sub-agent**; không dùng Superpowers skills cho việc đơn giản. Phải nghĩ như Product Designer: thể hiện đúng trạng thái loading / empty / error / unknown / denied / pending; **không che "chưa biết" bằng 0**.
- **Dữ liệu toàn vẹn:**
  - Không sửa đè: chỉ ghi thêm và có nhật ký (`finance_events`). Sổ thu chi bất biến, sai thì đảo bằng dòng ngược chiều.
  - Tính đủ luồng ngược: hủy, trả lại, đảo, thiếu, thừa.
  - Người lập ≠ người duyệt ≠ người xác nhận (kể cả Admin).
- **Báo cáo cuối lượt (tiếng Việt):** Đã làm · Đã kiểm tra (nói rõ cái **chưa** kiểm) · Phát hiện từ dữ liệu · Câu hỏi đánh số (đề xuất a) · Còn treo (kèm lệnh deploy nếu có).
- **Git:**
  - Không dùng `git stash` trần.
  - Không đụng root checkout `/Users/admin/khotienthinh` (phiên khác đang dùng).
  - Không đụng worktree `project-loop` (phiên Vật tư).
  - Mỗi việc một worktree / nhánh riêng.

## 2. Style UI bắt buộc giữ (chủ SP khen, "giữ nguyên")

- **Theme FastCons xanh:**
  - Tên / mã có id: `ENT` = `font-semibold text-mint-700`.
  - Số liệu: `NUM` = `font-semibold tabular-nums text-leaf-700`.
  - Nút chính teal-700; cam / đỏ **chỉ** cho cảnh báo.
- **Dùng lại có sẵn:** component `components/procurement/hub/hubUi.tsx` (`Badge`, `Drawer`, `StateBox`, `inputCls`, `primaryBtn`, `secondaryBtn`, `money`) và `components/finance/financeUi.tsx` (`shortMoney`, `viDate`, `moneyInput`, `parseMoney`, `AttachmentPicker`, `CashAccountSelect`, `RouteExtrasNote`, `Kpi`).
- **Điện thoại:** CSS toàn cục cắt chữ `.grid > div .text-xs` → dùng `span` cho KPI. Bảng rộng có danh sách thẻ riêng cho mobile (`md:hidden`). Không cuộn ngang trang.
- **Xác nhận:** dùng `useConfirm` / `useReasonConfirm` (`context/ConfirmContext`); thao tác đảo / trả lại luôn bắt buộc lý do.

---

## 3. Môi trường và công cụ

### Worktree
| Đường dẫn | Dùng cho |
|---|---|
| `/Users/admin/khotienthinh/.worktrees/finance-cost` | Tài chính 3b-1, 3b-2 và handoff này. Dùng tiếp cho việc Tài chính (tạo nhánh mới từ `origin/main`) |
| `/Users/admin/khotienthinh/.worktrees/supplier-advance` | Tài chính #86–#89 (cũ, đã merge) + fixture `.superpowers/review/adv/` |
| `/Users/admin/khotienthinh/.worktrees/project-loop` | **Phiên Vật tư — không đụng** |

- `node_modules` trong mỗi worktree là symlink sang `../project-loop/node_modules`.
- `.superpowers/review` là symlink sang `supplier-advance/.superpowers/review`; bên trong `work-plan` là symlink sang `project-loop/.superpowers/review/work-plan`.
- `.superpowers/` bị `.git/info/exclude` bỏ qua, không commit.

### Công cụ — `.superpowers/review/work-plan/tools/`
- **Đọc production:**
  - `q.mjs "<sql>"`: chỉ đọc qua Management API. Cột trùng tên bị gộp, nên đặt alias.
  - `rq.mjs "<sql>"`: chạy trong `begin … rollback`, gọi được hàm `app_private`.
- **Lấy định nghĩa hàm:** `fn-dump.mjs <thư-mục> 'public.ham(jsonb)' …` lấy bản đang chạy (ghi vào scratchpad của phiên).
- **Sinh migration:** `gen_<việc>.py` + `<việc>_template.sql`.
  - Template = phần mới.
  - Script vá hàm đang chạy bằng thay chuỗi **có đếm đúng 1 lần** (`assert count == 1`).
  - Biến `LIVE` trỏ thư mục dump trong scratchpad của phiên cũ → phiên mới phải dump lại rồi sửa đường dẫn.
  - Ví dụ: `gen_cb2.py` + `cb2_template.sql` → `20261008134400_…sql`.
- **Test rollback:**
  - `adv-test*.mjs` (tạm ứng), `rcv-test.mjs` (phải thu), `cash-test.mjs` (thu chi), `cb-test.mjs` (ngân sách / quỹ dự án), `cb2-test.mjs` (phân bổ / quỹ công trường).
  - Mỗi file nạp migration rồi đóng vai từng người: `set_config('request.jwt.claims', {sub: <auth_id>})` + `set local role authenticated`.
  - Đặt kết quả vào bảng tạm `t` / `kv`, cuối cùng `rollback`.
  - Đọc hàm `app_private` thì `reset role` trước, vì người dùng không có quyền gọi trực tiếp.
- **Deploy:** `prod-push-remote-placeholders.mjs --include-all`. Đọc migration ở **thư mục hiện tại**, nên lệnh phải `cd` vào đúng worktree. Dry-run trước, `--apply` sau, và do chủ SP chạy.

### Xem thử (fixture)
- **Cấu hình:** component thật + `financeService` giả (gán đè hàm) + JSON chụp từ rollback (`<test> --live`).
- **Máy chủ** (`/Users/admin/khotienthinh/.claude/launch.json`):
  - `finance-cost` cổng 5186, cấu hình `finance-cost/.superpowers/cost/vite.config.mjs`.
  - `supplier-advance` cổng 5185.
- **Trang 5186:**
  - `cost-app.html?as=thinh|mo|thuy[&project=<id>]`
  - `cb2-app.html?page=alloc[&state=sub|done]|cash|cht`
  - mockup `cb-v2.html`
- Fixture phải nằm trong thư mục thật của worktree, vì Vite phân giải symlink sang worktree khác.

### Kiểm trước PR (CI)
```bash
set -o pipefail && npm run -s lint && npm run -s check:supabase-migrations && npm run -s check:supabase-queries && npx vitest run && npm run -s build
```
- Migration mới phải thêm tên file vào `supabase/baseline/current.json` → `allowedPostBaselineFiles`.
- Xung đột file này khi gộp main: giải bằng **hợp hai danh sách JSON**, không sửa tay.
- **Drift check:** trước PR, dump lại các hàm sẽ vá và so với bản đã dùng để sinh migration (`cmp`); khác thì sinh lại.
- **Merge:**
  - Lệnh: `/opt/homebrew/bin/gh pr merge N --squash --subject "<tiêu đề> (#N)"`.
  - Sau `gh pr create` gọi `ccd_pr get_status` để gắn PR.
  - Check "Supabase Preview" đỏ là bình thường.
  - Không tự poll CI.

---

## 4. Module Tài chính — kiến trúc

- **Đường dẫn:** route `/finance` (`pages/finance/FinanceHub.tsx` → `components/finance/FinanceHubView.tsx`).
  - Tham số URL: `section`, `supplier`, `request`, `contract`, `project`, `view`.
- **7 tab:** Tổng quan · Việc cần làm · Phải thu · Phải trả (gồm đề nghị chi, tạm ứng NCC) · Thu chi & quỹ · Chi phí & ngân sách (Dự án & quỹ dự án | Phân bổ tháng) · Quản trị.
- **Màn ngoài hub:** `/site-fund` "Quỹ công trường của tôi" (route mở cho mọi người đăng nhập; máy chủ chỉ trả quỹ người đó giữ); lối tắt ở `pages/EmployeeDashboard.tsx`.
- **Quyền** `system.finance.{view, record, confirm, manage}`:
  - Hàm kiểm: `app_private.finance_can(action)`; cờ hiển thị: `finance_can_flags()`.
  - Nhãn và mô tả ở `permission_actions` + `lib/permissions/permissionRegistry.ts`, cập nhật 04/10.
  - Không có quyền riêng cho: người duyệt vượt ngân sách, người cấp vốn (cài trong `finance_settings`), người giữ quỹ công trường (`cash_funds.holder_user_id`).
- **Service:** `lib/financeService.ts`. Hàm `call()` ánh xạ mã lỗi máy chủ sang câu tiếng Việt (`ERROR_MESSAGES`), nhãn nhật ký ở `EVENT_LABELS`.
- **Mẫu máy chủ:**
  - RPC `SECURITY DEFINER` + `set search_path = ''`, lỗi có `errcode`, kiểm `row_version`.
  - Bảng: RLS chỉ cho đọc khi `finance_can('view')`, mọi ghi qua hàm.
  - Mọi thao tác ghi `finance_events`.
  - Thông báo: `finance_notify*` (link về đúng màn).

### Migration (đều đã lên production)
| File | PR | Nội dung chính |
|---|---|---|
| `20261008134000_finance_supplier_advances.sql` | #86 | Tạm ứng NCC (đề nghị loại `advance` gắn PO / HĐ, cấn trừ tự động khi kho nhận hàng, hoàn / chuyển tạm ứng); màn Quản trị (thông số, trách nhiệm, ràng buộc) |
| `20261008134100_finance_customer_receivables.sql` | #87 | Phải thu CĐT: đợt thu, phiếu thu + phân bổ, đầu kỳ, bảo lãnh, điều khoản HĐ; tab Dự án chỉ đọc phần CĐT (trigger `CUSTOMER_RECEIVABLE_FINANCE_ONLY`) |
| `20261008134200_finance_cash_treasury.sql` | #89 | Thu chi & quỹ: tài khoản tiền (`cash_funds` mở rộng), đầu kỳ, sổ thu chi bất biến `finance_cash_entries` (mốc `ap_cutover_date` 01/10, khóa tháng khi chốt đối chiếu), thu khác / chuyển tiền, phiếu chi khác (đề nghị loại `expense`, mã CK-), dự báo 8 tuần, tồn quỹ tối thiểu |
| `20261008134300_finance_cost_budget.sql` | #91 | Ngân sách theo khoản mục (phiên bản, duyệt), chi phí + cam kết + dự báo khi hoàn thành, quỹ dự án (đầu kỳ, cấp / thu hồi vốn, tự cấp vốn khi chi làm quỹ âm), bước duyệt thêm `finance_route_extras` (vượt ngân sách / cấp vốn dự án), đơn Mua hàng vượt dự toán vật tư chờ duyệt ở Tài chính |
| `20261008134400_finance_allocation_site_fund.sql` | #93 | Phân bổ tháng (lương theo công trường + chi phí chung), quỹ công trường / hoàn ứng (`finance_site_expenses`, người giữ quỹ), tab Tài chính Dự án chỉ xem, hủy quyết toán quỹ công trường kiểu cũ, mô tả 4 quyền |

Các đợt trước (#60, #61, #66, #68, #70, #85) xem doc 08 mục 1–14 và memory `finance-hub-k3-decisions.md`.

### Khái niệm then chốt
- **Đề nghị chi** `finance_payment_requests`:
  - Loại `payable` (trả công nợ), `advance` (tạm ứng), `expense` (chi khác).
  - Luồng duyệt theo ma trận (`finance_payment_route`, cộng dồn 7 ngày cùng NCC) + bước thêm (`finance_advance_route`, `finance_route_extras`), chốt lúc gửi.
  - Xác nhận đã chi do người thứ ba (`confirm_finance_payment_request_v1`): bắt buộc tài khoản tiền, số UNC, file.
- **Chi phí dự án** = `project_transactions` loại `expense`, bỏ dòng `source_ref like 'supplier_payment_batch:%'` (đó là dòng chi tiền, không phải chi phí).
  - Khoản mục: `contract_cost_items` (CPNVL vật tư, CPNC nhân công, CPMTC máy, CPQL quản lý chung, CPL lương văn phòng, CPL1 lương BCH công trường, CPNG ngoại giao, CPK khác).
  - Giao dịch chưa gắn khoản mục tự xếp theo `category`.
  - `source_ref` phải duy nhất (có index unique): ghi nhiều dòng thì thêm hậu tố.
  - Ghi / đảo chi phí: `app_private.finance_post_project_cost` / `finance_reverse_project_cost`.
- **Quỹ dự án:** không phải tài khoản thật. `finance_project_fund_rows`:
  - Lấy từ sổ thu chi theo dự án (chi NCC chia theo dự án của từng chứng từ trong đề nghị).
  - Chuyển tiền sang / về quỹ công trường của dự án là chi / thu; khoản chi trên quỹ công trường không tính lại.
  - Cộng vốn cấp và phân bổ tháng.
  - Chưa chốt đầu kỳ thì số dư = `null`.
- **Mốc:** `finance_settings.ap_cutover_date = 2026-10-01`. Trước mốc là số MISA (đầu kỳ 30/09 do người khác chốt).

---

## 5. Quyết định của chủ SP đã áp dụng (tóm tắt)

- **Tạm ứng NCC (#86):**
  - Gắn PO / HĐ, tối đa giá trị đơn; cảnh báo 30%, từ 50% thêm bước TGĐ duyệt; hạn hoàn ứng = ngày hẹn giao.
  - Có màn Quản trị Tài chính. Tài chính tách khỏi Dự án; Dự án chỉ xem.
- **Phải thu CĐT (#87):** 8 câu (đợt thu theo HĐ, thu hồi tạm ứng CĐT, giữ lại bảo hành, đầu kỳ theo MISA…). HĐ RICO, HĐ03 chủ SP đã hủy.
- **Thu chi & quỹ (#89):**
  - Từ 01/10 mọi khoản tiền qua tài khoản Vioo (MISA vẫn là sổ kế toán); tồn quỹ tối thiểu 2 tỷ.
  - Quỹ công trường làm ở đợt sau (đã làm ở #93).
- **Quỹ dự án (03/10):** tự động; chi làm quỹ âm thì thêm bước "Cấp vốn dự án" (không chặn cứng); người cấp vốn mặc định **chị Mơ**; lương + chi phí chung được phân bổ vào quỹ.
- **Chi phí & ngân sách (#91):**
  - Ngân sách theo khoản mục; vật tư = dự toán vật tư.
  - Cảnh báo 90%; vượt 100% thêm bước duyệt (người duyệt vượt ngân sách = **TGĐ Thịnh**, chủ SP đồng ý 04/10).
  - Dự báo = chi phí ÷ tiến độ Gantt khi tiến độ ≥ 20%.
  - Nhắc đơn quá hẹn giao > 30 ngày.
- **Phân bổ + quỹ công trường (#93):** 8 câu đều phương án a.
  - Lương = lương gộp bảng lương đã duyệt × công ở công trường (bảng công chốt + chấm công), sửa có lý do → CPL1.
  - Chi phí chung chia theo tiền CĐT trả trong tháng → CPQL; tháng không có tiền CĐT trả thì để lại công ty.
  - Nhà máy KCT = chi phí chung.
  - Chỉ phân bổ từ 10/2026.
  - CHT ghi khoản chi trên điện thoại; khoản bị trả lại thì bổ sung / nộp lại tiền; chi quá thì công ty nợ CHT.
  - Tab Tài chính Dự án chỉ xem.

## 6. Người (users.id; auth_id khi khác)

| Người | Vai trò | users.id |
|---|---|---|
| Nguyễn Thị Hương | Kế toán trưởng (Tài chính view / record / confirm) | 85b13472-d16c-4025-afac-ee8c8d1bf1f6 |
| Phạm Thị Thủy | KT dự án (record; có cả confirm) | 84353526-7c84-485d-bf3a-5bb1dc5bf5eb |
| Bùi Thị Tâm | KT dự án (ADMIN) | f1ae09f2-c1be-4763-87cf-202b432ade67 |
| Hà Đức Chuẩn | Giám đốc tài chính (ADMIN) | 1b7bd7cb-54c3-43b5-b0ff-44ce63b8bd11 |
| Dương Xuân Thịnh | TGĐ — Quản trị Tài chính, duyệt vượt ngân sách, duyệt tạm ứng vượt 50% | d2c494c2-bbd4-4ea2-a194-ad3cb0faa6d5 |
| Nguyễn Thị Mơ | Giám đốc vật tư; người cấp vốn dự án; duyệt đơn Mua hàng | 2c4eeb7a-2cff-480c-8b12-be6b9bc67b0c (auth fddc4077-794e-4626-a374-d46859852ed6) |
| Bùi Thuỳ Linh | Mua hàng / cấp mã | 5bdea3d2-f1e6-45b0-baf1-14cf3770c0a5 (auth f8ba92d3-…) |
| Phạm Ngọc Sơn | CHT SMB (dùng làm người giữ quỹ trong test) | d0a300a0-1586-4748-b6e7-71773addc004 |

- Dự án: SMB-2026 `b4ce0810-2cac-44af-a83f-8bb1a361567a`, DA29 `d3d25b49-0623-40eb-99ac-b96f6ac0855a`.
- HĐ CĐT: SMB `7e1fdb82-9d67-40ed-bffa-ac3285ffc8e2`, DA29 `feafad56-f6f5-47bc-bc88-4e2771247e78`.
- Hàm `current_app_user_id()` ánh xạ theo `users.auth_id`. Trong test, đóng vai bằng `sub = auth_id` (khác `users.id` với Mơ, Linh).

## 7. Sự thật dữ liệu (04/10/2026)

- **Chi phí và ngân sách:**
  - Chi phí dự án phần lớn là số MISA nhập: SMB 35,5 tỷ (947/950 giao dịch đã gắn khoản mục), DA29 5,5 tỷ.
  - SMB vật tư đã vượt dự toán: 20,68 tỷ ghi nhận + 11,37 tỷ đơn chưa nhận so với dự toán 20,80 tỷ. Dự báo khi hoàn thành 43,3 tỷ.
  - DA29 mới có dự toán vật tư, chưa có ngân sách khoản mục khác.
- **Đơn mua:** 26 đơn quá hẹn giao > 30 ngày, còn 13,98 tỷ chưa nhận (phần lớn lập ở tab dự án). PO-557 (SMB) sẽ phải chờ TGĐ duyệt vượt ngân sách.
- **Thu chi & quỹ:** chưa khai tài khoản tiền thật nào (chỉ quỹ thử "Quy tien mat VND" 10 tr); chưa có quỹ công trường; chưa có đầu kỳ quỹ dự án.
- **Nhân sự (cho phân bổ lương):**
  - Bảng lương Vioo mới có T7 (33 người, 1,04 tỷ, nháp); chưa chốt kỳ bảng công nào; chưa có điều động công trường.
  - Chấm công T9 chỉ 89 lượt có gắn công trường.
- **Trước 01/10 MISA đã phân bổ một phần lương / chi phí chung vào SMB** (CPL 634 tr, CPQL 800 tr) → Vioo chỉ phân bổ từ 10/2026.

## 8. Việc còn treo

**Chủ SP / kế toán / HR (không phải code):**
1. Chủ SP cấp **Tài chính — Xem** cho chị Mơ (Cài đặt → Phân quyền) để chị duyệt bước cấp vốn và ghi cấp vốn.
2. Kế toán khai tài khoản ngân hàng / tiền mặt + số dư MISA 30/09 (người khác chốt). Cân nhắc ngừng quỹ thử 10 tr nếu không dùng.
3. Kế toán khai quỹ công trường SMB, DA29 và **chọn người giữ quỹ**, rồi cấp quỹ bằng "Chuyển tiền".
4. Kế toán khai đầu kỳ quỹ dự án SMB, DA29; lập ngân sách khoản mục DA29.
5. Phải thu: đối chiếu đầu kỳ phải thu SMB / DA29; khai 6 bảo lãnh + điều khoản HĐ; kiểm khoản DA29 2,44 tr "trừ tiền cây".
6. Mua hàng: khai số tài khoản NCC (10/12 NCC có PO chưa có); xử lý 26 đơn quá hẹn (Kết thúc thiếu nếu NCC không giao).
7. HR chốt bảng công + duyệt bảng lương tháng 10 để phân bổ tháng 10 đầu tháng 11; các bộ phận chấm công có gắn công trường.
8. Cấp "Tài chính — Quản trị" cho chị Hương nếu chủ SP muốn (đã nêu từ #86, chưa chốt).

**Kỹ thuật (đề xuất, chưa được duyệt):**
- Mẫu phân quyền theo chức vụ cho Tài chính (Kế toán viên: view + record; Kế toán trưởng: + confirm; GĐ tài chính: + manage). Hiện `role_permission_templates` chưa có mẫu Tài chính. Phải hỏi chủ SP trước.
- Chặn phía máy chủ việc ghi tay `project_transactions` từ client (hiện chỉ khóa ở giao diện tab Dự án).
- Tab Thanh toán (nghiệm thu / thanh toán thầu phụ) và "chốt sản lượng" vẫn sửa ở Dự án vì Tài chính chưa có chỗ tương ứng (F4 phần thầu phụ).
- Chưa walkthrough bằng giao diện: tab Tài chính chỉ xem trong Dự án, lối tắt quỹ công trường ở trang Nhân viên, ô chờ duyệt vượt ngân sách trong Mua hàng.

## 9. Gợi ý việc tiếp theo (chủ SP chọn)

Theo lộ trình doc 08 mục 8, còn thiếu:
- **K3c:** hóa đơn NCC, khớp 3 bên (dung sai 0,5% / 50.000 đ), chứng từ điều chỉnh, xuất chứng từ mua hàng sang MISA.
- **F4 phần thầu phụ:** HĐ thầu phụ, nghiệm thu, thanh toán qua Tài chính (để bỏ hẳn phần sửa ở tab Dự án).
- **F5 phần còn lại:** khóa kỳ kế toán tháng toàn module, gộp module "Chi phí" cũ (`/expense`) vào Tài chính.

Làm theo đúng quy trình mục 1: khảo sát → mockup + câu hỏi → chờ duyệt.
