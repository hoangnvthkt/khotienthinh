# Thiết kế lại Sơ đồ tổ chức và Định biên HRM

**Ngày:** 18/08/2026

**Trạng thái:** Đã được người dùng duyệt trong hội thoại

**Phạm vi:** Danh mục dùng chung HRM, sơ đồ tổ chức, định biên vị trí và phân bổ nhân sự

## 1. Bối cảnh

Phiên bản hiện tại hiển thị trực tiếp từng slot kỹ thuật. Các slot được dựng nền từ hồ sơ nhân viên cũ nên xuất hiện nhiều mã `LEGACY`, nhiều thẻ trống giống nhau và một số slot nằm sai đơn vị. Ví dụ QLDA hiển thị 11 thẻ `Cố vấn` với mã kỹ thuật, trong khi người quản lý chỉ cần biết QLDA có bao nhiêu định biên Cố vấn, đã bố trí bao nhiêu và còn trống bao nhiêu.

Form hồ sơ nhân viên hiện cũng cho sửa độc lập nhiều trường có cùng ý nghĩa tổ chức: `org_unit_id`, `department_id`, `construction_site_id`, `factory_id` và `position_id`. Các trường này có thể mâu thuẫn với nhau và với sơ đồ tổ chức.

Thiết kế mới tách ba lớp nghiệp vụ:

1. Danh mục vị trí công việc.
2. Định biên vị trí tại từng đơn vị.
3. Nhân viên được phân bổ vào định biên.

Slot kỹ thuật vẫn tồn tại để bảo đảm lịch sử, tính duy nhất và tuyến duyệt, nhưng không xuất hiện trong thao tác thông thường.

## 2. Mục tiêu

- Người quản lý nhìn sơ đồ là hiểu cơ cấu công ty, không cần hiểu mã slot hoặc cấu trúc database.
- Mỗi vị trí trong một đơn vị được hiển thị gộp theo số lượng định biên, đã bố trí và còn trống.
- Phân bổ tổ chức đang hiệu lực là nguồn dữ liệu chính cho đơn vị, vị trí, chức danh, nhóm VTCV và cấp bậc của nhân viên.
- Tuyến quản lý gắn với vị trí quản lý, không gắn cứng với một cá nhân.
- Loại bỏ `LEGACY` khỏi màn hình vận hành mà vẫn giữ lịch sử và khả năng truy vết.
- Chuyển đổi dữ liệu theo hai giai đoạn để không làm gián đoạn duyệt, phân quyền, danh bạ, sơ đồ 3D và dự án.
- Chuẩn bị nền dữ liệu cho P3 sau này nhưng không triển khai công thức lương trong phạm vi này.

## 3. Ngoài phạm vi

- Không triển khai thang bảng lương P3 hoặc công thức tính lương.
- Không tự động suy đoán định biên chính thức từ dữ liệu `LEGACY`.
- Không xóa cứng hồ sơ nhân viên, slot, vị trí hoặc lịch sử phân công.
- Không hỗ trợ đặt lịch thay đổi định biên trong tương lai ở phiên bản đầu.
- Không thay thế phân bổ nhân sự dự án/công trường chuyên biệt của module dự án.

## 4. Mô hình khái niệm

```text
Danh mục vị trí công việc
        ↓
Định biên vị trí theo đơn vị
        ↓
Slot kỹ thuật do hệ thống quản lý
        ↓
Phân bổ nhân viên đang hiệu lực
        ↓
Hồ sơ hiện tại + tuyến quản lý + nền P3 tương lai
```

### 4.1 Danh mục vị trí

Vị trí công việc là mẫu dùng chung, gồm mã, tên, nhóm VTCV, cấp bậc và đơn vị gợi ý nếu có. Một vị trí có thể được sử dụng tại nhiều đơn vị. Đơn vị gợi ý chỉ hỗ trợ nhập liệu, không tự quyết định nơi vị trí được đặt.

### 4.2 Định biên vị trí

Định biên là nhu cầu nhân sự của một đơn vị cho một vị trí và cấp bậc cụ thể. Người dùng thao tác bằng số lượng, ví dụ QLDA cần 1 Trưởng phòng và 3 Chuyên viên.

Số liệu hiển thị:

- `Định biên`: tổng số slot chính thức đang hoạt động.
- `Đã bố trí`: số slot có phân bổ nhân viên đang hiệu lực.
- `Còn trống`: định biên trừ đã bố trí.

Một dòng định biên được nhóm theo đơn vị, vị trí, cấp bậc và tuyến báo cáo. Hai slot có tuyến báo cáo khác nhau không bị gộp vào cùng một dòng.

