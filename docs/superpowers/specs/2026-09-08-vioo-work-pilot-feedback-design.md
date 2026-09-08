# Vioo Work — Điều chỉnh sau trải nghiệm pilot

Ngày: 2026-09-08. Trạng thái: **đề xuất thiết kế để duyệt**.

Hai bản sửa refresh và tạo Workspace đã được thực hiện trong worktree
`feature/vioo-work-r1a`. Công việc con đầy đủ, preview tài liệu, mention trong dòng
và bố cục mới dưới đây chưa được nối vào sản phẩm. Đây là thiết kế và đối chiếu
roadmap, không phải biên bản handoff hay xác nhận nghiệm thu.

## 1. Quyết định của người dùng

- Workspace là nơi làm việc của phòng ban/dự án/nhóm cộng tác; tổ chức là nguồn
  gợi ý người, không tự động đồng bộ quyền thành viên.
- Pilot: admin@khoviet.vn quản trị, sonpn@tienthinhjsc.vn tham gia Phòng Quản lý dự án.
- Lịch: thứ Hai–thứ Bảy, 08:00–12:00 và 13:00–17:00.
- Công việc con có đầy đủ thông tin và khả năng xử lý như một công việc.
- **Cho hoàn thành cha độc lập, chỉ cảnh báo việc con còn mở.** Không tự hoàn
  thành, hủy, chuyển người nhận hoặc sửa deadline của con khi đóng cha.
- Mention được chọn ngay khi gõ `@` trong nội dung trao đổi, không có ô riêng.
- Điều chỉnh theo ảnh tham khảo ở lượt phản hồi tiếp theo: menu tối, danh sách
  việc bên cạnh detail, các nhãn nhẹ theo dòng, nội dung chia khối trên nền xám,
  người giao và watcher ở cột phải. Thêm/bỏ watcher ngay tại detail.
- Hiển thị **Ngày bắt đầu → Ngày kết thúc**; thời điểm hoàn thành thực tế riêng.

## 2. Kết quả kiểm tra tám phản hồi

| Phản hồi | Bằng chứng | Xử lý/trạng thái |
| --- | --- | --- |
| Tab ra/vào bị nhấp nháy | Realtime/focus/poll kích hoạt tải lại; ba hook xóa danh sách trước khi có phản hồi. Revision của Workspace còn bị coi là danh tính truy vấn mới. WorkPage khôi phục vị trí cuộn sau mỗi lần tải. | Đã sửa giữ nội dung cùng truy vấn trong lúc tải, giữ vị trí cuộn, vẫn thay dữ liệu theo kết quả máy chủ. Đổi tài khoản/phạm vi/bộ lọc hoặc nhận lỗi quyền vẫn xóa dữ liệu tương ứng. |
| Chưa có công việc con | Schema và detail hiện có checklist; không có quan hệ cha–con giữa các task. | Đề xuất task đầy đủ với `parent_task_id`; không chuyển checklist hiện có thành task. |
| Preview tệp | WorkAttachments có dialog ảnh display/fallback; bản original chỉ mở/tải ở tab mới. | Mở rộng xem ảnh/PDF/TXT trong trang; giữ tải bản gốc riêng. |
| Mention riêng | WorkDiscussion dùng picker và danh sách mentionedUserIds tách khỏi văn bản. | Thay composer bằng mention token trong nội dung; vẫn giữ ID ổn định, validation và quyền phía máy chủ. |
| UI thiếu phân cấp | Hành động dồn thành hàng; nội dung/trách nhiệm/SLA dài, nhiều mục có cùng độ nhấn. | Bản xem trước và nguyên tắc bố cục tại mục 4. |
| Tạo Workspace báo lỗi chung | UI gửi coverKey `office/site/team`; RPC và constraint chỉ nhận `plain/grid/waves/dots/blueprint/sunrise`. | Đã sửa mặc định department→blueprint, project→sunrise, collaboration→grid. Bổ sung thông báo lỗi nhập liệu và trường hợp cần chuyển dữ liệu cũ. |
| Không thấy thông báo | Cloud lúc 11:19 ngày 08/09 giờ Việt Nam: enabled=false, outbox=15, deliveries=0, pushJobs=0. Cron thông báo đang active mỗi phút. | Đã xác định gate đang tắt; chưa kích hoạt hoặc gửi thử cho tài khoản thật. Cần quyết định xử lý backlog và xác nhận gửi pilot trước khi bật. |
| Roadmap | Task 1–10 và WS1–8 có bằng chứng kỹ thuật; notification/device acceptance và quan sát 48 giờ chưa hoàn tất. | Cập nhật bảng trạng thái hiện tại ở đầu runbook; giữ bằng chứng cũ dưới dạng lịch sử. |

