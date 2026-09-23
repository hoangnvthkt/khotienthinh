# Tích hợp WBS, chốt tiến độ và nguồn lực vào Nhật ký công trường

**Ngày thiết kế:** 23/09/2026

**Trạng thái:** Đã bổ sung luồng tổng hợp theo khu vực, chờ duyệt lại trước khi lập kế hoạch triển khai

**Phạm vi:** Nhật ký công trường, tiến độ ngày/tuần, nhân công, giờ máy và chi phí nguồn lực tạm tính

## 1. Kết luận thiết kế

Nhật ký công trường trở thành điểm nhập liệu nghiệp vụ chính cho công việc thực hiện trong ngày:

- Người dùng chọn công việc lá từ cây WBS thực tế, không gõ tự do tên công việc.
- Trên từng công việc, người dùng khai báo `% hoàn thành lũy kế đến ngày lập nhật ký`, khối lượng lũy kế, khối lượng phát sinh trong ngày, nhân công, giờ máy và ngày dự kiến hoàn thành.
- Mỗi cán bộ hiện trường gửi một phiếu nguồn theo khu vực/mũi thi công mình phụ trách. Phiếu nguồn giữ riêng người báo cáo, khu vực, WBS, nguồn lực, sự cố và ảnh.
- Người tổng hợp chọn các phiếu nguồn để tạo một bản tổng hợp ngày; mỗi phiếu được giữ thành một ô khu vực có thể chỉnh trên bản sao tổng hợp mà không làm thay đổi phiếu gốc.
- Khi phiếu nguồn hoặc bản tổng hợp còn ở trạng thái nháp/chờ duyệt, dữ liệu chưa làm thay đổi tiến độ chính thức và chưa ghi nhận chi phí tài chính thực tế.
- Chỉ khi CHT xác nhận bản tổng hợp ngày, một lệnh giao dịch duy nhất mới công bố tiến độ ngày, cập nhật tổng hợp tuần, ghi nhận tiêu hao nguồn lực và tạo chi phí tạm tính nếu có đủ đơn giá.
- Tab Chốt tiến độ tiếp tục là nơi xem tổng hợp, lịch sử, khóa kỳ và xử lý ngoại lệ; không còn là nơi nhập lại dữ liệu ngày trong luồng thông thường.
- Chi phí từ nhật ký là chi phí ước tính/tạm tính. Chi phí thực tế chỉ hình thành khi đối soát với bảng lương, nghiệm thu thầu phụ, hóa đơn thuê máy hoặc chứng từ tài chính tương ứng.

Thiết kế này giữ nguyên dữ liệu lịch sử, không suy đoán để backfill và không thay đổi kiến trúc ngoài phạm vi Nhật ký - Tiến độ - Nguồn lực.

## 2. Mục tiêu sản phẩm

### 2.1 Người dùng chính

- Cán bộ hiện trường lập phiếu nguồn: cần nhập nhanh, đúng WBS và đúng khu vực phụ trách.
- Người tổng hợp: cần rà soát từng khu vực, chỉnh bản tổng hợp mà không làm mất báo cáo gốc, phát hiện trùng và gửi một hồ sơ ngày duy nhất cho CHT.
- Chỉ huy trưởng/người duyệt: cần thấy tổng quan toàn công trường trước, sau đó drill-down theo từng khu vực và người phụ trách.
- Kế hoạch/tiến độ: cần chuỗi tiến độ lũy kế nhất quán theo ngày và dữ liệu tổng hợp tuần có thể truy vết.
- QS/kiểm soát chi phí: cần biết nguồn lực đã tiêu hao theo WBS, phần đã định giá, chưa định giá và chênh lệch với chứng từ thực tế.

### 2.2 Kết quả mong muốn

- Một lần nhập tại phiếu nguồn phục vụ bản tổng hợp ngày, tiến độ và dữ liệu tiêu hao nguồn lực; người tổng hợp chỉ rà soát và điều chỉnh ngoại lệ.
- Mọi dòng tiến độ chính thức truy ngược được về bản tổng hợp đã được CHT xác nhận, ô khu vực và phiếu nguồn ban đầu.
- Nhân công và máy được gắn với công việc WBS thay vì chỉ tồn tại như danh sách rời.
- Không ghi trùng chi phí giữa nhật ký và các chứng từ tài chính.
- Người dùng nhìn vào màn hình trong vài giây là biết cần chọn công việc nào, nhập gì và hành động tiếp theo là gì.

## 3. Phạm vi và ngoài phạm vi

### 3.1 Trong phạm vi

- Chọn nhiều công việc lá từ cây WBS của dự án/công trường.
- Nhập tiến độ lũy kế và tự quy đổi khối lượng.
- Khai báo ngày dự kiến hoàn thành có kiểm soát thay đổi.
- Khai báo chi tiết nhân công và máy ngay trong ngữ cảnh từng công việc.
- Chọn nhiều phiếu nguồn, giữ thành các ô khu vực độc lập và chỉnh bản sao của từng ô trước khi gửi CHT.
- Tổng hợp toàn công trường nhưng vẫn truy nguyên được người phụ trách/khu vực.
- Công bố tiến độ chỉ khi bản tổng hợp ngày được CHT xác nhận.
- Ghi nhận chi phí nguồn lực tạm tính và trạng thái đối soát.
- Chuyển tab tiến độ ngày sang vai trò tổng hợp/ngoại lệ sau thời điểm cutover.
- Hỗ trợ dữ liệu lịch sử và rollout theo dự án/công trường.

### 3.2 Ngoài phạm vi

- Tính lương hoặc chấm công nhân sự.
- Duyệt hóa đơn thuê máy, nghiệm thu thầu phụ hoặc hạch toán kế toán đầy đủ.
- Thay thế hệ thống Gantt/WBS hiện tại.
- Tự động suy diễn WBS cho nhật ký lịch sử.
- Thiết kế lại toàn bộ màn hình Nhật ký công trường hoặc các module tài chính.
- Thay đổi luồng vật tư hiện tại trong nhật ký.

## 4. Hiện trạng đã xác minh

### 4.1 Luồng hiện tại

