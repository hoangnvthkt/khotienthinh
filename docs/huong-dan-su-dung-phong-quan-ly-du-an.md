# Hướng dẫn sử dụng module Dự án - Phòng Quản lý dự án

Ngày lập: 2026-06-10

Phiên bản: 1.0

Đối tượng sử dụng: Phòng Quản lý dự án

Định dạng: Google Docs-ready

## 1. Mục đích tài liệu

Tài liệu này hướng dẫn user Phòng Quản lý dự án sử dụng module **Dự án** để theo dõi và quản lý toàn bộ nghiệp vụ dự án, bao gồm danh sách dự án, tiến độ, BOQ, hợp đồng, nhật ký, chất lượng, vật tư, thanh toán, dòng tiền, tài liệu và báo cáo.

Tài liệu được viết theo luồng thao tác thực tế. Mỗi nghiệp vụ có phần mục đích, điều kiện trước, dữ liệu cần chuẩn bị, các bước thực hiện, kết quả, lưu ý và lỗi thường gặp. Các vị trí cần bổ sung hình minh họa được đánh dấu bằng placeholder:

`[HÌNH MINH HỌA: Tên màn hình / thao tác cần chụp]`

Khi đưa tài liệu lên Google Docs, anh có thể dùng các dòng placeholder này làm vị trí chèn ảnh chụp màn hình.

## 2. Quy ước chung

### 2.1. Quy ước quyền sử dụng

Trong module Dự án, mỗi user có thể được cấp quyền theo module, theo tab hoặc theo quyền nghiệp vụ trong dự án.

- **Quyền xem:** user được xem dữ liệu trong tab.
- **Quyền quản trị tab:** user được tạo, sửa, xóa hoặc cập nhật trạng thái trong tab.
- **Quyền nghiệp vụ dự án:** user được phân công trong tab **Tổ chức**, ví dụ quyền xem, sửa, xóa, gửi, xác nhận, duyệt.
- **Admin:** có quyền rộng hơn user thông thường.

Nếu user không thấy một tab hoặc không thấy nút thao tác, nguyên nhân phổ biến là tài khoản chưa được cấp quyền phù hợp.

### 2.2. Quy ước trạng thái thường gặp

- **Lập kế hoạch:** dự án mới ở giai đoạn chuẩn bị.
- **Đang thi công:** dự án đang triển khai.
- **Tạm dừng:** dự án đang tạm ngưng.
- **Hoàn thành:** dự án đã hoàn tất.
- **Đã hủy:** dự án không tiếp tục triển khai.
- **Nháp:** chứng từ/phiếu mới tạo, chưa gửi xử lý.
- **Chờ duyệt / Chờ xác nhận:** chứng từ/phiếu đã gửi đến người xử lý.
- **Đã duyệt / Đã xác nhận:** chứng từ/phiếu đã được người có thẩm quyền xác nhận.
- **Trả lại:** chứng từ/phiếu cần bổ sung hoặc chỉnh sửa.

### 2.3. Quy ước nhập liệu

- Các trường có dấu `*` là bắt buộc.
- Ngày tháng nên nhập đúng định dạng ngày của hệ thống.
- Số tiền và khối lượng cần kiểm tra kỹ đơn vị tính trước khi lưu.
- Với dữ liệu dùng cho nghiệm thu, thanh toán, vật tư hoặc tiến độ, cần ưu tiên nhập theo đúng mã dự án, mã WBS, mã vật tư và hợp đồng liên quan.

## 3. Truy cập module Dự án

### Mục đích

Giúp user vào đúng module Dự án và mở màn hình quản lý dự án.

### Người thực hiện

Phòng Quản lý dự án.

### Điều kiện trước

- User đã đăng nhập hệ thống.
- User được cấp quyền sử dụng module **Dự án**.

### Dữ liệu cần chuẩn bị

Không cần chuẩn bị dữ liệu.

### Các bước thực hiện

1. Đăng nhập hệ thống.
2. Tại menu chính, chọn **Dự án**.
3. Hệ thống mở màn hình danh sách dự án.
4. Nếu dùng đường dẫn trực tiếp, truy cập route `/da`.

`[HÌNH MINH HỌA: Menu Dự án và màn hình danh sách dự án]`

### Kết quả sau khi hoàn tất

User nhìn thấy danh sách dự án và các công cụ tìm kiếm, lọc, tạo mới hoặc mở chi tiết dự án tùy quyền.

### Lưu ý

Nếu user không thấy menu **Dự án**, cần kiểm tra phân quyền module.

### Lỗi thường gặp và cách xử lý

- **Không thấy menu Dự án:** liên hệ Admin để kiểm tra quyền module DA.
- **Vào được module nhưng không thấy dữ liệu:** kiểm tra bộ lọc, quyền theo dự án hoặc trạng thái ẩn/hiện của dự án.

## 4. Quản lý danh sách dự án

### 4.1. Xem danh sách dự án

#### Mục đích

Xem toàn bộ dự án user được phân quyền để theo dõi tình trạng triển khai.

#### Người thực hiện

Phòng Quản lý dự án.

#### Điều kiện trước

User có quyền xem module Dự án.

#### Dữ liệu cần chuẩn bị

Không bắt buộc.

#### Các bước thực hiện

1. Vào menu **Dự án**.
2. Xem danh sách dự án đang hiển thị.
3. Kiểm tra các thông tin chính: mã dự án, tên dự án, trạng thái, ngày bắt đầu, ngày kết thúc, tiến độ, giá trị hợp đồng hoặc chỉ số tổng quan nếu có.
4. Bấm vào dự án cần xem để mở chi tiết.

`[HÌNH MINH HỌA: Danh sách dự án với các cột thông tin chính]`

#### Kết quả sau khi hoàn tất

User xác định được dự án cần theo dõi và mở được màn hình chi tiết.

#### Lưu ý

Danh sách có phân trang. Nếu không thấy dự án cần tìm, kiểm tra trang tiếp theo hoặc dùng ô tìm kiếm/bộ lọc.

#### Lỗi thường gặp và cách xử lý

- **Không thấy dự án mới tạo:** tải lại dữ liệu hoặc kiểm tra dự án có bị lọc theo trạng thái không.
- **Dự án bị thiếu thông tin công trường:** kiểm tra phần liên kết công trường HRM trong form dự án.

### 4.2. Tìm kiếm và lọc dự án

#### Mục đích

Tìm nhanh dự án theo mã, tên, trạng thái, nhóm, loại, lĩnh vực, workflow, liên kết công trường hoặc thời gian.

#### Người thực hiện

Phòng Quản lý dự án.

#### Điều kiện trước

User đang ở màn hình danh sách dự án.

#### Dữ liệu cần chuẩn bị

Thông tin cần tìm, ví dụ mã dự án, tên dự án, trạng thái hoặc khoảng ngày.

#### Các bước thực hiện

1. Nhập từ khóa vào ô tìm kiếm.
2. Chọn trạng thái dự án nếu cần.
3. Chọn nhóm dự án, loại dự án hoặc lĩnh vực nếu cần.
4. Chọn trạng thái liên kết công trường nếu cần.
5. Nhập khoảng ngày bắt đầu hoặc ngày kết thúc nếu cần.
6. Xem danh sách kết quả sau khi lọc.

`[HÌNH MINH HỌA: Bộ lọc danh sách dự án]`

#### Kết quả sau khi hoàn tất

Danh sách chỉ còn các dự án khớp điều kiện tìm kiếm/lọc.

#### Lưu ý

Nếu kết quả quá ít hoặc không có, hãy xóa bớt điều kiện lọc.

#### Lỗi thường gặp và cách xử lý

- **Không có kết quả:** kiểm tra chính tả từ khóa hoặc đặt trạng thái về **Tất cả**.
- **Dự án bị ẩn không hiển thị:** chỉ Admin hoặc user có quyền phù hợp mới thấy bộ lọc dự án ẩn.

### 4.3. Tạo mới dự án

#### Mục đích

Tạo hồ sơ dự án mới để bắt đầu quản lý tiến độ, ngân sách, hợp đồng, vật tư và các nghiệp vụ liên quan.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền tạo/quản trị dự án.

#### Điều kiện trước

- User có quyền quản trị module/tab dự án.
- Các danh mục nền như nhóm dự án, loại dự án, lĩnh vực hoặc công trường HRM đã được thiết lập nếu doanh nghiệp có sử dụng.

#### Dữ liệu cần chuẩn bị

- Tên dự án.
- Mã dự án.
- Nhóm/loại/lĩnh vực dự án nếu có.
- Khách hàng/chủ đầu tư.
- Công trường HRM cần liên kết nếu có.
- Người quản lý dự án.
- Ngày bắt đầu, ngày kết thúc dự kiến.
- Trạng thái dự án.
- Cách tính tiến độ.
- Danh sách user/nhóm quản trị, thực hiện, theo dõi nếu cần.

#### Các bước thực hiện

1. Tại màn hình danh sách dự án, bấm **Tạo mới** hoặc nút tương đương.
2. Nhập thông tin cơ bản: tên, mã, khách hàng, mô tả.
3. Chọn nhóm dự án, loại dự án, lĩnh vực dự án nếu có.
4. Chọn công trường HRM nếu dự án đã có công trường tương ứng.
5. Chọn người quản lý dự án.
6. Chọn trạng thái, ngày bắt đầu, ngày kết thúc.
7. Chọn phương pháp tính tiến độ phù hợp.
8. Mở phần nâng cao nếu cần gán admin, executor, watcher hoặc vị trí mặc định.
9. Kiểm tra lại thông tin.
10. Bấm **Lưu**.

`[HÌNH MINH HỌA: Form tạo mới dự án]`

#### Kết quả sau khi hoàn tất

Dự án mới được tạo và xuất hiện trong danh sách dự án.

#### Lưu ý

- Mã dự án nên thống nhất với quy chuẩn nội bộ.
- Nếu dự án cần dùng các tab Điều hành, Dòng tiền, Báo cáo, Nghiệm thu & Thanh toán, nên liên kết công trường HRM ngay từ đầu.
- Cách tính tiến độ ảnh hưởng đến phần trăm tiến độ hiển thị ở banner dự án.

#### Lỗi thường gặp và cách xử lý

- **Thiếu trường bắt buộc:** nhập đủ tên, mã và các trường hệ thống yêu cầu.
- **Không chọn được công trường:** kiểm tra công trường đã được tạo trong HRM chưa.
- **Không lưu được:** kiểm tra quyền quản trị dự án hoặc dữ liệu bị trùng mã.

### 4.4. Cập nhật thông tin dự án

#### Mục đích

Cập nhật thông tin dự án khi có thay đổi về trạng thái, tiến độ, ngày triển khai, người phụ trách hoặc thông tin mô tả.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị dự án.