Lỗi tạo Workspace được tái hiện bằng RPC Cloud dưới persona admin trong một
transaction rollback: cùng payload collaboration, `team` bị WORK_INVALID_COMMAND,
`grid` tạo thành công. Không có Workspace thử nghiệm nào được lưu. Đây là kiểm tra
validation dùng chung; không khẳng định đã tạo thật phòng “Khối 1 - Văn phòng”.
Browser fixture trước đây chấp nhận cover bất kỳ nên bỏ sót lỗi này; fixture nay
từ chối cover không thuộc allowlist, và luồng tạo Workspace trong browser đã đạt.

## 3. Công việc con: phương án đề xuất

Ba cách có thể làm: mở rộng checklist (nhẹ nhưng phải xây lại gần hết nhiệm vụ),
tạo bảng công việc con riêng (dễ lệch quyền/SLA/notification), hoặc dùng cùng
`work_tasks` và thêm quan hệ cha–con. Chọn cách thứ ba để dùng lại các command,
assignment, file, lịch sử, SLA và review đã có.

### Dữ liệu và vòng đời

- Thêm `parent_task_id` nullable, khóa ngoại và index vào `work_tasks` bằng
  forward migration. Task hiện có giữ null; không sửa mã task hay lịch sử.
- Đợt đầu hỗ trợ một cấp cha–con. Backend chặn tự tham chiếu, tạo cháu và liên kết
  chéo Workspace/phạm vi. Việc con vẫn có mã task và deep link độc lập.
- Tạo con từ cha còn mở: người tạo phải đọc được cha và có quyền tạo task trong
  phạm vi. Scope và privacy theo cha; tên/mô tả/kết quả/tệp riêng. Ngày bắt đầu và
  kết thúc được điền gợi ý theo cha nhưng có thể sửa. Người nhận/người duyệt/người theo dõi đi qua
  preview và kiểm tra hiện hành. SLA tính tại thời điểm tạo, không sao chép due_at.
- Checklist và quan hệ cha–con là hai khái niệm riêng. Không tự chuyển dữ liệu
  checklist cũ; không sao chép tệp/bình luận của cha vào con.
- Một việc con đã tồn tại tiếp tục nhận việc, chuyển việc, nộp và duyệt kết quả
  khi cha đã hoàn thành. Việc cha không được tự mở lại khi con thay đổi.
- Bấm tích là lối vào hành động hoàn thành theo capability. Nếu cần kết quả thì
  mở hộp nộp kết quả; nếu cần duyệt thì chuyển sang chờ duyệt. Chỉ tô tích xanh khi
  trạng thái thật là `completed`. Không gọi UPDATE trực tiếp hoặc bỏ qua reviewer.
- Task đã hoàn thành không mở lại bằng cách bỏ tích; hiện không có command mở lại.
  Bản xem trước cho phép đổi checkbox để thử bố cục, không mô phỏng hết lifecycle.
