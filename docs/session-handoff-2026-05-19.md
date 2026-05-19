# Session Handoff - Vioo / Khotienthinh

Ngày kết xuất: 2026-05-19  
Workspace: `/Users/admin/khotienthinh`  
Ngôn ngữ làm việc với anh: tiếng Việt, ngắn gọn, đi thẳng vào việc.

## 1. Cách làm việc với anh

- Khi anh đưa bài toán nghiệp vụ: trước hết phân tích logic, chỉ ra flow và rủi ro dữ liệu; sau đó lên plan.
- Khi anh nói `PLEASE IMPLEMENT THIS PLAN`: triển khai ngay trong code, không dừng ở đề xuất.
- Luôn ưu tiên:
  - dữ liệu đồng bộ, tránh double dữ liệu;
  - kéo dữ liệu từ nguồn chuẩn thay vì tạo bảng/module song song;
  - dùng lại component/service/helper hiện có;
  - không dùng `alert`/`confirm` cho flow mới;
  - mọi CRUD/API phải có toast success/error, loading state, disable nút khi xử lý;
  - lỗi API dùng message tiếng Việt thân thiện, raw error log ở console.
- Sau khi implement phải chạy:
  - `npm run lint`
  - `npm run build`
- Không tự ý hard-delete dữ liệu nghiệp vụ quan trọng. Với dữ liệu đã phát sinh, ưu tiên soft delete/ẩn/archived và có cảnh báo.

## 2. Supabase cloud - cách apply migration đúng

Repo đang có lịch sử migration Supabase bị lệch. Quy ước làm việc đã thống nhất:

- Không chạy `supabase db push`.
- Tạo migration local bằng Supabase CLI:

```bash
npx supabase migration new <ten_migration>
```

- Viết SQL vào file trong `supabase/migrations/...sql`.
- Apply trực tiếp lên cloud bằng:

```bash
npx supabase db query --linked -f supabase/migrations/<file_migration>.sql
```

- Verify bằng query trực tiếp, ví dụ:

```bash
npx supabase db query --linked "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'projects';"
```

- Sau khi verify cloud đã có schema, đánh dấu migration local là applied:

```bash
npx supabase migration repair <version> --linked --status applied
```

- Không repair hàng loạt migration cũ nếu không được yêu cầu.

### Login Supabase CLI

Supabase CLI global không có, dùng CLI local qua `npx`.

Kiểm tra:

```bash
npx supabase --help
npx supabase login --help
```

Login theo flow browser/code:

```bash
npx supabase login --no-browser
```

CLI sẽ in ra link dạng:

```text
Here is your login link, open it in the browser ...
Enter your verification code:
```

Mở link, anh cấp quyền trên Supabase Dashboard, rồi gửi verification code cho Codex nhập vào phiên CLI đang chờ.

Nếu anh cấp access token trực tiếp thì có thể dùng:

```bash
npx supabase login --token <SUPABASE_ACCESS_TOKEN>
```

Không lưu token vào file repo.

### Supabase project

Project ref anh đã đưa:

```text
ftciqmqhmfvjtwoycswe
```

MCP Supabase anh muốn cấu hình:

```bash
codex mcp add supabase --url https://mcp.supabase.com/mcp?project_ref=ftciqmqhmfvjtwoycswe
```

`~/.codex/config.toml`:

```toml
[mcp]
remote_mcp_client_enabled = true
```

Auth MCP:

```bash
codex mcp login supabase
```

Skill Supabase:

```bash
npx skills add supabase/agent-skills
```

## 3. Trạng thái migration đang pending

Đã tạo migration local nhưng chưa apply được vì CLI báo thiếu access token:

```text
Access token not provided. Supply an access token by running supabase login or setting the SUPABASE_ACCESS_TOKEN environment variable.
```

Migration pending:

```text
supabase/migrations/20260519040705_add_project_soft_hide.sql
```

Nội dung migration:

```sql
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by text,
  ADD COLUMN IF NOT EXISTS hidden_reason text;

CREATE INDEX IF NOT EXISTS idx_projects_is_hidden
  ON public.projects(is_hidden);

CREATE INDEX IF NOT EXISTS idx_projects_hidden_at
  ON public.projects(hidden_at)
  WHERE is_hidden = true;
```

