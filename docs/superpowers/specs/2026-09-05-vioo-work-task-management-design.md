# Đặc tả thiết kế Vioo Work — Công việc

**Ngày:** 05/09/2026

**Trạng thái:** Đã duyệt thiết kế; chờ duyệt đặc tả trước khi lập kế hoạch triển khai

**Phạm vi:** Kiến trúc nghiệp vụ, dữ liệu, quyền, SLA, thông báo, UX đa thiết bị, Dashboard V2 và nền tảng AI/automation cho module Vioo Work

**Chưa bao gồm:** Migration, thay đổi Supabase Cloud, code UI/backend, nhập dữ liệu thật và kích hoạt chatbot/automation trong production

## 1. Tóm tắt quyết định

Vioo Work là một miền nghiệp vụ độc lập dùng để giao, nhận, phối hợp, theo dõi và đánh giá công việc trong công ty. Module không tái sử dụng `project_tasks`, vì bảng đó phục vụ tiến độ/Gantt/BOQ của dự án chứ không mô tả đầy đủ trách nhiệm cá nhân, xác nhận nhận việc, SLA, thảo luận và lịch sử giao việc.

Các quyết định đã được duyệt:

1. Mỗi công việc có UUID nội bộ và mã bất biến dễ đọc, ví dụ `VW-2026-001245`.
2. Công việc có một phạm vi chính: phòng ban, dự án hoặc trực tiếp. Có thể gắn thêm liên kết ngữ cảnh nhưng không làm thay đổi phạm vi chính.
3. “Nhóm công việc” là bucket tùy chọn thuộc một phòng ban/dự án, ví dụ `Phòng IT → Phần mềm`, `Thiết bị CNTT`, `Camera`.
4. “Nhóm làm việc” hiện có trong Cấu hình hệ thống là principal để chọn nhiều người nhận. Đây là khái niệm khác với nhóm công việc.
5. Có thể giao cho một/nhiều người, một/nhiều nhóm làm việc, một/nhiều phòng ban hoặc toàn công ty.
6. Hỗ trợ hai kiểu phân phối: cùng phối hợp trên một `task_id`, hoặc tách thành công việc riêng cho từng người và tổng hợp bằng một đợt giao.
7. Người nhận phải xác nhận; SLA thực hiện bắt đầu khi nhận việc. Việc tự giao cho bản thân tự động được xác nhận.
8. Người nhận có thể báo giao nhầm/chuyển phần việc của mình cho người đủ điều kiện; SLA người nhận mới được khởi tạo lại nhưng deadline chung không tự động đổi.
9. Có thể bổ sung người đồng thực hiện. Người mới phải xác nhận và sau đó có quyền thao tác ngang với các người thực hiện khác.
10. Người theo dõi có thể xem, bình luận và nhận thông báo nhưng không có quyền thay đổi trạng thái chỉ vì đang theo dõi.
11. Có thảo luận ở cuối trang, hỗ trợ `@mention`; mention chỉ tạo thông báo, không tự cấp quyền xem công việc.
12. Lịch sử hoạt động bất biến được đặt cuối trang ở dạng thu gọn, tải phân trang khi người dùng mở.
13. Có mức độ `Bình thường`, `Quan trọng`, `Khẩn cấp`; ghim là lựa chọn cá nhân của từng người dùng.
14. Có nút tắt/mở thông báo theo từng `task_id`, nhưng không tắt các cảnh báo bắt buộc cần chính người dùng hành động.
15. Link nội bộ chỉ là deep link, không phải capability link và không cấp thêm quyền.
16. Clone mở form tạo mới đã điền sẵn; chỉ sinh bản ghi và mã mới khi người dùng bấm Tạo.
17. Dashboard V2 ưu tiên điện thoại/máy tính bảng, tập trung vào việc cần xử lý, hỗ trợ drill-down và drill-through.
18. Backend/RLS/RPC là nguồn quyết định quyền cuối cùng. Frontend chỉ dùng capability do backend trả về để trình bày thao tác.
19. AI chatbot và automation chỉ gọi command/RPC có kiểm quyền, idempotency và audit; không được ghi trực tiếp vào bảng nghiệp vụ.

## 2. Mục tiêu và ngoài phạm vi

### 2.1 Mục tiêu

- Giúp người giao việc biết đã giao việc gì, cho ai, khi nào, tình trạng và bằng chứng trao đổi/kết quả.
- Ghi nhận được việc giao trực tiếp ngoài đời mà không bắt Tổng giám đốc hoặc quản lý phải nhập lại công việc.
- Tạo một nguồn sự thật cho trách nhiệm, xác nhận nhận việc, thời hạn, kết quả, trao đổi và lịch sử thay đổi.
- Cho cá nhân, quản lý, phòng ban và dự án quan sát đúng phạm vi mà không lộ nội dung công việc hạn chế.
- Tạo trải nghiệm nhanh trên điện thoại nhưng vẫn đủ chiều sâu cho quản lý trên máy tính bảng/máy tính.
- Chuẩn bị cấu trúc command, event và dữ liệu có ngữ nghĩa rõ để tích hợp AI/automation an toàn.

### 2.2 Ngoài phạm vi phiên bản đầu

- Không thay thế module kế hoạch tiến độ dự án/Gantt/BOQ hiện có.
- Không xây hệ thống chấm công, tính lương hoặc đánh giá hiệu suất nhân sự từ số lượng task.
- Không dùng task count để xếp hạng năng suất cá nhân.
- Không tạo public link xem công việc không cần đăng nhập.
- Không tự động thêm/bớt người trên công việc đang chạy khi thành viên nhóm/phòng ban thay đổi.
- Không cho AI hoặc service role bỏ qua quy tắc quyền nghiệp vụ.

### 2.3 Quan hệ với kiến trúc hiện có

Tài liệu này kế thừa `docs/security/principal-permission-scope-assignment-workflow-notification-architecture.md` và hướng hợp nhất quyền trong `docs/superpowers/plans/2026-09-04-permission-unification-v2.md`: module permission chỉ mở vỏ ứng dụng; capability trên từng task phải kết hợp scope, relationship, assignment và trạng thái; RLS/RPC là lớp quyết định cuối; notification đi theo trách nhiệm thay vì permission pool.

Vioo Work tái sử dụng có kiểm soát:

- `org_units` và quan hệ quản lý hiện hành cho phòng ban/escalation.
- `projects` và thành viên dự án cho phạm vi dự án.
- `work_groups`, `work_group_members` làm nguồn chọn nhóm người nhận.
- Hạ tầng user, notification/outbox, audit và Storage sau khi xác nhận contract thực tế.