- Nhật ký lưu khối lượng, vật tư, nhân công và máy ở các bảng chi tiết riêng.
- Hệ thống đã có luồng nhiều phiếu nguồn trong ngày, một người tổng hợp lựa chọn nguồn và gửi bản tổng hợp cho CHT; bản tổng hợp hiện cộng khối lượng, nhân công và máy nhưng chưa giữ đầy đủ mô hình WBS/khu vực để công bố tiến độ an toàn.
- Nhật ký đang có hành động lấy khối lượng từ tiến độ ngày. Đây là chiều dữ liệu ngược với mục tiêu mới.
- Tiến độ ngày được lưu tại `project_daily_task_progress`; bảng đã có `source_daily_log_id` nhưng chưa được dùng làm nguồn chính từ Nhật ký.
- Tiến độ ngày/tuần đã có lệnh ghi tập trung, khóa kỳ và cơ chế tính lại tiến độ công việc/cha WBS.
- Nhân công và máy có `task_id`, nhưng tỷ lệ liên kết thực tế còn thấp và `total_cost` gần như chưa được hình thành.
- Báo cáo tiến độ có dùng nhật ký đã xác nhận để suy ra ngày bắt đầu thực tế; tổng hợp nhật ký có cộng số người, giờ công, ca và giờ máy.
- Chi phí thực tế của dự án hiện lấy từ `project_transactions`, không lấy từ chi tiết nhân công/máy trong nhật ký.

Tài liệu [Tổng hợp dữ liệu nhật ký ngày](./2026-07-22-daily-log-summary-aggregation-design.md) tiếp tục mô tả hành vi legacy đang chạy. Tài liệu hiện tại mở rộng và thay thế quy tắc gộp đối với WBS, tiến độ lũy kế, nguồn lực theo khu vực và công bố dữ liệu chính thức sau cutover.

### 4.2 Số liệu production tham chiếu tại thời điểm thiết kế

- Nhân công: 741 dòng; 42 dòng có liên kết WBS; 2 dòng có đơn giá; không có dòng phát sinh `total_cost`.
- Máy: 372 dòng; 89 dòng có liên kết WBS; 79 dòng có đơn giá; không có dòng phát sinh `total_cost`.
- Không có giao dịch chi phí thực tế nào trong `project_transactions` có nguồn từ nhật ký.

Kết luận: dữ liệu nhân công và máy hiện có tác dụng vận hành/báo cáo, nhưng chưa tạo được chuỗi kiểm soát chi phí công trình.

## 5. Các phương án đã cân nhắc

### Phương án A - Nhúng nguyên tab Chốt tiến độ vào Nhật ký

Ưu điểm là nhanh về giao diện. Nhược điểm là vẫn duy trì hai mô hình trạng thái, hai nút lưu và rủi ro người dùng không biết dữ liệu nào là chính thức. Không chọn.

### Phương án B - Tiến độ vẫn là nguồn chính, Nhật ký chỉ lấy dữ liệu về

Đây gần với luồng hiện tại nhưng không giảm thao tác và không giải quyết việc nhân công/máy thiếu liên kết WBS. Không chọn.

### Phương án C - Phiếu nguồn theo khu vực, bản tổng hợp ngày là nguồn chính thức

Mỗi phiếu nguồn giữ nguyên ngữ cảnh người phụ trách/khu vực. Người tổng hợp làm việc trên các bản sao theo khu vực và một bảng WBS toàn công trường. Chỉ bản tổng hợp ngày được CHT xác nhận mới công bố sang tiến độ ngày, tổng hợp tuần và chi phí nguồn lực tạm tính. Phương án này vừa giữ trách nhiệm từng người, vừa cho CHT góc nhìn tổng quan và tránh ghi trùng. **Chọn phương án C.**

## 6. Mô hình nghiệp vụ đích

```text
Cây WBS + tiến độ gần nhất + lịch kế hoạch
                    │
                    ▼
   Phiếu nguồn A   Phiếu nguồn B   Phiếu nguồn C/D
  (người + vùng)  (người + vùng)   (người + vùng)
          └──────────────┬──────────────┘
                         ▼
              Bản tổng hợp theo khu vực
       ┌─────────────────┴─────────────────┐
       │ Các ô khu vực có thể chỉnh        │
       │ Bảng WBS tổng quan toàn công trường│
       └─────────────────┬─────────────────┘
                         │ Gửi CHT
                         ▼
                CHT xác nhận bản tổng hợp
                    │ một giao dịch
       ┌────────────┼───────────────┐
       ▼            ▼               ▼
 Tiến độ ngày   Tổng hợp tuần   Chi phí tạm tính
 (chính thức)   nếu chưa khóa   (không phải actual)
                                      │
                                      ▼
                               Đối soát chứng từ
                                      │
                                      ▼
                              Chi phí thực tế tài chính
```

## 7. Thiết kế trải nghiệm người dùng

### 7.1 Cấu trúc màn hình

Giữ Design System hiện tại: Tailwind, typography, button, trạng thái, icon Lucide và cách tổ chức card/table đang dùng trong module dự án. Đây là màn hình ERP mật độ dữ liệu cao, không áp dụng phong cách landing page và không thêm thư viện UI mới chỉ cho tính năng này.

Khối `Nội dung công việc` trở thành bảng công việc WBS chính. Các tab Nhân công và Máy riêng không còn là nơi nhập liệu chính; dữ liệu được khai báo trong từng dòng WBS và có thể vẫn được trình bày ở báo cáo/tổng hợp.

### 7.2 Phiếu nguồn theo khu vực

Đơn vị báo cáo là một cặp `người phụ trách + khu vực/mũi thi công`, không phải chỉ là tài khoản người dùng:

- Một người phụ trách hai khu vực tạo hai phiếu nguồn để CHT nhìn đúng phạm vi trách nhiệm.
- Một phiếu nguồn khai báo rõ khu vực, WBS, tiến độ đề xuất, nhân công, máy, sự cố, kế hoạch ngày sau và ảnh.
- Phiếu nguồn đã gửi chỉ là dữ liệu đầu vào cho tổng hợp; không tự công bố tiến độ và không tạo accrual.
- Khi được chọn, hệ thống chụp snapshot phiếu nguồn vào bản tổng hợp. Người tổng hợp chỉnh bản sao theo khu vực, không sửa ngược phiếu nguồn.
- Nội dung đã chỉnh có nhãn `Đã điều chỉnh`, lưu người chỉnh, thời điểm, lý do và cho phép so sánh với bản nguồn.

### 7.3 Workspace tổng hợp ngày

Màn hình tổng hợp có hai tầng thông tin:

1. `Tổng quan toàn công trường`: số khu vực/phiếu, số WBS, tổng nhân công, tổng giờ công, tổng máy/giờ máy, số cảnh báo và vấn đề cần CHT chú ý.
2. `Theo khu vực`: mỗi phiếu nguồn được chọn là một card độc lập, giữ tên khu vực và người phụ trách.

Trên desktop, các card khu vực dùng lưới 2 cột; bốn nguồn được hiển thị thành 2 × 2 thay vì ép bốn cột. Mỗi card mặc định hiển thị tóm tắt và có thể mở để sửa chi tiết. Dưới các card là bảng WBS tổng hợp toàn công trường và các khối `Vấn đề cần CHT chú ý`, `Kế hoạch ngày sau`, `Ảnh theo khu vực`.

