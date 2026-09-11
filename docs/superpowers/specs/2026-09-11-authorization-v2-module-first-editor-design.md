# Authorization V2 — Trình phân quyền theo Module

Ngày: 2026-09-11. Trạng thái: **đề xuất thiết kế để duyệt**.

Tài liệu này chốt hướng UX đã được thống nhất: màn hình chỉ trình bày các Module
đang hoạt động; tích một Module sẽ tự chọn toàn bộ gói quyền **Xem** hợp lệ của
các phân hệ bên trong và mở phần chi tiết. Người quản trị có thể tinh chỉnh quyền
nghiệp vụ, sau đó bấm Lưu. Đây là đặc tả thiết kế, chưa phải xác nhận đã triển khai.

## 1. Mục tiêu và nguyên tắc

- Một thao tác phổ biến phải ngắn: chọn người → tích Module → kiểm tra phạm vi → Lưu.
- Module là tầng điều hướng chính. Phân hệ và action chỉ xuất hiện khi mở chi tiết.
- Tích Module không cấp mọi action; chỉ cấp gói **Xem** đã được hệ thống khai báo
  rõ. Các quyền tạo, sửa, xóa, duyệt, quản trị vẫn phải chọn riêng.
- Quyền kế thừa từ vai trò/nghiệp vụ được hiển thị khóa và nêu nguồn; direct grant
  chỉ dùng để bổ sung ngoại lệ cho từng người.
- UI giúp người dùng tránh lỗi nhưng RPC/database tiếp tục là nơi quyết định cuối
  cùng. Không dựa vào việc ẩn nút để bảo vệ dữ liệu.
- Room trong Dự án vẫn được quản trị tại từng dự án; không trộn Room vào ma trận
  Module của người dùng.

## 2. Ngôn ngữ hiển thị

Trong code hiện tại, tầng `application` tương ứng với khái niệm người dùng đang
gọi là **Module** (ví dụ Nhân sự, Tài sản, Dự án). Tầng `module` trong registry là
**phân hệ** (ví dụ Danh mục tài sản, Cấp phát, Bảo trì). UI mới dùng đúng ngôn ngữ
nghiệp vụ này; tên kỹ thuật và permission code chỉ hiện trong vùng hỗ trợ quản trị.

Chỉ hiển thị Module/phân hệ/action còn active và có ít nhất một capability có thể
sử dụng. Legacy, retired hoặc chỉ tồn tại để tương thích dữ liệu không xuất hiện
như lựa chọn mới.

Mỗi permission chỉ thuộc một Module hiển thị, ưu tiên `access_application_code`
canonical từ catalog Cloud. Các shell `system.*` tương thích cũ không được tạo một
card Nhân sự/Tài sản thứ hai nếu đã có application nghiệp vụ tương ứng.

## 3. Bố cục và tương tác chính

Mỗi Module là một card gồm checkbox, tên, mô tả ngắn, số phân hệ được xem và trạng
thái phạm vi. Nút mũi tên mở/đóng chi tiết độc lập với checkbox để tránh nhầm thao
tác xem chi tiết với cấp quyền.

### Khi tích Module

1. Hệ thống mở card.
2. Hệ thống thêm toàn bộ item trong gói **Xem mặc định** của Module tại phạm vi
   đang chọn.
3. Mỗi phân hệ được chọn hiển thị rõ quyền Xem; phần “Quyền nâng cao” vẫn đóng.
4. Thanh tóm tắt ghi số quyền vừa thêm và trạng thái “Chưa lưu”.

Gói Xem không được suy đoán bằng chuỗi `view`, vì một số phân hệ có `view_own`,
`view_all` hoặc dữ liệu nhạy cảm. Mỗi item phải được khai báo tường minh và chỉ
được đưa vào gói nếu action active, direct-assignable, hỗ trợ đúng scope và không
yêu cầu cấp qua template. Ví dụ Module Tài sản gồm các quyền Xem hợp lệ của Danh
mục, Cấp phát, Bảo trì và Kiểm kê; không tự chọn quyền duyệt cấp phát.

### Trạng thái checkbox

- **Bỏ chọn:** chưa có direct grant thuộc gói Xem ở phạm vi đang xét.
- **Đã chọn:** đủ toàn bộ direct grant thuộc gói Xem.
- **Một phần:** chỉ có một phần gói Xem, có cấu hình tùy chỉnh, hoặc còn quyền kế
  thừa mà checkbox không được phép xóa.
- Nhãn `Kế thừa` nêu vai trò/template tạo ra quyền. Quyền kế thừa không bị xóa khi
  người quản trị bỏ chọn direct grant.

Khi bỏ chọn Module, hệ thống chuẩn bị xóa các direct grant của chính Module ở phạm
vi đang xét. Nếu Module còn quyền nâng cao, UI phải xác nhận rõ số quyền sẽ bị xóa;
không âm thầm để lại quyền ghi mà thiếu quyền Xem. Quyền kế thừa được giữ nguyên và
Module chuyển sang trạng thái Một phần/Kế thừa tương ứng.