Vioo Work không tái sử dụng `project_tasks` và không biến mỗi task thành một workflow instance tổng quát trong R1. Vòng đời task cố định được triển khai bằng command/RPC chuyên biệt; vẫn tuân theo các nguyên tắc Assignment, Workflow và Notification chung của hệ thống.

## 3. Thuật ngữ và ranh giới miền

| Thuật ngữ | Ý nghĩa | Nguồn dữ liệu |
| --- | --- | --- |
| Phòng ban | Đơn vị trong cây tổ chức | `org_units` |
| Dự án | Dự án nghiệp vụ hiện có | `projects` |
| Nhóm làm việc | Nhóm người dùng để chọn/giao hàng loạt | `work_groups`, `work_group_members` hiện có |
| Nhóm công việc | Bucket gom task bên trong một phòng ban/dự án | `work_task_groups` mới |
| Phạm vi chính | Nơi sở hữu/ngữ cảnh chính của task | department/project/direct |
| Người tạo | User ghi bản ghi task vào hệ thống | task creator |
| Người giao | User chịu trách nhiệm giao task; có thể trùng hoặc khác người tạo | task assigner |
| Người thực hiện | Một user có assignment thực thi đang hoạt động | task assignee |
| Người theo dõi | User được xem, bình luận và nhận thông báo | watcher |
| Người đánh giá | User được giao quyền đánh giá kết quả | reviewer |
| Đợt giao | Bản ghi điều phối khi một yêu cầu được tách thành nhiều task cá nhân | dispatch |

`work_task_groups` tuyệt đối không thay thế hoặc đổi nghĩa `work_groups`. Bucket chỉ thuộc đúng một phạm vi phòng ban/dự án; task trực tiếp không có bucket.

## 4. Kiến trúc thông tin

```text
Vioo Work
├── Tổng quan
│   ├── Việc cần tôi xử lý
│   ├── Việc tôi đang giao
│   ├── Việc nhân viên/phạm vi của tôi
│   └── KPI và phân tích
├── Công việc của tôi
│   ├── Được giao
│   ├── Tôi đã giao
│   ├── Tôi theo dõi
│   └── Đã ghim
├── Phòng ban & dự án
│   └── Nhóm công việc (bucket)
├── Đợt giao hàng loạt
├── Thông báo
└── Cấu hình Vioo Work
    ├── Nhóm công việc
    ├── SLA/xác nhận
    ├── chính sách đánh giá
    └── quyền theo phạm vi
```

Nhóm làm việc tiếp tục được quản lý tại Cấu hình hệ thống hiện có. Vioo Work chỉ đọc nhóm đó làm nguồn chọn người nhận, không tạo một danh mục nhóm người dùng song song.

## 5. Phạm vi chính, bucket và liên kết ngữ cảnh

Mỗi task có chính xác một `primary_scope_type`:

- `department`: bắt buộc có `primary_scope_id = org_units.id`.
- `project`: bắt buộc có `primary_scope_id = projects.id`.
- `direct`: `primary_scope_id` rỗng; dùng cho việc cá nhân/giao trực tiếp không thuộc một đơn vị hoặc dự án cụ thể.

Quy tắc:

1. Bucket nếu có phải thuộc cùng phạm vi chính của task.
2. Task trực tiếp không được chọn bucket.
3. Một task có thể liên kết thêm phòng ban, dự án hoặc đối tượng nghiệp vụ qua `work_task_context_links` để tra cứu; liên kết phụ không cấp quyền và không thay đổi quyền sở hữu.
4. Đổi phạm vi chính là thao tác nhạy cảm, phải kiểm tra lại bucket, người nhận, người đánh giá, quyền xem và ghi lịch sử.
5. Nếu bucket bị ngừng hoạt động, task cũ vẫn giữ liên kết để báo cáo lịch sử; task mới không được chọn bucket đó.

## 6. Tạo và ghi nhận công việc

### 6.1 Drawer tạo nhanh

Mặc định dùng drawer để tạo nhanh trên desktop/tablet và full-screen sheet trên điện thoại. Thứ tự trường:

1. Tên công việc — bắt buộc.
2. Người nhận — user, nhóm làm việc, phòng ban hoặc toàn công ty.
3. Kiểu phân phối — phối hợp chung hoặc công việc riêng theo người.
4. Phạm vi chính — phòng ban, dự án hoặc trực tiếp.
5. Nhóm công việc — tùy chọn và phụ thuộc phạm vi chính.
6. Deadline; có lối tắt Hôm nay, Ngày mai, Khác.
7. Mức độ — Bình thường, Quan trọng, Khẩn cấp.
8. Mô tả.
9. Đính kèm.
10. Nhãn nghiệp vụ.
11. Người theo dõi.
12. Chính sách đánh giá/người đánh giá nếu cần ghi đè mặc định.

Drawer có nút `Mở trình soạn đầy đủ` khi cần checklist, nhiều liên kết ngữ cảnh hoặc cấu hình nâng cao. Nút Tạo bị khóa đến khi backend preview cho biết tập người nhận hợp lệ.

### 6.2 Ghi nhận việc giao ngoài hệ thống

Không tạo một “hình thức giao trực tiếp” bắt Tổng giám đốc nhập lại công việc. Dùng các luồng thực dụng:

#### Tổng giám đốc giao trực tiếp cho nhân viên

1. Nhân viên tạo task và chọn chính mình là người nhận.
2. Nhân viên thêm Tổng giám đốc và trợ lý/người trung gian nếu có làm người theo dõi.
3. Đây là self-assignment nên tự động xác nhận, chuyển sang `not_started` và bắt đầu SLA thực hiện.
4. Lịch sử thể hiện ai là người tạo bản ghi; không tự tuyên bố Tổng giám đốc là người giao nếu không có dữ liệu ủy quyền.

#### Tổng giám đốc giao qua trợ lý

1. Trợ lý tạo task và giao cho nhân viên.
2. Tổng giám đốc được thêm làm người theo dõi.
3. Nhân viên phải xác nhận nhận việc.
4. Trợ lý là người tạo/người giao thực tế. Chỉ hiển thị “theo chỉ đạo Tổng giám đốc” khi tồn tại ủy quyền được cấu hình/audit rõ.

Mô hình này giữ bằng chứng đúng với hành động trên hệ thống và tránh tạo lịch sử giả.

## 7. Người nhận và hai kiểu phân phối

### 7.1 Nguồn người nhận

Người giao có thể chọn:

- Một hoặc nhiều user.
- Một hoặc nhiều nhóm làm việc từ Cấu hình hệ thống.
- Một hoặc nhiều phòng ban.
- Toàn công ty.

Backend phải preview tập người nhận trước khi tạo:

- Gộp trùng user xuất hiện qua nhiều nguồn.
- Loại tài khoản ngừng hoạt động, chưa có app user hoặc không có quyền truy cập Vioo Work.
- Hiển thị số hợp lệ, số bị loại và lý do.
- Với giao phòng ban/toàn công ty, yêu cầu xác nhận lần cuối trước thao tác hàng loạt.

