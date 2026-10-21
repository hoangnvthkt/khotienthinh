# Tìm kiếm toàn hệ thống (Global Search) — 09/10/2026

Yêu cầu chủ sản phẩm: nâng Global Search thành công cụ tìm "mọi ngõ ngách" **theo quyền từng nhân viên**, hiểu tiếng Việt
(không dấu, viết tắt, gợi ý, liên quan), và **thao tác nhanh** được toàn bộ ngay trong ô tìm.

## 1. Người dùng thấy gì

- **Mở**: `Ctrl K` / `⌘K`, nút **Tìm kiếm…** đầu thanh bên (máy tính), biểu tượng kính lúp đầu trang (điện thoại),
  chân thanh Trung tâm điều hành, nút nổi "Tìm kiếm nhanh".
- **Ô trống**: 8 thao tác nhanh (ưu tiên việc người đó hay làm), "Mở gần đây", "Tìm gần đây", một dòng mẹo.
- **Khi gõ**: kết quả nhóm theo việc — Thao tác nhanh · Chức năng · Dự án · Mua hàng · Vật tư & kho · Đề xuất & quy trình ·
  Nhân sự · Hợp đồng & đối tác · Tài chính · Hành chính · Công việc · Tài sản. Chip lọc nhóm có số đếm (`Tab` để đổi),
  "Phù hợp nhất" khi có một kết quả vượt trội, dòng "Hiểu là …" khi máy đọc lại câu gõ.
- **Xem trước** (máy tính ≥ 1024px): mã, trạng thái, số tiền, đối tác, hạn… + **Liên quan** (vd. dự án → Nhật ký, Vật tư,
  Tiến độ, Hợp đồng, An toàn, Tài chính dự án; nhân viên → Gọi, Email; vật tư → Danh mục, Lập phiếu xuất, Chuyển kho).
  Điện thoại/tablet: nút mũi tên trên dòng bung các thao tác liên quan.
- **Thao tác ngay tại chỗ**: Xin nghỉ phép, Tạo đề xuất mở form thật (CenterModals) không rời trang; thao tác cần dự án
  (Lập đề xuất vật tư, Ghi nhật ký, Kế hoạch tuần, các tab dự án) chuyển sang bước **chọn dự án** rồi mở đúng tab.
- **Trạng thái**: đang tìm (khung xương), máy chủ lỗi (đỏ + Thử lại, chức năng/thao tác vẫn tìm được), một nguồn lỗi
  (vàng, nêu tên nguồn), không thấy (gợi ý "Có phải bạn muốn tìm …", Hỏi Trợ lý AI với câu đã gõ).
- Nhãn trạng thái chỉ hiện khi khác thường (Ngừng dùng, Tạm dừng, Chờ duyệt…); vật tư đang dùng, nhân viên đang làm việc
  không gắn nhãn.

## 2. Hiểu tiếng Việt (`lib/search/`)

| Gõ | Hiểu |
|---|---|
| `cham cong`, `CHẤM CÔNG` | bỏ dấu, chữ thường, đ → d |
| `nhaapj kho`, `va6t tu7` | Telex / VNI khi quên bật bộ gõ → "nhập kho", "vật tư" (báo "Hiểu là …") |
| `po`, `ncc`, `hđ`, `đntt`, `pnk`, `cc` … | ~50 nhóm viết tắt/đồng nghĩa ngành xây dựng (`viLexicon.ts`) |
| `đơn hàng thép` | "đơn hàng" là từ chỉ loại → ưu tiên Đơn hàng, vẫn phải có "thép" |
| `nvh`, `dntt` | chữ cái đầu ("Nguyễn Văn Hoàng", "Đề nghị thanh toán") |
| `thpe`, `cahm cong` | gõ đảo chữ / sai 1 chữ ở từ ≥ 5 ký tự → sửa theo vốn từ (học thêm từ tên hồ sơ) |
| `po2026015` | mã gõ liền không gạch khớp `PO-2026-015` |
| `0912345678` | số điện thoại không cần dấu cách |

Luật chống nhiễu: từ 4 chữ không sửa bằng thay chữ (phép ≠ thép); viết tắt ≤ 3 chữ do máy thêm phải khớp trọn từ
("cc" không khớp "CCDC"); chữ người dùng tự gõ vẫn khớp đầu từ.

## 3. Quyền (quan trọng nhất)