CHT xem cùng cấu trúc ở chế độ chỉ đọc: tổng quan trước, drill-down theo khu vực sau. CHT có thể duyệt, trả lại toàn bộ hoặc yêu cầu sửa một khu vực; yêu cầu sửa khu vực làm bản tổng hợp quay lại người tổng hợp và giữ bình luận gắn đúng card.

### 7.4 Bảng WBS trên desktop

| Cột | Nội dung hiển thị | Cách nhập |
|---|---|---|
| Hạng mục WBS | Mã WBS, tên công việc, cấp cây, đơn vị, khối lượng kế hoạch | Chọn từ cây; chỉ chọn công việc lá |
| Tiến độ đến ngày nhật ký | `% lũy kế`, khối lượng lũy kế, khối lượng trong ngày | Nhập `%` hoặc khối lượng lũy kế; giá trị còn lại tự tính |
| Nhân công hôm nay | Tổng số người và tổng giờ công; cảnh báo chưa gắn nguồn/chưa định giá | Bấm mở chi tiết nhiều dòng |
| Máy hôm nay | Tổng số máy và tổng giờ máy; cảnh báo chưa gắn nguồn/chưa định giá | Bấm mở chi tiết nhiều dòng |
| Dự kiến hoàn thành | Ngày `dd/mm/yyyy`, nhãn thay đổi so với lịch gần nhất | Sửa ngày; bắt buộc lý do nếu thay đổi |
| Ghi chú/bằng chứng | Ghi chú ngắn, số tệp/ảnh | Mở panel chi tiết |

Hành vi chính:

- Header và cột WBS được ghim khi cuộn.
- Ô tiến độ hiển thị cả giá trị trước ngày nhật ký và phần tăng trong ngày để người duyệt phát hiện nhầm lũy kế.
- Ô nhân công/máy chỉ hiển thị tổng gọn; chi tiết mở dạng dòng con hoặc side panel, tránh biến bảng thành biểu mẫu quá rộng.
- Trên phiếu nguồn, nút chính là `Lưu nháp` và `Gửi tổng hợp`. Trên bản tổng hợp, nút chính là `Lưu tổng hợp` và `Gửi CHT`. Không có nút lưu tiến độ riêng.
- Trạng thái đã xác nhận là chỉ đọc; chỉnh sửa phải đi qua luồng điều chỉnh.

### 7.5 Chọn WBS

Drawer chọn WBS có:

- Tìm theo mã hoặc tên.
- Mở/đóng cây WBS.
- Bộ lọc `Kế hoạch hôm nay`, `Kế hoạch tuần này`, `Đang thi công`, `Đã chọn gần đây` và `Tất cả`.
- Checkbox chỉ xuất hiện ở công việc lá; node cha chỉ dùng điều hướng và hiển thị tiến độ tổng hợp.
- Mỗi công việc cho thấy đơn vị, khối lượng kế hoạch, tiến độ gần nhất và ngày kết thúc kế hoạch.
- Công việc đã chọn được đánh dấu rõ; không thể thêm trùng trong cùng nhật ký.

Nếu công việc chưa có khối lượng kế hoạch, người dùng vẫn có thể khai báo `%`; khối lượng lũy kế và khối lượng trong ngày hiển thị `Chưa có cơ sở quy đổi`, không hiển thị `0`.

### 7.6 Chi tiết nhân công trong một WBS

Mỗi công việc có thể có nhiều dòng nhân công. Một dòng gồm:

- Nguồn/nhóm nhân công từ catalog hoặc đối tác.
- Số người.
- Số giờ mỗi người trong ngày.
- Tổng giờ công do hệ thống tính: `số người × giờ/người`.
- Ghi chú nếu cần.
- Trạng thái định giá chỉ hiển thị cho người có quyền xem chi phí.

Không yêu cầu cán bộ hiện trường nhập đơn giá. Đơn giá được tra theo nguồn giá được quản trị và ngày hiệu lực. Đối với dữ liệu cũ, trường `hours` không được tự diễn giải lại nếu chưa xác định nó là giờ/người hay tổng giờ.

### 7.7 Chi tiết máy trong một WBS

Mỗi công việc có thể có nhiều dòng máy. Một dòng gồm:

- Loại máy/thiết bị từ catalog, tài sản hoặc đối tác cho thuê.
- Số lượng máy.
- Số giờ mỗi máy trong ngày.
- Tổng giờ máy do hệ thống tính: `số máy × giờ/máy`.
- Số ca quy đổi chỉ đọc nếu nguồn giá tính theo ca.
- Ghi chú nếu cần.
- Trạng thái định giá chỉ hiển thị cho người có quyền xem chi phí.

Không cho phép đồng thời sửa cả giờ máy và số ca như hai đại lượng độc lập. Một đại lượng là đầu vào, đại lượng còn lại là kết quả quy đổi theo số giờ/ca được cấu hình và chụp snapshot.

### 7.8 Tablet và mobile

- Tablet: các card khu vực chuyển thành một cột hoặc hai cột theo chiều rộng; bảng WBS có cuộn ngang và ghim cột WBS.
- Mobile: tổng quan vẫn xuất hiện đầu tiên; mỗi khu vực là một accordion, bên trong mỗi WBS là một card con. Phần đầu hiển thị người phụ trách, tên khu vực, `% lũy kế`, tăng trong ngày và cảnh báo.
- Nút lưu/gửi duyệt được ghim ở cuối màn hình nhưng không che nội dung hoặc bàn phím.
- Trường ngày dùng date picker hệ thống nhưng luôn hiển thị `dd/mm/yyyy`.

### 7.9 Trạng thái bắt buộc

- Loading: skeleton theo hàng, không nhảy layout.
- Chưa có WBS: hướng dẫn tạo/nhập tiến độ trước khi lập nhật ký.
- Không có kết quả tìm kiếm: giữ bộ lọc và cho phép xóa nhanh.
- Thiếu khối lượng kế hoạch: hiển thị `Chưa có cơ sở quy đổi`.
- Thiếu đơn giá: hiển thị `Chưa định giá`, không dùng `0 đồng`.
- Không đủ quyền: giải thích hành động nào bị hạn chế; không ẩn lỗi.
- Dữ liệu đã thay đổi ở nơi khác: hiển thị xung đột và tải lại baseline trước khi cho ghi đè.
- Phiếu nguồn thay đổi sau khi được chọn: card chuyển sang `Nguồn đã thay đổi`; người tổng hợp chọn cập nhật snapshot hoặc giữ bản đã chỉnh với lý do.
- Phiếu nguồn bị trả lại: không được gửi bản tổng hợp cho đến khi bỏ nguồn hoặc nguồn được gửi lại hợp lệ.
- Trùng nguồn lực/khối lượng giữa khu vực: hiển thị cảnh báo theo dòng và yêu cầu người tổng hợp xác nhận cách xử lý.
- Ngày/tuần đã khóa: chỉ đọc và chỉ dẫn luồng mở khóa/điều chỉnh.
- Chờ duyệt: khóa các trường ảnh hưởng tiến độ, cho phép rút lại nếu quy trình hiện tại cho phép.
- Đã xác nhận: chỉ đọc, có liên kết sang bản ghi tiến độ và chi phí tạm tính.
- Đã điều chỉnh/thay thế: gắn nhãn phiên bản và liên kết nhật ký thay thế.

