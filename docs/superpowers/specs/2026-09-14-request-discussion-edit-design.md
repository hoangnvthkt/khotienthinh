# Đặc tả Thảo luận và chỉnh sửa đề xuất

Ngày: 14/09/2026. Trạng thái: **Người dùng đã duyệt thiết kế trong hội thoại ngày 14/09/2026; chờ người dùng review tài liệu trước khi lập implementation plan**.

Phạm vi: Module Yêu cầu (`/rq`) và chi tiết đề xuất (`/rq/:requestId`). Tài liệu này độc lập với đặc tả Mua hàng & Cung ứng; workbench mua hàng chỉ đọc kết quả nguồn theo hợp đồng dữ liệu đã có.

## 1. Mục tiêu

1. Bổ sung khu **Thảo luận** ở chi tiết đề xuất, hỗ trợ bình luận, trả lời, `@mention`, đính kèm tệp và hình ảnh.
2. Cho người tạo sửa thông tin đề xuất khi trạng thái là `PENDING` hoặc `RETURNED`.
3. Nếu sửa khi `PENDING`, hủy các lượt duyệt hiện tại và chạy lại quy trình từ bước đầu để mọi quyết định gắn với đúng phiên bản nội dung.
4. Nâng chất lượng UI theo tham chiếu modal tạo đề xuất của Base: phân cấp rõ, màu có chủ đích, biểu mẫu dễ quét, không đè chữ và không xuống dòng bất thường.

Không mở lại đề xuất `APPROVED`, `REJECTED` hoặc `CANCELLED`. Không dùng mention để cấp quyền. Không xây hệ chat thời gian thực, reaction, gọi thoại, presence hoặc chia sẻ ra ngoài công ty trong phạm vi này.

## 2. Hiện trạng và quyết định kiến trúc

Hiện trạng repository đã đối chiếu:

- `RequestDetailPanel.tsx` hiển thị nội dung, dữ liệu biểu mẫu, tiến trình duyệt và timeline nhưng chưa có composer thảo luận.
- `requestRuntimeService.ts` chỉ có submit, action, list, detail và summary; chưa có command sửa nội dung hoặc API bình luận.
- `request_instances` đã có RLS đọc theo `app_private.request_instance_can_select` và có snapshot template/workflow.
- Module Công việc đã có mention document, feed cursor và upload private theo luồng reservation, processing, signed URL. Đây là mẫu kỹ thuật để tái sử dụng primitive, không phải bảng dữ liệu dùng chung.
- `RequestCreateDialog.tsx` có nhiều khối form trong một cột và dùng lẫn emerald/violet/slate; file field vẫn là placeholder. Layout cần được kiểm tra lại khi triển khai editor.

Ba phương án đã xem xét:

1. Mở rộng cộng tác riêng cho Module Yêu cầu. **Được chọn.** Dữ liệu có vòng đời và quyền đúng theo đề xuất, đồng thời có thể tái sử dụng component/primitives của module Công việc.
2. Tạo một công việc ẩn cho mỗi đề xuất để dùng bảng thảo luận Công việc. Loại vì tạo coupling sai nghiệp vụ và làm quyền, lưu trữ, xóa dữ liệu khó kiểm soát.
3. Xây collaboration engine đa module ngay. Loại vì tăng phạm vi và rủi ro chuyển đổi không cần thiết.

## 3. Nguyên tắc UI được duyệt

### 3.1. Design read

Đây là redesign bảo tồn của ứng dụng B2B nội bộ cho người dùng nghiệp vụ, dùng ngôn ngữ trực quan rõ ràng và sinh động theo tham chiếu Base, trên hệ Tailwind hiện hữu.

- `DESIGN_VARIANCE: 3`: cấu trúc ổn định, nhãn và trường thẳng hàng, không trang trí bất đối xứng gây khó quét.
- `MOTION_INTENSITY: 2`: chỉ transition cho hover, focus, mở modal và phản hồi thao tác; tôn trọng reduced motion.
- `VISUAL_DENSITY: 7`: đủ dày cho nghiệp vụ nhưng có phân nhóm, khoảng thở và sticky action hợp lý.

