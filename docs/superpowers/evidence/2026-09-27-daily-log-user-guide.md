# Hướng dẫn Nhật ký công trường — phiếu kỹ sư → tổng hợp → CHT

Áp dụng cho luồng WBS mới trong bản dev thử nghiệm. [Rà soát ngày 26/09](2026-09-26-daily-log-usage-model-review.md) được giữ nguyên làm lịch sử; không dùng các nhãn/nút cũ trong tài liệu đó để thao tác bản mới.

## 1. Quy trình sử dụng

Vào **Dự án → Nhật ký công trường**. Nút chỉ xuất hiện khi anh/chị có quyền tương ứng trong Room Nhật ký của dự án.

| Ai / lúc nào | Bấm ở đâu | Làm gì | Kết quả / bước tiếp theo |
| --- | --- | --- | --- |
| Kỹ sư, bắt đầu ngày | **Ghi nhật ký** hoặc **Thêm nhật ký** → **Ngày lập phiếu** | Chọn ngày; chọn phiếu của mình hoặc **Tạo phiếu khu vực khác**, nhập mã và tên khu vực rồi **Tạo phiếu**. | Đầu phiếu ghi ngày, người lập, khu vực và trạng thái. Một người phụ trách A+C có hai phiếu; không ghi nhầm vào phiếu của người khác. |
| Kỹ sư, ghi công việc | **Chọn công việc** → chọn hạng mục → **Đưa vào phiếu** | Nhập **Khối lượng hôm nay** khi có đủ đơn vị/kế hoạch/cơ sở. Có thể chọn **Khối lượng lũy kế** hoặc **% lũy kế** trong **Cách nhập khối lượng**. | Chỉ một cách nhập hoạt động; lũy kế và % còn lại được tính/kiểm tra. Thiếu cơ sở thì ghi %; không đoán đơn vị hoặc điền 0 thay cho chưa biết. |
| Kỹ sư, ghi nguồn lực | **Chi tiết** dưới đúng hạng mục → **Nhân công hôm nay** / **Máy hôm nay** → **Thêm dòng** | Nhập nhóm/loại, số người/máy, giờ mỗi người/máy; chọn nguồn danh mục hoặc nhập tay tên bên cung cấp. | 5 người × 8 giờ = 40 giờ công; 2 máy × 6 giờ = 12 giờ máy. Nguồn lực gắn đúng công việc. Không có giá/tiền/chi phí. |
| Kỹ sư, ghi bổ sung | Chi tiết hạng mục và **Ghi chú và ảnh trong ngày** | Ghi dự kiến hoàn thành, lý do đổi ngày nếu cần, ghi chú, nội dung, sự cố và ảnh. | Lưu cùng phiếu, không phải nhập lại nhân công/máy ở tab khác. |
| Kỹ sư, trong ngày / cuối ngày | **Lưu nháp** / **Gửi tổng hợp** | Lưu để tiếp tục; cuối ngày kiểm tra đủ khối lượng, nguồn lực và bên cung cấp rồi gửi. | Phiếu đã gửi chỉ đọc. Đây chưa phải tiến độ chính thức hoặc bằng chứng nguồn lực đã xác nhận. |
| Người tổng hợp | **Tổng hợp** ở đúng ngày → **Chọn phiếu để tổng hợp** | Chọn các phiếu đã gửi; kiểm tra người/khu vực, giờ công/giờ máy và từng công việc. **Bỏ khỏi bản tổng hợp** chỉ bỏ bản sao, không xóa phiếu kỹ sư. | Tổng quan ghi phiếu đã nhận/được chọn; không khẳng định đủ toàn bộ kỹ sư khi chưa có danh sách phải báo cáo. |
| Người tổng hợp, có lỗi nguồn | Mở phiếu → **Trả phiếu cho kỹ sư** | Lưu tổng hợp trước nếu đang có thay đổi; nhập lý do cụ thể rồi trả đúng phiếu. | Kỹ sư nhận phiếu **Cần sửa**. Phiếu khác không tự bị trả. Điều chỉnh bản sao cần lý do và không sửa ngược bản gốc. |
| Người tổng hợp, chốt ngày | **Thông tin bản tổng hợp** + **Kết quả tổng hợp theo WBS** | Chọn **CHT duyệt**, ghi nội dung; mở các mục cần xử lý, chốt số liệu có căn cứ/lý do. **Lưu tổng hợp** rồi **Gửi CHT**. | WBS chồng lấn, thiếu đơn vị/kế hoạch hoặc nguồn thay đổi phải được xử lý có chủ đích. Hai khu cùng 30% không tự thành 60%. Nháp chưa chốt lưu được nhưng chưa gửi được. |
| CHT | Mở **Bản tổng hợp thi công ngày** | Xem tổng quan trước, mở **Xem công việc, nguồn lực và ảnh** khi cần. Nếu lỗi phiếu nguồn: **Trả phiếu sửa** + lý do. Nếu chỉ lỗi tổng hợp: **Trả bản tổng hợp** + lý do. | Trả nguồn đưa đúng phiếu về kỹ sư và tổng hợp về người tổng hợp. Trả tổng hợp không tự trả tất cả phiếu kỹ sư. |
| Kỹ sư, nhận phiếu cần sửa | **Ghi nhật ký** → đúng ngày → chọn phiếu; nếu đang mở phiếu khác dùng **Đổi ngày hoặc phiếu** | Đọc lý do/người yêu cầu/thời điểm; sửa khối lượng, nội dung, nguồn lực; **Lưu chỉnh sửa** hoặc **Gửi lại tổng hợp**. | Phiếu khác của cùng người vẫn giữ nguyên. Phiếu gửi lại có phiên bản mới. |
| Người tổng hợp, nhận phiếu gửi lại | Mở tổng hợp → đúng phiếu → **Xem thay đổi so với phiếu nguồn mới nhất** | Đối chiếu bản sao đã lưu với nguồn gửi lại. Chọn **Cập nhật từ phiếu** nếu muốn thay bản sao bằng nguồn mới; chốt lại WBS có căn cứ và gửi CHT. | Không tự ghi đè bản sao đã chỉnh. Cập nhật có chủ đích sẽ thay những chỉnh sửa của bản sao đó; kiểm tra lại trước khi lưu/gửi. |
| CHT, đạt yêu cầu | **Duyệt & công bố** ở chế độ chính thức; **Đối chiếu thử nghiệm** ở pilot | Kiểm tra trạng thái và chế độ trước khi bấm. | Pilot chỉ đối chiếu, chưa công bố tiến độ và bản tổng hợp vẫn chờ duyệt. Không hiểu thông báo đối chiếu thành duyệt chính thức. |
| Người tra cứu có quyền | Mở bản **Đã xác nhận** | Đọc số liệu, người duyệt/thời điểm, nguồn lực/bên cung cấp; mở quyết định đã lưu để xem căn cứ. | Báo cáo chỉ đọc. Thiếu đơn vị hoặc metadata lịch sử giữ **Chưa xác định**, không tự backfill. Cần sửa hồ sơ thì dùng **Tạo bản điều chỉnh** có lý do; kỳ khóa đi **Mở Chốt tiến độ** theo quyền. |