## 8. Quy tắc tiến độ

### 8.1 Đại lượng chính

- `% hoàn thành` là **lũy kế đến ngày lập nhật ký**.
- Khối lượng lũy kế được tính theo:

```text
khối lượng lũy kế = khối lượng kế hoạch snapshot × % lũy kế / 100
```

- Khối lượng trong ngày được tính theo:

```text
khối lượng trong ngày = khối lượng lũy kế của ngày hiện tại
                      - khối lượng lũy kế chính thức gần nhất trước ngày đó
```

- Người dùng có thể nhập `% lũy kế` hoặc khối lượng lũy kế khi có cơ sở quy đổi; hệ thống tính trường còn lại. Không cho hai giá trị mâu thuẫn.
- Tiến độ node cha chỉ được tính từ các công việc con theo quy tắc rollup hiện có; không nhập trực tiếp.

### 8.2 Ràng buộc

- Giá trị mặc định là tiến độ chính thức gần nhất trước hoặc trong ngày, không phải `0`.
- Trong luồng bình thường, tiến độ lũy kế không được giảm.
- Nếu nhập cho ngày quá khứ, giá trị mới không được lớn hơn tiến độ chính thức của ngày tiếp theo.
- Tiến độ trên 100% chỉ được giữ nếu quy tắc hiện hành của công việc lá cho phép; giao diện phải hiển thị vượt kế hoạch rõ ràng.
- Khi đạt 100%, hệ thống ghi nhận ngày hoàn thành thực tế theo ngày nhật ký nếu chưa có và khóa sửa ngày dự kiến hoàn thành trên dòng đó.
- Không tự thay đổi ngày kết thúc baseline của công việc. Dự kiến hoàn thành là forecast có lịch sử riêng.

### 8.3 Ngày dự kiến hoàn thành

- Mặc định lấy forecast được xác nhận gần nhất; nếu chưa có thì lấy ngày kết thúc theo kế hoạch hiện tại.
- Nếu người dùng thay đổi ngày, bắt buộc nhập lý do.
- Mỗi lần CHT xác nhận bản tổng hợp sẽ lưu snapshot forecast và lý do, phục vụ lịch sử trượt tiến độ.
- Nếu công việc chưa có ngày kế hoạch, trường được để trống và hiển thị rõ `Chưa có ngày kế hoạch`.

### 8.4 Chỉnh sửa ngày quá khứ

Bản tổng hợp đã được CHT xác nhận không được sửa trực tiếp. Luồng điều chỉnh:

1. Người có quyền tạo bản điều chỉnh từ nhật ký gốc.
2. Nếu kỳ đã khóa, phải mở khóa với lý do theo cơ chế hiện có.
3. Lệnh xác nhận bản điều chỉnh khóa các dòng tiến độ liên quan, tính lại baseline phía máy chủ và kiểm tra ngày liền trước/liền sau.
4. Bản cũ được đánh dấu đã bị thay thế; chuỗi truy vết không bị xóa.
5. `daily_quantity_done` của các ngày sau được tính lại khi cần, nhưng giá trị lũy kế đã xác nhận của các ngày sau không bị âm thầm thay đổi.

### 8.5 Tổng hợp khi nhiều khu vực cùng báo một WBS

Không cộng hoặc lấy trung bình đơn giản `% lũy kế` từ các phiếu nguồn:

- Nếu mỗi khu vực dùng một WBS lá riêng, tiến độ chính thức được giữ theo từng WBS và node cha rollup bằng quy tắc hiện có.
- Nếu nhiều khu vực cùng dùng một `task_id` và mỗi khu vực có khối lượng kế hoạch phân bổ riêng, hệ thống cộng khối lượng lũy kế được chấp nhận rồi chia cho tổng khối lượng kế hoạch phân bổ để tính `% lũy kế` có trọng số.
- Nếu nhiều khu vực cùng dùng một `task_id` nhưng chưa có khối lượng kế hoạch phân bổ theo khu vực, hệ thống không thể tính chính xác từ các phần trăm nguồn. Người tổng hợp phải chốt một giá trị lũy kế chính thức cho WBS và bản tổng hợp mang cảnh báo `Chưa có cơ sở phân bổ theo khu vực`.
- Khối lượng trong ngày chỉ được cộng khi các card khu vực đại diện cho phạm vi không trùng nhau. Trường hợp nghi ngờ trùng phải được người tổng hợp xác nhận loại bỏ, giữ một nguồn hoặc điều chỉnh số liệu.
- Ngày dự kiến hoàn thành chính thức lấy giá trị do người tổng hợp chốt; nếu các nguồn khai khác nhau, card và bảng tổng quan hiển thị xung đột cho đến khi xử lý.

Bảng WBS tổng hợp luôn cho phép mở các dòng con theo khu vực để CHT biết tổng số được hình thành từ ai và ở đâu.

## 9. Quy tắc nguồn lực và chi phí

### 9.1 Nhân công

Đại lượng vận hành chuẩn là `giờ công`:

```text
tổng giờ công = số người × giờ mỗi người
```

Đơn giá được khai báo rõ đơn vị:

- `VND/giờ công`; hoặc
- `VND/ngày công`, với số giờ/ngày tiêu chuẩn lấy từ cấu hình và được snapshot tại thời điểm xác nhận.

Nếu dùng đơn giá ngày công:

```text
ngày công quy đổi = tổng giờ công / số giờ tiêu chuẩn mỗi ngày
chi phí tạm tính = ngày công quy đổi × đơn giá ngày công
```

Không mặc định ngầm 8 giờ. Giao diện có thể gợi ý theo cấu hình công ty/công trường, nhưng phải lưu số giờ tiêu chuẩn đã dùng.

### 9.2 Máy

Đại lượng vận hành chuẩn là `giờ máy`:

```text
tổng giờ máy = số máy × giờ mỗi máy
```

Đơn giá được khai báo rõ đơn vị:

- `VND/giờ máy`; hoặc
- `VND/ca`, với số giờ/ca tiêu chuẩn lấy từ cấu hình và được snapshot.

Nếu dùng đơn giá ca:

```text
ca quy đổi = tổng giờ máy / số giờ tiêu chuẩn mỗi ca
chi phí tạm tính = ca quy đổi × đơn giá ca
```

