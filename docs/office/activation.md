# Vioo Office — vận hành sau kích hoạt production

## Phạm vi bàn giao hiện tại

Ngày 04/10/2026, chủ dự án đã cho phép áp dụng production và chỉ định người soạn/quản trị cùng người duyệt. Đã áp dụng migration Office, cấp quyền cho hai tài khoản được chỉ định, triển khai `office-assistant` và đưa frontend từ `codex/vioo-office` lên [app production](https://khotienthinh.vercel.app/#/office). Không merge main, không sửa branch khác. Chi tiết và bằng chứng: [production-rollout.md](production-rollout.md).

## Database và quyền

1. Chọn Supabase Cloud đích, kiểm tra lịch sử migrations hiện hành và backup theo quy trình repository. Không dùng Docker hoặc Supabase local. Không chạy blanket `db push --include-all`: branch còn chứa migration của module khác và các version ngày sau Office.
2. Đã triển khai **đúng một file** `supabase/migrations/20261004085552_office_p0_document_lifecycle.sql` bằng quy trình migration của repository, ghi đúng history và reload schema cache. P0/P1/AI quota nằm chung file. File đã áp dụng và không được sửa lại; mọi sửa đổi schema tiếp theo phải là migration mới. Không chạy lại migration hoặc runner kiểm thử trước triển khai.
3. Cấp quyền qua hệ thống vai trò/quyền hiện có. Người nhận thông thường cần `office.module.access` global + `office.document.view` assigned. Người soạn cần thêm create/edit/submit với scope phù hợp; người duyệt cần approve assigned và có trong tuyến; văn thư có issue_number/publish; quản trị module có `office.configuration.manage`. Chỉ cấp view global/view_restricted khi vai trò thực sự cần.
4. Cấu hình loại văn bản, tuyến duyệt/người duyệt, quy tắc số và cây thư mục phòng ban trong Office. Cây thư mục phục vụ phân loại; quyền xem được quyết định bởi văn bản và người nhận, không bởi tên thư mục.
5. Nếu nối sổ cũ, xác định số cuối cùng của từng rule/type/year trước khi phát hành số đầu tiên. Migration không tự đoán mốc hoặc nhập dữ liệu Base.
6. Đã refresh permission-contract fixture từ production, bỏ allowlist của 14 permission Office; 14 tests permission catalog/service đạt sau thay đổi.

Gửi theo phòng ban/công trường chốt **thành viên đang hoạt động tại thời điểm gửi**. Người được bổ sung vào tổ chức sau đó không tự nhận lịch sử; dùng gửi bổ sung/tag lại để phân phối cho người mới. UI báo người chưa có quyền Office; không tự cấp quyền chỉ vì được chọn làm người nhận. Toàn công ty dùng user đang active trong công ty/instance ERP hiện tại, không có cơ chế multi-tenant mới.

## Thông báo và deeplink

Office ghi bảng `notifications` trong cùng transaction với lệnh nghiệp vụ. Trigger push hiện có `private.notify_web_push_on_notification` dùng Vault `send_web_push_url`/`send_web_push_secret`, gọi worker `send-web-push`; worker cần VAPID và subscription của thiết bị. Không thay hoặc deploy lại worker này trong thay đổi Office.

Sau kích hoạt, test: người A đúng phòng ban nhận một thông báo; B ngoài phạm vi không nhận/không đọc được; tag phòng B thì B mới nhận; nhấn push mở đúng `/office/documents/:id`; đăng nhập lại vẫn về được văn bản theo cơ chế app; retry lệnh không tạo push trùng. Thử khi tab đóng, PWA nền và khi người dùng tắt quyền notification. Receipt chỉ ghi lúc thực sự mở nội dung, acknowledgement phải bấm xác nhận riêng.

## AI/OCR

Provider hiện thực: Gemini API. Cấu hình server secrets riêng **`OFFICE_AI_API_KEY`** và **`OFFICE_AI_MODEL`** (model Gemini có hỗ trợ PDF/ảnh). Không dùng lại khóa Gemini của module khác và không đặt khóa vào biến `VITE_*`, source hoặc Git. Có key mà chưa có model vẫn là chưa cấu hình.

Tạo file secrets riêng nằm ngoài repository, quyền đọc hạn chế; dùng Supabase Dashboard hoặc CLI đã kiểm tra `--help`:

```sh
supabase secrets set --env-file /absolute/path/office-ai.secrets --project-ref PROJECT_REF
supabase functions deploy office-assistant --project-ref PROJECT_REF --use-api
```

`--use-api` bundle trên Cloud, không Docker. `supabase/config.toml` đặt `verify_jwt=false` vì handler tự xác thực bearer bằng `auth.getUser`, sau đó dùng client mang token của caller cho RPC/Storage; không có service-role client. Frontend và function đã triển khai. Kiểm tra trạng thái AI sau khi thêm secrets, trước khi gửi tài liệu thật.

OCR nhận tệp READY thuộc văn bản người dùng có quyền sửa; PDF/JPEG/PNG/WebP tối đa 8 MB, dù attachment thường có thể 50 MB. Tóm tắt/hỏi đáp chỉ nhận nội dung văn bản người dùng được xem. Tìm kiếm AI đề xuất từ khóa rồi query lại bằng RLS; không lấy toàn bộ kho gửi model. Quota 10 lần/phút và 100 lần/ngày/người; timeout provider 55 giây. Kết quả phải được xem và chủ động áp dụng vào nháp; AI không có công cụ duyệt/cấp số/phát hành.

API key/model chưa được thêm; function đã deploy và chưa gọi provider thật. HTTP không có Auth bị từ chối với 401 `OFFICE_DENIED`. Cần kiểm tra chất lượng OCR, độ trễ và hạn mức chi phí bằng tài liệu thử được phép gửi dịch vụ. Tài liệu provider: [PDF/ảnh](https://ai.google.dev/gemini-api/docs/document-processing), [JSON output](https://ai.google.dev/gemini-api/docs/structured-output), [Supabase Auth trong Edge Functions](https://supabase.com/docs/guides/functions/auth).

## Nghiệm thu thực tế trước rollout

- Tài khoản thật ở các vai trò người soạn/duyệt/văn thư/người nhận/phòng ban ngoài phạm vi hoàn thành draft → approve → number → publish → read/ack → archive → search.
- Hai phiên độc lập cấp số đồng thời; retry sau mất phản hồi không tăng counter lần nữa; không trùng số.
- Upload bytes qua Storage HTTP, xác minh URL private, người ngoài phạm vi không tải được; thu hồi/quyền thay đổi có hiệu lực theo TTL signed URL (300 giây).
- Push/deeplink trên điện thoại vật lý iOS/Android; thử upload camera, bàn phím, xoay màn hình và mạng chậm. Browser emulation trong repo chưa thay thế bước này.
- AI không có key báo đúng; có key thử OCR PDF/ảnh và kiểm tra lại nội dung trước lưu. Không có dữ liệu hay trạng thái thành công giả khi provider lỗi.

## Tích hợp còn chưa triển khai

Chữ ký số cần provider, sandbox, chứng thư, callback xác thực và quy tắc lưu bản PDF đã ký. Repository hiện chỉ có chữ ký ảnh; không thể coi đó là tích hợp ký số. Khi chọn provider, chữ ký phải gắn hash/version tệp bất biến, callback idempotent và xác minh trên server trước đổi trạng thái.

Command Center chưa có host UI trong repository. `createOfficeService` đã tách khỏi React; host sau này có thể gọi list/detail/create nháp và lấy capabilities. Thao tác approve/issue_number/publish vẫn phải gọi RPC bằng actor thật, version và idempotency key; không dùng service role hoặc tin quyền do AI tự khai.

## Tắt và phục hồi

Tắt Office bằng quyền module/rollout frontend; tắt AI bằng gỡ cấu hình riêng hoặc ngừng function. Giữ văn bản, audit và số đã phát hành. Không drop bảng và không tái sử dụng số. Các câu lệnh rollback-test không dùng sau khi migration đã áp dụng.