- **Chức năng & thao tác**: lấy từ chính thanh bên (`useModuleNavigation`, `navigationModulesFor`) và `canAccessRoute` — màn
  nào không vào được thì không hiện.
- **Hồ sơ**: `public.search_global_v1` chạy **SECURITY INVOKER** — RLS sẵn có của từng bảng quyết định dòng nào được thấy
  (dự án theo Room, phiếu kho theo kho, tài chính `finance_can`, văn bản `office_can_view`, RQ/quy trình theo người có tên
  trên phiếu…). Danh bạ đi qua `list_hrm_employee_directory()` của HRM. Không có luật quyền thứ hai để lệch nhau.
- Trình duyệt chỉ xin loại hồ sơ mà người đó mở được màn (KIND_META.gates); kết quả mở màn không được thì chuyển sang màn
  liên quan mở được.
- Smoke Cloud (rollback): Admin chạy đủ 20 nguồn không lỗi; nhân viên chưa có quyền không thấy dự án / PO / tài chính /
  kho / văn bản / danh bạ; chuỗi có ký tự regex bị loại; anon không gọi được.

## 4. Tốc độ

RLS vài bảng tốn ~10–23 ms mỗi dòng (đếm 346 phiếu kho mất 8 s với tài khoản chưa có quyền kho). Nên tìm hai bước:
`app_private.gs_candidates_v1` (SECURITY DEFINER, schema không lộ qua API) chỉ lọc chữ và trả tối đa 25 **mã** ứng viên;
`search_global_v1` đọc lại đúng các mã đó bằng quyền người gọi (`id = any(...)` đi chỉ mục → RLS chỉ chạy trên ứng viên).

Đo trên Cloud 09/10 (rollback, danh tính Admin thật): toàn bộ 20 nguồn **0,44 s** ("thép"), **0,62 s** ("a"); trước khi tách
hai bước là 10,5 s. Trình duyệt gửi nguồn nặng (phiếu kho, đề xuất cấp mã) thành lượt riêng song song, chờ gõ 220 ms,
nhớ kết quả 60 s, hủy lượt cũ khi gõ tiếp.

Gói tải đầu: hộp tìm kiếm là chunk riêng (60 kB, 20 kB gzip) nạp sẵn sau 4 s; gói chính 728 kB (main hiện tại 759 kB — bỏ
được việc palette cũ tải toàn bộ danh sách RQ ở mọi trang).

## 5. File

- Máy chủ: `supabase/migrations/20261010110000_global_search_v1.sql`, smoke `supabase/tests/global_search_v1_smoke.sql`,
  gỡ `supabase/operations/global_search_v1_rollback.sql`.
- Trình duyệt: `lib/search/*` (viText, viLexicon, searchEngine, searchCatalog, recordPresentation, globalSearchService,
  searchHistory, openGlobalSearch), `components/CommandPalette.tsx` (phím tắt + tải lười), `components/search/*`.
- Màn đích nhận `?q=` điền sẵn ô tìm: Tồn kho, Đối tác, HĐ nhà cung cấp, Đề xuất vật tư (kho), Trợ lý AI
  (`hooks/useSearchParamPrefill.ts`).
- Test: `lib/__tests__/globalSearch*.test.ts`, fixture `tests/search/fixture.html`, e2e `tests/e2e/global-search.spec.ts`
  (`npx playwright test -c tests/search/playwright.config.ts` — desktop, tablet, iPhone WebKit).

## 6. Triển khai

1. Duyệt PR → `prod-push --include-all` dry-run phải "Would push" đúng `20261010110000_global_search_v1.sql` → apply.
2. Chạy lại smoke trên prod (rollback):
   `node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe --migration supabase/migrations/20261010110000_global_search_v1.sql --smoke supabase/tests/global_search_v1_smoke.sql`
3. Merge → Vercel tự lên frontend. Nếu frontend lên trước migration: ô tìm vẫn chạy chức năng/thao tác, báo "Chưa tìm
   được trong hồ sơ".

## 7. Việc sau (chưa làm)

- Tìm trong nhật ký công trường, kế hoạch tuần, an toàn, mua nóng, hồ sơ HRM nhạy cảm (cần quyết định phạm vi).
- Chỉ mục trigram cho bảng lớn khi dữ liệu tăng (hiện tối đa ~1.500 dòng/bảng, chưa cần).
- Lệnh có tham số ("chuyển kho thép d10 sang kho DA29"), hỏi đáp AI ngay trong ô tìm.
