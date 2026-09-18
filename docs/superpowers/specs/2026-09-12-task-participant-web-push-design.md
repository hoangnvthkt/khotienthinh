# Thông báo theo người tham gia công việc và Web Push

Ngày: 2026-09-12. Trạng thái: **thiết kế đã chốt để lập kế hoạch triển khai**.

Tài liệu này chốt phạm vi thông báo cho các đối tượng xử lý công việc trong Vioo:
Work, Workflow và Request. Thông báo toàn công ty, nhắc chấm công diện rộng và
Vioo Office chưa triển khai trong đợt này.

## 1. Mục tiêu

- Đúng người: chỉ người có quan hệ nghiệp vụ đang còn hiệu lực với đối tượng nhận
  thông báo, cộng với người được nhắc đích danh trong sự kiện đó.
- Đúng việc: preview cho biết ai vừa làm gì trên mã/tên công việc, không còn nội
  dung chung chung kiểu “Mở Vioo để xem công việc”.
- Kịp thời: sự kiện nghiệp vụ được ghi nhận nguyên tử cùng giao dịch thay đổi trạng
  thái; worker xử lý có retry và không phụ thuộc vào việc trình duyệt còn mở.
- Đúng đích: bấm thông báo mở thẳng công việc, quy trình, đề xuất, bước hoặc bình
  luận liên quan; màn hình đích vẫn kiểm tra quyền truy cập lại.

## 2. Phạm vi

### Trong phạm vi

- Work task: người tạo/chủ việc, người thực thi/chủ trì/đồng thực hiện, watcher,
  reviewer hiện tại và người được `@mention`.
- Workflow instance: người tạo khi cần nhận kết quả, người xử lý bước hiện tại,
  watcher đang hoạt động và người được `@mention` trong thảo luận.
- Request instance: người đề xuất khi cần nhận kết quả, người duyệt bước hiện tại,
  watcher đã được snapshot từ mẫu và người được chỉ định trong hành động.
- Các sự kiện: tạo/giao việc, thêm hoặc gỡ người tham gia, chuyển giao, cập nhật,
  bình luận, nhắc tên, gửi duyệt, chờ duyệt, chuyển bước, chấp thuận, yêu cầu bổ
  sung, từ chối, hoàn tất, hủy, mở lại, sắp đến hạn và quá hạn.
- In-app notification, Web Push preview, điều hướng khi app đang mở/đóng và theo
  dõi trạng thái giao nhận.

### Ngoài phạm vi

- Broadcast `user_id is null`, thông báo toàn công ty và Vioo Office.
- Email, SMS, Telegram hoặc thay đổi lựa chọn trình duyệt hỗ trợ Web Push.
- Tự cấp quyền xem chỉ vì được `@mention`. Mention chỉ tạo thông báo; deeplink vẫn
  fail closed nếu người dùng không có quyền vào đối tượng.
- Viết lại toàn bộ hạ tầng thông báo thành một hàng đợi duy nhất.

## 3. Hướng kiến trúc

Ba phương án đã được cân nhắc:

1. Một outbox chung thay thế ngay mọi pipeline: mô hình đẹp nhưng migration lớn,
   làm tăng rủi ro cho Work và Request đang có cơ chế retry riêng.
2. Tiếp tục tạo thông báo từ React: ít thay đổi nhưng không nguyên tử, có thể mất
   thông báo khi tab đóng và khó chống trùng.
3. **Nâng cấp tăng dần trên backend**: giữ outbox Work và Request; thêm outbox cho
   Workflow; mọi pipeline cùng xuất ra một hợp đồng `public.notifications` và cùng
   bộ quy tắc deeplink. Đây là phương án được chọn.

`public.notifications` là nguồn hiển thị in-app. Web Push chỉ là bản sao của cùng
notification: dùng đúng `title`, `message`, `action_url`, `priority` và ID để theo
dõi. Work tiếp tục dùng worker riêng vì cần kiểm tra lại quyền/quan hệ ngay trước
khi đẩy tới thiết bị; Request và Workflow tạo notification bằng service role rồi
dùng trigger Web Push chung hiện có.

Mọi thay đổi Supabase thực hiện trên Supabase Cloud đã liên kết bằng cấu hình trong
`.env`; không dùng Supabase local hoặc Docker.

## 4. Quy tắc người nhận

Người nhận là hợp của các nhóm hợp lệ tại thời điểm sự kiện, sau đó dedupe theo
`user_id` và loại actor, trừ sự kiện bắt buộc hướng chính actor.