#### Điều kiện trước

Dự án đã tồn tại trên hệ thống.

#### Dữ liệu cần chuẩn bị

Thông tin cần cập nhật.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Bấm nút **Dự án** hoặc nút chỉnh sửa thông tin dự án.
3. Cập nhật các trường cần thay đổi.
4. Kiểm tra lại thông tin.
5. Bấm **Lưu**.

`[HÌNH MINH HỌA: Nút chỉnh sửa dự án trong màn hình chi tiết]`

#### Kết quả sau khi hoàn tất

Thông tin dự án được cập nhật và hiển thị lại trên màn hình chi tiết/danh sách.

#### Lưu ý

Không nên thay đổi mã dự án nếu mã đã được dùng trong các báo cáo, hợp đồng hoặc file import.

#### Lỗi thường gặp và cách xử lý

- **Không thấy nút chỉnh sửa:** user chưa có quyền quản trị dự án.
- **Cập nhật xong nhưng số liệu chưa đổi:** tải lại dữ liệu hoặc kiểm tra phần dữ liệu tổng hợp từ tab liên quan.

### 4.5. Liên kết công trường HRM

#### Mục đích

Liên kết dự án với công trường HRM để dùng dữ liệu hiện trường cho Điều hành, Dòng tiền, Báo cáo, Nghiệm thu & Thanh toán và các nghiệp vụ liên quan.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị dự án.

#### Điều kiện trước

- Công trường đã được tạo trong HRM.
- User có quyền sửa dự án.

#### Dữ liệu cần chuẩn bị

Tên hoặc mã công trường HRM cần liên kết.

#### Các bước thực hiện

1. Mở form tạo/sửa dự án.
2. Tại trường công trường, chọn công trường HRM tương ứng.
3. Kiểm tra tên công trường hiển thị trong phần thông tin dự án.
4. Bấm **Lưu**.

`[HÌNH MINH HỌA: Trường chọn công trường HRM trong form dự án]`

#### Kết quả sau khi hoàn tất

Dự án được gắn với công trường. Các tab cần dữ liệu công trường có thể hoạt động đầy đủ.

#### Lưu ý

Nếu không liên kết công trường, một số tab sẽ hiển thị thông báo cần liên kết công trường HRM.

#### Lỗi thường gặp và cách xử lý

- **Không thấy công trường trong danh sách:** kiểm tra công trường đã tạo trong HRM và user có quyền xem.
- **Chọn sai công trường:** mở lại form dự án và chọn đúng công trường.

### 4.6. Ẩn và khôi phục dự án

#### Mục đích

Ẩn các dự án không còn cần hiển thị thường xuyên nhưng vẫn giữ dữ liệu để tra cứu hoặc khôi phục.

#### Người thực hiện

Admin hoặc user có quyền phù hợp.

#### Điều kiện trước

Dự án đã tồn tại và user có quyền ẩn/khôi phục.

#### Dữ liệu cần chuẩn bị

Lý do ẩn dự án nếu hệ thống yêu cầu.

#### Các bước thực hiện

1. Tại danh sách hoặc chi tiết dự án, chọn thao tác **Ẩn dự án** nếu có.
2. Kiểm tra cảnh báo ảnh hưởng dữ liệu.
3. Nhập lý do hoặc xác nhận mã dự án nếu hệ thống yêu cầu.
4. Bấm xác nhận.
5. Khi cần khôi phục, mở bộ lọc dự án ẩn và chọn **Khôi phục**.

`[HÌNH MINH HỌA: Màn hình xác nhận ẩn dự án]`

#### Kết quả sau khi hoàn tất

Dự án được ẩn khỏi danh sách mặc định hoặc được khôi phục lại danh sách.

#### Lưu ý

Ẩn dự án không phải là xóa dữ liệu. Không dùng thao tác này thay cho việc đóng dự án về mặt nghiệp vụ.

#### Lỗi thường gặp và cách xử lý

- **Không thấy nút ẩn/khôi phục:** user không có quyền.
- **Không tìm thấy dự án đã ẩn:** đổi bộ lọc hiển thị sang dự án ẩn hoặc tất cả.

## 5. Mở và sử dụng màn hình chi tiết dự án

### Mục đích

Mở màn hình chi tiết để theo dõi thông tin tổng quan và truy cập các tab nghiệp vụ của dự án.

### Người thực hiện

Phòng Quản lý dự án.

### Điều kiện trước

Dự án đã có trên hệ thống và user có quyền xem.

### Dữ liệu cần chuẩn bị

Mã hoặc tên dự án cần mở.

### Các bước thực hiện

1. Tại danh sách dự án, tìm dự án cần xem.
2. Bấm vào dự án.
3. Kiểm tra banner thông tin dự án: tên, mã, công trường, trạng thái, phần trăm tiến độ.
4. Chọn tab nghiệp vụ cần thao tác.

`[HÌNH MINH HỌA: Màn hình chi tiết dự án và thanh tab nghiệp vụ]`

### Kết quả sau khi hoàn tất

User truy cập được các tab nghiệp vụ trong phạm vi quyền được cấp.

### Lưu ý

Các tab hiển thị theo phân quyền. User có thể chỉ thấy một phần tab.

### Lỗi thường gặp và cách xử lý

- **Không thấy tab cần dùng:** liên hệ Admin để kiểm tra quyền tab trong module DA.
- **Tab báo cần liên kết công trường:** cập nhật lại công trường HRM trong thông tin dự án.

## 6. Tab Điều hành

### Mục đích

Xem dashboard điều hành dự án, bao gồm sức khỏe tiến độ, cảnh báo ưu tiên, queue chờ xử lý, rủi ro thanh toán và các chỉ số tổng hợp.

### Người thực hiện

Phòng Quản lý dự án, Ban điều hành hoặc user có quyền xem tab **Điều hành**.

### Điều kiện trước

- Dự án đã được liên kết công trường HRM.
- Dự án có dữ liệu từ tiến độ, nhật ký, hợp đồng, nghiệm thu, vật tư hoặc thanh toán để dashboard tổng hợp.

### Dữ liệu cần chuẩn bị

Không nhập trực tiếp tại tab này. Dữ liệu được tổng hợp từ các tab nghiệp vụ.

### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Điều hành**.
3. Xem các thẻ chỉ số tổng quan.
4. Kiểm tra phần **Yêu cầu chờ xử lý** để biết số lượng chứng từ/phiếu cần xử lý.
5. Kiểm tra phần **Cảnh báo ưu tiên** để xử lý các vấn đề trọng yếu.
6. Xem phần sức khỏe tiến độ để so sánh kế hoạch và thực tế.
7. Mở các tab liên quan nếu cần xử lý chi tiết.

`[HÌNH MINH HỌA: Tab Điều hành - dashboard tổng quan]`

### Kết quả sau khi hoàn tất

User nắm được tình trạng chung của dự án và các điểm cần ưu tiên xử lý.

### Lưu ý

Tab Điều hành là màn hình tổng hợp, không thay thế việc nhập liệu ở các tab chuyên môn.

### Lỗi thường gặp và cách xử lý

- **Dashboard không có dữ liệu:** kiểm tra dự án đã liên kết công trường và đã có dữ liệu nghiệp vụ chưa.
- **Số liệu chưa đúng kỳ vọng:** kiểm tra dữ liệu nguồn ở Tiến độ, Nhật ký, Hợp đồng, Vật tư, Thanh toán.

## 7. Tab Tổ chức

### 7.1. Xem sơ đồ nhân sự dự án

#### Mục đích

Xem danh sách nhân sự tham gia dự án theo vị trí, cấp bậc và quyền nghiệp vụ.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Tổ chức**.

#### Điều kiện trước

Dự án đã được tạo.

#### Dữ liệu cần chuẩn bị

Không bắt buộc.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Tổ chức**.
3. Xem danh sách thành viên theo nhóm/cấp vị trí.
4. Tìm kiếm thành viên nếu danh sách dài.
5. Mở chi tiết thành viên để xem vị trí, ngày bắt đầu và quyền được gán.

`[HÌNH MINH HỌA: Tab Tổ chức - danh sách thành viên dự án]`

#### Kết quả sau khi hoàn tất

User biết ai đang tham gia dự án và từng người được gán quyền gì.

#### Lưu ý

Quyền nghiệp vụ ở đây ảnh hưởng đến các thao tác như gửi, xác nhận, duyệt trong một số tab.

#### Lỗi thường gặp và cách xử lý

- **Không thấy nhân sự cần chọn:** kiểm tra user/nhân sự đã được tạo và đang hoạt động.
- **Không thấy quyền cần gán:** kiểm tra danh mục quyền nghiệp vụ dự án.

### 7.2. Thêm thành viên dự án và gán quyền

#### Mục đích

Thêm nhân sự vào dự án, gán vị trí và quyền nghiệp vụ để user thực hiện đúng vai trò.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị tab **Tổ chức**.

#### Điều kiện trước

- User có quyền quản trị tab **Tổ chức**.
- Nhân sự/user cần thêm đã tồn tại trong hệ thống.
- Vị trí và nhóm quyền đã được thiết lập.

#### Dữ liệu cần chuẩn bị

- User/nhân sự cần thêm.
- Vị trí trong dự án.
- Ngày bắt đầu phân công.
- Quyền nghiệp vụ cần gán.
- Ghi chú nếu có.

#### Các bước thực hiện

1. Vào tab **Tổ chức**.
2. Bấm **Thêm thành viên**.
3. Chọn nhân sự/user.
4. Chọn vị trí.
5. Nhập ngày bắt đầu.
6. Chọn các quyền nghiệp vụ cần gán.
7. Nhập ghi chú nếu cần.
8. Bấm **Lưu**.

`[HÌNH MINH HỌA: Form thêm thành viên dự án và gán quyền]`

#### Kết quả sau khi hoàn tất

Thành viên được thêm vào dự án và có thể thực hiện các nghiệp vụ theo quyền được gán.

#### Lưu ý

Chỉ gán quyền đúng phạm vi công việc. Không gán quyền duyệt/xác nhận cho user không chịu trách nhiệm nghiệp vụ.

#### Lỗi thường gặp và cách xử lý

- **Không lưu được vì thiếu nhân viên/vị trí:** chọn đủ user và vị trí.
- **User không thao tác được dù đã thêm vào dự án:** kiểm tra đã gán đúng quyền nghiệp vụ và quyền tab chưa.

### 7.3. Cập nhật hoặc kết thúc phân công

#### Mục đích

Cập nhật vị trí/quyền của thành viên hoặc kết thúc phân công khi nhân sự không còn tham gia dự án.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị tab **Tổ chức**.

#### Điều kiện trước

Thành viên đã được thêm vào dự án.