### 4.3 Slot kỹ thuật

Mỗi đơn vị định biên vẫn được vật chất hóa thành các bản ghi `hrm_org_position_slots`. Mã slot được hệ thống sinh tự động và chỉ hiển thị trong lịch sử hoặc công cụ quản trị kỹ thuật.

Các slot chính thức mới có nguồn riêng, ví dụ `workforce_plan`, để phân biệt với `employee_backfill` và dữ liệu cũ. Giao diện vận hành chỉ tổng hợp slot chính thức đang hoạt động.

### 4.4 Phân bổ nhân viên

`hrm_employee_slot_assignments` là nguồn quyết định một nhân viên đang giữ vị trí nào. Mỗi nhân viên chỉ có một phân bổ chính đang hoạt động; mỗi slot chỉ có một người giữ chính hoặc quyền.

## 5. Trải nghiệm người dùng

### 5.1 Hai chế độ chính

#### Sơ đồ tổng quan

- Hiển thị cây Tổng công ty → Khối → Phòng/Ban/Công trường/Nhà máy.
- Mặc định thu gọn.
- Có tìm kiếm, mở toàn bộ và thu gọn toàn bộ.
- Không hiển thị từng slot kỹ thuật.
- Bấm một đơn vị để mở thông tin định biên bên cạnh hoặc chuyển sang chế độ chi tiết của đơn vị.

#### Định biên & nhân sự

Mỗi đơn vị hiển thị bảng gộp:

| Vị trí | Cấp bậc | Định biên | Đã bố trí | Còn trống | Quản lý |
|---|---:|---:|---:|---:|---|
| Chuyên viên | E4 | 3 | 2 | 1 | Không |
| Trưởng phòng | E7 | 1 | 1 | 0 | Có |

Các thao tác nghiệp vụ:

- Thêm định biên.
- Tăng hoặc giảm số lượng định biên.
- Phân bổ nhân viên.
- Chuyển vị trí nhân viên.
- Gỡ nhân viên khỏi tổ chức.
- Chọn vị trí quản lý của đơn vị.
- Mở lịch sử khi cần.

Không bổ sung thao tác `Chuyển slot` cho người dùng thông thường. Khi cần chuyển con người, người dùng chọn đơn vị và vị trí đích; hệ thống tự chọn slot trống phù hợp.

### 5.2 Thiết lập định biên

Form gồm:

- Đơn vị hiện tại, chỉ đọc.
- Vị trí công việc.
- Cấp bậc, mặc định theo vị trí nhưng có thể chọn lại nếu nghiệp vụ cho phép.
- Số lượng định biên.
- Vị trí báo cáo trực tiếp hoặc để trống để theo quản lý của đơn vị.
- Ghi chú.

Khi tăng số lượng, hệ thống tạo thêm slot. Khi giảm, hệ thống chỉ lưu trữ các slot trống. Nếu số slot trống không đủ, thao tác bị từ chối và hướng dẫn người dùng chuyển nhân viên trước.

### 5.3 Phân bổ và chuyển vị trí nhân viên

Người dùng chọn:

- Nhân viên.
- Đơn vị đích.
- Vị trí đích.
- Ngày hiệu lực, mặc định hôm nay; phiên bản đầu không cho chọn ngày tương lai.
- Lý do hoặc ghi chú.

Hệ thống tự chọn một slot trống thuộc định biên đích, kết thúc phân bổ cũ, tạo phân bổ mới và đồng bộ hồ sơ hiện tại trong một giao dịch.

Nếu không còn slot trống, hệ thống yêu cầu tăng định biên hoặc chọn vị trí khác.

### 5.4 Hồ sơ nhân viên

Khối `Phân bổ tổ chức hiện tại` trong form nhân viên hiển thị:

- Trạng thái `Đã phân bổ` hoặc `Chờ phân bổ`.
- Đơn vị trực thuộc.
- Vị trí công việc.
- Nhóm VTCV.
- Cấp bậc.
- Chức danh.
- Quản lý trực tiếp hiện tại.

Các trường này là chỉ đọc. Nút `Phân bổ / Chuyển vị trí` mở luồng phân bổ tổ chức.

Các trường sau vẫn được quản lý tại hồ sơ và không quyết định vị trí trên sơ đồ:

- Văn phòng/địa điểm làm việc.
- Phân loại nhân sự.
- Chính sách lương.
- Lịch làm việc.
- Tình trạng hôn nhân.
- Ngày phép và các dữ liệu cá nhân khác.

