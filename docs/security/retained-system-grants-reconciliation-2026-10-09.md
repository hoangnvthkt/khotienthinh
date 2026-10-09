# Đối soát "Quyền hệ thống đang giữ lại" (09/10/2026)

**Phạm vi:** chỉ đọc. Các quyền trực tiếp `system.*` còn hiệu lực của tài khoản đang hoạt động. Màn phân quyền theo người không sửa được chúng, vì ứng dụng `system` đã ẩn khỏi danh mục.
**Tổng:** 398 quyền, 42 mã.

## Vì sao mỗi người một số khác nhau

Phần lớn sinh ra ngày 10/09 khi chuyển 4 cột quyền cũ sang quyền mới (`mapped_view` / `mapped_manage`): ai trước đây được tích bao nhiêu module thì có bấy nhiêu quyền. Một phần cấp sau qua màn khác (Tài chính → Cài đặt, nhập lùi ngày Mua hàng). Lý do lưu trên từng dòng không đáng tin, vì mỗi lần lưu ở màn theo người, dòng giữ lại được ghi lại với lý do của lần lưu đó.

## Cách xác định quyền còn tác dụng

- **Mở màn:** `canViewRoute` bỏ qua quyền `system.*` khi màn đã có module chuẩn. Quyền `system.*` chỉ còn mở các màn chưa có module chuẩn: Portfolio dự án, Mua hàng, Hồ sơ nhân sự, Tender AI, Tin nhắn, Cài đặt / Người dùng / Hoạt động hệ thống, Nhật ký hệ thống, Dashboard tùy chỉnh, Tài chính.
- **Máy chủ:** số hàm SQL (`public`, `app_private`) nhắc tới đúng mã.

## A. Còn tác dụng, đề xuất GIỮ (292 quyền)

| Module | Quyền | Mã | Số người | Vì sao |
|---|---|---|---:|---|
| Cài đặt | Quản trị | `system.settings.manage` | 1 | mở màn: Cài đặt, Người dùng, Hoạt động hệ thống; máy chủ dùng ở 6 hàm |
| Cài đặt | Xem | `system.settings.view` | 10 | mở màn: Cài đặt, Người dùng, Hoạt động hệ thống |
| Dashboard tùy chỉnh | Quản trị | `system.custom_dashboard.manage` | 1 | mở màn: Dashboard tùy chỉnh |
| Dashboard tùy chỉnh | Xem | `system.custom_dashboard.view` | 3 | mở màn: Dashboard tùy chỉnh |
| Dự án | Xem | `system.da.view` | 52 | mở màn: Portfolio dự án |
| Hồ sơ nhân sự | Quản trị | `system.ep.manage` | 1 | mở màn: Hồ sơ nhân sự |
| Hồ sơ nhân sự | Xem | `system.ep.view` | 4 | mở màn: Hồ sơ nhân sự |
| Hợp đồng | Quản trị | `system.hd.manage` | 1 | máy chủ dùng ở 2 hàm |
| Kho vật tư | Quản trị | `system.wms.manage` | 1 | máy chủ dùng ở 1 hàm |
| Kho vật tư | Xem | `system.wms.view` | 44 | máy chủ dùng ở 1 hàm |
| Mua hàng | Nhập dữ liệu quá khứ | `system.procurement.backdate` | 2 | mở màn: Mua hàng; máy chủ dùng ở 1 hàm |
| Mua hàng | Quản trị | `system.procurement.manage` | 10 | mở màn: Mua hàng; máy chủ dùng ở 11 hàm |
| Mua hàng | Xem | `system.procurement.view` | 13 | mở màn: Mua hàng |
| Nhật ký hệ thống | Quản trị | `system.audit_trail.manage` | 2 | mở màn: Nhật ký hệ thống |
| Nhật ký hệ thống | Xem | `system.audit_trail.view` | 2 | mở màn: Nhật ký hệ thống |
| Quản trị phân quyền | Xem audit phân quyền | `system.authorization.audit` | 1 | máy chủ dùng ở 4 hàm |
| Quản trị phân quyền | Xem quản trị phân quyền | `system.authorization.view` | 2 | máy chủ dùng ở 4 hàm |
| Tender AI | Quản trị | `system.tender_ai.manage` | 1 | mở màn: Tender AI; máy chủ dùng ở 3 hàm |
| Tender AI | Xem | `system.tender_ai.view` | 2 | mở màn: Tender AI |
| Tin nhắn | Quản trị | `system.chat.manage` | 1 | mở màn: Tin nhắn; máy chủ dùng ở 1 hàm |
| Tin nhắn | Xem | `system.chat.view` | 86 | mở màn: Tin nhắn; máy chủ dùng ở 1 hàm |
| Tài chính | Ghi nhận | `system.finance.record` | 5 | mở màn: Tài chính; máy chủ dùng ở 6 hàm |
| Tài chính | Quản trị Tài chính | `system.finance.manage` | 4 | mở màn: Tài chính; máy chủ dùng ở 2 hàm |
| Tài chính | Xem Tài chính toàn công ty | `system.finance.view` | 6 | mở màn: Tài chính |
| Tài chính | Xác nhận | `system.finance.confirm` | 5 | mở màn: Tài chính; máy chủ dùng ở 4 hàm |
| Yêu cầu | Xem | `system.rq.view` | 32 | máy chủ dùng ở 1 hàm |

Cần chủ sản phẩm xem riêng: `system.settings.view` mở **Cài đặt, Người dùng, Hoạt động hệ thống** cho người không phải Admin.

## B. Không còn tác dụng, đề xuất THU HỒI (106 quyền, chờ duyệt)

| Module | Quyền | Mã | Số người | Vì sao |
|---|---|---|---:|---|
| AI | Quản trị | `system.ai.manage` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| AI | Xem | `system.ai.view` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Hợp đồng | Xem | `system.hd.view` | 19 | màn đã có quyền theo module mới; máy chủ không dùng |
| Kho tri thức | Quản trị | `system.kb.manage` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Kho tri thức | Xem | `system.kb.view` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Lưu trữ | Quản trị | `system.storage.manage` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Lưu trữ | Xem | `system.storage.view` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Ngân sách | Quản trị | `system.ex.manage` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Ngân sách | Xem | `system.ex.view` | 10 | màn đã có quyền theo module mới; máy chủ không dùng |
| Phân tích | Quản trị | `system.analytics.manage` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Phân tích | Xem | `system.analytics.view` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |
| Quy trình | Quản trị | `system.wf.manage` | 8 | màn đã có quyền theo module mới; máy chủ không dùng |
| Quy trình | Xem | `system.wf.view` | 44 | màn đã có quyền theo module mới; máy chủ không dùng |
| Tài sản | Quản trị | `system.ts.manage` | 2 | màn đã có quyền theo module mới; máy chủ không dùng |
| Tài sản | Xem | `system.ts.view` | 13 | màn đã có quyền theo module mới; máy chủ không dùng |
| Yêu cầu | Quản trị | `system.rq.manage` | 1 | màn đã có quyền theo module mới; máy chủ không dùng |

Cách thu hồi khi được duyệt: một migration sao lưu các dòng vào bảng snapshot, đặt `is_active = false`, ghi `revoked_reason`, kèm smoke "không ai mất màn nào". Smoke chạy `canViewRoute` trước/sau, hoặc đối chiếu `resolve_effective_permission_sources` trong giao dịch rollback.
