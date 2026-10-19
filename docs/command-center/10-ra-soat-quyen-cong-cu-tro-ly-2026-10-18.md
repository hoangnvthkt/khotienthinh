# Rà soát quyền 6 công cụ đọc của Trợ lý — 18/10/2026

Nguyên tắc chủ SP chốt 18/10 (sau ca #251 "nhân viên Hương còn bao nhiêu ngày phép năm" bị từ chối sai dù Admin có quyền HR):
**quyền do RPC / RLS quyết; lời nhắc không tự thu hẹp phạm vi, không tự kết luận "không có quyền"; không bịa.**
Tệp này ghi lại: RPC nào kiểm quyền ra sao, thử thật 3 vai trên Cloud cho kết quả gì, và sửa gì ở cổng `ai-gateway`.

Mã cổng: `supabase/functions/ai-gateway/tools.ts` (công cụ), `chat.ts` (lời nhắc). Tệp thử: `supabase/tests/ai_tool_permissions_smoke.sql`.

## 1. Bảng RPC × cách kiểm quyền

Định nghĩa đọc từ Cloud (`pg_get_functiondef`, 18/10) — trùng với migration mới nhất trong repo.

| Công cụ | RPC | Security | Kiểm quyền bằng | Phạm vi dự án / kho theo người | Khi bị từ chối |
|---|---|---|---|---|---|
| tim_ho_so, ton_kho, chi_tiet_*, phep_nhan_vien (tìm hồ sơ) | `search_global_v1` | **INVOKER** | RLS từng bảng (ứng viên lọc chữ bằng `gs_candidates_v1` DEFINER chỉ trả mã, nội dung đọc lại qua RLS); danh bạ qua `list_hrm_employee_directory` | Có — RLS của module (dự án theo Room, phiếu kho theo kho, tài chính theo `finance_can`…) | Nguồn DEFINER chặn → ghi vào `denied[]`; nguồn RLS → **trả rỗng, không có 42501** (không phân biệt "không có" / "không quyền") |
| ton_kho | `ai_stock_by_items_v1` | **INVOKER** | RLS `inventory_balances` (`can_read_inventory_scope(warehouse_id)`), `items` (`wms.inventory.view`…), `warehouses` | Có — chỉ kho người hỏi được xem | Trả `[]` (không 42501) |
| chi_tiet_don_mua | `get_procurement_order_v1` | DEFINER | `procurement_can('view')` **hoặc** PO thuộc dự án người hỏi có phòng `material_po` (`procurement_po_view_project_ids`) | Có — người công trường chỉ xem PO dự án mình | `42501 PROCUREMENT_VIEW_DENIED` (cả khi PO không tồn tại và người không có quyền chung → không lộ việc PO có hay không); `PT404` chỉ với người đã có quyền |
| chi_tiet_don_mua | `get_procurement_po_payment_status_v1` | DEFINER | `procurement_can('view')` hoặc `finance_can('view')` | Không lọc theo dự án (quyền toàn cục) | `42501 PROCUREMENT_VIEW_DENIED` |
| chi_tiet_de_xuat | `get_material_request_supply_v1` | DEFINER | `material_request_parent_can_view` → Room `material_request.view` của dự án / công trường | Có — theo Room dự án | `42501 MR_SUPPLY_NOT_FOUND` (gộp "không có" và "không quyền") |
| viec_cua_toi | `vcc_my_work_items_v1` | DEFINER | `center_actor_v1` (quyền `center.module.access` + đang trong thí điểm Trung tâm); từng nguồn lọc theo chính người hỏi (người được giao / người lập / theo dõi) | Chỉ việc của chính người hỏi | `42501 CENTER_ACCESS_DENIED` khi chưa bật Trung tâm |
| phep_nhan_vien (hồ sơ của mình) | `list_hrm_employee_directory` | DEFINER | `hrm.employee.view_directory` (mẫu Office — mọi nhân viên đều có); cột nhạy cảm thêm theo `view_profile` | Danh bạ toàn công ty (SĐT / email có trong danh bạ; cổng che SĐT, bỏ phone / email khỏi nguồn màn hình) | `42501 HRM_EMPLOYEE_DIRECTORY_REQUIRED` |
| phep_nhan_vien | `get_hrm_leave_ledger` | DEFINER | chính mình (`hrm_employee_is_current_user`) **hoặc** `hrm.employee.view_sensitive` | Một người | `42501 "Chỉ xem được sổ phép của chính mình."` |
| phep_nhan_vien (toàn công ty) | `list_hrm_leave_balances` | DEFINER | `hrm.employee.view_sensitive` | Toàn công ty | `42501 "Chỉ HR xem được số phép toàn công ty."` |
| (tiện ích) | `current_app_user_id` | DEFINER | theo JWT (`auth.uid()` / email) | — | trả `null` |

**Kết luận:** không RPC nào trả dữ liệu vượt quyền (lộ); không RPC nào chặn người có quyền (chặn quá tay). Việc chặn sai ở ca #251 nằm hoàn toàn ở **lời nhắc** của cổng, không ở RPC.

Lưu ý cho người làm tiếp:
- `search_global_v1` và `ai_stock_by_items_v1` là INVOKER: người không có quyền kho / danh mục chỉ nhận **rỗng**, không có mã lỗi → công cụ không thể biết là "không có mã này" hay "không quyền". Lời báo của công cụ vì vậy nói "không thấy trong phạm vi được xem, không khẳng định là không tồn tại".
- `get_procurement_order_v1` cố ý trả 42501 trước PT404 cho người không có quyền chung → không lộ việc một số PO có tồn tại hay không. Đúng chủ ý, giữ.
- Danh bạ (`list_hrm_employee_directory`) là của mẫu Office: mọi nhân viên tìm được tên / chức danh nhau. Cổng che SĐT / CCCD / STK trước khi đưa model và bỏ phone / email khỏi nguồn gửi màn hình.

## 2. Thử thật 3 vai trên Cloud (giao dịch rollback, chỉ đọc)

Lệnh: `CLOUD_SQL_ENV=/Users/admin/khotienthinh/.env node scripts/cloud-sql.mjs --file supabase/tests/ai_tool_permissions_smoke.sql --rollback`
(giả lập JWT của 3 người thật rồi gọi thẳng 9 RPC; tệp tự chọn người và hồ sơ thử, không ghi gì).

Người thử 18/10: **Admin Hoàng** (Admin) · **Đặng Thị Hương** (HR, có `view_sensitive`, không quyền Mua hàng) · **Nguyễn Chấp Việt** (nhân viên thường trong thí điểm Trung tâm, không HR, không Mua hàng, không thuộc dự án của PO thử).
Hồ sơ thử: PO-680 (có dự án), MR-2026-9858, vật tư "Áo lưới bảo hộ…", nhân viên Nguyễn Thị Hương, năm 2026.

| RPC | Admin Hoàng | HR Đặng Thị Hương | NV thường Nguyễn Chấp Việt | Nhận xét |
|---|---|---|---|---|
| `search_global_v1` PO-680 | 1 hồ sơ | 0 (rỗng) | 0 (rỗng) | RLS PO: không quyền → rỗng, không lỗi |
| `search_global_v1` "huong" (nhân viên) | 2 | 2 | 2 | Danh bạ Office, ai cũng tìm được tên |
| `search_global_v1` vật tư | 6 | 6 (HR có `wms.inventory.view`) | 0 (rỗng) | RLS `items` |
| `ai_stock_by_items_v1` | 1 kho | 1 kho | `[]` | RLS kho, không 42501 |
| `get_procurement_order_v1` PO-680 | OK, 9 dòng, 2.090.119.561 đ | **42501** PROCUREMENT_VIEW_DENIED | **42501** | Đúng: HR không có quyền Mua hàng |
| `get_procurement_po_payment_status_v1` | OK (0 chứng từ) | **42501** | **42501** | |
| `get_material_request_supply_v1` MR-2026-9858 | OK, 9 dòng | **42501** MR_SUPPLY_NOT_FOUND | **42501** | Không ở Room dự án |
| `vcc_my_work_items_v1('mine')` | 55 việc | 12 việc | 1 việc | Mỗi người thấy việc của mình |
| `list_hrm_employee_directory` | 94 | 94 | 94 | Office |
| `get_hrm_leave_ledger` (Hương) | còn 4,5 ngày | còn 4,5 ngày | **42501** "Chỉ xem được sổ phép của chính mình." | HR xem được người khác ✔ |
| `get_hrm_leave_ledger` (chính mình) | 7,0 | 3,0 | 4,0 | Ai cũng xem được của mình ✔ |
| `list_hrm_leave_balances` 2026 | 91 | 91 | **42501** "Chỉ HR xem được…" | |
| `current_app_user_id` | đúng người | đúng người | đúng người | |

Không có ca lộ dữ liệu, không có ca chặn người có quyền → **không cần migration**.

## 3. Đã sửa ở cổng `ai-gateway` (PR này)

### chat.ts — bỏ mọi câu lời nhắc tự giới hạn phạm vi
| Trước | Sau |
|---|---|
| "…nhân sự trong quyền xem (số phép, hồ sơ **của mình; của người khác khi có quyền HR**)…" | "…nhân sự (số phép, hồ sơ)…; dữ liệu nào cũng trong quyền xem — **công cụ sẽ báo nếu ngoài quyền**." |
| "Công cụ chỉ trả dữ liệu anh được xem: không thấy thì nói rõ…" | thêm: "Quyền xem do máy chủ quyết khi công cụ chạy, không phải em: **không tự đoán trước anh có quyền hay không, không tự từ chối tra cứu** — cứ gọi công cụ. Công cụ trả "ngoài phạm vi được xem" nghĩa là máy chủ đã từ chối theo quyền: nói đúng vậy, không bịa số, không nói là không tồn tại." |
| "Người không có quyền lập đơn mua thì gợi ý gửi đề xuất vật tư." | "**Công cụ báo** anh chưa có quyền lập đơn mua thì gợi ý…" |

Giữ nguyên các quy tắc từ chối hợp lệ: `[[tu_choi:ngoai_cong_viec | khiem_nha | thao_tac_cam | vi_pham | thao_tung]]`.

### tools.ts — mọi 42501 thành `{loi: "Ngoài phạm vi người hỏi được xem: … (máy chủ từ chối theo quyền). Nói rõ là ngoài quyền xem, không đoán số, không nói là không tồn tại."}`
- `outOfScope(what)` dùng chung; `toolError` tách 3 trường hợp: 42501 / *_DENIED → ngoài phạm vi; PT404 / *_NOT_FOUND → "không thấy trong phạm vi được xem"; khác → "chưa đọc được, thử lại sau".
- Mô tả công cụ `phep_nhan_vien`: bỏ "phép của người khác chỉ HR / Admin xem được", "chỉ HR xem được" → "máy chủ tự kiểm quyền theo người hỏi và báo nếu ngoài quyền".
- Lời báo khi `get_hrm_leave_ledger` / `list_hrm_leave_balances` chặn: dùng `outOfScope` (trước là "Anh/chị không có quyền… (chỉ chính người đó hoặc HR / Admin)").
- `phep_nhan_vien` tra của chính mình: danh bạ bị chặn 42501 → báo ngoài quyền danh bạ (trước: nuốt lỗi, nói "không thấy hồ sơ nhân viên gắn với tài khoản").
- `chi_tiet_don_mua`: tình hình thanh toán bị chặn 42501 (người công trường xem được PO dự án nhưng không có quyền Tài chính / Mua hàng) → `thanh_toan: {loi: "Ngoài phạm vi…"}` (trước: im lặng bỏ qua).
- `tim_ho_so` / `ton_kho`: đọc `denied[]` của `search_global_v1` — nguồn bị chặn thì nói rõ nguồn nào ngoài quyền; kết quả rỗng ghi "không khẳng định là không tồn tại" (vì nguồn RLS trả rỗng cả khi không quyền).

### Bộ kiểm hồi quy `scripts/assistant-evals/evals.ts` — thêm 4 ca theo vai (tổng 19 ca)
Cùng câu hỏi, lệnh máy chủ giả trả dữ liệu cho người có quyền và 42501 / rỗng cho nhân viên thường:

| Ca | Câu | Kỳ vọng |
|---|---|---|
| `po-detail-admin` | "PO-646 còn phải giao bao nhiêu, đã trả NCC bao nhiêu rồi?" | gọi Chi tiết đơn mua; nêu 8 tấn, 300.000.000 đ; có mã nguồn `[[hN]]`; không nói "ngoài quyền" |
| `po-detail-denied` | như trên, `get_procurement_order_v1` → 42501 | gọi công cụ; nói rõ ngoài quyền / phạm vi; **không** bịa số kèm đơn vị; **không** nói "không tồn tại" |
| `stock-admin` | "Thép D16 còn tồn bao nhiêu?" | gọi Tồn kho; nêu 12.400 kg Kho SMB; có mã nguồn |
| `stock-denied` | như trên, `search_global_v1` trả rỗng loại vật tư (RLS) | gọi công cụ; "không thấy trong phạm vi được xem"; không bịa số; không nói "không tồn tại" |
| `leave-balance-other` / `leave-balance-denied` (có từ #251) | "Nhân viên Hương còn bao nhiêu ngày phép năm?" | Admin: 9,5 ngày + nguồn; NV thường: ngoài quyền, không bịa |

Test đơn vị (vitest) cập nhật theo lời báo mới: `lib/__tests__/aiAgent.test.ts`, `lib/__tests__/assistantLeaveBalance.test.ts`.

## 4. Kết quả kiểm trước khi ship (18/10)

| Kiểm | Kết quả |
|---|---|
| Thử 9 RPC × 3 vai trên Cloud (rollback) | bảng mục 2 — không lộ, không chặn quá tay |
| `check:supabase-migrations` · `lint` · `check:supabase-queries` · `TZ=UTC vitest` (745 tệp, 3.833 ca) · `build` | đạt hết |
| Type-check cổng (`tsc -p scripts/assistant-evals/tsconfig.gateway.json`) | đạt |
| 6 ca theo vai với model thật (claude-sonnet-5-5): leave-balance-other/denied, po-detail-admin/denied, stock-admin/denied | đạt hết (8–14 s / ca) |
| Toàn bộ 19 ca hồi quy trước khi deploy | đạt hết 19/19 (5–14 s / ca) |

## 5. Việc chưa làm / gợi ý

- Nguồn INVOKER (vật tư, kho, PO trong tìm kiếm) không phân biệt "không có" / "không quyền" vì RLS trả rỗng. Muốn Trợ lý nói chính xác hơn ("anh chưa có quyền xem kho") cần một RPC nhỏ `ai_my_scopes_v1` trả quyền kho / Mua hàng / HR của người hỏi — không bắt buộc, chủ SP quyết.
- `vcc_my_work_items_v1` đòi đang trong thí điểm Trung tâm; Trợ lý chỉ mở từ Trung tâm nên hiện không gặp. Khi mở Trợ lý ra ngoài Trung tâm cần xem lại.

## 6. Bổ sung 19/10 — công cụ `chi_tiet_ho_so` (hồ sơ công việc nhân viên)

Chủ SP hỏi "hồ sơ nhân sự chi tiết" của một người (19/10) → Trợ lý chưa có công cụ. Thêm `chi_tiet_ho_so` dùng đúng 3 RPC màn Nhân sự mở hồ sơ, không viết RPC mới.

| RPC | Security | Kiểm quyền bằng | Khi bị từ chối |
|---|---|---|---|
| `get_hrm_employee_overview` | DEFINER | `assert_hrm_profile_section_access` ∈ {DIRECTORY, SELF, MANAGER, HR, HR_MANAGE} (`hrm_employee_profile_access_level`: `view_sensitive` → HR / HR_MANAGE; chính mình; `resolve_strict_direct_manager`; `view_directory`) | `42501 HRM_PROFILE_SECTION_ACCESS_DENIED` (không có cả quyền danh bạ) |
| `get_hrm_employee_work_organization` | DEFINER | như trên | như trên |
| `get_hrm_employee_contract_employment` | DEFINER | ∈ {SELF, HR, HR_MANAGE} — cổng **chỉ gọi khi `visibleSections` có `contracts_employment`** | `42501` |

Không gọi `get_hrm_employee_personal_contact` (ngày sinh, SĐT / email cá nhân, địa chỉ), `_legal_insurance` (CCCD, BHXH), `_compensation_tax_bank` (lương, thuế, STK) — các phần này không bao giờ qua Trợ lý; lời nhắc chỉ sang màn Nhân sự.

Thử thật 3 vai trên Cloud 19/10 (`ai_tool_permissions_smoke.sql`, rollback):

| RPC (Hương) | Admin Hoàng | HR Đặng Thị Hương | NV thường Nguyễn Chấp Việt |
|---|---|---|---|
| `get_hrm_employee_overview` | HR_MANAGE, 8 phần | HR, 8 phần | **DIRECTORY, 2 phần** (tổng quan + công việc) |
| `get_hrm_employee_work_organization` | OK (phòng TCKT; quản lý trực tiếp null — chưa gán trong sơ đồ) | OK | OK |
| `get_hrm_employee_contract_employment` | OK (0 HĐ, 1 sự kiện) | OK | **42501** |

Bộ kiểm hồi quy thêm 3 ca: `profile-admin` (chức danh + quản lý trực tiếp + nguồn), `profile-manager` ("ai quản lý trực tiếp chị Hương"), `profile-denied` (42501 → ngoài quyền, không bịa) — 23/23 đạt với claude-sonnet-5-5 (6–16 s / ca). Test đơn vị: `lib/__tests__/assistantEmployeeProfile.test.ts`.
