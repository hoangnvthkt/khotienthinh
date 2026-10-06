# Vioo — quy chuẩn UI/UX (bắt buộc cho mọi màn mới hoặc sửa lại)

Chủ sản phẩm đã duyệt style của **Mua hàng**, **Tài chính** và **Quy trình**. Mọi tính năng mới tự áp dụng quy chuẩn này, không cần chủ sản phẩm nhắc lại. Nếu module đã có bộ CSS riêng (Office `pages/office/office.css`, Vioo Work `pages/work/*.css`) thì giữ nhất quán trong module đó. Mọi module khác, kể cả module mới, đều dùng bộ dưới đây.

## 1. Tái dùng trước, tự viết sau

| Cần | Dùng | File |
|---|---|---|
| Nhãn trạng thái | `Badge` (Mua hàng, Tài chính), `WfBadge` / `WorkflowStatusBadge` (Quy trình) | `components/procurement/hub/hubUi.tsx`, `components/workflow/WorkflowInstanceVisuals.tsx` |
| Loading / lỗi / không quyền / rỗng | `StateBox kind="loading\|error\|denied\|empty"` (có nút Thử lại) | `hubUi.tsx` |
| Ngăn chi tiết | `Drawer`: bên phải trên desktop, toàn màn hình trên điện thoại, Esc để đóng | `hubUi.tsx` |
| Nút, ô nhập | `primaryBtn`, `secondaryBtn`, `inputCls` (Mua hàng, Tài chính); `btnPrimary`, `btnSoft`, `btnDanger` (Quy trình) | `hubUi.tsx`, `components/workflow/WorkflowInstanceRow.tsx` |
| Ô chỉ số (KPI) | `Kpi` (bấm được để lọc), `WorkflowKpiStrip` (cuộn ngang trên điện thoại) | `components/finance/financeUi.tsx`, `components/workflow/WorkflowKpiStrip.tsx` |
| Màu dữ liệu, số | `ENT` (tên, mã có id), `NUM` (số liệu) | `financeUi.tsx` |
| Tiền, ngày | `money`, `shortMoney` (tỷ/tr), `viDate` (dd/mm/yyyy), `dueText` + `toneOf` (hạn trả) | `hubUi.tsx`, `financeUi.tsx` |
| Đính kèm | `AttachmentPicker`; xem tệp: `components/workflow/WorkflowFilePreview.tsx` | |
| Người xử lý, tiến độ bước | `WorkflowHandlers` (avatar + tên, rỗng thì báo "Chưa giao người xử lý"), `WorkflowStepper` | `WorkflowInstanceVisuals.tsx` |
| Xác nhận | `useConfirm()`; từ chối hoặc hủy cần lý do thì dùng `useReasonConfirm()` | `context/ConfirmContext.tsx` |
| Thông báo kết quả | `useToast()`: nói rõ đã làm gì, hoặc lỗi vì sao | `context/ToastContext.tsx` |
| Nhóm gập/mở | `useGroupAccordion` (Mở rộng hết / Thu gọn hết) | `components/project/work-plan/workPlanUi.tsx` |

Chỉ tạo component mới khi bảng trên không có thứ phù hợp. Khi tạo thì đặt cạnh các file trên và giữ cùng class.

## 2. Màu (theme FastCons xanh)

- Token có sẵn trong tailwind config (`index.html`): `mint` (xanh ngọc `#3cbfaa`, dùng cho biểu tượng và nhấn), `leaf` (xanh lá `#52b53a`, dùng cho nút chính và số liệu), teal `#0f766e` (tab và bộ lọc đang chọn, viền focus).
- Tên riêng và dữ liệu có id (người, dự án, NCC, hợp đồng, mã phiếu, vật tư) dùng `ENT`. Số liệu dùng `NUM` với `tabular-nums`.
- **Cam/đỏ chỉ dùng cho cảnh báo, quá hạn, từ chối.** Trạng thái bình thường không dùng amber/orange/rose.
- Tránh giao diện một màu. Ô chỉ số có icon trên nền màu nhạt theo ý nghĩa: chờ xử lý dùng amber, cần chú ý dùng rose, đang xử lý dùng sky, xong dùng mint/leaf. Số bước nằm trong vòng tròn.
- Có dark mode (`dark:`), nhưng mặc định là nền sáng. Ảnh xem thử gửi chủ sản phẩm luôn chụp ở **light mode**.

## 3. Bố cục màn hình