Taste skill không chuyên cho dashboard và form nghiệp vụ. Khi triển khai chỉ áp dụng phần audit, typography, màu, form, responsive và pre-flight phù hợp; không đưa pattern landing page vào Module Yêu cầu.

### 3.2. Hướng thị giác

- Giữ nhận diện xanh lá của TEN THINH làm màu hành động chính và trạng thái thành công. Tím chỉ dùng cho hành động phụ có ý nghĩa riêng nếu design token hiện hành yêu cầu; không trộn hai màu như hai CTA cạnh tranh.
- Nền trung tính sáng, header xám rất nhạt và một dải hướng dẫn xanh nhạt giống tinh thần tham chiếu Base. Màu phải biểu đạt cấp độ hoặc trạng thái, không tô mọi card cùng một kiểu.
- Quy tắc hình khối: modal/card 12-16 px, input 8 px, nút 8 px; pill chỉ dùng cho status hoặc filter.
- Dùng font ứng dụng hiện tại để không phá toàn hệ thống. Phân cấp bằng size, weight, line-height và độ tương phản; không thay font cục bộ trong riêng modal.
- Label luôn ở trên hoặc ở cột trái đủ rộng; không dùng placeholder thay label. Helper text ở dưới label hoặc input, error ở ngay dưới trường.
- Không dùng uppercase tracking dày đặc. Tiêu đề nhóm dùng sentence case tiếng Việt để giảm cảm giác template máy móc.

### 3.3. Layout modal tạo và sửa

Desktop từ 1024 px:

- Modal rộng tối đa 920 px, cao tối đa 92dvh, header và footer sticky; phần thân scroll độc lập.
- Header có tiêu đề, mô tả ngắn và nút đóng. Dải hướng dẫn hoặc mô tả mẫu nằm ngay dưới header khi có nội dung hữu ích.
- Form cơ bản dùng grid `220px minmax(0, 1fr)`: nhãn/helper bên trái, control bên phải. Trường bảng và khối phức tạp chiếm toàn chiều rộng.
- Footer có tối đa hai hành động chính: `Hủy` và `Gửi đề xuất`, hoặc `Hủy` và `Lưu thay đổi`. Với `PENDING`, nút lưu mở confirmation về việc chạy lại phê duyệt.

Tablet và mobile dưới 1024 px:

- Chuyển thành một cột. Dưới 768 px modal thành full-screen sheet, dùng `min-height: 100dvh`, padding ngang 16 px và safe-area cho footer.
- Nút footer không được xuống dòng; nếu không đủ chiều rộng thì xếp dọc, primary ở vị trí dễ chạm.
- Bảng động dùng một trong hai chế độ có kiểm thử: horizontal scroll với cột đầu sticky, hoặc mỗi dòng chuyển thành field group dạng card. Không co chữ đến mức khó đọc.

Quy tắc chống vỡ layout:

- Mọi flex/grid child chứa text động phải có `min-w-0` và chiến lược rõ: `truncate` kèm title/tooltip cho metadata một dòng, hoặc `break-words` cho nội dung dài.
- Tên người, tên mẫu và tên tệp không được đè lên icon/nút. Vùng action dùng `shrink-0`; vùng text dùng `minmax(0, 1fr)`.
- Nút desktop luôn một dòng. Nhãn dài được rút gọn hoặc tăng chiều rộng, không ép wrap.
- Kiểm thử tại 320, 375, 768, 1024, 1280 và 1536 px; kiểm thêm zoom 200%, chuỗi tiếng Việt dài không có khoảng trắng, tên tệp dài và người dùng có tên dài.

### 3.4. Trạng thái giao diện

- Loading dùng skeleton theo đúng hình dạng form/feed thay vì spinner duy nhất.
- Empty state của thảo luận hiển thị lời mời hành động ngắn và composer nếu có quyền.
- Lỗi field hiển thị inline; toast chỉ dùng cho thành công hoặc lỗi tác vụ không gắn được vào một trường.
- Focus visible, keyboard navigation, label association và contrast phải đạt WCAG AA ở light/dark mode.
- Không dùng animation liên tục. Mở modal, upload progress và trạng thái thành công chỉ dùng transform/opacity ngắn, có reduced-motion fallback.

## 4. Thảo luận

### 4.1. Trải nghiệm