- Trước khi thao tác có thể hoàn thành cha (submit auto-complete hoặc review
  approve), hiển thị số việc con còn mở mà người dùng được xem. Cho tiếp tục; cảnh
  báo không là precondition chặn server và không tạo cascade. Server vẫn kiểm tra
  expectedVersion/idempotency/capability hiện hành.

### Quyền và progress

- Quan hệ cha–con không cấp quyền xem task. RPC danh sách con vẫn áp dụng quyền
  Work hiện có; liên kết cha bị ẩn/hiển thị thông báo từ chối nếu người xem thiếu
  quyền cha. Không tải rộng rồi lọc quyền trong trình duyệt.
- Đếm progress ở máy chủ trên tập con được phép xem; không rò tên, số lượng hay
  deadline của task hạn chế. Khi dùng tập được phép xem, nhãn luôn nói rõ
  “các việc con bạn được xem”. Người đọc cha không tự trở thành watcher của con.
- `completed/total`: loại `cancelled` khỏi mẫu số, ghi số bị hủy riêng trong tập
  được xem. `awaiting_review` chưa hoàn thành. Không có con → trạng thái trống,
  không hiển thị 100%. Không suy ra trạng thái cha từ phần trăm này.
- Read con phân trang; aggregate tính cùng bộ lọc quyền, không dựa trên trang
  đầu đang tải. Realtime thay đổi con làm mới progress của cha bằng fetch có quyền.
- Thông báo của con dùng người liên quan trực tiếp của con. Không tự broadcast
  cho mọi thành viên Workspace hoặc mọi người liên quan cha.
- Clone cha ở đợt này chỉ tạo task độc lập theo hành vi clone hiện có, không nhân
  cả cây con; UI phải nói rõ trước khi tạo.

## 4. Bố cục và tương tác

Bản tương tác: [vioo-work-task-detail.html](../../design-previews/vioo-work-task-detail.html).
Khi dev đang chạy: `http://127.0.0.1:5187/docs/design-previews/vioo-work-task-detail.html`.
Toàn bộ nội dung trong bản xem trước là dữ liệu minh họa, không đọc/ghi Cloud.

### Thứ tự ưu tiên

1. Desktop rộng: menu tối ngoài cùng; danh sách việc chia tuần, trạng thái và tag
   trong cột kế tiếp; detail ở giữa; người giao, watcher và lịch sử bên phải.
   Chọn việc vẫn giữ bộ lọc/vị trí danh sách. Dòng đang chọn có nền tím rất nhạt.
2. Đầu detail: nhãn nhỏ, tên việc lớn, Workspace/nhóm việc, cặp ngày dự kiến,
   hoàn thành thực tế. Một hàng hành động chính theo capability nằm dưới thông
   tin này: Nhận việc, Bắt đầu, Nộp kết quả, Duyệt hoặc Hoàn thành; avatar và tên
   người thực hiện đặt ngay bên cạnh. Tác vụ phụ nằm trong menu, hủy có xác nhận.
3. Các khối độc lập theo thứ tự: Mô tả công việc → Kết quả công việc → Công việc
   con → Trao đổi. File đặt ở đúng khối đầu vào/kết quả; discussion giữ bản nháp,
   lazy load theo lúc mở/đi vào vùng đọc và không reset khi background refresh.
4. Việc con: thanh progress gọn cạnh tiêu đề, dòng có checkbox trạng thái, tên
   bấm mở detail, người phụ trách, lịch và số tệp; nút thêm ở đầu và cuối danh sách.
5. Cột phải: người giao, watcher có thao tác thêm/bỏ, reviewer/chế độ duyệt,
   lịch/SLA, thời điểm tạo/cập nhật, lịch sử thu gọn. Tên người cùng avatar.
6. Tablet thu menu và danh sách thành nút mở; mobile detail một cột, giữ cặp ngày
   và người nhận gần tiêu đề, watcher/thông tin phụ mở qua “Người tham gia”.
   Vẫn xem được danh sách từ sheet, không cố nén bốn cột vào màn hình nhỏ.