### 7.2 Snapshot thành viên

Danh sách người nhận được chụp tại thời điểm giao. Việc thêm/bớt thành viên khỏi nhóm làm việc hoặc phòng ban sau đó không âm thầm sửa task đang hoạt động.

Nếu người có quyền chọn `Đồng bộ người nhận`, backend phải:

1. Tính diff giữa snapshot và thành viên hiện tại.
2. Hiển thị ai sẽ được thêm, ai sẽ được đóng assignment và tác động SLA.
3. Yêu cầu xác nhận.
4. Áp dụng qua RPC nguyên tử và ghi sự kiện audit.

### 7.3 Chế độ Phối hợp chung

- Một `task_id`, nhiều người thực hiện có quyền ngang nhau sau khi xác nhận.
- Dùng chung trạng thái, checklist, kết quả, file, thảo luận và lịch sử.
- Mỗi người có trạng thái xác nhận và SLA riêng.
- Bất kỳ người đã xác nhận nào cũng có thể bắt đầu, cập nhật, báo chặn hoặc gửi đánh giá.
- UI luôn hiển thị tiến độ xác nhận, ví dụ `Đang làm · 4/6 đã nhận`.
- Không yêu cầu tất cả phải xác nhận trước khi người đã nhận bắt đầu làm.
- Hoàn thành task kết thúc các assignment còn hoạt động; lịch sử vẫn thể hiện người chưa từng xác nhận.

Chế độ này phù hợp khi mọi người cùng tạo ra một kết quả chung.

### 7.4 Chế độ Công việc riêng theo người

- Tạo một `work_task_dispatch` làm bản ghi điều phối, không phải task thực thi.
- Mỗi người nhận có một task con với `task_id`, mã, trạng thái, SLA, kết quả và quy trình đánh giá riêng.
- Đợt giao tổng hợp số đã nhận, đang làm, quá hạn, chờ đánh giá và hoàn thành.
- Đây là mặc định khi giao cho nhiều phòng ban hoặc toàn công ty.
- Người xem có thể drill-through từ đợt giao xuống phòng ban → người nhận → task.

Chế độ này phù hợp khi mỗi người phải nộp một kết quả độc lập. Số lượng task KPI tính theo task con; bản ghi đợt giao không được tính như một task hoàn thành.

## 8. Vòng đời công việc

```text
draft
  → pending_acknowledgement
      → needs_clarification
      → not_started
          → in_progress ↔ blocked
              → awaiting_review
                  → changes_requested → in_progress
                  → completed

Mọi trạng thái chưa kết thúc → cancelled
```

### 8.1 Ý nghĩa trạng thái

| Trạng thái | Ý nghĩa | Hành động chính |
| --- | --- | --- |
| `draft` | Chưa giao, chỉ người có quyền soạn thấy | Sửa, xóa nháp, giao |
| `pending_acknowledgement` | Đã ghi nhận, đang chờ người nhận xác nhận | Nhận việc, đề nghị làm rõ, báo giao nhầm/chuyển |
| `needs_clarification` | Có vấn đề về nội dung, phạm vi hoặc người nhận | Trao đổi, sửa nội dung, giao lại |
| `not_started` | Ít nhất một người đã nhận nhưng chưa bắt đầu | Bắt đầu, chuyển, thêm đồng thực hiện |
| `in_progress` | Đang thực hiện | Cập nhật, báo chặn, gửi đánh giá |
| `blocked` | Không thể tiếp tục vì trở ngại có mô tả | Gỡ chặn, cập nhật nguyên nhân |
| `awaiting_review` | Đã nộp kết quả, chờ đánh giá | Duyệt, yêu cầu chỉnh sửa |
| `changes_requested` | Kết quả cần sửa | Làm tiếp, nộp lại |
| `completed` | Kết quả đã được chấp nhận hoặc tự hoàn thành theo chính sách | Chỉ đọc/clone |
| `cancelled` | Công việc bị hủy có lý do | Chỉ đọc/clone |

Với task phối hợp, trạng thái task và trạng thái assignment được tách rõ:

- `pending_acknowledgement` khi chưa có assignee nào xác nhận và chưa có yêu cầu làm rõ chi phối task.
- Khi có người đầu tiên xác nhận, task chuyển `not_started`; những người còn chờ vẫn hiện bằng badge và action inbox riêng.
- Một người yêu cầu làm rõ không chặn những assignee khác đã xác nhận; UI hiển thị badge `N cần làm rõ`. Task chỉ chuyển `needs_clarification` khi chưa có ai có thể tiếp tục hoặc người giao chủ động đưa toàn task về làm rõ.
- `in_progress`, `blocked`, `awaiting_review` và `completed` là trạng thái kết quả chung; trạng thái xác nhận/SLA của từng người vẫn được giữ độc lập để audit và KPI.

Dashboard gộp vòng đời thành ba nhóm dễ hiểu:

- Chưa làm: chờ xác nhận, cần làm rõ, chưa bắt đầu.
- Đang xử lý: đang làm, bị chặn, chờ đánh giá, cần chỉnh sửa.
- Kết thúc: hoàn thành, đã hủy.

### 8.2 Quy tắc đánh giá

- Mặc định người giao là người đánh giá.
- Có thể chỉ định reviewer khác nếu người thao tác có quyền trong phạm vi.
- Nhóm công việc có thể cấu hình bắt buộc đánh giá.
- Task cá nhân đơn giản có thể dùng chính sách tự hoàn thành.
- Với phối hợp chung, bất kỳ assignee đã nhận nào cũng có thể nộp; reviewer đánh giá kết quả chung.
- `Yêu cầu chỉnh sửa` đưa task về luồng thực hiện và bắt buộc có nhận xét.

## 9. Xác nhận và SLA

### 9.1 SLA xác nhận mặc định

| Mức độ | Thời hạn xác nhận |
| --- | --- |
| Khẩn cấp | 1 giờ làm việc |
| Quan trọng | 4 giờ làm việc |
| Bình thường | 1 ngày làm việc |

Thời gian làm việc phải được tính theo lịch làm việc/cấu hình công ty, không dùng phép cộng giờ lịch đơn giản. Nếu chưa có lịch đủ tin cậy, cấu hình SLA dùng một lịch công ty rõ ràng và có thể audit.

Khi quá SLA xác nhận:

- Task vẫn ở trạng thái chờ; SLA thực hiện chưa bắt đầu cho assignment đó.
- Gửi cảnh báo cho người nhận, người giao và quản lý trực tiếp đã resolve được.
- Không tự động nhận việc thay người dùng.

### 9.2 SLA thực hiện và deadline

