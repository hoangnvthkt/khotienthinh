# Thiết kế phân quyền VIEW - Quan hệ - Assignment cho Vioo

Ngày duyệt thiết kế: 2026-07-21
Phạm vi ưu tiên: **Dự án → Quy trình → Yêu cầu**

## 1. Mục tiêu

Đơn giản hóa mô hình phân quyền Vioo theo hình ảnh chìa khóa và ngôi nhà:

- `VIEW App` là chìa khóa vào một App.
- Quan hệ với hồ sơ hoặc phạm vi quyết định user được xem dữ liệu nào.
- Assignment quyết định user đang chịu trách nhiệm xử lý việc gì.
- Trạng thái workflow quyết định action nào hợp lệ tại thời điểm hiện tại.
- Backend là authority cuối cùng; frontend chỉ trình bày capability và cải thiện trải nghiệm.

Thiết kế thay thế tư duy cấp một ma trận CRUD cố định cho từng submodule. User không được CRUD toàn bộ chỉ vì có quyền vào App hoặc được giao một bước.

## 2. Quyết định đã chốt

1. Mỗi App có một quyền `VIEW` duy nhất; không dùng quyền xem riêng từng submodule làm cửa vào.
2. Không có `VIEW` thì user không thấy App, không gọi được API nghiệp vụ và không đủ điều kiện nhận assignment.
3. Ứng viên thiếu `VIEW` vẫn hiển thị mờ trong bộ chọn người để giải thích vì sao không thể chọn.
4. Assignment đang chạy không tự hủy khi user mất `VIEW`; nó chuyển sang trạng thái bị chặn do thiếu quyền.
5. Cấp lại `VIEW` làm assignment có thể hoạt động trở lại; quản trị viên cũng có thể giao lại người khác.
6. `VIEW Dự án` chỉ mở App Dự án; membership hoặc assignment mới mở từng dự án cụ thể.
7. Workflow nhúng trong một App nghiệp vụ dùng `VIEW` của App chủ quản, không bắt user có thêm `VIEW Quy trình`.
8. Chỉ assignee hiện tại được thực hiện action của bước hiện tại.
9. `Trả lại` luôn có nghĩa quay về bước trước; không dùng từ này cho kết thúc thất bại.
10. Mọi bước đều có action `Đánh dấu Thất bại`; action này bắt buộc nhập lý do và kết thúc workflow ngay.
11. Chỉ assignee hiện tại được đánh dấu thất bại. Workflow admin chỉ giao lại; override đặc biệt phải có lý do và audit.
12. Chỉ người tạo được xóa khi hồ sơ đang ở bước tạo ban đầu và là Nháp hoặc đã được trả về bước tạo.
13. `Hoàn thành` và `Thất bại` đều là trạng thái cuối, giữ hồ sơ và lịch sử, không được xóa.
14. Các nhãn `Từ chối` hiện có trong App Quy trình và App Yêu cầu được đổi thành `Đánh dấu Thất bại`.

## 3. Phạm vi và không nằm trong phạm vi

### 3.1 Trong phạm vi

- Cổng `VIEW` cấp App.
- Quan hệ creator, member, assignee, watcher và manager.
- Điều kiện hợp lệ khi chọn assignee.
- Assignment bị chặn khi mất quyền.
- Quy tắc action theo bước và trạng thái.
- Chuẩn hóa `Trả lại`, `Hoàn thành`, `Thất bại`.
- Backend authorization, audit, notification và lỗi người dùng.
- Rollout lần lượt cho Dự án, Quy trình và Yêu cầu.

### 3.2 Không nằm trong phạm vi đầu tiên

- Rollout ngay sang HRM, WMS, Tài sản, Hợp đồng hoặc toàn ERP.
- Xóa hàng loạt các trường permission legacy trong một migration.
- Thiết kế lại hoàn toàn workflow builder hoặc giao diện các App.
- Cho phép link nội bộ tự cấp quyền truy cập.
- Cấp CRUD toàn cục cho manager hoặc admin để bỏ qua workflow invariant.