## 2. Đọc số liệu và xử lý thông báo

- **Giờ công/giờ máy** là tổng giờ theo hạng mục. **Lượt người/lượt máy theo hạng mục** không phải số người/máy duy nhất có mặt; tránh ghi trùng cùng lượng giờ vào nhiều hạng mục.
- **Nguồn khớp phiên bản** chỉ nói bản sao khớp nguồn, không phải CHT đã duyệt.
- Không đủ dữ liệu: giữ “Chưa xác định” hoặc “Chưa có cơ sở quy đổi”. Số 0 chỉ dùng khi có căn cứ là 0 thật.
- Khi lỗi lưu/gửi, dữ liệu đang nhập được giữ. Đọc lỗi trước; **Tải dữ liệu mới** sẽ hỏi xác nhận vì bỏ thay đổi chưa lưu. Nếu phiếu đã lưu nhưng chưa xác nhận kết quả gửi, dùng **Thử gửi lại** cùng yêu cầu; không tạo thêm phiếu.
- Nếu không thấy nút hoặc bị từ chối quyền, kiểm tra đúng dự án/ngày/phiếu và quyền Room; không yêu cầu cấp quyền CHT cho kỹ sư để bỏ qua lỗi.
- Khi mở đường dẫn báo cáo, **Không thể xác định quyền Nhật ký** nghĩa là chưa tải được quyền, không phải đã bị từ chối: dùng **Thử tải lại quyền**. **Bạn không có quyền truy cập Nhật ký của dự án này** là kết quả không có quyền Nhật ký; liên hệ người quản lý dự án. Cả hai không được hiểu thành không có báo cáo hoặc tổng số liệu bằng 0.
- Trên điện thoại, action chính nằm ở đáy; mở **Chi tiết** để ghi nguồn lực. Desktop có bảng, chỉ vùng bảng được cuộn ngang.

## 3. Anh kiểm tra trực tiếp bản dev

Dev: [mở ứng dụng thử nghiệm](http://127.0.0.1:4197/#/da?projectId=DL-WBS-PILOT-20260925&tab=dailylog). Dùng tài khoản admin preview đã cấp; tài khoản/mật khẩu web không đổi sau khi xoay mật khẩu DB test. Target là `baseline-vioo-git`, không phải dữ liệu sản xuất. Pilot hiện tại vẫn chỉ đối chiếu thử nghiệm.

Nên thử theo thứ tự: tạo phiếu ngày thử riêng → chọn công việc/ghi khối lượng/nguồn lực → gửi → tổng hợp chọn phiếu → trả một phiếu có lý do → sửa/gửi lại → xem thay đổi/cập nhật → gửi CHT. Admin có nhiều quyền nên không thay thế kiểm chứng tách vai trò non-admin; tests Cloud sử dụng riêng kỹ sư A/B, người tổng hợp, CHT, người đọc và người không có quyền.

Anh đã trải nghiệm và duyệt UX. Khi sử dụng, bốn điểm cần nhận biết vẫn là **phiếu của ai, ngày/khu vực nào, trạng thái gì, bấm đâu tiếp theo?** Nút gửi/đối chiếu màu xanh lam; duyệt chính thức màu xanh ngọc; trả sửa màu hổ phách. Màu chỉ hỗ trợ nhận biết, nhãn và quyền thao tác không đổi. Đối chiếu pilot không phải duyệt/công bố chính thức.

Giới hạn: responsive được kiểm tra bằng Chromium desktop với viewport giả lập; chưa kiểm chứng bàn phím ảo, safe-area notch và zoom trên thiết bị iOS/Android thật. Release/merge/deploy vẫn cần gate riêng. Nhật ký này không lập giao dịch hoặc hồ sơ thanh toán.
