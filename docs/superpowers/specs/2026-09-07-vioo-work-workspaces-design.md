# Vioo Work — Workspace: bổ sung thiết kế đã thống nhất

Ngày: 2026-09-07. Người dùng đã đồng ý mô hình Workspace liên kết phòng ban/dự án,
thành viên riêng, gợi ý nhân sự từ tổ chức và dashboard dạng thẻ trực quan.
Tài liệu này ghi lại quyết định nghiệp vụ và các mặc định kỹ thuật đề xuất cho
kế hoạch triển khai; chưa phải bằng chứng các chức năng đã được xây.

Kế thừa [thiết kế R1A](2026-09-05-vioo-work-task-management-design.md).
Kế hoạch: [Workspace implementation plan](../plans/2026-09-07-vioo-work-workspaces.md).
Các quy tắc dưới đây thay thế cách R1A chỉ dùng department/project scope cho
không gian đã chuyển đổi. Vòng đời task, assignment, quyền nội dung hạn chế,
Storage riêng tư, idempotency, lịch sử và SLA snapshot tiếp tục được giữ.

## 1. Mục tiêu và trải nghiệm

Dashboard cá nhân `/work` có thao tác Tạo việc cá nhân, Giao việc trực tiếp,
Việc cần tôi xử lý và khu vực Không gian của tôi. Mỗi Workspace là một thẻ có
màu/ảnh minh họa được đóng gói sẵn, biểu tượng, tên, loại, ảnh đại diện thành viên
và số việc người đang xem được phép biết. Tìm kiếm, lọc Phòng ban / Dự án /
Cộng tác, ghim và truy cập gần đây giúp chọn nhanh như một menu.

Vào Workspace thấy toàn bộ việc thông thường được phép xem, bộ lọc nhóm việc,
người xử lý, trạng thái; tạo việc mặc định đúng không gian. Thành viên và Cấu hình
là các tab trong không gian. Liên kết task cũ `/work/tasks/:taskCode` giữ nguyên.
Dashboard ưu tiên công việc cần hành động, không biến thành bảng xếp hạng nhân sự.

## 2. Ba loại Workspace

| Loại | Liên kết nguồn | Quy tắc |
| --- | --- | --- |
| Phòng ban | Một `org_units.id` | Một Workspace chính cho một đơn vị, kể cả khi lưu trữ; có thể kích hoạt lại |
| Dự án | Một `projects.id` | Một Workspace chính cho một dự án |
| Cộng tác | Không bắt buộc nguồn | Dành cho nhóm liên phòng hoặc mục tiêu riêng; không tạo đơn vị tổ chức giả |

Tên nguồn chính thức được đọc từ liên kết bền vững theo ID; tên hiển thị, mô tả,
icon và màu của Workspace được quản lý riêng và ghi rõ đơn vị/dự án liên kết.
Nguồn đổi tên không làm mất liên kết. Không được đổi nguồn của một Workspace
sau khi tạo; muốn tổ chức lại cần một quy trình chuyển công việc riêng.
Nhóm việc chỉ là phân loại bên trong Workspace, không có tập thành viên riêng.
Không gian được lưu trữ thay vì xóa, giữ task, file, bình luận và lịch sử.

## 3. Thành viên và quyền

Hai vai trò ban đầu: quản trị viên và thành viên. Người có quyền tạo Workspace
trở thành quản trị viên đầu tiên trong cùng giao dịch. Tạo không gian là quyền
nghiệp vụ được cấp rõ, không suy ra từ vai trò kỹ thuật ADMIN.

| Hành vi | Quản trị viên | Thành viên |
| --- | --- | --- |
| Xem task thông thường trong Workspace | Có | Có |
| Tạo/giao task cho thành viên đủ điều kiện | Có | Có |
| Nhận, làm, nộp kết quả | Theo assignment | Theo assignment |
| Duyệt kết quả | Khi là người đánh giá hợp lệ | Khi là người đánh giá hợp lệ |
| Quản lý task toàn Workspace | Có, theo command và lý do | Không |
| Sửa nhóm việc, lịch/SLA, hình thức Workspace | Có | Không |
| Thêm/bớt người, đổi vai trò, lưu trữ | Có | Không |
| Xem task hạn chế | Theo quan hệ/quyền nội dung riêng | Theo quan hệ/quyền nội dung riêng |

Thành viên đang hoạt động là điều kiện bắt buộc với task Workspace, kể cả khi
còn grant global/department/project cũ. Vai trò tạo ra nguồn quyền trong hệ thống
phân quyền hiện hành, không xây một cơ chế kiểm quyền khác ở frontend. Không
sao chép hàng loạt direct grants cho mỗi lần thêm thành viên. Module access có
thể được suy ra từ membership đang hiệu lực nhưng không cấp quyền ngoài Work.

Được xem cả không gian không đồng nghĩa được giao tất cả task. Thêm/bớt thành viên
không tự sửa assignment, reviewer, deadline hoặc SLA đã ghi nhận.