- Deadline là cam kết cấp task và không tự đổi khi chuyển người.
- SLA thực hiện cấp assignment bắt đầu tại `accepted_at`.
- Với self-assignment, `accepted_at = assigned_at`.
- Chuyển việc tạo assignment mới, khởi tạo lại SLA xác nhận/thực hiện của người mới.
- Nếu chính sách có thời lượng SLA riêng, `execution_sla_due_at` được tính lại nhưng không được âm thầm kéo dài `task.deadline_at`; mọi thay đổi deadline cần quyền, lý do và audit.
- Chỉ số “đúng hạn” dựa trên deadline task; chỉ số phản hồi/trách nhiệm dựa trên SLA assignment.

## 10. Chuyển việc và thêm người đồng thực hiện

### 10.1 Chuyển việc

Người nhận có thể chuyển phần assignment của mình khi bị giao nhầm hoặc người khác phù hợp hơn:

1. Chọn người nhận mới trong danh sách backend xác nhận đủ điều kiện.
2. Nhập lý do bắt buộc.
3. RPC đóng assignment cũ với trạng thái `transferred` và tạo assignment mới `pending_acknowledgement` trong cùng transaction.
4. Nếu task có nhiều assignee, chỉ assignment của người chuyển bị thay thế.
5. Reset SLA người nhận mới theo mục 9; không đổi deadline chung.
6. Thông báo cho người tạo, người giao, người cũ, người mới và người theo dõi.
7. Lịch sử ghi rõ nguồn, đích, lý do và thời điểm.

Không cho chuyển sang user ngoài phạm vi nếu actor không có capability phù hợp. Với công việc hạn chế, người mới phải có quyền xem phù hợp trước khi assignment được tạo.

### 10.2 Thêm đồng thực hiện

“Thêm người nhận việc” là thao tác assignment chính thức, không phải `@mention`:

- Người có capability thêm người đồng thực hiện chọn một/nhiều user hợp lệ.
- Người mới nhận thông báo và phải xác nhận.
- Sau khi nhận, người mới có quyền chức năng ngang assignee hiện tại trên cùng task.
- Mọi cập nhật đều ghi actor trong activity log.
- Xóa/đóng assignment của một đồng thực hiện phải có lý do và không xóa lịch sử đóng góp.

## 11. Mức độ, nhãn và ghim

- `priority`: thuộc tính dùng chung của task, gồm `normal`, `important`, `urgent`.
- Người tạo/người giao hoặc quản lý có capability phù hợp được đổi mức độ; thay đổi phải ghi audit và phát thông báo khi mức độ tăng.
- Task khẩn cấp luôn xuất hiện trong vùng cần chú ý, kể cả khi người dùng không ghim.
- `labels`: nhãn nghiệp vụ tùy chọn, có thể thuộc phạm vi để tránh danh mục toàn công ty lộn xộn.
- `pin`: lựa chọn riêng theo `user_id + task_id`; không thay đổi thứ tự của người khác và không phải priority.

## 12. Người theo dõi, thảo luận và lịch sử

### 12.1 Người theo dõi

- Một task có nhiều watcher.
- Desktop hiển thị avatar, hover thấy tên; mobile/tablet chạm avatar để mở danh sách.
- Khi quá số lượng hiển thị, dùng `+N`.
- Watcher được xem, bình luận và nhận thông báo nếu không bị tắt theo chính sách.
- Watcher không được nhận/bắt đầu/hoàn thành/đánh giá task nếu không có assignment hoặc capability riêng.

### 12.2 Thảo luận

Thảo luận đặt ở cuối nội dung task, hỗ trợ:

- Bình luận, trả lời, chỉnh sửa trong chính sách cho phép và đính kèm.
- `@mention` người dùng đã có quyền xem task.
- Notification deep link cuộn đến đúng bình luận.
- Picker mention chỉ trả về principal được backend xác nhận có quyền xem.
- Mention không tự tạo watcher, assignment hoặc grant.
- Nếu muốn mời người chưa có quyền, phải dùng thao tác thêm watcher/đồng thực hiện riêng và đi qua kiểm quyền.

### 12.3 Lịch sử hoạt động

- Nằm cuối trang dưới khối thảo luận, mặc định thu gọn: `Lịch sử hoạt động (N)`.
- Mở mới tải dữ liệu theo cursor, tránh tải toàn bộ lịch sử khi mở task.
- Có bộ lọc trạng thái, người nhận, file, bình luận, SLA và quyền.
- Event nghiệp vụ quan trọng là bất biến; chỉnh sửa nội dung tạo version/event mới, không rewrite bằng chứng cũ.
- Mọi event ghi actor, nguồn `human | ai_chatbot | automation | system`, thời gian, before/after allowlist và correlation/idempotency key khi có.

## 13. Thông báo

### 13.1 Sự kiện và người nhận

Người tạo/người giao, các assignee và watcher nhận thông báo phù hợp với quan hệ khi:

- Task được tạo/giao hoặc thay đổi nội dung quan trọng.
- Có người nhận mới, chuyển việc hoặc đóng assignment.
- Người nhận xác nhận, đề nghị làm rõ hoặc báo giao nhầm.
- Task bắt đầu, bị chặn, được gỡ chặn, gửi đánh giá, yêu cầu chỉnh sửa hoặc hoàn thành.
- Deadline sắp tới hoặc đã quá hạn.
- Có `@mention` trong thảo luận.

Thông báo sắp tới hạn/quá hạn luôn gửi người thực hiện và người tạo/người giao. Escalation xác nhận gửi thêm quản lý trực tiếp khi resolve được quan hệ hiện hành.

### 13.2 Tắt/mở theo task

Mỗi user có preference riêng theo `task_id`:

- Tắt thông báo chỉ chặn hoạt động thông thường như cập nhật mô tả, bình luận không mention hoặc thay đổi file.
- Không được chặn thông báo trực tiếp giao/chuyển cho chính user, `@mention`, việc chính user phải đánh giá/xác nhận, quá hạn của chính user và cảnh báo an toàn/bảo mật.
- UI phải giải thích rõ “Tắt bớt thông báo”, không tạo kỳ vọng tắt tuyệt đối.

### 13.3 Phân phối an toàn

```text
Domain event trong transaction
→ outbox
→ resolve relationship/assignment đang hiệu lực
→ áp dụng preference + dedupe/cooldown
→ notification + delivery
→ deep link kiểm quyền lại khi mở
```

Không gửi theo toàn bộ user có cùng permission. Không đưa tiêu đề/nội dung task hạn chế vào push/email cho người chỉ có quyền xem số liệu tổng hợp.

## 14. Task ID, deep link và clone

### 14.1 Định danh