Khối **Thảo luận** nằm sau nội dung biểu mẫu trong cột chính của chi tiết đề xuất. Desktop mở sẵn; mobile có thể thu gọn nhưng deep link đến bình luận phải tự mở và cuộn đúng anchor.

Composer gồm avatar và tên người hiện tại, textarea, nút tệp, nút ảnh và nút đăng. Gõ `@` mở picker theo debounce. Picker chỉ trả người dùng đang hoạt động và được backend xác nhận có quyền xem đề xuất.

Feed hiển thị mới nhất trước và có cursor tải bình luận cũ hơn. Mỗi item gồm tác giả, thời gian, nội dung, attachment và action được phép. Hỗ trợ một cấp reply trong UI; dữ liệu vẫn lưu `parent_comment_id` để deep link chính xác. Tác giả được sửa bình luận của mình; nội dung hiển thị nhãn `đã sửa` và sự kiện audit, không xóa lịch sử bằng chứng.

Các sự kiện chính của đề xuất như tạo, sửa nội dung, gửi lại, chấp thuận, trả lại, từ chối và hủy có thể xuất hiện xen trong feed với presentation khác bình luận. Sự kiện không được tính vào số **N thảo luận**.

### 4.2. Mô hình dữ liệu

Tạo forward migration bằng Supabase CLI cho các bảng sau:

```text
request_comments
  id uuid primary key
  request_id uuid not null references request_instances(id) on delete cascade
  parent_comment_id uuid null references request_comments(id)
  author_user_id uuid not null references users(id)
  content_document jsonb not null
  content_text text not null
  lock_version integer not null default 1
  created_at timestamptz not null
  edited_at timestamptz null
  deleted_at timestamptz null

request_comment_mentions
  comment_id uuid not null references request_comments(id) on delete cascade
  mentioned_user_id uuid not null references users(id)
  created_at timestamptz not null
  primary key (comment_id, mentioned_user_id)

request_attachments
  id uuid primary key
  request_id uuid not null references request_instances(id) on delete cascade
  comment_id uuid null references request_comments(id) on delete set null
  uploader_user_id uuid not null references users(id)
  kind text not null check (kind in ('discussion_file','discussion_image'))
  file_name text not null
  mime_type text not null
  size_bytes bigint not null
  storage_path text not null unique
  status text not null check (status in ('pending','processing','ready','failed'))
  variants jsonb not null default '{}'
  upload_expires_at timestamptz not null
  created_at timestamptz not null
  deleted_at timestamptz null
```

Index bắt buộc phục vụ cursor `(request_id, created_at desc, id desc)`, reply lookup, mention recipient và cleanup attachment theo status/expiry.

Rich text dùng schema allowlist tương thích primitive của Work: paragraph, text và mention. Server sanitize/normalize, tự derive `content_text` và mention IDs từ document; không tin mảng mention riêng từ client.

### 4.3. API và command

Public entrypoints là security invoker wrappers; privileged implementation ở schema private, `search_path = ''` và lấy actor từ session:

```text
list_request_comments(request_id, cursor, limit)
list_request_activity_feed(request_id, cursor, limit)
list_request_mention_candidates(request_id, search, cursor, limit)
command_request_comment(command, payload, idempotency_key)
command_request_attachment(command, payload, idempotency_key)
```

`list_request_comments` là nguồn bình luận thuần cho reply/anchor và đếm thảo luận. `list_request_activity_feed` trả projection cursor ổn định hợp nhất bình luận với các event request được allowlist; hai loại item có discriminated type để UI không đoán theo field. Projection không nhân đôi comment event và không đưa before/after nhạy cảm ra client.

`command_request_comment` dùng allowlist `create`, `reply`, `edit`. Create/reply gắn các attachment reservation đã `ready` vào comment trong cùng transaction. Edit yêu cầu tác giả, `expected_lock_version`, không cho đổi `request_id`, author hoặc parent.

Attachment dùng bucket private `request-attachments` và luồng:

1. `begin`: kiểm quyền, tên, MIME khai báo, dung lượng và tạo reservation 15 phút với path server sinh.
2. Client upload `upsert: false` đúng path reservation.
3. Worker/finalize kiểm MIME thực và chữ ký file, xử lý ảnh, xóa EXIF, tạo thumbnail/display/fallback theo khả năng hiện hành.
4. `read`: kiểm lại quyền đề xuất và phát signed URL ngắn hạn; không persist URL.
5. Cleanup xóa object reservation hết hạn, failed hoặc không gắn comment sau TTL.

