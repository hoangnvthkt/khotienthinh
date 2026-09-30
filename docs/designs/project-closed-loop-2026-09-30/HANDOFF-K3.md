# Handoff — Mua hàng · Kho · Công nợ (xong đến K5) → bắt đầu K3 Công nợ NCC

Viết ngày 30/09/2026, cuối phiên làm việc dài với chủ sản phẩm. Người đọc: agent Claude ở phiên mới, sẽ làm tiếp K3.
Chủ sản phẩm sẽ mở phiên mới bằng câu **"Đồng ý, tiếp K3 công nợ NCC"**. Họ cũng nói: **"Tới công nợ rồi thì anh cũng góp ý với em luôn"**. Nghĩa là họ có ý kiến riêng về công nợ, nên phải mời họ góp ý trước khi chốt thiết kế.

> Đọc hết file này và `MEMORY.md` (tự nạp) trước khi làm. Mục 9 là việc cần làm đầu tiên.

---

## 1. Chủ sản phẩm và cách làm việc

- Xưng "anh", gọi agent là "em". Viết tiếng Việt. Là chủ doanh nghiệp xây dựng (Tiến Thịnh), dùng ERP tên **Vioo** (repo `khotienthinh`).
- Duyệt từng việc một: deploy migration, merge PR, ghi dữ liệu production, cấp quyền. Không có câu "duyệt" rõ ràng thì không làm.
- **Luôn đưa mockup trước code** cho phần giao diện lớn. Mockup dùng dữ liệu thật. Chủ sản phẩm duyệt xong mới làm thật.
- Tham chiếu giao diện: **FastCons** (fc.fastwork.vn, tài khoản dùng thử, được toàn quyền CRUD dữ liệu thử). Mở bằng trình duyệt tích hợp.
- Nguyên tắc chủ sản phẩm nhấn mạnh; đã lưu trong memory, phải tuân thủ:
  1. **Tính đủ luồng ngược và rẽ nhánh**: thiếu, dư, hủy, từ chối, trả lại, hoàn hàng, lùi ngày, sửa sai… Không chỉ luồng chuẩn. Luôn viết **bảng tình huống** trong tài liệu thiết kế.
  2. **Dữ liệu giao dịch sạch, minh bạch, lịch sử rõ ràng**: không sửa đè; nhật ký bất biến ghi ai, lúc nào, trước/sau, lý do; xác nhận bị đổi thì xác nhận cũ mất hiệu lực.
  3. **Phân cấp phân quyền**: chỉ xem / thao tác / xác nhận từng phía / ghi sổ / quản trị, theo phạm vi dự án hoặc kho. Tách nhiệm: một người không ký hai phía, **kể cả Admin**.
  4. **UI/UX**: xem mục 7. Tóm tắt:
     - Theme xanh FastCons; tên người, dự án, đối tác, mã phiếu, vật tư (dữ liệu có id) màu xanh ngọc, số liệu màu xanh lá.
     - Cam/đỏ chỉ dùng cho cảnh báo, quá hạn, từ chối. Phần quá hạn nhấp nháy nhẹ.
     - Không làm giao diện một màu.
     - Mọi thao tác xác nhận có hộp thoại Xác nhận / Từ chối, toast mô tả rõ.
     - Có lọc, tìm kiếm đa năng, sắp xếp.
     - Bố cục một màn hình: danh sách bên trái, chi tiết bên phải.
- Cách báo cáo mà chủ sản phẩm quen:
  - Ngắn, có tiêu đề in đậm, nêu **đã kiểm tra gì trên dữ liệu thật**.
  - Việc chưa kiểm được thì nói thẳng.
  - Cuối báo cáo liệt kê **"Anh cần duyệt/quyết"** dạng câu hỏi đánh số.
  - Không bịa. Chủ sản phẩm rất hài lòng với cách làm "khảo sát dữ liệu thật → thiết kế + bảng tình huống → mockup → code → test rollback trên prod → walkthrough desktop/tablet/mobile → PR".

## 2. Quy tắc bắt buộc

Nguồn: `AGENTS.md` và các chỉ dẫn của chủ sản phẩm.