- `work_tasks.id`: UUID dùng cho liên kết nội bộ.
- `work_tasks.task_code`: mã hiển thị bất biến, duy nhất, ví dụ `VW-2026-001245`.
- Mã được sinh ở backend bằng cơ chế không trùng trong concurrency.
- Route chuẩn: `/work/tasks/VW-2026-001245`.
- Copy link không cấp quyền. Mở link luôn kiểm tra session, user active, scope và subject relationship.

### 14.2 Clone

Nút Clone mở drawer/form tạo mới với dữ liệu cho phép sao chép. Chưa ghi database cho đến khi người dùng bấm Tạo.

Sao chép:

- Tên, mô tả, phạm vi, bucket, nhãn, priority.
- Người nhận, watcher, reviewer/chính sách review.
- Checklist chưa hoàn thành và cấu trúc liên kết ngữ cảnh.

Không sao chép:

- UUID, task code, trạng thái và timestamps.
- Xác nhận, SLA đã chạy, tiến độ, kết quả.
- Bình luận, lịch sử, file kết quả và trạng thái hoàn thành checklist.
- Deadline cũ nếu đã hết hiệu lực; người dùng phải xác nhận deadline mới trước khi tạo.

Task mới lưu `cloned_from_task_id` để truy vết nhưng không kế thừa quyền chỉ vì quan hệ clone.

## 15. Giao diện chi tiết công việc

### 15.1 Desktop/tablet rộng

```text
┌──────────────┬───────────────────────────────────┬──────────────────┐
│ Danh sách    │ Task code + tên + action chính    │ Trách nhiệm      │
│ công việc    │ Phạm vi · bucket · deadline       │ Người giao       │
│ và bộ lọc    │ Mô tả                             │ Người nhận       │
│              │ Checklist                         │ Người theo dõi    │
│              │ Kết quả & file                    │ Reviewer + SLA    │
│              │ Công việc liên quan/con           │ Metadata          │
│              │ Thảo luận                         │                  │
│              │ Lịch sử hoạt động (thu gọn)       │                  │
└──────────────┴───────────────────────────────────┴──────────────────┘
```

- Action theo trạng thái được ghim ở vùng dễ chạm/nhìn.
- Danh sách trái giữ ngữ cảnh khi người dùng chuyển task.
- Cột phải là drawer có thể thu gọn trên tablet.

### 15.2 Điện thoại

- Một cột, tiêu đề gọn và action chính sticky phía dưới.
- Danh sách task là màn hình trước; mở task thành trang chi tiết.
- Metadata/người tham gia mở bằng bottom sheet.
- Avatar dùng tap, không phụ thuộc hover.
- Bộ lọc dùng chips cuộn ngang và bottom sheet.
- Các thao tác phá vỡ luồng như hủy/chuyển phải có xác nhận và lý do.

## 16. Dashboard V2, KPI và tương tác

### 16.1 Thứ tự ưu tiên

Phần đầu dashboard là danh sách cần hành động, không phải biểu đồ:

1. Quá hạn.
2. Chờ tôi xác nhận.
3. Bị chặn.
4. Chờ tôi đánh giá.
5. Khẩn cấp/quan trọng sắp tới hạn.

Sau đó mới tới KPI xu hướng và tải công việc.

### 16.2 Góc nhìn

- `Của tôi`: được giao, tôi đã giao, tôi theo dõi, đã ghim.
- `Nhân viên của tôi`: dữ liệu theo quan hệ quản lý đang hiệu lực.
- `Phòng ban/Dự án`: chỉ khi có scope capability.
- `Toàn công ty`: chỉ quyền quản trị/điều hành được cấp rõ.

### 16.3 KPI định nghĩa

| KPI | Cách tính |
| --- | --- |
| Chờ xác nhận | Assignment active chưa `accepted_at` và chưa đóng |
| Vi phạm SLA xác nhận | Assignment xác nhận sau `ack_due_at` hoặc còn chờ sau mốc đó |
| Quá hạn | Task chưa kết thúc và `deadline_at < now()` |
| Hoàn thành đúng hạn | `completed_at <= deadline_at` |
| Thời gian chu kỳ | Từ thời điểm nhận việc đầu tiên đến hoàn thành, tách thời gian chờ review khi cần |
| Tuổi bị chặn | Thời gian liên tục từ event blocked gần nhất chưa được gỡ |
| Tỷ lệ làm lại | Số lượt `changes_requested` trên số lần gửi review |
| Tải công việc | Số assignment thực thi active, có phân nhóm priority/trạng thái |

Quy tắc chống méo số liệu:

- Đếm công việc theo `task_id` duy nhất.
- Đếm tải cá nhân theo assignment.
- `work_task_dispatch` không phải task và không cộng thêm vào số task.
- Không xếp hạng cá nhân chỉ bằng số task hoàn thành.
- Task hạn chế được tính aggregate nếu actor có quyền KPI nhưng không trả title, description, participant hoặc deep link chi tiết.

### 16.4 Drill-down và drill-through

- Drill-down: bấm một KPI để mở danh sách task đã lọc tương ứng.
- Drill-through: mở trang phân tích ngữ cảnh và giữ filter/time range, theo chuỗi:

```text
Công ty → Phòng ban/Dự án → Nhóm công việc → Người dùng → Assignment → Task
```

- Task detail mở drawer trên tablet/desktop để không mất ngữ cảnh phân tích; điện thoại mở trang mới nhưng Back phải khôi phục filter và vị trí cuộn.
- URL chứa filter ổn định để bookmark/chia sẻ nội bộ; mở URL vẫn kiểm quyền.

## 17. Mô hình dữ liệu đích

### 17.1 Bảng lõi

| Bảng | Trách nhiệm chính |
| --- | --- |
| `work_tasks` | Task, mã, phạm vi chính, bucket, trạng thái, priority, deadline, review policy, privacy, version |
| `work_task_groups` | Bucket theo department/project; không phải nhóm người dùng |
| `work_task_dispatches` | Đợt điều phối khi tạo nhiều task cá nhân |
| `work_task_recipient_specs` | Nguồn lựa chọn user/work_group/department/company và snapshot metadata |
| `work_task_recipient_members` | Kết quả expand/dedupe, user hợp lệ hoặc lý do bị loại |
| `work_task_assignments` | Trách nhiệm thực thi, xác nhận, SLA, chuyển giao và hiệu lực |
| `work_task_participants` | Watcher, reviewer và vai trò liên quan không phải assignee |
| `work_task_checklist_items` | Checklist có thứ tự, assignee tùy chọn và trạng thái |
| `work_task_comments` | Thảo luận/reply và trạng thái chỉnh sửa |
| `work_task_comment_mentions` | Mention đã resolve tới user có quyền |
| `work_task_attachments` | Metadata file, loại attachment, owner và storage object |
| `work_task_context_links` | Liên kết ngữ cảnh phụ, không cấp quyền |
| `work_task_relations` | Clone, phụ thuộc, liên quan hoặc parent/child nghiệp vụ |
| `work_task_versions` | Snapshot/version nội dung cần so sánh |
| `work_task_events` | Audit/domain event bất biến |
| `work_task_notification_preferences` | Mute/unmute theo user + task |
| `work_task_user_pins` | Ghim cá nhân theo user + task |