## 4. Mô hình khái niệm

### 4.1 App chủ quản

Mỗi subject có một `host_application`:

| App chủ quản | Cổng VIEW nghiệp vụ |
| --- | --- |
| `PROJECT` | `VIEW Dự án` |
| `WORKFLOW` | `VIEW Quy trình` |
| `REQUEST` | `VIEW Yêu cầu` |

Trong giai đoạn chuyển tiếp, backend có thể ánh xạ các tên nghiệp vụ trên vào permission code hiện có như `system.da.view`, `system.wf.view` và `system.rq.view`. UI chỉ hiển thị tên đơn giản `VIEW`.

Workflow engine không tự trở thành App chủ quản. Ví dụ workflow của đề xuất vật tư có `host_application = PROJECT`; assignee chỉ cần `VIEW Dự án`, không cần `VIEW Quy trình`.

### 4.2 Các quan hệ chuẩn

| Quan hệ | Ý nghĩa |
| --- | --- |
| `CREATOR` | Người tạo/chủ sở hữu hồ sơ |
| `MEMBER` | Thành viên dự án hoặc phạm vi nghiệp vụ |
| `ASSIGNEE` | Người đang hoặc đã được giao một bước |
| `WATCHER` | Người theo dõi hồ sơ, không có workflow action |
| `MANAGER` | Người quản lý một phạm vi cụ thể |

Quan hệ không thay thế `VIEW`. Một user có relationship nhưng mất `VIEW` vẫn bị từ chối truy cập.

### 4.3 Chuỗi quyết định quyền

Mọi yêu cầu xem hoặc hành động phải đi qua đúng thứ tự:

```text
Tài khoản hoạt động
→ có VIEW App chủ quản
→ có quan hệ với subject/phạm vi
→ nếu là workflow action: có assignment active tại bước hiện tại
→ assignment không bị chặn
→ workflow state cho phép action
→ dữ liệu đầu vào hợp lệ
```

Thiếu bất kỳ điều kiện nào thì backend từ chối.

## 5. Quyền xem và hành động

### 5.1 Quyền xem

User được xem subject nếu:

- Có `VIEW` của App chủ quản; và
- Là creator, member, assignee, watcher hoặc manager đúng phạm vi.

Một assignee đã hoàn tất bước vẫn có thể xem lịch sử subject nếu `VIEW` còn hiệu lực. User bị gỡ khỏi watcher hoặc membership sẽ mất quan hệ xem nếu không còn quan hệ hợp lệ khác.

### 5.2 Tạo

- User phải có `VIEW` App.
- Với Dự án, user phải có membership phù hợp tại dự án cần tạo hồ sơ.
- Subject mới bắt đầu tại bước tạo ban đầu và creator relationship được ghi ngay.

### 5.3 Sửa

- Creator được sửa nội dung gốc khi subject là Nháp hoặc đã được trả về bước tạo ban đầu.
- Assignee chỉ sửa dữ liệu thuộc trách nhiệm của bước hiện tại.
- Assignee không được sửa các trường thuộc bước tạo hoặc bước khác chỉ vì có assignment.
- Manager không tự động được sửa nội dung nghiệp vụ; manager quản lý phạm vi, assignment và ngoại lệ.

### 5.4 Xóa

Xóa chỉ hợp lệ khi đồng thời thỏa mãn:

```text
actor là creator
AND current step là bước tạo ban đầu
AND trạng thái là Nháp hoặc Đã trả về bước tạo
AND chưa phát sinh hậu quả nghiệp vụ không thể hoàn tác
```

Assignee, watcher và manager không được xóa subject. Subject đã Hoàn thành hoặc Thất bại chỉ có thể được lưu trữ/ẩn khỏi danh sách mặc định, không hard-delete qua nghiệp vụ.