Giới hạn được duyệt: ảnh tối đa 5 MiB; tệp khác tối đa 25 MiB. Allowlist tệp ban đầu gồm PDF, DOC/DOCX, XLS/XLSX, TXT và các định dạng ảnh JPEG, PNG, WebP. SVG, HTML, executable và MIME không xác định bị từ chối. Nếu hạ tầng scan malware chưa sẵn sàng, file chưa scan phải được tải xuống với `Content-Disposition: attachment`; không render active content inline.

## 5. Quyền và bảo mật

- Bật RLS trên mọi bảng mới trong exposed schema. `authenticated` chỉ được grant đúng thao tác cần thiết; ghi nghiệp vụ đi qua command.
- Đọc bình luận/attachment yêu cầu `request_instance_can_select(request_id, current_user)` tại thời điểm truy cập.
- Bình luận yêu cầu user đang hoạt động và có quyền xem. Mention không tạo watcher, assignment, participant hoặc grant.
- Mention candidate query không trả người không có quyền xem, kể cả khi search khớp tên. Deep link kiểm quyền lại khi mở và dùng thông báo không phân biệt missing/forbidden.
- Attachment path, filename và signed URL không được xuất hiện trong notification payload cho recipient chưa qua authorization.
- Service role không được đưa vào frontend. Storage policy chỉ chấp nhận operation upload theo reservation và không cho list bucket trực tiếp.
- Mọi event/notification lấy actor ở server; không dùng `user_metadata`, actor ID từ client hoặc vai trò `ADMIN` hard-code làm bypass.

## 6. Chỉnh sửa đề xuất

### 6.1. Điều kiện

Capability chi tiết bổ sung `canEditContent`. Giá trị chỉ true khi:

- actor là `created_by` của đề xuất và tài khoản đang hoạt động;
- actor vẫn có quyền xem đề xuất;
- trạng thái hiện tại thuộc `PENDING` hoặc `RETURNED`.

`APPROVED`, `REJECTED` và `CANCELLED` luôn khóa. Không có ngoại lệ UI hoặc backend cho System Admin trong command này. Quyền quản trị có thể xem/audit nhưng không giả danh người tạo để sửa nội dung.

Cho sửa `title`, `description` và `form_data`. Không cho đổi template/version, workflow snapshot, creator, company, watcher snapshot hoặc người duyệt đã chọn. Dữ liệu mới phải validate bằng frozen `form_schema` của request template version.

### 6.2. Command nguyên tử

Thêm command:

```text
update_request_content(
  request_id,
  title,
  description,
  form_data,
  expected_updated_at,
  idempotency_key
) -> request command result
```

Server phải:

1. Resolve actor từ session, khóa `request_instances` và kiểm idempotency payload hash.
2. Kiểm creator, trạng thái, quyền xem và `expected_updated_at`.
3. Validate title/form data theo schema snapshot.
4. Ghi revision với before/after allowlist, actor, correlation key và thời gian.
5. Cập nhật nội dung và `updated_at`.
6. Xử lý trạng thái theo mục 6.3 trong cùng transaction.
7. Ghi domain event/outbox. Bất kỳ lỗi nào rollback toàn bộ.

### 6.3. Hành vi theo trạng thái

`RETURNED`:

- Lưu nội dung mới, giữ trạng thái `RETURNED`.
- Không tự gửi lại. Người tạo kiểm tra xong và dùng action `RESUBMIT` hiện có.
- Resubmit tiếp tục validate `form_data`, hủy pending còn sót nếu có và tạo round mới theo workflow snapshot.

`PENDING`:

- UI bắt buộc hiển thị confirmation rằng các lượt duyệt hiện tại sẽ bị hủy và quy trình chạy lại từ đầu.
- Backend đánh dấu toàn bộ assignment `PENDING` của round hiện hành là `CANCELLED` với reason `REQUEST_CONTENT_REVISED`.
- Các assignment đã `APPROVED`/`RETURNED`/`REJECTED` không bị rewrite; chúng ở lại lịch sử và được liên kết revision cũ.
- Tạo workflow round mới từ block đầu theo frozen workflow/template snapshot. Dùng cùng danh sách approver động đã chọn khi submit; revalidate họ vẫn active, cùng company và hợp lệ. Fixed/direct-manager resolver chạy lại theo hợp đồng workflow hiện hành để không giao cho tài khoản đã mất hiệu lực.
- Nếu không resolve đủ approver hợp lệ, command thất bại và nội dung cũ cùng round cũ được giữ nguyên.
- Trạng thái request vẫn là `PENDING`; due/SLA của round mới tính lại từ thời điểm restart theo snapshot.

Mỗi approval assignment và request event phải mang hoặc truy được `request_revision`. Người duyệt nhìn thấy revision hiện tại và cảnh báo nếu màn hình của họ đã cũ. `act_on_request` tiếp tục kiểm `expected_updated_at`, assignment đang active và revision khớp trước khi nhận quyết định.

## 7. UI chỉnh sửa

- Nút **Sửa đề xuất** nằm trong action area của chi tiết và chỉ render khi server trả `canEditContent`.
- Editor tái sử dụng cùng renderer/validator form với create dialog. Trước triển khai cần tách `RequestFormFields` dùng chung; không copy một bộ field thứ hai.
- Khi mở, editor dùng snapshot vừa tải. Nếu detail refresh đổi `updatedAt` trong lúc editor có dirty data, giữ draft nhưng hiển thị cảnh báo và vô hiệu Save cho đến khi người dùng chọn tải bản mới hoặc hủy.
- Với `PENDING`, confirmation tóm tắt tác động bằng nội dung trực tiếp, không dùng cảnh báo mơ hồ. Primary label là `Lưu và duyệt lại`; secondary là `Tiếp tục chỉnh sửa`.
- Với `RETURNED`, primary label là `Lưu thay đổi`; sau thành công action `Gửi lại` vẫn tách riêng.
- Sau save thành công, detail, approval inspector, timeline và discussion feed refresh theo response revision. Không optimistic-update trạng thái phê duyệt trước khi server trả kết quả.

## 8. Thông báo và feed sự kiện

Domain event trong transaction ghi outbox, worker resolve recipient và dedupe:

```text
request.comment.created
request.comment.mentioned
request.attachment.ready
request.content.revised
request.approval.restarted
```

- Mention gửi người được mention; notification deep link `/rq/:requestId?comment=:commentId`.
- Comment/reply thông thường có thể gửi creator, active approver và watcher theo preference; không gửi cho mọi người có quyền module.
- `request.approval.restarted` gửi các approver bị hủy và approver round mới, nội dung nêu đề xuất đã thay đổi và quyết định cũ không còn hiệu lực.
- Mention trực tiếp và nhiệm vụ phê duyệt mới không bị tắt bởi preference cho activity thông thường.
- Khi recipient mất quyền trước lúc mở, notification có thể còn tồn tại nhưng deep link trả missing/forbidden thống nhất và không lộ nội dung.

## 9. Lỗi và phục hồi

- `REQUEST_STALE_STATE`: nội dung hoặc approval đã đổi; giữ draft cục bộ, yêu cầu tải bản mới và không tự merge dữ liệu biểu mẫu.
- `REQUEST_EDIT_FORBIDDEN`: không đúng creator hoặc mất quyền.
- `REQUEST_EDIT_STATUS_LOCKED`: trạng thái đã thành terminal.
- `REQUEST_EDIT_APPROVER_INVALID`: không thể dựng round mới; transaction rollback và chỉ rõ cần quản trị cập nhật tài khoản/người quản lý.
- `REQUEST_COMMENT_DENIED`, `REQUEST_COMMENT_STALE`, `REQUEST_MENTION_INVALID`: lỗi bình luận/mention, không làm mất composer draft.
- `REQUEST_ATTACHMENT_TOO_LARGE`, `REQUEST_ATTACHMENT_TYPE_INVALID`, `REQUEST_ATTACHMENT_EXPIRED`, `REQUEST_ATTACHMENT_BUSY`: lỗi theo từng file; các file khác và nội dung bình luận được giữ.
- Mất response sau command: retry cùng idempotency key và cùng payload trả cùng kết quả. Cùng key khác payload bị từ chối.
- Realtime chỉ là tín hiệu refresh. API/RPC và RLS vẫn là authority; không tin payload realtime để render nội dung chưa authorize.