### 17.2 Trường chính của `work_tasks`

```text
id uuid primary key
task_code text unique immutable
title text
description rich text/document
primary_scope_type department | project | direct
primary_scope_id uuid nullable
task_group_id uuid nullable
status task lifecycle enum
priority normal | important | urgent
privacy standard | restricted
distribution_mode collaborative | individual
creator_id uuid
assigner_id uuid
review_policy required | optional | auto_complete
deadline_at timestamptz nullable
started_at/completed_at/cancelled_at timestamptz nullable
cloned_from_task_id uuid nullable
dispatch_id uuid nullable
lock_version bigint
created_at/updated_at timestamptz
```

Ràng buộc database:

- `direct` yêu cầu `primary_scope_id IS NULL`; hai loại còn lại yêu cầu khác null.
- Bucket phải active tại thời điểm chọn và cùng loại/id với phạm vi task.
- Task code không được update sau insert.
- Trạng thái chỉ thay đổi qua RPC transition, không direct update từ client.
- `completed_at`/`cancelled_at` phải nhất quán với trạng thái.
- Foreign key dùng trong RLS/join/list đều có index phù hợp.

### 17.3 Assignment

Một assignment tối thiểu có:

```text
id, task_id, user_id
role = assignee
status pending | accepted | clarification | transferred | closed
source_recipient_member_id nullable
assigned_by, assigned_at
ack_due_at, acknowledged_at
execution_started_at, execution_sla_due_at
transferred_from_assignment_id, transferred_to_assignment_id
closed_at, close_reason
created_at, updated_at
```

Unique partial constraint ngăn hai assignment assignee active cho cùng `task_id + user_id`. Không xóa row khi chuyển/đóng.

### 17.4 Participant và quyền quan hệ

`work_task_participants` là nguồn sự thật cho `watcher` và `reviewer`, có `starts_at`, `ends_at`, `added_by` và lý do. Reviewer mặc định được materialize từ người giao khi task được giao; việc đổi reviewer đóng participant cũ và tạo participant mới thay vì ghi đè lịch sử. Quyền xem do relationship resolver kết hợp participant hiện hành, assignment, creator/assigner và scope permission; không suy từ context link.

### 17.5 Nội dung rich text và file

- Rich text dùng schema có allowlist node/mark; sanitize cả khi ghi và render.
- File lưu trong bucket Storage riêng cho Vioo Work; database chỉ lưu metadata/object path.
- Attachment phân biệt `input`, `discussion`, `result`, `evidence` để áp dụng retention/hiển thị.
- Signed URL ngắn hạn chỉ được phát sau khi kiểm subject-level access.

## 18. Nén ảnh và Storage

Pipeline upload ảnh:

1. Kiểm tra MIME thực, dung lượng và chữ ký file; không tin extension.
2. Chuẩn hóa orientation, loại metadata EXIF nhạy cảm trừ khi loại bằng chứng yêu cầu giữ.
3. Giới hạn kích thước cạnh ảnh lớn theo cấu hình.
4. Sinh thumbnail và biến thể WebP/AVIF; giữ fallback phù hợp.
5. Chỉ giữ file gốc khi người dùng chọn `Giữ bản gốc` hoặc policy bằng chứng yêu cầu.
6. Trả ảnh responsive, lazy-load và cache an toàn; không tải ảnh full-size trong danh sách/dashboard.
7. Quyền Storage phải bám quyền task, không dùng public bucket.

File không phải ảnh vẫn áp dụng kiểm MIME/dung lượng, tên an toàn, quét bảo mật nếu hạ tầng hỗ trợ và download có kiểm quyền.

## 19. Phân quyền và bảo mật

### 19.1 Nguyên tắc

Quyết định quyền theo:

```text
actor active
+ module permission
+ scope grant đang hiệu lực
+ quan hệ với task/assignment
+ workflow state
+ privacy classification
= capability trên subject
```

- Frontend không tự suy luận quyền từ chức danh hoặc tên phòng ban.
- Có quyền vào module không đồng nghĩa được xem mọi task.
- Có quyền quản lý KPI không đồng nghĩa được xem nội dung task hạn chế.
- Assignment không tự sinh permission toàn cục.
- System Admin không mặc định trở thành người tham gia task hạn chế nếu chưa có grant nghiệp vụ được audit.

### 19.2 Namespace permission đề xuất

```text
work.module.access
work.task.create
work.task.view_related
work.task.view_scope
work.task.view_restricted
work.task.assign_user
work.task.assign_group
work.task.assign_department
work.task.assign_company
work.task.manage_scope
work.task.review
work.task.audit_view
work.task.configure
```

Các action trực tiếp như nhận, bắt đầu, cập nhật, chuyển, nộp review được quyết định chủ yếu bởi assignment + state; permission chỉ bổ sung nơi cần hạn chế phạm vi.

### 19.3 RLS/RPC

- Bật RLS và deny-by-default cho mọi bảng Vioo Work.
- Client đọc qua projection/view/RPC phù hợp; bảng event/version/recipient snapshot không mở đọc rộng.
- Mutation quan trọng chỉ qua RPC `security invoker` hoặc function có kiểm actor rõ; `security definer` nếu cần phải pin `search_path`, validate actor và không dựa vào client-supplied user id.
- Service role dùng cho worker kỹ thuật không được đồng nghĩa bỏ qua authorization nghiệp vụ; worker nhận command đã được authorize hoặc chạy bằng system principal có grant giới hạn.
- Direct REST update status/assignment/reviewer/deadline phải bị chặn.
- Manager resolver dùng quan hệ tổ chức đang hiệu lực; không suy từ chức danh text.

### 19.4 Task hạn chế

Người được xem nội dung task `restricted` mặc định gồm creator, assigner, assignee active/đã đóng cần audit, watcher/reviewer active và principal có `work.task.view_restricted` đúng scope. Quản lý chỉ có quyền KPI nhận projection tổng hợp đã redaction, không nhận title hoặc participant.

## 20. Command/RPC, concurrency và event

### 20.1 Command ổn định

```text
create_task
preview_task_recipients
assign_task
sync_task_recipients
add_co_assignees
transfer_assignment
acknowledge_assignment
request_task_clarification
start_task
update_task
set_task_blocked
submit_for_review
review_task
cancel_task
add_comment
set_task_notification_preference
set_task_pin
clone_task
```