Không cho chủ động xóa/hạ vai trò quản trị viên cuối cùng. Không cho xóa một người
còn assignment hoặc trách nhiệm đánh giá đang mở trước khi xử lý bàn giao. Tài
khoản bị khóa/nghỉ việc mất quyền ngay dù còn nhiệm vụ; quản trị viên nhận danh
sách nhiệm vụ cần giải quyết. Trường hợp không còn quản trị viên hoạt động do khóa
hoặc hết hạn phải có quyền khôi phục được cấp riêng và audit, không dùng ADMIN
fallback để đọc task. Không cho xóa audit khi thu hồi membership.

## 4. Gợi ý từ tổ chức

Workspace phòng ban ưu tiên quan hệ vị trí/phân công nhân sự đang hiệu lực;
Workspace dự án ưu tiên phân công dự án hiện hành. Dùng bộ phân giải tổ chức
hiện có, không suy từ chức danh hoặc tự chọn giữa `department_id`/`org_unit_id`.
Một người có nhiều vị trí phải được gộp theo tài khoản ứng dụng.

Gợi ý chỉ trả tên, avatar, vị trí/đơn vị hiển thị, tình trạng tài khoản và nguồn
gợi ý cần thiết. Không mở hồ sơ HRM, lương, ngày sinh hay quyền tài chính. Người
chưa có tài khoản, bị khóa hoặc đã là thành viên được đánh dấu rõ, không chọn nhầm.
Có tìm người từ phòng khác trong danh bạ tài khoản cộng tác được phép tra cứu.

“Chọn tất cả” phải nói rõ chọn toàn bộ tập kết quả hợp lệ hay chỉ trang hiện tại.
Batch tối đa 100 người mỗi lần, có preview đầy đủ, loại trùng và fingerprint trước
khi ghi. Không im lặng bỏ người ở trang sau. Batch quá lớn phải yêu cầu chia nhỏ.

Không tự đồng bộ quyền khi tổ chức thay đổi. Quản trị viên chủ động Đối chiếu:
nhìn thấy người được gợi ý thêm, người nguồn đã đổi, người thêm thủ công cần giữ.
Chỉ các thay đổi đã chọn mới được áp dụng; preview cũ phải tính lại. Người được
mời liên phòng không bị gỡ chỉ vì không thuộc nguồn phòng ban.

## 5. Trực tiếp và cấu hình

Task trực tiếp vẫn độc lập, `workspace_id` rỗng. Quyền tạo việc trực tiếp và lịch
mặc định cho trực tiếp được kiểm tra riêng; membership không tự cấp quyền giao
việc trực tiếp cho toàn công ty. Nút dashboard phải phản ánh quyền thực tế và
nói rõ nếu lịch cho trực tiếp chưa được cấu hình.

Workspace có nhóm việc, lịch, ngày ngoại lệ và chính sách SLA của mình. Dùng lại
Task 10; không đổi hạn task cũ khi đổi lịch. Workspace mới cần chọn/sao chép một
lịch tin cậy hoặc cấu hình lịch trước khi tạo task, không ngầm áp lịch pilot cho
mọi nhóm. Lịch pilot đã chốt: thứ Hai–thứ Bảy, 08:00–12:00 và 13:00–17:00,
Asia/Ho_Chi_Minh; ACK normal/important/urgent = 480/240/60 phút làm việc.

## 6. Chuyển đổi và phạm vi phát hành

Giữ code/ID task, nhóm việc, calendar/policy ID, assignment, file, lịch sử và các
SLA snapshot. Thêm quan hệ Workspace trước, chuyển đường kiểm quyền sau khi dữ
liệu và client sẵn sàng. Không suy ra toàn bộ nhân sự HRM là thành viên của
Workspace. Danh sách chuyển đổi phải nêu rõ ai có thể xem các task standard.

Pilot hiện tại: admin@khoviet.vn là quản trị viên và sonpn@tienthinhjsc.vn là
thành viên Phòng Quản lý dự án; giữ hạn quyền 2026-09-21T07:02:36.939209Z khi chuyển.
Môi trường xem thử là dev worktree tại port 5187, Supabase Cloud hiện có.
Lần kiểm tra trước có 0 task; lúc thực hiện phải kiểm tra lại vì người dùng có thể
đang tạo việc trên dev. Không được dựa vào số 0 cũ để xóa hoặc reset dữ liệu.

Ảnh thẻ dùng asset cục bộ/preset trước; chưa bổ sung upload ảnh bìa, drag-and-drop
board, chat, lịch họp, nhóm quyền tùy biến hay automation. Dashboard mới không
thay thế bảng tiến độ/Gantt của dự án. Thông báo thật và quan sát 48 giờ chỉ bắt
đầu khi đã thống nhất mở checkpoint đó; phiên xem UI hiện tại vẫn tắt delivery.