### 5.5 Action workflow

Các action chuẩn:

| Action | Kết quả |
| --- | --- |
| `Đi tiếp` | Đóng assignment hiện tại, chuyển bước và tạo assignment kế tiếp |
| `Trả lại` | Đóng assignment hiện tại, quay về bước trước và tạo assignment cho bước đó |
| `Hoàn thành` | Kết thúc thành công, đóng toàn bộ assignment |
| `Đánh dấu Thất bại` | Kết thúc không thành công, bắt buộc lý do, đóng toàn bộ assignment |

Không có action kết thúc tên `Từ chối`. Các trạng thái nội bộ legacy `REJECTED` được đọc/hiển thị như `Thất bại` trong giai đoạn chuyển tiếp và có thể chuẩn hóa dần sang `FAILED`.

## 6. Assignment và điều kiện nhận việc

### 6.1 Candidate picker

Candidate hợp lệ phải:

- Có tài khoản hoạt động.
- Có `VIEW` App chủ quản.
- Phù hợp với scope, membership hoặc eligibility rule của bước.

Candidate thiếu `VIEW`:

- Vẫn xuất hiện trong danh sách.
- Hiển thị mờ và không thể chọn.
- Có lý do cụ thể, ví dụ `Chưa có quyền truy cập App Dự án`.
- Tự trở lại trạng thái có thể chọn khi `VIEW` được cấp lại.

Frontend chỉ phản ánh eligibility. Backend phải kiểm tra lại tại thời điểm gửi.

### 6.2 Tạo assignment nguyên tử

Chuyển bước và tạo assignment phải cùng một transaction:

1. Lock subject/workflow runtime hiện tại.
2. Xác nhận actor là assignee active của bước.
3. Xác nhận candidate bước sau còn đủ điều kiện.
4. Đóng assignment hiện tại.
5. Chuyển bước.
6. Tạo assignment bước sau.
7. Ghi audit và domain event.

Nếu bất kỳ bước nào lỗi, toàn bộ transaction rollback.

### 6.3 Mất VIEW trong lúc đang xử lý

Khi assignee mất `VIEW`:

- Effective assignment state trở thành `BLOCKED_MISSING_VIEW`.
- User không được xem hoặc thực hiện action.
- Subject hiển thị cảnh báo cho creator/manager phù hợp.
- Cấp lại `VIEW` khôi phục khả năng xử lý nếu assignment chưa bị giao lại hoặc đóng.
- Manager có thể reassign cho candidate hợp lệ khác.

Authorization luôn kiểm tra `VIEW` động để fail-closed, kể cả khi reconciliation cập nhật trạng thái assignment bị trễ. Mọi lần block, restore hoặc reassign đều ghi event audit.

## 7. Workflow lifecycle

### 7.1 Trả lại

- `Trả lại` chỉ quay về bước trước.
- Workflow tiếp tục chạy.
- Assignment hiện tại đóng và assignment mới được tạo ở bước trước.
- Khi quay về bước tạo ban đầu, creator lấy lại quyền sửa và xóa theo điều kiện mục 5.4.

### 7.2 Đánh dấu Thất bại

- Xuất hiện ở mọi bước xử lý.
- Chỉ assignee hiện tại được dùng.
- Bắt buộc nhập lý do không rỗng.
- Workflow đi thẳng tới terminal state `FAILED`.
- Bỏ qua các bước phía sau và đóng toàn bộ assignment.
- Giữ subject, lý do và timeline để audit.
- Gửi thông báo cho creator và watcher.

### 7.3 Override quản trị

Workflow admin/manager không được dùng action thất bại thay assignee theo luồng thông thường. Họ có thể:

- Reassign cho người khác; hoặc
- Dùng override đặc biệt nếu được phép, bắt buộc nhập lý do và tạo audit event riêng.

Admin không được direct-update trạng thái workflow để bỏ qua invariant.

