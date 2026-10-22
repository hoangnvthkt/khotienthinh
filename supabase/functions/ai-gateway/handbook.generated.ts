// SINH TỰ ĐỘNG bởi scripts/handbook/build.mjs — không sửa tay. Nguồn: docs/so-tay/*.md, docs/huong-dan-su-dung-phong-quan-ly-du-an.md,
// lib/search/searchCatalog.ts. Chạy lại: npm run handbook:build (test assistantHandbook báo đỏ nếu quên).
export interface HandbookEntry {
  id: string; title: string; module: string; routes: Array<{ route: string; label: string }>; permission: string | null;
  /** Từ khóa + tiêu đề đã bỏ dấu, chữ thường — để khớp câu hỏi. */
  keywords: string; body: string; source: string;
}
export const HANDBOOK: HandbookEntry[] = [
 {
  "id": "du-an-10-1-xem-tien-do-du-an",
  "title": "Dự án: Tiến độ · Xem tiến độ dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tien do · xem tien do du an tab tien do du an",
  "body": "**Khi nào:** Xem danh sách công việc, WBS, biểu đồ Gantt, tình trạng hoàn thành, trễ hạn và các cảnh báo tiến độ.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Tiến độ**.\n3. Chọn chế độ xem bảng, Gantt hoặc kết hợp nếu có.\n4. Dùng tìm kiếm/lọc để tìm công việc.\n5. Kiểm tra trạng thái, ngày bắt đầu/kết thúc, người thực hiện, phần trăm hoàn thành.\n6. Xem cảnh báo trễ hoặc đường găng nếu có.\n**Lưu ý:**\nTiến độ dự án có thể được tính theo Gantt có trọng số, ngân sách công việc, thời gian thực hiện, số lượng công việc, giá trị hợp đồng hoặc nhập thủ công tùy cấu hình dự án.\n**Lỗi hay gặp:**\n- **Không thấy dữ liệu tiến độ:** dự án chưa tạo/import WBS.\n- **Phần trăm tiến độ không như kỳ vọng:** kiểm tra phương pháp tính tiến độ trong thông tin dự án.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-10-2-tao-hoac-cap-nhat-cong-viec-wbs",
  "title": "Dự án: Tiến độ · Tạo hoặc cập nhật công việc/WBS",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tien do · tao hoac cap nhat cong viec/wbs tab tien do du an",
  "body": "**Khi nào:** Tạo cấu trúc WBS và công việc triển khai để quản lý tiến độ dự án.\n**Các bước:**\n1. Vào tab **Tiến độ**.\n2. Bấm **Thêm công việc** hoặc thao tác tương đương.\n3. Nhập mã WBS và tên công việc.\n4. Chọn công việc cha nếu công việc là cấp con.\n5. Nhập ngày bắt đầu và ngày kết thúc kế hoạch.\n6. Nhập các thông tin bổ sung: người thực hiện, đơn vị, khối lượng, nhân công.\n7. Nhập phần trăm hoàn thành nếu đã có dữ liệu thực tế.\n8. Bấm **Lưu**.\n**Lưu ý:**\nMã WBS nên theo cấu trúc phân cấp, ví dụ 1, 1.1, 1.1.1. Không nên đặt mã tùy tiện vì mã này còn dùng khi import BOQ hoặc đối chiếu dữ liệu.\n**Lỗi hay gặp:**\n- **Mã WBS không hợp lệ:** dùng định dạng phân cấp bằng số và dấu chấm.\n- **Ngày kết thúc trước ngày bắt đầu:** kiểm tra lại ngày.\n- **Không lưu được:** kiểm tra quyền quản trị tab Tiến độ.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-10-3-import-tien-do-tu-excel",
  "title": "Dự án: Tiến độ · Import tiến độ từ Excel",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tien do · import tien do tu excel tab tien do du an",
  "body": "**Khi nào:** Nhập nhanh danh sách công việc/WBS từ file Excel.\n**Các bước:**\n1. Vào tab **Tiến độ**.\n2. Tải file mẫu nếu cần.\n3. Điền dữ liệu vào file mẫu.\n4. Bấm **Import** hoặc **Tải lên Excel**.\n5. Chọn file Excel.\n6. Xem preview/kiểm tra lỗi nếu hệ thống hiển thị.\n7. Xác nhận import.\n8. Kiểm tra lại danh sách công việc sau import.\n**Lưu ý:**\nKhông đổi tên cột trong file mẫu nếu hệ thống yêu cầu đúng header.\n**Lỗi hay gặp:**\n- **Không đọc được Excel:** dùng lại file mẫu tải từ hệ thống.\n- **Dòng bị lỗi ngày:** kiểm tra định dạng ngày.\n- **WBS cha không tồn tại:** nhập công việc cha trước hoặc kiểm tra mã cha.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-10-4-cap-nhat-phan-tram-hoan-thanh-va-xu-ly-tre-tien-do",
  "title": "Dự án: Tiến độ · Cập nhật phần trăm hoàn thành và xử lý trễ tiến độ",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tien do · cap nhat phan tram hoan thanh va xu ly tre tien do tab tien do du an",
  "body": "**Khi nào:** Cập nhật tiến độ thực tế, theo dõi chậm trễ và hỗ trợ điều hành dự án.\n**Các bước:**\n1. Mở tab **Tiến độ**.\n2. Tìm công việc cần cập nhật.\n3. Mở form chỉnh sửa hoặc cập nhật tiến độ.\n4. Nhập phần trăm hoàn thành, ngày thực tế hoặc thông tin liên quan.\n5. Kiểm tra cảnh báo trễ, phụ thuộc hoặc đường găng.\n6. Bấm **Lưu**.\n**Lưu ý:**\nMột số tiến độ có thể được cập nhật từ nhật ký đã xác nhận hoặc dữ liệu khối lượng nghiệm thu.\n**Lỗi hay gặp:**\n- **Không cập nhật được công việc đã khóa:** kiểm tra trạng thái/gate hoặc quyền cập nhật.\n- **Tiến độ vượt 100% bất thường:** kiểm tra quy định nhập liệu và dữ liệu khối lượng.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-11-1-xem-nhat-ky-cong-truong",
  "title": "Dự án: Nhật ký · Xem nhật ký công trường",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "nhat ky · xem nhat ky cong truong tab nhat ky du an",
  "body": "**Khi nào:** Xem nhật ký theo ngày để theo dõi diễn biến thi công, thời tiết, nhân lực, máy móc, vật tư, khối lượng và hình ảnh hiện trường.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Nhật ký**.\n3. Chọn tháng/ngày cần xem.\n4. Bấm vào nhật ký để mở chi tiết.\n5. Kiểm tra trạng thái: Nháp, Chờ xác nhận, Đã xác nhận, Trả lại.\n6. Xem các phần khối lượng, vật tư, nhân công, máy thi công, ảnh, delay nếu có.\n**Lưu ý:**\nChỉ nhật ký đã xác nhận mới nên được dùng làm dữ liệu tin cậy cho tiến độ/báo cáo.\n**Lỗi hay gặp:**\n- **Không thấy nhật ký trong ngày:** kiểm tra ngày/tháng hoặc bộ lọc trạng thái.\n- **Không mở được chi tiết:** kiểm tra quyền xem tab Nhật ký.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-11-2-tao-nhat-ky-ngay",
  "title": "Dự án: Nhật ký · Tạo nhật ký ngày",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "nhat ky · tao nhat ky ngay tab nhat ky du an",
  "body": "**Khi nào:** Ghi nhận thông tin thi công thực tế trong ngày.\n**Các bước:**\n1. Vào tab **Nhật ký**.\n2. Chọn ngày cần tạo nhật ký.\n3. Bấm **Tạo nhật ký** hoặc thao tác tương đương.\n4. Nhập mô tả công việc trong ngày.\n5. Chọn thời tiết.\n6. Nhập khối lượng theo công việc/WBS hoặc BOQ nếu có.\n7. Nhập vật tư sử dụng.\n8. Nhập nhân công và máy thi công.\n9. Thêm ảnh hoặc file đính kèm nếu có.\n10. Nhập thông tin delay nếu phát sinh.\n11. Bấm **Lưu**.\n**Lưu ý:**\nNếu hệ thống yêu cầu ảnh, user cần đính kèm ảnh trước khi lưu/gửi.\n**Lỗi hay gặp:**\n- **Không lưu được do thiếu mô tả/ngày:** nhập đủ trường bắt buộc.\n- **Khối lượng vượt phần còn lại:** kiểm tra lại khối lượng kế hoạch và khối lượng đã xác nhận trước đó.\n- **Vật tư sử dụng vượt tồn kho:** kiểm tra tồn kho công trường.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-11-3-gui-va-xac-nhan-nhat-ky",
  "title": "Dự án: Nhật ký · Gửi và xác nhận nhật ký",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "nhat ky · gui va xac nhan nhat ky tab nhat ky du an",
  "body": "**Khi nào:** Gửi nhật ký cho người xác nhận và ghi nhận nhật ký chính thức sau khi duyệt.\n**Các bước:**\n1. Mở nhật ký cần gửi.\n2. Kiểm tra toàn bộ nội dung.\n3. Bấm **Gửi nhật ký**.\n4. Chọn người xác nhận.\n5. Xác nhận gửi.\n6. Người xác nhận mở nhật ký ở trạng thái **Chờ xác nhận**.\n7. Bấm **Xác nhận** nếu nội dung đạt yêu cầu hoặc **Trả lại** nếu cần bổ sung.\n8. Nếu trả lại, nhập lý do trả lại.\n**Lưu ý:**\nNhật ký đã xác nhận có thể ảnh hưởng đến tiến độ, delay và báo cáo dự án.\n**Lỗi hay gặp:**\n- **Không chọn được người xác nhận:** kiểm tra phân quyền người xác nhận trong Tổ chức dự án.\n- **Không xác nhận được:** user không phải người được giao hoặc không có quyền xác nhận.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-12-tab-nghiem-thu-thanh-toan",
  "title": "Dự án: Tab Nghiệm thu & Thanh toán",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tab nghiem thu & thanh toan du an",
  "body": "**Khi nào:** Theo dõi kế hoạch thanh toán theo hợp đồng, bao gồm mốc kế hoạch, sắp tới hạn, quá hạn và đã thanh toán.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Nghiệm thu & Thanh toán**.\n3. Chọn tab con: **Kế hoạch**, **Sắp tới hạn**, **Quá hạn**, **Đã thanh toán**.\n4. Lọc theo loại hợp đồng: tất cả, hợp đồng nhận thầu, hợp đồng thầu phụ.\n5. Lọc theo hợp đồng hoặc khoảng ngày nếu cần.\n6. Tìm kiếm theo từ khóa nếu cần.\n7. Mở hợp đồng hoặc Gantt liên quan từ dòng thanh toán nếu cần kiểm tra chi tiết.\n8. Nếu có quyền, đánh dấu thanh toán cho dòng phù hợp.\n9. Xuất Excel danh sách nếu cần.\n**Lưu ý:**\nMàn hình này là workbench tổng hợp. Nếu số liệu sai, cần kiểm tra dữ liệu hợp đồng, lịch thanh toán, hồ sơ nghiệm thu và chứng chỉ thanh toán.\n**Lỗi hay gặp:**\n- **Không có dữ liệu:** kiểm tra hợp đồng đã có lịch thanh toán chưa.\n- **Không đánh dấu thanh toán được:** user cần quyền xác nhận hoặc quyền quản trị tab.\n- **Mốc quá hạn không đúng:** kiểm tra ngày đến hạn trên lịch thanh toán.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-13-1-xem-tong-quan-dong-tien",
  "title": "Dự án: Dòng tiền · Xem tổng quan dòng tiền",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "dong tien · xem tong quan dong tien tab dong tien du an",
  "body": "**Khi nào:** Theo dõi tổng thu, tổng chi, dòng tiền ròng, công nợ phải thu/phải trả và biểu đồ dòng tiền theo thời gian.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Dòng tiền**.\n3. Xem các thẻ tổng quan: tổng thu, tổng chi, dòng tiền ròng, công nợ.\n4. Chọn khoảng thời gian: 3 tháng, 6 tháng, 12 tháng hoặc tất cả.\n5. Xem biểu đồ dòng tiền.\n6. Kiểm tra các khoản phải thu/phải trả và khoản quá hạn nếu có.\n**Lưu ý:**\nDòng tiền phụ thuộc vào dữ liệu giao dịch và lịch thanh toán. Không dùng thay thế báo cáo kế toán chính thức nếu chưa đối chiếu.\n**Lỗi hay gặp:**\n- **Biểu đồ không có dữ liệu:** kiểm tra đã nhập giao dịch hoặc lịch thanh toán chưa.\n- **Số thu/chi không khớp:** kiểm tra loại giao dịch và thời gian lọc.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-13-2-them-hoac-cap-nhat-lich-thanh-toan",
  "title": "Dự án: Dòng tiền · Thêm hoặc cập nhật lịch thanh toán",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "dong tien · them hoac cap nhat lich thanh toan tab dong tien du an",
  "body": "**Khi nào:** Ghi nhận các đợt thanh toán phải thu/phải trả để theo dõi công nợ và cảnh báo đến hạn.\n**Các bước:**\n1. Vào tab **Dòng tiền**.\n2. Chọn **Thêm đợt thanh toán** hoặc thao tác tương đương.\n3. Nhập mô tả, số tiền, ngày đến hạn.\n4. Chọn loại phải thu/phải trả.\n5. Nhập người liên hệ nếu có.\n6. Bấm **Lưu**.\n7. Khi khoản đã thanh toán, chọn dòng và đánh dấu **Đã thanh toán** nếu có quyền.\n**Lưu ý:**\nNgày đến hạn trong quá khứ sẽ được hệ thống nhận diện là quá hạn nếu chưa thanh toán.\n**Lỗi hay gặp:**\n- **Không lưu được:** nhập đủ mô tả, số tiền và ngày đến hạn.\n- **Không thấy nút thêm/sửa:** user không có quyền quản trị tab Dòng tiền.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-14-1-xem-danh-sach-ho-so-checklist-chat-luong",
  "title": "Dự án: Chất lượng · Xem danh sách hồ sơ/checklist chất lượng",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "chat luong · xem danh sach ho so/checklist chat luong tab chat luong du an",
  "body": "**Khi nào:** Theo dõi hồ sơ nghiệm thu chất lượng, trạng thái duyệt và kết quả kiểm tra.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Chất lượng**.\n3. Dùng tìm kiếm hoặc bộ lọc trạng thái nếu cần.\n4. Mở checklist/hồ sơ cần xem.\n5. Kiểm tra trạng thái: Nháp, Chờ duyệt, Đã duyệt, Trả lại, Đã hủy.\n6. Kiểm tra kết quả đạt/không đạt nếu có.\n**Lưu ý:**\nHồ sơ chất lượng có thể là điều kiện tham chiếu cho nghiệm thu/thanh toán tùy quy trình doanh nghiệp.\n**Lỗi hay gặp:**\n- **Không thấy template/hồ sơ:** kiểm tra danh mục mẫu nghiệm thu đã được cấu hình.\n- **Không thấy dữ liệu:** kiểm tra dự án đã tạo checklist chưa.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-14-2-tao-checklist-nghiem-thu-chat-luong-tu-mau",
  "title": "Dự án: Chất lượng · Tạo checklist nghiệm thu chất lượng từ mẫu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "chat luong · tao checklist nghiem thu chat luong tu mau tab chat luong du an",
  "body": "**Khi nào:** Tạo hồ sơ nghiệm thu chất lượng theo mẫu chuẩn để kiểm tra và trình duyệt.\n**Các bước:**\n1. Vào tab **Chất lượng**.\n2. Bấm **Tạo mới** hoặc chọn mẫu hồ sơ.\n3. Chọn **Hạng mục chính**.\n4. Chọn **Loại công tác**.\n5. Chọn **Mẫu biên bản nghiệm thu**.\n6. Nhập thông tin hồ sơ và các mục kiểm tra.\n7. Đính kèm ảnh/file hoặc đánh dấu vị trí bản vẽ nếu có.\n8. Bấm **Lưu**.\n**Lưu ý:**\nChọn đúng mẫu ngay từ đầu để tránh phải nhập lại hồ sơ.\n**Lỗi hay gặp:**\n- **Không có mẫu phù hợp:** kiểm tra cấu hình hạng mục, công tác và template nghiệm thu.\n- **Không lưu được:** nhập đủ trường bắt buộc và kiểm tra quyền quản trị tab.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-14-3-gui-duyet-tra-lai-hoac-duyet-ho-so-chat-luong",
  "title": "Dự án: Chất lượng · Gửi duyệt, trả lại hoặc duyệt hồ sơ chất lượng",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "chat luong · gui duyet, tra lai hoac duyet ho so chat luong tab chat luong du an",
  "body": "**Khi nào:** Chuyển hồ sơ chất lượng qua luồng duyệt và ghi nhận kết quả chính thức.\n**Các bước:**\n1. Mở hồ sơ chất lượng cần xử lý.\n2. Kiểm tra đầy đủ nội dung và file đính kèm.\n3. Bấm **Gửi duyệt** nếu cần trình duyệt.\n4. Chọn người nhận xử lý.\n5. Người duyệt mở hồ sơ.\n6. Chọn **Duyệt** nếu đạt hoặc **Trả lại** nếu cần bổ sung.\n7. In/xem hồ sơ nếu cần lưu bản cứng.\n**Lưu ý:**\nKhông duyệt hồ sơ khi chưa kiểm tra đủ thông tin hiện trường, ảnh, bản vẽ hoặc tiêu chuẩn áp dụng.\n**Lỗi hay gặp:**\n- **Không gửi duyệt được:** kiểm tra quyền gửi và dữ liệu bắt buộc.\n- **Không duyệt được:** user không phải người xử lý hoặc không có quyền duyệt.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-15-tab-nha-thau",
  "title": "Dự án: Tab Nhà thầu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tab nha thau du an",
  "body": "**Khi nào:** Theo dõi hợp đồng thầu phụ và các đợt nghiệm thu/thanh toán liên quan đến nhà thầu phụ trong dự án.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Nhà thầu**.\n3. Xem các thẻ tổng quan: số nhà thầu phụ, giá trị đã nghiệm thu, đã thanh toán, giữ lại bảo hành.\n4. Mở hợp đồng thầu phụ cần xem.\n5. Bấm tạo đợt nghiệm thu nếu cần.\n6. Nhập kỳ nghiệm thu, mô tả, thời gian, giá trị, tỷ lệ giữ lại.\n7. Chọn trạng thái nghiệm thu: nháp, đã gửi, đã duyệt, đã thanh toán.\n8. Bấm **Lưu**.\n**Lưu ý:**\nNếu chưa có hợp đồng thầu phụ, cần tạo hoặc liên kết hợp đồng trước tại tab Hợp đồng/module Hợp đồng.\n**Lỗi hay gặp:**\n- **Tab báo chưa có hợp đồng thầu phụ:** tạo hợp đồng thầu phụ trước.\n- **Không tạo được nghiệm thu:** kiểm tra quyền quản trị tab Nhà thầu và dữ liệu bắt buộc.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-1-tong-hop-vat-tu",
  "title": "Dự án: Vật tư · Tổng hợp vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · tong hop vat tu tab vat tu du an",
  "body": "**Khi nào:** Xem bảng tổng hợp vật tư liên kết giữa BOQ, yêu cầu vật tư, PO, nhập/xuất kho, tồn kho và cảnh báo hao hụt.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Vật tư**.\n3. Chọn tab con **Tổng hợp**.\n4. Xem các chỉ số theo từng mã vật tư: ngân sách, lũy kế yêu cầu, lũy kế nhập, lũy kế xuất, tồn kho, hao hụt, cảnh báo.\n5. Dùng phân trang để xem các dòng tiếp theo.\n**Lưu ý:**\nDòng có cảnh báo vượt ngân sách, tồn âm hoặc vượt hao hụt cần được kiểm tra trước khi tạo thêm yêu cầu/PO.\n**Lỗi hay gặp:**\n- **Không có dữ liệu:** kiểm tra tab BOQ đã có dữ liệu chưa.\n- **Tồn kho âm:** kiểm tra giao dịch nhập/xuất và dữ liệu cấp phát vật tư.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-2-boq-vat-tu",
  "title": "Dự án: Vật tư · BOQ vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · boq vat tu tab vat tu du an",
  "body": "**Khi nào:** Quản lý BOQ triển khai theo tiến độ, gắn vật tư với đầu mục BOQ/WBS và tạo yêu cầu vật tư từ BOQ.\n**Các bước:**\n1. Vào tab **Vật tư**.\n2. Chọn tab con **BOQ**.\n3. Nếu chưa có BOQ, có thể chọn **Đồng bộ từ tiến độ** nếu đã có WBS.\n4. Nếu nhập từ Excel, tải mẫu BOQ triển khai.\n5. Điền dữ liệu theo mẫu.\n6. Bấm **Import** và chọn file.\n7. Xem preview import, sửa lỗi nếu có.\n8. Xác nhận áp dụng import.\n9. Nếu thêm thủ công, bấm **Thêm BOQ**.\n10. Chọn đầu mục BOQ triển khai.\n11. Chọn vật tư và nhập khối lượng, đơn giá, ngưỡng hao hụt.\n12. Bấm **Lưu**.\n**Lưu ý:**\n- Dòng vật tư cần gắn đúng đầu mục BOQ triển khai để hệ thống tự tính và đối chiếu.\n- Nếu vật tư chưa có mã kho, cần tạo đề xuất cấp mã vật tư trước khi đặt hàng/cấp phát.\n- BOQ triển khai phục vụ quản trị nội bộ, không thay thế hợp đồng nếu hợp đồng có BOQ riêng.\n**Lỗi hay gặp:**\n- **Chưa có tiến độ để đồng bộ:** tạo/import tiến độ trước.\n- **Dòng import lỗi WBS:** kiểm tra mã WBS có tồn tại và đúng định dạng.\n- **Không lưu được BOQ:** kiểm tra quyền chỉnh sửa BOQ và các trường bắt buộc.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-3-tao-yeu-cau-vat-tu-tu-boq",
  "title": "Dự án: Vật tư · Tạo yêu cầu vật tư từ BOQ",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · tao yeu cau vat tu tu boq tab vat tu du an",
  "body": "**Khi nào:** Tạo phiếu đề xuất/yêu cầu vật tư dựa trên các dòng BOQ đã chọn để giữ liên kết BOQ - yêu cầu - cấp phát/PO.\n**Các bước:**\n1. Vào **Vật tư > BOQ**.\n2. Chọn một hoặc nhiều dòng vật tư cần yêu cầu.\n3. Bấm **Tạo yêu cầu từ dòng đã chọn** hoặc **Tạo yêu cầu vật tư** tại dòng/nhóm BOQ.\n4. Kiểm tra danh sách vật tư được đưa vào phiếu.\n5. Nhập số lượng, ngày cần, kho nhận và ghi chú.\n6. Lưu nháp hoặc gửi duyệt theo quy trình.\n**Lưu ý:**\nNếu yêu cầu vượt BOQ, hệ thống có thể cảnh báo hoặc yêu cầu quyền duyệt đặc biệt ở bước sau.\n**Lỗi hay gặp:**\n- **Chưa chọn dòng vật tư:** chọn ít nhất một dòng trong BOQ.\n- **Dòng chưa có mã kho:** tạo đề xuất cấp mã vật tư hoặc cập nhật mã vật tư trước.\n- **Không tạo được phiếu:** kiểm tra quyền tạo yêu cầu vật tư.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-4-ke-hoach-vat-tu",
  "title": "Dự án: Vật tư · Kế hoạch vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · ke hoach vat tu tab vat tu du an",
  "body": "**Khi nào:** Dự báo nhu cầu vật tư còn lại theo BOQ, tiến độ WBS, tồn kho công trường và PO đang về; hỗ trợ tạo PO từ kế hoạch.\n**Các bước:**\n1. Vào **Vật tư > Kế hoạch**.\n2. Xem danh sách vật tư cần theo dõi.\n3. Kiểm tra nhu cầu còn lại, tồn kho và PO đang về.\n4. Kiểm tra các cảnh báo thiếu vật tư hoặc cần đặt hàng.\n5. Nếu có quyền, chọn vật tư cần mua và bấm **Tạo PO** hoặc tạo draft PO từ kế hoạch.\n6. Chuyển sang tab **Đơn hàng PO** để hoàn thiện đơn hàng.\n**Lưu ý:**\nKế hoạch vật tư phụ thuộc vào chất lượng dữ liệu BOQ và tiến độ. Nếu BOQ hoặc tiến độ thiếu, kết quả dự báo có thể chưa đầy đủ.\n**Lỗi hay gặp:**\n- **Màn hình báo cần BOQ triển khai:** bổ sung BOQ trước.\n- **Không tạo được PO:** user cần quyền quản trị **Vật tư - Đơn hàng PO**.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-5-yeu-cau-vat-tu",
  "title": "Dự án: Vật tư · Yêu cầu vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · yeu cau vat tu tab vat tu du an",
  "body": "**Khi nào:** Quản lý các phiếu đề xuất/yêu cầu vật tư theo luồng Kanban, SLA và workflow từ công trường đến phòng vật tư/kho.\n**Các bước:**\n1. Vào **Vật tư > Yêu cầu**.\n2. Xem hộp việc và bảng Kanban.\n3. Dùng bộ lọc: tất cả, của tôi, quá hạn, đã trả lại, theo dõi.\n4. Tìm phiếu theo mã, người yêu cầu hoặc người xử lý.\n5. Nếu cần tạo mới, bấm **Tạo đề xuất**.\n6. Nhập thông tin phiếu và danh sách vật tư.\n7. Lưu nháp hoặc gửi duyệt.\n8. Người được giao mở phiếu và xử lý: duyệt, chuyển bước, trả lại hoặc từ chối theo quyền.\n**Lưu ý:**\nNếu phiếu bị trả lại, người tạo cần bổ sung thông tin và gửi lại.\n**Lỗi hay gặp:**\n- **Không thấy nút Tạo đề xuất:** user chưa có quyền submit/tạo yêu cầu.\n- **Không chuyển được trạng thái:** user không phải người đang được giao hoặc thiếu quyền xử lý.\n- **Phiếu quá hạn SLA:** kiểm tra người xử lý hiện tại và ưu tiên xử lý.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-6-don-hang-po",
  "title": "Dự án: Vật tư · Đơn hàng PO",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · don hang po tab vat tu du an",
  "body": "**Khi nào:** Theo dõi và tạo đơn hàng vật tư, có thể tạo từ đề xuất công trường, kế hoạch vật tư hoặc tạo PO chủ động.\n**Các bước:**\n1. Vào **Vật tư > Đơn hàng PO**.\n2. Xem danh sách PO và trạng thái: Nháp, Đã gửi, Đã duyệt, Đang giao, Giao một phần, Hoàn thành, Đã đóng, Hoàn hàng, Hủy.\n3. Nếu tạo từ đề xuất, bấm **Tạo từ đề xuất**.\n4. Chọn các dòng đề xuất cần mua.\n5. Kiểm tra nhà cung cấp và số lượng.\n6. Nếu tạo PO chủ động, bấm **Tạo PO**.\n7. Nhập thông tin nhà cung cấp, ngày cần giao, dòng vật tư, khối lượng, đơn giá.\n8. Có thể import dòng PO từ Excel nếu cần nhập hàng loạt.\n9. Bấm **Tạo** hoặc **Lưu**.\n10. Cập nhật trạng thái PO theo thực tế xử lý/giao hàng.\n**Lưu ý:**\nPO là nghiệp vụ phối hợp với Phòng Vật tư. QLDA cần kiểm tra đúng nhu cầu, BOQ và tiến độ trước khi tạo/đề xuất mua.\n**Lỗi hay gặp:**\n- **Vật tư trùng trong PO:** kiểm tra SKU, nhà cung cấp và nguồn BOQ/đề xuất.\n- **Dòng BOQ chưa có mã kho:** tạo đề xuất cấp mã vật tư trước.\n- **Không cập nhật trạng thái được:** kiểm tra quyền quản trị PO và người xử lý hiện tại.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-7-hao-hut-vat-tu",
  "title": "Dự án: Vật tư · Hao hụt vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · hao hut vat tu tab vat tu du an",
  "body": "**Khi nào:** Theo dõi vật tư vượt định mức hao hụt hoặc vượt ngân sách để kiểm soát rủi ro chi phí.\n**Các bước:**\n1. Vào **Vật tư > Hao hụt**.\n2. Xem danh sách vật tư và tỷ lệ hao hụt.\n3. So sánh hao hụt thực tế với ngưỡng.\n4. Kiểm tra các dòng vượt ngưỡng.\n5. Mở lại tab Tổng hợp/BOQ/Yêu cầu/PO để truy nguyên nguyên nhân nếu cần.\n**Lưu ý:**\nHao hụt cần được đối chiếu với nhật ký, xuất kho, nghiệm thu và thực tế hiện trường trước khi kết luận.\n**Lỗi hay gặp:**\n- **Không có dữ liệu hao hụt:** bổ sung BOQ và dữ liệu thực tế.\n- **Hao hụt bất thường:** kiểm tra đơn vị tính, số lượng nhập/xuất và BOQ gốc.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-16-8-dashboard-vat-tu",
  "title": "Dự án: Vật tư · Dashboard vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "vat tu · dashboard vat tu tab vat tu du an",
  "body": "**Khi nào:** Xem biểu đồ và danh sách cảnh báo vật tư vượt ngân sách, vượt hao hụt hoặc có giá trị lớn.\n**Các bước:**\n1. Vào **Vật tư > Dashboard**.\n2. Xem biểu đồ phân bổ ngân sách vật tư.\n3. Xem danh sách vật tư vượt ngân sách.\n4. Xem danh sách vật tư vượt hao hụt.\n5. Dùng kết quả này để kiểm tra chi tiết ở tab Tổng hợp/BOQ/Yêu cầu/PO.\n**Lưu ý:**\nDashboard là màn hình phân tích, không phải nơi nhập liệu chính.\n**Lỗi hay gặp:**\n- **Biểu đồ trống:** kiểm tra BOQ vật tư đã có ngân sách/giá trị chưa.\n- **Cảnh báo không khớp kỳ vọng:** kiểm tra ngưỡng hao hụt và dữ liệu lũy kế yêu cầu/nhập/xuất.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-17-1-xem-tim-kiem-va-tai-tai-lieu",
  "title": "Dự án: Tài liệu · Xem, tìm kiếm và tải tài liệu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tai lieu · xem, tim kiem va tai tai lieu tab tai lieu du an",
  "body": "**Khi nào:** Quản lý và tra cứu tài liệu dự án như hợp đồng, bản vẽ, nghiệm thu, giấy phép, báo cáo, hình ảnh, hóa đơn và tài liệu chung.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Tài liệu**.\n3. Dùng ô tìm kiếm để tìm theo tên, file, mô tả hoặc tag.\n4. Lọc theo nhóm tài liệu: Hợp đồng, Bản vẽ, Nghiệm thu, Giấy phép, Báo cáo, Hình ảnh, Hóa đơn, Chung.\n5. Bấm xem trước nếu muốn preview.\n6. Bấm tải xuống nếu cần lưu file.\n**Lưu ý:**\nNên đặt tên tài liệu rõ ràng, có mã dự án/hạng mục/ngày để dễ tìm kiếm.\n**Lỗi hay gặp:**\n- **Không thấy tài liệu:** kiểm tra bộ lọc danh mục hoặc từ khóa tìm kiếm.\n- **Không mở được file:** kiểm tra file còn tồn tại trong storage hoặc user có quyền truy cập.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-17-2-upload-va-phan-loai-tai-lieu",
  "title": "Dự án: Tài liệu · Upload và phân loại tài liệu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tai lieu · upload va phan loai tai lieu tab tai lieu du an",
  "body": "**Khi nào:** Tải tài liệu dự án lên hệ thống và phân loại để quản lý tập trung.\n**Các bước:**\n1. Vào tab **Tài liệu**.\n2. Bấm **Upload** hoặc kéo thả file vào khu vực upload nếu hệ thống hỗ trợ.\n3. Chọn một hoặc nhiều file.\n4. Nhập tiêu đề.\n5. Chọn danh mục tài liệu.\n6. Nhập mô tả và tag nếu có.\n7. Bấm **Tải lên**.\n**Lưu ý:**\nNếu upload nhiều file cùng lúc, nên kiểm tra lại tiêu đề/danh mục từng file sau khi upload.\n**Lỗi hay gặp:**\n- **File quá lớn:** giảm dung lượng file hoặc kiểm tra giới hạn upload.\n- **Không upload được:** kiểm tra quyền quản trị tab Tài liệu và kết nối mạng.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-17-3-xoa-tai-lieu",
  "title": "Dự án: Tài liệu · Xóa tài liệu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tai lieu · xoa tai lieu tab tai lieu du an",
  "body": "**Khi nào:** Xóa tài liệu không còn cần lưu hoặc upload nhầm.\n**Các bước:**\n1. Vào tab **Tài liệu**.\n2. Tìm tài liệu cần xóa.\n3. Bấm nút xóa.\n4. Đọc cảnh báo.\n5. Xác nhận xóa.\n**Lưu ý:**\nChỉ xóa tài liệu khi chắc chắn không còn cần tra cứu.\n**Lỗi hay gặp:**\n- **Không thấy nút xóa:** user không có quyền quản trị tab Tài liệu.\n- **Xóa nhầm:** liên hệ Admin/IT để kiểm tra khả năng khôi phục từ backup nếu có.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-18-1-xem-bao-cao-tong-quan-du-an",
  "title": "Dự án: Báo cáo · Xem báo cáo tổng quan dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "bao cao · xem bao cao tong quan du an tab bao cao du an",
  "body": "**Khi nào:** Xem báo cáo tổng hợp về hợp đồng, ngân sách, vật tư, PO, nghiệm thu, tiến độ và các chỉ số tài chính.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Báo cáo**.\n3. Chọn chế độ **Tổng quan** nếu có.\n4. Xem biểu đồ và chỉ số theo từng nhóm: hợp đồng, vật tư, PO, nghiệm thu, chi phí, tiến độ.\n5. Bấm vào biểu đồ/khu vực cần xem chi tiết nếu hệ thống hỗ trợ.\n6. Xuất dữ liệu nếu có nút xuất.\n**Lưu ý:**\nBáo cáo chỉ chính xác khi dữ liệu nguồn được nhập đầy đủ và đúng trạng thái.\n**Lỗi hay gặp:**\n- **Báo cáo thiếu số liệu:** kiểm tra dữ liệu nguồn ở Hợp đồng, Vật tư, Tiến độ, Nhật ký, Dòng tiền.\n- **Số liệu không khớp:** kiểm tra khoảng thời gian, trạng thái chứng từ và dữ liệu đã được xác nhận hay chưa.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-18-2-xem-bao-cao-nhat-ky",
  "title": "Dự án: Báo cáo · Xem báo cáo nhật ký",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "bao cao · xem bao cao nhat ky tab bao cao du an",
  "body": "**Khi nào:** Tổng hợp nhật ký công trường để kiểm tra khối lượng, nhân lực, máy móc, vật tư, ảnh và các sự kiện trễ.\n**Các bước:**\n1. Vào tab **Báo cáo**.\n2. Chọn chế độ **Nhật ký** nếu có.\n3. Chọn khoảng thời gian cần xem.\n4. Kiểm tra danh sách nhật ký và các số liệu tổng hợp.\n5. Mở nhật ký liên quan nếu cần xem chi tiết.\n**Lưu ý:**\nNên ưu tiên nhật ký đã xác nhận khi dùng cho báo cáo chính thức.\n**Lỗi hay gặp:**\n- **Không có dữ liệu nhật ký:** kiểm tra tab Nhật ký đã có dữ liệu trong khoảng thời gian chọn chưa.\n- **Dữ liệu nhật ký chưa được tính vào tiến độ:** kiểm tra nhật ký đã được xác nhận chưa.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-3-truy-cap-module-du-an",
  "title": "Dự án: Truy cập module Dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "truy cap module du an du an",
  "body": "**Khi nào:** Giúp user vào đúng module Dự án và mở màn hình quản lý dự án.\n**Các bước:**\n1. Đăng nhập hệ thống.\n2. Tại menu chính, chọn **Dự án**.\n3. Hệ thống mở màn hình danh sách dự án.\n4. Nếu dùng đường dẫn trực tiếp, truy cập route `/da`.\n**Lưu ý:**\nNếu user không thấy menu **Dự án**, cần kiểm tra phân quyền module.\n**Lỗi hay gặp:**\n- **Không thấy menu Dự án:** liên hệ Admin để kiểm tra quyền module DA.\n- **Vào được module nhưng không thấy dữ liệu:** kiểm tra bộ lọc, quyền theo dự án hoặc trạng thái ẩn/hiện của dự án.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-4-1-xem-danh-sach-du-an",
  "title": "Dự án: Xem danh sách dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "xem danh sach du an quan ly danh sach du an du an",
  "body": "**Khi nào:** Xem toàn bộ dự án user được phân quyền để theo dõi tình trạng triển khai.\n**Các bước:**\n1. Vào menu **Dự án**.\n2. Xem danh sách dự án đang hiển thị.\n3. Kiểm tra các thông tin chính: mã dự án, tên dự án, trạng thái, ngày bắt đầu, ngày kết thúc, tiến độ, giá trị hợp đồng hoặc chỉ số tổng quan nếu có.\n4. Bấm vào dự án cần xem để mở chi tiết.\n**Lưu ý:**\nDanh sách có phân trang. Nếu không thấy dự án cần tìm, kiểm tra trang tiếp theo hoặc dùng ô tìm kiếm/bộ lọc.\n**Lỗi hay gặp:**\n- **Không thấy dự án mới tạo:** tải lại dữ liệu hoặc kiểm tra dự án có bị lọc theo trạng thái không.\n- **Dự án bị thiếu thông tin công trường:** kiểm tra phần liên kết công trường HRM trong form dự án.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-4-2-tim-kiem-va-loc-du-an",
  "title": "Dự án: Tìm kiếm và lọc dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tim kiem va loc du an quan ly danh sach du an du an",
  "body": "**Khi nào:** Tìm nhanh dự án theo mã, tên, trạng thái, nhóm, loại, lĩnh vực, workflow, liên kết công trường hoặc thời gian.\n**Các bước:**\n1. Nhập từ khóa vào ô tìm kiếm.\n2. Chọn trạng thái dự án nếu cần.\n3. Chọn nhóm dự án, loại dự án hoặc lĩnh vực nếu cần.\n4. Chọn trạng thái liên kết công trường nếu cần.\n5. Nhập khoảng ngày bắt đầu hoặc ngày kết thúc nếu cần.\n6. Xem danh sách kết quả sau khi lọc.\n**Lưu ý:**\nNếu kết quả quá ít hoặc không có, hãy xóa bớt điều kiện lọc.\n**Lỗi hay gặp:**\n- **Không có kết quả:** kiểm tra chính tả từ khóa hoặc đặt trạng thái về **Tất cả**.\n- **Dự án bị ẩn không hiển thị:** chỉ Admin hoặc user có quyền phù hợp mới thấy bộ lọc dự án ẩn.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-4-3-tao-moi-du-an",
  "title": "Dự án: Tạo mới dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tao moi du an quan ly danh sach du an du an",
  "body": "**Khi nào:** Tạo hồ sơ dự án mới để bắt đầu quản lý tiến độ, ngân sách, hợp đồng, vật tư và các nghiệp vụ liên quan.\n**Các bước:**\n1. Tại màn hình danh sách dự án, bấm **Tạo mới** hoặc nút tương đương.\n2. Nhập thông tin cơ bản: tên, mã, khách hàng, mô tả.\n3. Chọn nhóm dự án, loại dự án, lĩnh vực dự án nếu có.\n4. Chọn công trường HRM nếu dự án đã có công trường tương ứng.\n5. Chọn người quản lý dự án.\n6. Chọn trạng thái, ngày bắt đầu, ngày kết thúc.\n7. Chọn phương pháp tính tiến độ phù hợp.\n8. Mở phần nâng cao nếu cần gán admin, executor, watcher hoặc vị trí mặc định.\n9. Kiểm tra lại thông tin.\n10. Bấm **Lưu**.\n**Lưu ý:**\n- Mã dự án nên thống nhất với quy chuẩn nội bộ.\n- Nếu dự án cần dùng các tab Điều hành, Dòng tiền, Báo cáo, Nghiệm thu & Thanh toán, nên liên kết công trường HRM ngay từ đầu.\n- Cách tính tiến độ ảnh hưởng đến phần trăm tiến độ hiển thị ở banner dự án.\n**Lỗi hay gặp:**\n- **Thiếu trường bắt buộc:** nhập đủ tên, mã và các trường hệ thống yêu cầu.\n- **Không chọn được công trường:** kiểm tra công trường đã được tạo trong HRM chưa.\n- **Không lưu được:** kiểm tra quyền quản trị dự án hoặc dữ liệu bị trùng mã.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-4-4-cap-nhat-thong-tin-du-an",
  "title": "Dự án: Cập nhật thông tin dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "cap nhat thong tin du an quan ly danh sach du an du an",
  "body": "**Khi nào:** Cập nhật thông tin dự án khi có thay đổi về trạng thái, tiến độ, ngày triển khai, người phụ trách hoặc thông tin mô tả.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Bấm nút **Dự án** hoặc nút chỉnh sửa thông tin dự án.\n3. Cập nhật các trường cần thay đổi.\n4. Kiểm tra lại thông tin.\n5. Bấm **Lưu**.\n**Lưu ý:**\nKhông nên thay đổi mã dự án nếu mã đã được dùng trong các báo cáo, hợp đồng hoặc file import.\n**Lỗi hay gặp:**\n- **Không thấy nút chỉnh sửa:** user chưa có quyền quản trị dự án.\n- **Cập nhật xong nhưng số liệu chưa đổi:** tải lại dữ liệu hoặc kiểm tra phần dữ liệu tổng hợp từ tab liên quan.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-4-5-lien-ket-cong-truong-hrm",
  "title": "Dự án: Liên kết công trường HRM",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "lien ket cong truong hrm quan ly danh sach du an du an",
  "body": "**Khi nào:** Liên kết dự án với công trường HRM để dùng dữ liệu hiện trường cho Điều hành, Dòng tiền, Báo cáo, Nghiệm thu & Thanh toán và các nghiệp vụ liên quan.\n**Các bước:**\n1. Mở form tạo/sửa dự án.\n2. Tại trường công trường, chọn công trường HRM tương ứng.\n3. Kiểm tra tên công trường hiển thị trong phần thông tin dự án.\n4. Bấm **Lưu**.\n**Lưu ý:**\nNếu không liên kết công trường, một số tab sẽ hiển thị thông báo cần liên kết công trường HRM.\n**Lỗi hay gặp:**\n- **Không thấy công trường trong danh sách:** kiểm tra công trường đã tạo trong HRM và user có quyền xem.\n- **Chọn sai công trường:** mở lại form dự án và chọn đúng công trường.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-4-6-an-va-khoi-phuc-du-an",
  "title": "Dự án: Ẩn và khôi phục dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "an va khoi phuc du an quan ly danh sach du an du an",
  "body": "**Khi nào:** Ẩn các dự án không còn cần hiển thị thường xuyên nhưng vẫn giữ dữ liệu để tra cứu hoặc khôi phục.\n**Các bước:**\n1. Tại danh sách hoặc chi tiết dự án, chọn thao tác **Ẩn dự án** nếu có.\n2. Kiểm tra cảnh báo ảnh hưởng dữ liệu.\n3. Nhập lý do hoặc xác nhận mã dự án nếu hệ thống yêu cầu.\n4. Bấm xác nhận.\n5. Khi cần khôi phục, mở bộ lọc dự án ẩn và chọn **Khôi phục**.\n**Lưu ý:**\nẨn dự án không phải là xóa dữ liệu. Không dùng thao tác này thay cho việc đóng dự án về mặt nghiệp vụ.\n**Lỗi hay gặp:**\n- **Không thấy nút ẩn/khôi phục:** user không có quyền.\n- **Không tìm thấy dự án đã ẩn:** đổi bộ lọc hiển thị sang dự án ẩn hoặc tất cả.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-5-mo-va-su-dung-man-hinh-chi-tiet-du-an",
  "title": "Dự án: Mở và sử dụng màn hình chi tiết dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "mo va su dung man hinh chi tiet du an du an",
  "body": "**Khi nào:** Mở màn hình chi tiết để theo dõi thông tin tổng quan và truy cập các tab nghiệp vụ của dự án.\n**Các bước:**\n1. Tại danh sách dự án, tìm dự án cần xem.\n2. Bấm vào dự án.\n3. Kiểm tra banner thông tin dự án: tên, mã, công trường, trạng thái, phần trăm tiến độ.\n4. Chọn tab nghiệp vụ cần thao tác.\n**Lưu ý:**\nCác tab hiển thị theo phân quyền. User có thể chỉ thấy một phần tab.\n**Lỗi hay gặp:**\n- **Không thấy tab cần dùng:** liên hệ Admin để kiểm tra quyền tab trong module DA.\n- **Tab báo cần liên kết công trường:** cập nhật lại công trường HRM trong thông tin dự án.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-6-tab-dieu-hanh",
  "title": "Dự án: Tab Điều hành",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tab dieu hanh du an",
  "body": "**Khi nào:** Xem dashboard điều hành dự án, bao gồm sức khỏe tiến độ, cảnh báo ưu tiên, queue chờ xử lý, rủi ro thanh toán và các chỉ số tổng hợp.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Điều hành**.\n3. Xem các thẻ chỉ số tổng quan.\n4. Kiểm tra phần **Yêu cầu chờ xử lý** để biết số lượng chứng từ/phiếu cần xử lý.\n5. Kiểm tra phần **Cảnh báo ưu tiên** để xử lý các vấn đề trọng yếu.\n6. Xem phần sức khỏe tiến độ để so sánh kế hoạch và thực tế.\n7. Mở các tab liên quan nếu cần xử lý chi tiết.\n**Lưu ý:**\nTab Điều hành là màn hình tổng hợp, không thay thế việc nhập liệu ở các tab chuyên môn.\n**Lỗi hay gặp:**\n- **Dashboard không có dữ liệu:** kiểm tra dự án đã liên kết công trường và đã có dữ liệu nghiệp vụ chưa.\n- **Số liệu chưa đúng kỳ vọng:** kiểm tra dữ liệu nguồn ở Tiến độ, Nhật ký, Hợp đồng, Vật tư, Thanh toán.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-7-1-xem-so-do-nhan-su-du-an",
  "title": "Dự án: Tổ chức · Xem sơ đồ nhân sự dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "to chuc · xem so do nhan su du an tab to chuc du an",
  "body": "**Khi nào:** Xem danh sách nhân sự tham gia dự án theo vị trí, cấp bậc và quyền nghiệp vụ.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Tổ chức**.\n3. Xem danh sách thành viên theo nhóm/cấp vị trí.\n4. Tìm kiếm thành viên nếu danh sách dài.\n5. Mở chi tiết thành viên để xem vị trí, ngày bắt đầu và quyền được gán.\n**Lưu ý:**\nQuyền nghiệp vụ ở đây ảnh hưởng đến các thao tác như gửi, xác nhận, duyệt trong một số tab.\n**Lỗi hay gặp:**\n- **Không thấy nhân sự cần chọn:** kiểm tra user/nhân sự đã được tạo và đang hoạt động.\n- **Không thấy quyền cần gán:** kiểm tra danh mục quyền nghiệp vụ dự án.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-7-2-them-thanh-vien-du-an-va-gan-quyen",
  "title": "Dự án: Tổ chức · Thêm thành viên dự án và gán quyền",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "to chuc · them thanh vien du an va gan quyen tab to chuc du an",
  "body": "**Khi nào:** Thêm nhân sự vào dự án, gán vị trí và quyền nghiệp vụ để user thực hiện đúng vai trò.\n**Các bước:**\n1. Vào tab **Tổ chức**.\n2. Bấm **Thêm thành viên**.\n3. Chọn nhân sự/user.\n4. Chọn vị trí.\n5. Nhập ngày bắt đầu.\n6. Chọn các quyền nghiệp vụ cần gán.\n7. Nhập ghi chú nếu cần.\n8. Bấm **Lưu**.\n**Lưu ý:**\nChỉ gán quyền đúng phạm vi công việc. Không gán quyền duyệt/xác nhận cho user không chịu trách nhiệm nghiệp vụ.\n**Lỗi hay gặp:**\n- **Không lưu được vì thiếu nhân viên/vị trí:** chọn đủ user và vị trí.\n- **User không thao tác được dù đã thêm vào dự án:** kiểm tra đã gán đúng quyền nghiệp vụ và quyền tab chưa.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-7-3-cap-nhat-hoac-ket-thuc-phan-cong",
  "title": "Dự án: Tổ chức · Cập nhật hoặc kết thúc phân công",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "to chuc · cap nhat hoac ket thuc phan cong tab to chuc du an",
  "body": "**Khi nào:** Cập nhật vị trí/quyền của thành viên hoặc kết thúc phân công khi nhân sự không còn tham gia dự án.\n**Các bước:**\n1. Vào tab **Tổ chức**.\n2. Tìm thành viên cần cập nhật.\n3. Bấm chỉnh sửa.\n4. Cập nhật vị trí, ngày bắt đầu, ghi chú hoặc quyền nghiệp vụ.\n5. Bấm **Lưu**.\n6. Nếu cần kết thúc phân công, chọn thao tác kết thúc phân công và xác nhận.\n**Lưu ý:**\nTrước khi kết thúc phân công, cần kiểm tra user có đang là người xử lý các phiếu/chứng từ đang chờ không.\n**Lỗi hay gặp:**\n- **Không sửa được:** user không có quyền quản trị tab Tổ chức.\n- **Phiếu đang chờ người đã kết thúc phân công:** cần chuyển người xử lý hoặc phân công lại.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-8-tab-ngan-sach",
  "title": "Dự án: Tab Ngân sách",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "tab ngan sach du an",
  "body": "**Khi nào:** Xem ngân sách dự án và nhập/cập nhật ngân sách nếu Phòng Quản lý dự án được cấp quyền. Theo phân công hiện tại, **Phòng Kế toán là phòng nhập ngân sách chính**.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Ngân sách** hoặc bấm nút **Ngân sách** tại khu vực thao tác nhanh nếu có quyền.\n3. Xem ngân sách hiện tại.\n4. Nếu được phép cập nhật, nhập số liệu ngân sách theo từng nhóm chi phí.\n5. Kiểm tra tổng ngân sách.\n6. Bấm **Lưu**.\n**Lưu ý:**\nKhông tự ý điều chỉnh ngân sách nếu chưa có xác nhận từ Kế toán hoặc cấp có thẩm quyền.\n**Lỗi hay gặp:**\n- **Không thấy nút nhập/sửa ngân sách:** user không có quyền quản trị tab Ngân sách.\n- **Số liệu lệch với kế toán:** đối chiếu lại nguồn ngân sách được phê duyệt và thời điểm cập nhật.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-9-1-xem-danh-sach-hop-dong-cua-du-an",
  "title": "Dự án: Hợp đồng · Xem danh sách hợp đồng của dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "hop dong · xem danh sach hop dong cua du an tab hop dong du an",
  "body": "**Khi nào:** Xem toàn bộ hợp đồng khách hàng và hợp đồng thầu phụ liên quan đến dự án.\n**Các bước:**\n1. Mở chi tiết dự án.\n2. Chọn tab **Hợp đồng**.\n3. Xem các thẻ tổng hợp: tổng hợp đồng, giá trị hợp đồng khách hàng, giá trị thầu phụ, chênh lệch.\n4. Dùng bộ lọc để xem **Tất cả**, **Hợp đồng khách hàng** hoặc **Thầu phụ**.\n5. Bấm vào một hợp đồng để mở chi tiết.\n**Lưu ý:**\nNút **Thêm HĐ** có thể dẫn sang module Hợp đồng để tạo hợp đồng đầy đủ.\n**Lỗi hay gặp:**\n- **Chưa có hợp đồng nào:** tạo hoặc liên kết hợp đồng trong module Hợp đồng.\n- **Không xóa được hợp đồng:** hợp đồng có thể đã có BOQ, nghiệm thu, thanh toán, phụ lục hoặc lịch thanh toán liên kết.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-9-2-mo-workspace-hop-dong",
  "title": "Dự án: Hợp đồng · Mở workspace hợp đồng",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "hop dong · mo workspace hop dong tab hop dong du an",
  "body": "**Khi nào:** Xem và xử lý các nghiệp vụ chi tiết của một hợp đồng như thông tin, BOQ, phát sinh, phụ lục, lịch thanh toán, nghiệm thu, chứng chỉ thanh toán và tài liệu.\n**Các bước:**\n1. Vào tab **Hợp đồng**.\n2. Bấm vào hợp đồng cần xem.\n3. Mở workspace/chi tiết hợp đồng.\n4. Chọn tab con phù hợp: thông tin, BOQ, phát sinh, lịch sử, phụ lục, lịch thanh toán, nghiệm thu, chứng chỉ thanh toán, tài liệu.\n5. Xem hoặc cập nhật thông tin theo quyền được cấp.\n**Lưu ý:**\nKhông chỉnh sửa dữ liệu hợp đồng nếu chưa xác nhận nguồn dữ liệu pháp lý/kinh tế.\n**Lỗi hay gặp:**\n- **Không thấy tab con cần dùng:** kiểm tra quyền hoặc trạng thái hợp đồng.\n- **Không lưu được phát sinh/phụ lục:** kiểm tra quyền quản trị tab Hợp đồng và dữ liệu bắt buộc.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "du-an-9-3-theo-doi-boq-hop-dong-phat-sinh-va-nghiem-thu-thanh-toan",
  "title": "Dự án: Hợp đồng · Theo dõi BOQ hợp đồng, phát sinh và nghiệm thu/thanh toán",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": null,
  "keywords": "hop dong · theo doi boq hop dong, phat sinh va nghiem thu/thanh toan tab hop dong du an",
  "body": "**Khi nào:** Theo dõi giá trị hợp đồng theo BOQ, các phát sinh, nghiệm thu và thanh toán liên quan.\n**Các bước:**\n1. Mở workspace hợp đồng.\n2. Vào tab **BOQ** để xem hạng mục và giá trị.\n3. Vào tab **Phát sinh** để xem hoặc cập nhật thay đổi hợp đồng nếu có quyền.\n4. Vào tab **Phụ lục** để theo dõi các phụ lục liên quan.\n5. Vào tab **Nghiệm thu** để xem khối lượng/giá trị nghiệm thu.\n6. Vào tab **Chứng chỉ thanh toán** hoặc **Lịch thanh toán** để theo dõi thanh toán.\n**Lưu ý:**\nBOQ hợp đồng và BOQ triển khai vật tư là hai lớp dữ liệu khác nhau. Khi cần so sánh, dùng chức năng đối chiếu BOQ trong tab Vật tư/BOQ.\n**Lỗi hay gặp:**\n- **Giá trị hợp đồng không khớp báo cáo:** kiểm tra phụ lục/phát sinh và trạng thái cập nhật.\n- **Không mở được chứng chỉ thanh toán:** kiểm tra dữ liệu nghiệm thu và quyền tab Nghiệm thu & Thanh toán.",
  "source": "huong-dan-su-dung-phong-quan-ly-du-an"
 },
 {
  "id": "man-audit-trail",
  "title": "Màn hình Nhật ký thay đổi",
  "module": "Hệ thống",
  "routes": [
   {
    "route": "/audit-trail",
    "label": "Nhật ký thay đổi"
   }
  ],
  "permission": null,
  "keywords": "nhat ky thay doi lich su thao tac nhat ky thay doi he thong",
  "body": "**Nhật ký thay đổi** (Hệ thống) — mở từ thanh bên hoặc gõ \"nhật ký thay đổi\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-center",
  "title": "Màn hình Trung tâm điều hành",
  "module": "Trang chính",
  "routes": [
   {
    "route": "/center",
    "label": "Trung tâm điều hành"
   }
  ],
  "permission": null,
  "keywords": "trung tam dieu hanh command center viec cho toi trung tam dieu hanh trang chinh",
  "body": "**Trung tâm điều hành** (Trang chính) — mở từ thanh bên hoặc gõ \"trung tâm điều hành\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-chat",
  "title": "Màn hình Tin nhắn",
  "module": "Trao đổi",
  "routes": [
   {
    "route": "/chat",
    "label": "Tin nhắn"
   }
  ],
  "permission": null,
  "keywords": "tin nhan chat nhan tin trao doi tin nhan trao doi",
  "body": "**Tin nhắn** (Trao đổi) — mở từ thanh bên hoặc gõ \"tin nhắn\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-feedback",
  "title": "Màn hình Trung tâm góp ý",
  "module": "Góp ý",
  "routes": [
   {
    "route": "/feedback",
    "label": "Trung tâm góp ý"
   }
  ],
  "permission": null,
  "keywords": "gop y bao loi y kien trung tam gop y gop y",
  "body": "**Trung tâm góp ý** (Góp ý) — mở từ thanh bên hoặc gõ \"trung tâm góp ý\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-finance-requests",
  "title": "Màn hình Đề nghị chi",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/requests",
    "label": "Đề nghị chi"
   }
  ],
  "permission": null,
  "keywords": "de nghi chi de nghi thanh toan tam ung de nghi chi tai chinh",
  "body": "**Đề nghị chi** (Tài chính) — mở từ thanh bên hoặc gõ \"đề nghị chi\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-home",
  "title": "Màn hình Hôm nay",
  "module": "Trang chính",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": null,
  "keywords": "trang chu hom nay viec cua toi hom nay trang chinh",
  "body": "**Hôm nay** (Trang chính) — mở từ thanh bên hoặc gõ \"hôm nay\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-leaderboard",
  "title": "Màn hình Bảng xếp hạng",
  "module": "Cá nhân",
  "routes": [
   {
    "route": "/leaderboard",
    "label": "Bảng xếp hạng"
   }
  ],
  "permission": null,
  "keywords": "bang xep hang diem thuong bang xep hang ca nhan",
  "body": "**Bảng xếp hạng** (Cá nhân) — mở từ thanh bên hoặc gõ \"bảng xếp hạng\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-my-payroll",
  "title": "Màn hình Phiếu lương của tôi",
  "module": "Cá nhân",
  "routes": [
   {
    "route": "/my-payroll",
    "label": "Phiếu lương của tôi"
   }
  ],
  "permission": null,
  "keywords": "phieu luong luong cua toi phieu luong cua toi ca nhan",
  "body": "**Phiếu lương của tôi** (Cá nhân) — mở từ thanh bên hoặc gõ \"phiếu lương của tôi\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-my-profile",
  "title": "Màn hình Hồ sơ của tôi",
  "module": "Cá nhân",
  "routes": [
   {
    "route": "/my-profile",
    "label": "Hồ sơ của tôi"
   }
  ],
  "permission": null,
  "keywords": "ho so ca nhan thong tin cua toi ho so cua toi ca nhan",
  "body": "**Hồ sơ của tôi** (Cá nhân) — mở từ thanh bên hoặc gõ \"hồ sơ của tôi\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-notifications",
  "title": "Màn hình Thông báo",
  "module": "Cá nhân",
  "routes": [
   {
    "route": "/notifications",
    "label": "Thông báo"
   }
  ],
  "permission": null,
  "keywords": "thong bao tin moi thong bao ca nhan",
  "body": "**Thông báo** (Cá nhân) — mở từ thanh bên hoặc gõ \"thông báo\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-settings",
  "title": "Màn hình Cài đặt",
  "module": "Hệ thống",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt"
   }
  ],
  "permission": null,
  "keywords": "cai dat he thong nguoi dung tai khoan phan quyen cai dat he thong",
  "body": "**Cài đặt** (Hệ thống) — mở từ thanh bên hoặc gõ \"cài đặt\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-site-fund",
  "title": "Màn hình Quỹ công trường",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/site-fund",
    "label": "Quỹ công trường"
   }
  ],
  "permission": null,
  "keywords": "quy cong truong tien mat cong truong quy cong truong tai chinh",
  "body": "**Quỹ công trường** (Tài chính) — mở từ thanh bên hoặc gõ \"quỹ công trường\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-vpp",
  "title": "Màn hình Văn phòng phẩm",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/vpp",
    "label": "Văn phòng phẩm"
   }
  ],
  "permission": null,
  "keywords": "van phong pham vpp giay but ghim de xuat cap phat van phong pham vat tu",
  "body": "**Văn phòng phẩm** (Vật tư) — mở từ thanh bên hoặc gõ \"văn phòng phẩm\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "so-tay-bang-cong-phieu-luong",
  "title": "Xem bảng công và phiếu lương của tôi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/timesheet",
    "label": "Bảng công"
   },
   {
    "route": "/my-payroll",
    "label": "Phiếu lương"
   }
  ],
  "permission": "Mọi nhân viên (chỉ của mình)",
  "keywords": "bang cong cong thang nay phieu luong luong cua toi xem luong tong hop cong xem bang cong va phieu luong cua toi",
  "body": "**Khi nào:** muốn biết công tháng này, công bù, phép đã tính, hoặc xem phiếu lương các tháng.\n**Các bước:**\n1. Gõ \"bảng công\" ở ô Tìm kiếm → **Bảng công của tôi** (chọn tháng ở đầu màn).\n2. Dòng nào sai thì bấm vào ngày → gửi đề nghị bù / sửa công (quản lý duyệt).\n3. Phiếu lương: gõ \"phiếu lương\" → **Phiếu lương của tôi** → chọn tháng; có thắc mắc thì gửi Góp ý hoặc hỏi HR.\n**Lưu ý:**\n- HR chốt công theo tháng; sau khi chốt, bảng công khóa và chỉ HR sửa.",
  "source": "docs"
 },
 {
  "id": "so-tay-bao-cao-bieu-do",
  "title": "Xem báo cáo, biểu đồ thống kê",
  "module": "Trung tâm",
  "routes": [
   {
    "route": "/center?view=assistant",
    "label": "Trợ lý"
   },
   {
    "route": "/reports",
    "label": "Báo cáo kho"
   }
  ],
  "permission": "Theo quyền xem dữ liệu của từng người",
  "keywords": "bao cao bieu do thong ke theo thang theo tuan quy phieu quy trinh nhap xuat kho don mua tien do thu chi cham cong nghi phep dat xe van ban xuat excel xem bao cao, bieu do thong ke",
  "body": "**Khi nào:** cần số liệu theo kỳ để họp, báo cáo.\n**Các bước:**\n1. Mở **Trợ lý** và hỏi theo mẫu: \"thống kê phiếu quy trình quý 3\", \"nhập xuất kho SMB tháng này\", \"giá trị đơn mua 3 tháng theo NCC\", \"tiến độ DA29 theo tuần\", \"thu chi quý 3\", \"chấm công tuần này\", \"nghỉ phép 3 tháng theo phòng\", \"phiếu yêu cầu tháng này\", \"đặt xe quý 3\", \"văn bản tháng 10\".\n2. Thẻ biểu đồ hiện trong chat: ô số, cột / đường theo kỳ, vòng tròn theo mẫu / NCC / dự án; bấm **Bảng** để xem số, nút mở màn gốc.\n3. Báo cáo kho dạng MISA (NXT, xuất Excel): Kho → **Báo cáo**.\n**Lưu ý:**\n- Số chỉ trong phạm vi bạn được xem; thu chi cần quyền Tài chính.",
  "source": "docs"
 },
 {
  "id": "so-tay-cham-cong",
  "title": "Chấm công vào ca / ra ca",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/checkin",
    "label": "Chấm công"
   },
   {
    "route": "/hrm/attendance",
    "label": "Bảng chấm công"
   }
  ],
  "permission": "Mọi nhân viên có lịch làm việc",
  "keywords": "cham cong check in vao ca ra ca diem danh gps vi tri camera anh chup khong cham duoc ngoai vung cham cong vao ca / ra ca",
  "body": "**Khi nào:** đầu ca và cuối ca mỗi ngày làm việc, tại văn phòng hoặc công trường.\n**Các bước:**\n1. Mở trang **Hôm nay** → ô **Chấm công** (hoặc gõ \"chấm công\" ở ô Tìm kiếm).\n2. Cho phép **vị trí** và **camera** khi điện thoại hỏi (lần đầu); chụp ảnh khuôn mặt theo khung.\n3. Bấm **Vào ca**; cuối ngày làm lại và bấm **Ra ca**.\n4. Kiểm tra lại ở Nhân sự → Chấm công: ngày, giờ vào / ra, điểm chấm.\n**Lưu ý:**\n- Báo \"ngoài vùng\": đang ở xa điểm chấm hoặc GPS chưa bắt — bật vị trí chính xác, ra chỗ thoáng rồi chấm lại; vẫn ghi nhận nhưng quản lý sẽ thấy cờ.\n- Quên chấm: làm **Chấm công bù** (mục riêng). Lần đầu dùng máy mới có thể phải xác nhận thiết bị (passkey) theo hướng dẫn trên màn.",
  "source": "docs"
 },
 {
  "id": "so-tay-cham-cong-bu",
  "title": "Chấm công bù khi quên chấm",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/attendance?tab=proposals",
    "label": "Đề nghị bù công"
   }
  ],
  "permission": "Mọi nhân viên; quản lý trực tiếp duyệt",
  "keywords": "cham cong bu quen cham de nghi bu cong bo sung cong sua cong cham cong bu khi quen cham",
  "body": "**Khi nào:** quên vào ca / ra ca, hoặc công tác không chấm được.\n**Các bước:**\n1. Gõ \"chấm công bù\" ở ô Tìm kiếm → **Chấm công bù** (Nhân sự → Chấm công → tab Đề nghị).\n2. Bấm **Tạo đề nghị**, chọn ngày, giờ vào / ra thực tế, lý do (quên chấm, công tác, máy hỏng…).\n3. Gửi; quản lý trực tiếp duyệt → công được ghi vào bảng công.\n**Lưu ý:**\n- Đề nghị quá hạn chốt công tháng thì HR mới duyệt được; chốt công xem ở Bảng công.",
  "source": "docs"
 },
 {
  "id": "so-tay-dat-xe",
  "title": "Đặt xe công ty",
  "module": "Hành chính",
  "routes": [
   {
    "route": "/booking/vehicle",
    "label": "Đặt xe"
   },
   {
    "route": "/booking/vehicle/my",
    "label": "Đơn đặt xe của tôi"
   }
  ],
  "permission": "Mọi nhân viên; quản lý trực tiếp duyệt; Hành chính xếp xe",
  "keywords": "dat xe xe cong ty di cong tac dang ky xe lai xe huy dat xe dat xe cong ty",
  "body": "**Khi nào:** đi công tác, đi công trường, đón tiếp cần xe công ty.\n**Các bước:**\n1. Gõ \"đặt xe\" ở ô Tìm kiếm → **Đặt xe**.\n2. Nhập giờ đón, giờ về dự kiến, điểm đi / đến (nhiều điểm nếu cần), mục đích, số người, loại chuyến (một chiều / khứ hồi).\n3. **Gửi** → quản lý trực tiếp duyệt → Hành chính xếp xe và lái xe → bạn nhận thông báo biển số, lái xe.\n4. Xem / hủy ở **Đơn đặt xe của tôi**; sau chuyến có thể đánh giá.\n**Lưu ý:**\n- Đặt trước ít nhất một buổi để Hành chính xếp xe; gấp thì gọi Hành chính và vẫn tạo đơn để ghi nhận.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-nghi-chi",
  "title": "Lập đề nghị chi (thanh toán, tạm ứng)",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/requests",
    "label": "Đề nghị chi"
   }
  ],
  "permission": "Người được lập đề nghị chi; duyệt theo ma trận",
  "keywords": "de nghi chi dntt thanh toan ncc tam ung hoan ung de nghi thanh toan ma tran duyet lap de nghi chi (thanh toan, tam ung)",
  "body": "**Khi nào:** cần thanh toán nhà cung cấp, tạm ứng, hoàn ứng, chi khác.\n**Các bước:**\n1. Gõ \"đề nghị chi\" ở ô Tìm kiếm → **Lập đề nghị chi**.\n2. Chọn loại (thanh toán NCC / tạm ứng / chi khác), nhà cung cấp hoặc người nhận, dự án, số tiền, ngày dự kiến chi, hình thức (chuyển khoản / tiền mặt).\n3. Gắn chứng từ: đơn mua, phiếu nhập, hóa đơn; đính kèm ảnh.\n4. **Gửi** → đi theo ma trận duyệt (theo ngưỡng tiền) → Kế toán chi và ghi sổ.\n**Lưu ý:**\n- Số tiền vượt ngưỡng sẽ thêm bước duyệt cao hơn; theo dõi ở Tài chính → Việc cần làm.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-xuat-vat-tu",
  "title": "Lập đề xuất vật tư cho công trường",
  "module": "Dự án · Vật tư",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Người được lập đề xuất của dự án",
  "keywords": "de xuat vat tu yeu cau vat tu dxvt lap de xuat xin vat tu go nhanh chup phieu viet tay lap de xuat vat tu cho cong truong",
  "body": "**Khi nào:** công trường cần vật tư từ kho hoặc cần mua.\n**Các bước:**\n1. Gõ \"lập đề xuất vật tư\" ở ô Tìm kiếm → chọn dự án (hoặc Dự án → mở dự án → tab **Vật tư** → **Yêu cầu vật tư** → Lập đề xuất).\n2. Dùng **Gõ nhanh**: gõ mỗi dòng một vật tư \"tên, số lượng, đơn vị\" — hệ thống khớp mã; hoặc **Chụp phiếu viết tay** để AI đọc thành dòng; kiểm từng dòng, chọn mã đúng.\n3. Chọn kho nhận, ngày cần, mục đích; chọn người duyệt.\n4. **Gửi duyệt** (hoặc Lưu nháp). Theo dõi ở Yêu cầu vật tư: đã duyệt → Mua hàng cân đối tồn / đặt mua → Kho cấp.\n**Lưu ý:**\n- Nhờ Trợ lý: \"đề xuất 100 kg thép D16 cho SMB\" → form đề xuất gọn ngay trong chat, vẫn phải bấm Gửi duyệt.\n- Vật tư chưa có mã → **Đề xuất mã vật tư mới** (Danh mục vật tư).",
  "source": "docs"
 },
 {
  "id": "so-tay-giao-viec",
  "title": "Giao việc và cập nhật việc trong Vioo Work",
  "module": "Công việc",
  "routes": [
   {
    "route": "/work/my?create=1",
    "label": "Tạo công việc"
   },
   {
    "route": "/work/my",
    "label": "Việc của tôi"
   }
  ],
  "permission": "Mọi nhân viên; trưởng bộ phận giao cho phòng",
  "keywords": "giao viec tao cong viec task viec cua toi cap nhat tien do da dang se vuong chot ky giao viec va cap nhat viec trong vioo work",
  "body": "**Khi nào:** giao việc cho nhân viên / phòng, hoặc cập nhật việc đang làm.\n**Các bước:**\n1. Gõ \"tạo công việc\" ở ô Tìm kiếm → **Tạo công việc** (Giao nhanh): tiêu đề, người làm, hạn, mức A/B/C, checklist.\n2. Người nhận bấm **Nhận việc**; cập nhật mỗi ngày bằng Đã / Đang / Sẽ / Vướng ngay trên thẻ việc.\n3. Hết kỳ: trưởng bộ phận **chốt kỳ**, xem báo cáo kỳ và bản tin BLĐ.\n**Lưu ý:**\n- Nhờ Trợ lý: \"giao việc cho Hương: … hạn thứ Sáu\" → thẻ giao việc nháp, bấm Giao mới gửi.",
  "source": "docs"
 },
 {
  "id": "so-tay-gop-y-bao-loi",
  "title": "Báo lỗi phần mềm, gửi góp ý cho Admin",
  "module": "Góp ý",
  "routes": [
   {
    "route": "/feedback",
    "label": "Góp ý"
   },
   {
    "route": "/center?view=assistant",
    "label": "Trợ lý"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "bao loi gop y phan mem loi khong luu duoc man hinh trang bao admin su co y kien cai tien bao loi phan mem, gui gop y cho admin",
  "body": "**Khi nào:** phần mềm báo lỗi, không làm được thao tác, số liệu sai, thiếu quyền, hoặc muốn góp ý tính năng.\n**Các bước:**\n1. Cách nhanh: mở **Trợ lý** (Trung tâm → Trợ lý), đính ảnh chụp màn hình lỗi, kể ngắn \"đang làm gì, ở màn nào, báo gì\".\n2. Trợ lý chuẩn bị **phiếu sự cố** (loại, mức khẩn, phân hệ); sửa nếu cần rồi bấm **Gửi Admin** — phiếu vào Góp ý kèm ảnh, Admin nhận thông báo.\n3. Cách thường: gõ \"góp ý\" ở ô Tìm kiếm → **Gửi góp ý / báo lỗi** → điền tiêu đề, mô tả, loại, đính kèm → Gửi.\n4. Theo dõi trả lời ở Góp ý → phiếu của tôi; Admin đổi trạng thái / bình luận sẽ có thông báo.\n**Lưu ý:**\n- Thiếu quyền xem một màn: ghi rõ màn và việc cần làm để Admin cấp quyền.",
  "source": "docs"
 },
 {
  "id": "so-tay-ke-hoach-tuan",
  "title": "Lập kế hoạch tuần và theo dõi tiến độ dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Chỉ huy trưởng / QLDA của dự án",
  "keywords": "ke hoach tuan lich thi cong tien do du an gantt hang muc cham ly do cham phan tram hoan thanh lap ke hoach tuan va theo doi tien do du an",
  "body": "**Khi nào:** đầu tuần lập việc cho tuần, hoặc muốn xem dự án đang nhanh / chậm.\n**Các bước:**\n1. Gõ \"kế hoạch tuần\" ở ô Tìm kiếm → chọn dự án → tab **Kế hoạch tuần**: chọn hạng mục kế hoạch, khối lượng dự kiến, nhân lực.\n2. Tiến độ: tab **Tiến độ** (Gantt) — % lấy từ nhật ký đã duyệt, trọng số theo số ngày kế hoạch; hạng mục quá ngày kết thúc hiện đỏ.\n3. Hạng mục chậm: ghi lý do chậm ở nhật ký (chọn nhanh) để báo cáo tổng hợp được.\n4. Hỏi Trợ lý \"tiến độ SMB 4 tuần gần đây, hạng mục nào chậm\" để có biểu đồ và danh sách.\n**Lưu ý:**\n- Không nhập % trực tiếp vào Gantt (một nguồn = Nhật ký); điều chỉnh % phải qua phiếu điều chỉnh có duyệt.",
  "source": "docs"
 },
 {
  "id": "so-tay-kiem-ke",
  "title": "Kiểm kê kho",
  "module": "Kho",
  "routes": [
   {
    "route": "/audit",
    "label": "Kiểm kê"
   }
  ],
  "permission": "Thủ kho / Quản trị kho",
  "keywords": "kiem ke kho dem hang doi chieu ton chenh lech kiem ke cuoi thang kiem ke kho",
  "body": "**Khi nào:** cuối tháng, cuối công trình, hoặc khi nghi tồn lệch.\n**Các bước:**\n1. Kho → **Kiểm kê** → **Tạo đợt kiểm kê**: chọn kho, phạm vi (toàn kho / nhóm vật tư).\n2. Đếm thực tế từng mã theo quy cách, nhập số đếm (có thể nhiều người cùng đếm).\n3. Xem chênh lệch so với sổ; ghi nguyên nhân.\n4. **Chốt kiểm kê** → hệ thống tạo phiếu điều chỉnh để tồn khớp thực tế (có duyệt).\n**Lưu ý:**\n- Khi kiểm kê đang mở, phiếu nhập xuất kho đó vẫn ghi được nhưng nên hạn chế để số không lệch.",
  "source": "docs"
 },
 {
  "id": "so-tay-lap-don-hang",
  "title": "Lập đơn hàng mua (PO) từ báo giá",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement?mode=orders",
    "label": "Lập đơn hàng"
   }
  ],
  "permission": "Quản lý Mua hàng",
  "keywords": "lap don hang po tao po mua hang dat hang bao gia nha cung cap nhap excel chup bao gia don mua chu dong lap don hang mua (po) tu bao gia",
  "body": "**Khi nào:** đã có báo giá nhà cung cấp, cần đặt hàng cho dự án hoặc kho.\n**Các bước:**\n1. Gõ \"lập đơn hàng\" ở ô Tìm kiếm → **Lập đơn hàng** (Mua hàng → Đơn hàng → Lập đơn chủ động).\n2. Chọn dự án / kho nhận và nhà cung cấp.\n3. Nhập dòng hàng: **Nhập từ Excel** (mẫu tải ở màn), **Chụp / dán báo giá** để AI đọc, hoặc gõ tay; mỗi dòng có mã, quy cách, số lượng, đơn giá, VAT.\n4. Kiểm ô kiểm số (SL × giá = thành tiền, cộng, VAT) và cảnh báo lệch; sửa nếu cần.\n5. **Lưu nháp** hoặc **Gửi duyệt**; đơn đã duyệt mới nhận hàng được.\n**Lưu ý:**\n- Nhờ Trợ lý: gửi ảnh / Excel / PDF báo giá kèm câu \"lập đơn mua cho SMB theo báo giá này\" → thẻ đơn mua nháp để kiểm rồi gửi.\n- Mua gấp ở công trường dùng **Mua nóng / CCDC**.",
  "source": "docs"
 },
 {
  "id": "so-tay-nghi-phep",
  "title": "Xin nghỉ phép",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "xin nghi phep don nghi phep nam nghi om viec rieng nghi khong luong gui don nghi xin nghi phep",
  "body": "**Khi nào:** cần nghỉ phép năm, nghỉ ốm, việc riêng, nghỉ không lương hoặc đi muộn / về sớm có xin phép.\n**Các bước:**\n1. Gõ \"xin nghỉ phép\" vào ô Tìm kiếm (hoặc mở Nhân sự → Nghỉ phép) rồi bấm **Xin nghỉ phép**.\n2. Chọn **loại nghỉ**; với loại cần lý do con (ốm, việc riêng) chọn thêm lý do; ngày bắt đầu, ngày kết thúc, buổi (cả ngày / sáng / chiều).\n3. Ghi lý do ngắn; đính kèm giấy tờ nếu loại nghỉ yêu cầu (giấy khám…).\n4. Xem số ngày tính được và số phép còn lại, rồi bấm **Gửi đơn**.\n5. Theo dõi trạng thái ở Nghỉ phép → Đơn của tôi; quản lý trực tiếp duyệt, đơn dài ngày có thể lên TGĐ theo ngưỡng.\n**Lưu ý:**\n- Hỏi Trợ lý \"còn bao nhiêu ngày phép\" để xem số phép trước khi làm đơn; bảo Trợ lý \"xin nghỉ phép thứ Sáu\" là có thẻ đơn nháp để kiểm rồi bấm Gửi.\n- Đơn đã duyệt muốn hủy: mở đơn → Hủy (có lý do); HR cấu hình loại nghỉ và ngưỡng ở Thiết lập nghỉ phép.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-hang-chup-phieu",
  "title": "Nhận hàng ở kho bằng chụp phiếu giao",
  "module": "Kho",
  "routes": [
   {
    "route": "/operations",
    "label": "Phiếu kho"
   }
  ],
  "permission": "Thủ kho của kho nhận",
  "keywords": "nhan hang chup phieu giao phieu giao ncc nhap kho phieu nhap ai doc phieu nhan theo xe nhan hang o kho bang chup phieu giao",
  "body": "**Khi nào:** xe nhà cung cấp giao hàng tới kho / công trường.\n**Các bước:**\n1. Kho → **Phiếu giao chụp** → **Chụp phiếu** (chụp liền nhiều tờ) hoặc Chọn từ album.\n2. Chờ AI đọc (khoảng 20–40 giây): nhà cung cấp, số phiếu, biển xe, dòng hàng được điền sẵn; sai thì sửa tay. AI chậm hoặc lỗi → bấm **Đọc lại** hoặc nhập tay.\n3. Chọn **đơn mua** tương ứng (hệ thống gợi ý theo NCC); đối chiếu số nhận với đơn; vượt phần chưa giao sẽ bị chặn, có hộp kiểm lại.\n4. Bấm **Nhận hàng** → tạo phiếu nhập theo xe; giao nhiều lần vẫn gắn cùng một đơn.\n**Lưu ý:**\n- Chưa bật AI thì màn chuyển sang nhập tay, vẫn nhận được.\n- Số lượng thép: ghi theo số cây / kg như phiếu NCC, quy cách chọn đúng để tồn theo quy cách.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhat-ky-cong-truong",
  "title": "Ghi nhật ký công trường và cập nhật tiến độ",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Chỉ huy / kỹ thuật công trường; người duyệt xác nhận",
  "keywords": "nhat ky cong truong bao cao ngay ghi nhat ky tien do khoi luong hang muc phan tram ly do cham dan bao cao zalo ghi nhat ky cong truong va cap nhat tien do",
  "body": "**Khi nào:** cuối mỗi ngày thi công (nhật ký là nguồn duy nhất ghi % tiến độ).\n**Các bước:**\n1. Gõ \"ghi nhật ký\" ở ô Tìm kiếm → chọn dự án (hoặc Dự án → tab **Nhật ký** → Ghi nhật ký).\n2. Chọn ngày, thời tiết, nhân lực, máy; ở phần **Hạng mục**: chọn hạng mục kế hoạch, nhập khối lượng hoặc % hoàn thành tích lũy.\n3. Hạng mục chậm → chọn **lý do chậm** (chọn nhanh), số ngày ảnh hưởng.\n4. Ảnh hiện trường, ghi chú, rồi **Gửi** cho người duyệt; người duyệt **Duyệt nhanh** → % tiến độ dự án cập nhật.\n**Lưu ý:**\n- Có báo cáo gửi Zalo: dán vào Trợ lý, Trợ lý tách thành phiếu nhật ký nháp để kiểm rồi tạo.\n- Quên ngày trước: **Ghi bù** theo Gantt; nhật ký đã duyệt muốn sửa dùng điều chỉnh có duyệt.",
  "source": "docs"
 },
 {
  "id": "so-tay-phieu-quy-trinh",
  "title": "Tạo phiếu quy trình (trình ký)",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Quy trình"
   }
  ],
  "permission": "Theo mẫu quy trình được cấp",
  "keywords": "tao phieu quy trinh workflow trinh ky de nghi tam ung de nghi thanh toan phieu dang o buoc nao tao phieu quy trinh (trinh ky)",
  "body": "**Khi nào:** cần trình ký theo mẫu: đề nghị tạm ứng, thanh toán, xin xe, xin phép công tác…\n**Các bước:**\n1. Gõ \"tạo phiếu quy trình\" ở ô Tìm kiếm → **Quy trình** → **Tạo phiếu** → chọn mẫu.\n2. Điền các ô của mẫu; bảng / tệp đính kèm nhập từ Excel nếu mẫu có bảng.\n3. **Gửi** → phiếu đi qua từng bước duyệt; người duyệt nhận thông báo.\n4. Theo dõi ở Quy trình → Phiếu của tôi: bước hiện tại, người đang giữ, SLA; bị trả lại thì sửa và gửi lại.\n**Lưu ý:**\n- Hỏi Trợ lý \"phiếu PQT-… đang ở bước nào\" để xem nhanh; thống kê phiếu theo mẫu / tháng cũng hỏi Trợ lý được.",
  "source": "docs"
 },
 {
  "id": "so-tay-tim-kiem",
  "title": "Tìm nhanh hồ sơ, màn hình, thao tác",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "tim kiem global search o tim tim ho so mo nhanh phim tat tim ma don hang tim nhanh ho so, man hinh, thao tac",
  "body": "**Khi nào:** muốn mở nhanh một hồ sơ, màn hình hay thao tác mà không cần dò menu.\n**Các bước:**\n1. Bấm ô **Tìm kiếm** ở đầu màn (hoặc phím tắt Ctrl / ⌘ + K).\n2. Gõ mã (PO-646, VT0000116), tên vật tư, tên nhân viên, tên màn (\"tồn kho\"), hay việc muốn làm (\"xin nghỉ phép\").\n3. Chọn kết quả: hồ sơ mở đúng màn; thao tác mở form; không thấy thì bấm **Hỏi Trợ lý** ở cuối danh sách.\n**Lưu ý:**\n- Kết quả chỉ gồm thứ bạn có quyền xem.",
  "source": "docs"
 },
 {
  "id": "so-tay-tro-ly-ai",
  "title": "Dùng Trợ lý AI",
  "module": "Trung tâm",
  "routes": [
   {
    "route": "/center?view=assistant",
    "label": "Trợ lý"
   }
  ],
  "permission": "Người được Quản trị AI cấp",
  "keywords": "tro ly ai hoi tro ly chat ai bieu do bao cao thong ke tim ho so dinh anh excel tri nho chua dung dung tro ly ai",
  "body": "**Khi nào:** muốn hỏi số liệu, tìm hồ sơ, vẽ biểu đồ báo cáo, chuẩn bị phiếu nháp, hoặc hỏi cách dùng phần mềm.\n**Các bước:**\n1. Mở **Trung tâm** → **Trợ lý** (hoặc ô Tìm kiếm → \"Hỏi Trợ lý\"). Gõ mã hồ sơ (PO-646, DA29) là mở ngay không cần hỏi AI.\n2. Hỏi bằng tiếng Việt thường: \"tồn thép D16 kho SMB\", \"thống kê phiếu quy trình quý 3\", \"tiến độ SMB 4 tuần\", \"còn bao nhiêu ngày phép\".\n3. Đính ảnh / Excel / PDF bằng nút kẹp giấy: báo giá → thẻ đơn mua; phiếu viết tay → đề xuất; ảnh lỗi → phiếu sự cố.\n4. Thẻ nháp trong chat chỉ gửi khi bạn bấm nút trên thẻ. Bấm **Chưa đúng** và chọn lý do nếu câu trả lời sai.\n**Lưu ý:**\n- Trợ lý chỉ thấy dữ liệu bạn có quyền xem; \"ngoài phạm vi được xem\" nghĩa là cần được cấp quyền.\n- Nút **Trí nhớ** để xem / quên điều Trợ lý đã nhớ về bạn.",
  "source": "docs"
 },
 {
  "id": "so-tay-van-ban",
  "title": "Soạn văn bản, xử lý văn bản đến",
  "module": "Văn bản",
  "routes": [
   {
    "route": "/office/new",
    "label": "Soạn văn bản"
   },
   {
    "route": "/office/documents",
    "label": "Văn bản"
   }
  ],
  "permission": "Theo quyền Office; Văn thư cấp số",
  "keywords": "soan van ban cong van to trinh quyet dinh thong bao van ban den van ban di so van ban ban hanh soan van ban, xu ly van ban den",
  "body": "**Khi nào:** ban hành thông báo / quyết định / công văn, hoặc tiếp nhận văn bản đến.\n**Các bước:**\n1. Gõ \"soạn văn bản\" ở ô Tìm kiếm → **Soạn văn bản** → chọn loại văn bản, mẫu nếu có.\n2. Soạn nội dung, chọn người ký, nơi nhận, mức khẩn / mật; đính kèm.\n3. **Gửi duyệt** → ký duyệt → Văn thư **cấp số** và **ban hành** → nơi nhận thấy ở Văn bản.\n4. Văn bản đến: Văn thư vào Văn bản → Tiếp nhận → nhập số, ngày, nơi gửi, hạn xử lý → giao người xử lý → người xử lý ghi kết quả.\n**Lưu ý:**\n- Văn bản có hạn mà chưa ghi kết quả sẽ tính \"quá hạn xử lý\" trong thống kê.",
  "source": "docs"
 },
 {
  "id": "so-tay-vpp",
  "title": "Đề xuất văn phòng phẩm",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/vpp",
    "label": "Văn phòng phẩm"
   }
  ],
  "permission": "Mọi nhân viên; người duyệt phòng",
  "keywords": "van phong pham vpp de xuat giay but ghim xin vpp kho vpp de xuat van phong pham",
  "body": "**Khi nào:** phòng cần giấy, bút, mực in… từ Kho VPP.\n**Các bước:**\n1. Gõ \"VPP\" ở ô Tìm kiếm → **Đề xuất VPP**.\n2. Chọn mặt hàng từ danh mục, số lượng; gửi → người duyệt của phòng duyệt → Kho VPP cấp.\n**Lưu ý:**\n- Mặt hàng chưa có trong danh mục: ghi ở ghi chú để Hành chính bổ sung.",
  "source": "docs"
 },
 {
  "id": "so-tay-xuat-kho-chuyen-kho",
  "title": "Lập phiếu xuất kho, chuyển kho",
  "module": "Kho",
  "routes": [
   {
    "route": "/operations",
    "label": "Phiếu kho"
   },
   {
    "route": "/inventory",
    "label": "Tồn kho"
   }
  ],
  "permission": "Thủ kho / người được cấp quyền kho đó",
  "keywords": "xuat kho phieu xuat pxk cap phat chuyen kho dieu chuyen vat tu ton kho con bao nhieu lap phieu xuat kho, chuyen kho",
  "body": "**Khi nào:** cấp vật tư cho công trường (xuất) hoặc điều chuyển giữa hai kho (chuyển).\n**Các bước:**\n1. Gõ \"xuất kho\" (hoặc \"chuyển kho\") ở ô Tìm kiếm → **Lập phiếu xuất kho** / **Chuyển kho** (Kho → Phiếu kho → tab tương ứng).\n2. Chọn kho xuất, dự án / kho nhận, ngày chứng từ, đề xuất vật tư liên quan nếu có.\n3. Thêm dòng: chọn mã, **quy cách** (tồn hiện theo quy cách), số lượng; hệ thống báo nếu vượt tồn.\n4. **Lưu** → phiếu chờ duyệt theo quyền kho; duyệt xong tồn mới trừ.\n**Lưu ý:**\n- Xem tồn nhanh: hỏi Trợ lý \"tồn thép D16 kho SMB\" hoặc mở Tồn kho.\n- Phiếu sai sau khi ghi sổ không sửa thẳng: lập phiếu điều chỉnh / trả lại để giữ lịch sử.",
  "source": "docs"
 },
 {
  "id": "thao-tac-booking",
  "title": "Đặt xe",
  "module": "Hành chính",
  "routes": [
   {
    "route": "/booking/vehicle",
    "label": "Đặt xe"
   }
  ],
  "permission": null,
  "keywords": "dat xe xe cong ty di cong tac dat xe dat xe cong ty di cong tac",
  "body": "**Đặt xe** — Đặt xe công ty đi công tác.\n**Cách mở:** gõ \"đặt xe\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /booking/vehicle.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-checkin",
  "title": "Chấm công",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/checkin",
    "label": "Chấm công"
   }
  ],
  "permission": null,
  "keywords": "cham cong check in vao ca ra ca diem danh gps cham cong vao ca / ra ca theo vi tri",
  "body": "**Chấm công** — Vào ca / ra ca theo vị trí.\n**Cách mở:** gõ \"chấm công\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /hrm/checkin.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-compose",
  "title": "Soạn văn bản",
  "module": "Văn bản",
  "routes": [
   {
    "route": "/office/new",
    "label": "Soạn văn bản"
   }
  ],
  "permission": null,
  "keywords": "soan van ban cong van to trinh quyet dinh soan van ban van ban, cong van moi",
  "body": "**Soạn văn bản** — Văn bản, công văn mới.\n**Cách mở:** gõ \"soạn văn bản\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /office/new.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-count",
  "title": "Kiểm kê kho",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/audit",
    "label": "Kiểm kê kho"
   }
  ],
  "permission": null,
  "keywords": "kiem ke kho dem hang doi chieu ton kiem ke kho dem va doi chieu ton",
  "body": "**Kiểm kê kho** — Đếm và đối chiếu tồn.\n**Cách mở:** gõ \"kiểm kê kho\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /audit.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-daily-log",
  "title": "Ghi nhật ký công trường",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Ghi nhật ký công trường"
   }
  ],
  "permission": null,
  "keywords": "nhat ky cong truong bao cao ngay ghi nhat ky cong truong chon du an roi ghi nhat ky",
  "body": "**Ghi nhật ký công trường** — Chọn dự án rồi ghi nhật ký.\n**Cách mở:** gõ \"ghi nhật ký công trường\" vào ô Tìm kiếm rồi chọn thao tác (chọn dự án trước).",
  "source": "catalog"
 },
 {
  "id": "thao-tac-export",
  "title": "Lập phiếu xuất kho",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/operations",
    "label": "Lập phiếu xuất kho"
   }
  ],
  "permission": null,
  "keywords": "xuat kho phieu xuat pxk cap phat lap phieu xuat kho cap phat vat tu cho cong truong",
  "body": "**Lập phiếu xuất kho** — Cấp phát vật tư cho công trường.\n**Cách mở:** gõ \"lập phiếu xuất kho\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /operations.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-feedback",
  "title": "Gửi góp ý / báo lỗi",
  "module": "Góp ý",
  "routes": [
   {
    "route": "/feedback",
    "label": "Gửi góp ý / báo lỗi"
   }
  ],
  "permission": null,
  "keywords": "gop y bao loi feedback y kien gui gop y / bao loi gui cho doi phat trien",
  "body": "**Gửi góp ý / báo lỗi** — Gửi cho đội phát triển.\n**Cách mở:** gõ \"gửi góp ý / báo lỗi\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /feedback.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-hot",
  "title": "Mua nóng / CCDC",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement?mode=hot",
    "label": "Mua nóng / CCDC"
   }
  ],
  "permission": null,
  "keywords": "mua nong mua gap ccdc cong cu dung cu mua nong / ccdc mua gap o cong truong",
  "body": "**Mua nóng / CCDC** — Mua gấp ở công trường.\n**Cách mở:** gõ \"mua nóng / ccdc\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /procurement?mode=hot.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-leave",
  "title": "Xin nghỉ phép",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Xin nghỉ phép"
   }
  ],
  "permission": null,
  "keywords": "xin nghi phep don nghi nghi om viec rieng xin nghi phep gui don nghi ngay tai day",
  "body": "**Xin nghỉ phép** — Gửi đơn nghỉ ngay tại đây.\n**Cách mở:** gõ \"xin nghỉ phép\" vào ô Tìm kiếm rồi chọn thao tác — form mở ngay tại chỗ.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-makeup",
  "title": "Chấm công bù",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/attendance?tab=proposals",
    "label": "Chấm công bù"
   }
  ],
  "permission": null,
  "keywords": "cham cong bu quen cham de nghi bu cong cham cong bu de nghi bu cong khi quen cham",
  "body": "**Chấm công bù** — Đề nghị bù công khi quên chấm.\n**Cách mở:** gõ \"chấm công bù\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /hrm/attendance?tab=proposals.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-material-request",
  "title": "Lập đề xuất vật tư",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Lập đề xuất vật tư"
   }
  ],
  "permission": null,
  "keywords": "de xuat vat tu yeu cau vat tu dxvt cong truong lap de xuat vat tu chon du an roi lap de xuat",
  "body": "**Lập đề xuất vật tư** — Chọn dự án rồi lập đề xuất.\n**Cách mở:** gõ \"lập đề xuất vật tư\" vào ô Tìm kiếm rồi chọn thao tác (chọn dự án trước).",
  "source": "catalog"
 },
 {
  "id": "thao-tac-new-code",
  "title": "Đề xuất mã vật tư mới",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/material-code-requests",
    "label": "Đề xuất mã vật tư mới"
   }
  ],
  "permission": null,
  "keywords": "cap ma vat tu moi tao ma de xuat ma de xuat ma vat tu moi cap ma cho vat tu chua co",
  "body": "**Đề xuất mã vật tư mới** — Cấp mã cho vật tư chưa có.\n**Cách mở:** gõ \"đề xuất mã vật tư mới\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /material-code-requests.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-payment",
  "title": "Lập đề nghị chi",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/requests",
    "label": "Lập đề nghị chi"
   }
  ],
  "permission": null,
  "keywords": "de nghi chi dntt thanh toan ncc tam ung lap de nghi chi de nghi thanh toan / tam ung",
  "body": "**Lập đề nghị chi** — Đề nghị thanh toán / tạm ứng.\n**Cách mở:** gõ \"lập đề nghị chi\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /finance/requests.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-payslip",
  "title": "Phiếu lương của tôi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/my-payroll",
    "label": "Phiếu lương của tôi"
   }
  ],
  "permission": null,
  "keywords": "phieu luong luong thang cua toi phieu luong cua toi xem luong cac thang",
  "body": "**Phiếu lương của tôi** — Xem lương các tháng.\n**Cách mở:** gõ \"phiếu lương của tôi\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /my-payroll.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-po",
  "title": "Lập đơn hàng",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement?mode=orders",
    "label": "Lập đơn hàng"
   }
  ],
  "permission": null,
  "keywords": "lap don hang po tao po mua hang dat hang lap don hang mua hang — lap po cho nha cung cap",
  "body": "**Lập đơn hàng** — Mua hàng — lập PO cho nhà cung cấp.\n**Cách mở:** gõ \"lập đơn hàng\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /procurement?mode=orders.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-request",
  "title": "Tạo đề xuất",
  "module": "Yêu cầu",
  "routes": [
   {
    "route": "/rq",
    "label": "Tạo đề xuất"
   }
  ],
  "permission": null,
  "keywords": "tao de xuat yeu cau moi xin duyet to trinh tao de xuat de xuat, xin duyet theo mau — ngay tai day",
  "body": "**Tạo đề xuất** — Đề xuất, xin duyệt theo mẫu — ngay tại đây.\n**Cách mở:** gõ \"tạo đề xuất\" vào ô Tìm kiếm rồi chọn thao tác — form mở ngay tại chỗ.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-site-fund",
  "title": "Chi quỹ công trường",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/site-fund",
    "label": "Chi quỹ công trường"
   }
  ],
  "permission": null,
  "keywords": "quy cong truong chi tien mat chi quy cong truong ghi chi tien mat o cong truong",
  "body": "**Chi quỹ công trường** — Ghi chi tiền mặt ở công trường.\n**Cách mở:** gõ \"chi quỹ công trường\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /site-fund.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-task",
  "title": "Tạo công việc",
  "module": "Công việc",
  "routes": [
   {
    "route": "/work/my?create=1",
    "label": "Tạo công việc"
   }
  ],
  "permission": null,
  "keywords": "tao cong viec giao viec task moi tao cong viec giao viec trong vioo work",
  "body": "**Tạo công việc** — Giao việc trong Vioo Work.\n**Cách mở:** gõ \"tạo công việc\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /work/my?create=1.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-theme",
  "title": "Đổi nền sáng / tối",
  "module": "Giao diện",
  "routes": [
   {
    "route": "/",
    "label": "Đổi nền sáng / tối"
   }
  ],
  "permission": null,
  "keywords": "giao dien toi sang dark mode light mode nen doi nen sang / toi giao dien de nhin hon",
  "body": "**Đổi nền sáng / tối** — Giao diện dễ nhìn hơn.\n**Cách mở:** gõ \"đổi nền sáng / tối\" vào ô Tìm kiếm rồi chọn thao tác.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-timesheet",
  "title": "Bảng công của tôi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/timesheet?year=2026&month=1",
    "label": "Bảng công của tôi"
   }
  ],
  "permission": null,
  "keywords": "bang cong tong hop cong thang nay bang cong cua toi cong thang nay",
  "body": "**Bảng công của tôi** — Công tháng này.\n**Cách mở:** gõ \"bảng công của tôi\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /hrm/timesheet?year=2026&month=1.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-transfer",
  "title": "Chuyển kho",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/operations",
    "label": "Chuyển kho"
   }
  ],
  "permission": null,
  "keywords": "chuyen kho dieu chuyen vat tu chuyen kho dieu chuyen vat tu giua cac kho",
  "body": "**Chuyển kho** — Điều chuyển vật tư giữa các kho.\n**Cách mở:** gõ \"chuyển kho\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /operations.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-vpp",
  "title": "Đề xuất VPP",
  "module": "Vật tư",
  "routes": [
   {
    "route": "/vpp",
    "label": "Đề xuất VPP"
   }
  ],
  "permission": null,
  "keywords": "van phong pham vpp de xuat giay but ghim de xuat vpp xin giay, but, ghim… tu kho vpp",
  "body": "**Đề xuất VPP** — Xin giấy, bút, ghim… từ Kho VPP.\n**Cách mở:** gõ \"đề xuất vpp\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /vpp.",
  "source": "catalog"
 },
 {
  "id": "thao-tac-work-plan",
  "title": "Kế hoạch tuần",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Kế hoạch tuần"
   }
  ],
  "permission": null,
  "keywords": "ke hoach tuan lich thi cong ke hoach tuan chon du an roi lap ke hoach tuan nay",
  "body": "**Kế hoạch tuần** — Chọn dự án rồi lập kế hoạch tuần này.\n**Cách mở:** gõ \"kế hoạch tuần\" vào ô Tìm kiếm rồi chọn thao tác (chọn dự án trước).",
  "source": "catalog"
 },
 {
  "id": "thao-tac-workflow",
  "title": "Tạo phiếu quy trình",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Tạo phiếu quy trình"
   }
  ],
  "permission": null,
  "keywords": "tao phieu quy trinh workflow moi trinh ky tao phieu quy trinh trinh ky theo quy trinh",
  "body": "**Tạo phiếu quy trình** — Trình ký theo quy trình.\n**Cách mở:** gõ \"tạo phiếu quy trình\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /wf.",
  "source": "catalog"
 }
];