#### Dữ liệu cần chuẩn bị

Thông tin cần cập nhật hoặc ngày kết thúc phân công.

#### Các bước thực hiện

1. Vào tab **Tổ chức**.
2. Tìm thành viên cần cập nhật.
3. Bấm chỉnh sửa.
4. Cập nhật vị trí, ngày bắt đầu, ghi chú hoặc quyền nghiệp vụ.
5. Bấm **Lưu**.
6. Nếu cần kết thúc phân công, chọn thao tác kết thúc phân công và xác nhận.

`[HÌNH MINH HỌA: Chỉnh sửa thành viên dự án / kết thúc phân công]`

#### Kết quả sau khi hoàn tất

Thông tin phân công được cập nhật hoặc thành viên được kết thúc vai trò trong dự án.

#### Lưu ý

Trước khi kết thúc phân công, cần kiểm tra user có đang là người xử lý các phiếu/chứng từ đang chờ không.

#### Lỗi thường gặp và cách xử lý

- **Không sửa được:** user không có quyền quản trị tab Tổ chức.
- **Phiếu đang chờ người đã kết thúc phân công:** cần chuyển người xử lý hoặc phân công lại.

## 8. Tab Ngân sách

### Mục đích

Xem ngân sách dự án và nhập/cập nhật ngân sách nếu Phòng Quản lý dự án được cấp quyền. Theo phân công hiện tại, **Phòng Kế toán là phòng nhập ngân sách chính**.

### Người thực hiện

Phòng Quản lý dự án xem/đối chiếu. User có quyền quản trị tab **Ngân sách** mới được nhập hoặc sửa.

### Điều kiện trước

- Dự án đã được tạo.
- User có quyền xem tab **Ngân sách**.
- Nếu nhập/sửa ngân sách, user cần quyền quản trị tab **Ngân sách**.

### Dữ liệu cần chuẩn bị

- Giá trị ngân sách đã được phê duyệt.
- Cơ cấu ngân sách theo nhóm chi phí nếu có: vật tư, nhân công, thầu phụ, máy móc, quản lý chung.

### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Ngân sách** hoặc bấm nút **Ngân sách** tại khu vực thao tác nhanh nếu có quyền.
3. Xem ngân sách hiện tại.
4. Nếu được phép cập nhật, nhập số liệu ngân sách theo từng nhóm chi phí.
5. Kiểm tra tổng ngân sách.
6. Bấm **Lưu**.

`[HÌNH MINH HỌA: Tab/Form Ngân sách dự án]`

### Kết quả sau khi hoàn tất

Ngân sách dự án được hiển thị để QLDA theo dõi và đối chiếu với chi phí/thực tế.

### Lưu ý

Không tự ý điều chỉnh ngân sách nếu chưa có xác nhận từ Kế toán hoặc cấp có thẩm quyền.

### Lỗi thường gặp và cách xử lý

- **Không thấy nút nhập/sửa ngân sách:** user không có quyền quản trị tab Ngân sách.
- **Số liệu lệch với kế toán:** đối chiếu lại nguồn ngân sách được phê duyệt và thời điểm cập nhật.

## 9. Tab Hợp đồng

### 9.1. Xem danh sách hợp đồng của dự án

#### Mục đích

Xem toàn bộ hợp đồng khách hàng và hợp đồng thầu phụ liên quan đến dự án.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Hợp đồng**.

#### Điều kiện trước

- Dự án đã tồn tại.
- Hợp đồng đã được tạo/liên kết trong module Hợp đồng nếu có.

#### Dữ liệu cần chuẩn bị

Không bắt buộc.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Hợp đồng**.
3. Xem các thẻ tổng hợp: tổng hợp đồng, giá trị hợp đồng khách hàng, giá trị thầu phụ, chênh lệch.
4. Dùng bộ lọc để xem **Tất cả**, **Hợp đồng khách hàng** hoặc **Thầu phụ**.
5. Bấm vào một hợp đồng để mở chi tiết.

`[HÌNH MINH HỌA: Tab Hợp đồng - danh sách hợp đồng]`

#### Kết quả sau khi hoàn tất

User xem được danh sách hợp đồng và trạng thái từng hợp đồng.

#### Lưu ý

Nút **Thêm HĐ** có thể dẫn sang module Hợp đồng để tạo hợp đồng đầy đủ.

#### Lỗi thường gặp và cách xử lý

- **Chưa có hợp đồng nào:** tạo hoặc liên kết hợp đồng trong module Hợp đồng.
- **Không xóa được hợp đồng:** hợp đồng có thể đã có BOQ, nghiệm thu, thanh toán, phụ lục hoặc lịch thanh toán liên kết.

### 9.2. Mở workspace hợp đồng

#### Mục đích

Xem và xử lý các nghiệp vụ chi tiết của một hợp đồng như thông tin, BOQ, phát sinh, phụ lục, lịch thanh toán, nghiệm thu, chứng chỉ thanh toán và tài liệu.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem/quản trị tab **Hợp đồng**.

#### Điều kiện trước

Hợp đồng đã tồn tại trong dự án.

#### Dữ liệu cần chuẩn bị

Mã hợp đồng cần xử lý.

#### Các bước thực hiện

1. Vào tab **Hợp đồng**.
2. Bấm vào hợp đồng cần xem.
3. Mở workspace/chi tiết hợp đồng.
4. Chọn tab con phù hợp: thông tin, BOQ, phát sinh, lịch sử, phụ lục, lịch thanh toán, nghiệm thu, chứng chỉ thanh toán, tài liệu.
5. Xem hoặc cập nhật thông tin theo quyền được cấp.

`[HÌNH MINH HỌA: Workspace hợp đồng và các tab con]`

#### Kết quả sau khi hoàn tất

User xem được toàn bộ hồ sơ hợp đồng và xử lý đúng nghiệp vụ liên quan.

#### Lưu ý

Không chỉnh sửa dữ liệu hợp đồng nếu chưa xác nhận nguồn dữ liệu pháp lý/kinh tế.

#### Lỗi thường gặp và cách xử lý

- **Không thấy tab con cần dùng:** kiểm tra quyền hoặc trạng thái hợp đồng.
- **Không lưu được phát sinh/phụ lục:** kiểm tra quyền quản trị tab Hợp đồng và dữ liệu bắt buộc.

### 9.3. Theo dõi BOQ hợp đồng, phát sinh và nghiệm thu/thanh toán

#### Mục đích

Theo dõi giá trị hợp đồng theo BOQ, các phát sinh, nghiệm thu và thanh toán liên quan.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền hợp đồng/nghiệm thu/thanh toán.

#### Điều kiện trước

- Hợp đồng đã có dữ liệu BOQ hoặc hạng mục.
- Nếu nghiệm thu/thanh toán, cần có dữ liệu khối lượng và điều kiện thanh toán liên quan.

#### Dữ liệu cần chuẩn bị

- BOQ/hạng mục hợp đồng.
- Phụ lục/phát sinh nếu có.
- Hồ sơ nghiệm thu, chứng chỉ thanh toán nếu có.

#### Các bước thực hiện

1. Mở workspace hợp đồng.
2. Vào tab **BOQ** để xem hạng mục và giá trị.
3. Vào tab **Phát sinh** để xem hoặc cập nhật thay đổi hợp đồng nếu có quyền.
4. Vào tab **Phụ lục** để theo dõi các phụ lục liên quan.
5. Vào tab **Nghiệm thu** để xem khối lượng/giá trị nghiệm thu.
6. Vào tab **Chứng chỉ thanh toán** hoặc **Lịch thanh toán** để theo dõi thanh toán.

`[HÌNH MINH HỌA: BOQ hợp đồng / phát sinh / nghiệm thu / thanh toán]`

#### Kết quả sau khi hoàn tất

User có cái nhìn đầy đủ về giá trị hợp đồng, phát sinh và tình trạng nghiệm thu/thanh toán.

#### Lưu ý

BOQ hợp đồng và BOQ triển khai vật tư là hai lớp dữ liệu khác nhau. Khi cần so sánh, dùng chức năng đối chiếu BOQ trong tab Vật tư/BOQ.

#### Lỗi thường gặp và cách xử lý

- **Giá trị hợp đồng không khớp báo cáo:** kiểm tra phụ lục/phát sinh và trạng thái cập nhật.
- **Không mở được chứng chỉ thanh toán:** kiểm tra dữ liệu nghiệm thu và quyền tab Nghiệm thu & Thanh toán.

## 10. Tab Tiến độ

### 10.1. Xem tiến độ dự án

#### Mục đích

Xem danh sách công việc, WBS, biểu đồ Gantt, tình trạng hoàn thành, trễ hạn và các cảnh báo tiến độ.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Tiến độ**.

#### Điều kiện trước

Dự án đã có dữ liệu tiến độ hoặc user chuẩn bị tạo mới tiến độ.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Tiến độ**.
3. Chọn chế độ xem bảng, Gantt hoặc kết hợp nếu có.
4. Dùng tìm kiếm/lọc để tìm công việc.
5. Kiểm tra trạng thái, ngày bắt đầu/kết thúc, người thực hiện, phần trăm hoàn thành.
6. Xem cảnh báo trễ hoặc đường găng nếu có.

`[HÌNH MINH HỌA: Tab Tiến độ - bảng công việc và Gantt]`

#### Kết quả sau khi hoàn tất

User nắm được tình trạng tiến độ hiện tại của dự án.

#### Lưu ý

Tiến độ dự án có thể được tính theo Gantt có trọng số, ngân sách công việc, thời gian thực hiện, số lượng công việc, giá trị hợp đồng hoặc nhập thủ công tùy cấu hình dự án.

#### Lỗi thường gặp và cách xử lý

- **Không thấy dữ liệu tiến độ:** dự án chưa tạo/import WBS.
- **Phần trăm tiến độ không như kỳ vọng:** kiểm tra phương pháp tính tiến độ trong thông tin dự án.

### 10.2. Tạo hoặc cập nhật công việc/WBS

#### Mục đích

Tạo cấu trúc WBS và công việc triển khai để quản lý tiến độ dự án.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị tab **Tiến độ**.

#### Điều kiện trước

User có quyền quản trị tab **Tiến độ**.

#### Dữ liệu cần chuẩn bị

- Mã WBS.
- Tên công việc.
- Công việc cha nếu có.
- Ngày bắt đầu/kết thúc kế hoạch.
- Ngày bắt đầu/kết thúc thực tế nếu có.
- Người thực hiện.
- Đơn vị, khối lượng tạm tính, nhân công dự kiến nếu có.

#### Các bước thực hiện