## 8. Áp dụng theo App

### 8.1 Dự án — ưu tiên 1

`VIEW Dự án` chỉ mở App. User thấy một dự án khi có ít nhất một trong các quan hệ mở dự án:

- Project membership.
- Assignment hiện tại hoặc lịch sử trên subject thuộc dự án.

Project manager là một loại membership có thêm capability quản lý, không phải đường mở dự án thứ ba. Creator và watcher chỉ quyết định subject nào được thấy bên trong dự án; hai quan hệ này không tự mở cả dự án khi user không có membership hoặc assignment. User chưa có membership hay assignment nào có thể mở App nhưng danh sách dự án trống.

Rollout trong Dự án theo thứ tự:

1. Nhật ký công trường.
2. Đề xuất vật tư.
3. Đơn hàng PO.

Nhật ký công trường dùng các quan hệ creator, current verifier/approver, watcher và project/site manager. Đề xuất vật tư và PO dùng creator, current assignee, watcher và project/material responsibility. Mỗi bước chỉ sở hữu các trường và action cần thiết cho trách nhiệm đó.

### 8.2 Quy trình — ưu tiên 2

App Quy trình chỉ quản lý workflow độc lập có `host_application = WORKFLOW`:

- `VIEW Quy trình` mở App.
- User thấy instance mình tạo, được giao hoặc theo dõi.
- Template manager được cấu hình theo template và phải có `VIEW Quy trình`.
- Assignee xử lý bước hiện tại; watcher chỉ xem.
- Toàn bộ nhãn/hành động kết thúc `Từ chối` đổi thành `Đánh dấu Thất bại`.

Workflow nhúng trong Dự án hoặc Yêu cầu không bắt user có `VIEW Quy trình`.

### 8.3 Yêu cầu — ưu tiên 3

- `VIEW Yêu cầu` mở App.
- User tạo yêu cầu từ danh mục/mẫu đang hoạt động.
- User thấy yêu cầu mình tạo, được giao hoặc theo dõi.
- Category/template manager là quan hệ quản trị riêng và phải có `VIEW Yêu cầu`.
- Assignee xử lý bước hiện tại; watcher chỉ xem.
- `Từ chối` đổi thành `Đánh dấu Thất bại`.

## 9. Backend authority và giao diện

### 9.1 Backend

Backend phải cung cấp các quyết định nhất quán cho direct URL, REST/RLS và RPC:

- `can_view_app(actor, host_application)`
- `can_view_subject(actor, subject)`
- `can_act_on_subject(actor, subject, action)`
- `list_assignment_candidates(subject, next_step)`
- Transaction/RPC transition workflow

Tên function là khái niệm; implementation plan sẽ đối chiếu và mở rộng các function hiện có thay vì mặc định tạo hệ thống song song.

### 9.2 Frontend

Frontend:

- Ẩn App khi không có `VIEW`.
- Chỉ tải dữ liệu subject mà backend cho phép.
- Hiển thị candidate disabled cùng lý do.
- Hiển thị trạng thái `Bị chặn do thiếu quyền` và hành động dành cho manager.
- Hiển thị action theo capability backend trả về.
- Không tự suy luận hoặc tự cấp quyền từ route/link.

## 10. Lỗi và phản hồi người dùng

Thông báo phải chỉ ra điều kiện không đạt:

- `Bạn đã bị thu hồi quyền truy cập App.`
- `Công việc đang bị chặn do người xử lý thiếu quyền.`
- `Hồ sơ đã được người khác xử lý trước đó.`
- `Người được chọn không còn đủ điều kiện nhận việc.`
- `Bắt buộc nhập lý do khi đánh dấu thất bại.`
- `Chỉ người tạo được xóa khi hồ sơ ở bước tạo ban đầu.`

Không trả lỗi chung `Không có quyền` khi backend biết nguyên nhân cụ thể.

## 11. Audit và notification