| Sự kiện | Người nhận chính | Ghi chú |
| --- | --- | --- |
| Tạo/gửi/giao việc | người thực thi hoặc duyệt bước đầu, watcher | actor bị loại |
| Thêm người thực thi/watcher | người vừa được thêm; các participant hiện tại nếu thay đổi ảnh hưởng họ | người vừa gỡ chỉ nhận sự kiện gỡ nếu cần kết thúc trách nhiệm |
| Chuyển giao | người mới, người cũ, chủ việc và watcher | snapshot người cũ trước khi đóng assignment |
| Cập nhật/bình luận | chủ việc, người thực thi hiện tại, watcher, reviewer hiện tại | người được mention nhận sự kiện mention riêng, không nhận bản bình luận trùng |
| Mention | đúng người được mention | không tự biến thành watcher |
| Chờ duyệt/chuyển bước | reviewer/approver mới, chủ việc và watcher | snapshot bước/node/block vào payload |
| Chấp thuận/bổ sung/từ chối/hoàn tất/hủy/mở lại | chủ việc và các participant có liên quan tại thời điểm chuyển trạng thái | gồm assignee vừa kết thúc nếu kết quả liên quan trực tiếp |
| Sắp đến hạn/quá hạn | người đang chịu trách nhiệm, chủ việc và watcher | chỉ khi có mốc hạn authoritative; quản lý chỉ nhận escalation được cấu hình |

Các điều kiện chung:

- User phải active và còn quyền xem đối tượng ở lúc tạo in-app notification.
- Trước lúc Web Push được claim, Work kiểm tra lại subscription, quyền và quan hệ;
  Workflow/Request không tạo notification nếu recipient đã hết điều kiện.
- Assignment/participant đã kết thúc không nhận các sự kiện tương lai. Riêng sự
  kiện kết thúc/chuyển giao dùng recipient snapshot trong chính giao dịch đó.
- Một `event_key + user_id + channel` chỉ được giao một lần. Retry không tạo bản
  sao mới; các sự kiện khác nhau không bị gom mất chỉ vì xảy ra gần nhau.
- Mute chỉ áp dụng sự kiện thường. Giao trách nhiệm mới, mention, chờ duyệt, yêu
  cầu bổ sung và nhắc hạn của chính người chịu trách nhiệm là bắt buộc.

## 5. Hợp đồng nội dung preview

Mỗi notification phải có đủ:

- `title`: mã đối tượng và trạng thái/hành động ngắn; tối đa 100 ký tự.
- `message`/`body`: tên actor hoặc “Hệ thống”, động từ nghiệp vụ, tên đối tượng và
  ngữ cảnh bước/hạn khi có; tối đa 220 ký tự.
- `source_type`, `source_id`, `entity_type`, `entity_id`: định danh canonical.
- `metadata`: `eventType`, `eventKey`, mã/tên đối tượng, actor, node/block/comment
  anchor và cờ mandatory; không chứa token, URL ký, HTML hoặc nội dung file.
- `link`: route nội bộ dùng trong app, bắt đầu bằng `/`.
- `action_url`: route hash dùng cho Web Push, bắt đầu bằng `/#/`.

Ví dụ:

- `VW-2026-000123 · Chờ bạn duyệt` — `Nguyễn Văn An đã gửi “Hoàn thiện BOQ” để duyệt.`
- `WF-2026-042 · Đã chuyển bước` — `Trần Minh đã duyệt “Đề nghị mua máy” và chuyển tới bước Kế toán.`
- `RQ-2026-018 · Cần bổ sung` — `Lê Hoa yêu cầu bổ sung “Đề nghị thanh toán”.`
- `VW-2026-000123 · Quá hạn` — `“Hoàn thiện BOQ” đã quá hạn từ 16:30 12/09.`

Preview trên màn hình khóa không đưa nguyên văn bình luận, lý do từ chối, dữ liệu
form hay tên file vì có thể nhạy cảm. Nội dung đủ hiểu nhờ actor + hành động +
mã/tên đối tượng + bước hoặc hạn. Chi tiết đầy đủ chỉ hiện sau khi mở app và vượt
qua kiểm tra quyền.

## 6. Hợp đồng deeplink

| Đối tượng | `link` trong app | `action_url` cho Web Push |
| --- | --- | --- |
| Work task | `/work/tasks/{taskCode}?comment={commentId}` | `/#/work/tasks/{taskCode}?comment={commentId}` |
| Workflow instance | `/wf?instanceId={id}&nodeId={nodeId}&commentId={commentId}` | `/#/wf?instanceId={id}&nodeId={nodeId}&commentId={commentId}` |
| Request instance | `/rq/{id}?block={blockKey}&event={eventId}` | `/#/rq/{id}?block={blockKey}&event={eventId}` |