### 9.3 Ba lớp giá trị chi phí

| Lớp | Nguồn | Ý nghĩa | Có vào actual cost không |
|---|---|---|---|
| Tiêu hao vận hành | Bản tổng hợp đã được CHT xác nhận | Số người, giờ công, số máy, giờ máy theo WBS | Không |
| Chi phí tạm tính | Tiêu hao × đơn giá hiệu lực | Dự báo/kiểm soát sớm; có thể chưa định giá | Không |
| Chi phí thực tế | Bảng lương, nghiệm thu thầu phụ, hóa đơn thuê máy, giao dịch tài chính | Giá trị đã được đối soát/chấp nhận | Có |

Không tự động tạo `project_transactions` từ Nhật ký. Khi chứng từ thực tế xuất hiện, hệ thống liên kết và đối soát với chi phí tạm tính; báo cáo trình bày riêng `Tạm tính`, `Thực tế`, `Chưa đối soát` và `Chênh lệch`.

### 9.4 Trạng thái định giá/đối soát

- `unpriced`: có tiêu hao nhưng chưa tìm được đơn giá hợp lệ.
- `estimated`: đã tính chi phí tạm tính, chưa có chứng từ thực tế.
- `partially_matched`: mới đối soát một phần.
- `matched`: đã đối soát đủ theo nguyên tắc nghiệp vụ.
- `void`: bị hủy do bản tổng hợp bị thay thế hoặc điều chỉnh.

Người không có quyền tài chính chỉ nhìn thấy trạng thái `Đã định giá/Chưa định giá`, không thấy đơn giá hoặc số tiền.

## 10. Mô hình dữ liệu đề xuất

### 10.1 Mở rộng `daily_log_contributions` và `daily_log_summary_sources`

Không tạo một mô hình nguồn song song. Luồng mới mở rộng đúng hai bảng đang vận hành:

- `daily_log_contributions` là phiếu nguồn. Thêm `work_area_code`, `work_area_name` và version/fingerprint dùng khi tổng hợp.
- `daily_log_summary_sources` là card khu vực trong bản tổng hợp. Mỗi dòng là một snapshot có thể chỉnh của một contribution đã được chọn.

| Nhóm trường | Trường chính |
|---|---|
| Bản tổng hợp | `id`, `daily_log_id`, `contribution_id`, `sort_order` |
| Nguồn | `source_version`, `source_fingerprint`, `source_snapshot`, `source_state` |
| Trách nhiệm | `source_user_id`, `source_user_name`, `work_area_code`, `work_area_name` |
| Điều chỉnh | `has_adjustments`, `adjustment_reason`, `adjusted_by`, `adjusted_at` |
| Phản hồi CHT | `review_status`, `review_comment`, `reviewed_by`, `reviewed_at` |
| Audit | `created_at`, `updated_at` |

Ràng buộc unique hiện có `(daily_log_id, contribution_id)` tiếp tục ngăn đưa cùng một phiếu nguồn vào bản tổng hợp hai lần. `source_state` nhận một trong `current`, `changed`, `returned`, `missing`; `review_status` nhận một trong `draft`, `ready`, `change_requested`, `accepted`, `superseded`. `source_snapshot` giữ nội dung gốc phục vụ diff và không thay đổi sau khi chụp; nội dung người tổng hợp chỉnh được lưu ở các bảng chi tiết gắn `summary_source_id`.

### 10.2 `daily_log_work_items`

Bảng mới làm mô hình chuẩn cho các dòng công việc WBS trong nhật ký:

| Nhóm trường | Trường chính |
|---|---|
| Định danh | `id`, `contribution_id`, `daily_log_id`, `summary_source_id`, `source_work_item_id`, `project_id`, `construction_site_id`, `task_id`, `work_boq_item_id` |
| Khu vực | `work_area_code`, `work_area_name_snapshot`, `area_planned_quantity_snapshot` |
| Snapshot WBS | `wbs_code_snapshot`, `task_name_snapshot`, `unit_snapshot`, `planned_quantity_snapshot` |
| Baseline khi mở/sửa | `baseline_progress_percent`, `baseline_quantity_done`, `baseline_progress_row_id`, `baseline_fingerprint` |
| Giá trị nhập | `cumulative_progress_percent`, `cumulative_quantity_done`, `daily_quantity_done` |
| Forecast | `schedule_finish_date_snapshot`, `forecast_finish_date`, `forecast_change_reason` |
| Nội dung | `note`, `attachments`, `source_index` |
| Audit | `created_at`, `updated_at` |

Ràng buộc:

- Phiếu nguồn dùng partial unique `(contribution_id, task_id)` khi `contribution_id IS NOT NULL`.
- Bản tổng hợp dùng partial unique `(daily_log_id, summary_source_id, task_id)` khi `summary_source_id IS NOT NULL`, cho phép cùng WBS xuất hiện ở nhiều khu vực nhưng không trùng trong một card.
- Check constraint bắt buộc mỗi dòng thuộc đúng một dạng owner: phiếu nguồn (`contribution_id`) hoặc card tổng hợp (`daily_log_id + summary_source_id`).
- `task_id` phải thuộc đúng project/site và là công việc lá tại thời điểm lưu.
- Phần trăm/khối lượng không âm; quy tắc vượt 100% dùng cùng rule hiện tại của tiến độ.
- `attachments` luôn là JSON array hợp lệ.
- Các giá trị chưa biết lưu `NULL`, không ép về `0`.

Không thay thế hoặc xóa `daily_log_volumes` ngay. Nhật ký mới dùng `daily_log_work_items`; báo cáo đọc mô hình mới trước và tạo projection tương thích khi cần. Nhật ký lịch sử tiếp tục đọc từ bảng cũ.

### 10.3 Mở rộng `daily_log_labor`

Thêm các trường:

- `daily_log_work_item_id`.
- `contribution_id`, `summary_source_id` và `source_labor_line_id` để truy về card/phiếu nguồn.
- `people_count` hoặc chuẩn hóa ý nghĩa của `count` là số người.
- `hours_per_person`.
- `total_labor_hours`.
- `standard_hours_snapshot`.
- `rate_unit` và `rate_source_id` chỉ lưu qua lệnh phía máy chủ khi cần.

Cho phép `daily_log_id` rỗng đối với dòng thuộc phiếu nguồn và bổ sung owner check tương tự `daily_log_work_items`. Giữ `task_id` để tương thích, nhưng lệnh lưu phải đảm bảo nó trùng với WBS của `daily_log_work_item_id`.

### 10.4 Mở rộng `daily_log_machines`

Thêm các trường:

- `daily_log_work_item_id`.
- `contribution_id`, `summary_source_id` và `source_machine_line_id` để truy về card/phiếu nguồn.
- `machine_count`.
- `hours_per_machine`.
- `total_machine_hours`.
- `standard_shift_hours_snapshot`.
- `shift_equivalent`.
- `rate_unit` và `rate_source_id` chỉ lưu qua lệnh phía máy chủ khi cần.

Cho phép `daily_log_id` rỗng đối với dòng thuộc phiếu nguồn và bổ sung owner check tương tự `daily_log_work_items`. Giữ `hours`, `shifts` và `task_id` cho tương thích trong thời gian chuyển đổi; bản ghi mới phải có trường semantics/version để không trộn ý nghĩa với dữ liệu cũ.

### 10.5 `project_resource_cost_accruals`

Bảng mới ghi chi phí nguồn lực tạm tính từ bản tổng hợp ngày đã được CHT xác nhận:

| Nhóm trường | Trường chính |
|---|---|
| Phạm vi | `project_id`, `construction_site_id`, `task_id`, `work_item_id` |
| Nguồn | `resource_type`, `source_table`, `source_line_id`, `source_daily_log_id` |
| Tiêu hao | `usage_quantity`, `usage_unit`, `standard_hours_snapshot` |
| Đơn giá | `rate_amount`, `rate_unit`, `rate_source_type`, `rate_source_id`, `rate_effective_date` |
| Giá trị | `estimated_amount`, `matched_actual_amount`, `variance_amount` |
| Trạng thái | `pricing_status`, `reconciliation_status`, `voided_at`, `void_reason` |
| Audit | `created_by`, `created_at`, `updated_at` |

Ràng buộc idempotency đảm bảo một dòng chi tiết thuộc bản tổng hợp đang hiệu lực chỉ tạo một accrual đang hiệu lực. Phiếu nguồn không tạo accrual. Bản tổng hợp bị thay thế sẽ void accrual cũ và tạo accrual mới, không sửa mất lịch sử.

### 10.6 Liên kết đối soát

Dùng bảng liên kết riêng giữa accrual và chứng từ thực tế để hỗ trợ một-nhiều/nhiều-một:

- `accrual_id`.
- `actual_source_type`.
- `actual_source_id`.
- `matched_amount`.
- `matched_quantity`.
- `matched_by`, `matched_at`, `note`.

Tổng phân bổ không được vượt giá trị chứng từ hoặc accrual nếu không có quyền ngoại lệ và lý do.

## 11. Lệnh nghiệp vụ và tính toàn vẹn giao dịch

### 11.1 Tải bundle màn hình

Một RPC/read model duy nhất tải theo project/site/ngày:

- Cây WBS và quan hệ cha-con.
- Khối lượng kế hoạch, đơn vị, ngày kế hoạch.
- Tiến độ chính thức gần nhất trước ngày và bản ghi kế tiếp nếu đang nhập quá khứ.
- Phiếu nguồn, card khu vực, snapshot/diff, dòng WBS, nhân công và máy hiện có.
- Trạng thái khóa ngày và tuần.
- Khả năng định giá; chỉ trả số tiền khi người dùng có quyền.
- Version/fingerprint dùng cho optimistic concurrency.

Không thực hiện truy vấn đơn lẻ theo từng hàng WBS.

### 11.2 Lưu phiếu nguồn

Lệnh lưu/gửi phiếu nguồn:

- Kiểm tra quyền sửa nhật ký, phạm vi project/site và trạng thái nhật ký.
- Bắt buộc khu vực/mũi thi công và gắn người chịu trách nhiệm từ actor/assignment; không suy ra khu vực chỉ từ tên người dùng.
- Upsert các dòng WBS và nguồn lực trong một transaction.
- Kiểm tra semantics số người/giờ và số máy/giờ.
- Không ghi `project_daily_task_progress`.
- Không tạo chi phí tạm tính.
- Trả lại version mới và các cảnh báo `thiếu khối lượng`, `thiếu nguồn`, `chưa định giá`.

### 11.3 Tạo và chỉnh bản tổng hợp

Khi người tổng hợp chọn một phiếu nguồn, command chụp snapshot vào `daily_log_summary_sources` và tạo các dòng chi tiết gắn `summary_source_id`. Command phải:

- Không đưa cùng một nguồn vào hai lần.
- Giữ nguyên card đã được chỉnh khi nguồn thay đổi; chỉ cập nhật khi người tổng hợp chủ động chọn `Cập nhật từ phiếu`.
- Đánh dấu diff ở từng trường/dòng đã chỉnh thay vì chỉ một cờ chung cho toàn bản tổng hợp.
- Tính tổng quan toàn công trường và cảnh báo cùng WBS, cùng nguồn lực hoặc phạm vi có nguy cơ trùng.
- Cho phép bỏ card khỏi bản nháp; thao tác này không xóa phiếu nguồn.
- Không cho gửi CHT nếu nguồn bị trả lại, thiếu khu vực, còn xung đột tiến độ chưa xử lý hoặc snapshot không còn hợp lệ.

### 11.4 Gửi CHT

Preflight trước khi gửi:

- Có ít nhất một card khu vực hợp lệ và một WBS hoặc nội dung bắt buộc theo quy tắc nhật ký hiện tại.
- Không có dòng trùng WBS trong cùng card; cùng WBS giữa nhiều card phải có kết quả tổng hợp chính thức.
- Các giá trị lũy kế hợp lệ với baseline và ngày kế tiếp.
- Mọi thay đổi forecast có lý do.
- Nhân công/máy có số lượng và thời gian hợp lệ.
- Mọi chỉnh sửa của người tổng hợp có audit; thay đổi trọng yếu có lý do.
- Cảnh báo thiếu đơn giá không chặn gửi; lỗi liên kết WBS hoặc xung đột tiến độ thì chặn.

### 11.5 CHT xác nhận và công bố

Dùng một RPC command `SECURITY DEFINER` với helper trong `app_private`, `search_path = ''`, chỉ cấp `EXECUTE` cho `authenticated`. Command phải:

1. Xác thực actor bằng `current_app_user_id()` và kiểm tra user đang hoạt động.
2. Kiểm tra quyền xác nhận nhật ký và quyền công bố tiến độ trong đúng phạm vi.
3. Xác nhận đối tượng là bản tổng hợp ngày hợp lệ, không phải phiếu nguồn; có ít nhất một card nguồn và mọi nguồn đều đúng scope/date.
4. Khóa bản tổng hợp, các summary source, trạng thái kỳ, các dòng tiến độ liên quan và kiểm tra expected version/fingerprint của toàn chuỗi nguồn.
5. Tính lại baseline và kết quả gộp khu vực phía máy chủ; không tin `daily_quantity_done`, tổng nguồn lực hoặc chi phí do client gửi.
6. Kiểm tra khóa kỳ, tính đơn điệu, bản ghi liền trước/liền sau, WBS lá và các xác nhận không trùng phạm vi.
7. Upsert đúng một `project_daily_task_progress` cho mỗi `(scope_key, task_id, progress_date)`, với `source_daily_log_id` trỏ đến bản tổng hợp.
8. Tính lại rollup tuần nếu tuần chưa khóa, dùng cơ chế hiện có.
9. Cập nhật tiến độ và ngày thực tế của `project_tasks` theo quy tắc hiện có.
10. Tạo/void `project_resource_cost_accruals` chỉ từ chi tiết nguồn lực của bản tổng hợp.
11. Chuyển trạng thái bản tổng hợp và các phiếu nguồn sang trạng thái tương ứng, ghi audit và trả receipt/fingerprint.