Audit tối thiểu phải ghi:

- Cấp/thu hồi/khôi phục `VIEW`.
- Assignment created, blocked, restored, completed, returned, reassigned hoặc cancelled.
- Workflow đi tiếp, trả lại, hoàn thành, thất bại hoặc override.
- Actor, subject, bước, lý do, timestamp và trước/sau.

Notification đi theo quan hệ và assignment:

- Bước mới → assignee mới.
- Trả về bước tạo → creator.
- Hoàn thành → creator và watcher.
- Thất bại → creator và watcher, kèm lý do.
- Assignment bị chặn → creator và manager phù hợp.

Không broadcast cho toàn bộ user có cùng permission.

## 12. Kiểm thử chấp nhận

### 12.1 VIEW và quan hệ

- Không có `VIEW` thì không mở được App bằng menu, URL, REST hoặc RPC.
- Có `VIEW Dự án` nhưng không có membership/assignment thì danh sách dự án trống.
- Assignment của subject Dự án không yêu cầu thêm `VIEW Quy trình`.
- Watcher chỉ xem và không có workflow action.

### 12.2 Assignment

- Candidate thiếu `VIEW` hiển thị mờ và backend từ chối nếu payload bị giả mạo.
- Thu hồi `VIEW` làm assignment bị chặn ngay về mặt authorization.
- Cấp lại `VIEW` khôi phục assignment chưa bị đóng/giao lại.
- User có permission tương tự nhưng không được assign không thể xử lý.
- Hai actor xử lý cùng một bước đồng thời: chỉ transaction đầu tiên thành công.

### 12.3 Workflow lifecycle

- Trả lại đúng bước trước và tạo assignment đúng người.
- Trả về bước tạo mở lại quyền sửa/xóa cho creator.
- Creator không xóa được khi subject đang ở bước khác.
- Hoàn thành và Thất bại đều đóng toàn bộ assignment.
- Đánh dấu Thất bại thiếu lý do bị backend chặn.
- Manager không thể đánh dấu thất bại theo luồng thường nếu không phải assignee.
- UI không còn dùng `Từ chối` cho terminal failure trong Quy trình và Yêu cầu.

### 12.4 Audit và notification

- Mỗi transition sinh đúng audit event.
- Notification chỉ gửi cho assignee/creator/watcher/manager liên quan.
- Reassign và override ghi actor cùng lý do.

## 13. Chiến lược rollout

1. Audit thực trạng permission, relationship, assignment và workflow state của phạm vi pilot.
2. Chuẩn hóa cổng `VIEW Dự án` nhưng giữ adapter legacy trong giai đoạn chuyển tiếp.
3. Mở rộng Daily Log pilot thành chuẩn candidate/block/return/failure chung.
4. Rollout Đề xuất vật tư.
5. Rollout PO.
6. Rollout workflow độc lập.
7. Rollout Yêu cầu.
8. Chỉ khi ba App ổn định mới thiết kế rollout HRM và các App còn lại.

Mỗi phase phải có contract tests, kiểm tra RLS/RPC thật, theo dõi production logs và rollback strategy riêng. Không rollout toàn ERP trong một migration lớn.

## 14. Tiêu chí thành công

- Người dùng có thể giải thích quyền bằng ba câu: vào được App nào, liên quan hồ sơ nào, đang được giao bước nào.
- Không còn trường hợp menu bị ẩn nhưng API vẫn trả dữ liệu vượt phạm vi.
- Không thể giao việc cho user thiếu `VIEW`.
- Thu hồi `VIEW` chặn hành động đang chạy mà không làm mất assignment hoặc lịch sử.
- Workflow Dự án dùng engine chung nhưng không buộc user có `VIEW Quy trình`.
- Không còn dùng `Từ chối` để biểu diễn terminal failure.
- Quyền hành động luôn do backend kiểm tra từ `VIEW + relationship + assignment + state`.