Các query chỉ xuất hiện khi có giá trị. ID/code phải được encode. Service worker chỉ
điều hướng route cùng origin. Màn hình đích đọc anchor, mở đúng bản ghi và highlight
bình luận/bước/block; nếu anchor đã bị xóa thì vẫn mở detail thay vì màn hình trắng.
Nếu không còn quyền, màn hình trả trạng thái không có quyền/không còn tồn tại và
không lộ preview chi tiết bổ sung.

## 7. Quy tắc theo module

### Work

- Giữ event outbox, delivery table và push job hiện có.
- Thay builder nội dung chung chung bằng builder theo `event_type` và actor.
- Watcher nhận cả sắp đến hạn/quá hạn; bỏ coalescing làm mất các event khác nhau.
- Trước khi bật gate, quarantine backlog trước thời điểm rollout để không gửi hàng
  loạt thông báo cũ.

### Workflow

- Chuyển tạo notification khỏi `WorkflowContext.tsx` sang transaction backend.
- Các command tạo, xử lý bước, cập nhật watcher, hủy và mở lại phải ghi outbox cùng
  giao dịch; comment trigger ghi event comment/mention có `commentId`.
- Worker mới claim/deliver có retry, event key duy nhất và kiểm tra recipient trước
  khi insert notification.
- Workflow thuộc Request không được gửi thêm từ pipeline Workflow; Request pipeline
  là authority để tránh thông báo kép.

### Request

- Giữ request outbox/worker, chuẩn hóa event type theo hành động thực tế thay vì
  `REQUEST_ACTION_APPLIED` chung chung.
- Fan-out lifecycle cho watcher snapshot đang active; chỉ pending approver của bước
  hiện tại nhận việc cần xử lý.
- Dùng `notification_config` cho ngưỡng nhắc hạn/tùy chọn thường; các sự kiện bắt
  buộc không được tắt bằng cấu hình mẫu.

## 8. Bảo mật và tính đúng đắn

- React không được tự insert notification mang `source_type` Work/Workflow/Request.
- Helper privileged đặt trong `app_private`, `security definer set search_path=''`,
  revoke PUBLIC/anon/authenticated và chỉ expose wrapper tối thiểu cho worker.
- Không nới quyền đọc đối tượng vì notification. Mọi deeplink tái kiểm tra RLS/RPC.
- Chặn notification giả mạo theo ba source type bằng trigger/guard chuyên biệt;
  chưa thu hồi insert toàn bảng vì các module cũ còn dùng notification service.
- Không log endpoint push, key đăng ký, raw comment/form hoặc provider body.

## 9. Tiêu chí nghiệm thu

1. Mỗi event trong ma trận tạo đúng một in-app notification cho từng recipient hợp
   lệ, không gửi actor và không gửi outsider/inactive/participant đã kết thúc.
2. Watcher active nhận lifecycle và nhắc hạn; mention-only không nhận các event sau
   nếu chưa được thêm làm participant.
3. Preview cho biết actor + hành động + mã/tên + bước/hạn khi có; không có câu chung
   chung và không lộ nguyên văn dữ liệu nhạy cảm.
4. Bấm push khi app đóng, app đang ở route khác và app đã mở đều tới đúng detail;
   comment/node/block được focus, anchor mất thì fallback detail.
5. Retry không nhân đôi; subscription 404/410 bị vô hiệu hóa; quyền/quan hệ bị thu
   hồi trước lúc gửi khiến job bị suppress.
6. Work backlog trước rollout không được gửi; rollout có canary, số liệu delivered/
   suppressed/failed và rollback gate rõ ràng.

## 10. Triển khai theo checkpoint

1. Hợp đồng nội dung/deeplink và test ma trận.
2. Work preview, watcher/reminder và xử lý backlog, vẫn giữ gate tắt.
3. Workflow outbox + worker + command backend; xóa notification orchestration ở React.
4. Request event mapping, watcher fan-out và reminder.
5. Hoàn thiện anchor ở ba màn hình đích và guard chống giả mạo.
6. Cloud canary, theo dõi, mở rộng và ghi rollout evidence.

Mỗi checkpoint có failing test trước, Cloud transaction rollback smoke trước apply,
và không trộn các thay đổi đang có ở `CheckIn.tsx`/procurement vào commit.