Sau khi login, chạy:

```bash
npx supabase db query --linked -f supabase/migrations/20260519040705_add_project_soft_hide.sql
```

Verify:

```bash
npx supabase db query --linked "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name in ('is_hidden','hidden_at','hidden_by','hidden_reason') order by column_name;"
```

Sau verify, repair version:

```bash
npx supabase migration repair 20260519040705 --linked --status applied
```

## 4. Pattern import/export Excel chuẩn

Các import Excel quan trọng phải dùng chung engine:

- `lib/loadXlsx.ts`
- `lib/excelImport.ts`
- `components/ExcelImportReviewModal.tsx`

Interface/pattern chính:

- `ExcelImportMode = 'create' | 'update'`
- `parseExcelRows(file, sheetName)`
- `buildImportPreview(config, rows)`
- `applyImportChanges(preview)`
- Modal preview:
  - tổng dòng;
  - dòng hợp lệ;
  - dòng lỗi;
  - trùng mã;
  - sai mã;
  - đã tồn tại;
  - sẽ cập nhật;
  - không đổi;
  - diff `giá trị cũ -> giá trị mới`.

Quy tắc import:

- File mẫu nên có các sheet:
  - `Nhap_moi`
  - `Cap_nhat`
  - `Huong_dan`
  - `Danh_muc` hoặc các sheet lookup hợp lệ.
- `Nhập mới`: mã đã tồn tại là lỗi, không ghi đè.
- `Cập nhật`: mã không tồn tại là lỗi.
- Cập nhật chỉ thay đổi các cột có trong file.
- Ô trống ở chế độ cập nhật nghĩa là không đổi.
- Nếu cần xoá giá trị: dùng `__CLEAR__` và chỉ cho field được phép clear.
- Không gọi API ghi dữ liệu trước khi user xác nhận preview.
- Import phải có toast và loading.

Các màn đã/đang theo pattern này:

- `Cài đặt >> Dữ liệu gốc >> Danh mục vật tư`
- HRM `Employees`
- TS `AssetCatalog`
- HĐ `ContractItemTable` BOQ
- Dự án `ProjectDashboard`
- PO trong `SupplyChainTab`

## 5. Những hạng mục nghiệp vụ đã bàn và hướng triển khai

### Feedback/API/loading toàn hệ thống

Đã thống nhất chuẩn:

- Dùng `ToastContext`, không thêm thư viện toast mới.
- Helper:
  - `lib/apiError.ts`
  - `getApiErrorMessage(error, fallbackMessage)`
  - `logApiError(scope, error)`
- Hook:
  - `hooks/useAsyncAction.ts`
- Form:
  - validation field inline;
  - success/error API dùng toast;
  - lỗi load dữ liệu dùng inline error + retry nếu hợp lý.

### User hệ thống / HRM / WMS

Phân tách nghiệp vụ:

- Tài khoản hệ thống dùng để đăng nhập phần mềm và quản lý kho nếu có.
- HRM là hồ sơ nhân sự.
- Khi tạo tài khoản hệ thống có thể gán:
  - kho;
  - role kho;
  - hoặc không gán nếu người đó không tham gia nghiệp vụ kho.
- HRM nhân sự có thể lấy thông tin từ tài khoản hệ thống, bổ sung thiếu thủ công hoặc import Excel.
- Nếu nhân sự có tài khoản kho thì chọn liên kết tài khoản kho ở phần dưới cùng.

Bug từng gặp:

- CRUD user ở `Cài đặt >> Người dùng` reload về trạng thái cũ do dữ liệu DB chưa được sửa đúng.
- Khi xoá user test bị FK từ `activities`, migration đã xử lý hướng `activities.user_id on delete set null`.

### QR phiếu NCC và PO

Flow đã thống nhất:

- Bộ phận vật tư mua hàng tạo PO trong `Dự án >> Cung ứng vật tư`.
- PO có thể tạo tay hoặc import từ Excel mẫu.
- PO in/PDF có QR trỏ về:

```text
/#/inventory?poToken=<qr_token>
```