Các trường `Phòng/Ban`, `Công trường` và `Nhà máy` không còn được nhập độc lập. Chúng được suy ra từ đơn vị tổ chức hiện tại để phục vụ tương thích.

## 6. Quản lý trực tiếp và tuyến duyệt

Mỗi đơn vị chọn một slot quản lý, nhưng giao diện chỉ hiển thị vị trí quản lý và người đang giữ vị trí đó.

- Mỗi đơn vị chỉ có một định biên quản lý được chỉ định và định biên quản lý này có số lượng bằng 1.
- Người được phân bổ vào slot quản lý trở thành quản lý trực tiếp và người duyệt của đơn vị.
- Thay người trong vị trí quản lý tự động thay tuyến duyệt.
- Nếu slot quản lý trống, hệ thống tìm quản lý gần nhất từ đơn vị cha.
- Không dùng tên cá nhân làm cấu hình cố định.
- Không cho phép vòng lặp báo cáo hoặc một slot báo cáo cho chính nó.

## 7. Luồng dữ liệu nguyên tử

Các thao tác nhiều bước được thực hiện bằng hàm database có kiểm tra quyền và giao dịch nguyên tử.

### 7.1 Tạo hoặc thay đổi định biên

1. Kiểm tra Admin hoặc quản trị HRM.
2. Khóa nhóm slot liên quan để tránh hai người cùng chỉnh đồng thời.
3. Tăng hoặc giảm slot chính thức.
4. Từ chối giảm slot có người hoặc slot quản lý khi chưa chọn quản lý thay thế.
5. Ghi audit.
6. Trả số liệu định biên mới.

### 7.2 Phân bổ hoặc chuyển nhân viên

1. Kiểm tra nhân viên đang làm việc và định biên đích đang hoạt động.
2. Khóa nhân viên và các slot ứng viên.
3. Chọn một slot trống ổn định.
4. Kết thúc phân bổ chính cũ nếu có.
5. Tạo phân bổ mới.
6. Đồng bộ `org_unit_id`, `position_id`, `title` và các trường tương thích.
7. Ghi audit với đơn vị/vị trí cũ, mới, ngày và lý do.

### 7.3 Gỡ khỏi tổ chức

1. Kết thúc phân bổ đang hoạt động.
2. Trạng thái `Chờ phân bổ` được suy ra từ việc nhân viên không có phân bổ chính thức đang hoạt động; không tạo thêm một nguồn trạng thái thủ công.
3. Ở giai đoạn tương thích, giữ snapshot cũ cho các module chưa chuyển đổi; không dùng snapshot này để hiển thị trên sơ đồ mới.
4. Ghi audit.

## 8. Chuyển đổi dữ liệu hai giai đoạn

### Giai đoạn 1: Cắt sang giao diện mới an toàn

- Lưu trữ toàn bộ 43 slot nguồn `employee_backfill`; không xóa cứng.
- Giữ 44 lịch sử phân công đã kết thúc.
- Gỡ các liên kết quản lý đơn vị đang trỏ tới slot bị lưu trữ.
- Sơ đồ mới chỉ đọc slot nguồn chính thức nên bắt đầu với 0 định biên.
- Nhân viên không có phân bổ chính thức được suy ra là `Chờ phân bổ` trên giao diện mới.
- Giữ tạm các cột tổ chức/vị trí cũ làm dữ liệu tương thích cho workflow, danh bạ, sơ đồ 3D, dashboard và dự án.
- Ẩn vị trí `LEGACY` khỏi danh mục vận hành; giữ bản ghi cho lịch sử.

### Giai đoạn 2: Phân bổ lại và loại bỏ phụ thuộc cũ

- Khi nhân viên được phân bổ vào định biên mới, ghi đè snapshot tương thích bằng dữ liệu chính thức.
- Chuyển dần workflow, danh bạ, sơ đồ 3D, dashboard nhân viên và màn hình dự án sang nguồn phân bổ đang hiệu lực.
- Theo dõi số nhân viên còn `Chờ phân bổ` và các module còn đọc cột cũ.
- Chỉ ngưng hoàn toàn trường cũ sau khi không còn người và module phụ thuộc.

## 9. Tương thích dữ liệu nhân viên

Khi có phân bổ chính thức, hệ thống chiếu dữ liệu về bảng nhân viên để giữ tương thích:

- Luôn cập nhật `org_unit_id` và `position_id`.
- Nếu đơn vị là `department`, cập nhật `department_id` và xóa trường loại đơn vị không phù hợp.
- Nếu đơn vị là `construction_site`, cập nhật `construction_site_id` và xóa trường loại đơn vị không phù hợp.
- Nếu đơn vị là `factory`, cập nhật `factory_id` và xóa trường loại đơn vị không phù hợp.
- `office_id` không bị suy ra từ sơ đồ vì đây là địa điểm làm việc độc lập.
- `salary_policy_id`, `work_schedule_id`, loại nhân sự và dữ liệu cá nhân không bị thay đổi bởi phân bổ tổ chức.

## 10. Phân quyền và bảo mật

- Người dùng đã đăng nhập được xem sơ đồ và định biên theo quyền module hiện tại.
- Chỉ Admin hoặc quản trị HRM được thay đổi cơ cấu, định biên, quản lý trực tiếp và phân bổ nhân viên.
- Các hàm đặc quyền nằm trong schema không exposed; hàm public là wrapper `security invoker`.
- Tất cả bảng exposed tiếp tục bật RLS và không cấp quyền ghi cho `anon`.
- Không dùng metadata người dùng có thể sửa để quyết định quyền.

## 11. Xử lý lỗi

Thông báo phải dùng ngôn ngữ nghiệp vụ, không lộ mã lỗi database:

- `Định biên này đã đủ người. Hãy tăng định biên hoặc chọn vị trí khác.`
- `Không thể giảm định biên vì vẫn còn nhân viên đang được bố trí.`
- `Vị trí quản lý đang được sử dụng. Hãy chọn quản lý thay thế trước.`
- `Nhân viên đã được người khác phân bổ. Vui lòng làm mới dữ liệu.`
- `Đơn vị hoặc vị trí đã ngưng sử dụng.`
- `Không thể tạo tuyến báo cáo vòng lặp.`

Ràng buộc unique và khóa bản ghi là hàng bảo vệ cuối cùng cho thao tác đồng thời.

## 12. Kiểm thử và xác minh

### Kiểm thử tự động

- Tổng hợp đúng định biên, đã bố trí và còn trống.
- Tăng định biên tạo đúng số slot chính thức.
- Giảm định biên chỉ lưu trữ slot trống.
- Không giảm được slot có người hoặc slot quản lý chưa thay thế.
- Phân bổ chọn đúng slot trống và không tạo trùng.
- Chuyển vị trí kết thúc phân bổ cũ và đồng bộ hồ sơ mới.
- Gỡ nhân viên đưa về `Chờ phân bổ` nhưng giữ lịch sử.
- Quản lý trực tiếp ưu tiên vị trí quản lý của đơn vị rồi mới lên đơn vị cha.
- Form nhân viên không gửi thay đổi trực tiếp cho trường tổ chức chỉ đọc.
- Sơ đồ mới không hiển thị slot `employee_backfill`, slot lưu trữ hoặc vị trí `LEGACY`.

### Xác minh Supabase Cloud

- Chạy migration trong transaction thử và rollback.
- Kiểm tra số slot backfill trước/sau, số slot chính thức, phân bổ hoạt động và lịch sử.
- Kiểm tra RLS, quyền hàm và database advisors.
- Chạy smoke test cho tăng/giảm định biên, phân bổ, chuyển người, quản lý trực tiếp và rollback dữ liệu thử.

### Hồi quy ứng dụng

- Lint, toàn bộ test và production build.
- Kiểm tra danh bạ, workflow chọn người duyệt, sơ đồ 3D, dashboard nhân viên và tạo nhân sự dự án.
- Kiểm tra trực quan trạng thái mặc định thu gọn và luồng từ sơ đồ sang định biên.

## 13. Tiêu chí nghiệm thu

- Màn hình chính không còn mã `LEGACY` hoặc danh sách hàng loạt slot trống.
- QLDA và các đơn vị khác bắt đầu với 0 định biên chính thức sau cutover.
- Người dùng tạo được định biên bằng vị trí và số lượng mà không nhập mã slot.
- Người dùng phân bổ/chuyển nhân viên bằng đơn vị và vị trí đích.
- Hồ sơ nhân viên hiển thị phân bổ tổ chức chỉ đọc và có nút điều chuyển.
- Quản lý trực tiếp thay đổi theo người giữ vị trí quản lý; có fallback lên đơn vị cha.
- Dữ liệu cũ còn truy vết được nhưng không điều khiển sơ đồ mới.
- Các workflow và màn hình phụ thuộc hiện tại tiếp tục hoạt động trong giai đoạn chuyển đổi.
- P3 không bị thay đổi.