1. Vào tab **Tiến độ**.
2. Bấm **Thêm công việc** hoặc thao tác tương đương.
3. Nhập mã WBS và tên công việc.
4. Chọn công việc cha nếu công việc là cấp con.
5. Nhập ngày bắt đầu và ngày kết thúc kế hoạch.
6. Nhập các thông tin bổ sung: người thực hiện, đơn vị, khối lượng, nhân công.
7. Nhập phần trăm hoàn thành nếu đã có dữ liệu thực tế.
8. Bấm **Lưu**.

`[HÌNH MINH HỌA: Form thêm/sửa công việc WBS]`

#### Kết quả sau khi hoàn tất

Công việc/WBS được thêm hoặc cập nhật trong tiến độ dự án.

#### Lưu ý

Mã WBS nên theo cấu trúc phân cấp, ví dụ 1, 1.1, 1.1.1. Không nên đặt mã tùy tiện vì mã này còn dùng khi import BOQ hoặc đối chiếu dữ liệu.

#### Lỗi thường gặp và cách xử lý

- **Mã WBS không hợp lệ:** dùng định dạng phân cấp bằng số và dấu chấm.
- **Ngày kết thúc trước ngày bắt đầu:** kiểm tra lại ngày.
- **Không lưu được:** kiểm tra quyền quản trị tab Tiến độ.

### 10.3. Import tiến độ từ Excel

#### Mục đích

Nhập nhanh danh sách công việc/WBS từ file Excel.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị tab **Tiến độ**.

#### Điều kiện trước

- User có quyền quản trị tab **Tiến độ**.
- File Excel đúng mẫu hệ thống.

#### Dữ liệu cần chuẩn bị

File Excel có các sheet nhập mới/cập nhật theo mẫu, bao gồm mã WBS, công việc, ngày kế hoạch, ngày thực tế, người thực hiện, khối lượng và tiến độ.

#### Các bước thực hiện

1. Vào tab **Tiến độ**.
2. Tải file mẫu nếu cần.
3. Điền dữ liệu vào file mẫu.
4. Bấm **Import** hoặc **Tải lên Excel**.
5. Chọn file Excel.
6. Xem preview/kiểm tra lỗi nếu hệ thống hiển thị.
7. Xác nhận import.
8. Kiểm tra lại danh sách công việc sau import.

`[HÌNH MINH HỌA: Import Excel tiến độ và màn hình preview]`

#### Kết quả sau khi hoàn tất

Dữ liệu tiến độ được tạo mới hoặc cập nhật hàng loạt.

#### Lưu ý

Không đổi tên cột trong file mẫu nếu hệ thống yêu cầu đúng header.

#### Lỗi thường gặp và cách xử lý

- **Không đọc được Excel:** dùng lại file mẫu tải từ hệ thống.
- **Dòng bị lỗi ngày:** kiểm tra định dạng ngày.
- **WBS cha không tồn tại:** nhập công việc cha trước hoặc kiểm tra mã cha.

### 10.4. Cập nhật phần trăm hoàn thành và xử lý trễ tiến độ

#### Mục đích

Cập nhật tiến độ thực tế, theo dõi chậm trễ và hỗ trợ điều hành dự án.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền cập nhật tiến độ.

#### Điều kiện trước

Dự án đã có danh sách công việc/WBS.

#### Dữ liệu cần chuẩn bị

- Phần trăm hoàn thành thực tế.
- Ngày thực tế.
- Nguyên nhân trễ nếu có.
- Hồ sơ/ảnh chứng minh nếu nghiệp vụ yêu cầu.

#### Các bước thực hiện

1. Mở tab **Tiến độ**.
2. Tìm công việc cần cập nhật.
3. Mở form chỉnh sửa hoặc cập nhật tiến độ.
4. Nhập phần trăm hoàn thành, ngày thực tế hoặc thông tin liên quan.
5. Kiểm tra cảnh báo trễ, phụ thuộc hoặc đường găng.
6. Bấm **Lưu**.

`[HÌNH MINH HỌA: Cập nhật tiến độ công việc và cảnh báo trễ]`

#### Kết quả sau khi hoàn tất

Tiến độ thực tế được cập nhật và có thể ảnh hưởng đến dashboard điều hành/báo cáo.

#### Lưu ý

Một số tiến độ có thể được cập nhật từ nhật ký đã xác nhận hoặc dữ liệu khối lượng nghiệm thu.

#### Lỗi thường gặp và cách xử lý

- **Không cập nhật được công việc đã khóa:** kiểm tra trạng thái/gate hoặc quyền cập nhật.
- **Tiến độ vượt 100% bất thường:** kiểm tra quy định nhập liệu và dữ liệu khối lượng.

## 11. Tab Nhật ký

### 11.1. Xem nhật ký công trường

#### Mục đích

Xem nhật ký theo ngày để theo dõi diễn biến thi công, thời tiết, nhân lực, máy móc, vật tư, khối lượng và hình ảnh hiện trường.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Nhật ký**.

#### Điều kiện trước

Dự án đã được tạo. Nếu dùng dữ liệu công trường, nên liên kết công trường HRM.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Nhật ký**.
3. Chọn tháng/ngày cần xem.
4. Bấm vào nhật ký để mở chi tiết.
5. Kiểm tra trạng thái: Nháp, Chờ xác nhận, Đã xác nhận, Trả lại.
6. Xem các phần khối lượng, vật tư, nhân công, máy thi công, ảnh, delay nếu có.

`[HÌNH MINH HỌA: Tab Nhật ký - lịch và danh sách nhật ký]`

#### Kết quả sau khi hoàn tất

User xem được lịch sử thi công theo ngày.

#### Lưu ý

Chỉ nhật ký đã xác nhận mới nên được dùng làm dữ liệu tin cậy cho tiến độ/báo cáo.

#### Lỗi thường gặp và cách xử lý

- **Không thấy nhật ký trong ngày:** kiểm tra ngày/tháng hoặc bộ lọc trạng thái.
- **Không mở được chi tiết:** kiểm tra quyền xem tab Nhật ký.

### 11.2. Tạo nhật ký ngày

#### Mục đích

Ghi nhận thông tin thi công thực tế trong ngày.

#### Người thực hiện

Phòng Quản lý dự án, chỉ huy công trường hoặc user có quyền tạo/sửa nhật ký.

#### Điều kiện trước

- User có quyền tạo/sửa nhật ký.
- Dự án đã có công việc/WBS nếu cần nhập khối lượng theo hạng mục.
- Kho công trường và danh mục vật tư đã có nếu ghi nhận vật tư.

#### Dữ liệu cần chuẩn bị

- Ngày nhật ký.
- Mô tả công việc trong ngày.
- Thời tiết.
- Khối lượng thực hiện.
- Vật tư sử dụng.
- Nhân công.
- Máy thi công.
- Ảnh hiện trường.
- Delay/nguyên nhân trễ nếu có.

#### Các bước thực hiện

1. Vào tab **Nhật ký**.
2. Chọn ngày cần tạo nhật ký.
3. Bấm **Tạo nhật ký** hoặc thao tác tương đương.
4. Nhập mô tả công việc trong ngày.
5. Chọn thời tiết.
6. Nhập khối lượng theo công việc/WBS hoặc BOQ nếu có.
7. Nhập vật tư sử dụng.
8. Nhập nhân công và máy thi công.
9. Thêm ảnh hoặc file đính kèm nếu có.
10. Nhập thông tin delay nếu phát sinh.
11. Bấm **Lưu**.

`[HÌNH MINH HỌA: Form tạo nhật ký ngày]`

#### Kết quả sau khi hoàn tất

Nhật ký được lưu ở trạng thái nháp hoặc trạng thái hiện hành theo thao tác của user.

#### Lưu ý

Nếu hệ thống yêu cầu ảnh, user cần đính kèm ảnh trước khi lưu/gửi.

#### Lỗi thường gặp và cách xử lý

- **Không lưu được do thiếu mô tả/ngày:** nhập đủ trường bắt buộc.
- **Khối lượng vượt phần còn lại:** kiểm tra lại khối lượng kế hoạch và khối lượng đã xác nhận trước đó.
- **Vật tư sử dụng vượt tồn kho:** kiểm tra tồn kho công trường.

### 11.3. Gửi và xác nhận nhật ký

#### Mục đích

Gửi nhật ký cho người xác nhận và ghi nhận nhật ký chính thức sau khi duyệt.

#### Người thực hiện

Người tạo nhật ký, quản lý công trường, QLDA hoặc user có quyền gửi/xác nhận.

#### Điều kiện trước

- Nhật ký đã được tạo.
- User có quyền gửi hoặc xác nhận theo phân quyền dự án.
- Người xác nhận đã được phân công trong dự án.

#### Dữ liệu cần chuẩn bị

Nhật ký đã nhập đầy đủ và người xác nhận cần gửi.

#### Các bước thực hiện

1. Mở nhật ký cần gửi.
2. Kiểm tra toàn bộ nội dung.
3. Bấm **Gửi nhật ký**.
4. Chọn người xác nhận.
5. Xác nhận gửi.
6. Người xác nhận mở nhật ký ở trạng thái **Chờ xác nhận**.
7. Bấm **Xác nhận** nếu nội dung đạt yêu cầu hoặc **Trả lại** nếu cần bổ sung.
8. Nếu trả lại, nhập lý do trả lại.

`[HÌNH MINH HỌA: Gửi nhật ký và chọn người xác nhận]`

`[HÌNH MINH HỌA: Màn hình xác nhận/trả lại nhật ký]`

#### Kết quả sau khi hoàn tất

Nhật ký chuyển sang **Đã xác nhận** hoặc **Trả lại**.

#### Lưu ý

Nhật ký đã xác nhận có thể ảnh hưởng đến tiến độ, delay và báo cáo dự án.

#### Lỗi thường gặp và cách xử lý

- **Không chọn được người xác nhận:** kiểm tra phân quyền người xác nhận trong Tổ chức dự án.
- **Không xác nhận được:** user không phải người được giao hoặc không có quyền xác nhận.

## 12. Tab Nghiệm thu & Thanh toán

### Mục đích

Theo dõi kế hoạch thanh toán theo hợp đồng, bao gồm mốc kế hoạch, sắp tới hạn, quá hạn và đã thanh toán.

### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Nghiệm thu & Thanh toán**. User có quyền xác nhận mới được đánh dấu thanh toán.

### Điều kiện trước

- Dự án đã liên kết công trường HRM.
- Hợp đồng và lịch thanh toán đã có dữ liệu.

### Dữ liệu cần chuẩn bị

- Hợp đồng liên quan.
- Mốc thanh toán, hồ sơ, trạng thái chất lượng nếu cần đối chiếu.

### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Nghiệm thu & Thanh toán**.
3. Chọn tab con: **Kế hoạch**, **Sắp tới hạn**, **Quá hạn**, **Đã thanh toán**.
4. Lọc theo loại hợp đồng: tất cả, hợp đồng nhận thầu, hợp đồng thầu phụ.
5. Lọc theo hợp đồng hoặc khoảng ngày nếu cần.
6. Tìm kiếm theo từ khóa nếu cần.
7. Mở hợp đồng hoặc Gantt liên quan từ dòng thanh toán nếu cần kiểm tra chi tiết.
8. Nếu có quyền, đánh dấu thanh toán cho dòng phù hợp.
9. Xuất Excel danh sách nếu cần.

`[HÌNH MINH HỌA: Tab Nghiệm thu & Thanh toán - kế hoạch và bộ lọc]`

### Kết quả sau khi hoàn tất

User theo dõi được các mốc thanh toán, khoản sắp đến hạn/quá hạn và số đã thanh toán.

### Lưu ý

Màn hình này là workbench tổng hợp. Nếu số liệu sai, cần kiểm tra dữ liệu hợp đồng, lịch thanh toán, hồ sơ nghiệm thu và chứng chỉ thanh toán.

### Lỗi thường gặp và cách xử lý

- **Không có dữ liệu:** kiểm tra hợp đồng đã có lịch thanh toán chưa.
- **Không đánh dấu thanh toán được:** user cần quyền xác nhận hoặc quyền quản trị tab.
- **Mốc quá hạn không đúng:** kiểm tra ngày đến hạn trên lịch thanh toán.

## 13. Tab Dòng tiền

### 13.1. Xem tổng quan dòng tiền

#### Mục đích

Theo dõi tổng thu, tổng chi, dòng tiền ròng, công nợ phải thu/phải trả và biểu đồ dòng tiền theo thời gian.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Dòng tiền**.

#### Điều kiện trước

- Dự án đã liên kết công trường HRM.
- Có dữ liệu giao dịch, hợp đồng hoặc lịch thanh toán.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Dòng tiền**.
3. Xem các thẻ tổng quan: tổng thu, tổng chi, dòng tiền ròng, công nợ.
4. Chọn khoảng thời gian: 3 tháng, 6 tháng, 12 tháng hoặc tất cả.
5. Xem biểu đồ dòng tiền.
6. Kiểm tra các khoản phải thu/phải trả và khoản quá hạn nếu có.

`[HÌNH MINH HỌA: Tab Dòng tiền - thẻ chỉ số và biểu đồ]`

#### Kết quả sau khi hoàn tất

User nắm được tình trạng tài chính vận hành của dự án.

#### Lưu ý

Dòng tiền phụ thuộc vào dữ liệu giao dịch và lịch thanh toán. Không dùng thay thế báo cáo kế toán chính thức nếu chưa đối chiếu.

#### Lỗi thường gặp và cách xử lý

- **Biểu đồ không có dữ liệu:** kiểm tra đã nhập giao dịch hoặc lịch thanh toán chưa.
- **Số thu/chi không khớp:** kiểm tra loại giao dịch và thời gian lọc.

### 13.2. Thêm hoặc cập nhật lịch thanh toán

#### Mục đích

Ghi nhận các đợt thanh toán phải thu/phải trả để theo dõi công nợ và cảnh báo đến hạn.

#### Người thực hiện

User có quyền quản trị tab **Dòng tiền**.

#### Điều kiện trước

- User có quyền quản trị tab.
- Dự án đã liên kết công trường.

#### Dữ liệu cần chuẩn bị

- Mô tả đợt thanh toán.
- Số tiền.
- Ngày đến hạn.
- Loại: phải thu hoặc phải trả.
- Người/đơn vị liên hệ nếu có.

#### Các bước thực hiện

1. Vào tab **Dòng tiền**.
2. Chọn **Thêm đợt thanh toán** hoặc thao tác tương đương.
3. Nhập mô tả, số tiền, ngày đến hạn.
4. Chọn loại phải thu/phải trả.
5. Nhập người liên hệ nếu có.
6. Bấm **Lưu**.
7. Khi khoản đã thanh toán, chọn dòng và đánh dấu **Đã thanh toán** nếu có quyền.

`[HÌNH MINH HỌA: Form thêm/sửa lịch thanh toán trong tab Dòng tiền]`

#### Kết quả sau khi hoàn tất

Lịch thanh toán được ghi nhận và tham gia vào công nợ/dòng tiền.

#### Lưu ý

Ngày đến hạn trong quá khứ sẽ được hệ thống nhận diện là quá hạn nếu chưa thanh toán.

#### Lỗi thường gặp và cách xử lý

- **Không lưu được:** nhập đủ mô tả, số tiền và ngày đến hạn.
- **Không thấy nút thêm/sửa:** user không có quyền quản trị tab Dòng tiền.

## 14. Tab Chất lượng

### 14.1. Xem danh sách hồ sơ/checklist chất lượng

#### Mục đích

Theo dõi hồ sơ nghiệm thu chất lượng, trạng thái duyệt và kết quả kiểm tra.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Chất lượng**.

#### Điều kiện trước

Dự án đã được tạo và có dữ liệu chất lượng nếu đã triển khai.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Chất lượng**.
3. Dùng tìm kiếm hoặc bộ lọc trạng thái nếu cần.
4. Mở checklist/hồ sơ cần xem.
5. Kiểm tra trạng thái: Nháp, Chờ duyệt, Đã duyệt, Trả lại, Đã hủy.
6. Kiểm tra kết quả đạt/không đạt nếu có.

`[HÌNH MINH HỌA: Tab Chất lượng - danh sách checklist/hồ sơ]`

#### Kết quả sau khi hoàn tất

User biết tình trạng hồ sơ chất lượng của dự án.

#### Lưu ý

Hồ sơ chất lượng có thể là điều kiện tham chiếu cho nghiệm thu/thanh toán tùy quy trình doanh nghiệp.

#### Lỗi thường gặp và cách xử lý

- **Không thấy template/hồ sơ:** kiểm tra danh mục mẫu nghiệm thu đã được cấu hình.
- **Không thấy dữ liệu:** kiểm tra dự án đã tạo checklist chưa.

### 14.2. Tạo checklist nghiệm thu chất lượng từ mẫu

#### Mục đích

Tạo hồ sơ nghiệm thu chất lượng theo mẫu chuẩn để kiểm tra và trình duyệt.

#### Người thực hiện

Phòng Quản lý dự án, QA/QC hoặc user có quyền quản trị tab **Chất lượng**.

#### Điều kiện trước

- User có quyền quản trị tab **Chất lượng**.
- Danh mục mẫu nghiệm thu đã được cấu hình theo hạng mục/công tác.

#### Dữ liệu cần chuẩn bị

- Hạng mục chính.
- Loại công tác.
- Mẫu biên bản nghiệm thu.
- Vị trí/khu vực kiểm tra.
- Người phụ trách.
- Ảnh/file/bản vẽ liên quan nếu có.

#### Các bước thực hiện

1. Vào tab **Chất lượng**.
2. Bấm **Tạo mới** hoặc chọn mẫu hồ sơ.
3. Chọn **Hạng mục chính**.
4. Chọn **Loại công tác**.
5. Chọn **Mẫu biên bản nghiệm thu**.
6. Nhập thông tin hồ sơ và các mục kiểm tra.
7. Đính kèm ảnh/file hoặc đánh dấu vị trí bản vẽ nếu có.
8. Bấm **Lưu**.

`[HÌNH MINH HỌA: Chọn mẫu hồ sơ nghiệm thu chất lượng]`

`[HÌNH MINH HỌA: Form nhập checklist chất lượng]`

#### Kết quả sau khi hoàn tất

Checklist/hồ sơ chất lượng được tạo ở trạng thái nháp hoặc trạng thái hiện hành.

#### Lưu ý

Chọn đúng mẫu ngay từ đầu để tránh phải nhập lại hồ sơ.

#### Lỗi thường gặp và cách xử lý

- **Không có mẫu phù hợp:** kiểm tra cấu hình hạng mục, công tác và template nghiệm thu.
- **Không lưu được:** nhập đủ trường bắt buộc và kiểm tra quyền quản trị tab.

### 14.3. Gửi duyệt, trả lại hoặc duyệt hồ sơ chất lượng

#### Mục đích

Chuyển hồ sơ chất lượng qua luồng duyệt và ghi nhận kết quả chính thức.

#### Người thực hiện

User có quyền gửi/duyệt hồ sơ chất lượng theo phân công.

#### Điều kiện trước

Checklist/hồ sơ đã được tạo và có đầy đủ nội dung.

#### Dữ liệu cần chuẩn bị

- Người nhận xử lý/duyệt.
- Ghi chú hoặc lý do trả lại nếu có.

#### Các bước thực hiện

1. Mở hồ sơ chất lượng cần xử lý.
2. Kiểm tra đầy đủ nội dung và file đính kèm.
3. Bấm **Gửi duyệt** nếu cần trình duyệt.
4. Chọn người nhận xử lý.
5. Người duyệt mở hồ sơ.
6. Chọn **Duyệt** nếu đạt hoặc **Trả lại** nếu cần bổ sung.
7. In/xem hồ sơ nếu cần lưu bản cứng.

`[HÌNH MINH HỌA: Gửi duyệt hồ sơ chất lượng]`

`[HÌNH MINH HỌA: Duyệt/trả lại/in hồ sơ chất lượng]`

#### Kết quả sau khi hoàn tất

Hồ sơ chuyển trạng thái phù hợp và được ghi nhận trong lịch sử xử lý.

#### Lưu ý

Không duyệt hồ sơ khi chưa kiểm tra đủ thông tin hiện trường, ảnh, bản vẽ hoặc tiêu chuẩn áp dụng.

#### Lỗi thường gặp và cách xử lý

- **Không gửi duyệt được:** kiểm tra quyền gửi và dữ liệu bắt buộc.
- **Không duyệt được:** user không phải người xử lý hoặc không có quyền duyệt.

## 15. Tab Nhà thầu

### Mục đích

Theo dõi hợp đồng thầu phụ và các đợt nghiệm thu/thanh toán liên quan đến nhà thầu phụ trong dự án.

### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem/quản trị tab **Nhà thầu**.

### Điều kiện trước

- Dự án đã có hợp đồng thầu phụ.
- Nếu tạo nghiệm thu, user cần quyền quản trị tab **Nhà thầu**.

### Dữ liệu cần chuẩn bị

- Hợp đồng thầu phụ.
- Kỳ/đợt nghiệm thu.
- Mô tả nghiệm thu.
- Thời gian nghiệm thu.
- Giá trị nghiệm thu.
- Tỷ lệ giữ lại bảo hành nếu có.

### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Nhà thầu**.
3. Xem các thẻ tổng quan: số nhà thầu phụ, giá trị đã nghiệm thu, đã thanh toán, giữ lại bảo hành.
4. Mở hợp đồng thầu phụ cần xem.
5. Bấm tạo đợt nghiệm thu nếu cần.
6. Nhập kỳ nghiệm thu, mô tả, thời gian, giá trị, tỷ lệ giữ lại.
7. Chọn trạng thái nghiệm thu: nháp, đã gửi, đã duyệt, đã thanh toán.
8. Bấm **Lưu**.

`[HÌNH MINH HỌA: Tab Nhà thầu - danh sách hợp đồng thầu phụ]`

`[HÌNH MINH HỌA: Form tạo/sửa đợt nghiệm thu nhà thầu]`

### Kết quả sau khi hoàn tất

Thông tin nghiệm thu/thanh toán nhà thầu được cập nhật để theo dõi giá trị thực hiện.

### Lưu ý

Nếu chưa có hợp đồng thầu phụ, cần tạo hoặc liên kết hợp đồng trước tại tab Hợp đồng/module Hợp đồng.

### Lỗi thường gặp và cách xử lý

- **Tab báo chưa có hợp đồng thầu phụ:** tạo hợp đồng thầu phụ trước.
- **Không tạo được nghiệm thu:** kiểm tra quyền quản trị tab Nhà thầu và dữ liệu bắt buộc.

## 16. Tab Vật tư

Tab **Vật tư** là khu vực quan trọng của Phòng Quản lý dự án để theo dõi nhu cầu, BOQ, kế hoạch vật tư, yêu cầu vật tư, PO, hao hụt và dashboard vật tư.

Các tab con hiện có:

- **Tổng hợp**
- **BOQ**
- **Kế hoạch**
- **Yêu cầu**
- **Đơn hàng PO**
- **Hao hụt**
- **Dashboard**

### 16.1. Tổng hợp vật tư

#### Mục đích

Xem bảng tổng hợp vật tư liên kết giữa BOQ, yêu cầu vật tư, PO, nhập/xuất kho, tồn kho và cảnh báo hao hụt.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Vật tư - Tổng hợp**.

#### Điều kiện trước

Dự án đã có BOQ vật tư hoặc dữ liệu yêu cầu/PO/kho.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Vật tư**.
3. Chọn tab con **Tổng hợp**.
4. Xem các chỉ số theo từng mã vật tư: ngân sách, lũy kế yêu cầu, lũy kế nhập, lũy kế xuất, tồn kho, hao hụt, cảnh báo.
5. Dùng phân trang để xem các dòng tiếp theo.

`[HÌNH MINH HỌA: Vật tư - tab Tổng hợp]`

#### Kết quả sau khi hoàn tất

User nắm được tình trạng vật tư theo từng dòng BOQ/vật tư.

#### Lưu ý

Dòng có cảnh báo vượt ngân sách, tồn âm hoặc vượt hao hụt cần được kiểm tra trước khi tạo thêm yêu cầu/PO.

#### Lỗi thường gặp và cách xử lý

- **Không có dữ liệu:** kiểm tra tab BOQ đã có dữ liệu chưa.
- **Tồn kho âm:** kiểm tra giao dịch nhập/xuất và dữ liệu cấp phát vật tư.

### 16.2. BOQ vật tư

#### Mục đích

Quản lý BOQ triển khai theo tiến độ, gắn vật tư với đầu mục BOQ/WBS và tạo yêu cầu vật tư từ BOQ.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem/quản trị **Vật tư - BOQ**.

#### Điều kiện trước

- Dự án đã có tiến độ/WBS nếu muốn đồng bộ BOQ theo tiến độ.
- Vật tư đã có trong danh mục hoặc cần tạo đề xuất cấp mã vật tư nếu chưa có mã.
- User cần quyền chỉnh sửa BOQ nếu thêm/sửa/xóa/import.

#### Dữ liệu cần chuẩn bị

- File BOQ triển khai nếu import.
- Mã WBS/đầu mục BOQ.
- Vật tư, đơn vị tính, khối lượng dự toán, đơn giá, ngưỡng hao hụt.

#### Các bước thực hiện

1. Vào tab **Vật tư**.
2. Chọn tab con **BOQ**.
3. Nếu chưa có BOQ, có thể chọn **Đồng bộ từ tiến độ** nếu đã có WBS.
4. Nếu nhập từ Excel, tải mẫu BOQ triển khai.
5. Điền dữ liệu theo mẫu.
6. Bấm **Import** và chọn file.
7. Xem preview import, sửa lỗi nếu có.
8. Xác nhận áp dụng import.
9. Nếu thêm thủ công, bấm **Thêm BOQ**.
10. Chọn đầu mục BOQ triển khai.
11. Chọn vật tư và nhập khối lượng, đơn giá, ngưỡng hao hụt.
12. Bấm **Lưu**.

`[HÌNH MINH HỌA: Vật tư - tab BOQ triển khai]`

`[HÌNH MINH HỌA: File mẫu/import BOQ và màn hình preview]`

`[HÌNH MINH HỌA: Form thêm/sửa BOQ vật tư]`

#### Kết quả sau khi hoàn tất

BOQ vật tư được cập nhật và có thể dùng để tạo yêu cầu vật tư, theo dõi vượt ngân sách/hao hụt.

#### Lưu ý

- Dòng vật tư cần gắn đúng đầu mục BOQ triển khai để hệ thống tự tính và đối chiếu.
- Nếu vật tư chưa có mã kho, cần tạo đề xuất cấp mã vật tư trước khi đặt hàng/cấp phát.
- BOQ triển khai phục vụ quản trị nội bộ, không thay thế hợp đồng nếu hợp đồng có BOQ riêng.

#### Lỗi thường gặp và cách xử lý

- **Chưa có tiến độ để đồng bộ:** tạo/import tiến độ trước.
- **Dòng import lỗi WBS:** kiểm tra mã WBS có tồn tại và đúng định dạng.
- **Không lưu được BOQ:** kiểm tra quyền chỉnh sửa BOQ và các trường bắt buộc.

### 16.3. Tạo yêu cầu vật tư từ BOQ

#### Mục đích

Tạo phiếu đề xuất/yêu cầu vật tư dựa trên các dòng BOQ đã chọn để giữ liên kết BOQ - yêu cầu - cấp phát/PO.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền tạo yêu cầu vật tư.

#### Điều kiện trước

- BOQ vật tư đã có dữ liệu.
- User có quyền tạo yêu cầu vật tư hoặc quyền submit trong dự án.
- Vật tư đã có mã kho nếu cần xử lý cấp phát/PO.

#### Dữ liệu cần chuẩn bị

- Dòng BOQ/vật tư cần yêu cầu.
- Số lượng cần yêu cầu.
- Ngày cần vật tư.
- Kho nhận công trường.
- Ghi chú nếu có.

#### Các bước thực hiện

1. Vào **Vật tư > BOQ**.
2. Chọn một hoặc nhiều dòng vật tư cần yêu cầu.
3. Bấm **Tạo yêu cầu từ dòng đã chọn** hoặc **Tạo yêu cầu vật tư** tại dòng/nhóm BOQ.
4. Kiểm tra danh sách vật tư được đưa vào phiếu.
5. Nhập số lượng, ngày cần, kho nhận và ghi chú.
6. Lưu nháp hoặc gửi duyệt theo quy trình.

`[HÌNH MINH HỌA: Chọn dòng BOQ và tạo yêu cầu vật tư]`

#### Kết quả sau khi hoàn tất

Phiếu yêu cầu vật tư được tạo và vẫn giữ liên kết về dòng BOQ gốc.

#### Lưu ý

Nếu yêu cầu vượt BOQ, hệ thống có thể cảnh báo hoặc yêu cầu quyền duyệt đặc biệt ở bước sau.

#### Lỗi thường gặp và cách xử lý

- **Chưa chọn dòng vật tư:** chọn ít nhất một dòng trong BOQ.
- **Dòng chưa có mã kho:** tạo đề xuất cấp mã vật tư hoặc cập nhật mã vật tư trước.
- **Không tạo được phiếu:** kiểm tra quyền tạo yêu cầu vật tư.

### 16.4. Kế hoạch vật tư

#### Mục đích

Dự báo nhu cầu vật tư còn lại theo BOQ, tiến độ WBS, tồn kho công trường và PO đang về; hỗ trợ tạo PO từ kế hoạch.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem/quản trị **Vật tư - Kế hoạch**.

#### Điều kiện trước

- BOQ triển khai đã có vật tư.
- Đầu mục BOQ đã liên kết tiến độ nếu muốn dự báo theo tiến độ.
- Có dữ liệu tồn kho/PO nếu muốn đối chiếu đầy đủ.

#### Dữ liệu cần chuẩn bị

- Kế hoạch tiến độ.
- BOQ vật tư.
- Tồn kho công trường.
- PO đang về.
- Quy tắc/đường cong kế hoạch nếu có.

#### Các bước thực hiện

1. Vào **Vật tư > Kế hoạch**.
2. Xem danh sách vật tư cần theo dõi.
3. Kiểm tra nhu cầu còn lại, tồn kho và PO đang về.
4. Kiểm tra các cảnh báo thiếu vật tư hoặc cần đặt hàng.
5. Nếu có quyền, chọn vật tư cần mua và bấm **Tạo PO** hoặc tạo draft PO từ kế hoạch.
6. Chuyển sang tab **Đơn hàng PO** để hoàn thiện đơn hàng.

`[HÌNH MINH HỌA: Vật tư - Kế hoạch vật tư theo tiến độ]`

#### Kết quả sau khi hoàn tất

User xác định được vật tư cần chuẩn bị/mua và có thể tạo PO nháp từ kế hoạch.

#### Lưu ý

Kế hoạch vật tư phụ thuộc vào chất lượng dữ liệu BOQ và tiến độ. Nếu BOQ hoặc tiến độ thiếu, kết quả dự báo có thể chưa đầy đủ.

#### Lỗi thường gặp và cách xử lý

- **Màn hình báo cần BOQ triển khai:** bổ sung BOQ trước.
- **Không tạo được PO:** user cần quyền quản trị **Vật tư - Đơn hàng PO**.

### 16.5. Yêu cầu vật tư

#### Mục đích

Quản lý các phiếu đề xuất/yêu cầu vật tư theo luồng Kanban, SLA và workflow từ công trường đến phòng vật tư/kho.

#### Người thực hiện

Phòng Quản lý dự án, người tạo phiếu, người duyệt hoặc user được giao xử lý.

#### Điều kiện trước

- User có quyền xem tab **Vật tư - Yêu cầu**.
- Nếu tạo/gửi phiếu, user cần quyền submit hoặc quyền tạo yêu cầu vật tư.
- Workflow vật tư nên được cấu hình nếu doanh nghiệp dùng luồng động.