Nền xám nhạt, khối nội dung trắng, viền mảnh và bo góc nhỏ theo ảnh tham khảo.
Xanh lá dùng cho hành động/trạng thái hoàn thành; xanh lam nhẹ cho link ngày và
tag Workspace, xám cho nhãn thường, hổ phách cho mức quan trọng, đỏ cho lỗi/quá hạn.
Luôn kèm nhãn hoặc biểu tượng, không dùng màu làm dấu hiệu duy nhất.
Giữ font/token Vioo hiện có, icon cùng bộ lucide-react, không thêm thư viện UI.

Bản xem trước có thể thử: mở detail con, mở form con, tích thử tiến độ, hoàn thành
cha với con đang mở, thêm/bỏ watcher, sửa cặp ngày, gõ @ chọn tên và mở vùng xem
tệp. Có tìm danh sách, sheet danh sách/người tham gia trên màn hình nhỏ. Các dòng
việc khác mở thông tin minh họa; detail chính chỉ mô phỏng việc nghiệm thu. Form
con không lưu; PDF/TXT dùng tài liệu mẫu. Nghiệp vụ thực vẫn phải đi qua server.

### Ngày bắt đầu, ngày kết thúc và thời gian thực tế

- Ngày bắt đầu là **ngày dự kiến** do người dùng chọn. Cần thêm trường
  `planned_start_at` nullable và contract `plannedStartAt` ở create/detail/update.
  `started_at` hiện có là thời điểm command `start` chạy, giữ nguyên ý nghĩa đó.
- Ngày kết thúc là **hạn dự kiến**, dùng `deadline_at`/`deadlineAt` hiện có, đổi
  nhãn ở cả form cha/con và detail. `completed_at` ghi thời điểm hoàn thành thực
  tế, không thay cho deadline. Việc chưa xong hiển thị “Chưa hoàn thành”.
- Cả hai mốc dự kiến có thể để trống như deadline hiện tại. Nếu nhập cả hai thì
  kết thúc phải bằng hoặc sau bắt đầu; validation ở client và server. Dữ liệu cũ
  không tự suy đoán ngày bắt đầu từ `created_at` hoặc `started_at`.
- Form hiển thị giờ Việt Nam, lưu thời điểm UTC. Clone chỉ gợi ý lịch theo hành
  vi clone và yêu cầu kiểm tra mốc quá hạn; không sao chép thời gian thực tế.
- Sửa lịch chỉ cho người tạo hoặc quản lý có `work.task.manage_scope` tại đúng
  phạm vi và đang đọc được việc; task terminal không sửa qua UI này. Bổ sung
  capability `canManageSchedule` do server tính và command có expectedVersion,
  idempotency, audit before/after và outbox. Không UPDATE trực tiếp từ client.
- Ngày bắt đầu dự kiến không tự kích hoạt command start, không viết lại SLA
  snapshot và không chặn nhận việc trước ngày dự kiến. Ngày kết thúc vẫn là đầu
  vào nhắc hạn/quá hạn. Đóng cha không viết lại bất kỳ mốc ngày nào của con.

### Thêm/bỏ người theo dõi trong detail

- Hiện tại có `watcherUserIds` lúc tạo và danh sách watcher trong detail; chưa
  có command quản lý watcher sau tạo. Bổ sung picker tìm người có quyền tham gia
  task, hiển thị tên/avatar và số người đang theo dõi; dedupe theo user ID.
- Người tạo hoặc quản lý có `work.task.manage_scope` đúng phạm vi và quyền đọc
  được thêm/bỏ watcher. Thành viên chỉ có quyền xem hoặc thực hiện không mặc nhiên
  được thay watcher. Server trả capability `canManageWatchers`.