Mỗi command nhận payload có version, actor lấy từ session, `idempotency_key` với thao tác có thể retry và trả capability/state mới nhất.

### 20.2 Tính nguyên tử và chống xung đột

- Tạo task + expand recipients + assignments + participants + event + outbox trong một transaction.
- Transfer đóng assignment cũ và tạo mới trong một transaction.
- Transition kiểm tra `expected_lock_version`; dữ liệu cũ trả lỗi conflict có state mới để UI refresh.
- Idempotency key có unique constraint theo actor + command; retry không tạo task/notification trùng.
- Notification consumer dùng event id để dedupe.
- Bulk individual có thể chạy job theo batch, nhưng dispatch chỉ báo hoàn tất khi mọi child thành công; lỗi từng người được hiển thị rõ và có retry idempotent.

### 20.3 Domain event

Event tối thiểu:

```text
task.created, task.updated, task.priority_changed
assignment.created, assignment.acknowledged, assignment.clarification_requested
assignment.transferred, assignment.closed
task.started, task.blocked, task.unblocked
task.review_submitted, task.changes_requested, task.completed, task.cancelled
comment.created, comment.mentioned
attachment.added, attachment.removed
task.notification_preference_changed
```

Event là nguồn notification/audit/analytics; không dùng bảng notification làm lịch sử nghiệp vụ.

## 21. AI chatbot và automation

Thiết kế từ R1 phải sẵn sàng, dù runtime AI triển khai ở giai đoạn sau:

1. AI chỉ gọi command/RPC công khai có schema rõ; không tạo SQL hoặc ghi bảng trực tiếp.
2. AI hành động bằng quyền của user đang hội thoại. Automation bot là principal riêng với grant/scope/expiry riêng.
3. Mọi thao tác hàng loạt phải preview người nhận, loại trừ và tác động trước khi xác nhận.
4. Tạo/giao/chuyển/hủy hàng loạt yêu cầu xác nhận rõ từ người dùng, trừ automation rule đã được cấp quyền và cấu hình trước.
5. Command hỗ trợ idempotency để tránh tạo trùng khi retry.
6. Audit ghi nguồn `ai_chatbot`/`automation`, user ủy quyền, rule/conversation/correlation id.
7. Event/outbox ổn định để automation lắng nghe mà không polling bảng tùy tiện.
8. AI không được suy ra “Tổng giám đốc giao” từ nội dung hội thoại nếu không có actor/ủy quyền hợp lệ.
9. Kết quả tìm kiếm/tóm tắt phải dùng projection đã redaction; task hạn chế không được lộ qua vector index, log hoặc prompt.

## 22. Quy tắc vận hành

1. Mọi task phải có một phạm vi chính và ít nhất một assignee hợp lệ khi được giao.
2. Bucket là tùy chọn, chỉ thuộc phòng ban/dự án của phạm vi chính.
3. Người nhận tập thể luôn được preview, dedupe và snapshot trước khi tạo.
4. Nhóm/phòng ban thay đổi không tự sửa task cũ; đồng bộ phải chủ động, xem diff và audit.
5. Phối hợp chung dùng một kết quả; công việc riêng theo người dùng nhiều task và một dispatch tổng hợp.
6. Người nhận phải xác nhận; tự giao tự xác nhận. Chưa xác nhận thì SLA thực hiện cá nhân chưa chạy.
7. Chuyển việc thay assignment, không đổi task id và không tự đổi deadline.
8. Thêm người làm chung tạo assignment thật; mention chỉ tạo thông báo thảo luận.
9. Watcher không có quyền workflow nếu không có assignment/capability.
10. Reviewer mặc định là người giao; policy bucket/task có thể yêu cầu reviewer khác.
11. Mọi thay đổi trạng thái, trách nhiệm, deadline, priority và privacy đi qua RPC, ghi audit/event.
12. Mute theo task không chặn thông báo bắt buộc cần chính user hành động.
13. Link không cấp quyền; direct URL, refresh, REST và RPC phải cho cùng kết quả allow/deny.
14. Task hạn chế chỉ lộ aggregate đã redaction cho người có quyền KPI nhưng không có quyền nội dung.
15. Không dùng số lượng task làm thước đo năng suất độc lập hoặc bảng xếp hạng nhân viên.

## 23. Phạm vi triển khai

### R1A — Lõi vận hành cá nhân và phối hợp

- Module/navigation/capability nền.
- Task ID/code, phạm vi department/project/direct và bucket.
- Drawer tạo nhanh + trình soạn đầy đủ + clone + copy deep link.
- Giao trực tiếp user/nhóm làm việc theo chế độ phối hợp chung.
- Snapshot/dedupe người nhận, xác nhận theo người và SLA.
- Priority, pin cá nhân, nhãn, watcher, reviewer, checklist.
- Vòng đời, chuyển việc, thêm đồng thực hiện, kết quả và file.
- Chi tiết task responsive, thảo luận/mention và history thu gọn.
- Notification + mute theo task + due/overdue/escalation.
- Storage private và pipeline nén ảnh.
- RLS/RPC deny-by-default, idempotency, event/outbox và audit source sẵn sàng cho AI.

### R1B — Phân phối tổ chức quy mô lớn

- Giao một/nhiều phòng ban hoặc toàn công ty.
- Chế độ công việc riêng theo người.
- Dispatch, child task, roll-up và trang theo dõi đợt giao.
- Preview exclusions, bulk confirmation, batch/retry idempotent.
- Đồng bộ người nhận chủ động với diff.

### R2 — Dashboard V2 và phân tích

- Dashboard mobile-first/tablet.
- Action inbox, KPI, xu hướng và tải công việc.
- Drill-down và drill-through giữ filter/time range.
- Projection aggregate/redaction cho quản lý.
- Theo dõi SLA xác nhận, overdue, blocked aging, cycle time và rework.

### R3 — AI và automation runtime

- Chatbot gọi command có xác nhận và audit.
- Automation principal, rule builder và lịch định kỳ.
- Template công việc, recurring task và escalation nâng cao.
- Tìm kiếm/tóm tắt có redaction và kiểm soát dữ liệu nhạy cảm.
- Phân tích xu hướng nâng cao sau khi dữ liệu đủ sạch.

Không chuyển sang R1B/R2 nếu R1A chưa đạt kiểm thử quyền, tính nguyên tử, notification dedupe và truy vết lịch sử trên Supabase Cloud.

## 24. Xử lý lỗi và trạng thái biên