- **Supabase Cloud production** (ref `ftciqmqhmfvjtwoycswe`), cấu hình trong `/Users/admin/khotienthinh/.env`. **Không** dùng Supabase local, **không** Docker.
- **Không dùng sub-agent** (AGENTS.md), trừ khi chủ sản phẩm cho phép rõ.
- Không migration, merge hay ghi SQL production khi chưa được duyệt **cho từng việc**.
- Không nhập mật khẩu. Không đụng root checkout `/Users/admin/khotienthinh`: nó đang có thay đổi chưa commit của phiên khác, và đang ở nhánh khác. Không đụng worktree phân quyền.
- Không đụng các migration chỉ có trên remote do phiên khác tạo (module Yêu cầu). Một phiên khác đang merge PR Yêu cầu liên tục (#33 → #45), nên **main thay đổi nhanh**.
- UI phải walkthrough như người dùng lần đầu, trên desktop/tablet/mobile. Không che lỗi hoặc unknown bằng `0`.
- Commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Body PR kết thúc bằng `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Squash-merge với tiêu đề `"<tóm tắt tiếng Việt> (#N)"`.

## 3. Môi trường và công cụ

| Thứ | Giá trị |
|---|---|
| Worktree làm việc | `/Users/admin/khotienthinh/.worktrees/project-loop`. Mỗi việc một nhánh `feature/…` tạo từ `origin/main`. |
| `gh` | `/opt/homebrew/bin/gh` (không có trong PATH) |
| Công cụ vận hành | `.superpowers/review/work-plan/tools/` (git ignore; chép từ scratchpad phiên cũ) |
| Fixture giao diện | `.superpowers/review/work-plan/*.html` + `*.tsx` |
| Dev server fixture | launch config `project-loop`, cổng 5181. URL `http://127.0.0.1:5181/.superpowers/review/work-plan/<tên>.html` |
| Truy vấn chỉ đọc | `node .superpowers/review/work-plan/tools/q.mjs "<sql>"` (role read-only, không gọi được hàm app_private) |
| Truy vấn trong transaction hoàn tác | `node .superpowers/review/work-plan/tools/qrb.mjs "<sql>"` (begin; read only; …; rollback; gọi được app_private) |
| Deploy migration | `node .superpowers/review/work-plan/tools/prod-push-remote-placeholders.mjs` (dry-run), sau đó thêm `--apply`. **Chạy từ thư mục gốc worktree.** Script tự viết placeholder cho migration chỉ có trên remote. Dry-run phải chỉ liệt kê migration của mình. |
| Kiểm tra | `npm run lint` (tsc), `npm run check:supabase-migrations`, `npm run check:supabase-queries`, `npx vitest run`, `npm run build`. Chạy đủ trước khi push. |

**Test rollback trên production**, mẫu ở `tools/recon-test.mjs`, `tools/k5-test.mjs`:
- Gửi `begin; <nội dung migration>; …; rollback;` qua Management API.
- Đóng vai người dùng bằng:
  ```sql
  reset role; select set_config('request.jwt.claims','{"sub":"<auth_id>","role":"authenticated","email":"<email>"}',true); set local role authenticated;
  ```
- `current_app_user_id()` khớp `users.auth_id = auth.uid()`; nếu `auth_id` null thì khớp theo email.
- Bẫy: trong vai `authenticated`, **đọc thẳng bảng RLS sẽ bị từ chối**. Lấy id/revision qua RPC, hoặc `reset role` trước khi đọc.
- Dùng temp table `t(k,v)` và `kv(k,v jsonb)`, nhớ `grant all … to authenticated`.
- Bắt lỗi từng bước bằng `do $$ begin …; exception when others then insert … sqlerrm; end $$`.

**Fixture giao diện:**
- Copy `hub-k2.html` và `sed` đổi `src` sang file `.tsx` mới.
- File `.tsx` mock service (gán lại method) bằng payload thật lấy từ script rollback (mẫu `tools/recon-data.mjs`, `tools/k5-data.mjs`).
- Component dùng `useApp()`: import `ws-fake-app.ts` **đầu tiên**. File này vá `React.useContext` để trả dữ liệu giả khi context thiếu.
- Click bằng `javascript_tool` + `querySelector` ổn định hơn click theo toạ độ khi đang giả lập viewport.

**Ship PR:**
- Mọi migration mới phải thêm vào `supabase/baseline/current.json` → `allowedPostBaselineFiles`.
- Khi `git merge origin/main`, file baseline hay xung đột vì phiên Yêu cầu cũng thêm migration. Giải bằng **hợp hai danh sách**, rồi chạy `check:supabase-migrations`.
- `gh pr merge` báo "Base branch was modified" thì chờ vài giây rồi thử lại.
- Check CI "Supabase Preview" hay đỏ/skip do migration chỉ có trên remote. Bình thường, bỏ qua. Check chính là "Typecheck, test and build".
- Sau deploy: kiểm hàm có mặt (`select count(*) from pg_proc where proname in (…)`), rồi smoke-test bằng `qrb.mjs` với claims người dùng thật.

**Người dùng chủ chốt** (dùng cho claims khi test):

| Người | Vai trò | users.id | auth sub | Ghi chú |
|---|---|---|---|---|
| Admin Hoàng | ADMIN | 928d3473-49a2-4427-a319-19729689a084 | e99f1b85-ab8e-49ee-b068-e100fe698533 | admin@khoviet.vn |
| Bùi Quang Chung | EMPLOYEE, Mua hàng — Quản lý | a4a81a1c-0204-456b-961b-7ee14b519734 | = id | chungbq@… |
| Nguyễn Thị Mơ | role WAREHOUSE_KEEPER (thực tế là cán bộ mua hàng), Mua hàng — Quản lý (cấp 30/09) | 2c4eeb7a-2cff-480c-8b12-be6b9bc67b0c | fddc4077-794e-4626-a374-d46859852ed6 | Không gán kho, nên check keeper kiểu cũ coi là keeper toàn cục |
| Đặng Thị Thu Hà | EMPLOYEE, Mua hàng — Quản lý (cấp 30/09) | 94087920-3dc7-4304-a1c7-e9ff7d1aad2f | (email) | hadtt@… |
| Nguyễn Văn Luật | Thủ kho Kho Sơn Miền Bắc | e9be7010-cbb9-4cf1-9d5a-8ec558ec5d99 | = id | luatnv@… |
| Bùi Thị Tâm | Thủ kho SMB **và** kế toán dự án SMB/DA29 | f1ae09f2-c1be-4763-87cf-202b432ade67 | = id | tamtt@… — hai vai, chú ý tách nhiệm ở K3 |
| Phạm Thị Thủy | role WAREHOUSE_KEEPER không gán kho, Mua hàng — Quản trị, **và** kế toán dự án | 84353526-7c84-485d-bf3a-5bb1dc5bf5eb | = id | thuypt@… — ba vai |
| Nguyễn Thị Hương | Kế toán dự án SMB/DA29 | 85b13472-d16c-4025-afac-ee8c8d1bf1f6 | (email) | huongnt@… |
| Nguyễn Duy Đảng | Người duyệt PO (M2a) | dba1ae2a-5100-4f6c-8c1d-c8ba6c97ecb2 | = id | dangnd@… |
| Bùi Thuỳ Linh | WAREHOUSE_KEEPER | 5bdea3d2-f1e6-45b0-baf1-14cf3770c0a5 | (email) | Đã kiểm PO-259 đợt 1 |

**Kho:**
- `wh-1773110380822-zm5oj` Kho Sơn Miền Bắc (SMB)
- `wh-1` Kho RICO (không có thủ kho)
- `wh-1772607466735-0jnui` Kho Tổng Hưng Yên (không có thủ kho)
- `wh-1782528573176-6lb7z` Kho Xin Hai Vina
- `wh-1782120782470-7ey83` Kho VPP

**Dự án:**
- SMB-2026: `b4ce0810-2cac-44af-a83f-8bb1a361567a`, site `240ac280-756d-4955-b612-41661e7aedaf`
- DA29: `d3d25b49-0623-40eb-99ac-b96f6ac0855a`, site `0415101d-9790-47ea-a2c2-db0a613ca8e0`

## 4. Kiến thức hệ thống (Mua · Kho · Công nợ)

### Dòng chảy chính

1. **Nhu cầu** (KH vật tư, đề xuất công trường) → **Mua hàng hub** (`/procurement`: tiếp nhận, PO, hợp đồng nguyên tắc, đối chiếu nhận hàng).
2. **PO** (`purchase_orders`):
   - `items` JSON có `lineId`, `qty`, `receivedQty`, `returnedQty`.
   - `purchase_mode` là `single` hoặc `multiple`. PO hub có `metadata.channel='procurement_hub'`.
   - Trạng thái: `draft / sent / returned / confirmed / in_transit / partial / delivered / closed / cancelled`.
3. **Đợt giao** (`purchase_order_delivery_batches` + `…_lines`):
   - Trạng thái: `planned`, `wms_pending` (kiểu cũ), `receiving`, `quality_approved`, `received`, `received_short`, `received_over`, `cancelled`.
   - Mỗi đợt có một phiếu WMS (`transactions`, `source_type='po_delivery_batch'`).
4. **Nhận hàng một bước** (#41): `receive_purchase_delivery_v1`. Hàm này gọi `approve_material_po_quality` rồi `finalize_material_po_receipt`, và cộng tồn qua `apply_stock_change` (cache) + trigger sổ kho.
5. **Công nợ tự sinh:** trigger `trg_post_purchase_receipt_finance_v2` trên đợt giao, khi trạng thái chuyển sang `received*`, gọi `app_private.post_purchase_receipt_finance_v2`. Hàm này tạo:
   - `supplier_payable_documents` (`source_type='purchase_delivery_receipt'`, `source_id` = batch id, code `AP-REC-…`, `document_date = current_date`);
   - chi phí dự án `project_transactions` (`source_ref='purchase_receipt:<batch>'`, category `materials`).
6. **Hợp đồng nguyên tắc** (M2b): Mua hàng lập bảng đối soát tháng → chốt → kế toán (Room Thanh toán — Xác nhận, **khác người chốt**) ghi công nợ, tạo `supplier_payable_documents` `source_type='supplier_delivery_statement'`.
7. **Trả hàng NCC** (K2): phiếu xuất trả → hoàn tất thì `post_purchase_receipt_return_finance_v2` giảm công nợ (credit). Mua hàng chọn Đổi hàng (mở lại "còn phải giao") hoặc Giảm trừ (về Cần mua).
8. **Đối chiếu nhận hàng tồn đọng** (#39):
   - Bảng `procurement_receipt_reconciliations` + `…_events` (bất biến).
   - Công nợ do đối chiếu được **lùi ngày** theo ngày hàng về và gắn `metadata.origin='receipt_reconciliation'`.
   - Có chế độ "stocked": kho đã nhập WMS nhưng PO chưa ghi → chỉ nhập bổ sung phần thiếu bằng phiếu `tx-recon-…`.
9. **Kho:**
   - Sổ kho chuẩn là `inventory_balances` + `inventory_ledger_entries`. Cache `items.stock_by_warehouse` có thể lệch sổ.
   - K1: `post_inventory_ledger_entry` chặn xuất âm (bỏ chặn bằng GUC `app.inventory_allow_negative`).
   - K5 kiểm kê: `wms_inventory_counts`, duyệt xong thì đồng bộ cache = sổ.

### Phân quyền

- **Mua hàng:** `app_private.procurement_can('view'|'manage')` dựa trên `user_permission_grants` (`system.procurement.view` / `.manage`). Cấp quyền thì insert grant + `permission_audit_events` (mẫu `.superpowers/review/work-plan/grant-procurement-buyers.mjs`).
- **Room dự án:** `project_permission_room_members` + `…_actions`. Room `payment` có `view` / `confirm` cho kế toán; mẫu `.superpowers/review/work-plan/grant-payment.mjs`.
- **Xem công nợ:** `ap_scope_can_view` → `project_doc_can_view` → **quyền dự án kiểu cũ** `project_staff_permissions`. Đã phải cấp "Xem" DA29 kiểu cũ cho kế toán (`grant-da29-view.mjs`). **K3 nên chuyển sang quyền mới.**
- **Kho:**
  - Thủ kho = role `WAREHOUSE_KEEPER` + `assigned_warehouse_id`. Danh sách lấy qua `app_private.wms_warehouse_keepers(wh)`.
  - Các check kiểu cũ (`current_user_can_receive_purchase_batch_v2`) coi keeper không gán kho là keeper **toàn cục**. Mơ và Thủy thuộc diện này.
  - Ngoài ra có `public.is_module_admin('WMS')`, `public.is_admin()`, `app_private.wms_has_action(code, src, tgt, …)`.
- **GUC nội bộ:** `app.procurement_hub_context` (bỏ qua guard room PO), `app.material_transition_context` (bỏ qua guard trạng thái PO). Đặt `set_config(…,'on',true)`, cuối hàm tắt.

### Quy ước viết migration (đã dùng suốt phiên)

- Đầu file là khối comment tiếng Việt mô tả luật nghiệp vụ.
- Hàm `security definer set search_path = ''`.
- Lỗi: `raise exception using errcode=…, message='MA_LOI'`. Service phía client map mã lỗi → câu tiếng Việt.
- Có `revoke … from public, anon` + `grant … to authenticated`. Kết thúc bằng `notify pgrst, 'reload schema'`.
- Mỗi thực thể có **revision/row_version** để chống ghi đè. Server trả cờ `can.*` cho UI.
- **Nhật ký bất biến**: trigger `app_private.trg_receipt_recon_events_immutable`, dùng lại được.
- Kèm một file test chuỗi SQL trong `lib/__tests__/*Migration.test.ts`.

## 5. Đã giao (tất cả đã lên production)

| PR | Nội dung | Migration |
|---|---|---|
| #24, #25 | Dự án Đợt 1 (KH tháng/tuần), Đợt 2 (KH vật tư) | xem git log |
| #26 | M1 hộp tiếp nhận Mua hàng | 20260930220000_procurement_inbox |
| #28 | M2a PO lập & duyệt trong Mua hàng, đóng nhu cầu, ĐV mua, khóa PO chủ động ở tab dự án | 20261001090000_procurement_hub_orders |
| #30 | M3 nhiều đợt giao, giao bù, kết thúc thiếu | 20261001150000_procurement_hub_deliveries |
| #32 | M2b hợp đồng nguyên tắc: bảng giá hiệu lực, lũy kế/hạn mức, đối soát tháng | 20261001210000_procurement_contracts |
| #34 | K1 chặn xuất quá tồn, cảnh báo phiếu treo (cron 07:30 VN) | 20261002090000_wms_k1_stock_controls |
| #36 | K2 trả hàng NCC (đổi hàng / giảm trừ) | 20261002150000_procurement_k2_supplier_returns |
| #39 | Đối chiếu nhận hàng tồn đọng: 2 xác nhận, từ chối kèm lý do, lùi ngày, lệch ngược, lọc/tìm/sắp xếp, nhấp nháy quá hạn | 20261003090000_procurement_receipt_reconciliation |
| #41 | Nhận hàng một bước (gộp kiểm SL/CL + nhập kho) | 20261003150000_wms_one_step_receipt |
| #43 | Nhập xuất kho một màn hình (`components/wms/WmsWorkspace.tsx`, `TransactionDetailModal variant="panel"`) | — |
| #46 | K5 kiểm kê có duyệt (đếm mù, giải trình, duyệt ghi sổ, xuất dùng thi công) | 20261004090000_wms_k5_stock_count |

**Thao tác production đã làm** (đều được duyệt):
- Cấp Room Thanh toán cho kế toán Tâm, Thủy, Hương ở SMB/DA29.
- Cấp quyền "Xem" DA29 kiểu cũ cho kế toán.
- Đưa 18 dòng tồn âm về 0 bằng 2 phiếu điều chỉnh `tx-k1-fix-negative-*`.
- Hủy phiếu treo của Linh ở Kho RICO.
- Cấp `system.procurement.manage` cho Mơ và Thu Hà.

**Tài liệu thiết kế:** `docs/designs/project-closed-loop-2026-09-30/`
- 00 audit
- 01, 02 dự án
- 03 Mua hàng trung tâm
- 04 hình thức & M2
- 05 kiểm soát Mua–Kho–Công nợ (lộ trình K1–K5)
- 06 kho một màn hình + đối chiếu
- 07 K5 kiểm kê

## 6. Quyết định của chủ sản phẩm (tóm tắt)

- **Theme:** xanh ngọc `mint-500 #3cbfaa` và xanh lá `leaf-500 #52b53a` (token trong `index.html`), kết hợp teal `#0f766e`. Dữ liệu có id màu xanh; số liệu màu xanh lá; cam/đỏ chỉ cho cảnh báo, quá hạn, từ chối.
- **Mua hàng:**
  - PO lập & duyệt trong Mua hàng. Tab dự án chỉ đọc PO của hub.
  - Hợp đồng nguyên tắc: **Mua hàng lập & chốt đối soát tháng, kế toán ghi công nợ, khác người chốt**.
  - **Thanh toán NCC ghi trong Vioo.**
- **Kho:**
  - Kho RICO và Kho Tổng **không có thủ kho** (chỉ Admin thao tác).
  - Gộp kiểm SL/CL + nhập kho thành 1 bước.
  - Lùi ngày **chỉ** trong màn đối chiếu.
  - Thứ tự đã chốt: đối chiếu → kho một màn → K5. Đã xong cả ba.
- **Đối chiếu:** xác nhận phía Mua hàng gồm Mơ, Chung, Thu Hà. **Kế toán tạm chưa tham gia ký.**
- **K5:** đếm mù mặc định. Người duyệt là Admin / quản trị kho (chưa thêm chỉ huy trưởng hay kế toán).
- **Kết luận 30/09:** "Về phần đề xuất, mua hàng, nhập xuất, kiểm kê tạm thời đã ổn." Chuyển sang công nợ.

## 7. Quy ước UI/UX (tái sử dụng, đừng tự chế lại)

- **Class màu:**
  - `ENT = 'font-semibold text-mint-700 dark:text-mint-300'` cho dữ liệu có id.
  - `NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300'` cho số liệu.
  - Quá hạn: rose + class `overdue-blink` (trong `index.css`, tôn trọng `prefers-reduced-motion`).
  - Thiếu/lệch: amber.
- **Component chung:** `components/procurement/hub/hubUi.tsx` (`Badge`, `StateBox`, `Drawer`, `inputCls`, `primaryBtn` màu leaf-600, `secondaryBtn`, `money`); `components/project/work-plan/workPlanUi.tsx` (`fmt`, `dateVi`).
- **Hộp thoại:**
  - `useConfirm()` (ConfirmContext) dùng mẫu xóa làm mặc định: câu "Bạn có chắc chắn muốn xoá" và đếm ngược 3 giây. **Luôn truyền `confirmText`**; thao tác không phá hủy thì truyền `countdownSeconds: 0` và `intent: 'success'`.
  - Từ chối / hủy dùng `useReasonConfirm()` (bắt buộc lý do).
- **Toast:** `toast.success(tiêu đề, mô tả)`. Mô tả nêu **tên chứng từ + đã làm gì + bước tiếp theo**. Lỗi: `toast.error('Chưa thực hiện được — <tên>', message đã map)`.
- **Bố cục chuẩn** (mẫu tốt nhất: `components/procurement/receipt/ReceiptReconciliationView.tsx`, `components/wms/WmsWorkspace.tsx`, `components/wms/StockCountView.tsx`):
  - Thẻ tiêu đề có icon nền gradient teal→mint/leaf. Mô tả ngắn, "Cách làm" thu gọn được.
  - **Ô chỉ số màu** theo ý nghĩa, bấm để lọc. Ô quan trọng nhấp nháy khi > 0.
  - **Thanh công cụ:** ô tìm kiếm đa năng (nhiều từ, khớp mọi từ), lọc kho / đối tác / loại, sắp xếp, tải lại.
  - **Danh sách trái (360–400px) + chi tiết phải.** Mỗi dòng có dải màu `border-l-4` theo bước, nhãn bước bằng lời người dùng, số tiền bên phải.
  - Nút hành động **ghim đáy** chi tiết. Khối phụ (chỉnh phiếu, lịch sử) thu gọn.
  - **Điện thoại:**
    - Danh sách trước; chạm mở chi tiết, có "← Danh sách".
    - Ẩn ô chỉ số và thanh công cụ khi đang xem chi tiết, tự cuộn tới chi tiết.
    - Bảng có ô nhập thì chuyển sang **dạng thẻ**; số liệu `whitespace-nowrap`; không cuộn ngang trang.
- **Phân quyền trên UI:** ẩn hoặc khóa nút theo `can.*`, hiện vai trò người xem, giải thích vì sao chưa làm được (dòng gợi ý ở chân).

## 8. Tồn đọng vận hành và dữ liệu (biết trước khi làm K3)

- **Công nợ hiện có:** 25 chứng từ `supplier_payable_documents` đang mở.
  - 18 từ đối soát HĐ: ~1,13 tỷ.
  - 7 từ nhận hàng: ~418 triệu.
- **Chưa có hóa đơn NCC** (`supplier_invoices` = 0), **chưa có đợt thanh toán** (`supplier_payment_batches` = 0), **chưa có khóa kỳ** (`finance_accounting_period_locks` = 0).
  - Kế toán đang trả NCC **ngoài hệ thống**. Cần **số dư đầu kỳ / đã trả ngoài hệ thống** để **tránh trả trùng**.
  - Khi đối chiếu phiếu treo được ghi sổ, sẽ phát sinh công nợ lùi ngày tháng 7–8 (nhãn `origin=receipt_reconciliation`).
- **Kho Sơn Miền Bắc:** 13 đợt chờ đối chiếu. Người dùng chưa bắt đầu đối chiếu; xong mới kiểm kê SMB.
  - 10 đợt chưa nhập kho: PO-143, 145, 259 ×3, 261, 263, 272, 387, 390. Các PO này đặt ~5,2 tỷ, đều `unpaid`.
  - 3 đợt "kho đã nhập, PO chưa ghi": PO-116, 163, 181. Riêng PO-116, phiếu kho chỉ có 1/5 dòng.
- **SMB có 11 vật tư lệch cache/sổ** (4 dòng do làm tròn thép, 7 dòng lệch thật 0,36–6,5). K5 xử lý được khi kiểm kê.
- **Vật tư chưa có giá vốn** (vd. cát xây): UI hiện "chưa có giá".
- **Hợp đồng DA29:** 5 HĐ đang giao **chưa có bảng giá**. Tháng 9, bảng đối soát làm theo từng phiếu giao, cùng một người (Thủy) lập và ghi.
- **Ý tưởng lớn đang chờ** (memory `contract-centric-finance-idea`): quản lý thu chi theo hợp đồng (HĐ NCC / thầu phụ / chủ đầu tư). Đã khảo sát FastCons và hiện trạng Vioo; **chờ 4 quyết định**. K3 nên thiết kế để sau này gắn được trục hợp đồng (`supplier_contract_id` đã có trên `supplier_payable_documents`).

## 9. K3 — Công nợ NCC: việc cần làm đầu tiên

**Định nghĩa trong lộ trình** (doc 05): "Màn **Công nợ NCC toàn công ty** và **đợt thanh toán gộp theo NCC, gắn HĐ**". Chủ sản phẩm đã chốt: thanh toán NCC ghi trong Vioo.

### Tài sản đã có (G7, 20260921143000_g7_supplier_finance_matching_valuation.sql; ít hoặc chưa dùng)

- **Bảng:**
  - `supplier_invoices`
  - `supplier_invoice_receipt_allocations` (khớp 3 bên: hóa đơn ↔ dòng nhận hàng, chênh giá)
  - `supplier_invoice_payable_links` / `…_balances`
  - `supplier_payment_batches` (đợt chi: `payment_method`, `cash_fund_id`, `cash_voucher_id`, `project_transaction_id`, `allocation_mode`, `status`, người duyệt/chi)
  - `supplier_payment_allocations`
  - `supplier_payable_balances`, `supplier_payable_document_balances`
  - `finance_accounting_period_locks`
- **Hàm:**
  - `record_supplier_invoice_reconciliation_v3`, `reverse_supplier_invoice_v1`
  - `post_supplier_payment_batch_v2`, `reverse_supplier_payment_batch_v2` (idempotency + row_version)
  - `assert_supplier_payable_settlement_v1` (trigger chặn trả/giảm trừ vượt)
  - `get_supplier_finance_control_v1(project, site)`, `get_supplier_invoice_matching_candidates_v1`
  - `set_finance_accounting_period_lock_v1`, `finance_period_is_locked`
- **Service:** `lib/supplierPayableService.ts`, `lib/supplierPaymentBatchService.ts`, `lib/supplierFinanceControlService.ts`, `lib/supplierDeliveryStatementService.ts`.
- **UI hiện tại, theo từng dự án:**
  - `pages/project/ProjectFinanceWorkspace.tsx`
  - `components/project/SupplierInvoiceMatchingModal.tsx`
  - `pages/hd/SupplierContracts.tsx`
  - panel kế toán "Bảng đối soát chờ ghi công nợ" trong `pages/project/SupplyChainTab.tsx`
- **Chưa có** màn toàn công ty theo NCC.

### Trình tự đề xuất

Giữ đúng cách làm đã được khen.

1. `git fetch`; tạo nhánh `feature/k3-supplier-payables` từ `origin/main` trong worktree `project-loop`.
2. **Mời chủ sản phẩm góp ý trước.** Họ đã nói sẽ góp ý về công nợ. Trình bày ngắn hiện trạng (mục 8 + tài sản G7) rồi hỏi mong muốn, trước khi chốt thiết kế.
3. **Khảo sát sâu:**
   - Đọc G7 migration và các service/UI trên.
   - Dữ liệu thật: 25 chứng từ AP, NCC, hạn thanh toán (`payment_terms` trên PO/HĐ).
   - FastCons phần Công nợ (nhóm Đối tác → HĐ → đợt, số ngày trả chậm) và Phiếu chi.
4. **Viết `08-k3-cong-no-ncc.md`**, gồm:
   - **Bảng tình huống** tối thiểu:
     - trả một phần; tạm ứng / trả trước khi có hàng; giảm trừ do trả hàng (K2);
     - chiết khấu / thưởng doanh số; hóa đơn lệch giá hoặc lượng so với nhận hàng; hóa đơn đến trước hàng;
     - **đã trả ngoài hệ thống / số dư đầu kỳ**; trả trùng; đảo phiếu chi / chi nhầm NCC;
     - một NCC nhiều dự án; VAT; hạn thanh toán theo HĐ và **quá hạn nhấp nháy**;
     - khóa kỳ; công nợ lùi ngày từ đối chiếu.
   - **Bảng phân quyền:**
     - xem toàn công ty / theo dự án;
     - kế toán ghi hóa đơn;
     - người lập đợt chi ≠ người duyệt chi ≠ người xác nhận đã chi;
     - Tâm và Thủy kiêm nhiều vai, phải tách nhiệm.
5. **Mockup trên dữ liệu thật**, theo bố cục chuẩn mục 7:
   - danh sách NCC có ô chỉ số (phải trả, quá hạn, đến hạn 7 ngày, chờ duyệt chi);
   - chi tiết NCC có chứng từ và đợt chi.
   - Chủ sản phẩm duyệt rồi mới code.
6. **Code** (migration + service + UI) → test rollback trên production nhiều vai → walkthrough 3 kích thước màn hình → PR → xin duyệt deploy và merge.

### Câu hỏi nhiều khả năng cần chủ sản phẩm quyết (đưa ra, đừng tự quyết)

- Ghi nhận số đã trả ngoài hệ thống thế nào? Nhập số dư đầu kỳ theo NCC, hay phiếu chi bổ sung?
- Ai lập, ai duyệt, ai xác nhận đã chi? Có mức duyệt theo số tiền không?
- Có bắt buộc hóa đơn trước khi chi không? Khớp 3 bên chặn hay chỉ cảnh báo?
- Hạn thanh toán lấy từ đâu (HĐ / PO / mặc định N ngày)?
- Quyền xem công nợ toàn công ty cho ai? Có bỏ phụ thuộc quyền dự án kiểu cũ không?

## 10. Sau K3 (lộ trình còn lại)

- **K4:** hủy PO đã duyệt theo ma trận quyền; đảo chứng từ công nợ.
- **Khóa kỳ tài chính / kho:** dùng `finance_accounting_period_locks`.
- **M2c:** chuyển mua nóng công trường về Mua hàng.
- **Thu chi theo hợp đồng:** ý tưởng lớn, chờ 4 quyết định.
- Có thể thêm chỉ huy trưởng / kế toán vào người duyệt K5 nếu chủ sản phẩm muốn.

## 11. Memory liên quan (tự nạp, đọc khi cần)

- `project-closed-loop-model.md`: nhật ký tiến độ chi tiết theo ngày.
- `ui-theme-fastcons-green.md`: theme và các yêu cầu UI bổ sung.
- `erp-exception-flows-clean-history.md`: luồng ngược, lịch sử sạch.
- `permission-tiers-rule.md`: phân cấp quyền.
- `permission-ux-person-first-templates.md`: phân quyền theo người + mẫu.
- `pr-shipping-checklist.md`: ship PR.
- `contract-centric-finance-idea.md`: thu chi theo HĐ.
- `karpathy-coding-guidelines.md`: nghĩ trước, đơn giản, sửa đúng chỗ, kiểm chứng.
