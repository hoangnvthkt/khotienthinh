# Hoàn thiện checklist điều kiện cấp thẻ an toàn

Ngày thiết kế: 2026-08-24

Trạng thái: Chờ review triển khai

Phạm vi: Bổ sung chứng chỉ an toàn, điều kiện theo công trường và checklist cấp thẻ trong Dự án → An toàn → Hồ sơ nhân công.

## 1. Mục tiêu

Người quản lý an toàn có thể hoàn tất mọi dữ liệu cần cho thẻ an toàn ngay trong hồ sơ nhân công. Hệ thống phải chỉ rõ từng điều kiện thiếu, cho phép cập nhật đúng nơi, và tự đánh giá lại để nút cấp thẻ chỉ mở khi assignment đủ điều kiện.

Không có workflow duyệt độc lập: người có quyền quản lý an toàn upload chứng chỉ là người đã xác nhận chứng chỉ đó.

## 2. Quy tắc nghiệp vụ đã chốt

1. Chứng chỉ bắt buộc hiện tại là `SAFETY_ORIENTATION` — “Huấn luyện an toàn cơ bản”. Nó áp dụng cho mọi chức danh vì `applies_to_roles` đang rỗng.
2. Khi người quản lý an toàn lưu chứng chỉ, bản ghi được đánh dấu `approved`, ghi `verified_by` là actor hiện tại và `verified_at` là thời điểm lưu. Không tạo trạng thái chờ duyệt trong UI.
3. Một chứng chỉ hợp lệ cần: loại chứng chỉ, file đính kèm ít nhất một ảnh/PDF. Số chứng chỉ, ngày cấp và ngày hết hạn là tùy chọn; nếu có ngày hết hạn thì ngày đó phải không ở quá khứ.
4. Thẻ chỉ cấp cho assignment `active`, không khóa và `eligibility_status = eligible`.
5. Ngoài chứng chỉ, điều kiện assignment phải là: đào tạo công trường `completed`, cam kết `signed`, PPE `complete`, toolbox `completed`.
6. Hồ sơ gốc cần active, họ tên, mã nhân công, ảnh chân dung, số CCCD và bằng chứng CCCD. Bằng chứng CCCD hợp lệ là `identity_attachments` legacy hoặc ít nhất một trong hai tài liệu canonical `identity_front` / `identity_back`; không buộc người dùng nhập lại hồ sơ cũ.
7. Giấy khám sức khỏe và bảo hiểm phải có ít nhất một file, không có trạng thái rejected/expired và không quá hạn nếu đã khai ngày hết hạn.

## 3. Hiện trạng và khoảng trống cần đóng

- Cloud đang có 1 assignment active bị `missing_certificate` và không có bản ghi trong `safety_worker_certificates`.
- Form hồ sơ chỉ upload ảnh nhân công, CCCD, giấy khám sức khỏe và bảo hiểm. Phần Chứng chỉ trong modal chi tiết chỉ read-only; frontend và RPC mới chưa có command tạo/chỉnh chứng chỉ.
- Bốn điều kiện công trường đã được database enforce nhưng chưa có form cập nhật trong luồng Workforce mới.
- Rule eligibility legacy kiểm tra `identity_attachments`, trong khi form mới ghi CCCD vào `safety_worker_documents`. Điều này sẽ làm hồ sơ mới bị báo thiếu profile dù đã upload CCCD.

## 4. Thiết kế dữ liệu và command

Không cần bảng mới: dùng `safety_worker_certificates` và `safety_project_assignments` hiện hữu.

Migration Supabase Cloud bổ sung:

1. `app_private.upsert_safety_worker_certificate_for_site(p_membership_id uuid, p_certificate jsonb)` và public wrapper cùng tên.
   - Kiểm tra actor có capability quản lý nhân công/tài liệu nhạy cảm tại scope membership.
   - Chỉ cho phép certificate type active.
   - Validate type, attachment array, ngày hết hạn; chỉ thao tác certificate thuộc đúng worker.
   - Lưu `approved`, `verified_by`, `verified_at`, audit log `worker.certificate.upsert` và recompute toàn bộ assignment của worker.