Toàn bộ thành công hoặc toàn bộ rollback. Gọi lại cùng `command_id` phải trả cùng kết quả, không tạo trùng tiến độ hay chi phí.

## 12. Nguồn dữ liệu chính thức và tab Tiến độ

### 12.1 Sau cutover

- Với ngày sau mốc cutover của project/site, tiến độ ngày thông thường chỉ được công bố từ **bản tổng hợp ngày đã được CHT xác nhận**.
- Phiếu nguồn và card khu vực không được tạo bản ghi tiến độ hoặc chi phí độc lập.
- Tab Tiến độ ngày hiển thị nguồn `Nhật ký tổng hợp`, liên kết đến bản tổng hợp và cho phép drill-down đến card khu vực/phiếu nguồn ở trạng thái chỉ đọc.
- Người có quyền đặc biệt có thể tạo điều chỉnh/ngoại lệ; mọi ngoại lệ bắt buộc lý do và audit.
- Tiến độ tuần tiếp tục tổng hợp từ các ngày, cho phép khóa/mở khóa theo luồng hiện có.

### 12.2 Dữ liệu cũ

- Bản ghi tiến độ không có `source_daily_log_id` được gắn nhãn `Nhập thủ công/Legacy`.
- Nhật ký dùng `daily_log_volumes` vẫn hiển thị bình thường.
- Không tự động ghép lịch sử theo tên hoặc ngày vì dễ gắn nhầm WBS.
- Hành động `Lấy từ chốt tiến độ` chỉ giữ cho dữ liệu legacy trong giai đoạn chuyển đổi và bị loại khỏi luồng tạo nhật ký mới sau cutover.

## 13. Quyền và bảo mật

### 13.1 Nguyên tắc quyền

- Người lập phiếu nguồn: quyền tạo/sửa phiếu của mình và quyền xem WBS/tiến độ của đúng Room/phạm vi; không có quyền công bố tiến độ.
- Người tổng hợp: quyền chọn/bỏ nguồn, chỉnh bản sao theo khu vực, xử lý xung đột và gửi bản tổng hợp cho CHT; không được sửa phiếu nguồn gốc.
- CHT/người xác nhận: quyền xác nhận bản tổng hợp và một action rõ ràng để công bố tiến độ; không mặc định nâng quyền chỉ vì có quyền sửa nhật ký.
- Người xem chi phí: quyền tài chính/chi phí riêng; dữ liệu đơn giá không đi kèm payload cho người không có quyền.
- Người đối soát: quyền liên kết accrual với chứng từ thực tế và xử lý chênh lệch.

Đề xuất thêm action Room rõ nghĩa `publish_daily_progress` cho Room Nhật ký hoặc Tiến độ, thay vì suy diễn từ `edit_all`. Template vai trò được gán có chủ đích cho chỉ huy/người duyệt.

### 13.2 RLS và command boundary

- RLS mới bám theo quyền Room hiện hành và phạm vi project/site.
- Client không được ghi trực tiếp vào bảng tiến độ chính thức hoặc accrual.
- Mọi RPC ghi kiểm tra actor, scope, trạng thái kỳ và expected version ở phía cơ sở dữ liệu.
- Không dùng service role ở frontend.
- Các projection trả về không làm rò rỉ đơn giá, nguồn giá hoặc chi phí ước tính.

## 14. Xử lý lỗi và xung đột

| Tình huống | Hành vi |
|---|---|
| Hai người cùng sửa nhật ký | Người lưu sau nhận conflict, xem chênh lệch và tải bản mới |
| Phiếu nguồn đổi sau khi đã đưa vào tổng hợp | Giữ snapshot hiện tại, gắn cảnh báo; người tổng hợp chủ động cập nhật hoặc giữ bản đã chỉnh với lý do |
| Phiếu nguồn bị trả lại | Chặn gửi CHT cho đến khi bỏ card hoặc nguồn được gửi lại hợp lệ |
| Cùng WBS ở nhiều khu vực nhưng chưa phân bổ kế hoạch | Không tự lấy trung bình `%`; yêu cầu người tổng hợp chốt lũy kế chính thức và giữ cảnh báo |
| Một nguồn lực có dấu hiệu xuất hiện ở nhiều card | Không tự cộng im lặng; yêu cầu xác nhận/loại trùng và ghi audit |
| Tiến độ bị thay đổi sau khi mở form | Chặn gửi/xác nhận; tải lại baseline và tính lại delta |
| Tuần bị khóa trong khi nhật ký chờ duyệt | Không công bố; hiển thị người/ thời điểm khóa và luồng mở khóa |
| Thiếu đơn giá | Vẫn xác nhận tiêu hao; accrual ở `unpriced` |
| WBS bị xóa/di chuyển | Chặn lưu nếu sai scope; bản đã xác nhận vẫn hiển thị từ snapshot |
| Mất mạng khi xác nhận | Cho phép retry cùng command id; không tạo trùng |
| Dữ liệu công thức không khớp | Máy chủ tính lại và trả lỗi theo từng dòng, không âm thầm sửa |
| Nhật ký bị điều chỉnh | Void accrual cũ, thay nguồn tiến độ theo revision, giữ audit đầy đủ |

## 15. Hiệu năng và khả năng mở rộng

- Tải bundle theo scope/date, không N+1.
- Tìm kiếm cây WBS phía máy chủ khi số node lớn; client chỉ mở các nhánh cần thiết.
- Index theo `daily_log_id`, `(project_id, construction_site_id, task_id)`, `(scope_key, task_id, progress_date)` và trạng thái đối soát.
- Summary cell được tính từ dữ liệu tải cùng bundle hoặc view tổng hợp, không gọi riêng từng dòng.
- Cache cây WBS theo scope và version; tiến độ/baseline theo ngày không được cache vượt phiên bản.
- Các báo cáo chi phí dùng view/materialized strategy sau khi đo dữ liệu thực tế; không tối ưu sớm bằng cách trộn actual với accrual.

## 16. Chuyển đổi và rollout