- Không còn quyền/phạm vi khi bấm Tạo: backend từ chối toàn bộ, UI giữ draft local và hiển thị người nhận không hợp lệ.
- User bị ngừng hoạt động sau khi nhận việc: assignment không bị xóa; người giao/quản lý nhận cảnh báo để chuyển/đóng.
- Task bị cập nhật ở tab khác: RPC trả conflict theo `lock_version`, UI hiển thị diff và yêu cầu tải lại.
- Người được mention mất quyền trước khi mở: notification có thể tồn tại nhưng deep link trả trạng thái không có quyền, không lộ nội dung.
- File upload thành công nhưng transaction task thất bại: object tạm có TTL/cleanup job; không để file mồ côi lâu dài.
- Outbox delivery lỗi: retry theo backoff, idempotent; không rollback mutation nghiệp vụ đã commit.
- Reviewer rời công ty: task vào hàng đợi cần gán reviewer mới, không tự duyệt.
- Deadline đã qua khi clone: bắt buộc chọn/khẳng định deadline mới.
- Tất cả người nhận phối hợp báo giao nhầm: task về `needs_clarification`, báo người giao xử lý.

## 25. Kiểm thử và tiêu chí nghiệm thu

### 25.1 Ma trận nghiệp vụ

- Tạo task trực tiếp, phòng ban và dự án; bucket hợp lệ/không hợp lệ.
- Self-assignment, giao một người, nhiều người và nhóm làm việc.
- Snapshot/dedupe khi user thuộc nhiều nguồn.
- Xác nhận đúng hạn/quá hạn theo ba priority và lịch làm việc.
- Phối hợp chung với trạng thái xác nhận khác nhau.
- Transfer một assignment trong task nhiều người; deadline giữ nguyên, SLA mới khởi tạo.
- Thêm đồng thực hiện và kiểm tra quyền ngang sau khi nhận.
- Review mặc định, reviewer override, auto-complete và changes requested.
- Clone prefill đúng allowlist, không sao chép lịch sử/kết quả.
- Mute thường nhưng vẫn nhận notification bắt buộc.
- Mention chỉ chọn người có quyền và không tự cấp quyền.
- Dispatch cá nhân tạo đúng số task, roll-up và retry không trùng.

### 25.2 Ma trận quyền

Kiểm tra tối thiểu với creator, assigner, assignee, watcher, reviewer, direct manager, scoped manager, unrelated user, system principal và user inactive trên các trạng thái chính.

Mỗi ca phải đối chiếu đồng nhất:

- UI capability.
- Direct URL/refresh.
- Supabase Data API/RLS.
- RPC mutation.
- Storage signed URL.
- Notification deep link.
- KPI projection/redaction.

### 25.3 Đồng thời và độ tin cậy

- Hai user chuyển/cập nhật cùng assignment.
- Retry create/transfer/comment với cùng idempotency key.
- Event/outbox không mất và notification không trùng.
- Sinh task code song song không trùng.
- Bulk dispatch dừng/tiếp tục an toàn sau lỗi giữa chừng.
- Pagination cursor ổn định cho list/comment/history.

### 25.4 Trải nghiệm đa thiết bị

- Điện thoại: tạo task, xác nhận, chuyển, bình luận mention, nộp kết quả và back giữ bộ lọc.
- Máy tính bảng: master-detail, metadata drawer, drill-through và task drawer.
- Desktop: hover avatar có tên, bàn phím/focus, list/detail không mất ngữ cảnh.
- Không có hành động chỉ dùng hover; vùng chạm và sticky action không che nội dung.

### 25.5 Supabase Cloud

Mọi migration/test tích hợp của repository này dùng Supabase Cloud qua cấu hình `.env`, không dùng Supabase local hoặc Docker. Trước rollout phải xác minh schema, RLS, RPC, index/query plan, Storage policy, Realtime nếu dùng và cleanup dữ liệu test đúng runbook.

## 26. Quan sát vận hành và rollout

Theo dõi tối thiểu:

- Tỷ lệ create/transition/transfer RPC lỗi theo error code.
- Số conflict theo `lock_version`.
- Outbox lag, retry và notification dedupe rate.
- Tỷ lệ người nhận bị loại khi preview.
- SLA job lag và số escalation.
- Storage transform/upload lỗi và object mồ côi.
- Query latency cho action inbox, task list, task detail và drill-through.
- Số lần deny RLS/RPC bất thường, không log nội dung task hạn chế.

Rollout theo cohort nhỏ, có feature flag và dữ liệu seed không nhạy cảm. Mỗi giai đoạn cần smoke test thực tế bằng tài khoản các vai trò khác nhau, không chỉ bằng role Postgres/service role. Không bật giao toàn công ty trước khi kiểm chứng bulk preview, idempotency và notification throttling.

## 27. Rủi ro và biện pháp kiểm soát

| Rủi ro | Kiểm soát |
| --- | --- |
| Nhầm nhóm làm việc với nhóm công việc | Tên UI, bảng và mô tả riêng; bucket luôn hiển thị dưới phạm vi |
| Giao hàng loạt gây spam | Preview, xác nhận, notification dedupe/cooldown, rollout R1B |
| Thành viên nhóm đổi làm task âm thầm đổi người | Snapshot và đồng bộ chủ động có diff |
| Multi-assignee làm mờ trách nhiệm | Assignment/SLA theo người, hiển thị tỷ lệ đã nhận và actor history |
| Chuyển việc để né quá hạn | Giữ deadline task, lưu chuỗi transfer và KPI assignment riêng |
| Manager xem quá nhiều dữ liệu | Projection KPI redaction; subject access tách khỏi KPI access |
| Mention làm rò quyền | Mention picker theo quyền; mention không tạo grant |
| AI tạo việc sai/phạm vi rộng | Command allowlist, actor scope, preview/confirm, idempotency, audit |
| Ảnh/file làm chậm hệ thống | Transform variants, lazy load, private Storage, cleanup job |
| Dashboard khuyến khích chạy theo số lượng | Không xếp hạng task count; kết hợp SLA, chất lượng và ngữ cảnh |

## 28. Điều kiện để chuyển sang kế hoạch triển khai

Sau khi tài liệu này được duyệt, kế hoạch triển khai phải:

1. Khảo sát lại schema/RPC/policy thật trên Supabase Cloud trước khi chốt migration.
2. Tách lát cắt R1A thành các bước test-first có checkpoint quyền và rollback.
3. Không sửa hoặc dùng lại `project_tasks` cho Vioo Work.
4. Tái sử dụng `org_units`, `projects`, `work_groups`, manager resolver, notification/outbox và Storage primitives chỉ sau khi xác nhận contract hiện có.
5. Thiết kế index/query từ các truy vấn action inbox, task list, detail và recipient resolver thực tế.
6. Bao gồm test RLS/RPC bằng JWT của từng persona và kiểm tra direct API bypass.
7. Chỉ lập chi tiết R1B/R2/R3 sau khi contract R1A ổn định, nhưng schema R1A không được khóa đường mở rộng đã nêu.