2. Dùng command `update_safety_worker_assignment` đã có để cập nhật bốn trường readiness. Frontend mới thêm adapter an toàn cho RPC này.
3. Cập nhật `app_private.safety_assignment_eligibility_status` và `app_private.safety_workforce_profile_readiness` để nhận một canonical CCCD document như evidence profile, đồng thời không nới lỏng quyền truy cập.
4. Eligibility chỉ tính chứng chỉ `approved` hoặc record legacy `submitted`; record `rejected` / `revoked` không được dùng. Cách này không làm dữ liệu legacy hợp lệ bị khóa đột ngột, nhưng mọi upload mới đều có audit xác nhận rõ ràng.

Mọi thay đổi dùng RPC transaction, `security definer` ở `app_private`, `search_path = ''`, public wrapper chỉ nhận tham số nghiệp vụ và actor lấy từ session. Không dùng service key ở frontend.

## 5. Thiết kế frontend

Trong `SafetyPassportWorkerDetailModal`, khi người dùng có quyền quản lý:

1. Thêm section **Sẵn sàng cấp thẻ** phía trên Thẻ an toàn:
   - trạng thái từng nhóm: hồ sơ, sức khỏe/bảo hiểm, chứng chỉ bắt buộc, điều kiện công trường;
   - link/nút mở đúng block đang thiếu;
   - vẫn giữ cảnh báo fail-closed khi actor không có sensitive capability.
2. Thêm block **Chứng chỉ an toàn**:
   - danh sách chứng chỉ hiện có, ngày hết hạn và file;
   - form thêm/sửa gồm loại, số chứng chỉ, ngày cấp, ngày hết hạn, file ảnh/PDF;
   - upload file trước, sau đó gọi command lưu record; UI chỉ đóng form khi cả hai thành công.
3. Thêm block **Điều kiện tại công trường**:
   - đào tạo công trường, cam kết an toàn, PPE, toolbox;
   - một nút Lưu cập nhật atomically assignment hiện tại rồi refresh detail/cache.
4. Extend `list_safety_site_workforce_options` và type frontend để trả certificate types active; không query trực tiếp global master từ component.

Người chỉ có quyền xem vẫn thấy lý do chưa đủ điều kiện, nhưng không thấy số CCCD, file chứng chỉ hay form thay đổi.

## 6. Luồng thao tác

```text
Mở hồ sơ worker
  → Checklist đọc eligibility + detail
  → Chọn mục thiếu
      → upload chứng chỉ / lưu điều kiện công trường / bổ sung hồ sơ
  → RPC lưu + audit + recompute eligibility
  → invalidate detail/active/dashboard
  → reload detail
  → eligible
  → Cấp thẻ với ngày hết hạn tương lai
```

Nếu upload Storage thành công nhưng RPC lưu chứng chỉ thất bại, UI báo rõ chứng chỉ chưa được ghi nhận và giữ file/path trong state để retry; không ghi một certificate thiếu attachment.

## 7. Kiểm thử và xác minh

- Unit test parser/type cho certificate types và command payload.
- Unit test API: upload, upsert certificate, update readiness và cache invalidation.
- UI contract test: manager thấy form/chỉ báo, viewer không có thao tác nhạy cảm, card bị khóa/mở đúng eligibility.
- Migration smoke trên Supabase Cloud: profile thiếu chứng chỉ → upload certificate approved → đủ chứng chỉ; sau đó hoàn tất bốn readiness → `eligible`; cấp thẻ thành công.
- Regression cho worker legacy CCCD snake_case/canonical document.
- Chạy full Vitest, `tsc`, Vite production build và kiểm tra deployment Vercel.

## 8. Ngoài phạm vi

- Workflow nhiều cấp duyệt chứng chỉ.
- Cấu hình certificate requirement riêng cho từng công trường.
- OCR/AI đọc chứng chỉ.
- Thay đổi rule chuyển công trường hoặc lifecycle thẻ đã có.