### Giai đoạn 1 - Nền tảng và giao diện nháp

- Thêm bảng dòng WBS chuẩn, section tổng hợp theo khu vực và liên kết nguồn lực.
- Dựng bundle đọc, UI phiếu nguồn, các card khu vực 2 × 2 và bảng tổng quan WBS.
- Lưu nháp không làm thay đổi tiến độ.
- Giữ nguyên tab và lệnh tiến độ hiện tại.

### Giai đoạn 2 - Công bố tiến độ từ Nhật ký

- Thêm command xác nhận giao dịch và idempotency.
- Chạy shadow compare giữa kết quả Nhật ký và tiến độ ngày hiện tại ở dự án pilot.
- Chỉ cutover khi không còn sai khác ngoài các trường hợp đã giải thích.

### Giai đoạn 3 - Chi phí nguồn lực tạm tính

- Thêm nguồn đơn giá có đơn vị rõ ràng.
- Tạo accrual `unpriced/estimated` khi xác nhận.
- Phân quyền hiển thị chi phí.

### Giai đoạn 4 - Đối soát và báo cáo

- Liên kết accrual với bảng lương/nghiệm thu/hóa đơn/giao dịch thực tế.
- Báo cáo tạm tính, thực tế, chưa đối soát và chênh lệch theo WBS.

### Giai đoạn 5 - Hoàn tất cutover

- Tab tiến độ ngày chuyển sang chỉ đọc trong luồng thông thường.
- Bỏ hành động nhập ngược từ tiến độ vào nhật ký đối với ngày mới.
- Duy trì màn hình legacy và khả năng truy vết lịch sử.

Rollout dùng feature flag theo project/site. Không dùng migration đoán dữ liệu lịch sử. Mọi thay đổi Supabase chỉ chạy trên Supabase Cloud theo cấu hình `.env`, không dùng local Supabase hoặc Docker.

## 17. Kiểm thử và tiêu chí chấp nhận

### 17.1 Logic thuần

- Quy đổi `%` ↔ khối lượng lũy kế.
- Tính khối lượng ngày từ baseline.
- Xử lý thiếu khối lượng kế hoạch.
- Tổng giờ công, giờ máy, ngày công/ca quy đổi.
- Chọn đúng đơn giá theo đơn vị và ngày hiệu lực.
- Không cho giá trị lũy kế giảm hoặc vượt bản ghi ngày sau ngoài luồng điều chỉnh.
- Gộp cùng WBS theo khối lượng kế hoạch phân bổ; không cộng hoặc trung bình phần trăm trực tiếp.
- Phát hiện thiếu cơ sở phân bổ, nguồn trùng và khác biệt forecast giữa các card.

### 17.2 Database contract

- RLS đúng theo Room, scope và action.
- Client không thể ghi trực tiếp tiến độ/accrual.
- Command xác nhận atomic và idempotent.
- Phiếu nguồn không thể gọi command công bố tiến độ/accrual; chỉ bản tổng hợp hợp lệ được phép.
- Một phiếu nguồn không thể được thêm hai lần vào cùng bản tổng hợp.
- Snapshot nguồn và diff điều chỉnh không bị thay đổi ngầm khi phiếu nguồn cập nhật.
- Hai command đồng thời không tạo trùng hoặc mất cập nhật.
- Khóa ngày/tuần được tôn trọng.
- Revision void đúng accrual cũ và giữ audit.
- Không rò rỉ rate/cost cho người thiếu quyền.

### 17.3 UI và hành trình người dùng

- Chọn bốn phiếu nguồn thành bốn card khu vực, chỉnh từng bản sao và giữ liên kết tới bản gốc.
- CHT nhìn tổng quan trước, mở chi tiết theo người/khu vực và thấy nội dung đã điều chỉnh.
- Gửi yêu cầu sửa đúng một khu vực nhưng vẫn giữ nguyên các card còn lại.
- Chọn/bỏ nhiều WBS, tìm kiếm và lọc cây lớn.
- Nhập `%` rồi thấy khối lượng; nhập khối lượng rồi thấy `%`.
- Mở chi tiết nhiều dòng nhân công/máy trong một WBS.
- Các trạng thái loading, empty, unknown, denied, locked, conflict, pending, verified và superseded.
- Walkthrough desktop, tablet và mobile.
- Người dùng lần đầu nhận biết được action chính mà không cần hiểu cấu trúc database.

### 17.4 Cloud smoke

- Chạy với tài khoản thật đại diện người lập, người duyệt, người xem chi phí và người bị từ chối.
- Test trong transaction có rollback khi phù hợp.
- Kiểm tra một lần gọi lại cùng command id trả cùng receipt.
- Kiểm tra query plan cho bundle WBS và báo cáo accrual trước pilot.

## 18. Chỉ số thành công pilot

- 100% tiến độ/chi phí tạm tính của ngày có nhiều người báo cáo chỉ phát sinh từ bản tổng hợp được CHT xác nhận.
- 100% card khu vực truy ngược được người phụ trách, phiếu nguồn và các điều chỉnh của người tổng hợp.
- Tối thiểu 90% dòng công việc của nhật ký chính thức được gắn WBS.
- Tối thiểu 90% dòng nhân công và máy mới được gắn WBS.
- Không có bản ghi tiến độ ngày hoặc accrual bị tạo trùng.
- Không có chi phí thực tế bị ghi hai lần từ nhật ký và chứng từ tài chính.
- Dữ liệu thiếu đơn giá luôn được nhìn thấy dưới trạng thái `Chưa định giá`, không bị biến thành `0`.
- Giảm rõ rệt số thao tác nhập tiến độ ngày thủ công sau khi lập nhật ký.
- Thời gian trung vị hoàn thành một nhật ký không tăng sau giai đoạn làm quen và giảm sau pilot.

## 19. Điều kiện duyệt thiết kế

Thiết kế được coi là đủ điều kiện chuyển sang kế hoạch triển khai khi xác nhận năm điểm:

1. Chỉ bản tổng hợp ngày được CHT xác nhận là nguồn chính thức của tiến độ ngày sau cutover; phiếu nguồn không tự công bố.
2. Nhân công dùng `số người × giờ/người`; máy dùng `số máy × giờ/máy` làm đại lượng nhập chuẩn.
3. Chi phí nhật ký chỉ là tạm tính; actual cost chỉ hình thành sau đối soát chứng từ.
4. Dữ liệu cũ được giữ nguyên và không backfill bằng suy đoán.
5. Bản tổng hợp giữ riêng từng card `người phụ trách + khu vực`, cho phép chỉnh bản sao có audit và cung cấp bảng WBS tổng quan cho CHT.

Sau khi tài liệu này được duyệt, bước kế tiếp mới là lập kế hoạch triển khai theo task/file/migration/test cụ thể.