#### Dữ liệu cần chuẩn bị

- Danh sách vật tư cần yêu cầu.
- Kho nhận.
- Ngày cần.
- Số lượng.
- Ghi chú.
- Người nhận xử lý/duyệt nếu quy trình yêu cầu.

#### Các bước thực hiện

1. Vào **Vật tư > Yêu cầu**.
2. Xem hộp việc và bảng Kanban.
3. Dùng bộ lọc: tất cả, của tôi, quá hạn, đã trả lại, theo dõi.
4. Tìm phiếu theo mã, người yêu cầu hoặc người xử lý.
5. Nếu cần tạo mới, bấm **Tạo đề xuất**.
6. Nhập thông tin phiếu và danh sách vật tư.
7. Lưu nháp hoặc gửi duyệt.
8. Người được giao mở phiếu và xử lý: duyệt, chuyển bước, trả lại hoặc từ chối theo quyền.

`[HÌNH MINH HỌA: Vật tư - Kanban yêu cầu vật tư]`

`[HÌNH MINH HỌA: Form tạo/gửi yêu cầu vật tư]`

#### Kết quả sau khi hoàn tất

Phiếu yêu cầu vật tư được theo dõi theo trạng thái và người xử lý hiện tại.

#### Lưu ý

Nếu phiếu bị trả lại, người tạo cần bổ sung thông tin và gửi lại.

#### Lỗi thường gặp và cách xử lý

- **Không thấy nút Tạo đề xuất:** user chưa có quyền submit/tạo yêu cầu.
- **Không chuyển được trạng thái:** user không phải người đang được giao hoặc thiếu quyền xử lý.
- **Phiếu quá hạn SLA:** kiểm tra người xử lý hiện tại và ưu tiên xử lý.

### 16.6. Đơn hàng PO

#### Mục đích

Theo dõi và tạo đơn hàng vật tư, có thể tạo từ đề xuất công trường, kế hoạch vật tư hoặc tạo PO chủ động.

#### Người thực hiện

Phòng Quản lý dự án phối hợp Phòng Vật tư. User cần quyền quản trị **Vật tư - Đơn hàng PO** nếu tạo/sửa/cập nhật PO.

#### Điều kiện trước

- User có quyền xem tab **Vật tư - Đơn hàng PO**.
- Nếu tạo PO, cần có nhà cung cấp, vật tư, số lượng, đơn giá và ngày cần giao.
- Nếu tạo từ đề xuất, phiếu đề xuất phải có dòng còn cần mua/cấp.

#### Dữ liệu cần chuẩn bị

- Nhà cung cấp.
- Dòng vật tư cần đặt.
- Số lượng đặt.
- Đơn giá.
- Ngày cần giao.
- Nguồn tạo: từ đề xuất, mua chủ động dự án hoặc mua dự trữ kho tổng.
- Gắn BOQ/đề xuất nếu cần truy vết.

#### Các bước thực hiện

1. Vào **Vật tư > Đơn hàng PO**.
2. Xem danh sách PO và trạng thái: Nháp, Đã gửi, Đã duyệt, Đang giao, Giao một phần, Hoàn thành, Đã đóng, Hoàn hàng, Hủy.
3. Nếu tạo từ đề xuất, bấm **Tạo từ đề xuất**.
4. Chọn các dòng đề xuất cần mua.
5. Kiểm tra nhà cung cấp và số lượng.
6. Nếu tạo PO chủ động, bấm **Tạo PO**.
7. Nhập thông tin nhà cung cấp, ngày cần giao, dòng vật tư, khối lượng, đơn giá.
8. Có thể import dòng PO từ Excel nếu cần nhập hàng loạt.
9. Bấm **Tạo** hoặc **Lưu**.
10. Cập nhật trạng thái PO theo thực tế xử lý/giao hàng.

`[HÌNH MINH HỌA: Vật tư - danh sách PO]`

`[HÌNH MINH HỌA: Tạo PO từ đề xuất công trường]`

`[HÌNH MINH HỌA: Form tạo/sửa PO]`

`[HÌNH MINH HỌA: Import dòng PO từ Excel và preview]`

#### Kết quả sau khi hoàn tất

PO được tạo/cập nhật và liên kết với yêu cầu vật tư hoặc BOQ nếu có.

#### Lưu ý

PO là nghiệp vụ phối hợp với Phòng Vật tư. QLDA cần kiểm tra đúng nhu cầu, BOQ và tiến độ trước khi tạo/đề xuất mua.

#### Lỗi thường gặp và cách xử lý

- **Vật tư trùng trong PO:** kiểm tra SKU, nhà cung cấp và nguồn BOQ/đề xuất.
- **Dòng BOQ chưa có mã kho:** tạo đề xuất cấp mã vật tư trước.
- **Không cập nhật trạng thái được:** kiểm tra quyền quản trị PO và người xử lý hiện tại.

### 16.7. Hao hụt vật tư

#### Mục đích

Theo dõi vật tư vượt định mức hao hụt hoặc vượt ngân sách để kiểm soát rủi ro chi phí.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem **Vật tư - Hao hụt**.

#### Điều kiện trước

Dự án đã có BOQ và dữ liệu nhập/xuất/thực tế công trường.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Vào **Vật tư > Hao hụt**.
2. Xem danh sách vật tư và tỷ lệ hao hụt.
3. So sánh hao hụt thực tế với ngưỡng.
4. Kiểm tra các dòng vượt ngưỡng.
5. Mở lại tab Tổng hợp/BOQ/Yêu cầu/PO để truy nguyên nguyên nhân nếu cần.

`[HÌNH MINH HỌA: Vật tư - tab Hao hụt]`

#### Kết quả sau khi hoàn tất

User xác định được vật tư có rủi ro hao hụt hoặc vượt định mức.

#### Lưu ý

Hao hụt cần được đối chiếu với nhật ký, xuất kho, nghiệm thu và thực tế hiện trường trước khi kết luận.

#### Lỗi thường gặp và cách xử lý

- **Không có dữ liệu hao hụt:** bổ sung BOQ và dữ liệu thực tế.
- **Hao hụt bất thường:** kiểm tra đơn vị tính, số lượng nhập/xuất và BOQ gốc.

### 16.8. Dashboard vật tư

#### Mục đích

Xem biểu đồ và danh sách cảnh báo vật tư vượt ngân sách, vượt hao hụt hoặc có giá trị lớn.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem **Vật tư - Dashboard**.

#### Điều kiện trước

Dự án đã có BOQ vật tư và số liệu phát sinh.

#### Dữ liệu cần chuẩn bị

Không bắt buộc.

#### Các bước thực hiện

1. Vào **Vật tư > Dashboard**.
2. Xem biểu đồ phân bổ ngân sách vật tư.
3. Xem danh sách vật tư vượt ngân sách.
4. Xem danh sách vật tư vượt hao hụt.
5. Dùng kết quả này để kiểm tra chi tiết ở tab Tổng hợp/BOQ/Yêu cầu/PO.

`[HÌNH MINH HỌA: Vật tư - Dashboard biểu đồ và cảnh báo]`

#### Kết quả sau khi hoàn tất

User nắm được nhóm vật tư cần ưu tiên kiểm soát.

#### Lưu ý

Dashboard là màn hình phân tích, không phải nơi nhập liệu chính.

#### Lỗi thường gặp và cách xử lý

- **Biểu đồ trống:** kiểm tra BOQ vật tư đã có ngân sách/giá trị chưa.
- **Cảnh báo không khớp kỳ vọng:** kiểm tra ngưỡng hao hụt và dữ liệu lũy kế yêu cầu/nhập/xuất.

## 17. Tab Tài liệu

### 17.1. Xem, tìm kiếm và tải tài liệu

#### Mục đích

Quản lý và tra cứu tài liệu dự án như hợp đồng, bản vẽ, nghiệm thu, giấy phép, báo cáo, hình ảnh, hóa đơn và tài liệu chung.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Tài liệu**.

#### Điều kiện trước

Dự án đã có tài liệu được upload hoặc user chuẩn bị upload.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Tài liệu**.
3. Dùng ô tìm kiếm để tìm theo tên, file, mô tả hoặc tag.
4. Lọc theo nhóm tài liệu: Hợp đồng, Bản vẽ, Nghiệm thu, Giấy phép, Báo cáo, Hình ảnh, Hóa đơn, Chung.
5. Bấm xem trước nếu muốn preview.
6. Bấm tải xuống nếu cần lưu file.

`[HÌNH MINH HỌA: Tab Tài liệu - tìm kiếm, lọc và danh sách file]`

#### Kết quả sau khi hoàn tất

User tìm được tài liệu cần tra cứu hoặc tải về.

#### Lưu ý

Nên đặt tên tài liệu rõ ràng, có mã dự án/hạng mục/ngày để dễ tìm kiếm.

#### Lỗi thường gặp và cách xử lý

- **Không thấy tài liệu:** kiểm tra bộ lọc danh mục hoặc từ khóa tìm kiếm.
- **Không mở được file:** kiểm tra file còn tồn tại trong storage hoặc user có quyền truy cập.

### 17.2. Upload và phân loại tài liệu

#### Mục đích

Tải tài liệu dự án lên hệ thống và phân loại để quản lý tập trung.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền quản trị tab **Tài liệu**.

#### Điều kiện trước

User có quyền quản trị tab **Tài liệu**.

#### Dữ liệu cần chuẩn bị

- File cần upload.
- Tiêu đề tài liệu.
- Danh mục tài liệu.
- Mô tả.
- Tag/từ khóa nếu có.

#### Các bước thực hiện

1. Vào tab **Tài liệu**.
2. Bấm **Upload** hoặc kéo thả file vào khu vực upload nếu hệ thống hỗ trợ.
3. Chọn một hoặc nhiều file.
4. Nhập tiêu đề.
5. Chọn danh mục tài liệu.
6. Nhập mô tả và tag nếu có.
7. Bấm **Tải lên**.

`[HÌNH MINH HỌA: Form upload tài liệu dự án]`

#### Kết quả sau khi hoàn tất

File được upload và hiển thị trong danh sách tài liệu của dự án.

#### Lưu ý

Nếu upload nhiều file cùng lúc, nên kiểm tra lại tiêu đề/danh mục từng file sau khi upload.

#### Lỗi thường gặp và cách xử lý

- **File quá lớn:** giảm dung lượng file hoặc kiểm tra giới hạn upload.
- **Không upload được:** kiểm tra quyền quản trị tab Tài liệu và kết nối mạng.

### 17.3. Xóa tài liệu

#### Mục đích

Xóa tài liệu không còn cần lưu hoặc upload nhầm.

#### Người thực hiện

User có quyền quản trị tab **Tài liệu**.