## 10. Kiểm thử và nghiệm thu

### 10.1. Domain và API

- Validate document, derive mention, reply depth, edit ownership và lock version.
- Cursor ổn định khi nhiều comment cùng timestamp; không duplicate/missing khi tải thêm.
- Idempotency create/edit/comment/upload và conflict payload.
- Edit `RETURNED` giữ trạng thái; edit `PENDING` hủy round cũ và dựng round mới; terminal statuses bị chặn.
- Một approver chấp thuận đồng thời với creator edit: chỉ một transaction thắng; transaction thua trả stale và không có side effect rời.
- Approver động inactive hoặc direct manager không resolve: edit rollback toàn bộ.
- Quyết định duyệt từ revision cũ bị từ chối.

### 10.2. RLS, Storage và thông báo

- Creator, active approver, watcher và user không liên quan theo ma trận quyền request hiện hữu.
- Mention search không rò tên user ngoài phạm vi; mention ID giả bị backend từ chối.
- Signed URL chỉ cấp khi còn quyền; URL hết hạn; bucket không list/public; path reservation không thể đổi request.
- MIME khai báo khác chữ ký, oversize, SVG/HTML/executable và object hết hạn đều bị chặn/cleanup.
- Outbox rollback cùng command; dedupe notification; deep link cuộn đúng comment và kiểm quyền lại.

### 10.3. UI và accessibility

- Create/edit dùng một renderer, giữ giá trị field động và hiển thị error đúng trường.
- Composer keyboard mention: Arrow, Enter, Tab, Escape, Backspace token; screen reader có label/listbox state.
- Upload nhiều file: progress, một file lỗi, retry và không mất draft.
- Visual regression light/dark tại 320, 375, 768, 1024, 1280 và 1536 px; zoom 200%.
- Không overlap/clipping với tên người, tên mẫu, tiêu đề, helper/error, button và filename dài. CTA desktop không wrap.
- Modal/footer dùng `100dvh`/safe area trên mobile; keyboard không che field đang focus hoặc nút lưu.
- Contrast, focus order, focus trap, Escape/close confirmation khi form dirty và reduced motion.

### 10.4. Supabase Cloud

Mọi kiểm chứng schema/RPC/RLS/Storage dùng Supabase Cloud theo `.env`, không dùng local Supabase hoặc Docker. Trước command thay đổi schema phải xác nhận đúng project ref và môi trường test, tạo migration bằng CLI, chạy smoke với transaction/cleanup, advisors và inventory migration. Không mở feature flag trên production chỉ từ unit test frontend.

## 11. Triển khai và rollback

Feature gates tách biệt:

```text
request_discussion_read
request_discussion_write
request_attachments
request_content_edit
```

Thứ tự mở: read, discussion write, attachments, content edit. Tắt gate write không làm mất quyền đọc dữ liệu đã tạo. Tắt content edit chỉ ẩn/chặn lệnh sửa mới; không đảo revision hoặc khôi phục approval round cũ.

Rollback ứng dụng về bản chưa có UI mới vẫn phải giữ bảng, object và audit. Không drop bảng hoặc xóa attachment để rollback. Cleanup chỉ xử lý reservation mồ côi theo TTL, không xóa attachment `ready` đã gắn comment.

## 12. Tiêu chí hoàn tất

Tính năng hoàn tất khi:

- Người có quyền có thể bình luận, reply, mention, đính kèm ảnh/tệp và mở đúng deep link.
- Người tạo sửa được `PENDING`/`RETURNED`; không sửa được trạng thái terminal.
- Edit `PENDING` restart phê duyệt nguyên tử, audit truy được revision và quyết định cũ không thể áp vào revision mới.
- RLS/Storage/notification không làm rò user, nội dung, filename hoặc object path.
- UI đạt kiểm thử responsive/accessibility, không còn lỗi chữ đè, CTA wrap hoặc bố cục vỡ ở các viewport đã nêu.
- Test Cloud, unit, integration và UI liên quan pass; rollout log ghi project ref đã che, migration, commit, case evidence và rollback result.