### Chi tiết phân hệ

- Dòng đầu của mỗi phân hệ là quyền Xem và phạm vi áp dụng.
- “Quyền nâng cao” mở các action Tạo/Sửa/Xóa/Gửi/Kiểm tra/Duyệt/Xác nhận/Quản trị.
- Action nhạy cảm có badge cảnh báo. Nếu database yêu cầu thời hạn, trường ngày hết
  hạn xuất hiện ngay cạnh action và phải là thời điểm tương lai.
- Action chỉ cấp qua vai trò/template được hiển thị read-only cùng chỉ dẫn đúng nơi
  cần cấp, hoặc ẩn khỏi direct-grant picker nếu không mang giá trị giải thích.
- Các lựa chọn không hỗ trợ scope hiện tại bị khóa và giải thích bằng ngôn ngữ
  nghiệp vụ, không chỉ hiển thị chữ `Scope`.

## 4. Phạm vi và mô hình vai trò

Phạm vi được chọn bằng nhãn dễ hiểu: Toàn công ty, Chính mình, Được phân công, Dự
án, Công trường, Kho hoặc Phòng ban. Mặc định phải lấy từ item của gói Xem, không
mặc định `global` cho mọi Module. Người quản trị có thể đổi phạm vi ở cấp Module;
phân hệ/action chỉ có override trong phần nâng cao.

Vai trò nghiệp vụ là nền quyền chuẩn; direct grant là ngoại lệ:

- Chọn một vai trò/template sẽ hiển thị các Module được cấp và đánh dấu `Kế thừa`.
- Checkbox Module không giả vờ xóa được quyền vai trò. Muốn bỏ quyền kế thừa phải
  gỡ/đổi đúng vai trò hoặc template tạo ra quyền đó.
- Vị trí nhân sự có thể gợi ý vai trò nhưng không tự động thay quyền chỉ vì tên vị
  trí thay đổi. Việc gán quyền tự động phải là chính sách riêng, có audit.
- Admin tiếp tục có toàn quyền theo cơ chế admin hiện hành; các Module view-only đã
  chốt (`material_waste`, `custom_material`, `boq_reconciliation`, `subcontract`)
  chỉ cho non-admin đọc, còn admin vẫn được ghi theo rule máy chủ.

## 5. Nguồn dữ liệu quyền đáng tin cậy

Registry TypeScript hiện tại hữu ích cho route và fallback nhưng không đủ làm nguồn
duy nhất: database còn có `risk_level`, `direct_grant_requires_expiry`,
`grant_readiness`, `scope_modes` và trạng thái active. UI mới cần catalog quản trị
được đọc từ Supabase bằng một RPC read-only, có guard quyền quản trị, trả về:

- Module, phân hệ và action active theo thứ tự;
- scope được phép, mức rủi ro, yêu cầu hạn sử dụng, trạng thái sẵn sàng;
- action có được direct grant hay bắt buộc qua template;
- item thuộc gói Xem mặc định và default scope của item;
- lý do loại trừ khi cần hiển thị read-only.

Gói Xem mặc định được lưu bằng mapping tường minh trong database, có foreign key
tới permission action và constraint scope hợp lệ. Không lấy tất cả permission có
từ “view”, không tự biến `view_all` thành quyền mặc định. Bảng/RPC ở schema public
phải bật RLS/guard phù hợp; nếu dùng privileged helper thì đặt ở `app_private`,
thu hồi PUBLIC/anon và chỉ expose wrapper tối thiểu cho authenticated administrator.

Frontend registry và catalog Cloud phải có contract test phát hiện module/action
không khớp. Khi catalog lỗi tải, màn hình không cho lưu cấu hình dựa trên dữ liệu
thiếu; hiển thị Retry thay vì dùng một ma trận cũ một cách im lặng.

## 6. Lưu, validation và thông báo lỗi

Mọi thay đổi hồ sơ và direct grants vẫn lưu nguyên tử qua
`update_user_authorization_v2`; không UPDATE bảng grant trực tiếp từ trình duyệt.
Payload chỉ chứa các grant hợp lệ sau khi chuẩn hóa và dedupe theo
`permission_code + scope_type + scope_id`.

- Nút Lưu khóa khi không có thay đổi hoặc còn action thiếu expiry/scope.
- Lý do chỉ bắt buộc khi thật sự có thay đổi và phải đạt tối thiểu 10 ký tự, đồng
  bộ với database. UI đếm ký tự và báo trước khi gửi.
- Lỗi máy chủ được ánh xạ về đúng card/action: scope không hợp lệ, direct grant bị
  chặn, thiếu hạn sử dụng, xung đột phiên bản hoặc vi phạm phân tách nhiệm vụ.
- Sau khi RPC thành công, tải lại snapshot Cloud và chỉ báo thành công khi dữ liệu
  đã lưu khớp receipt. Nếu phiên bản cũ, giữ draft và yêu cầu tải/so sánh lại.