- Nhà cung cấp giao hàng theo PO.
- Cán bộ nhận hàng vào `Vật tư >> Kho & Vật tư`, quét QR.
- QR ở màn này chỉ dùng cho phiếu nhập NCC/PO, không còn tìm SKU.
- Hệ thống load PO, điền sẵn phiếu nhập kho.
- Người nhận chỉ kiểm thực tế và xác nhận.
- Xác nhận tạo transaction `IMPORT COMPLETED`, cộng tồn kho, cập nhật `receivedQty`, PO chuyển `partial` hoặc `delivered`.

Schema/migration PO đã có:

```text
supabase/migrations/20260517210827_wms_po_qr_receiving.sql
```

### Hợp đồng / BOQ version

Đã thống nhất mô hình:

- Có workspace hợp đồng thống nhất cho `HD` và `Dự án`.
- Không tạo BOQ song song.
- Nguồn dữ liệu chuẩn:
  - BOQ hiện hành: `contract_items`
  - version điều chỉnh: `contract_variations` + `contract_variation_items`
  - phụ lục: `contract_appendices`
  - lịch thanh toán: `payment_schedules`
  - chứng từ thanh toán: `payment_certificates`
- `Dự án >> Hợp đồng` chỉ là view/shortcut filter vào workspace hợp đồng, không copy dữ liệu.
- Điều chỉnh BOQ theo version:
  - `V0`: BOQ gốc
  - `V1`, `V2`, ...: điều chỉnh đã duyệt
- Chỉ variation được duyệt mới apply vào `contract_items`.
- Visualization:
  - waterfall giá trị HĐ qua version;
  - bảng so sánh BOQ;
  - lane/đường găng chi phí đơn giản.

Migration liên quan:

```text
supabase/migrations/20260518044750_contract_boq_workspace.sql
```

### HĐ Danh mục / Khoản mục chi phí dạng cây

Đã thống nhất:

- `Khoản mục chi phí` là danh mục master dạng cây trong `Hợp Đồng >> Danh mục`.
- Không dùng `project_cost_items` vì bảng đó là chi phí theo dự án.
- Bảng master:

```text
contract_cost_items
```

- Dữ liệu adjacency tree:
  - `parent_id`
  - cấp gốc `parent_id = null`
- STT `1`, `2`, `2.1`, `2.3.1` sinh khi render, không lưu DB.
- Dấu `+` trên từng dòng tạo con trực tiếp dưới dòng đó.
- Chặn xoá node có con.

Migration:

```text
supabase/migrations/20260518082904_contract_cost_items_tree.sql
```

### HĐ Danh mục metadata

Anh yêu cầu thêm `Hợp Đồng >> DANH MỤC`, các tab CRUD:

- Dịch vụ
- Nhân công
- Máy thi công
- Định mức vật liệu
- Khoản mục chi phí

Migration liên quan:

```text
supabase/migrations/20260518072838_contract_catalog_metadata.sql
```

### Danh mục vật tư

Yêu cầu:

- `Cài đặt >> Dữ liệu gốc >> Danh mục vật tư`.
- Cột:
  - Mã SKU
  - Tên vật tư
  - Danh mục
  - ĐVT Chính
  - Đơn vị phụ / Đơn vị mua hàng
- Có:
  - xuất file mẫu;
  - nhập mới Excel;
  - cập nhật Excel theo `Mã SKU`.
- Cập nhật theo Mã SKU có preview, cảnh báo:
  - trùng mã trong file;
  - mã không tồn tại;
  - mã đã tồn tại ở nhập mới;
  - có muốn ghi đè không.

## 6. Trạng thái implement gần nhất - Quản lý dự án

Anh yêu cầu:

1. `Quản lý dự án`: nhập/xuất dự án, xuất file mẫu chi tiết, bộ lọc/sort.
2. Thêm xoá dự án, nếu đã phát sinh chi phí thì không xoá với user thường.
3. Admin có quyền force, nhưng theo quyết định cuối: force nghĩa là `ẩn dự án`, không hard-delete.
4. Admin có chức năng xem/khôi phục dự án đã ẩn.

Đã implement:

- File chính:

```text
pages/ProjectDashboard.tsx
lib/projectMasterService.ts
types.ts
supabase/migrations/20260519040705_add_project_soft_hide.sql
```