#### Điều kiện trước

Tài liệu đã tồn tại và user có quyền xóa.

#### Dữ liệu cần chuẩn bị

Tên tài liệu cần xóa.

#### Các bước thực hiện

1. Vào tab **Tài liệu**.
2. Tìm tài liệu cần xóa.
3. Bấm nút xóa.
4. Đọc cảnh báo.
5. Xác nhận xóa.

`[HÌNH MINH HỌA: Xác nhận xóa tài liệu]`

#### Kết quả sau khi hoàn tất

Tài liệu bị xóa khỏi danh sách và storage theo cơ chế hệ thống.

#### Lưu ý

Chỉ xóa tài liệu khi chắc chắn không còn cần tra cứu.

#### Lỗi thường gặp và cách xử lý

- **Không thấy nút xóa:** user không có quyền quản trị tab Tài liệu.
- **Xóa nhầm:** liên hệ Admin/IT để kiểm tra khả năng khôi phục từ backup nếu có.

## 18. Tab Báo cáo

### 18.1. Xem báo cáo tổng quan dự án

#### Mục đích

Xem báo cáo tổng hợp về hợp đồng, ngân sách, vật tư, PO, nghiệm thu, tiến độ và các chỉ số tài chính.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Báo cáo**.

#### Điều kiện trước

- Dự án đã liên kết công trường HRM.
- Dữ liệu nguồn đã được nhập ở các tab nghiệp vụ.

#### Dữ liệu cần chuẩn bị

Không bắt buộc nếu chỉ xem.

#### Các bước thực hiện

1. Mở chi tiết dự án.
2. Chọn tab **Báo cáo**.
3. Chọn chế độ **Tổng quan** nếu có.
4. Xem biểu đồ và chỉ số theo từng nhóm: hợp đồng, vật tư, PO, nghiệm thu, chi phí, tiến độ.
5. Bấm vào biểu đồ/khu vực cần xem chi tiết nếu hệ thống hỗ trợ.
6. Xuất dữ liệu nếu có nút xuất.

`[HÌNH MINH HỌA: Tab Báo cáo - báo cáo tổng quan]`

#### Kết quả sau khi hoàn tất

User có báo cáo tổng quan để phục vụ điều hành, họp dự án hoặc đối chiếu dữ liệu.

#### Lưu ý

Báo cáo chỉ chính xác khi dữ liệu nguồn được nhập đầy đủ và đúng trạng thái.

#### Lỗi thường gặp và cách xử lý

- **Báo cáo thiếu số liệu:** kiểm tra dữ liệu nguồn ở Hợp đồng, Vật tư, Tiến độ, Nhật ký, Dòng tiền.
- **Số liệu không khớp:** kiểm tra khoảng thời gian, trạng thái chứng từ và dữ liệu đã được xác nhận hay chưa.

### 18.2. Xem báo cáo nhật ký

#### Mục đích

Tổng hợp nhật ký công trường để kiểm tra khối lượng, nhân lực, máy móc, vật tư, ảnh và các sự kiện trễ.

#### Người thực hiện

Phòng Quản lý dự án hoặc user có quyền xem tab **Báo cáo** và **Nhật ký**.

#### Điều kiện trước

Dự án đã có nhật ký công trường.

#### Dữ liệu cần chuẩn bị

Khoảng thời gian hoặc ngày cần xem báo cáo.

#### Các bước thực hiện

1. Vào tab **Báo cáo**.
2. Chọn chế độ **Nhật ký** nếu có.
3. Chọn khoảng thời gian cần xem.
4. Kiểm tra danh sách nhật ký và các số liệu tổng hợp.
5. Mở nhật ký liên quan nếu cần xem chi tiết.

`[HÌNH MINH HỌA: Tab Báo cáo - báo cáo nhật ký]`

#### Kết quả sau khi hoàn tất

User xem được báo cáo tổng hợp nhật ký theo kỳ.

#### Lưu ý

Nên ưu tiên nhật ký đã xác nhận khi dùng cho báo cáo chính thức.

#### Lỗi thường gặp và cách xử lý

- **Không có dữ liệu nhật ký:** kiểm tra tab Nhật ký đã có dữ liệu trong khoảng thời gian chọn chưa.
- **Dữ liệu nhật ký chưa được tính vào tiến độ:** kiểm tra nhật ký đã được xác nhận chưa.

## 19. Checklist thao tác nhanh cho QLDA

### Khi tạo dự án mới

- [ ] Tạo dự án với mã/tên đúng quy chuẩn.
- [ ] Liên kết công trường HRM nếu có.
- [ ] Chọn người quản lý dự án.
- [ ] Chọn trạng thái và thời gian triển khai.
- [ ] Kiểm tra phương pháp tính tiến độ.
- [ ] Thêm nhân sự dự án trong tab Tổ chức.
- [ ] Gán quyền nghiệp vụ cho các user liên quan.
- [ ] Import/tạo tiến độ WBS.
- [ ] Import/tạo BOQ vật tư.

### Khi theo dõi dự án hằng ngày

- [ ] Kiểm tra tab Điều hành để xem cảnh báo.
- [ ] Kiểm tra tiến độ và các công việc trễ.
- [ ] Kiểm tra nhật ký mới/chờ xác nhận.
- [ ] Kiểm tra yêu cầu vật tư quá hạn hoặc đang chờ xử lý.
- [ ] Kiểm tra PO đang giao hoặc giao một phần.
- [ ] Kiểm tra hồ sơ chất lượng chờ duyệt.
- [ ] Kiểm tra thanh toán sắp tới hạn/quá hạn.

### Khi chuẩn bị họp dự án

- [ ] Mở tab Báo cáo tổng quan.
- [ ] Kiểm tra tiến độ thực tế so với kế hoạch.
- [ ] Kiểm tra hợp đồng/phát sinh.
- [ ] Kiểm tra vật tư vượt ngân sách/hao hụt.
- [ ] Kiểm tra nhật ký và delay.
- [ ] Kiểm tra dòng tiền và thanh toán.
- [ ] Xuất báo cáo hoặc chụp màn hình các biểu đồ cần trình bày.

## 20. Bảng lỗi thường gặp tổng hợp

| Tình huống | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Không thấy module Dự án | Chưa được cấp quyền module DA | Liên hệ Admin cấp quyền |
| Không thấy tab nghiệp vụ | Chưa được cấp quyền tab | Kiểm tra phân quyền module/sub-module |
| Không thấy nút tạo/sửa/xóa | User chỉ có quyền xem | Cấp quyền quản trị tab hoặc quyền nghiệp vụ phù hợp |
| Tab báo cần liên kết công trường HRM | Dự án chưa chọn công trường | Sửa dự án và chọn công trường HRM |
| Dashboard/báo cáo trống | Chưa có dữ liệu nguồn | Nhập dữ liệu ở Tiến độ, Hợp đồng, Vật tư, Nhật ký |
| Import Excel lỗi | Sai mẫu, sai header, sai định dạng ngày/số | Tải mẫu mới từ hệ thống và nhập lại |
| Không tạo yêu cầu vật tư từ BOQ | Chưa chọn dòng hoặc thiếu quyền | Chọn dòng BOQ và kiểm tra quyền submit |
| PO không tạo được | Thiếu nhà cung cấp, dòng vật tư hoặc quyền PO | Bổ sung dữ liệu và kiểm tra quyền quản trị PO |
| Nhật ký không gửi được | Thiếu người xác nhận hoặc thiếu quyền submit | Kiểm tra Tổ chức dự án và quyền gửi |
| Không duyệt/xác nhận được | User không phải người được giao hoặc thiếu quyền | Chuyển người xử lý hoặc cấp quyền phù hợp |

## 21. Danh sách placeholder hình cần bổ sung

1. `[HÌNH MINH HỌA: Menu Dự án và màn hình danh sách dự án]`
2. `[HÌNH MINH HỌA: Danh sách dự án với các cột thông tin chính]`
3. `[HÌNH MINH HỌA: Bộ lọc danh sách dự án]`
4. `[HÌNH MINH HỌA: Form tạo mới dự án]`
5. `[HÌNH MINH HỌA: Nút chỉnh sửa dự án trong màn hình chi tiết]`
6. `[HÌNH MINH HỌA: Trường chọn công trường HRM trong form dự án]`
7. `[HÌNH MINH HỌA: Màn hình chi tiết dự án và thanh tab nghiệp vụ]`
8. `[HÌNH MINH HỌA: Tab Điều hành - dashboard tổng quan]`
9. `[HÌNH MINH HỌA: Tab Tổ chức - danh sách thành viên dự án]`
10. `[HÌNH MINH HỌA: Form thêm thành viên dự án và gán quyền]`
11. `[HÌNH MINH HỌA: Tab/Form Ngân sách dự án]`
12. `[HÌNH MINH HỌA: Tab Hợp đồng - danh sách hợp đồng]`
13. `[HÌNH MINH HỌA: Workspace hợp đồng và các tab con]`
14. `[HÌNH MINH HỌA: Tab Tiến độ - bảng công việc và Gantt]`
15. `[HÌNH MINH HỌA: Import Excel tiến độ và màn hình preview]`
16. `[HÌNH MINH HỌA: Tab Nhật ký - lịch và danh sách nhật ký]`
17. `[HÌNH MINH HỌA: Form tạo nhật ký ngày]`
18. `[HÌNH MINH HỌA: Tab Nghiệm thu & Thanh toán - kế hoạch và bộ lọc]`
19. `[HÌNH MINH HỌA: Tab Dòng tiền - thẻ chỉ số và biểu đồ]`
20. `[HÌNH MINH HỌA: Tab Chất lượng - danh sách checklist/hồ sơ]`
21. `[HÌNH MINH HỌA: Tab Nhà thầu - danh sách hợp đồng thầu phụ]`
22. `[HÌNH MINH HỌA: Vật tư - tab Tổng hợp]`
23. `[HÌNH MINH HỌA: Vật tư - tab BOQ triển khai]`
24. `[HÌNH MINH HỌA: Vật tư - Kế hoạch vật tư theo tiến độ]`
25. `[HÌNH MINH HỌA: Vật tư - Kanban yêu cầu vật tư]`
26. `[HÌNH MINH HỌA: Vật tư - danh sách PO]`
27. `[HÌNH MINH HỌA: Vật tư - tab Hao hụt]`
28. `[HÌNH MINH HỌA: Vật tư - Dashboard biểu đồ và cảnh báo]`
29. `[HÌNH MINH HỌA: Tab Tài liệu - tìm kiếm, lọc và danh sách file]`
30. `[HÌNH MINH HỌA: Tab Báo cáo - báo cáo tổng quan]`
31. `[HÌNH MINH HỌA: Tab Báo cáo - báo cáo nhật ký]`