- Workspace: chọn tài khoản nội bộ đang hoạt động, là thành viên hợp lệ và đủ
  canonical permission. Direct: áp dụng ranh giới người nhận trực tiếp hiện có.
  Task hạn chế kiểm tra quyền quản lý người tham gia trước khi cấp quan hệ watcher.
- Command thêm/bỏ theo diff, khóa version task, có idempotency và ghi audit/event
  trong transaction. Bỏ watcher kết thúc quan hệ tương ứng, không xóa lịch sử;
  không xóa vai trò reviewer/assignee hoặc nâng watcher thành người thực hiện.
- Quyền xem sau khi bỏ watcher được tính lại từ các quan hệ/canonical grant còn
  hiệu lực. Người nhận notification được kiểm tra lại tại lúc xử lý theo policy;
  danh sách watcher không phải danh sách broadcast vô điều kiện.
- Sheet mobile và cột phải phản ánh cùng dữ liệu. Hủy picker không thay đổi danh
  sách, mất quyền/stale version giữ lựa chọn để xem lại trước khi thử lại.

### Preview

- Nút “Xem trước” cạnh mỗi tệp được hỗ trợ; click card/thumbnail cũng mở viewer.
- Ảnh dùng display/fallback; PDF dùng viewer cùng trang với fallback tải tệp khi
  trình duyệt không hỗ trợ; TXT fetch có giới hạn đọc và render dưới dạng text,
  không chèn HTML. Nêu rõ nếu nội dung quá dài chỉ hiển thị một phần.
- Tiếp tục kiểm tra quyền qua service đọc tệp, signed URL ngắn hạn, đóng/xóa nội
  dung khi hết hạn, task đổi hoặc bị từ chối quyền. Hủy request cũ khi đóng viewer.
- Loading/lỗi/thử lại, focus trap, Escape đóng và trả focus về file đã mở.
- Đợt này giữ allowlist upload JPEG/PNG/WebP/PDF/TXT; không hứa preview Office
  hoặc gửi tài liệu riêng sang dịch vụ xem tài liệu bên thứ ba.

### Mention trong dòng

- Gõ @ mở gợi ý ngay vị trí soạn, tìm theo người có thể mention ở task hiện tại,
  chọn bằng phím hoặc chuột. Chọn xong tạo token có userId và display label.
- Lưu node mention có ID trong document; plain-text projection hiển thị @tên.
  Backend xác thực node và tính recipient IDs từ các node sau chỉnh sửa. Không
  lấy ID từ chuỗi tên hoặc tin danh sách recipient do client tự truyền.
- Xóa token là xóa mention tương ứng; text chỉ gõ tên chưa chọn không gửi mention.
  Tên trùng không làm nhầm người. Edit giữ ID và không phát lại các mention cũ.
- Bổ sung parser/document schema theo cách đọc được bình luận văn bản hiện có;
  mention legacy giữ thông tin người đã được nhắc, không tự đoán vị trí trong câu.
  Bỏ picker/ô mention riêng trong composer mới.
- Mất quyền trong lúc soạn: giữ bản nháp, server từ chối gửi, UI yêu cầu chọn lại
  người hợp lệ. Không có optimistic notification hay gửi hai lần khi retry.

## 5. Thông báo và nghiệm thu

Không có thông báo hiện tại vì delivery gate đang tắt, không phải bằng chứng rằng
mọi hành động thiếu event. Inventory có đủ event tạo, nhận, bắt đầu, chuyển việc,
comment, mention, checklist, tệp, nộp kết quả và hoàn thành. Số liệu này là snapshot,
không được dùng làm invariant cho các lần nghiệm thu sau khi người dùng thao tác.

| Hành động | Người nhận dự kiến theo chính sách hiện có |
| --- | --- |
| Tạo/giao/chuyển việc | Người được giao có trách nhiệm mới; các bên liên quan theo policy |
| @mention | Người được nhắc còn quyền xem; thông báo bắt buộc |
| Nộp kết quả/cần sửa | Người duyệt hoặc người thực hiện cần hành động |
| Cập nhật/comment/tệp/checklist | Người liên quan, áp dụng mute và cooldown |
| Sắp hạn/quá hạn/SLA | Chủ thể tương ứng và tuyến quản lý được phép |