- Thêm nút danh sách dự án:
  - `Xuất mẫu`
  - `Nhập mới`
  - `Cập nhật`
  - `Xuất danh sách`
  - `Thêm dự án`
- File mẫu có sheet:
  - `Nhap_moi`
  - `Cap_nhat`
  - `Huong_dan`
  - `Danh_muc`
- Import dự án dùng `ExcelImportReviewModal`.
- Cập nhật Excel không chỉnh tổ chức/nhân sự dự án; tab `Tổ chức` vẫn là nơi chỉnh nhân sự/quyền.
- `Nhập mới` có thể seed:
  - Quản trị dự án
  - Thực hiện dự án
  - Người theo dõi
  - Vị trí mặc định
- Bộ lọc/sort:
  - tìm kiếm mã/tên/khách hàng/công trường;
  - trạng thái;
  - nhóm;
  - loại;
  - lĩnh vực;
  - quy trình;
  - đã/chưa liên kết công trường;
  - ngày bắt đầu từ/đến;
  - ngày kết thúc từ/đến;
  - sort theo cập nhật mới, mã, tên, ngày bắt đầu, giá trị HĐ, chi phí thực tế, lợi nhuận, tiến độ.
- Admin có filter:
  - Đang hoạt động
  - Đã ẩn
  - Tất cả
- User thường không thấy dự án ẩn.
- Modal ẩn dự án:
  - kiểm tra phát sinh chi phí;
  - hiển thị số dòng/tổng tiền theo nhóm;
  - nếu có phát sinh, user thường bị chặn;
  - Admin phải nhập đúng mã dự án và lý do để force ẩn;
  - dữ liệu vẫn giữ nguyên.
- Service kiểm tra impact trong:
  - `project_transactions`
  - `project_cost_actuals`
  - `payment_certificates`
  - `quantity_acceptances`
  - `advance_payments`
  - `purchase_orders` trạng thái `partial`, `delivered`
  - `daily_logs`
  - `daily_log_labor`
  - `daily_log_machines`
  - `daily_log_materials`
- Các bảng/cột không tồn tại do schema lệch được log raw error và trả warning, không crash modal.
- Đã thay `alert/confirm` trong `ProjectDashboard.tsx` bằng toast/confirm inline.

Đã verify:

```bash
npm run lint
npm run build
```

Cả hai đều pass. Build có warning chunk lớn của Vite, chưa phải lỗi.

Chưa xong:

- Chưa apply migration `20260519040705_add_project_soft_hide.sql` lên Supabase cloud vì CLI chưa login.

## 7. Các command hữu ích

Kiểm tra file nhanh:

```bash
rg --files
rg -n "pattern" path
```

Run typecheck:

```bash
npm run lint
```

Run build:

```bash
npm run build
```

Check Supabase CLI:

```bash
npx supabase --help
npx supabase db query --help
npx supabase migration repair --help
```

Apply migration pending sau khi login:

```bash
npx supabase db query --linked -f supabase/migrations/20260519040705_add_project_soft_hide.sql
```

Verify migration pending:

```bash
npx supabase db query --linked "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'projects' and column_name in ('is_hidden','hidden_at','hidden_by','hidden_reason') order by column_name;"
```

Repair:

```bash
npx supabase migration repair 20260519040705 --linked --status applied
```

## 8. Nhắc nhở cho phiên mới

- Đọc file này trước.
- Nếu task có Supabase, đọc skill:

```text
/Users/admin/.agents/skills/supabase/SKILL.md
```

- Nếu anh đang yêu cầu apply migration cloud:
  1. chạy `npx supabase login --no-browser`;
  2. gửi link login cho anh mở nếu cần;
  3. chờ anh gửi verification code;
  4. nhập code vào phiên CLI đang chờ;
  5. chạy `npx supabase db query --linked -f <migration>`;
  6. verify;
  7. repair đúng version migration.
- Không dùng `db push` trong repo này.
- Khi code UI nghiệp vụ:
  - dùng toast;
  - dùng `getApiErrorMessage/logApiError`;
  - loading/disabled đầy đủ;
  - preview trước khi import Excel;
  - không hard-delete nếu dữ liệu đã phát sinh.