- Thanh cuối trang luôn cho thấy tóm tắt Thêm/Xóa/Đổi phạm vi và một nút Lưu chính;
  thao tác thường không cần một bước preview riêng.

## 7. Điều hướng phải theo capability cụ thể

Editor mới không giải quyết bằng cách cho một quyền HR rộng mở nhiều route. Đồng
thời phải sửa mapping route để mỗi menu/submodule kiểm tra capability của chính nó.
Đặc biệt, `Hồ sơ & Công văn` không được hiện chỉ vì người dùng có
`hrm.master_data.view`; route hồ sơ, hợp đồng, chấm công, báo cáo và ca làm việc
phải có yêu cầu tường minh tương ứng.

Menu chỉ là lớp trải nghiệm. RLS/RPC vẫn kiểm tra lại cùng permission và scope, nên
việc ẩn menu không được coi là hàng rào dữ liệu. Trường hợp Đặng Thị Thu Hà sẽ được
dùng làm persona hồi quy: không có quyền Hồ sơ & Công văn thì không thấy menu và
không đọc được dữ liệu qua API.

## 8. Trải nghiệm responsive và accessibility

- Desktop tối đa hai cột card; mobile một cột, không nén ma trận ngang.
- Checkbox và nút mở chi tiết là hai control riêng, có label và trạng thái focus;
  vùng bấm tối thiểu 44px.
- Tìm kiếm theo tên Module/phân hệ; trạng thái lựa chọn không mất khi lọc.
- Không chỉ dùng màu để biểu thị trực tiếp/kế thừa/nhạy cảm/lỗi.
- Footer lưu không che nội dung cuối và có safe-area trên mobile.

## 9. Kiểm thử và tiêu chí nghiệm thu

### Unit và component

- Tích Module thêm đúng và đủ bundle tường minh, tự mở chi tiết, không thêm action
  ghi/duyệt hoặc permission template-only.
- Bỏ chọn xử lý đầy đủ, một phần, kế thừa và quyền nâng cao đúng quy tắc.
- Scope mặc định/override, dedupe, expiry và lý do dưới 10 ký tự đều được kiểm tra.
- Catalog lỗi/không đồng bộ khiến editor fail closed.
- Route HR dùng capability cụ thể; `hrm.master_data.view` không mở Hồ sơ & Công văn.

### Database và Cloud main

- Migration smoke xác nhận mọi bundle item active, direct-assignable, hỗ trợ default
  scope và không yêu cầu expiry nếu chưa có chính sách expiry mặc định.
- RPC catalog từ chối non-admin và không lộ dữ liệu không cần thiết.
- Transaction rollback persona xác nhận thêm Module Tài sản tạo đúng bốn quyền Xem;
  action duyệt không có expiry bị chặn với lỗi cấu trúc rõ ràng.
- Kiểm tra admin vẫn ghi được bốn phân hệ view-only; non-admin chỉ đọc.
- Kiểm tra user thường chỉ xem chấm công/bảng lương của chính mình theo RLS/RPC.

### Luồng trình duyệt

1. Với Đặng Thị Thu Hà, tích Tài sản → bốn phân hệ Xem được chọn → nhập lý do hợp
   lệ → Lưu → đăng nhập lại thấy Tài sản, không có quyền sửa/duyệt.
2. Không cấp Hồ sơ & Công văn → menu không hiện và truy cập URL trực tiếp bị chặn.
3. Quyền kế thừa hiển thị nguồn, không bị xóa bằng checkbox direct.
4. Thử ở desktop/mobile, refresh và concurrent update; không mất draft vô cớ và
   không báo thành công trước khi Cloud xác nhận.

Trước mỗi commit triển khai: chạy test liên quan; trước checkpoint: full test,
lint/build và Cloud rollback smoke. Chỉ commit các file thuộc checkpoint, không
trộn thay đổi khác trong worktree.

## 10. Triển khai theo checkpoint

1. Catalog và mapping bundle Xem trên database, migration test và Cloud smoke.
2. Model/reducer module-first theo TDD, chưa thay màn hình production.
3. UI card/accordion, scope, validation, summary và structured errors.
4. Sửa capability mapping menu HR và bổ sung test chống phantom navigation.
5. Persona QA trên Cloud main, regression security, full suite và rollout log.

Mỗi checkpoint kiểm thử và commit riêng. Không triển khai lại các Room đã cutover;
không thay RLS nghiệp vụ ngoài các lỗi được test nêu trên.

## 11. Ngoài phạm vi

- Thiết kế lại màn hình Room Dự án hoặc cutover lại 7 Room đã hoàn tất.
- Tự động cấp quyền theo tên chức danh nhân sự.
- Tắt/xóa legacy authorization ngoài checkpoint Phase 6 đã có kế hoạch riêng.
- Thay đổi quy trình chấm công, tính lương hoặc cho phép người dùng xem bảng lương
  của người khác.