1. **Header**: icon module trong ô `h-11 w-11 rounded-xl bg-teal-700 text-white`, tiêu đề `text-xl md:text-2xl font-bold`, một câu mô tả việc người dùng làm ở đây. Bên phải là primary action và nút "Làm mới".
2. **Tab hình thức** (khi module có nhiều luồng): khung `rounded-xl border bg-card p-1`, tab đang chọn `bg-teal-700 text-white`, cuộn ngang được.
3. **Dải bước / KPI**: thẻ bấm được để lọc. Mỗi thẻ có số thứ tự bước, nhãn chữ hoa nhỏ, số lớn, một dòng gợi ý (ví dụ "quá ngày hẹn giao"). Thẻ đang chọn có `border-teal-500 ring-2 ring-teal-500/20`.
4. **Chip nguồn / trạng thái** có số đếm (`rounded-full`), sau đó là **thanh lọc** trong một thẻ: nhóm nút tình trạng, select dự án, select người xử lý (có "Việc của tôi", "Chưa giao"), ô tìm kiếm đa năng, và nút "Xóa lọc" khi đang có lọc.
5. **Danh sách**: nhóm theo dự án (accordion có viền trái màu, đếm phiếu / quá hạn / chưa giao). Mỗi dòng gồm mã (`font-mono` xanh), các nhãn, tiêu đề `line-clamp-2`, dòng phụ xám, bước hiện tại, người xử lý, thời gian chờ, và **nút hành động ngay trên dòng** (Duyệt / Từ chối / Xem / Tiếp tục soạn). Dòng cần người dùng xử lý có vạch màu bên trái.
6. **Chi tiết**: mở `Drawer` (danh sách bên trái, chi tiết bên phải), footer ghim đáy chứa các nút chính.
7. **Chọn nhiều**: thanh hành động `sticky bottom-3`, hiện "Đã chọn N" và các thao tác hàng loạt.

## 4. Trạng thái và microcopy

- Loading, empty, error, denied, pending, success đều phải hiện rõ. **Không che lỗi hay dữ liệu chưa biết bằng `0`.** Chưa có số thì hiện `—` hoặc kèm lý do.
- Danh sách rỗng phải là một việc cần xử lý, không để trống. Ví dụ "Chưa giao người xử lý" hiện đỏ kèm icon cảnh báo.
- Nút chính không bấm được thì có `title` giải thích vì sao.
- Microcopy tiếng Việt ngắn, nói theo việc người dùng làm ("Lập đơn hàng", "Chờ bạn duyệt", "Đứng yên 3 ngày"). Không dùng thuật ngữ database.
- Hành động quan trọng phải qua hộp thoại Xác nhận / Từ chối, từ chối kèm lý do. Toast nói rõ kết quả.
- Quá hạn hoặc chờ bạn: nhấp nháy nhẹ bằng `.overdue-blink` / `.wf-pulse`, tự tắt khi người dùng chọn giảm chuyển động. Xem giới hạn kỹ thuật ở mục 6.

## 5. Điện thoại và máy đời cũ

- Kiểm tra ở 3 khổ: desktop 1440, tablet 820, phone 390. Không cuộn ngang trang (`scrollWidth <= innerWidth`). Dải chip/KPI dùng `no-scrollbar overflow-x-auto`.
- Nút chiếm cả hàng trên điện thoại (`flex-1 md:flex-none`), vùng chạm cao ≥ 36–40px.
- Ngăn chi tiết toàn màn hình trên điện thoại. Bảng rộng chuyển thành thẻ hoặc cuộn trong khung.
- Xem PDF: dùng **iframe với blob URL** (trình xem có sẵn của trình duyệt), kèm nút "Mở toàn màn hình" và "Tải tệp". Không dùng pdf.js. Mẫu: `WorkflowFilePreview.tsx`, `pages/office/OfficeFilePreview.tsx`.

## 6. Giới hạn kỹ thuật bắt buộc (bài học sự cố)

- **Animation lặp vô hạn (`infinite`) chỉ được đổi `opacity` hoặc `transform`.** Không animate `box-shadow`, `filter`, `background`, `width/height`, không dùng `color-mix(... currentColor ...)` trong keyframes. Sự cố 06/10/2026: `wfSoftPulse` animate box-shadow + color-mix trên khoảng 40 nhãn, ngốn ~25% CPU khi trang đứng yên, làm **Safari máy tính và mọi trình duyệt trên iPhone sập trang `/wf`** ("A problem repeatedly occurred"), trong khi Chrome máy tính vẫn chạy (PR #117).
- Trên iPhone, Chrome và mọi trình duyệt khác đều chạy lõi Safari (WebKit). "Chrome máy tính chạy được" **không** chứng minh gì cho điện thoại.
- Màn có nhiều phần tử động hoặc danh sách dài: đo bằng Playwright WebKit (`document.getAnimations().length`, CPU tiến trình WebContent khi trang đứng yên phải ≈ 0–2%). Cách tái hiện với dữ liệu thật: build production → `vite preview` → `webkit.launchPersistentContext(..., { headless: false })` → chủ sản phẩm tự đăng nhập trong cửa sổ "Playwright".
- Thư viện JS mới phải chạy được trên Safari iOS cũ (iOS 16 trở lên). Tránh thư viện chỉ hỗ trợ trình duyệt rất mới. Bài học pdf.js 6 ở #116/#117.
- Ảnh người dùng có thể là data URL base64 lớn (tới ~4 MB). Không nhân bản chúng hàng loạt trong DOM.

## 7. Quy trình làm một màn

1. Xác định người dùng, mục tiêu, thông tin cần thấy đầu tiên, primary action (xem `AGENTS.md`).
2. Dựng mockup bằng dữ liệu thật, hoặc fixture có quy mô giống thật, trước khi code.
3. Code bằng bộ component ở mục 1.
4. Walkthrough desktop, tablet, phone ở nền sáng. Chạy test Playwright có cả `mobile-safari` (WebKit) khi màn có trên điện thoại.