Không phải thao tác nào cũng tạo thông báo cho chính người vừa thao tác; phản hồi
“Đã lưu/Đã gửi/Đã cập nhật” là feedback tại chỗ. In-app là notification trong ứng
dụng; push trên thiết bị còn phụ thuộc đăng ký và quyền trình duyệt.

Trước khi bật, chuẩn bị danh sách event/recipient của 15 sự kiện cũ để xem xét,
chọn mốc bắt đầu và cách xử lý sự kiện cũ mà vẫn giữ audit/dedupe. Không bật gate
chung rồi vô tình phát lại toàn bộ. Chỉ gửi pilot tới tài khoản được người dùng
cho phép; xác nhận action matrix và thiết bị bằng hai tài khoản khác nhau, kiểm
tra click thông báo vào đúng việc/bình luận, mute và quyền bị thu hồi. Ghi thời
điểm bật thực tế rồi mới bắt đầu quan sát 48 giờ.

## 6. Thứ tự triển khai tiếp sau khi duyệt thiết kế

| Đợt | Kết quả có thể nghiệm thu |
| --- | --- |
| UX1 — sửa lỗi đã xác minh | Đã thực hiện refresh và coverKey; kiểm thử browser/thực tế tạo Workspace |
| UX2 — dữ liệu, việc con và người tham gia | Forward migration: cha–con, planned_start_at, command sửa lịch/thêm-bỏ watcher, capability, audit; guarded create/list/detail/aggregate và tests Cloud rollback |
| UX3 — UI chi tiết & con | Bố cục v2 ở mục 4 nối service thật; form đủ ngày bắt đầu/kết thúc, watcher, tiến độ, next action và mobile sheet |
| UX4 — preview & mention | Viewer ảnh/PDF/TXT; document mention, composer trong dòng và dedupe sự kiện |
| UX5 — delivery pilot | Chuẩn bị backlog/recipient review; bật theo xác nhận gửi, kiểm tra in-app và push thật |
| UX6 — nghiệm thu Task 11 | Ma trận nghiệp vụ/quyền/thiết bị, lỗi không tái diễn, quan sát 48 giờ |

UX2–4 mở rộng trải nghiệm pilot, không được ghi thành “R1B hoàn tất”. R1B còn
dispatch quy mô lớn, công việc riêng theo người, bulk/retry; R2 dashboard phân tích
và R3 automation/AI chưa triển khai.

Kiểm thử bắt buộc khi triển khai: duplicate idempotency và stale version; cha đóng
không sửa con; con cần duyệt không hoàn thành ngay; không lộ con bị hạn chế; parent
link không nâng quyền; tiến độ đúng khi phân trang/hủy; mention xóa/sửa/tên trùng/
mất quyền; URL tệp hết hạn/chuyển task; refresh không mất draft, focus hoặc scroll;
360/768/1440 không tràn ngang và có điều khiển bàn phím. Các test browser mock phải
đối chiếu contract SQL để tránh lặp lại lỗ hổng kiểm thử coverKey.

Bổ sung theo ảnh tham khảo: ngày bắt đầu không ghi đè start thực tế, kết thúc
trước bắt đầu bị từ chối, hoàn thành không đổi lịch; thêm/bỏ watcher dedupe đúng,
hủy không lưu, sai quyền và thành viên hết hiệu lực bị từ chối, không xóa nhầm
vai trò khác, mobile và desktop cùng phản ánh người theo dõi. Bản mẫu v2 đã kiểm
tra 1850/1440/768/360 và các tương tác trên; đây không thay cho kiểm thử Cloud của
các command mới khi triển khai.
