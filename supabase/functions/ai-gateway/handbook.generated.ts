// SINH TỰ ĐỘNG bởi scripts/handbook/build.mjs — không sửa tay. Nguồn: docs/so-tay/*.md, docs/huong-dan-su-dung-phong-quan-ly-du-an.md,
// lib/search/searchCatalog.ts. Chạy lại: npm run handbook:build (test assistantHandbook báo đỏ nếu quên).
export interface HandbookEntry {
  id: string; title: string; module: string; routes: Array<{ route: string; label: string }>; permission: string | null;
  /** Từ khóa + tiêu đề đã bỏ dấu, chữ thường — để khớp câu hỏi. */
  keywords: string;
  /** Câu hỏi mẫu (frontmatter questions) đã bỏ dấu + bỏ từ đệm, ngăn bằng " · " — chỉ tính khi trùng cụm 2 từ. */
  questions: string; body: string; source: string;
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
  "body": "**Khi nào:** Cập nhật tiến độ thực tế, theo dõi chậm trễ và hỗ trợ điều hành dự án.\n**Các bước:**\n1. Dự án đã ghi tiến độ bằng **Nhật ký** (chủ SP chốt 15/10/2026: một nguồn = Nhật ký): % hoàn thành lấy từ phiếu nhật ký đã duyệt, ô % trên Gantt bị khóa — cập nhật bằng phiếu nhật ký; các bước dưới chỉ dùng cho dự án chưa ghi Nhật ký.\n2. Mở tab **Tiến độ**, tìm công việc cần cập nhật.\n3. Mở form chỉnh sửa hoặc cập nhật tiến độ.\n4. Nhập phần trăm hoàn thành, ngày thực tế hoặc thông tin liên quan.\n5. Kiểm tra cảnh báo trễ, phụ thuộc hoặc đường găng.\n6. Bấm **Lưu**.\n**Lưu ý:**\nDự án dùng Nhật ký: % chỉ đổi khi phiếu nhật ký được duyệt (không sửa tay trên Gantt); muốn chỉnh ngày kế hoạch thì gửi điều chỉnh tiến độ có duyệt.\n**Lỗi hay gặp:**\n- **Không cập nhật được công việc đã khóa:** kiểm tra trạng thái/gate hoặc quyền cập nhật.\n- **Tiến độ vượt 100% bất thường:** kiểm tra quy định nhập liệu và dữ liệu khối lượng.",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
  "body": "**Khi nào:** Tạo hồ sơ dự án mới để bắt đầu quản lý tiến độ, ngân sách, hợp đồng, vật tư và các nghiệp vụ liên quan.\n**Các bước:**\n1. Tại màn hình danh sách dự án, bấm **Thêm dự án**.\n2. Nhập thông tin cơ bản: tên, mã, khách hàng, mô tả.\n3. Chọn nhóm dự án, loại dự án, lĩnh vực dự án nếu có.\n4. Chọn công trường HRM nếu dự án đã có công trường tương ứng.\n5. Chọn người quản lý dự án.\n6. Chọn trạng thái, ngày bắt đầu, ngày kết thúc.\n7. Chọn phương pháp tính tiến độ phù hợp.\n8. Mở phần nâng cao nếu cần gán admin, executor, watcher hoặc vị trí mặc định.\n9. Kiểm tra lại thông tin.\n10. Bấm **Lưu**.\n**Lưu ý:**\n- Mã dự án nên thống nhất với quy chuẩn nội bộ.\n- Nếu dự án cần dùng các tab Điều hành, Dòng tiền, Báo cáo, Nghiệm thu & Thanh toán, nên liên kết công trường HRM ngay từ đầu.\n- Cách tính tiến độ ảnh hưởng đến phần trăm tiến độ hiển thị ở banner dự án.\n**Lỗi hay gặp:**\n- **Thiếu trường bắt buộc:** nhập đủ tên, mã và các trường hệ thống yêu cầu.\n- **Không chọn được công trường:** kiểm tra công trường đã được tạo trong HRM chưa.\n- **Không lưu được:** kiểm tra quyền quản trị dự án hoặc dữ liệu bị trùng mã.",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
  "body": "**Hôm nay** (Trang chính) — mở từ thanh bên hoặc gõ \"hôm nay\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "man-kiem-soat",
  "title": "Màn hình Lệch cần sửa",
  "module": "Kiểm soát",
  "routes": [
   {
    "route": "/kiem-soat",
    "label": "Lệch cần sửa"
   }
  ],
  "permission": null,
  "keywords": "lech can sua kiem soat sai lech du lieu chung tu khong khop canh bao lech can sua kiem soat",
  "questions": "",
  "body": "**Lệch cần sửa** (Kiểm soát) — mở từ thanh bên hoặc gõ \"lệch cần sửa\" ở ô Tìm kiếm.",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
  "body": "**Văn phòng phẩm** (Vật tư) — mở từ thanh bên hoặc gõ \"văn phòng phẩm\" ở ô Tìm kiếm.",
  "source": "catalog"
 },
 {
  "id": "so-tay-bang-cong-phieu-luong",
  "title": "Xem công tháng của tôi, báo HR khi sai",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/timesheet",
    "label": "Công tháng của tôi"
   }
  ],
  "permission": "Mọi nhân viên (chỉ của mình)",
  "keywords": "bang cong cong thang cua toi cong tinh luong tong hop cong cong thang nay sai cong bao hr phan hoi cong chot cong cong thang truoc xem cong thang cua toi, bao hr khi sai",
  "questions": "bang cong thang · cong thang sai · bang cong ghi vang · bao hr sai cong · cong thang truoc · thang da chot cong con sua",
  "body": "**Khi nào:** muốn biết công tính lương, ngày phép, ngày vắng / thiếu chấm trong tháng.\n**Các bước:**\n1. Gõ \"bảng công\" ở ô Tìm kiếm → **Bảng công của tôi** (tháng hiện tại). Mở từ menu Nhân sự → **Công tháng của tôi** thì mặc định tháng trước; đổi tháng bằng mũi tên ‹ ›.\n2. Xem 4 ô **Công tính lương**, **Công đi làm**, **Nghỉ có lương**, **Vắng / thiếu chấm** và danh sách ngày (X đi làm, P phép năm, V vắng, ! thiếu lượt chấm…).\n3. Ngày sai: ở khung **Công chưa đúng? Báo HR** chọn ngày (hoặc Cả tháng), ghi nội dung → **Gửi**.\n4. Xem trả lời ngay dưới khung: \"chờ HR xem\" hoặc \"HR đã trả lời\".\n**Không làm được?**\n- Không có khung báo HR, chỉ ghi \"Tháng đã gửi duyệt hoặc đã chốt\" → tháng đã khóa, liên hệ HR trực tiếp.\n- Nút **Gửi** mờ → nội dung cần ít nhất 5 ký tự.\n- \"Chưa có bảng công\" → tài khoản chưa gắn hồ sơ nhân sự.\n**Lưu ý:**\n- Quên chấm thì tự gửi đề xuất chấm công bù sớm, đừng chờ chốt công.\n- Phiếu lương xem ở mục \"Xem phiếu lương của tôi\".",
  "source": "docs"
 },
 {
  "id": "so-tay-bao-cao-bieu-do",
  "title": "Xem báo cáo, biểu đồ thống kê bằng Trợ lý",
  "module": "Chung",
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
  "keywords": "bao cao bieu do thong ke theo thang theo tuan quy phieu quy trinh nhap xuat kho don mua tien do thu chi cham cong nghi phep yeu cau dat xe van ban bien dong nhan su so lieu hop xuat excel xem bao cao, bieu do thong ke bang tro ly",
  "questions": "thong ke phieu quy trinh quy · ve bieu do nhap xuat kho thang · bao cao thu chi theo thang · bieu do nhan su vao ra thang · bao cao tien du an theo tuan · bieu do thieu so lieu",
  "body": "**Khi nào:** cần số liệu theo tuần / tháng / quý để họp, báo cáo.\n**Các bước:**\n1. Mở **Trợ lý**, hỏi kèm loại + kỳ: \"thống kê phiếu quy trình quý 3\", \"nhập xuất kho SMB tháng này\", \"giá trị đơn mua 3 tháng theo NCC\", \"tiến độ DA29 theo tuần\", \"thu chi quý 3\", \"chấm công tuần này\", \"nghỉ phép 3 tháng theo phòng\", \"phiếu yêu cầu tháng này\", \"đặt xe quý 3\", \"văn bản tháng 10\", \"biến động nhân sự 6 tháng\".\n2. Thẻ biểu đồ hiện trong chat: ô số tổng, cột / đường theo kỳ, vòng tròn theo mẫu / NCC / dự án; bấm **Bảng** để xem số từng kỳ, nút liên kết để mở màn gốc.\n3. Không nói kỳ → Trợ lý lấy 3 tháng gần nhất; kỳ ngắn thì chia theo tuần.\n4. Cần Excel: dùng màn báo cáo của module, vd Kho → **Báo cáo** (**Xuất Excel NXT**, **In PDF**).\n**Không làm được?**\n- Ô hiện \"—\" / \"chưa có số\" → không có dữ liệu kỳ đó (không phải 0).\n- Số ít hơn đồng nghiệp hoặc báo ngoài phạm vi → chỉ tính trong phạm vi bạn được xem (dự án, kho, quyền Tài chính).\n- Tiến độ dự án phải nói rõ mã dự án (SMB, DA29); biến động nhân sự cần quyền xem tổ chức.\n**Lưu ý:**\n- Muốn số đúng từng dòng chứng từ: mở màn gốc của module rồi lọc.",
  "source": "docs"
 },
 {
  "id": "so-tay-cham-cong",
  "title": "Chấm công vào ca / ra ca",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/checkin",
    "label": "Check-in / Check-out"
   },
   {
    "route": "/hrm/attendance?tab=mine",
    "label": "Lịch của tôi"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "cham cong check in check out vao ca ra ca cham vao cham ra diem danh gps vi tri chup anh khuon mat cc bam cong cham cong dien thoai cham cong vao ca / ra ca",
  "questions": "cham cong · cham cong ra ca · nut cham cong mo ko bam · cham ra lan · cham cong may tinh · lo cham ra som sua · cham cong xong dau lai",
  "body": "**Khi nào:** đầu ca và cuối ca mỗi ngày, tại văn phòng hoặc công trường đã có điểm chấm công.\n**Các bước:**\n1. Nhân sự → **Check-in / Check-out** (hoặc gõ \"chấm công\" ở ô Tìm kiếm). Nên dùng điện thoại.\n2. Chờ dòng địa điểm báo \"Trong phạm vi\"; đứng gần nhiều điểm thì bấm chọn đúng tên điểm.\n3. Điện thoại: bấm **Chụp ảnh chấm công vào** (hoặc ra), chụp mặt. Máy tính: khung camera mở sẵn.\n4. Bấm **Chấm công vào** / **Chấm công ra**, mở khóa bằng vân tay / Face ID khi máy hỏi.\n5. Thấy \"Đã chấm công vào lúc …\" là xong; xem lại ở **Lịch công của tôi**.\n**Không làm được?**\n- Nút mờ, báo \"ngoài phạm vi\" / \"GPS chưa đủ chính xác\" → xem mục \"Chấm công báo ngoài phạm vi\".\n- \"Ảnh chấm công phải chụp ngay lúc này\" / \"Ảnh đã chụp quá 2 phút\" → không dùng ảnh cũ, bấm **Chụp lại**.\n- Hiện nút **Đăng ký điện thoại này** → lần đầu phải đăng ký máy (mục riêng).\n- \"Chưa có hồ sơ nhân sự\" → tài khoản chưa gắn hồ sơ, báo phòng HCNS.\n**Lưu ý:**\n- Lượt đầu trong ngày là giờ vào; mỗi lượt sau ghi đè giờ ra (tối đa 10 lượt/ngày) — lỡ chấm ra sớm thì lúc về chấm lại.\n- Quên chấm → gửi đề xuất chấm công bù.",
  "source": "docs"
 },
 {
  "id": "so-tay-cham-cong-bu",
  "title": "Gửi đề xuất chấm công bù (quên chấm, ngoài vùng)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/attendance?tab=mine",
    "label": "Lịch của tôi"
   },
   {
    "route": "/hrm/attendance?tab=proposals",
    "label": "Đề Xuất CC"
   }
  ],
  "permission": "Mọi nhân viên (cho chính mình)",
  "keywords": "cham cong bu quen cham de xuat cc de nghi bu cong bo sung cong sua cong quen cham ra thieu luot cham may hong ngoai vung bu cong quen bam ra ca quen bam vao ca quen cham ra quen check out quen check in gui de xuat cham cong bu (quen cham, ngoai vung)",
  "questions": "quen cham cong · quen cham ra hom qua · de xuat cham cong bu · de xuat cc gui ai duyet · gui de xuat cham cong · ngay thieu luot cham sua · huy de xuat cham cong da gui",
  "body": "**Khi nào:** quên chấm vào / ra, đứng ngoài phạm vi, điện thoại hỏng… nhưng thực tế có đi làm.\n**Các bước:**\n1. Nhân sự → **Chấm công của tôi** → tab **Lịch của tôi**, bấm ngày \"Thiếu lượt chấm\" / \"Vắng\" → **Đề xuất bù công** (hoặc nút **Đề xuất CC** đầu màn).\n2. Kiểm **Ngày cần bù công**, điền **Giờ vào**, **Giờ ra** thực tế.\n3. Chọn **Trạng thái**: Đi làm, Nửa ngày hoặc Công tác.\n4. Chọn **Địa điểm** (công trường / văn phòng); dưới ô hiện tên **Người duyệt**.\n5. Ghi **Lý do đề xuất** → **Gửi đề xuất**. Theo dõi ở tab **Đề Xuất CC**: Chờ duyệt / Đã duyệt / Từ chối (kèm lý do).\n**Không làm được?**\n- \"Địa điểm này chưa có người quản lý duyệt chấm công\" → nhờ HR Manage đặt người duyệt ở Cài đặt → **Địa điểm chấm công**.\n- \"Tháng … đã chốt công\" → tháng đã khóa, liên hệ HR mở lại kỳ công.\n- Nút **Gửi đề xuất** mờ → thiếu ngày hoặc lý do.\n**Lưu ý:**\n- Người duyệt là quản lý của địa điểm đã chọn (không phải quản lý trực tiếp); duyệt xong công tự vào bảng công.\n- Không có nút hủy đề xuất đã gửi; gửi nhầm thì nhắn người duyệt từ chối.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-bang-xep-hang",
  "title": "Bảng xếp hạng, điểm XP",
  "module": "Chung",
  "routes": [
   {
    "route": "/leaderboard",
    "label": "Bảng xếp hạng"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "bang xep hang xp diem thi dua cap do huy hieu streak cham chi nhat cong ty leaderboard diem khong tang hang cua toi bang xep hang, diem xp",
  "questions": "bang xep hang tinh diem · diem xp tang · hang · bang xep hang dau · huy hieu lay",
  "body": "**Khi nào:** xem điểm XP, cấp độ, hạng của mình so với mọi người.\n**Các bước:**\n1. Máy tính: thanh bên → **Bảng xếp hạng**. Điện thoại: gõ \"bảng xếp hạng\" ở ô Tìm kiếm.\n2. Xem top 3 và danh sách; dòng gắn nhãn **BẠN** là bạn.\n3. Ô **Vị trí của bạn** cho biết còn bao nhiêu XP để lên hạng trên.\n**Không làm được?**\n- Điểm XP không tăng dù vẫn làm việc → hiện phần mềm chưa cộng điểm mới (điểm đứng từ cuối tháng 8/2026) → không phải lỗi của bạn, không ảnh hưởng công việc.\n- \"Chưa có ai xếp hạng!\" → chưa có dữ liệu điểm.\n**Lưu ý:**\n- Điểm XP chỉ để thi đua, không dùng để tính công hay lương.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-bat-thong-bao-day",
  "title": "Bật thông báo đẩy trên điện thoại, máy tính",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Tài khoản"
   },
   {
    "route": "/notifications",
    "label": "Thông báo"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "bat thong bao thong bao day web push khong nhan duoc thong bao iphone khong bao thong bao dien thoai chuong bao notification bi chan thong bao tat thiet bi nay bat thong bao day tren dien thoai, may tinh",
  "questions": "dien thoai nhan thong bao · bat thong bao · iphone thong bao · nut bat thong bao mo · thong bao chan · viec duyet thay bao",
  "body": "**Khi nào:** muốn điện thoại / máy tính báo ngay khi có việc, kể cả lúc không mở Vioo.\n**Các bước:**\n1. iPhone: cài Vioo ra màn hình chính bằng Safari và mở Vioo từ biểu tượng đó (bắt buộc).\n2. Mở **Cài đặt** → **Tài khoản** → khối **Thông báo trên thiết bị** → bấm **Bật thông báo**.\n3. Trình duyệt hỏi quyền → chọn **Cho phép** (Allow).\n4. Thấy \"Đang bật trên thiết bị này\" là xong. Mỗi máy (điện thoại, máy tính) phải bật riêng.\n**Không làm được?**\n- \"Đang bị chặn bởi trình duyệt\", nút mờ → trước đó đã chặn → biểu tượng ổ khóa cạnh địa chỉ trang → Thông báo (Notifications) → Cho phép, rồi bấm lại.\n- \"iPhone/iPad cần mở từ màn hình chính\" → đang mở bằng Safari thường → mở từ biểu tượng Vioo.\n- Đã bật mà không nhận tin Theo dõi / Nghiệp vụ → bạn đã chọn \"Tổng hợp cuối ngày\" hoặc \"Không báo\" ở **Cách nhận thông báo** (loại này không đẩy về máy).\n- Điện thoại tắt thông báo cho Chrome / Vioo trong Cài đặt của máy → bật lại.\n**Lưu ý:**\n- Ngừng nhận trên một máy: bấm **Tắt thiết bị này**.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-cach-nhan-thong-bao",
  "title": "Tắt bớt thông báo, gom thông báo cuối ngày",
  "module": "Chung",
  "routes": [
   {
    "route": "/notifications?preferences=1",
    "label": "Cách nhận thông báo"
   },
   {
    "route": "/notifications",
    "label": "Thông báo"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "tat thong bao bot thong bao qua nhieu thong bao tong hop cuoi ngay khong bao cach nhan thong bao tat chuong tat thong bao nhom chat spam thong bao theo doi nghiep vu tat bot thong bao, gom thong bao cuoi ngay",
  "questions": "thong bao nhieu qua tat bot · tat thong bao theo doi · gom thong bao cuoi ngay · nhan thong bao phieu nguoi khac · tat thong bao nhom chat · tat thong bao viec",
  "body": "**Khi nào:** bị báo quá nhiều tin cập nhật, muốn gom lại hoặc tắt bớt.\n**Các bước:**\n1. Mở **Thông báo** → bấm **Cách nhận thông báo** (hoặc biểu tượng cùng tên trong khung chuông).\n2. **Theo dõi** (phiếu bạn tạo / theo dõi): chọn **Báo ngay**, **Tổng hợp cuối ngày** hoặc **Không báo**.\n3. **Nghiệp vụ** (cảnh báo mảng bạn phụ trách): **Báo ngay** hoặc **Tổng hợp cuối ngày**.\n4. Chọn tổng hợp thì đặt **Giờ nhận tổng hợp**; bấm **Lưu thay đổi**.\n5. Nhóm chat ồn: mở nhóm trong **Tin nhắn** → nút **Tắt thông báo** ở đầu khung chat.\n**Không làm được?**\n- Không tắt được **Việc của tôi** → được giao việc, đến lượt duyệt, được nhắc tên luôn báo ngay (khóa).\n- Cảnh báo nghiêm trọng vẫn báo ngay dù chọn tổng hợp.\n**Lưu ý:**\n- \"Không báo\" vẫn lưu tin ở tab **Theo dõi**, tự đánh dấu đã đọc. Thay đổi chỉ áp cho thông báo mới.\n- Ngừng hẳn thông báo đẩy trên một máy: Cài đặt → Tài khoản → **Tắt thiết bị này**.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-cai-app-dien-thoai",
  "title": "Cài Vioo lên màn hình điện thoại",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Tài khoản"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "cai app cai vioo len dien thoai them vao man hinh chinh pwa tai app ung dung iphone android icon vioo app store ch play add to home screen mo bang ung dung cap nhat phien ban moi cai vioo len man hinh dien thoai",
  "questions": "dien thoai · cai len iphone · tai dau · them ra man hinh chinh · thay ch play · phien ban bam cap nhat ngay",
  "body": "**Khi nào:** muốn mở Vioo bằng biểu tượng như app; iPhone muốn nhận thông báo đẩy thì bắt buộc cài.\n**Các bước:**\n1. Vioo không có trên App Store / CH Play; cài thẳng từ trình duyệt.\n2. Android: mở Vioo bằng Chrome → khung \"Cài Vioo lên thiết bị\" hiện ở dưới → bấm **Cài đặt ngay**. Không thấy khung: menu ⋮ của Chrome → Thêm vào màn hình chính.\n3. iPhone / iPad: mở Vioo bằng **Safari** → nút Chia sẻ (Share) → **Add to Home Screen** (Thêm vào MH chính).\n4. Từ nay mở Vioo bằng biểu tượng trên màn hình chính rồi đăng nhập.\n5. Kiểm tra: **Cài đặt** → **Tài khoản** → khối **Ứng dụng PWA** → **Kiểm tra**; ô \"Chế độ mở\" ghi \"Đang mở bằng ứng dụng\" là đúng.\n**Không làm được?**\n- Không có khung cài / nút cài → đang mở trong Zalo, Facebook → mở lại bằng Chrome (Android) hoặc Safari (iPhone).\n- Đã bấm ✕ đóng khung cài → khung ẩn 7 ngày → dùng menu trình duyệt như bước 2–3.\n**Lưu ý:**\n- Thấy khung \"Có phiên bản mới\" → bấm **Cập nhật ngay**; dữ liệu đã lưu không mất.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-dang-xuat-moi-thiet-bi",
  "title": "Đăng xuất mọi thiết bị khi mất điện thoại",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Tài khoản"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "dang xuat moi thiet bi mat dien thoai lo mat khau thoat tat ca may dang xuat tu xa bao mat dang xuat may khac quen dang xuat may cong ty dang xuat moi thiet bi khi mat dien thoai",
  "questions": "mat dien thoai thoat may · dang xuat tat ca thiet · nghi lo mat khau phai · dang xuat may khac · quen dang xuat may tinh cong ty",
  "body": "**Khi nào:** mất / đổi điện thoại, quên đăng xuất máy dùng chung, nghi lộ mật khẩu.\n**Các bước:**\n1. Trên một máy đang đăng nhập, mở **Cài đặt** → **Tài khoản**.\n2. Nghi lộ mật khẩu: đổi mật khẩu ở khối **Đổi mật khẩu** trước.\n3. Kéo xuống khối **Đăng xuất** → bấm **Đăng xuất mọi thiết bị**.\n4. Hộp xác nhận hiện email của bạn → bấm **Đăng xuất hết**.\n5. Mọi máy (kể cả máy này) về màn Đăng nhập; đăng nhập lại trên máy của bạn.\n**Không làm được?**\n- \"Chưa đăng xuất được\" → mất mạng → kiểm tra mạng rồi bấm lại.\n- Không còn máy nào đăng nhập được → báo Admin: Admin có thể **Vô hiệu hoá tài khoản này** tạm thời rồi **Khôi phục** kèm mật khẩu mới (quyền phải cấp lại).\n**Lưu ý:**\n- Chỉ muốn thoát máy đang cầm: bấm **Đăng xuất máy này** hoặc **Đăng xuất** ở thanh bên.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-doi-anh-dai-dien",
  "title": "Đổi ảnh đại diện",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Tài khoản"
   },
   {
    "route": "/my-profile",
    "label": "Hồ sơ của tôi"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "doi anh dai dien avatar anh ca nhan thay anh tai anh len anh profile anh qua lon file khong hop le doi anh dai dien",
  "questions": "doi dai dien · thay avatar · tai dai dien bao qua lon · doi ca nhan · dai dien bao file hop le",
  "body": "**Khi nào:** muốn thay ảnh hiện cạnh tên mình (tin nhắn, phiếu, danh sách người).\n**Các bước:**\n1. Mở **Cài đặt** → **Tài khoản** → khối **Ảnh đại diện** → **Tải ảnh lên**.\n2. Hoặc mở **Hồ sơ của tôi** (bấm ảnh / tên mình ở thanh bên) → bấm vào ảnh (hiện **Đổi ảnh**).\n3. Chọn ảnh JPG, PNG hoặc WEBP dưới 2 MB → chờ báo đã cập nhật ảnh đại diện.\n**Không làm được?**\n- \"Ảnh quá lớn — Dung lượng tối đa là 2MB.\" → chọn ảnh nhỏ hơn hoặc chụp màn hình ảnh đó rồi dùng.\n- \"File không hợp lệ — Chỉ chấp nhận JPG, PNG hoặc WEBP.\" → đổi định dạng ảnh.\n- Báo không cập nhật được → mất mạng → thử lại.\n**Lưu ý:**\n- Người khác có thể phải tải lại trang mới thấy ảnh mới.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-doi-mat-khau",
  "title": "Đổi mật khẩu",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Tài khoản"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "doi mat khau thay mat khau cap nhat mat khau doi pass mat khau moi bao mat tai khoan cai dat tai khoan mat khau hien tai doi mat khau",
  "questions": "doi mat khau · doi mat khau · thay pass · bao mat khau hien tai chinh xac · mat khau phai may ky tu · doi mat khau may khac thoat",
  "body": "**Khi nào:** muốn thay mật khẩu, nhất là sau khi Admin cấp mật khẩu mới.\n**Các bước:**\n1. Mở **Cài đặt** (thanh bên; giao diện Trung tâm điều hành: biểu tượng bánh răng ở rail trái) → mục **Tài khoản**.\n2. Ở khối **Đổi mật khẩu** nhập **Mật khẩu hiện tại**.\n3. Nhập **Mật khẩu mới** và **Xác nhận mật khẩu mới** (ít nhất 6 ký tự, hai ô giống nhau).\n4. Bấm **Cập nhật mật khẩu** → thấy \"Đã đổi mật khẩu thành công.\"\n**Không làm được?**\n- \"Mật khẩu hiện tại không chính xác.\" → gõ sai mật khẩu đang dùng → gõ lại; quên hẳn thì nhờ Admin đặt mật khẩu mới.\n- \"Mật khẩu mới phải có ít nhất 6 ký tự.\" / \"Xác nhận mật khẩu mới không khớp.\" → sửa ô tương ứng.\n- \"Tài khoản chưa có email đăng nhập…\" → tài khoản thiếu email → báo Admin.\n**Lưu ý:**\n- Nghi lộ mật khẩu: đổi xong bấm **Đăng xuất mọi thiết bị** ngay bên dưới để thoát các máy khác.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-du-lieu-vua-bi-sua",
  "title": "Báo \"vừa được người khác cập nhật\" khi lưu",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "vua duoc nguoi khac cap nhat vua duoc nguoi khac sua tai lai roi thu lai xung dot phien ban luu khong duoc nguoi khac dang sua hai tab du lieu vua thay doi so lieu vua thay doi bao \"vua duoc nguoi khac cap nhat\" khi luu",
  "questions": "luu phieu bao vua nguoi khac cap nhat · don vua nguoi khac sua tai · bam luu bao tai · du lieu vua nguoi khac cap nhat · tai mat vua nhap · so lieu vua thay doi",
  "body": "**Khi nào:** bấm Lưu / Duyệt thì báo \"… vừa được người khác cập nhật. Tải lại rồi thử lại.\" (hoặc \"Số liệu vừa thay đổi\", \"Đơn vừa được người khác sửa\").\n**Các bước:**\n1. Phần vừa gõ dài thì chép ra trước, vì tải lại sẽ mất phần chưa lưu.\n2. Đóng phiếu rồi mở lại, hoặc tải lại trang (F5).\n3. Xem bản mới: ai vừa đổi gì (lịch sử / nhật ký của phiếu nếu có).\n4. Làm lại thao tác trên bản mới rồi bấm lưu.\n**Không làm được?**\n- Nguyên nhân: từ lúc bạn mở tới lúc bấm lưu, có người (hoặc chính bạn ở tab / máy khác) đã lưu phiếu này → Vioo chặn để không ghi đè.\n- Tải lại rồi vẫn báo → có người đang sửa cùng lúc → nhắn họ làm xong trước; vẫn lỗi thì báo Admin kèm mã phiếu.\n**Lưu ý:**\n- Một số màn tự tải lại ngay sau lỗi này (\"Đã tải lại, kiểm tra rồi làm lại\").\n- Tránh mở cùng một phiếu ở hai tab.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-giao-dien-sang-toi",
  "title": "Đổi nền sáng / tối, ghim và sắp xếp menu",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "nen toi nen sang dark mode light mode doi giao dien che do toi thu gon thanh ben ghim menu sap xep ung dung co chu chu nho phong to chu thanh duoi dien thoai doi nen sang / toi, ghim va sap xep menu",
  "questions": "doi sang nen · chu nho qua phong to · ghim thanh menu ben trai · dark mode · sap xep ung dung menu · thanh duoi dien thoai doi muc",
  "body": "**Khi nào:** muốn đổi màu nền, cách hiện menu cho dễ nhìn, dễ bấm.\n**Các bước:**\n1. Nền sáng / tối: bấm biểu tượng mặt trăng / mặt trời — ở khối tên bạn trên thanh bên, đầu màn trên điện thoại, hoặc góc dưới rail trái của Trung tâm điều hành.\n2. Thanh bên (máy tính) tự thu gọn, rê chuột vào là mở; muốn luôn mở: bấm biểu tượng ghim (**Ghim Sidebar cố định**) ở đầu thanh.\n3. Sắp xếp ứng dụng (máy tính): thanh bên → **Ứng dụng** → kéo thả ô; Trung tâm điều hành: kéo biểu tượng trên rail.\n4. Thanh dưới điện thoại: bấm **Thêm** → **Tùy chỉnh thanh điều hướng** để chọn tối đa 5 mục; nút **Mặc định** để về như cũ.\n**Không làm được?**\n- Chữ nhỏ → Vioo chưa có chỉnh cỡ chữ riêng → phóng to của trình duyệt (Ctrl + / Ctrl − trên máy tính, chụm hai ngón trên điện thoại).\n- Đổi máy / trình duyệt thì về mặc định → lựa chọn lưu trên từng máy → chọn lại.\n**Lưu ý:**\n- Chuyển giao diện mới / cũ: công tắc **Trung tâm điều hành** (chỉ hiện khi tài khoản được bật thí điểm).",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-khong-dang-nhap-duoc",
  "title": "Không đăng nhập được vào Vioo",
  "module": "Chung",
  "routes": [
   {
    "route": "/login",
    "label": "Đăng nhập"
   },
   {
    "route": "/settings",
    "label": "Cài đặt"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "khong dang nhap duoc loi dang nhap sai mat khau sai email tai khoan bi khoa vo hieu hoa chua kich hoat khong vao duoc dang nhap that bai login zalo khong mo ho so nguoi dung khong dang nhap duoc vao vioo",
  "questions": "dang nhap · dang nhap bao ten dang nhap mat khau chinh xac · tai khoan khoa · ko vao · bao thong tin dang nhap hop le loi ket noi · mo link zalo dang nhap · hien mo ho so nguoi dung",
  "body": "**Khi nào:** bấm **Đăng nhập** nhưng bị báo lỗi hoặc không vào được.\n**Các bước:**\n1. Ô **Email** phải là email đầy đủ (có @) Admin đã cấp, không phải tên hay số điện thoại.\n2. Bấm biểu tượng con mắt ở ô **Mật khẩu** để xem lại; kiểm tra bộ gõ tiếng Việt, Caps Lock.\n3. Mở link trong Zalo / Facebook thấy khung vàng \"đăng nhập không được lưu\" → bấm **Mở bằng Chrome** (Android) hoặc **Sao chép đường dẫn** rồi dán vào Safari (iPhone).\n4. Vẫn lỗi: chụp màn hình lời báo, gửi Admin.\n**Không làm được?**\n- \"Tên đăng nhập hoặc mật khẩu không chính xác.\" → sai email / mật khẩu → bấm **Quên mật khẩu?**, nhờ Admin đặt lại.\n- \"Thông tin đăng nhập không hợp lệ hoặc lỗi kết nối.\" → mất mạng, hoặc tài khoản đã bị vô hiệu hóa → kiểm tra mạng; vẫn báo thì hỏi Admin.\n- Đăng nhập xong hiện \"Không thể mở hồ sơ người dùng\" → tài khoản chưa gắn hồ sơ đang hoạt động hoặc đã bị vô hiệu hóa → Admin kiểm tra ở Cài đặt → Người dùng.\n**Lưu ý:**\n- Admin khôi phục tài khoản bị vô hiệu hóa thì quyền về 0, phải cấp lại quyền.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-khong-thay-menu",
  "title": "Không thấy menu, module hoặc màn cần dùng",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Người dùng"
   },
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": "Admin cấp ở Cài đặt → Người dùng",
  "keywords": "khong thay menu khong thay module thieu quyen chua duoc cap quyen phan quyen bi dua ve trang chu khong vao duoc man hinh mo link bi quay ve hom nay xin quyen cap quyen ai cap quyen chua duoc phan quyen module nao khong thay menu, module hoac man can dung",
  "questions": "thay menu mua hang · thay module kho · bam link dong nghiep gui ve trang hom · cap quyen · ai cap quyen · chua quyen vao man · thieu quyen vao",
  "body": "**Khi nào:** đồng nghiệp có menu / màn mà bạn không có, hoặc mở link bị đưa về **Hôm nay**.\n**Các bước:**\n1. Tự kiểm: gõ tên màn vào ô **Tìm kiếm** — ô này chỉ hiện màn bạn được vào; không ra là chưa có quyền.\n2. Xem **Hôm nay** → **Truy cập nhanh** (hoặc thanh bên → **Ứng dụng**): chỉ hiện ứng dụng bạn được dùng.\n3. Nhắn Admin hoặc gửi **Góp ý** loại \"Phân quyền\": ghi rõ màn và việc cần làm.\n4. Admin: **Cài đặt** → **Người dùng** → bấm vào người → **Chỉnh sửa & phân quyền** → chọn mẫu quyền theo vị trí / chỉnh riêng → lưu.\n5. Được cấp xong: tải lại trang (F5) hoặc đăng xuất rồi đăng nhập lại.\n**Không làm được?**\n- Mở link bị quay về Hôm nay, không báo gì → thiếu quyền vào màn đó.\n- Tab Trung tâm điều hành báo \"Bạn chưa có quyền vào màn này\"; thanh bên báo \"Chưa được phân quyền module nào\" → nhờ Admin cấp.\n- Có module nhưng không thấy dự án / kho cần làm → quyền theo phạm vi: chưa được thêm vào dự án / kho đó → hỏi quản lý dự án hoặc Admin.\n**Lưu ý:**\n- Mọi nhân viên luôn vào được: Hôm nay, Thông báo, Hồ sơ của tôi, Góp ý, Văn phòng phẩm, Cài đặt (Tài khoản). Có Trợ lý thì hỏi \"em có quyền gì / cần quyền gì để…\".",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-khong-thay-nut",
  "title": "Không thấy nút Duyệt, Sửa, Hủy trên phiếu",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   },
   {
    "route": "/notifications",
    "label": "Thông báo"
   }
  ],
  "permission": "Theo quyền và người được giao ở từng bước",
  "keywords": "khong thay nut duyet khong thay nut sua khong thay nut huy nut bi mo nut xam khong bam duoc khong co quyen thuc hien thao tac nay chua den buoc khong phai nguoi duyet chua den luot xac nhan khong thay nut duyet, sua, huy tren phieu",
  "questions": "thay nut duyet · nut sua mo bam · phieu nut huy · quyen thuc hien · thay nut xac nhan · da luot duyet chua",
  "body": "**Khi nào:** mở phiếu / hồ sơ nhưng thiếu nút cần bấm, hoặc nút mờ.\n**Các bước:**\n1. Xem trạng thái và bước hiện tại của phiếu: nút Duyệt / Xác nhận chỉ hiện cho người được giao ở đúng bước đang chờ.\n2. Kiểm tra phiếu có trong việc chờ bạn chưa (Hôm nay, Trung tâm điều hành → **Chờ tôi**, Thông báo → **Việc của tôi**). Chưa có là chưa tới lượt.\n3. Nút mờ: rê chuột (máy tính) lên nút để đọc lý do ghi kèm.\n4. Đúng lượt mà vẫn thiếu nút → thiếu quyền thao tác (khác quyền xem) → nhờ Admin cấp ở **Cài đặt** → **Người dùng**.\n**Không làm được?**\n- Chứng từ chưa tới bước / đã qua bước (đã duyệt, đã hủy, đã khóa kỳ) → không có nút → hỏi người đang giữ phiếu.\n- Bấm báo \"Bạn không có quyền thực hiện thao tác này.\" → máy chủ chặn: thiếu quyền hoặc không phải người được giao → Admin / người lập kiểm tra.\n- Nhiều khâu (tài chính, chốt số) không cho người lập tự xác nhận → cần người khác bấm.\n**Lưu ý:**\n- Mỗi việc có bậc quyền riêng (xem, thao tác, duyệt…): được xem chưa chắc được sửa. Có Trợ lý thì hỏi \"sao em không duyệt được phiếu này\".",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-lech-can-sua",
  "title": "Lệch cần sửa (kiểm soát dữ liệu)",
  "module": "Chung",
  "routes": [
   {
    "route": "/kiem-soat",
    "label": "Lệch cần sửa"
   }
  ],
  "permission": "Mọi nhân viên (chỉ thấy lệch giao cho mình)",
  "keywords": "lech can sua kiem soat sai lech du lieu khong khop canh bao lech chung tu po lech gia doi soat cong no lech kho lech chap nhan lech lech can sua (kiem soat du lieu)",
  "questions": "lech sua · bao lech du lieu · thong bao lech sua p0 · chap nhan lech · lech kiem soat xu ly the · po canh bao lech",
  "body": "**Khi nào:** nhận thông báo \"Lệch cần sửa\" hoặc thấy mục Lệch cần sửa trong Việc của tôi.\n**Các bước:**\n1. Mở **Lệch cần sửa** (thông báo, Việc của tôi, hoặc gõ \"lệch cần sửa\" ở ô Tìm kiếm).\n2. Bấm vào luật để xem từng lệch: chứng từ, chênh bao nhiêu, **Xử lý:** làm gì, **Ai:** bộ phận nào.\n3. Bấm **Mở** để vào đúng chứng từ và sửa theo hướng dẫn (ghi lý do, chốt giá, chốt đợt giao, chứng từ điều chỉnh…).\n4. Sửa xong không cần báo: máy tự kiểm lại 15 phút một lần, hết lệch thì tự đóng.\n5. Lệch có lý do chính đáng: trưởng bộ phận bấm **Chấp nhận** và ghi lý do (ít nhất 10 ký tự).\n**Không làm được?**\n- Không thấy nút **Chấp nhận** → chỉ trưởng bộ phận, người Quản trị phân hệ hoặc Admin chấp nhận được; người xử lý sửa chứng từ.\n- Sửa rồi lệch vẫn còn → chờ lượt kiểm kế tiếp (tối đa 15 phút); vẫn còn thì sửa chưa đúng chỗ — đọc lại **Xử lý:** hoặc hỏi Trợ lý \"PO-… có gì lệch\".\n- Lệch quá 3 ngày chưa xử lý → trưởng bộ phận của bạn cũng nhận được.\n**Lưu ý:**\n- Lệch mức P0 (sai tiền hoặc tồn kho) có thông báo ngay; các lệch khác gộp vào bản tin 07:00 hằng ngày.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-loi-khi-luu",
  "title": "Bấm Lưu báo lỗi: hiểu lời báo và cách xử lý",
  "module": "Chung",
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
  "keywords": "loi khi luu khong luu duoc bao loi khong ro khong co quyen thuc hien thao tac nay du lieu da ton tai dang duoc su dung noi khac khong the xu ly yeu cau may chu xu ly qua lau loi he thong gui khong duoc bam luu bao loi: hieu loi bao va cach xu ly",
  "questions": "bam luu bao loi hieu · quyen thuc hien · du lieu da ton tai · du lieu lien quan hop le dang su dung noi khac · xu ly yeu cau vui long · luu phai",
  "body": "**Khi nào:** bấm Lưu / Gửi / Xóa thì hiện khung đỏ báo lỗi.\n**Các bước:**\n1. Đọc kỹ lời báo, đối chiếu danh sách dưới.\n2. Sửa theo hướng dẫn rồi bấm lại một lần (không bấm liên tục).\n3. Có Trợ lý: hỏi \"sao không lưu được\" — Trợ lý đọc lời báo vừa hiện để giải thích.\n4. Vẫn lỗi: chụp màn hình cả lời báo, gửi **Góp ý** loại \"Báo lỗi\".\n**Không làm được?**\n- \"Bạn không có quyền thực hiện thao tác này.\" → thiếu quyền / không phải người được giao → Admin cấp quyền.\n- \"Dữ liệu này đã tồn tại…\" → trùng mã, số, tên đã có → tìm bản cũ hoặc đổi số.\n- \"Dữ liệu liên quan không hợp lệ hoặc đang được sử dụng ở nơi khác…\" → đang xóa thứ chứng từ khác còn dùng → xử lý chứng từ đó trước.\n- \"Không kết nối được máy chủ…\" → mạng; \"Phiên đăng nhập đã hết hạn…\" → đăng nhập lại.\n- \"Không thể xử lý yêu cầu. Vui lòng thử lại.\" → lỗi chưa rõ → gửi Góp ý kèm ảnh.\n**Lưu ý:**\n- Câu báo tiếng Việt cụ thể (không đủ tồn, ngày chứng từ, kỳ đã khóa…) là luật nghiệp vụ: làm theo đúng câu đó.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-mat-mang",
  "title": "Mất mạng, mạng chậm khi đang dùng Vioo",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "mat mang offline khong co mang mang yeu mang cham he thong dang cham ket noi lai khong ket noi duoc may chu du lieu co mat khong dang offline luu khong duoc song yeu cong truong mat mang, mang cham khi dang dung vioo",
  "questions": "mat mang du lieu mat · dang offline · bao ket noi may chu · he thong dang cham dang ket noi · mang yeu luu · cong truong song yeu dung",
  "body": "**Khi nào:** thấy dải đỏ \"Đang offline\", dải vàng \"Hệ thống đang chậm, đang thử kết nối lại...\" hoặc lời báo không kết nối được máy chủ.\n**Các bước:**\n1. Đừng đóng form đang nhập; chờ có mạng (đổi Wi‑Fi / 4G) rồi bấm lại **Lưu** / **Gửi**.\n2. Phiếu dài: chép nội dung ra ghi chú trước khi tải lại trang.\n3. Có mạng lại: tải lại trang (F5) để thấy số mới nhất.\n4. Mở app lúc mất mạng thấy màn \"Đang chờ có mạng\": cứ để đó, Vioo tự thử lại; có mạng thì bấm **Thử lại**.\n**Không làm được?**\n- Bấm Lưu báo \"Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại.\" → thao tác CHƯA được lưu → lưu lại khi có mạng.\n- Dải \"Hệ thống đang chậm…\" → máy chủ trả lời chậm, Vioo tự thử lại → đợi vài giây rồi làm tiếp.\n- Đăng nhập lại báo lỗi kết nối → chờ có mạng, không cần đổi mật khẩu.\n**Lưu ý:**\n- Đã báo lưu thành công thì dữ liệu nằm trên máy chủ, mất mạng không mất.\n- Vioo không giữ nháp form khi mất mạng; riêng thẻ đơn mua / đề xuất vật tư của Trợ lý giữ nháp trên máy 7 ngày.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-quen-mat-khau",
  "title": "Quên mật khẩu, nhờ Admin đặt lại",
  "module": "Chung",
  "routes": [
   {
    "route": "/login",
    "label": "Đăng nhập"
   },
   {
    "route": "/settings",
    "label": "Cài đặt"
   }
  ],
  "permission": "Mọi nhân viên (Admin hoặc người có quyền Quản lý tài khoản đặt mật khẩu mới)",
  "keywords": "quen mat khau lay lai mat khau cap lai mat khau reset mat khau dat lai mat khau khong nho mat khau quen pass forgot password admin cap mat khau dat mat khau moi quan ly tai khoan hcns quen mat khau, nho admin dat lai",
  "questions": "quen mat khau · quen mat khau · quen pass lay · bam quen mat khau thay gui email · ai cap mat khau · admin dat mat khau nhan vien",
  "body": "**Khi nào:** không nhớ mật khẩu, không vào được Vioo.\n**Các bước:**\n1. Ở màn Đăng nhập bấm **Quên mật khẩu?** — Vioo không gửi email đặt lại, chỉ báo liên hệ Quản trị viên (Admin).\n2. Gọi / nhắn Admin (số liên hệ in ở cuối màn Đăng nhập) hoặc người Quản lý tài khoản (phòng HCNS), nói rõ email đăng nhập.\n3. Admin / Quản lý tài khoản: **Cài đặt** → **Người dùng** → bấm vào người đó → khối Mật khẩu → **Đặt mật khẩu mới** → nhập 2 lần (ít nhất 8 ký tự) và **Lý do** (ít nhất 10 ký tự) → **Đặt mật khẩu**.\n4. Người đặt gửi mật khẩu mới qua kênh riêng (gọi điện, tin nhắn riêng).\n5. Đăng nhập bằng mật khẩu mới rồi tự đổi lại ở **Cài đặt** → **Tài khoản** → **Đổi mật khẩu**.\n**Không làm được?**\n- Không thấy nút **Đặt mật khẩu mới** → tài khoản đang bị vô hiệu hóa → dùng **Khôi phục tài khoản này** (kèm mật khẩu mới; quyền về 0, phải cấp lại).\n- Báo \"Cần quyền Quản lý tài khoản.\" → người bấm chưa được cấp quyền Quản lý tài khoản (Cài đặt → Người dùng) → nhờ Admin cấp hoặc nhờ người có quyền.\n- Báo \"Chỉ Admin thao tác được trên tài khoản quản trị.\" → tài khoản đó là Admin hoặc người quản lý phân quyền → nhờ Admin.\n- Admin muốn đổi mật khẩu của chính mình → làm ở Cài đặt → Tài khoản.\n**Lưu ý:**",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-tai-tep-anh-loi",
  "title": "Không tải ảnh, tệp đính kèm lên được",
  "module": "Chung",
  "routes": [
   {
    "route": "/feedback",
    "label": "Góp ý"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "khong tai anh len duoc khong dinh kem duoc tep qua lon dung luong toi da dinh dang file khong hop le upload loi tai len anh qua lon pdf qua lon gioi han mb khong tai anh, tep dinh kem len duoc",
  "questions": "dinh kem file · qua lon tai len · file bao nhieu mb · tai bao file hop le · upload file loi · dinh kem pdf bao vuot qua",
  "body": "**Khi nào:** chọn ảnh / tệp thì bị báo \"quá lớn\", \"không hợp lệ\" hoặc tải mãi không xong.\n**Các bước:**\n1. Đọc dòng chữ nhỏ cạnh nút đính kèm: mỗi màn có giới hạn riêng (vd Góp ý tối đa 5 tệp, mỗi tệp 25 MB; ảnh đại diện JPG / PNG / WEBP tối đa 2 MB).\n2. Ảnh quá lớn: chọn ảnh nhỏ hơn hoặc chụp màn hình ảnh đó rồi gửi.\n3. PDF quá lớn: tách bớt trang hoặc nén lại; tài liệu chụp thì gửi ảnh thay PDF.\n4. Định dạng màn đó không nhận: đổi sang JPG / PNG / PDF.\n5. Tải mãi không xong: kiểm tra mạng, chọn lại tệp.\n**Không làm được?**\n- \"… vượt quá 25 MB\" / \"Dung lượng tối đa là 2MB.\" → tệp vượt giới hạn của màn → làm nhỏ tệp.\n- \"File không hợp lệ…\" → sai định dạng màn đó nhận.\n- Chọn tệp xong bấm lưu báo lỗi → mất mạng giữa chừng → thử lại; vẫn lỗi thì gửi Góp ý kèm tên tệp, dung lượng.\n**Lưu ý:**\n- Trợ lý nhận tối đa 4 ảnh và 3 tệp Excel / CSV / PDF mỗi câu (PDF ≤ 50 MB).",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-tin-nhan-tao-hoi-thoai",
  "title": "Tạo hội thoại, nhóm chat trong Tin nhắn",
  "module": "Chung",
  "routes": [
   {
    "route": "/chat",
    "label": "Tin nhắn"
   }
  ],
  "permission": "Tin nhắn · Xem",
  "keywords": "tin nhan chat tao hoi thoai nhan tin nhom chat tao nhom them thanh vien nhan rieng chat noi bo khong chon duoc nguoi nut tao bi mo vong tron gach do doi ten nhom tao hoi thoai, nhom chat trong tin nhan",
  "questions": "tao nhom chat · nhan tin rieng dong nghiep · bam tao hoi thoai hien vong tron gach do · chon nguoi nhan tin · them nguoi vao nhom chat · thay menu tin nhan",
  "body": "**Khi nào:** nhắn riêng một người hoặc lập nhóm trao đổi.\n**Các bước:**\n1. Mở **Tin nhắn** → bấm **+** (Tạo cuộc hội thoại mới) ở cột trái, hoặc biểu tượng **Thêm bạn** / **Tạo nhóm chat** cạnh ô Tìm kiếm.\n2. Hộp **Tạo hội thoại**: gõ tên vào ô **Tìm người dùng**, bấm vào dòng người đó cho ô vuông bên phải hiện dấu tích.\n3. Nhắn riêng: tích 1 người, để trống tên nhóm. Nhóm: ghi **Tên nhóm**, tích nhiều người.\n4. Bấm **Tạo**, gõ tin rồi Enter để gửi.\n5. Thêm người / đổi tên nhóm: mở nhóm → nút ⋯ (**Cấu hình nhóm**) → **Thêm thành viên** (chỉ trưởng / phó nhóm làm được).\n**Không làm được?**\n- Nút **Tạo** mờ, chuột hiện vòng tròn gạch đỏ → chưa tích người nào → bấm vào tên người trong danh sách trước.\n- Danh sách người trống → danh bạ chưa tải (hay gặp khi mở thẳng Tin nhắn) → mở **Hôm nay** (giao diện cũ), **Yêu cầu** hoặc **Quy trình** một lần rồi quay lại Tin nhắn.\n- Không có menu Tin nhắn → thiếu quyền \"Tin nhắn · Xem\" → nhờ Admin cấp.\n**Lưu ý:**\n- Nhóm ồn: bấm **Tắt thông báo** ở đầu khung chat.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-trang-trang-tai-mai",
  "title": "Trang trắng, tải mãi, báo \"Đã xảy ra lỗi hệ thống\"",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "trang trang tai mai khong load quay mai treo man hinh da xay ra loi he thong tai lai ung dung phien ban moi cap nhat ngay dang cap nhat ung dung trang khong tim thay loading lau trang trang, tai mai, bao \"da xay ra loi he thong\"",
  "questions": "trang trang phai · man hinh cu quay tai xong · bao da xay ra loi he thong · phien ban · tai mai vao · trang tim thay",
  "body": "**Khi nào:** màn trắng, vòng quay mãi, hoặc khung \"Đã xảy ra lỗi hệ thống\".\n**Các bước:**\n1. Bấm **Tải lại ứng dụng** (trên khung lỗi) hoặc tải lại trang (F5; điện thoại: tắt hẳn app rồi mở lại).\n2. Thấy khung \"Có phiên bản mới\" → bấm **Cập nhật ngay**. Màn \"Đang cập nhật ứng dụng\" là Vioo tự tải bản mới, đợi vài giây.\n3. Kiểm tra mạng (Wi‑Fi / 4G).\n4. Vẫn lỗi: chụp màn hình có dòng chữ lỗi, ghi màn đang mở, gửi **Góp ý** loại \"Báo lỗi\".\n**Không làm được?**\n- Chỉ một màn lỗi, màn khác vẫn chạy → lỗi riêng màn đó → chuyển màn khác vẫn dùng được; báo Admin.\n- Mở link cũ hiện \"Trang không tìm thấy\" → đường dẫn đã đổi → bấm **Về Trang Chủ**, tìm màn bằng ô Tìm kiếm.\n- Màn \"Đang chờ có mạng\" → mất mạng; Vioo tự kết nối lại.\n**Lưu ý:**\n- Cập nhật phiên bản không làm mất dữ liệu đã lưu; chỉ mất phần đang gõ dở chưa lưu.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-tro-ly-chua-duoc-cap",
  "title": "Trợ lý AI chưa được cấp, hết lượt hỏi",
  "module": "Chung",
  "routes": [
   {
    "route": "/center?view=assistant",
    "label": "Trợ lý"
   },
   {
    "route": "/ai",
    "label": "Trung tâm AI"
   }
  ],
  "permission": "Người được Quản trị AI cấp ở Trung tâm AI",
  "keywords": "tro ly ai chua duoc cap het luot ai het cau hoi hom nay khong dung duoc tro ly ai bi khoa quan tri ai cap ai tro ly khong tra loi tro ly cham trung tam ai tran thang tro ly ai chua duoc cap, het luot hoi",
  "questions": "dung tro ly ai · tro ly ai chua cap · het luot ai hom · da dung het cau ai hom · tro ly tra loi · ai cap quyen dung tro ly · tro ly dang tra loi cau truoc",
  "body": "**Khi nào:** ô hỏi Trợ lý bị khóa, báo hết lượt hoặc không trả lời.\n**Các bước:**\n1. Trợ lý nằm trong **Trung tâm điều hành** → tab **Trợ lý**: tài khoản cần được bật Trung tâm điều hành trước.\n2. Thấy \"Trợ lý AI chưa được cấp cho …\" → nhắn Quản trị AI (tên ghi trong câu báo) xin cấp; Quản trị AI cấp theo người ở **Trung tâm AI** (mẫu, số câu / ngày, trần tiền tháng).\n3. Xem lượt còn lại ở dòng **Còn N câu hôm nay** dưới ô hỏi.\n**Không làm được?**\n- \"Bạn đã dùng hết N câu AI hôm nay…\" → hết trần ngày → mai dùng tiếp hoặc nhờ Quản trị AI nâng trần; \"…hết trần AI tháng này\" → nhờ nâng trần tháng.\n- \"Bạn gửi hơi nhanh…\" / \"Trợ lý đang trả lời câu trước…\" → đợi xong rồi hỏi tiếp.\n- \"Máy chủ AI đang chậm…\", \"Không gọi được nhà cung cấp AI…\", \"Hết credit nhà cung cấp AI.\" → lỗi phía AI, không phải do bạn → thử lại sau; kéo dài thì báo Admin.\n- Trả lời \"ngoài phạm vi được xem\" → bạn không có quyền xem dữ liệu đó.\n- Mở **Trợ lý AI** ở menu thấy \"Trung tâm AI dành cho Quản trị AI\" → màn đó để cấp AI; hỏi đáp dùng tab **Trợ lý** của Trung tâm điều hành.\n**Lưu ý:**\n- Gõ mã hồ sơ (PO-…, mã dự án) là mở ngay, không hỏi AI, không tốn lượt.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-trung-tam-dieu-hanh",
  "title": "Dùng Trung tâm điều hành (giao diện mới)",
  "module": "Chung",
  "routes": [
   {
    "route": "/center",
    "label": "Trung tâm điều hành"
   }
  ],
  "permission": "Trung tâm điều hành · Truy cập Trung tâm điều hành (và được bật thí điểm)",
  "keywords": "trung tam dieu hanh giao dien moi center bat giao dien moi viec cua toi cho toi toi gui theo doi mo tab truy cap nhanh tuy chinh o chon nut tren o bang dieu khien quay ve giao dien cu thi diem dung trung tam dieu hanh (giao dien moi)",
  "questions": "trung tam dieu hanh dung · bat giao dien · thay cong trung tam dieu hanh · quay ve giao dien cu · trung tam dieu hanh dang thi diem · tuy chinh hom · mo nhieu tab cung luc",
  "body": "**Khi nào:** muốn một màn gom việc chờ mình, thao tác nhanh, Trợ lý và mở nhiều hồ sơ dạng tab.\n**Các bước:**\n1. Bật: thanh bên → công tắc **Trung tâm điều hành** (\"Giao diện mới — thử ngay\"); từ đó trang chính là Trung tâm điều hành.\n2. Cột **Việc của tôi**: tab **Chờ tôi** / **Tôi gửi** / **Theo dõi**; bấm nhóm để mở, bấm dòng để mở hồ sơ thành tab.\n3. Tab **Hôm nay**: ô **Truy cập nhanh** theo module — bấm là lập phiếu / mở màn ngay trong tab; **Tùy chỉnh ô** để đổi thứ tự, ẩn ô; **Chọn nút trên ô** để ghim tối đa 4 nút.\n4. Tab đã mở giữ nguyên phần đang điền khi chuyển qua lại; bấm ✕ để đóng.\n5. Về giao diện cũ: công tắc ở góc dưới rail trái (máy tính) hoặc trong thanh bên.\n**Không làm được?**\n- Không thấy công tắc / báo \"Trung tâm điều hành đang thí điểm\" → chưa được bật cho tài khoản → nhờ Admin.\n- \"Bạn chưa có quyền vào Trung tâm điều hành\" → thiếu quyền \"Truy cập Trung tâm điều hành\".\n- **Tùy chỉnh ô** có ổ khóa → thiếu quyền \"Tùy chỉnh bố cục của tôi\".\n**Lưu ý:**\n- Điện thoại: thanh dưới có **Việc**, **Hôm nay**, **Trợ lý**.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-tu-dang-xuat",
  "title": "Bị tự đăng xuất, phải đăng nhập lại",
  "module": "Chung",
  "routes": [
   {
    "route": "/settings",
    "label": "Cài đặt → Tài khoản"
   },
   {
    "route": "/login",
    "label": "Đăng nhập"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "tu dang xuat bi dang xuat phien het han phien dang nhap het han phai dang nhap lai ghi nho dang nhap mat dang nhap bi thoat ra an danh zalo dang cho co mang bi tu dang xuat, phai dang nhap lai",
  "questions": "cu tu dang xuat · phien dang nhap da het han · lan mo phai dang nhap · tu dang xuat hoai · dong trinh duyet thoat · mo zalo lan cung phai dang nhap",
  "body": "**Khi nào:** đang dùng hoặc mở lại Vioo thì bị về màn Đăng nhập.\n**Các bước:**\n1. Lúc đăng nhập để ô **Ghi nhớ đăng nhập** được tích. Bỏ tích thì đóng trình duyệt là thoát (dành cho máy dùng chung).\n2. Mở Vioo bằng Chrome / Safari hoặc biểu tượng Vioo trên màn hình chính, không mở link trong Zalo, Facebook (các app này không giữ đăng nhập).\n3. Không dùng tab ẩn danh, không xóa dữ liệu duyệt web của trang Vioo.\n4. Gặp \"Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.\" → đăng nhập lại rồi làm tiếp (phần chưa lưu phải nhập lại).\n**Không làm được?**\n- Mọi máy cùng bị thoát → bạn hoặc ai đó đã bấm **Đăng xuất mọi thiết bị** → đăng nhập lại; không phải bạn bấm thì đổi mật khẩu.\n- Màn \"Đang chờ có mạng\" → mất mạng lúc mở app; phiên vẫn giữ, Vioo tự kết nối lại (có mạng thì bấm **Thử lại**).\n- Màn \"Không thể mở hồ sơ người dùng\" → tài khoản bị vô hiệu hóa / chưa gắn hồ sơ → báo Admin.\n**Lưu ý:**\n- **Đăng xuất máy này** (Cài đặt → Tài khoản) hoặc **Đăng xuất** ở thanh bên chỉ thoát máy đang dùng.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-viec-cho-toi",
  "title": "Xem việc đang chờ mình xử lý",
  "module": "Chung",
  "routes": [
   {
    "route": "/",
    "label": "Hôm nay"
   },
   {
    "route": "/center",
    "label": "Trung tâm điều hành"
   },
   {
    "route": "/notifications",
    "label": "Thông báo"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "viec cua toi viec cho toi phieu cho duyet can xu ly viec can lam cho duyet den luot toi phieu toi gui theo doi ai dang giu phieu viec cho ban xem viec dang cho minh xu ly",
  "questions": "phieu dang cho duyet · viec · viec · phieu gui dang nam ai · viec duyet · da duyet van con danh sach",
  "body": "**Khi nào:** đầu ngày muốn biết việc gì đang chờ mình, hoặc phiếu mình gửi đang ở đâu.\n**Các bước:**\n1. Mở **Hôm nay**: khối **Việc chờ bạn** (nếu được bật Trung tâm điều hành) hoặc các khối **Quy trình chờ duyệt**, **Yêu cầu cần duyệt**, **Phiếu kho & Cấp vật tư chờ xử lý** (chỉ hiện khi có việc). Bấm dòng để mở, **Xem tất cả** để ra danh sách.\n2. Trung tâm điều hành: cột **Việc của tôi** → **Chờ tôi** (đến lượt bạn), **Tôi gửi** (bạn lập, người khác đang duyệt), **Theo dõi**.\n3. **Thông báo** → tab **Việc của tôi**: được giao, đến lượt duyệt, được nhắc tên.\n4. Có Trợ lý: hỏi \"Hôm nay việc gì gấp nhất?\".\n**Không làm được?**\n- Đã xử lý mà vẫn còn → chưa tải mới → bấm **Làm mới** hoặc tải lại trang.\n- Thiếu việc ở cột Việc của tôi → một số nguồn chỉ hiện 200 việc gần nhất → vào module để xem hết.\n- Phiếu không có ở **Chờ tôi** → chưa tới bước của bạn hoặc đã giao người khác → mở phiếu xem bước hiện tại.\n**Lưu ý:**\n- Mỗi module (Quy trình, Yêu cầu, Mua hàng…) vẫn có danh sách riêng với bộ lọc đầy đủ.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-xem-thong-bao",
  "title": "Xem, đánh dấu đã đọc, dọn thông báo",
  "module": "Chung",
  "routes": [
   {
    "route": "/notifications",
    "label": "Thông báo"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "xem thong bao chuong thong bao danh dau da doc xoa thong bao an thong bao thong bao chua doc tim thong bao cu viec cua toi theo doi nghiep vu he thong tai them xem, danh dau da doc, don thong bao",
  "questions": "thong bao cu · danh dau tat ca da doc · xoa het thong bao · thong bao viec · bam thong bao mo phieu · thay thong bao",
  "body": "**Khi nào:** xem việc được báo, dọn chuông thông báo.\n**Các bước:**\n1. Bấm chuông (thanh bên trên máy tính, đầu màn trên điện thoại) để xem nhanh; xem đủ thì mở **Thông báo**.\n2. Chọn tab **Việc của tôi** (giao việc, đến lượt duyệt, nhắc tên), **Theo dõi**, **Nghiệp vụ**, **Hệ thống**; bật **Chỉ chưa đọc** hoặc gõ ô tìm để lọc.\n3. Bấm một thông báo để mở đúng hồ sơ.\n4. Dọn: ở từng dòng bấm **Đánh dấu đã đọc** hoặc **Ẩn thông báo**; khung chuông có nút đánh dấu tất cả đã đọc và xoá tất cả (mọi tab).\n5. Danh sách dài: kéo xuống cuối, bấm **Tải thêm**.\n**Không làm được?**\n- Bấm thông báo mà không vào được hồ sơ → có thể bạn không có quyền xem hồ sơ / màn đó (đổi người xử lý, rời dự án) → hỏi người gửi hoặc Admin.\n- Không thấy tin mới → bấm **Làm mới**; kiểm tra **Cách nhận thông báo** (chọn \"Không báo\" thì tin tự đánh dấu đã đọc).\n- \"Không tải được thông báo\" → mất mạng → bấm **Thử lại**.\n**Lưu ý:**\n- Xoá tất cả trong khung chuông là xoá ở mọi tab, cân nhắc trước khi bấm.",
  "source": "docs"
 },
 {
  "id": "so-tay-chung-xuat-excel",
  "title": "Xuất Excel báo cáo, danh sách",
  "module": "Chung",
  "routes": [
   {
    "route": "/reports",
    "label": "Báo cáo kho"
   },
   {
    "route": "/finance",
    "label": "Tài chính"
   }
  ],
  "permission": "Theo quyền xem của từng màn",
  "keywords": "xuat excel tai excel xuat file bao cao excel download danh sach ra excel in pdf luu pdf xuat bao cao nxt tai file xlsx save as pdf xuat excel bao cao, danh sach",
  "questions": "xuat excel · tai danh sach ra excel · xuat file excel bao cao kho · nut xuat excel mo · in bao cao ra pdf · man nut xuat excel",
  "body": "**Khi nào:** cần đưa số liệu ra Excel để gửi hoặc làm báo cáo.\n**Các bước:**\n1. Mở màn có bảng cần lấy, lọc đúng kỳ / dự án / kho trước — tệp xuất theo bảng đang xem.\n2. Bấm **Xuất Excel** (biểu tượng tải xuống / bảng tính, thường ở góc trên bảng); tệp .xlsx tải về máy.\n3. Chỗ hay dùng: Kho → **Báo cáo** (**Xuất Excel NXT**), Tồn kho; Tài chính → Báo cáo, Dự báo, Tài chính dự án; Nhân sự → Bảng lương, Chấm công (**Xuất Excel tính lương**), Bảng nhân sự; Dự án → Báo cáo, Gantt, Vật tư; Tài sản → Báo cáo, Kiểm kê; Văn phòng phẩm → Báo cáo.\n**Không làm được?**\n- Nút mờ → bảng đang trống (lọc ra 0 dòng) → đổi bộ lọc.\n- Màn không có nút xuất → chưa hỗ trợ → hỏi Trợ lý thống kê rồi bấm **Bảng** trên thẻ biểu đồ để xem số, hoặc gửi Góp ý xin thêm.\n- Không thấy tệp → xem thư mục Tải xuống (Downloads) của máy.\n**Lưu ý:**\n- Nút **In PDF** / **Xuất PDF** mở hộp in của trình duyệt: chọn \"Save as PDF\" / \"Lưu dưới dạng PDF\" để lưu tệp.",
  "source": "docs"
 },
 {
  "id": "so-tay-cong-viec-cap-nhat-tien-do",
  "title": "Cập nhật việc: Đang làm, Vướng, Xong, tiến độ",
  "module": "Công việc",
  "routes": [
   {
    "route": "/work/my",
    "label": "Công việc của tôi"
   }
  ],
  "permission": "Vioo Work · Truy cập Vioo Work",
  "keywords": "cap nhat cong viec tien do da lam dang lam se lam vuong bao vuong xong hoan thanh nop duyet nop ket qua nhan viec phan tram viet giup chuyen viec huy cong viec qua han vioo work cap nhat viec: dang lam, vuong, xong, tien do",
  "questions": "cap nhat tien do cong viec · bao vuong cong viec · nop ket qua viec giao · nhan viec · viec qua han · chuyen viec nguoi khac · huy cong viec da giao",
  "body": "**Khi nào:** báo tình hình việc bạn đang làm.\n**Các bước:**\n1. **Vioo Work** → **Công việc của tôi**; việc chia nhóm **Quá hạn**, **Hôm nay**, **Tuần này**, **Sau tuần này**.\n2. Trên dòng việc bấm **Đang làm** (tự nhận việc), **Vướng** (ghi vướng gì → **Báo vướng**) hoặc **Xong** (ghi kết quả → **Hoàn thành** hoặc **Nộp duyệt**).\n3. Cập nhật chi tiết: bấm tên việc → khung **Cập nhật tiến độ**: ghi **Đã làm**, **Đang làm**, **Sẽ làm**, **Vướng**, chọn %, gắn **Ảnh / tệp** → **Gửi cập nhật**.\n4. Ghi chú lộn xộn: bấm **Viết giúp** → **Chia giúp** để AI chia vào 4 ô.\n**Không làm được?**\n- Nút **Báo vướng** / **Hoàn thành** mờ → ghi ít nhất 3 ký tự.\n- Báo \"Ghi ít nhất một dòng Đã làm, Đang làm, Sẽ làm hoặc Vướng.\" → điền ít nhất một ô.\n- Dòng việc không có nút mà ghi **Chờ duyệt** hoặc **Chờ … xác nhận** → đang chờ người giao.\n- Việc cần nộp tệp → bấm **Nộp kèm tệp ở chi tiết**, tải tệp ở mục Đính kèm trước khi nộp.\n**Lưu ý:**\n- Trong chi tiết việc còn **Chuyển việc**, **Đề nghị làm rõ**, **Hủy công việc** (hiện theo quyền).\n- Việc chưa nhận hiện nhãn **Chưa nhận việc**.",
  "source": "docs"
 },
 {
  "id": "so-tay-cong-viec-chot-ky",
  "title": "Chốt kỳ công việc và xem báo cáo phòng",
  "module": "Công việc",
  "routes": [
   {
    "route": "/work/my?space=team",
    "label": "Phòng tôi"
   },
   {
    "route": "/work/my?space=company",
    "label": "Toàn công ty"
   }
  ],
  "permission": "Trưởng đơn vị trên sơ đồ tổ chức; toàn công ty cần Công việc · Xem theo phạm vi",
  "keywords": "chot ky cong viec bao cao phong bao cao tuan bao cao thang muc tieu danh gia giai phap dung han qua han mo lai ky lich chot phong toi toan cong ty truong phong bld vioo work chot ky cong viec va xem bao cao phong",
  "questions": "chot ky cong viec · chot tuan phong · bao cao cong viec phong · thay phong · mo ky da chot · doi lich chot ky · chot ky",
  "body": "**Khi nào:** cuối tuần / tháng, trưởng phòng chốt số liệu kỳ và báo cáo lên BLĐ.\n**Các bước:**\n1. **Vioo Work** → **Công việc của tôi** → nút **Phòng tôi** (BLĐ: **Toàn công ty**).\n2. Thanh kỳ ghi **Kỳ đang mở** và hạn chốt; bấm **Báo cáo** để xem số tạm tính.\n3. Bấm **Chốt kỳ**: xem Đúng hạn / Quá hạn, nhập **Thực tế** từng mục tiêu, **Đánh giá**, **Giải pháp**.\n4. Có AI: bấm **AI soạn nháp đánh giá** rồi sửa lại.\n5. Ghi **Nhận xét kỳ** (không bắt buộc) → bấm **Chốt kỳ**.\n**Không làm được?**\n- Không thấy **Phòng tôi** → bạn chưa là trưởng đơn vị trên sơ đồ tổ chức → nhờ HR cập nhật.\n- Không có nút **Chốt kỳ** → chỉ trưởng đơn vị (hoặc đơn vị cha) và BLĐ chốt được.\n- Báo \"Còn N mục tiêu chưa đạt cần ghi Giải pháp.\" → ghi ô **Giải pháp** cho các mục tiêu đó.\n- Báo \"Số thực tế phải là số…\" → nhập số, VD 5 hoặc 1.250,5.\n**Lưu ý:**\n- Kỳ đã chốt giữ số cố định; cần sửa: **Xem bản chốt** → **Mở lại kỳ** kèm lý do (BLĐ thấy).\n- Biểu tượng **Lịch chốt** để xem lịch chốt kỳ.",
  "source": "docs"
 },
 {
  "id": "so-tay-dat-xe",
  "title": "Đặt xe công ty",
  "module": "Đặt xe",
  "routes": [
   {
    "route": "/booking/vehicle",
    "label": "Tạo đơn đặt xe"
   },
   {
    "route": "/booking/vehicle/my",
    "label": "Yêu cầu của tôi"
   }
  ],
  "permission": "Đặt xe công ty · Tạo yêu cầu đặt xe",
  "keywords": "dat xe xe cong ty di cong tac dang ky xe tai xe tu lai khu hoi mot chieu nhieu diem dung cong tac nhieu ngay nop don dat xe nguoi di cung diem don diem den dat xe cong ty",
  "questions": "dat xe cong ty · dang ky xe di cong · dat xe tu lai · dat xe di nhieu diem · don dat xe gui ai duyet · bao chua quan ly truc tiep khi dat xe · dat xe ca nhom di cung",
  "body": "**Khi nào:** đi công tác, đi công trường, đón khách cần xe công ty.\n**Các bước:**\n1. Gõ \"đặt xe\" ở ô Tìm kiếm, hoặc **Đặt xe** → **Tạo đơn đặt xe**.\n2. Chọn **Thời gian đi dự kiến**, **Thời gian về dự kiến**, **Loại hình chuyến đi** (khứ hồi, một chiều, nhiều điểm dừng, nhiều ngày), **Hình thức phục vụ mong muốn**.\n3. Ghi **Điểm đón ban đầu**, **Điểm đến chính**, **Mục đích chuyến đi**, **Số người di chuyển**; xe / tài xế nguyện vọng nếu muốn; **Danh sách người đi cùng** mỗi người một dòng.\n4. Bấm **Nộp Đơn Đặt Xe** → quản lý trực tiếp duyệt → Điều phối xếp xe.\n5. Xem xe, tài xế được xếp ở **Yêu cầu của tôi**.\n**Không làm được?**\n- Báo \"Thời gian về phải sau thời gian xuất phát!\" → sửa giờ về.\n- Hộp \"Chưa có quản lý trực tiếp\" → bấm **Vẫn gửi** thì đơn chuyển thẳng Điều phối; nhờ HR đặt quản lý trực tiếp.\n- Ô **Điểm đón ban đầu** có sẵn một địa chỉ mặc định → xóa và ghi đúng điểm đón.\n**Lưu ý:**\n- **Tự lái** chỉ dành cho nhân viên đã được ủy quyền bằng lái.",
  "source": "docs"
 },
 {
  "id": "so-tay-dat-xe-dieu-phoi",
  "title": "Xếp xe, tài xế cho đơn đặt xe (Điều phối)",
  "module": "Đặt xe",
  "routes": [
   {
    "route": "/booking/vehicle/dispatch",
    "label": "Bảng điều phối"
   },
   {
    "route": "/booking/vehicle/handover",
    "label": "Bàn giao xe tự lái"
   }
  ],
  "permission": "Đặt xe công ty · Điều phối & duyệt thay",
  "keywords": "xep xe dieu phoi xe bang dieu phoi chon tai xe thue xe ngoai taxi xe tu lai duyet thay xep lai xe ban giao chia khoa nhan lai chia khoa doi xe phan xe xep xe gan xe phan tai xe gan tai xe chon xe cho chuyen xep xe, tai xe cho don dat xe (dieu phoi)",
  "questions": "xep xe don dat xe · dieu phoi xe · thue taxi ngoai don xe · bao xe san sang · duyet thay don dat xe · ban giao chia khoa xe tu lai · doi xe da xep",
  "body": "**Khi nào:** đơn đã duyệt, cần xếp xe và người lái.\n**Các bước:**\n1. **Đặt xe** → **Bảng điều phối** → tab **Bàn Điều Phối Kéo-Thả**; danh sách **Yêu Cầu Chờ Điều Phối**.\n2. Bấm **Xếp Xe** trên đơn (đơn cần xếp lại thì là **Xếp Lại Xe**).\n3. Chọn **Phương thức xếp chuyến**: Xe nội bộ + Tài xế chuyên trách / Xe nội bộ + Nhân viên tự lái / Thuê xe ngoài / Taxi công nghệ.\n4. Chọn xe, tài xế (hoặc người tự lái và người bàn giao xe); xe ngoài thì ghi loại dịch vụ, nhà cung cấp.\n5. Bấm **Xác Nhận Điều Phối Đơn Đặt Xe**.\n**Không làm được?**\n- Báo xe / tài xế \"không sẵn sàng trong toàn bộ khung giờ chuyến\" → trùng chuyến khác (đã tính thời gian đệm) → chọn xe / người khác.\n- Nút **Duyệt Thay & Điều Phối** mờ → cấu hình không cho duyệt thay → chờ quản lý duyệt.\n**Lưu ý:**\n- Tab **Lịch Gantt Đội Xe** để xem lịch từng xe.\n- Xe tự lái: người bàn giao vào **Bàn giao xe tự lái** → **Xác Nhận Giao Chìa Khóa** / **Xác Nhận Nhận Lại Chìa** → **Xác Nhận Hoàn Tất**.",
  "source": "docs"
 },
 {
  "id": "so-tay-dat-xe-duyet",
  "title": "Duyệt đơn đặt xe của nhân viên",
  "module": "Đặt xe",
  "routes": [
   {
    "route": "/booking/vehicle/approvals",
    "label": "Chờ phê duyệt"
   }
  ],
  "permission": "Quản lý trực tiếp của người đặt; hoặc Đặt xe công ty · Duyệt yêu cầu cấp dưới",
  "keywords": "duyet dat xe phe duyet don xe cap duoi quan ly truc tiep tu choi don dat xe chuyen nguoi duyet cho phe duyet duyet don dat xe cua nhan vien",
  "questions": "duyet don dat xe · phe duyet dat xe · choi don dat xe · chuyen nguoi duyet dat xe · thay muc cho phe duyet · don xe nhan vien",
  "body": "**Khi nào:** nhân viên do bạn quản lý trực tiếp gửi đơn đặt xe.\n**Các bước:**\n1. **Đặt xe** → **Chờ phê duyệt**.\n2. Xem người đặt, giờ, lộ trình, số người, xe nguyện vọng.\n3. Bấm **Phê Duyệt** → đơn sang **Bảng điều phối** để xếp xe.\n4. Không đồng ý: **Từ Chối**, ghi lý do → **Xác Nhận Từ Chối**.\n5. Người khác nên duyệt: **Chuyển người duyệt**, chọn người mới, ghi lý do → **Xác nhận chuyển**.\n**Không làm được?**\n- Không thấy mục **Chờ phê duyệt** → bạn không là quản lý trực tiếp của ai và chưa có quyền \"Đặt xe công ty · Duyệt yêu cầu cấp dưới\".\n- Báo \"Vui lòng nhập lý do từ chối!\" → ghi lý do.\n- Báo \"Vui lòng chọn người duyệt mới và nhập lý do.\" → chọn người và ghi lý do.\n**Lưu ý:**\n- Khi bạn vắng, Điều phối có thể **Duyệt Thay & Điều Phối** nếu công ty bật cấu hình này.",
  "source": "docs"
 },
 {
  "id": "so-tay-dat-xe-huy-danh-gia",
  "title": "Hủy đơn đặt xe, theo dõi và đánh giá chuyến",
  "module": "Đặt xe",
  "routes": [
   {
    "route": "/booking/vehicle/my",
    "label": "Yêu cầu của tôi"
   }
  ],
  "permission": "Đặt xe công ty · Xem yêu cầu cá nhân",
  "keywords": "huy dat xe huy don xe doi ke hoach theo doi don dat xe da duyet chua da xep xe tai xe bien so danh gia chuyen xe xac nhan hoan tat xe ngoai taxi huy don dat xe, theo doi va danh gia chuyen",
  "questions": "huy don dat xe · huy xe da dat · don dat xe da duyet chua · xe tai xe don · danh gia chuyen xe · huy don xe · di taxi xong xac nhan",
  "body": "**Khi nào:** đổi kế hoạch, muốn biết đơn tới đâu, hoặc chuyến đã xong.\n**Các bước:**\n1. **Đặt xe** → **Yêu cầu của tôi**; trạng thái: **Chờ duyệt**, **Chờ xếp xe**, **Đã xếp xe**, **Đang chạy**, **Hoàn thành**, **Đã hủy**.\n2. Bấm đơn để xem **Thông tin xe & tài xế đã xếp**.\n3. Hủy: **Hủy đơn** → chọn **Lý do hủy**, ghi chú → **Xác Nhận Hủy**.\n4. Chuyến xong: **Xác nhận & đánh giá chuyến xe**; xe ngoài / taxi thì **Xác nhận hoàn tất chuyến xe ngoài**.\n**Không làm được?**\n- Không có nút **Hủy đơn** → xe đang chạy hoặc chuyến đã xong / đã hủy; chỉ hủy được trước khi xe chạy.\n- Đơn **Đã hủy** mà vẫn cần xe → tạo đơn mới.\n**Lưu ý:**\n- Hủy sát giờ thì chọn lý do \"Hủy sát giờ do sự cố đột xuất\" để Điều phối nắm.",
  "source": "docs"
 },
 {
  "id": "so-tay-dat-xe-tai-xe-chuyen",
  "title": "Tài xế nhận chuyến, bắt đầu và kết thúc chuyến",
  "module": "Đặt xe",
  "routes": [
   {
    "route": "/booking/vehicle/trips",
    "label": "Chuyến của tôi"
   }
  ],
  "permission": "Đặt xe công ty · Thực hiện chuyến đi",
  "keywords": "tai xe chuyen cua toi nhan chuyen tu choi chuyen bat dau chuyen ket thuc chuyen so km dong ho anh dong ho gps don khach su co xe xuoc hong tinh trang xe tai xe nhan chuyen, bat dau va ket thuc chuyen",
  "questions": "tai xe nhan chuyen · bat dau chuyen xe · ket thuc chuyen nhap km · lay gps khi bat dau chuyen · choi chuyen giao · bao xe hong sau chuyen · bat buoc chup dong ho km",
  "body": "**Khi nào:** bạn là tài xế (hoặc người tự lái) được xếp chuyến.\n**Các bước:**\n1. **Đặt xe** → **Chuyến của tôi** (chuyến hôm nay và chuyến đang chạy).\n2. Chuyến mới: **Xác Nhận Nhận Chuyến**, hoặc **Từ Chối** kèm lý do để Điều phối xếp người khác.\n3. Xuất phát: **Bắt Đầu Chuyến Đi** → nhập số km đồng hồ, **Chụp / Chọn Ảnh Đồng Hồ**, **Lấy Vị Trí GPS** → **Xác Nhận Thao Tác Chuyến**.\n4. Đón được khách: **Xác nhận đã đón khách**.\n5. Về: **Kết Thúc Chuyến** → km cuối, ảnh đồng hồ, GPS, **Tình trạng xe sau chuyến** (có sự cố thì mô tả) → xác nhận.\n**Không làm được?**\n- Báo \"Ảnh đồng hồ kilomet là bằng chứng bắt buộc.\" → chụp ảnh đồng hồ.\n- Không lấy được GPS → chọn **Xác nhận không lấy được GPS và tiếp tục chuyến**, ghi lý do.\n- Không thấy chuyến → chuyến chưa xếp cho bạn, hoặc không phải chuyến hôm nay.\n**Lưu ý:**\n- Chuyến quá giờ dự kiến hiện nhãn **Quá thời gian dự kiến**.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-nghi-chi",
  "title": "Lập đề nghị chi trả nhà cung cấp",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   },
   {
    "route": "/finance/requests",
    "label": "Đề nghị chi"
   }
  ],
  "permission": "Tài chính · Ghi nhận",
  "keywords": "de nghi chi dntt de nghi thanh toan tra tien ncc thanh toan nha cung cap lap de nghi chi tra no ncc chi tien ncc tra mot phan cong no ma tran duyet chi lap de nghi chi tra nha cung cap",
  "questions": "lap de nghi chi tra tien ncc · lap de nghi thanh toan nha cung cap · thay nut lap de nghi chi · tra cong no ncc · de nghi chi bam gui duyet · dntt ncc dau",
  "body": "**Khi nào:** cần trả tiền NCC theo chứng từ công nợ.\n**Các bước:**\n1. Tài chính → **Phải trả** → bước **Đang nợ**; gõ tên NCC ở ô \"Tìm NCC, dự án…\" rồi bấm vào NCC.\n2. Bấm **Lập đề nghị chi** (cuối khung chi tiết NCC).\n3. Tích chứng từ cần trả (quá hạn / đến hạn 7 ngày được tích sẵn); sửa ô **Chi lần này** nếu trả một phần.\n4. Chọn **Hình thức**, **Ngày dự kiến chi**, ghi chú cho người duyệt; xem **Luồng duyệt** ai duyệt.\n5. Bấm **Gửi duyệt** → theo dõi ở bước **Đề nghị chi**.\n**Không làm được?**\n- Không thấy nút → thiếu quyền Ghi nhận, NCC hết chứng từ nợ, hoặc là đơn vị nội bộ (không chi).\n- \"NCC chưa có số tài khoản\" → chọn Tiền mặt hoặc nhờ Mua hàng khai ở hồ sơ đối tác.\n- Bước \"… không còn người duyệt hợp lệ\" → người lập / người nhận hàng không được duyệt; nhờ Quản trị Tài chính thêm người hoặc ủy quyền.\n- Chứng từ mờ, không tích được → tiền giữ lại bảo hành chưa đến hạn, hoặc số đã nằm trong đề nghị khác.\n- \"Hợp đồng NCC bắt buộc có hóa đơn trước khi chi\" → ghi hóa đơn NCC trước.\n**Lưu ý:**\n- Đề nghị cùng NCC trong 7 ngày cộng dồn để xét ngưỡng duyệt. Tạm ứng: nút **Lập tạm ứng**; lương, thuế…: **Phiếu chi khác**.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-xuat-ket-thuc",
  "title": "Kết thúc đề xuất khi thôi mua phần còn thiếu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   },
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Chỉ huy trưởng (Đề xuất vật tư · Duyệt) hoặc người lập; Mua hàng · Quản trị (Đóng nhu cầu)",
  "keywords": "ket thuc de xuat, dong de xuat, khong can mua nua da mua ngoai dong nhu cau de xuat treo de xuat ton dong dong phan con thieu mo lai nhu cau ket thuc de xuat khi thoi mua phan con thieu",
  "questions": "de xuat nua dong · ket thuc de xuat vat tu · da mua ngoai de xuat con treo · de xuat tu hoan tat · mo de xuat da ket thuc · dong cau ben mua hang",
  "body": "**Khi nào:** đề xuất đã duyệt nhưng phần còn thiếu không cần mua nữa (đã mua ngoài, thay bằng đề xuất khác, lệch quy đổi…).\n**Các bước:**\n1. Mở đề xuất ở Dự án → **Vật tư** → **Yêu cầu**, xuống khung **Tiến độ cung ứng**.\n2. Bấm **Kết thúc đề xuất**, chọn nhanh lý do (VD \"Đã mua ngoài hệ thống\") hoặc gõ lý do.\n3. Bấm **Kết thúc đề xuất** để xác nhận: dòng còn thiếu rời Cần mua của Mua hàng; hàng đã nhận giữ nguyên.\n4. Nhiều phiếu treo: tab Yêu cầu bấm **Xem N phiếu cần quyết** (đã duyệt nhưng chưa có PO / phiếu chuyển) → tick → **Kết thúc … đã chọn**.\n**Không làm được?**\n- Báo \"Chỉ chỉ huy trưởng (quyền Duyệt đề xuất) hoặc người lập phiếu được kết thúc đề xuất\" → nhờ CHT hoặc người lập.\n- Không thấy nút → đề xuất không ở bước **Đang cung ứng** (chưa duyệt xong, hoặc đã Hoàn tất).\n**Lưu ý:**\n- Mua hàng cũng đóng được: phiếu ở **Cần mua** → **Đóng nhu cầu** (đề xuất chuyển Kết thúc); **Mở lại nhu cầu** để mua tiếp.\n- PO đang chờ hàng vẫn giao bình thường; hàng về thành tồn kho công trường.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-xuat-ma-vat-tu-moi",
  "title": "Không có mã vật tư → đề xuất mã mới",
  "module": "Kho",
  "routes": [
   {
    "route": "/material-code-requests",
    "label": "Danh mục vật tư"
   }
  ],
  "permission": "Đề xuất mã mới (Phân quyền kho); người Cấp mã xử lý",
  "keywords": "de xuat ma moi cap ma vat tu chua co ma khong tim thay ma vat tu tao ma moi sku ma kho danh muc vat tu them vat tu moi chua co ma kho khong co ma vat tu → de xuat ma moi",
  "questions": "tim thay ma vat tu · vat tu chua ma · cap ma vat tu · tao ma vat tu · thay nut de xuat ma · de xuat ma gui bao gio ma · chua ma kho",
  "body": "**Khi nào:** lập đề xuất / đơn hàng mà vật tư chưa có trong danh mục.\n**Các bước:**\n1. Kho vật tư → **Danh mục vật tư** (hoặc gõ \"đề xuất mã vật tư mới\" ở ô Tìm kiếm).\n2. Gõ tên vào ô tìm trước — có thể mã đã có dưới tên khác.\n3. Bấm **Đề xuất mã mới**: ghi **Tên vật tư**, **Đơn vị tính**, **Quy cách (nếu có)**, **Dùng cho việc gì**.\n4. Xem khung \"Có thể đã có\"; nếu báo đã có mã trùng tên thì dùng mã đó.\n5. **Gửi đề xuất** → người Cấp mã thấy ngay ở ô **Đề xuất chờ cấp mã**, trả lời bằng **Cấp mã** hoặc **Dùng mã này**.\n**Không làm được?**\n- **Gửi đề xuất** mờ → thiếu tên / đơn vị, hoặc đã có mã trùng tên.\n- Không thấy nút **Đề xuất mã mới** → chưa được giao việc \"Đề xuất mã mới\" → nhờ Admin tick ở Phân quyền kho.\n- Thấy nút **Tạo mã mới** thay vì đề xuất → bạn có quyền Tạo mã vật tư: tạo luôn, không cần chờ.\n**Lưu ý:**\n- Chỉ khác thương hiệu / màu / xuất xứ → không cần mã mới, ghi ở ô Quy cách.\n- Có mã rồi thì quay lại thêm dòng vào đề xuất / đơn.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-xuat-sua-gui-lai",
  "title": "Đề xuất bị trả lại, cần sửa, rút lại hoặc xóa",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Người lập đề xuất (Đề xuất vật tư · Sửa của mình, Xóa của mình)",
  "keywords": "sua de xuat rut lai de xuat thu hoi de xuat bi tra lai gui lai xoa de xuat huy de xuat sua phieu de xuat vat tu da gui bi tu choi de xuat bi tra lai, can sua, rut lai hoac xoa",
  "questions": "de xuat gui sua · rut de xuat vat tu · de xuat tra · thay nut sua de xuat · xoa de xuat vat tu · de xuat tu choi · gui nham de xuat huy",
  "body": "**Khi nào:** đề xuất đã gửi cần sửa số lượng, thêm bớt dòng, hoặc gửi nhầm.\n**Các bước:**\n1. Đề xuất đang chờ duyệt thì người lập không tự sửa / rút lại được: nhắn người đang duyệt (tên ở khung **Thao tác workflow**) bấm **Trả lại** kèm lý do.\n2. Bị trả lại, phiếu về bước **Sửa phiếu**: mở phiếu, sửa dòng vật tư, bấm **Lưu nháp**.\n3. Bấm **Gửi lại** ở khung Thao tác workflow → phiếu chạy lại luồng duyệt.\n4. Phiếu nháp chưa gửi: sửa rồi bấm **Gửi duyệt**.\n5. Bỏ hẳn phiếu nháp hoặc bị từ chối: **Xoá phiếu**.\n**Không làm được?**\n- Không thấy nút sửa → phiếu đang chờ duyệt / đã duyệt, hoặc bạn không phải người lập → làm như bước 1.\n- Báo \"Không thể xoá phiếu\" → phiếu đã có đợt cấp, PO hoặc phiếu kho liên quan; phiếu đang chờ duyệt chỉ Admin xóa được.\n- Phiếu đã duyệt mà không cần mua nữa → dùng **Kết thúc đề xuất** ở khung Tiến độ cung ứng.\n**Lưu ý:**\n- Bị **Từ chối** là dừng hẳn: lập đề xuất mới.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-xuat-theo-doi-tien-do",
  "title": "Theo dõi đề xuất: ai đang duyệt, đã về bao nhiêu",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Đề xuất vật tư · Xem (theo dự án)",
  "keywords": "theo doi de xuat vat tu tien do cung ung da ve con thieu bao nhieu dang duyet ai duyet trang thai de xuat hang ve chua da dat po chua kanban de xuat theo doi de xuat: ai dang duyet, da ve bao nhieu",
  "questions": "de xuat dang buoc · de xuat vat tu da duyet chua · ai dang giu de xuat · vat tu de xuat ve bao nhieu con thieu bao nhieu · de xuat da dat po chua · de xuat mai thay hang ve · de xuat hoan tat khi",
  "body": "**Khi nào:** muốn biết đề xuất đang chờ ai duyệt, đã đặt đơn chưa, hàng về đến đâu.\n**Các bước:**\n1. Dự án → mở dự án → **Vật tư** → **Yêu cầu**; xem dạng **Danh sách** hoặc **Kanban** (mỗi cột một bước duyệt).\n2. Bấm vào phiếu. Chưa duyệt xong: khung **Thao tác workflow** ghi bước hiện tại và tên người đang được giao xử lý.\n3. Đã duyệt: khung **Tiến độ cung ứng** liệt kê từng dòng: Cần · Nguồn cung (số PO hoặc phiếu chuyển kho) · Đã nhận · Còn thiếu · Trạng thái (**Chờ hàng**, **Chưa có nguồn**, **Đã nhận**, **Đã đóng**).\n4. Dòng tính đủ khi nhận ≥ 98% số cần; mọi dòng đủ thì đề xuất tự **Hoàn tất**.\n**Không làm được?**\n- Dòng ghi \"Chưa có — Mua hàng chọn Mua mới hoặc Cấp từ kho\" → Mua hàng chưa lập đơn / phiếu chuyển → nhắc người mua của phiếu.\n- Không thấy khung Tiến độ cung ứng → phiếu chưa duyệt xong.\n- Báo \"Chưa có quyền xem Yêu cầu vật tư\" → cần quyền Xem trong Room Yêu cầu của đúng dự án / công trường.\n**Lưu ý:**\n- Xem đơn hàng của dự án: nút **Đơn hàng** trên tab Vật tư (mở Mua hàng).\n- Không cần mua phần còn thiếu nữa: dùng **Kết thúc đề xuất**.",
  "source": "docs"
 },
 {
  "id": "so-tay-de-xuat-vat-tu",
  "title": "Lập đề xuất vật tư cho công trường",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Đề xuất vật tư · Tạo, Gửi (Room Yêu cầu của dự án)",
  "keywords": "de xuat vat tu yeu cau vat tu dxvt mr lap de xuat tao de xuat xin vat tu cong truong go nhanh chup phieu viet tay nhap excel de xuat theo boq lap de xuat vat tu cho cong truong",
  "questions": "lap de xuat vat tu · tao de xuat vat tu · cong truong vat tu · de xuat thep du an smb · lap de xuat vat tu ko · nhap de xuat vat tu excel · chup phieu de xuat viet tay doc",
  "body": "**Khi nào:** công trường cần vật tư (lấy từ kho hoặc để Mua hàng mua).\n**Các bước:**\n1. Gõ \"lập đề xuất vật tư\" ở ô Tìm kiếm → chọn dự án (hoặc Dự án → mở dự án → **Vật tư** → **Yêu cầu**) → **Tạo đề xuất**.\n2. Ghi **Tên đề xuất vật tư**, chọn **Kho nhận hàng**, **Hạn giao mong muốn (Ngày cần)**.\n3. Thêm dòng: tick ở **Thêm vật tư theo BOQ triển khai**, **Thêm vật tư ngoài BOQ**, hoặc **Gõ nhanh** (gõ / dán \"tên, số lượng, đơn vị\", hệ thống khớp mã; **Chụp phiếu** để AI đọc phiếu viết tay nếu đã bật AI).\n4. Kiểm số lượng, quy cách; dòng ngoài BOQ / vượt định mức phải ghi lý do.\n5. Bấm **Tạo và gửi duyệt** (chọn người duyệt) hoặc **Lưu nháp** để gửi sau.\n**Không làm được?**\n- Thấy \"Tài khoản chỉ đang có quyền xem\" → thiếu quyền tạo / gửi đề xuất của dự án → nhờ quản trị dự án cấp.\n- Báo \"Dòng chưa có mã kho\" / Gõ nhanh ghi \"Chưa có mã\" → gửi **Đề xuất mã mới** ở Danh mục vật tư.\n- Báo \"Thiếu quy cách\" → một mã có nhiều dòng → ghi quy cách khác nhau cho từng dòng.\n**Lưu ý:**\n- Nhiều dòng: tab Yêu cầu có **Nhập từ Excel** (và **Tải mẫu Excel**).\n- Nhờ Trợ lý \"đề xuất 100 kg thép D16 cho SMB\" → form điền sẵn, vẫn phải bấm gửi.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-chi-phi-du-an",
  "title": "Xem tài chính, chi phí của dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Tài chính · Xem Tài chính toàn công ty, hoặc được bật \"Ai được xem Tài chính & Hợp đồng\" của dự án",
  "keywords": "chi phi du an tai chinh du an xem chi phi cong trinh thu chi du an cong no du an quy du an san luong tru chi phi cdt da tra phai tra ncc dong tien du an xem tai chinh, chi phi cua du an",
  "questions": "chi phi du an · thay the tai chinh du an · du an da chi bao nhieu tien · tab tai chinh du an · ai tai chinh cong trinh · dong tien du an",
  "body": "**Khi nào:** CHT / GĐ dự án muốn xem nhanh tiền về, chi phí, công nợ của một dự án.\n**Các bước:**\n1. Mở dự án → tab **Điều hành**: thẻ **Tài chính dự án** ở trên cùng.\n2. Xem các ô: CĐT đã trả, Phải thu đang mở, **Chi phí đã ghi nhận**, Sản lượng − chi phí, Còn phải trả (NCC, thầu phụ), Quỹ dự án.\n3. Bấm một ô (hoặc **Mở ở Tài chính**) để sang module Tài chính, đúng phần chi tiết của dự án.\n4. Thu, chi, công nợ, ngân sách đều ghi ở module **Tài chính**; ở Dự án chỉ xem.\n**Không làm được?**\n- Không thấy thẻ Tài chính dự án → chưa được xem tài chính dự án này → Admin bật cho bạn ở tab **Phân quyền** → **Ai được xem Tài chính & Hợp đồng**.\n- Link cũ tab Tài chính / Dòng tiền / Thanh toán của dự án tự chuyển sang module Tài chính — đúng thiết kế.\n- Tab Điều hành báo \"cần liên kết công trường HRM\" → dự án chưa gắn công trường → người quản trị dự án bấm **Sửa** để chọn Công trường.\n**Lưu ý:**\n- Tab **Hợp đồng** của dự án cũng cần công tắc xem Tài chính & Hợp đồng.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-da-du-an",
  "title": "Xem việc cần xử lý của nhiều dự án (Đa dự án)",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da/portfolio",
    "label": "Đa dự án"
   }
  ],
  "permission": "Dự án · Xem",
  "keywords": "da du an portfolio nhieu du an tong hop du an viec can xu ly ngay du an can can thiep thieu vat tu po giao tre xuat dataset quan tri lanh dao nhieu du an cung luc tat ca du an tong hop cac du an xem viec can xu ly cua nhieu du an (da du an)",
  "questions": "tong hop nhieu du an · man da du an dung · du an can thiep · xuat danh sach viec xu ly · da du an bao chua quyen",
  "body": "**Khi nào:** lãnh đạo / quản lý muốn xem các việc cần quyết định trên mọi dự án mình được xem.\n**Các bước:**\n1. Thanh bên → **Dự án** → **Đa dự án** (màn có tiêu đề \"Trung tâm điều hành\").\n2. Chọn góc nhìn: **Lãnh đạo**, **Dự án** (thiếu vật tư), **Mua hàng** (PO mở, giao trễ), **Kho**, **Tài chính**.\n3. Lọc theo dự án, mức độ (**Cần xử lý ngay** / **Cần theo dõi** / **Thông tin**) hoặc gõ tìm.\n4. Ở từng dòng bấm **Mở nguồn** để tới hồ sơ gốc; **Xuất đúng bộ lọc** để tải file.\n**Không làm được?**\n- \"Bạn chưa có quyền xem phạm vi này\" → chọn dự án bạn được phân quyền.\n- **Xuất đúng bộ lọc** mờ → chưa có quyền xuất trong phạm vi này.\n- Ô **Chưa đủ nguồn** > 0 → có dòng thiếu dữ liệu nguồn (không phải số 0) → xem dòng đó.\n**Lưu ý:**\n- Số liệu chốt theo thời điểm ghi ở đầu trang; bấm **Làm mới** để lấy số mới. Màn này khác giao diện Trung tâm điều hành ở thanh bên.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-dieu-chinh-tien-do",
  "title": "Xin điều chỉnh tiến độ (đổi ngày, khối lượng)",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Tiến độ Gantt · Sửa (Room Tiến độ Gantt: Lập điều chỉnh, sửa việc)",
  "keywords": "dieu chinh tien do doi ngay ke hoach gantt dieu chinh ke hoach doi ngay ket thuc doi khoi luong them viec xoa viec gia han hop dong ve dich lap lai ke hoach viec qua han lui ngay doi ngay ke hoach gia han lui han hang muc keo dai thoi gian xin dieu chinh tien do (doi ngay, khoi luong)",
  "questions": "doi ngay ke hoach gantt · keo thanh gantt · dieu chinh tien do · them viec vao tien do phai duyet · viec qua han lap ke hoach · gia han hop dong sua tien do",
  "body": "**Khi nào:** kế hoạch không còn đúng thực tế; ngày, khối lượng, thêm / xóa việc phải qua phiếu duyệt.\n**Các bước:**\n1. Mở dự án → **Tiến độ** → bấm **Điều chỉnh tiến độ** (hoặc **Lập lại** ở dải \"N việc chưa xong đã quá ngày kế hoạch\").\n2. Trong bản nháp: kéo thanh hoặc sửa ngày, khối lượng; **Thêm việc vào nháp**; nhập Excel cũng vào nháp. Nháp tự lưu.\n3. Bấm **Gửi duyệt**: chọn **Lý do chính**, **Bên chịu trách nhiệm**, **Diễn giải** (≥ 10 ký tự), đính kèm chứng từ khi cần → **Gửi duyệt**.\n4. Theo dõi ở dải trạng thái: bị trả lại → **Sửa lại**; đang chờ mà cần sửa → **Rút lại để sửa**.\n**Không làm được?**\n- Không có nút → thiếu quyền \"Lập điều chỉnh, sửa việc\" trong Room Tiến độ Gantt.\n- Nút mờ \"Đang có phiếu … mở\" → mỗi lúc chỉ một phiếu.\n- \"Không sửa lùi…\" → việc đã làm giữ ngày bắt đầu, việc đã xong không đổi ngày, ngày kết thúc mới không trước hôm nay.\n- \"Cần đính kèm chứng từ\" → bên CĐT, lý do cần văn bản hoặc gia hạn HĐ.\n- \"Dự án chưa có người giữ quyền Duyệt điều chỉnh\" → nhờ Admin gán.\n**Lưu ý:**\n- Đổi tên, người phụ trách, ghi chú lưu ngay. Dự án chưa bật duyệt thì người có quyền sửa đổi thẳng trên Gantt.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-duyet-dieu-chinh-tien-do",
  "title": "Duyệt phiếu điều chỉnh tiến độ",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Tiến độ Gantt · Duyệt điều chỉnh tiến độ (bước thêm: Duyệt dời ngày về đích)",
  "keywords": "duyet dieu chinh tien do cht duyet doi ngay duyet doi ve dich tra lai dieu chinh phien ban tien do cho ban duyet gantt phieu dieu chinh duyet phieu dieu chinh tien do",
  "questions": "duyet dieu chinh tien do · phieu dieu chinh tien do cho duyet · duyet phieu dieu chinh · doi ngay ve dich ai duyet · phien ban tien do cu",
  "body": "**Khi nào:** có phiếu điều chỉnh tiến độ gửi tới bạn (dải \"Chờ bạn duyệt\" ở tab Tiến độ).\n**Các bước:**\n1. Mở dự án → **Tiến độ** → ở dải trạng thái bấm **Xem và duyệt**.\n2. Xem số việc dời ngày / thêm / xóa / đổi khối lượng, **Về đích** trước → sau, lý do, chứng từ và danh sách thay đổi.\n3. Bấm **Duyệt** — Gantt đổi theo và lưu thành phiên bản mới; hoặc **Trả lại** kèm lý do.\n4. Phiếu đổi ngày về đích có thể sang bước thêm cho người giữ quyền Duyệt dời về đích → họ bấm **Duyệt dời về đích**.\n5. Xem các bản cũ: **Công cụ & Phân tích** → **Phiên bản tiến độ**.\n**Không làm được?**\n- Chỉ thấy **Xem phiếu**, không có nút Duyệt → bạn không trong danh sách người duyệt của phiếu.\n- \"Người lập không duyệt phiếu của chính mình\" → nhờ người duyệt khác.\n- \"Ghi lý do trả lại\" → nhập lý do (ít nhất 3 ký tự).\n**Lưu ý:**\n- Sau khi duyệt, KH tháng / tuần còn hiệu lực bị lệch sẽ được báo để người lập KH điều chỉnh hoặc giữ nguyên.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-duyet-nhat-ky",
  "title": "CHT duyệt và công bố nhật ký ngày",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Duyệt + Công bố tiến độ ngày",
  "keywords": "duyet nhat ky cht duyet nhat ky cong bo tien do duyet nhanh duyet lan luot nhieu ngay cho ban duyet tra ban tong hop tra phieu sua xac nhan nhat ky cht duyet va cong bo nhat ky ngay",
  "questions": "duyet nhat ky · duyet nhanh nhieu ngay nhat ky · nut duyet cong bo mo · cht tra nhat ky · cho duyet · duyet bao quyen cong bo tien do",
  "body": "**Khi nào:** người tổng hợp đã gửi bản ngày; CHT xem và chốt để % tiến độ cập nhật.\n**Các bước:**\n1. Mở dự án → **Nhật ký**: thẻ \"N nhật ký chờ bạn duyệt\" → **Duyệt lần lượt** (hoặc **Chờ bạn duyệt · N** → **Xem & duyệt**).\n2. Xem hạng mục, nhân công, máy, ảnh từng mũi.\n3. Mục **Việc chậm quá 3 ngày — ghi lý do**: chọn lý do cho mọi việc còn đỏ (có **Chọn nhanh lý do**).\n4. Đúng thì bấm **Duyệt & công bố** — % tiến độ và Gantt cập nhật, màn tự mở ngày chờ kế tiếp.\n5. Sai một phiếu → **Trả phiếu sửa** kèm lý do; sai cả bản → **Trả bản tổng hợp**.\n**Không làm được?**\n- Nút mờ \"Chọn lý do cho N việc chậm…\" → chọn đủ lý do chậm.\n- \"Có phiếu hoặc quyết định chưa hoàn thiện\" → trả đúng phiếu / bản tổng hợp để sửa.\n- \"Được gửi cho CHT khác duyệt\" → chỉ người được chọn ở ô CHT duyệt mới duyệt được.\n- \"Bạn cần cả quyền Duyệt và Công bố tiến độ\" → nhờ Admin cấp trong Room Nhật ký.\n- \"Kỳ tiến độ đang khóa\" → **Mở Tiến độ thực tế** → **Mở lại** tuần rồi duyệt.\n- \"Lũy kế trước ngày này đã đổi\" → trả phiếu cho kỹ sư cập nhật lũy kế.\n**Lưu ý:**\n- CHT vắng lâu: người duyệt dự phòng dùng **Duyệt thay**.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-duyet-thay-nhat-ky",
  "title": "Duyệt thay nhật ký khi CHT vắng",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Duyệt + Công bố tiến độ ngày (người duyệt dự phòng)",
  "keywords": "duyet thay nhat ky cht vang cht di cong tac nhat ky treo lau nhat ky cho duyet qua han nguoi duyet du phong nhan duyet thay duyet thay nhat ky khi cht vang",
  "questions": "cht di vang ai duyet nhat ky · duyet thay nhat ky · nhat ky treo may ngay chua ai duyet · bam duyet thay · nguoi duyet du phong cai",
  "body": "**Khi nào:** bản tổng hợp chờ CHT quá số ngày quy định (thẻ ghi \"treo quá N ngày\") và bạn là người duyệt dự phòng.\n**Các bước:**\n1. Mở dự án → **Nhật ký**: thẻ \"N nhật ký treo quá … ngày\" → **Xem để duyệt thay**.\n2. Ở dải vàng đầu phiếu bấm **Duyệt thay**, ghi lý do (vd \"Anh Sơn đi công tác\") → **Nhận duyệt thay**.\n3. Người được giao nhận thông báo kèm lý do. Bạn bấm **Duyệt & công bố** hoặc trả lại như CHT.\n4. Dùng mũi tên trước / sau ở dải vàng để sang ngày treo khác.\n**Không làm được?**\n- \"Bạn không nằm trong danh sách người duyệt dự phòng\" → Admin thêm bạn ở Cài đặt → Cảnh báo → Nhật ký chờ xác nhận quá lâu.\n- \"Phiếu chưa treo đủ lâu để duyệt thay\" → nhắc người được giao duyệt trước.\n- \"Bạn chưa có quyền Duyệt / Xác nhận…\" → cần quyền Duyệt và Công bố tiến độ trong Room Nhật ký của dự án đó.\n- \"Nhập lý do duyệt thay (ít nhất 3 ký tự)\" → ghi lý do rõ hơn.\n**Lưu ý:**\n- Dòng \"Ở dự án khác\" trên thẻ liệt kê phiếu chờ ở dự án khác — bấm để mở.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-ghi-bu-nhat-ky",
  "title": "Ghi bù nhật ký cho ngày đã qua",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Tạo + Gửi",
  "keywords": "ghi bu nhat ky quen ghi nhat ky ngay truoc nhat ky hom qua bo sung nhat ky thieu nhat ky ghi bu theo gantt ngay thieu nhat ky viec da xong chua du 100 ghi bu nhat ky cho ngay da qua",
  "questions": "quen ghi nhat ky hom qua · ghi bu nhat ky ngay truoc · ghi nhat ky ngay mai · ghi bu theo gantt · ngay con thieu nhat ky · viec xong nhat ky chua 100",
  "body": "**Khi nào:** có ngày thi công chưa có phiếu, hoặc việc đã xong thực tế mà nhật ký chưa ghi đủ 100%.\n**Các bước:**\n1. Mở dự án → **Nhật ký** → chuyển **Lịch tháng**, bấm vào ngày cần ghi → **Ghi phiếu** (hoặc **Ghi nhật ký chi tiết** rồi đổi **Ngày lập phiếu**).\n2. Chọn mũi thi công, thêm hạng mục, nhập số như ghi bình thường.\n3. Phiếu hiện dải \"Gantt ghi N việc đã xong thực tế…\" → bấm **Ghi bù theo Gantt (N)** để thêm các việc đó.\n4. Bấm **Gửi tổng hợp**; người tổng hợp và CHT xử lý ngày đó như thường.\n5. Xem ngày còn thiếu: tab **Tiến độ thực tế** → ô **Ngày thiếu nhật ký**.\n**Không làm được?**\n- Không có nút Ghi phiếu ở ngày tương lai → chỉ ghi từ hôm nay trở về trước.\n- \"Nhật ký WBS chưa được mở cho ngày và phạm vi này\" → ngày trước mốc áp dụng Nhật ký mới → không ghi theo mẫu mới.\n- \"Kỳ tiến độ đã khóa\" → tuần đó đã Xác nhận tuần → người có quyền bấm **Mở lại** ở Tiến độ thực tế trước.\n- \"Lũy kế vượt mốc đã xác nhận ở ngày sau\" → ngày sau đã duyệt số lớn hơn → kiểm lại lũy kế.\n**Lưu ý:**\n- Ngày trước được duyệt sau khi bạn lập phiếu thì lũy kế đổi; CHT sẽ trả phiếu để bạn cập nhật lại.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-ke-hoach-vat-tu",
  "title": "Lập kế hoạch vật tư tuần từ kế hoạch thi công",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Kế hoạch tháng/tuần · Lập/sửa kế hoạch + Gửi duyệt (CHT duyệt: Duyệt KH tuần)",
  "keywords": "ke hoach vat tu kh vat tu tuan nhu cau vat tu de nghi mua vat tu theo ke hoach sl de nghi vuot boq kho nhan can mua gui cht duyet vat tu lap ke hoach vat tu tuan tu ke hoach thi cong",
  "questions": "lap ke hoach vat tu tuan · ke hoach vat tu tinh · lap ke hoach vat tu · ke hoach vat tu duyet xong di · dong vuot boq phai · ke hoach vat tu thang gui mua hang",
  "body": "**Khi nào:** kế hoạch thi công tuần đã được duyệt, cần đề nghị vật tư cho tuần đó.\n**Các bước:**\n1. Mở dự án → **Kế hoạch** → chọn **Vật tư**, kỳ **Tuần**, đúng tuần.\n2. Bấm **Lập kế hoạch vật tư**: nhu cầu tính từ KH thi công đã duyệt theo vật tư BOQ; **SL đề nghị** gợi ý = nhu cầu − tồn kho công trường.\n3. Sửa **SL đề nghị**; dòng vượt BOQ phải ghi lý do. Chọn **Kho nhận**, **Ngày cần có vật tư**, ghi chú.\n4. **Lưu nháp** → chọn **Người duyệt** → **Gửi CHT duyệt**.\n5. CHT bấm **Duyệt** (hoặc **Trả lại**): vật tư có SL đề nghị chuyển sang Mua hàng → Cần mua.\n**Không làm được?**\n- \"Cần kế hoạch thi công được duyệt trước\" → lập / duyệt KH thi công tuần đó (**Mở kế hoạch thi công**).\n- \"Không quy đổi được vật tư nào…\" → công việc chưa gắn vật tư BOQ → kiểm Vật tư → BOQ.\n- Ô Kho nhận ghi \"Công trường chưa có kho\" → nhờ kho / Admin tạo kho cho công trường.\n- \"Cần tính lại kế hoạch vật tư\" → KH thi công đã đổi → **Tạo bản điều chỉnh** hoặc **Giữ nguyên — ghi lý do**.\n- Người lập không tự duyệt được → cần CHT khác.\n**Lưu ý:**\n- KH vật tư **Tháng** chỉ là dự báo, không gửi sang Mua hàng.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-khong-thay-du-an",
  "title": "Không thấy dự án hoặc tab của mình",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Mọi nhân viên (phải được thêm vào dự án)",
  "keywords": "khong thay du an khong thay cong trinh khong vao duoc du an mat du an khong thay tab nhat ky khong co quyen xem du an danh sach du an trong du an bi an khong thay du an hoac tab cua minh",
  "questions": "thay du an · thay tab nhat ky du an · vao du an bao chua cap quyen tab · ko thay menu du an · du an an tim · dien thoai thay cac tab du an",
  "body": "**Khi nào:** mở Dự án không thấy công trình mình làm, hoặc vào được dự án mà thiếu tab.\n**Các bước:**\n1. Ở **Dự án**, chuyển **Quản trị Bảng** rồi gõ mã / tên vào ô tìm.\n2. Vẫn không có → bạn chưa thuộc dự án: nhờ Admin thêm ở tab **Tổ chức** và cấp quyền ở tab **Phân quyền** của dự án.\n3. Vào được nhưng thấy \"Tài khoản chưa được cấp quyền xem tab nào trong dự án này\" → chưa có quyền Xem tab nào → báo Admin.\n4. Thiếu tab Nhật ký, Tiến độ, Kế hoạch, Tiến độ thực tế, Chất lượng, An toàn → cần quyền Xem trong Room cùng tên (tab Phân quyền); tab khác theo quyền người dùng Admin cấp ở Cài đặt → Người dùng.\n5. Trên điện thoại: bấm nút có biểu tượng ☰ ở đầu trang dự án để mở danh sách **Chức năng dự án**.\n**Không làm được?**\n- Không thấy menu Dự án → tài khoản chưa có quyền ở dự án nào → nhờ Admin.\n- Dự án đã bị ẩn → chỉ Admin thấy và khôi phục được.\n- Đã \"Kết thúc phân công\" ở Tổ chức → quyền Room không còn hiệu lực → nhờ Admin.\n**Lưu ý:**\n- Tab Phân quyền chỉ Admin hệ thống thấy. Báo Admin đúng tên dự án và tên tab còn thiếu.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-ly-do-cham",
  "title": "Ghi lý do chậm cho việc trễ tiến độ",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Tổng hợp (điền sẵn) / Duyệt (CHT chốt)",
  "keywords": "ly do cham chon nhanh ly do cham viec cham qua 3 ngay ben chiu trach nhiem cdt cong ty khach quan tre tien do ghi ly do tre hang muc cham nguyen nhan cham ghi ly do cham cho viec tre tien do",
  "questions": "ghi ly cham · chon ly cham nhieu viec cung luc · bat chon ly cham duyet · viec cham theo viec truoc phai chon · ly cham ai ghi · doi ly cham da ghi",
  "body": "**Khi nào:** lúc tổng hợp hoặc CHT duyệt nhật ký, các việc chậm quá 3 ngày so với tiến độ tổng cần có lý do.\n**Các bước:**\n1. Trong bản tổng hợp, kéo tới mục **Việc chậm quá 3 ngày — ghi lý do** (số đỏ = việc chưa có lý do).\n2. Một việc: bấm dòng → chọn ở **Vì sao chậm?**, đổi **Bên chịu trách nhiệm** (CĐT / Công ty / Khách quan) nếu khác, ghi thêm → **Xong**.\n3. Nhiều việc: bấm **Chọn nhanh lý do · N việc** (hoặc tick việc / cả nhóm) → bấm một lý do ở thanh dưới; sai thì **Hoàn tác**.\n4. Trong một nhóm: **Dùng lý do này cho các việc chưa chọn trong nhóm**.\n5. Hết số đỏ (hiện \"Đủ lý do\") thì CHT mới **Duyệt & công bố** được.\n**Không làm được?**\n- Không bấm được dòng → bạn đang chỉ xem (không phải người tổng hợp / CHT đang duyệt) hoặc nhật ký đã duyệt.\n- \"Đang tính việc chậm so với tiến độ tổng…\" → chờ vài giây.\n- \"Nhật ký này đã được duyệt, không sửa lý do chậm được nữa\".\n**Lưu ý:**\n- Việc hôm sau vẫn chậm thì giữ lý do đã ghi. Việc chậm theo việc trước tự lấy lý do của việc trước, không cần chọn.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-mo-hinh-3d",
  "title": "Xem công trường 3D và trình chiếu tiến độ",
  "module": "Dự án",
  "routes": [
   {
    "route": "/center",
    "label": "Trung tâm điều hành"
   }
  ],
  "permission": "Công trường 3D · Xem công trường 3D (trình chiếu tiến độ, mô hình thiết kế)",
  "keywords": "cong truong 3d mo hinh 3d xem 3d trinh chieu tien do mo hinh thiet ke xinhai son mien bac smb da29 xem hoan thien hop giao ban xem cong truong 3d va trinh chieu tien do",
  "questions": "mo hinh 3d cong truong · thay tab cong truong 3d · trinh chieu tien do 3d hop · 3d mo dien thoai · 3d bao chua quyen · cong trinh khi hoan thien",
  "body": "**Khi nào:** họp giao ban / báo cáo lãnh đạo, muốn xem tiến độ công trường trên mô hình 3D.\n**Các bước:**\n1. Bật giao diện **Trung tâm điều hành** (công tắc ở thanh bên) → mở tab **Công trường 3D**.\n2. Chọn công trường (hiện dựng sẵn XinHai và Sơn Miền Bắc).\n3. Kéo thanh ngày hoặc bấm **▶ Phát** để xem công trường lớn dần theo ngày.\n4. Tùy chọn: **Xem hoàn thiện**, **Chuyển động**, **Ẩn thông tin**.\n5. Bấm **Trình chiếu** để toàn màn hình tự tham quan; **Esc** để thoát.\n**Không làm được?**\n- Không có tab Công trường 3D → chưa được Admin cấp quyền \"Xem công trường 3D\" (cấp từng người).\n- Không thấy công tắc Trung tâm điều hành → giao diện này đang bật thí điểm theo người → nhờ Admin.\n- Dự án khác không có trong danh sách → mỗi công trường phải được dựng bố cục 3D riêng.\n- Điện thoại báo \"xem tốt nhất trên máy tính\" → bấm **Vẫn mở trên điện thoại** (bản nhẹ).\n**Lưu ý:**\n- Hạng mục, %, nhật ký, máy, tồn kho đọc trực tiếp từ Vioo, không nhập riêng cho 3D.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-moc-khong-che",
  "title": "Xem dự án nhanh / chậm và khai báo mốc khống chế",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Tiến độ Gantt · Xem (thêm mốc: Room Tiến độ Gantt · Lập điều chỉnh, sửa việc)",
  "keywords": "moc khong che du an cham bao nhieu ngay du kien ve dich so tien do tong nhanh cham hang muc vuot moc viec noi tiep phu thuoc tach song song tien do tong xem du an nhanh / cham va khai bao moc khong che",
  "questions": "du an dang cham bao nhieu ngay · ngay ve dich du kien · moc che · khai bao xong · du an bao dung han thuc te cham · hang muc dang cham du an",
  "body": "**Khi nào:** muốn biết dự án nhanh / chậm bao nhiêu ngày, về đích dự kiến khi nào, việc nào gây chậm.\n**Các bước:**\n1. Mở dự án → **Điều hành**: thẻ **Tiến độ tổng — đang tới đâu?** (hoặc tab **Tiến độ** → dải **So tiến độ tổng** → **Xem chi tiết**).\n2. Xem: Chậm / Nhanh N ngày, **Về đích dự kiến**, **Hạng mục vượt mốc**, **Việc chậm do đâu**.\n3. Khai mốc: bấm **Mốc khống chế (N)** → chọn **Việc phải xong trước…** và **Việc làm sau…** → xem ngày về đích thay đổi → **Lưu mốc**.\n4. Hai việc thực tế làm song song mà bị tự nối: mở **Việc tự nối** → **Tách**.\n**Không làm được?**\n- Dải ghi \"chưa khai báo mốc khống chế\" và dự án có vẻ đúng hạn dù móng đang chậm → chưa có mốc nên việc chậm không kéo việc sau → khai các mốc quyết định về đích.\n- \"Hai việc phải khác nhau và không phải việc cha / con của nhau\" → chọn lại cặp việc.\n- Không có ô **Thêm mốc** → chỉ người được giao lập điều chỉnh tiến độ thêm / bỏ mốc.\n**Lưu ý:**\n- Ngày xong dự kiến lấy từ Nhật ký đã duyệt; lệch trong ±3 ngày coi là đúng hạn. Mốc không cần duyệt, không đổi ngày kế hoạch.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-nhat-ky-bi-tra-lai",
  "title": "Sửa phiếu nhật ký bị trả lại hoặc vừa gửi",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Tạo + Gửi",
  "keywords": "nhat ky bi tra lai phieu bi tra lai sua phieu nhat ky rut ve sua rut phieu xoa phieu nhap nhat ky can sua gui lai tong hop cht tra lai sua phieu nhat ky bi tra lai hoac vua gui",
  "questions": "nhat ky tra sua · sua phieu nhat ky da gui · rut phieu nhat ky ve sua · xoa phieu nhat ky nhap · phieu nhat ky bao sua · cht tra ban tong hop ai sua",
  "body": "**Khi nào:** phiếu của bạn bị người tổng hợp / CHT trả lại, hoặc vừa gửi thì phát hiện sai.\n**Các bước:**\n1. Mở dự án → **Nhật ký** → **Lịch tháng** → bấm vào ngày → ở phiếu của bạn bấm **Sửa phiếu**. Lý do nằm ở khung \"Phiếu cần chỉnh sửa\".\n2. Sửa theo lý do → **Gửi lại tổng hợp**.\n3. Vừa gửi, người tổng hợp chưa gom: mở phiếu → **Rút về sửa** → sửa → **Gửi lại tổng hợp**.\n4. Phiếu nháp chưa từng gửi, không cần nữa: cuối phiếu bấm **Xóa phiếu nháp**.\n5. CHT trả cả bản: người tổng hợp thấy \"CHT trả lại\" ở dòng ngày → **Tổng hợp** → sửa → **Gửi CHT**.\n**Không làm được?**\n- \"Phiếu đã được đưa vào bản tổng hợp\" → không tự rút được → nhờ người tổng hợp trả phiếu kèm lý do.\n- \"Chỉ xóa được phiếu nháp chưa từng gửi\" → phiếu đã gửi được giữ để đối chiếu.\n- Người khác thấy \"Chờ KS … sửa\" → chỉ người lập phiếu sửa được, Admin cũng không sửa thay.\n- Nhật ký đã duyệt → xem mục \"Sửa số liệu nhật ký đã duyệt\".\n**Lưu ý:**\n- Lịch sử gửi / trả xem ở tab **Lịch sử** của phiếu.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-nhat-ky-tu-zalo",
  "title": "Dán báo cáo Zalo thành phiếu nhật ký nháp",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Tạo (Room Nhật ký công trường: Sửa)",
  "keywords": "dan bao cao zalo nhat ky tu zalo chup so bao cao ai doc bao cao tao phieu nhap nhat ky tu tin nhan copy zalo nhat ky ai tach ngay mui hang muc dan bao cao zalo thanh phieu nhat ky nhap",
  "questions": "dan bao cao zalo vao nhat ky · chuyen tin zalo thanh nhat ky · thay nut dan bao cao zalo · chup so bao cao ai doc · ai doc xong tiep · nut dan bao cao zalo mo",
  "body": "**Khi nào:** báo cáo ngày đã gửi qua Zalo hoặc ghi sổ, muốn chuyển thành phiếu nhật ký mà không gõ lại.\n**Các bước:**\n1. Mở dự án → **Nhật ký** → bấm **Dán báo cáo Zalo**.\n2. Dán tin vào ô **Báo cáo Zalo** (dán nhiều ngày một lần được) hoặc **Chụp sổ / chọn ảnh**.\n3. Bấm **AI đọc báo cáo**, chờ 10–40 giây.\n4. Kiểm từng ngày × mũi: dòng **Chưa chắc** thì xem lại; **Ngoài kế hoạch — chờ QS** là chưa gắn được hạng mục; bỏ tick **Tạo phiếu** ở mũi không cần.\n5. Bấm **Tạo N phiếu nháp** → **Mở phiếu** để điền khối lượng / % rồi **Gửi tổng hợp**.\n**Không làm được?**\n- Không thấy nút → dự án chưa dùng Nhật ký luồng mới hoặc AI đọc báo cáo chưa bật → ghi tay bằng **Ghi nhật ký chi tiết**.\n- Nút mờ → chưa có quyền lập phiếu (Room Nhật ký: Sửa).\n- \"Dự án chưa có hạng mục kế hoạch để gắn\" → dự án chưa có bảng tiến độ → kiểm tab Tiến độ.\n- \"AI không thấy dòng việc nào\" → dán rõ hơn hoặc chụp lại.\n- \"Đã có phiếu của mũi này trong ngày\" → mở phiếu đó để bổ sung.\n**Lưu ý:**\n- Phiếu tạo ra là nháp của bạn, chưa ai nhận cho tới khi bấm Gửi tổng hợp. Dán tin vào Trợ lý cũng ra thẻ tách sẵn để tạo phiếu nháp.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-phan-quyen-room",
  "title": "Cấp quyền cho người trong dự án (Room)",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Admin hệ thống",
  "keywords": "phan quyen du an cap quyen room quyen nhat ky quyen duyet nhat ky mau vai tro quyen tien do cap quyen ky su cht chi huy truong ap mau quyen nhieu nguoi cap quyen cho nguoi trong du an (room)",
  "questions": "cap quyen ghi nhat ky ky su · cht quyen duyet nhat ky · phan quyen du an theo mau · tab phan quyen hien · cap quyen nhieu nguoi cung luc · ko thay ten nguoi phan quyen du an",
  "body": "**Khi nào:** người đã có trong tab Tổ chức nhưng chưa ghi / duyệt được nghiệp vụ của dự án.\n**Các bước:**\n1. Mở dự án → **Thiết lập** → **Phân quyền**.\n2. Ở **Phân quyền theo người**, chọn **Nhân sự**.\n3. **1. Điền nhanh theo mẫu**: chọn mẫu vai trò (có gợi ý theo chức vụ) → **Thêm vào quyền đang có** hoặc **Thay bằng mẫu**.\n4. **2. Quyền của …**: bấm từng quyền trong mỗi Room để thêm / bỏ (xanh lá = sẽ thêm, đỏ gạch = sẽ gỡ).\n5. Bấm **Lưu quyền cho …**. Nhiều người cùng vai: dùng **Áp cho nhiều người cùng lúc**.\n**Không làm được?**\n- Không thấy tab Phân quyền, hoặc báo \"Chỉ admin hệ thống được quản lý phân quyền dự án\" → chỉ Admin hệ thống cấp được.\n- Không có tên trong ô Nhân sự → chưa có trong Tổ chức, đã kết thúc phân công hoặc tài khoản bị khóa → thêm ở tab Tổ chức trước.\n- Một quyền không bấm được → thường phải có quyền Xem của Room đó trước; di chuột vào để xem lý do.\n**Lưu ý:**\n- Room Nhật ký công trường: kỹ sư = Sửa + Gửi; người tổng hợp = Kiểm tra + Gửi; CHT = Duyệt + Công bố tiến độ ngày.\n- Mẫu vai trò chỉnh ở Cài đặt → Mẫu quyền dự án. Công tắc xem tài chính ở thẻ **Ai được xem Tài chính & Hợp đồng** cuối tab.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-su-co-an-toan",
  "title": "Ghi nhận nguy cơ / sự cố an toàn công trường",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "An toàn · Tạo sự cố (Room Hồ sơ & sự cố an toàn)",
  "keywords": "su co an toan nguy co an toan bao su co tai nan vi pham an toan atld an toan lao dong ghi nhan nguy co near miss dong su co kiem tra hien truong ghi nhan nguy co / su co an toan cong truong",
  "questions": "bao su an toan · ghi nhan nguy an toan · thay nut ghi nhan nguy · dong su an toan ra · cap nhat trang thai su an toan · tao kiem tra hien truong an toan",
  "body": "**Khi nào:** phát hiện nguy cơ, vi phạm, sự cố (kể cả suýt xảy ra) ở công trường.\n**Các bước:**\n1. Mở dự án → nhóm **Chất lượng & An toàn** → **An toàn** → chọn **Sự cố / nguy cơ**.\n2. Bấm **Ghi nhận nguy cơ**: nhập **Tiêu đề**, **Loại**, **Mức độ**, **Khu vực/tổ đội**, **Hạn xử lý**, **Người xử lý**, **Mô tả**, ảnh hiện trường.\n3. Bấm **Lưu hồ sơ**.\n4. Theo dõi: mở sự cố → **Cập nhật trạng thái** (Đã giao xử lý → Đang xử lý → Chờ xác nhận → Đã khắc phục → Đã đóng); thêm bằng chứng ở **Bình luận / bằng chứng**.\n5. Kiểm tra định kỳ: chọn **Kiểm tra hiện trường** → **Tạo kiểm tra hiện trường**.\n**Không làm được?**\n- Không thấy **Ghi nhận nguy cơ** / không có nút trạng thái → chưa có quyền thao tác trong Room Hồ sơ & sự cố an toàn → nhờ Admin cấp.\n- \"Bạn cần quyền Sửa trong Room An toàn…\" khi tạo kiểm tra → nhờ Admin cấp quyền Sửa.\n- \"Vui lòng nhập tiêu đề nguy cơ/sự cố\" → nhập Tiêu đề.\n- Không thấy tab An toàn → chưa có quyền Xem Room an toàn của dự án.\n**Lưu ý:**\n- Ô đầu trang hiện số issue mở và số nghiêm trọng; bấm **Làm mới** sau khi người khác cập nhật.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-sua-nhat-ky-da-duyet",
  "title": "Sửa số liệu nhật ký đã duyệt",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Duyệt + Công bố tiến độ ngày (CHT)",
  "keywords": "sua nhat ky da duyet ban dieu chinh nhat ky dieu chinh ngoai le nhap sai khoi luong nhat ky da cong bo sai so lieu tien do sai phien ban nhat ky sua so lieu nhat ky da duyet",
  "questions": "nhat ky da duyet nhap sai sua · tao ban dieu chinh nhat ky · dieu chinh ngoai le · sua nhat ky da duyet · sua tien do da cong bo",
  "body": "**Khi nào:** nhật ký đã **Duyệt & công bố** nhưng khối lượng / % sai.\n**Các bước:**\n1. Mở dự án → **Nhật ký** → mở bản tổng hợp ngày đó.\n2. Ở khung **Phiên bản N** bấm **Tạo bản điều chỉnh**, nhập lý do → **Tạo bản điều chỉnh**.\n3. Mở **Sửa phiếu** để rà soát bản mới rồi gửi duyệt lại. Bản cũ vẫn hiệu lực tới khi bản mới được duyệt và công bố.\n4. Cách khác cho một việc: tab **Tiến độ thực tế** → bấm việc → **Điều chỉnh ngoại lệ**, chọn ngày, nhập % / KL lũy kế và lý do → **Lưu điều chỉnh**.\n**Không làm được?**\n- Không thấy **Tạo bản điều chỉnh** → chỉ người có quyền Duyệt + Công bố tiến độ ngày tạo được.\n- \"Kỳ tiến độ đang khóa\" → **Mở Tiến độ thực tế** → **Mở lại** tuần (cần lý do) trước.\n- \"Bản tổng hợp này đã có bản điều chỉnh mới hơn\" → bấm **Mở bản điều chỉnh mới**.\n- **Điều chỉnh ngoại lệ** mờ → tuần đã xác nhận, thiếu quyền Sửa tiến độ + Công bố nhật ký, hoặc tuần đó chưa có số đã duyệt cho việc này.\n**Lưu ý:**\n- Nhật ký chưa duyệt mà sai → trả phiếu cho kỹ sư sửa; điều chỉnh ngoại lệ chỉ dùng khi không trả lại được.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-tao-du-an-moi",
  "title": "Tạo dự án mới và gắn công trường",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Tổng quan dự án · Quản trị + Danh mục dự án · Tạo",
  "keywords": "tao du an moi them du an lap du an moi tao cong trinh tao cong truong moi ma du an gan cong truong lien ket cong truong hrm khoi tao du an tao du an moi va gan cong truong",
  "questions": "tao du an · thay nut them du an · ai tao du an · tao cong truong du an · ko chon cong truong khi tao du an · tao du an xong ko lap don mua hang",
  "body": "**Khi nào:** có công trình mới cần quản lý tiến độ, nhật ký, vật tư.\n**Các bước:**\n1. Mở **Dự án** ở thanh bên → bấm **Thêm dự án** góc trên.\n2. Nhập **Mã dự án**, **Tên dự án** (bắt buộc); nhóm / loại / lĩnh vực nếu có.\n3. **Công trường**: chọn công trường có sẵn; chưa có thì bấm **Tạo mới** cạnh ô, gõ tên → **Tạo**.\n4. Chọn **Quản trị dự án**, **Thực hiện dự án**, **Người theo dõi** — họ vào Tổ chức dự án; Admin tạo thì họ tự có quyền Room theo chức vụ.\n5. **Thông tin khác**: chủ đầu tư, ngày bắt đầu / kết thúc, **Cách tính tiến độ**.\n6. Bấm **Tạo dự án** hoặc **Tạo và mở chi tiết**.\n**Không làm được?**\n- Không thấy **Thêm dự án** → cần quyền quản trị \"Tổng quan DA\" → nhờ Admin.\n- Không có nút **Tạo mới** công trường / báo \"Chưa tạo được công trường\" → cần quyền quản trị danh mục nhân sự → nhờ HR / Admin.\n- \"Thiếu chức danh HRM\" → chọn **Vị trí mặc định cho thành viên chưa có chức danh** ở Thông tin khác.\n- Tạo xong báo \"Chưa phân quyền Room\" → người tạo không phải Admin → nhờ Admin phân quyền ở tab Phân quyền.\n**Lưu ý:**\n- Chưa gắn công trường thì chưa tạo được kho, đơn mua hàng. Tọa độ chấm công: Cài đặt → Địa điểm chấm công.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-them-thanh-vien",
  "title": "Thêm người vào dự án (tab Tổ chức)",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Admin hệ thống",
  "keywords": "them nguoi vao du an them thanh vien du an to chuc du an phan cong nhan su du an dua nhan vien vao cong trinh ket thuc phan cong roi du an ky su moi them nguoi vao du an (tab to chuc)",
  "questions": "them nguoi vao du an · thay nut them thanh vien · dua ky su vao du an · nhan vien chuyen cong truong go khoi du an · ko tim thay ten nhan vien khi them vao du an · them thanh vien van ghi nhat ky",
  "body": "**Khi nào:** có người mới về công trường, hoặc có người rời dự án.\n**Các bước:**\n1. Mở dự án → nhóm **Thiết lập** → **Tổ chức**.\n2. Bấm **Thêm thành viên**: chọn **Nhân viên**, **Vị trí công việc**, **Ngày bắt đầu**, ghi chú nếu cần → **Thêm thành viên**.\n3. Sang tab **Phân quyền** cấp quyền Room cho người đó (mục \"Cấp quyền cho người trong dự án\").\n4. Người rời dự án: trên thẻ của họ bấm biểu tượng **Kết thúc** (giữ lịch sử); **Xoá** chỉ khi thêm nhầm.\n5. Đổi vị trí: biểu tượng **Sửa** trên thẻ.\n**Không làm được?**\n- Không có nút, thấy \"Danh sách tổ chức chỉ để xem\" → chỉ Admin hệ thống thêm / sửa / xoá → báo Admin.\n- Không tìm thấy tên → người đó chưa có tài khoản đang hoạt động, hoặc đã có trong danh sách (kể cả người đã Kết thúc phân công) → báo Admin xử lý.\n- Đã thêm mà vẫn không ghi được nhật ký → mới có tên, chưa có quyền Room → cấp ở tab Phân quyền.\n**Lưu ý:**\n- Người được chọn khi tạo dự án (Quản trị / Thực hiện / Theo dõi) đã tự có trong Tổ chức.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-tien-do-khong-doi",
  "title": "Vì sao % tiến độ dự án không đổi",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "tien do khong doi phan tram khong cap nhat tien do dung yen khong sua duoc phan tram gantt nhap ngay thuc te tien do khong nhay tien do du an sai cach tinh tien do vi sao % tien do du an khong doi",
  "questions": "tien do doi du da ghi nhat ky · sua gantt · nhap ngay thuc te tien do van · tien do du an tinh · tien do du an lay · ghi nhat ky xong bao lau tien do cap nhat",
  "body": "**Khi nào:** đã ghi nhật ký hoặc sửa Gantt mà % ở đầu trang dự án / trên Gantt đứng yên.\n**Các bước:**\n1. Mở dự án → **Nhật ký**: ngày đó đã **Đã duyệt** chưa? \"Chờ tổng hợp\", \"Chờ CHT duyệt\" là chưa tính.\n2. Mở **Tiến độ thực tế**: việc ghi \"Nhật ký chưa được CHT duyệt, chưa tính\" là đang chờ.\n3. Nhắc người tổng hợp gửi và CHT bấm **Duyệt & công bố** — % cập nhật ngay khi công bố.\n4. Kiểm **Cách tính tiến độ** của dự án (**Sửa** → **Thông tin khác**): \"Nhập thủ công\" thì số đầu trang không tự đổi.\n**Không làm được?**\n- Không gõ được % trên Gantt, thấy \"Theo Nhật ký đã duyệt — xem ở Tiến độ thực tế\" → dự án lấy % từ Nhật ký → ghi khối lượng ở Nhật ký.\n- Đã nhập ngày thực tế trên Gantt mà % không đổi → ngày thực tế không làm đổi %; dự án dùng Nhật ký thì ngày thực tế tự ghi khi CHT duyệt.\n- Việc xong ngoài thực tế mà nhật ký < 100% → kỹ sư dùng **Ghi bù theo Gantt** trong phiếu.\n**Lưu ý:**\n- % hạng mục cha và dự án = trung bình % việc con theo số ngày kế hoạch: việc dài nặng hơn việc ngắn.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-tien-do-thuc-te-tuan",
  "title": "Xem tiến độ thực tế theo tuần và xác nhận tuần",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Chốt tiến độ tuần · Xem (xác nhận: Room Chốt tiến độ ngày/tuần · Xác nhận/Mở lại tuần)",
  "keywords": "tien do thuc te tien do tuan xac nhan tuan chot tien do tuan khoa tuan mo lai tuan ngay thieu nhat ky viec co tien trien bao cao tuan tuan nay tang bao nhieu xem tien do thuc te theo tuan va xac nhan tuan",
  "questions": "tien do tuan · xac nhan tuan tien do · nut xac nhan tuan mo · mo tuan da xac nhan · ngay thieu nhat ky · tuan tien do tang bao nhieu",
  "body": "**Khi nào:** cuối tuần xem tiến độ thi công tăng bao nhiêu, ngày nào thiếu nhật ký, rồi khóa số tuần.\n**Các bước:**\n1. Mở dự án → **Tiến độ thực tế**; mũi tên để đổi tuần.\n2. Xem 4 ô **Tiến độ thi công**, **Việc có tiến triển**, **Nhật ký đã duyệt**, **Ngày thiếu nhật ký**; bấm từng ngày để lọc.\n3. Bảng việc: lọc **Có tiến triển** / **Tất cả**, tìm theo mã WBS; bấm việc để xem theo ngày hoặc **Xem trên Gantt**.\n4. Hết tuần: bấm **Xác nhận tuần** rồi xác nhận. Số tuần bị khóa; nhật ký duyệt sau đó không cộng vào tuần này.\n5. Cần sửa: **Mở lại** (ghi lý do).\n**Không làm được?**\n- **Xác nhận tuần** mờ \"Xác nhận được khi hết tuần…\" → chờ sang tuần sau.\n- \"Bạn chưa có quyền Xác nhận tuần\" → cần quyền Xác nhận/Mở lại tuần trong Room Chốt tiến độ ngày/tuần.\n- \"Tuần này chưa có nhật ký nào được duyệt\" → nhắc người tổng hợp gửi, CHT duyệt.\n**Lưu ý:**\n- Số chỉ lấy từ Nhật ký đã duyệt. Dự án chưa dùng Nhật ký chính thức thì tab này vẫn là màn nhập tay theo tuần.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-tong-hop-nhat-ky",
  "title": "Tổng hợp nhật ký ngày và gửi CHT duyệt",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Tổng hợp + Gửi (Room Nhật ký công trường: Kiểm tra, Gửi)",
  "keywords": "tong hop nhat ky ban tong hop nhat ky ngay gui cht duyet cho tong hop gom phieu ky su nguoi tong hop tra phieu cho ky su chon cht duyet tong hop nhat ky ngay va gui cht duyet",
  "questions": "tong hop nhat ky ngay · gui nhat ky cht duyet · nut gui cht mo · cho tong hop · tra phieu ky su sua · cht duyet ai chon",
  "body": "**Khi nào:** các kỹ sư đã gửi phiếu trong ngày; người tổng hợp gom thành một bản ngày gửi CHT.\n**Các bước:**\n1. Mở dự án → **Nhật ký** → nút **Tổng hợp** ở dòng ngày (hoặc **Chờ tổng hợp · N** → **Tổng hợp ngày**).\n2. Mở **Chọn phiếu để tổng hợp**, tick các phiếu của ngày.\n3. Hạng mục nhiều mũi cùng báo: chốt số dùng ghi tiến độ. Mục **Việc chậm quá 3 ngày** điền sẵn lý do để CHT xem lại.\n4. **Thông tin bản tổng hợp**: chọn **CHT duyệt**, ghi **Nội dung tổng hợp**, **Vấn đề / sự cố**, **Kế hoạch ngày sau**.\n5. Bấm **Lưu tổng hợp**, rồi **Gửi CHT**.\n**Không làm được?**\n- Không có nút Tổng hợp → thiếu quyền Kiểm tra trong Room Nhật ký, hoặc ngày chưa có phiếu nào được gửi.\n- **Gửi CHT** mờ → chưa chọn CHT, chưa có nội dung / ảnh, còn hạng mục chưa chốt hoặc phiếu cần sửa.\n- Báo \"Chưa có người có quyền duyệt trong Room Nhật ký công trường\" → nhờ Admin cấp quyền Duyệt cho CHT.\n- Phiếu kỹ sư sai → **Lưu tổng hợp** trước, mở **Trả phiếu cho kỹ sư** ở phiếu đó, ghi nhận xét → bấm trả.\n- Phiếu báo \"Kỹ sư đã gửi lại bản mới\" → bấm **Cập nhật từ phiếu** rồi lưu.\n**Lưu ý:**\n- Bỏ chọn / **Bỏ khỏi bản tổng hợp** không xóa phiếu gốc của kỹ sư.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-xem-anh-nhat-ky",
  "title": "Xem nhật ký một ngày và phóng to ảnh hiện trường",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Xem",
  "keywords": "xem nhat ky ngay anh hien truong phong to anh nhat ky xem anh cong truong tai anh nhat ky lich thang nhat ky bao cao ngay xem lai nhat ky tim nhat ky xem nhat ky mot ngay va phong to anh hien truong",
  "questions": "nhat ky ngay hom qua · nhat ky phong to · tai hien truong ve may · ai da ghi nhat ky hom · tim nhat ky su · lich nhat ky",
  "body": "**Khi nào:** cần xem lại một ngày thi công: ai ghi, làm hạng mục gì, nhân công, máy, ảnh.\n**Các bước:**\n1. Mở dự án → **Nhật ký** → chuyển **Lịch tháng**, bấm vào ngày (hoặc bấm dòng ngày ở danh sách).\n2. Ngăn ngày hiện tiến trình **Phiếu kỹ sư → Tổng hợp → CHT duyệt → Công bố** và báo cáo từng mũi; đổi cách xem **Theo mũi thi công**, **Theo tổ đội & máy**, **Ảnh hiện trường**.\n3. Bấm ảnh để mở trình xem: nút phóng to / thu nhỏ (máy tính: lăn chuột, nhấp đúp), mũi tên sang ảnh khác, nút **Tải xuống**.\n4. Tìm nhanh ở danh sách: ô tìm theo nội dung, sự cố, người lập, vật tư, thiết bị, hạng mục; lọc trạng thái, thời tiết, tháng.\n**Không làm được?**\n- Ảnh trong phiếu đang soạn mở ra tab mới, không vào trình xem → dùng phóng to của trình duyệt / điện thoại.\n- Ngày tương lai không có gì → chưa có nhật ký.\n- \"Bạn không có quyền truy cập Nhật ký của dự án này\" → cần quyền Xem trong Room Nhật ký.\n**Lưu ý:**\n- Nhật ký trước ngày áp dụng quy trình mới nằm ở mục **Nhật ký cũ** cuối danh sách.",
  "source": "docs"
 },
 {
  "id": "so-tay-du-an-tay-xuat-bao-cao",
  "title": "Xuất báo cáo tiến độ và nhật ký dự án",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Báo cáo · Xem",
  "keywords": "xuat bao cao du an bao cao tien do xuat excel tien do xuat pdf nhat ky bao cao tuan bao cao thang in nhat ky bao cao hop giao ban spi xuat danh sach du an xuat bao cao tien do va nhat ky du an",
  "questions": "xuat bao cao tien do du an ra excel · in nhat ky cong truong theo tuan · bam xuat pdf nhat ky thay · bao cao du an · copy tom tat tien do gui · xuat danh sach du an ra excel",
  "body": "**Khi nào:** cần báo cáo họp giao ban, gửi lãnh đạo / chủ đầu tư.\n**Các bước:**\n1. Mở dự án → nhóm **Điều hành** → **Báo cáo** (hoặc nút **Báo cáo** ở tab Nhật ký).\n2. **Tiến độ dự án**: xem kế hoạch gốc, SPI, dự báo mốc kết thúc, bảng hạng mục (lọc Đang làm / Chậm / Hoàn thành…). **Copy** để chép tóm tắt, **Xuất Excel** để tải bảng.\n3. **Nhật ký công trường**: chọn **Ngày** / **Tuần** / **Tháng**, khoảng ngày, trạng thái (mặc định **Đã duyệt**) → **Xuất PDF** → hộp in mở ra, chọn Lưu thành PDF.\n4. Danh sách nhiều dự án: **Dự án** → **Quản trị Bảng** → **Xuất danh sách**.\n**Không làm được?**\n- Bấm **Xuất PDF** không thấy gì → trình duyệt chặn cửa sổ bật lên → cho phép pop-up rồi bấm lại.\n- Không thấy tab Báo cáo → chưa có quyền xem Báo cáo của dự án → nhờ Admin.\n- Số nhật ký ít hơn thực tế → báo cáo mặc định chỉ tính nhật ký Đã duyệt; đổi trạng thái để xem cả nháp / chờ duyệt.\n**Lưu ý:**\n- Hỏi Trợ lý kiểu \"tiến độ SMB 4 tuần gần đây\" để có biểu đồ nhanh.",
  "source": "docs"
 },
 {
  "id": "so-tay-giao-viec",
  "title": "Giao việc nhanh trong Vioo Work",
  "module": "Công việc",
  "routes": [
   {
    "route": "/work/my",
    "label": "Công việc của tôi"
   }
  ],
  "permission": "Công việc · Tạo công việc; giao cho người khác cần Công việc · Giao cho người dùng",
  "keywords": "giao viec tao cong viec task giao nhanh nguoi lam han muc a b c trong diem quan trong checklist ai dien dan bien ban hop zalo giao viec mieng ghi viec duoc giao vioo work giao viec nhanh trong vioo work",
  "questions": "giao viec nhan vien · giao viec nhanh · giao viec bien ban hop · sep giao mieng ghi · chon nguoi khac giao · muc · giao viec checklist",
  "body": "**Khi nào:** giao việc cho người khác, hoặc ghi lại việc mình được giao.\n**Các bước:**\n1. **Vioo Work** → **Công việc của tôi** → ô **Giao việc mới…**.\n2. Gõ tên việc; có AI thì bấm **AI điền** để tự điền người làm, hạn, mức, checklist từ câu bạn gõ.\n3. Chọn **Người làm**, hạn (chọn nhanh hoặc **Ngày khác**), mức **A** (Trọng điểm) / **B** (Quan trọng) / **C** (Thường).\n4. Cần thêm: bấm **Chi tiết** để ghi yêu cầu, checklist (mỗi dòng một mục), bằng chứng **Ảnh** / **Tệp**.\n5. Bấm **Giao**.\n**Không làm được?**\n- Chỉ chọn được chính mình → thiếu quyền \"Công việc · Giao cho người dùng\" → nhờ Admin.\n- Không thấy ô giao việc → thiếu quyền \"Công việc · Tạo công việc\".\n**Lưu ý:**\n- Nhiều việc từ biên bản họp / tin Zalo: bấm **Dán biên bản**, AI tách thành nhiều việc.\n- Việc được giao miệng: **Ghi việc được giao** → chọn **Người giao**, hạn → **Gửi người giao xác nhận**.\n- Nhờ Trợ lý: \"giao việc cho Hương: … hạn thứ Sáu\" → thẻ nháp, bấm Giao mới gửi.",
  "source": "docs"
 },
 {
  "id": "so-tay-gop-y-bao-loi",
  "title": "Báo lỗi phần mềm, gửi góp ý cho Admin",
  "module": "Chung",
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
  "keywords": "bao loi gop y phan mem loi khong luu duoc man hinh trang bao admin su co y kien cai tien gui anh loi chup man hinh phieu su co trung tam gop y theo doi gop y bao loi phan mem, gui gop y cho admin",
  "questions": "bao loi · gui gop admin · chup man hinh loi gui ai · gop tinh nang · gop da gui gio xu ly · bao loi kem",
  "body": "**Khi nào:** phần mềm báo lỗi, không làm được thao tác, số liệu sai, thiếu quyền, hoặc muốn đề xuất tính năng.\n**Các bước:**\n1. Cách nhanh (có Trợ lý): mở **Trợ lý**, đính ảnh chụp màn hình, kể \"đang làm gì, ở màn nào, báo gì\".\n2. Trợ lý lập thẻ **Phiếu sự cố gửi Admin** (tiêu đề, loại, mức khẩn, ảnh); sửa nếu cần rồi bấm **Gửi Admin**.\n3. Cách thường: mở **Góp ý** → **Gửi góp ý mới** → điền tiêu đề, **Mô tả chi tiết**, chọn **Loại** (Báo lỗi, Giao diện, Tính năng, Phân quyền…), **Module**, **Ảnh hưởng** → **Chọn file đính kèm** → **Gửi góp ý**.\n4. Theo dõi: Góp ý → lọc **Người gửi** là bạn; bấm góp ý để xem trạng thái (Mới, Đã nhận, Cần làm rõ, Đang xử lý, Hoàn tất…) và bình luận.\n**Không làm được?**\n- \"Tiêu đề và mô tả cần ít nhất 3 ký tự.\" → viết rõ hơn.\n- \"Tối đa 5 file.\" / \"… vượt quá 25MB.\" → bớt tệp, làm nhỏ ảnh.\n- Trạng thái **Cần làm rõ** → Admin cần thêm thông tin → trả lời trong bình luận.\n**Lưu ý:**\n- **Hiển thị** mặc định Public (mọi người xem được); chọn Private thì chỉ bạn, người xử lý, người theo dõi thấy. Phiếu từ Trợ lý luôn Private, tự kèm màn đang mở và lỗi gần nhất trên máy.",
  "source": "docs"
 },
 {
  "id": "so-tay-hop-dong-doi-soat-thang",
  "title": "Đối soát tháng hợp đồng nguyên tắc với NCC",
  "module": "Hợp đồng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   },
   {
    "route": "/finance/pending",
    "label": "Chờ ghi nợ"
   }
  ],
  "permission": "Mua hàng · Quản trị (ghi công nợ: Tài chính · Ghi nhận)",
  "keywords": "doi soat thang hop dong nguyen tac bang doi soat ncc chot doi soat gui ke toan ghi cong no gia khac gia hd ly do gia lam tron theo hoa don chua doi soat hd khung doi soat thang hop dong nguyen tac voi ncc",
  "questions": "cuoi thang doi soat ncc theo hop dong nguyen · lap bang doi soat · gia ncc tinh khac gia hop dong · bao con dong gia khac gia hd chua ghi ly · ke toan ghi cong no bang doi soat · dong hang tich doi soat",
  "body": "**Khi nào:** hàng gọi theo HĐ nguyên tắc đã nhận trong tháng, cần chốt số với NCC để thành công nợ.\n**Các bước:**\n1. Mua hàng → tab **Hợp đồng nguyên tắc** → bấm HĐ (nhãn \"… dòng chưa đối soát\") → tab **Đối soát tháng**.\n2. Ở tháng cần chốt bấm **Lập bảng đối soát**; HĐ dùng cho nhiều dự án thì chọn dự án (mỗi bảng một dự án).\n3. Kiểm từng dòng: **Đơn giá** lấy theo bảng giá HĐ tại ngày giao, **VAT %**; NCC tính khác thì sửa giá và ghi **lý do**.\n4. Bấm **Lưu nháp** hoặc **Chốt & gửi kế toán**.\n5. Kế toán (khác người chốt) bấm **Ghi công nợ** ngay ở bảng hoặc ở Tài chính → **Phải trả** → **Chờ ghi nợ** → **Bảng đối soát HĐ**; sai thì **Trả lại** kèm lý do.\n**Không làm được?**\n- \"Còn … dòng giá khác giá HĐ chưa ghi lý do\" → ghi lý do ở dòng có ô viền cam.\n- Dòng không tích được → kho chưa hoàn tất phiếu nhập.\n- \"HĐ chưa có giá vật tư này\" → **Khai bảng giá** ở tab **Đơn giá** trước.\n- Bảng bị kế toán trả lại → mở **Sửa**, sửa rồi chốt lại.\n**Lưu ý:**\n- Kế toán được sửa thành tiền / VAT theo hóa đơn để làm tròn (có dung sai). Chốt rồi muốn sửa: **Rút về sửa** khi kế toán chưa ghi.",
  "source": "docs"
 },
 {
  "id": "so-tay-hop-dong-them-doi-tac",
  "title": "Thêm đối tác (NCC, chủ đầu tư, thầu phụ, tổ đội)",
  "module": "Hợp đồng",
  "routes": [
   {
    "route": "/hd/partners",
    "label": "Đối tác"
   }
  ],
  "permission": "Đối tác · Quản trị",
  "keywords": "them doi tac them nha cung cap moi tao ncc moi chu dau tu nha thau to doi ma so thue mst tai khoan ngan hang ncc nhap doi tac excel ngung su dung doi tac tim theo mst them doi tac (ncc, chu dau tu, thau phu, to doi)",
  "questions": "them nha cung cap · tim doi theo ma so thue · khai so tai khoan ngan hang ncc · nhap danh sach doi excel · thay nut them doi · xoa nha cung cap trung",
  "body": "**Khi nào:** có NCC, chủ đầu tư, nhà thầu hay tổ đội mới cần dùng trong hợp đồng, đơn mua, thanh toán.\n**Các bước:**\n1. Hợp đồng → **Đối tác**; gõ tên / MST vào ô \"Tìm mã, tên, MST, liên hệ...\" để chắc chưa có.\n2. Bấm **Thêm đối tác**.\n3. Nhập **Tên khách hàng** (bắt buộc), tích **Phân loại**: Chủ đầu tư / Nhà thầu / Nhà cung cấp / Tổ đội; điền **Mã số thuế**, địa chỉ, liên hệ, **Ngân hàng**, **Tài khoản**.\n4. Bấm **Lưu đối tác**. Mã để trống thì tự sinh.\n5. Nhiều đối tác: bấm **Mẫu** tải file Excel → điền → **Nhập mới** (hoặc **Cập nhật** để sửa hàng loạt).\n**Không làm được?**\n- Không thấy **Thêm đối tác** → nhờ Admin cấp Đối tác · Quản trị.\n- Đối tác không hiện khi chọn ở HĐ NCC / HĐ nhận thầu → chưa tích đúng phân loại hoặc đang **Ngưng dùng**.\n- Đề nghị chi báo NCC chưa có số tài khoản → sửa đối tác, điền **Ngân hàng**, **Tài khoản**.\n**Lưu ý:**\n- Thùng rác = ngưng sử dụng (giữ lịch sử), không xóa hẳn. Nên ghi MST để hóa đơn XML / AI tự tìm đúng NCC; tránh tạo trùng MST.",
  "source": "docs"
 },
 {
  "id": "so-tay-hop-dong-them-hd-ncc",
  "title": "Thêm hợp đồng nhà cung cấp (đọc hợp đồng bằng AI)",
  "module": "Hợp đồng",
  "routes": [
   {
    "route": "/hd/supplier",
    "label": "HĐ Nhà cung cấp"
   }
  ],
  "permission": "Hợp đồng nhà cung cấp · Quản trị",
  "keywords": "them hop dong ncc tao hop dong nha cung cap hd ncc doc hop dong ai chup hop dong pdf hop dong mua ban hop dong cung ung don gia hd dinh kem hop dong sua xoa hop dong them hop dong nha cung cap (doc hop dong bang ai)",
  "questions": "tao hop dong nha cung cap · ai doc file hop dong pdf · thay nut them hop dong · them don gia vao hop dong ncc · dinh kem file hop dong da ky · chon nha cung cap hop dong",
  "body": "**Khi nào:** ký hợp đồng mua bán / cung ứng / dịch vụ với NCC, cần lưu vào Vioo.\n**Các bước:**\n1. Hợp đồng → **HĐ Nhà cung cấp** → **Thêm hợp đồng**.\n2. Có file: bấm **Đọc hợp đồng (AI)**, chọn ảnh chụp hoặc PDF → AI điền mã, tên, NCC (theo MST), giá trị, ngày ký / hiệu lực / hết hạn, điều khoản thanh toán vào ô trống. Kiểm lại.\n3. Điền thêm: **Mã hợp đồng**, **Tên hợp đồng**, **Dự án**, **Nhà cung cấp**, **Trạng thái**; đính file hợp đồng.\n4. Bấm **Lưu hợp đồng**.\n5. Bấm **Xem chi tiết** (biểu tượng mắt): tab **Đơn giá** → **Thêm đơn giá**; tab **Tài liệu** tải thêm file.\n**Không làm được?**\n- Không thấy **Thêm hợp đồng**, có dòng \"Bạn đang có quyền xem…\" → nhờ Admin cấp Hợp đồng nhà cung cấp · Quản trị.\n- Báo \"Vui lòng chọn dự án liên kết\" / thiếu mã, tên → điền đủ ô có dấu *.\n- Không thấy NCC trong danh sách → đối tác chưa tích phân loại Nhà cung cấp hoặc đang ngừng dùng; sửa ở **Đối tác**.\n- AI báo chưa cấu hình / hết lượt → điền tay như thường.\n**Lưu ý:**\n- Xóa (thùng rác) là xóa hẳn; HĐ kết thúc nên đổi **Trạng thái**. HĐ nguyên tắc gọi hàng theo tháng: Mua hàng cũng khai được ở tab **Hợp đồng nguyên tắc** → **Khai HĐ mới**.",
  "source": "docs"
 },
 {
  "id": "so-tay-hop-dong-them-hd-nhan-thau",
  "title": "Tạo hợp đồng nhận thầu với chủ đầu tư",
  "module": "Hợp đồng",
  "routes": [
   {
    "route": "/hd/customer",
    "label": "HĐ Nhận thầu"
   }
  ],
  "permission": "Hợp đồng khách hàng · Quản trị",
  "keywords": "hop dong nhan thau hop dong chu dau tu hd cdt tao hd nhan thau hop dong khach hang phu luc hop dong gia tri hop dong bao lanh loai hop dong mau hop dong tao hop dong nhan thau voi chu dau tu",
  "questions": "tao hop dong chu dau tu · khai hd nhan thau du an · chon chu dau tu · danh sach loai hop dong · thay nut tao hd nhan thau · them phu luc hop dong cdt",
  "body": "**Khi nào:** ký hợp đồng thi công với chủ đầu tư; cần có để lập đợt thu ở Tài chính → Phải thu.\n**Các bước:**\n1. Hợp đồng → **HĐ Nhận thầu** → **Tạo HĐ nhận thầu**.\n2. Chọn **Dự án**, **Loại hợp đồng**, **Chủ đầu tư** (thông tin đại diện, MST, tài khoản tự điền từ hồ sơ đối tác).\n3. Nhập **Số hợp đồng**, tên, phụ lục (nếu có); phần **Giá trị và thời hạn**: tiền, VAT, **Trạng thái**, ngày ký, ngày hiệu lực.\n4. Điền các ô bắt buộc ở **Trường dữ liệu theo mẫu** (tùy loại hợp đồng); đính file.\n5. Bấm **Lưu HĐ nhận thầu**. Mở lại bằng biểu tượng mắt ở danh sách.\n**Không làm được?**\n- Không thấy nút, có dòng \"Bạn đang có quyền xem…\" → nhờ Admin cấp Hợp đồng khách hàng · Quản trị.\n- Không có chủ đầu tư để chọn → đối tác chưa tích phân loại **Chủ đầu tư** hoặc đang ngừng dùng; sửa ở **Đối tác**.\n- Báo \"Chọn loại hợp đồng\" mà danh sách trống → người có quyền Mẫu hợp đồng khai ở **Loại HĐ & Mẫu**.\n- Báo \"Nhập …\" → ô bắt buộc của mẫu còn trống.\n**Lưu ý:**\n- Đợt đề nghị thanh toán, phiếu thu tiền CĐT làm ở Tài chính → **Phải thu**, không làm ở màn hợp đồng.",
  "source": "docs"
 },
 {
  "id": "so-tay-ke-hoach-tuan",
  "title": "Lập kế hoạch thi công tuần / tháng",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Kế hoạch tháng/tuần · Lập/sửa kế hoạch + Gửi duyệt",
  "keywords": "ke hoach tuan ke hoach thang lap ke hoach thi cong kh tuan kh thang lich thi cong gui duyet ke hoach ban dieu chinh ke hoach tuan nay khoi luong du kien lap ke hoach thi cong tuan / thang",
  "questions": "lap ke hoach tuan · lap ke hoach thang du an · ke hoach tuan gui ai duyet · ko lap ke hoach tuan truoc · kh tuan da duyet sua · thay nut lap ke hoach tuan",
  "body": "**Khi nào:** đầu tuần / đầu tháng, lập khối lượng định làm trong kỳ để so với thực tế.\n**Các bước:**\n1. Gõ \"kế hoạch tuần\" ở ô Tìm kiếm → chọn dự án (hoặc mở dự án → **Kế hoạch**) → chọn **Thi công**, rồi **Tuần** hoặc **Tháng**; mũi tên để đổi kỳ.\n2. Bấm **Lập kế hoạch tuần** (tháng): hệ thống gợi ý sẵn việc có lịch trong kỳ theo bảng tiến độ.\n3. Sửa khối lượng, ngày, tổ đội; thiếu việc thì **Thêm công việc**.\n4. **Lưu nháp** → chọn **Người duyệt** (hoặc Tất cả người có quyền duyệt) → **Gửi duyệt**.\n5. KH tuần do người có quyền Duyệt KH tuần (CHT) duyệt, KH tháng do người có quyền Duyệt KH tháng. Bản duyệt đầu là bản gốc.\n**Không làm được?**\n- Không có nút Lập → thiếu quyền \"Lập/sửa kế hoạch\" trong Room Kế hoạch tháng/tuần → nhờ Admin.\n- \"Kỳ đã kết thúc\" → kỳ đã qua chỉ xem, lập cho kỳ sau.\n- KH đã duyệt muốn đổi → **Tạo bản điều chỉnh**, chọn lý do chính, mô tả ≥ 10 ký tự → **Gửi duyệt…**; chỉ sửa phần từ hôm nay.\n- Không tự duyệt được bản mình lập / gửi → cần người khác duyệt.\n**Lưu ý:**\n- Cột Thực hiện tự lấy từ Nhật ký đã duyệt, không nhập tay.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-bao-cao-nxt",
  "title": "Báo cáo nhập xuất tồn, xuất Excel NXT",
  "module": "Kho",
  "routes": [
   {
    "route": "/reports",
    "label": "Báo cáo kho"
   }
  ],
  "permission": "Xem kho (Phân quyền kho); Đồng bộ MISA chỉ Admin",
  "keywords": "bao cao nhap xuat ton nxt xuat excel nxt bao cao kho thang the kho theo kho lich su giao dich misa in pdf bao cao ton kho cuoi ky dau ky bao cao nhap xuat ton, xuat excel nxt",
  "questions": "xuat bao cao nhap xuat ton thang · tai excel nxt theo mau misa · bao cao kho theo ky · in bao cao ton kho · nut xuat excel nxt mo · lich su giao dich kho",
  "body": "**Khi nào:** cần số đầu kỳ / nhập / xuất / cuối kỳ theo kho cho kế toán hoặc báo cáo tháng.\n**Các bước:**\n1. Kho vật tư → **Báo cáo** (màn \"Thẻ kho / Báo cáo nhập xuất tồn\").\n2. Chọn **Từ ngày**, **Đến ngày**, kho (**Tất cả kho** nếu được xem mọi kho), vật tư.\n3. Tab **Nhập xuất tồn**: Đầu kỳ · Nhập kho · Xuất kho · Cuối kỳ (số lượng + giá trị); bấm một dòng để mở thẻ kho vật tư đó.\n4. Bấm **Xuất Excel NXT** (mẫu MISA) hoặc **In PDF**.\n5. Tab khác: **Thẻ kho vật tư**, **Thẻ kho theo kho**, **Lịch sử giao dịch** (lọc loại: Nhập mua hàng, Xuất cho công trình…).\n**Không làm được?**\n- **Xuất Excel NXT** mờ → đang tổng hợp, lỗi tải, hoặc kỳ / kho đang chọn không có dòng nào.\n- Không chọn được kho cần xem → bạn chỉ được xem một số kho (Phân quyền kho).\n- Giá trị trống / bằng 0 → hàng nhập chưa có giá, kế toán kho bổ sung.\n**Lưu ý:**\n- Nút **Đồng bộ MISA** chỉ Admin thấy.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-chuyen-kho",
  "title": "Chuyển kho giữa hai kho, nhận hàng chuyển đến",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Giao dịch kho · Thủ kho (kho gửi để gửi, kho nhận để nhận)",
  "keywords": "chuyen kho dieu chuyen vat tu gui hang sang kho khac nhan chuyen kho hang dang chuyen hoan hang ve kho tong tra hang ve kho cong truong khac chuyen kho giua hai kho, nhan hang chuyen den",
  "questions": "chuyen vat tu sang kho khac · dieu chuyen kho tong ra cong truong · cong truong tra hang thua ve kho tong · nhan hang chuyen kho · chuyen kho kho nhan chua thay · nhan thieu hang chuyen kho",
  "body": "**Khi nào:** đưa vật tư giữa hai kho (kho tổng ↔ công trường, công trường trả hàng thừa về kho tổng).\n**Các bước:**\n1. Kho gửi: Kho → **Chuyển kho** (hoặc **Tồn kho** → bấm vật tư → **Chuyển**).\n2. Chọn **Kho gửi**, **Kho nhận**; **Thêm vật tư** (chỉ hiện mã còn tồn), quy cách, SL; **Ngày chứng từ**, ghi chú.\n3. Bấm **Gửi hàng**: hàng rời kho gửi, phiếu ở trạng thái đang chuyển.\n4. Kho nhận: Kho → **Hàng về chờ nhận** → mở phiếu → nhập số nhận lần này → **Xác nhận số đã nhận**. Nhận thiếu thì phần còn lại vẫn đang chuyển, nhận tiếp lần sau.\n**Không làm được?**\n- Không thấy nút **Chuyển kho** → bạn chưa là thủ kho kho nào (chỉ xem).\n- Dòng báo \"vượt tồn\" / **Gửi hàng** mờ → SL lớn hơn tồn, hoặc chưa chọn kho nhận khác kho gửi.\n- Kho nhận không thấy phiếu → người nhận chưa là thủ kho kho đó (Admin giao ở Phân quyền kho).\n**Lưu ý:**\n- Hàng từ Kho Tổng chuyển sang công trường thì chi phí vào dự án của công trường khi nhận.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-doi-chieu-nhan-hang",
  "title": "Đợt giao treo lâu: đối chiếu nhận hàng với Mua hàng",
  "module": "Kho",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   },
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Mua hàng · Quản trị và thủ kho của kho nhận",
  "keywords": "doi chieu nhan hang dot giao treo phieu nhap treo lau chua nhan hang ve chua nhap kho xac nhan mua hang thu kho ghi so ve du ve thieu khong ve ton dong dot giao treo lau: doi chieu nhan hang voi mua hang",
  "questions": "dot giao treo lau chua nhap kho xu ly · doi chieu nhan hang · hang ve lau chua nhan · ncc giao phieu nhap van treo · ai ghi so doi chieu · ghi so doi chieu",
  "body": "**Khi nào:** phiếu nhập theo đơn treo nhiều ngày (hàng đã về mà chưa nhận trên máy, hoặc NCC không giao).\n**Các bước:**\n1. Mua hàng → tab **Đối chiếu nhận hàng** (thủ kho: Kho → nút **⋯** → **Đối chiếu nhận hàng**).\n2. Bấm ô **Cần bạn xử lý** / **Treo trên 30 ngày**, mở đợt giao.\n3. Chọn **Về đủ**, **Về thiếu / dư** hoặc **Không về**; nhập SL thực nhận, **Ngày hàng về thực tế**, lý do khi lệch; chọn phần PO chưa giao: chờ NCC giao tiếp hay chốt thiếu.\n4. Mỗi bên (Mua hàng, thủ kho) bấm **Lưu & xác nhận** / **Xác nhận**; không đồng ý thì **Từ chối** kèm lý do.\n5. Đủ 2 xác nhận → thủ kho bấm **Ghi sổ**: nhập kho, chi phí, công nợ theo ngày hàng về.\n**Không làm được?**\n- Báo \"Một người không xác nhận cả hai phía\" → người phía còn lại phải xác nhận.\n- Báo \"Chỉ thủ kho của kho nhận (hoặc Admin) được ghi sổ\" → nhờ đúng thủ kho.\n- Báo \"PO còn đợt giao khác đang mở\" → ghi sổ các đợt đó trước khi chốt thiếu.\n**Lưu ý:**\n- Sửa nội dung sau khi bên kia đã xác nhận thì xác nhận cũ mất hiệu lực.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-du-lieu-drive",
  "title": "Mở Kho dữ liệu (Google Drive, Synology Drive)",
  "module": "Chung",
  "routes": [
   {
    "route": "/storage",
    "label": "Kho dữ liệu"
   }
  ],
  "permission": "Tệp lưu trữ · Xem",
  "keywords": "kho du lieu google drive synology drive nas tai lieu cong ty thu muc chung tai tep len upload chia se tep luu tru file mo kho du lieu (google drive, synology drive)",
  "questions": "kho du lieu cong ty · tai file len kho du lieu · mo google drive cong ty · synology drive · bam file mo · chia se tep dong nghiep · thay muc kho du lieu",
  "body": "**Khi nào:** cần mở thư mục tài liệu chung của công ty trên Google Drive hoặc Synology Drive.\n**Các bước:**\n1. Thanh bên → **Kho dữ liệu**.\n2. Chọn tab **Google Drive** hoặc **Synology Drive**; thư mục hiện ngay trong trang.\n3. Bấm nút **Mở trong tab mới** (biểu tượng mũi tên ra ngoài) để làm việc đầy đủ trên Drive.\n4. Tải tệp lên / chia sẻ: làm trên Google Drive hoặc Synology vừa mở, theo quyền tài khoản Drive của bạn.\n**Không làm được?**\n- Bấm tệp không mở trong trang → Google chặn mở bên trong, tệp sẽ mở ở tab mới.\n- Không tải lên được → Vioo chỉ hiển thị thư mục; quyền ghi do Google / Synology quyết định → nhờ người quản lý thư mục cấp quyền.\n- Không thấy mục **Kho dữ liệu** → thiếu quyền \"Tệp lưu trữ · Xem\".\n- Trang trắng → bấm **Tải lại**, hoặc mở trong tab mới.\n**Lưu ý:**\n- Tệp đính kèm của phiếu (quy trình, đề xuất, văn bản) lưu trong từng phiếu, không nằm ở đây.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-hoan-tra-tu-to-doi",
  "title": "Tổ đội trả lại vật tư thừa, xuất cấp nhầm",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   },
   {
    "route": "/operations",
    "label": "Xuất cấp thi công"
   }
  ],
  "permission": "Giao dịch kho · Thủ kho (kho xuất); hủy duyệt cần Giao dịch kho · Hủy duyệt",
  "keywords": "hoan tra vat tu thua to doi tra lai kho xuat nham huy duyet phieu xuat quyet toan xuat cap da dung hao hut thau phu tra vat tu nhap tra cong trinh to doi tra lai vat tu thua, xuat cap nham",
  "questions": "to doi tra vat tu thua nhap kho · xuat cap nham huy · quyet toan vat tu da xuat thau phu · ghi nhan to doi da dung het · huy phieu xuat kho da ghi so",
  "body": "**Khi nào:** tổ đội / thầu phụ trả vật tư thừa về kho, hoặc thủ kho xuất cấp nhầm.\n**Các bước:**\n1. Kho → nút **⋯** → **Trả lại · quyết toán xuất cấp** → tìm phiếu ở **Danh sách phiếu xuất cấp**.\n2. Trả thừa: **Hoàn trả**, nhập SL từng dòng (≤ \"Có thể hoàn\"), lý do, ngày → **Xác nhận**. Phiếu hoàn vào **Hàng về chờ nhận** của kho; thủ kho duyệt nhập thì mới cộng tồn.\n3. Quyết toán phần tổ đội còn giữ: **Đã dùng** hoặc **Hao hụt**.\n4. Xuất nhầm, hàng chưa rời kho: **Hủy duyệt - hàng chưa giao**, tích xác nhận hàng chưa rời kho → **Xác nhận**: hệ thống lập chứng từ nhập đảo, giữ phiếu gốc.\n**Không làm được?**\n- Không thấy **Hủy duyệt - hàng chưa giao** → tổ đội đã nhận / đã hoàn một phần, hoặc bạn thiếu quyền Hủy duyệt.\n- Báo \"Số lượng vượt giới hạn\" → dữ liệu vừa đổi, tải lại xem phần còn có thể hoàn.\n**Lưu ý:**\n- Mỗi dòng: Đã xuất = Đã trả + Đã dùng + Hao hụt + Còn giữ.\n- Hàng thừa từ kho công trường về kho tổng: dùng **Chuyển kho**.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-in-phieu",
  "title": "In phiếu nhập, xuất, chuyển kho ra giấy / PDF",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Người xem được phiếu của kho (thủ kho, người lập, người được xem kho)",
  "keywords": "in phieu nhap kho in phieu xuat kho in phieu pdf phieu kho luu pdf in chung tu kho in phieu chuyen kho tim phieu so phieu in phieu nhap, xuat, chuyen kho ra giay / pdf",
  "questions": "in phieu nhap kho · in phieu xuat kho to doi ky · luu phieu kho ra pdf · bam in phieu ra · tim phieu xuat thang truoc",
  "body": "**Khi nào:** cần bản giấy / PDF phiếu nhập, xuất, chuyển kho để ký.\n**Các bước:**\n1. Kho → **Sổ phiếu** (phiếu đã xong) hoặc **Việc cần làm** (phiếu đang chờ).\n2. Gõ số phiếu, NCC, vật tư vào ô tìm; chọn kho ở hàng nút trên cùng nếu cần → bấm phiếu.\n3. Cuối phiếu bấm **In phiếu** (mở hộp in) hoặc **PDF** (chọn \"Save as PDF\" trong hộp in).\n**Không làm được?**\n- Báo \"Không mở được cửa sổ in\" → trình duyệt chặn cửa sổ bật lên → cho phép pop-up của trang rồi bấm lại.\n- Không thấy phiếu ở Sổ phiếu → phiếu thuộc kho bạn không được xem, hoặc phiếu còn chờ (xem Việc cần làm); Sổ phiếu chỉ hiện 200 phiếu mới nhất — gõ để tìm.\n**Lưu ý:**\n- Đơn mua: **In đề nghị duyệt** trong đơn ở Mua hàng. Đề xuất vật tư: **In đề xuất** trong phiếu.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-khong-thay-kho",
  "title": "Không thấy kho của mình, không có nút xuất nhập",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   },
   {
    "route": "/wms/owners",
    "label": "Phân quyền kho"
   }
  ],
  "permission": "Mọi người xem được Phân quyền kho; chỉ Admin sửa",
  "keywords": "khong thay kho thu kho phan quyen kho chi xem khong co nut xuat kho khong co nut chuyen kho cap quyen thu kho giao thu kho ban giao thu kho duyet ngoai le khong thay kho cua minh, khong co nut xuat nhap",
  "questions": "thay kho cong truong · thu kho nut xuat cap · bao chua kho · cap quyen thu kho nguoi · ban giao thu kho khi nghi viec · ai duyet xuat huy sua so nhan",
  "body": "**Khi nào:** vào Kho mà không thấy kho, chỉ thấy chữ \"Chỉ xem\", hoặc thiếu nút Chụp phiếu giao / Xuất cấp / Chuyển kho.\n**Các bước:**\n1. Kho vật tư → **Phân quyền kho**: tìm tên mình, xem mục **Xem kho** và **Thủ kho ở kho nào**.\n2. Chỉ có Xem kho → xem được tồn, phiếu nhưng không thao tác; nút thao tác chỉ hiện với thủ kho của kho đó.\n3. Báo Admin giao. Admin bấm tên người (hoặc **Phân quyền cho một người**) → tick kho ở **Thủ kho ở kho nào** (hoặc **Điền nhanh** theo mẫu, **Giống một người…**) → **Lưu**.\n4. Người nghỉ / đổi việc: Admin dùng **Bàn giao** để chuyển hết việc kho sang người mới.\n**Không làm được?**\n- Báo \"Bạn chưa được xem kho nào\" → chưa được giao Xem kho / Thủ kho ở kho nào.\n- Báo \"Chỉ Admin sửa được phân quyền kho\" → nhờ Admin.\n- Duyệt xuất hủy, sửa số nhận nhầm, duyệt kiểm kê cần việc **Duyệt ngoại lệ**; cấp mã cần **Cấp mã**.\n**Lưu ý:**\n- Thủ kho luôn xem được kho mình giữ; Cấp mã / Duyệt ngoại lệ / Kế toán kho tự kèm xem mọi kho.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-nhan-hang-theo-don",
  "title": "Nhận hàng NCC theo đơn (phiếu nhập chờ nhận)",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Giao dịch kho · Thủ kho (kho nhận)",
  "keywords": "nhan hang ncc nhap kho theo don po phieu nhap cho nhan hang ve cho nhan nhan thieu giao du ngay hang ve thuc nhan quet qr dot giao sl thuc te nhan hang ncc theo don (phieu nhap cho nhan)",
  "questions": "hang ncc ve nhap kho · nhan hang theo po · hang ve thieu · ncc giao du so don · quet qr phieu nhap · nut nhap kho mo · ngay hang ve ghi",
  "body": "**Khi nào:** đơn đã duyệt, xe NCC giao tới kho / công trường.\n**Các bước:**\n1. Kho → ô **Hàng về chờ nhận** (hoặc **Quét QR** trên phiếu NCC) → mở đúng đợt giao của đơn.\n2. Xem khung tiến độ đơn (Đơn đặt · Đã nhận trước · Đợt này · Còn sau đợt này); nhập **SL thực tế** cân / đếm được từng dòng.\n3. Chọn **Ngày hàng về thực tế**; đính kèm phiếu cân, biên bản nếu có.\n4. Nhận thiếu: chọn **NCC giao tiếp phần còn lại** hoặc **Chốt thiếu — báo Mua hàng**.\n5. Bấm **Nhận hàng & nhập kho** → hộp **Kiểm lại trước khi nhập kho** hiện đúng số sẽ ghi → bấm **Nhập kho …**.\n**Không làm được?**\n- Nút nhập kho mờ, ghi \"Tích xác nhận đã kiểm tra…\" → có điểm bất thường (nhận quá ít hoặc gấp nhiều lần số phiếu, vượt đơn, kho đã có phiếu nhập ngoài đơn cùng vật tư) → cân / đếm lại rồi tích \"Tôi đã cân/đếm lại…\".\n- Cảnh báo \"Vượt đơn\" → chỉ xác nhận khi NCC giao dư thật; không thì sửa số.\n- \"Còn điểm phải sửa\" → thiếu số thực nhận, ngày về sau hôm nay, hoặc chưa chọn cách xử lý phần thiếu.\n- Không thấy phiếu → đơn chưa duyệt, hoặc bạn không phải thủ kho kho nhận.\n**Lưu ý:**\n- Chỉ có tờ giao hàng của NCC thì dùng **Chụp phiếu giao**.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-nhap-hang-khong-co-don",
  "title": "Hàng về mà không có đơn mua, không có nút Nhập kho",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Giao dịch kho · Thủ kho",
  "keywords": "khong co nut nhap kho nhap kho tu do hang ve khong co po chua co don nhap kho ngoai don phieu nhap le luu nhan sau ncc giao truoc hang ve ma khong co don mua, khong co nut nhap kho",
  "questions": "nut nhap kho · hang ve chua po nhap kho · nhap kho hang don · ncc giao truoc khi don · bao da bo phieu nhap tu",
  "body": "**Khi nào:** xe giao hàng tới nhưng chưa có đơn mua, hoặc muốn nhập kho tự do như trước.\n**Các bước:**\n1. Phiếu nhập tự do đã bỏ: hàng chỉ vào kho qua đợt giao của đơn mua, hàng chuyển đến, hàng trả lại từ công trình, hoặc kiểm đếm.\n2. Kho → **Chụp phiếu giao** → chụp tờ giao hàng, kiểm NCC và dòng hàng.\n3. Chưa có đơn khớp → **Lưu, nhận sau**: phiếu sang Mua hàng → **Phiếu giao chờ** để Mua hàng tạo NCC / lập đơn.\n4. Đơn duyệt xong: mở lại phiếu chụp ở **Việc cần làm** → chọn đơn → **Nhận hàng**.\n**Không làm được?**\n- Báo \"Đã bỏ phiếu nhập tự do…\" → làm theo bước 2–4.\n- Hàng có thật mà sổ không có, không có đơn / nguồn → kiểm đếm, chọn nguyên nhân \"Hàng về chưa nhập sổ\" (chỉ chỉnh tồn, không ghi công nợ NCC).\n**Lưu ý:**\n- Mua gấp, nhỏ lẻ ở công trường: dùng **Mua nóng** ở Mua hàng.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-quy-cach",
  "title": "Một mã nhiều quy cách: xem tồn, chuyển quy cách",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   },
   {
    "route": "/material-code-requests",
    "label": "Danh mục vật tư"
   }
  ],
  "permission": "Chuyển quy cách: thủ kho của kho, Kế toán kho hoặc Admin",
  "keywords": "quy cach mot ma nhieu quy cach ton theo quy cach chuyen quy cach gan quy cach ton kho loai thuong hieu cau hinh chon quy cach khi xuat quy cach cho ra mot ma nhieu quy cach: xem ton, chuyen quy cach",
  "questions": "ma vat tu nhieu loai ghi · quy cach vat tu · chuyen ton sang quy cach khac · xuat kho chon quy cach · gan quy cach hang ton cu · bao thieu quy cach khi lap de xuat",
  "body": "**Khi nào:** cùng một mã nhưng khác loại / thương hiệu / cấu hình (VD tôn mái và tôn biên) cần theo dõi riêng mà không tạo mã mới.\n**Các bước:**\n1. Đề xuất, đơn mua: ghi ô **Quy cách** của dòng; một mã nhiều dòng thì mỗi dòng một quy cách khác nhau.\n2. Xem tồn: Kho → **Tồn kho** → bấm vật tư → khung **Theo quy cách** (tồn của mã = cộng các quy cách).\n3. Xuất cấp / chuyển / hủy: chọn quy cách ở ô dưới tên vật tư; để **Tự lấy nhập trước** thì xuất từ quy cách nhập trước.\n4. Nhận nhầm quy cách hoặc tồn cũ chưa ghi: trong khung Theo quy cách bấm **Chuyển quy cách** / **Gắn quy cách cho hàng tồn** → chọn Từ / Sang quy cách, SL, lý do → **Lưu phiếu chuyển**.\n**Không làm được?**\n- Báo \"Thiếu quy cách\" / hai dòng cùng mã cùng quy cách → ghi quy cách khác nhau hoặc gộp dòng.\n- Báo chỉ thủ kho của kho này, Kế toán kho hoặc Admin được chuyển quy cách → nhờ đúng người.\n- Khác kích thước / giá / hệ số quy đổi → không phải quy cách, cần mã mới.\n**Lưu ý:**\n- Quy cách mới gõ tay chờ người Cấp mã rà ở Danh mục vật tư (ô **Quy cách chờ rà**).",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-sua-so-nhan-nham",
  "title": "Sửa số đã nhận nhầm (nhập kho thừa)",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Giao dịch kho · Duyệt ngoại lệ (kho nhận) hoặc Admin",
  "keywords": "sua so nhan nham nhap nham nhap thua sua phieu nhap da ghi so giam so nhan sai so can nhap sai so luong dieu chinh phieu nhap sua so da nhan nham (nhap kho thua)",
  "questions": "nhap kho nham so luong sua · phieu nhap da ghi so sua · lo nhap thua so · sua so nhan sau khi nhap kho · bam sua so nhan nham · nhap thieu sua tang",
  "body": "**Khi nào:** đợt giao theo đơn đã nhập kho nhưng số ghi lớn hơn số thực nhận.\n**Các bước:**\n1. Kho → **Sổ phiếu** → gõ số phiếu / NCC → mở phiếu nhập.\n2. Trong khung tiến độ đơn, bấm **Sửa số nhận nhầm**.\n3. Nhập số đúng từng dòng (chỉ được giảm) và lý do (số cân thực tế, ai phát hiện) → lưu.\n4. Hệ thống ghi phiếu điều chỉnh kho, giảm công nợ NCC, đơn mở lại phần thiếu; mục \"Đã sửa số nhận\" giữ trước → sau.\n**Không làm được?**\n- Nút mờ, ghi người đã duyệt nhận không tự sửa → nhờ người Duyệt ngoại lệ khác.\n- Không thấy nút → bạn chưa có việc Duyệt ngoại lệ ở kho này (Admin giao ở Phân quyền kho).\n- Số đúng lớn hơn số đã nhận → không sửa tăng; phần còn lại nhận qua **NCC giao tiếp**.\n- Báo \"Công nợ của đợt đã có…\" → báo kế toán điều chỉnh công nợ; kho chỉnh qua kiểm kê.\n- Đơn gọi hàng theo HĐ nguyên tắc → Mua hàng điều chỉnh ở bảng đối soát tháng.\n**Lưu ý:**\n- Phiếu chưa ghi sổ thì sửa thẳng ô **SL thực tế** trước khi nhận.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-thep-cay-kg",
  "title": "Mua theo kg, kho tính theo cây (đơn vị khác nhau)",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   },
   {
    "route": "/material-code-requests",
    "label": "Danh mục vật tư"
   }
  ],
  "permission": "Lập đơn: Mua hàng · Quản trị; đổi hệ số: Danh mục kho · Sửa mã vật tư",
  "keywords": "thep cay kg don vi mua don vi kho quy doi he so quy doi mua theo don vi khac kg cay tan thep d16 thep hinh sl mua sl kho dvt dv mua mua theo kg, kho tinh theo cay (don vi khac nhau)",
  "questions": "thep mua theo kg kho tinh cay · quy doi kg sang cay · don vi mua khac don vi kho · ncc bao gia theo tan · sua he so quy doi vat tu · phieu giao ghi kg don tinh cay",
  "body": "**Khi nào:** NCC bán theo kg / tấn nhưng kho theo dõi theo cây (hoặc ngược lại).\n**Các bước:**\n1. Lập đơn: ở dòng vật tư bấm **+ Mua theo đơn vị khác** (đơn từ Cần mua ghi thêm \"VD kg ↔ cây\").\n2. Nhập **SL mua** và **ĐV mua** (VD kg); **Đơn giá** tính theo đơn vị mua. Dòng hiện **SL kho** (cây) và \"1 kg = … cây\".\n3. SL mua tự quy đổi theo hệ số của mã; cân thực tế khác thì gõ tay, bấm **Tự quy đổi** để về số tính sẵn.\n4. Thủ kho nhận bằng phiếu chụp: dòng ghi \"đơn tính theo …\" khi phiếu khác đơn vị với đơn → nhập số theo đơn vị của đơn.\n**Không làm được?**\n- Lưu đơn báo SL hoặc đơn giá chưa hợp lệ → kiểm ô SL mua / ĐV mua của dòng đổi đơn vị.\n- Hệ số của mã sai → người có quyền Sửa mã vật tư mở mã ở Danh mục vật tư → **Sửa** ô **ĐV mua** và **1 ĐV mua = ? ĐVT kho** (ghi lý do).\n- Báo \"Mã đã có chứng từ nên không đổi được đơn vị tính kho\" → giữ ĐVT kho, chỉ đổi đơn vị mua / hệ số.\n**Lưu ý:**\n- Báo giá (Excel / chụp) ghi cả số cây và kg không khớp hệ số: đơn giữ SL mua theo báo giá để tiền đúng.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-ton-the-kho",
  "title": "Xem tồn một vật tư ở các kho và thẻ kho",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   },
   {
    "route": "/reports",
    "label": "Báo cáo kho"
   }
  ],
  "permission": "Xem kho (Phân quyền kho) — chỉ thấy kho được xem",
  "keywords": "ton kho con bao nhieu xem ton vat tu the kho lich su nhap xuat ton cac kho kho khac dang co dang ve gia binh quan xuat excel ton kho chua co gia xem ton mot vat tu o cac kho va the kho",
  "questions": "thep d16 con bao nhieu kho · ton vat tu tat ca cac kho · the kho · lich su nhap xuat vat tu · xuat excel ton kho · ton kho chua gia · ton kho cong truong",
  "body": "**Khi nào:** cần biết vật tư còn bao nhiêu, ở kho nào, nhập xuất ra sao.\n**Các bước:**\n1. Kho → chọn **Mọi kho** hoặc tên kho ở hàng nút trên cùng → **Tồn kho**.\n2. Gõ tên / mã / nhóm vào ô tìm; mỗi dòng ghi tồn, \"đang về\", giá trị tạm tính.\n3. Bấm vào vật tư: xem Tồn, Giá bình quân, Đang về, Xuất 30 ngày, **Kho khác đang có**, **Theo quy cách**.\n4. Khung **Thẻ kho** liệt kê từng chứng từ nhập / xuất và tồn sau mỗi dòng (bấm **Xem đủ N dòng**).\n5. Xuất danh sách đang lọc: nút Excel cạnh ô tìm.\n**Không làm được?**\n- Báo \"Bạn chưa được xem kho nào\" → nhờ Admin cấp ở Phân quyền kho.\n- Nhãn **chưa có giá** → hàng nhập chưa có đơn giá, kế toán kho bổ sung.\n- Nhãn \"… ngày không biến động\" hoặc ô **Cần kiểm tra** có số → có thể đã dùng mà chưa ghi xuất → kiểm đếm để chỉnh.\n**Lưu ý:**\n- Hỏi nhanh Trợ lý \"tồn thép D16 kho SMB\".\n- Thẻ kho theo khoảng ngày, theo kho: Báo cáo → **Thẻ kho vật tư** / **Thẻ kho theo kho**.",
  "source": "docs"
 },
 {
  "id": "so-tay-kho-xuat-huy",
  "title": "Xuất hủy vật tư hỏng, mất",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Lập: Giao dịch kho · Thủ kho; duyệt: Giao dịch kho · Duyệt ngoại lệ",
  "keywords": "xuat huy huy vat tu hong mat mat het han hao hut vuot dinh muc thanh ly vat tu hu hong duyet ngoai le phieu huy cho duyet xuat huy vat tu hong, mat",
  "questions": "vat tu hong xuat huy · hang mat ghi so · ai duyet phieu xuat huy · duyet phieu huy lap · phieu xuat huy cho duyet",
  "body": "**Khi nào:** vật tư trong kho hư hỏng, mất mát, hết hạn hoặc hao hụt vượt định mức.\n**Các bước:**\n1. Kho → **Xuất hủy** (hoặc **Tồn kho** → bấm vật tư → **Hủy**).\n2. Chọn kho, **Lý do**: Hư hỏng / Mất mát / Hết hạn sử dụng / Hao hụt vượt định mức.\n3. **Thêm vật tư**, quy cách, SL (không vượt tồn); ngày chứng từ, ghi chú → **Gửi duyệt**.\n4. Người Duyệt ngoại lệ mở Kho → ô **Chờ duyệt** → bấm phiếu → **Duyệt phiếu** hoặc **Từ chối phiếu**. Duyệt xong tồn mới trừ.\n**Không làm được?**\n- Không duyệt được phiếu do chính mình lập (kể cả Admin) → nhờ người Duyệt ngoại lệ khác.\n- Không thấy nút **Xuất hủy** → bạn chưa là thủ kho kho nào.\n- Không ai duyệt → kho chưa có người Duyệt ngoại lệ → Admin giao ở Phân quyền kho.\n**Lưu ý:**\n- Hàng thiếu phát hiện khi kiểm kê: chọn nguyên nhân trong phiên kiểm đếm, không cần lập phiếu hủy riêng.",
  "source": "docs"
 },
 {
  "id": "so-tay-kiem-ke",
  "title": "Kiểm kê kho",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   },
   {
    "route": "/audit",
    "label": "Kiểm kê"
   }
  ],
  "permission": "Đếm: thủ kho của kho; Duyệt: Duyệt ngoại lệ, quản trị Kho vật tư hoặc Admin",
  "keywords": "kiem ke kho kiem dem dem hang doi chieu ton chenh lech kiem ke cuoi thang dem mu giai trinh chenh lech duyet kiem ke ton ao lech ton chot tieu hao kiem ke kho",
  "questions": "kiem ke kho · ton may lech thuc te sua · kiem dem cuoi thang · ai duyet kiem ke · lap phien kiem ke · nop ket qua dem dem · kiem ke lech",
  "body": "**Khi nào:** cuối tháng, chốt tiêu hao, hoặc nghi tồn lệch.\n**Các bước:**\n1. Kho → **Kiểm đếm** (hoặc mở vật tư → **Kiểm đếm**): chọn kho, phạm vi **1 mã** / **Nhóm vật tư** / **Cả kho**, lý do; nên để **Đếm mù** → **Bắt đầu đếm N mã**.\n2. Nhập số đếm từng dòng (**Đếm theo quy cách** nếu có) → **Lưu**; hàng có mà sổ không có: chọn ở ô **Thêm vật tư có thực tế nhưng ngoài sổ…** → **Thêm**.\n3. Đếm đủ → **Nộp kết quả đếm** (số đếm khóa, hiện chênh lệch).\n4. Chọn nguyên nhân cho từng dòng chênh (VD \"Đã dùng thi công, chưa lập phiếu xuất\") → **Lưu giải trình**.\n5. Người duyệt mở phiên ở ô **Chờ duyệt** → **Duyệt & ghi sổ** (tồn khớp số đếm) hoặc **Từ chối** để đếm lại.\n**Không làm được?**\n- Báo \"Kho này đang có một phiên kiểm kê chưa xong\" → làm nốt hoặc **Hủy phiên** cũ.\n- Người lập / người nộp không tự duyệt được → nhờ người duyệt khác.\n- **Duyệt & ghi sổ** mờ → còn dòng chênh chưa có nguyên nhân.\n- Ghi sổ báo tồn âm → đã xuất sau khi nộp; **Từ chối** để đếm lại dòng đó.\n**Lưu ý:**\n- Lịch sử kiểm kê kiểu cũ (trước 10/2026) xem ở màn Kiểm kê → **Lịch sử cũ**.",
  "source": "docs"
 },
 {
  "id": "so-tay-lap-don-hang",
  "title": "Lập đơn hàng mua (PO) từ báo giá",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "lap don hang po tao po mua hang dat hang bao gia nha cung cap nhap excel chup bao gia dan bao gia don mua chu dong du tru kho tong chot gia hang dat dai ngay lap don hang mua (po) tu bao gia",
  "questions": "lap po bao gia ncc · nhap bao gia excel vao don · chup bao gia ai doc · mua truoc khi de xuat · don chu dong · mua du tru kho tong · nut chup dan bao gia",
  "body": "**Khi nào:** có báo giá NCC, cần đặt hàng khi chưa có phiếu nhu cầu (chốt giá, hàng đặt dài ngày, bù tồn, dự trữ Kho Tổng).\n**Các bước:**\n1. Gõ \"lập đơn hàng\" ở ô Tìm kiếm (hoặc Mua hàng → **Đơn hàng (PO)**) → **Lập đơn chủ động**.\n2. Chọn **Cho một dự án** (dự án + kho nhận) hoặc **Dự trữ Kho Tổng**; chọn **Nhà cung cấp**, ngày, **Thuế VAT**, lý do mua chủ động.\n3. Thêm vật tư: **Nhập từ Excel** (có **Tải mẫu Excel**), **Chụp / dán báo giá** để AI đọc, hoặc gõ tìm từng mã; kiểm rồi bấm **Đưa N vật tư vào đơn**.\n4. Kiểm SL, đơn giá, quy cách; vật tư vượt / ngoài BOQ phải ghi lý do.\n5. **Lưu đơn nháp** → chọn người duyệt → **Gửi duyệt**.\n**Không làm được?**\n- Không có nút **Lập đơn chủ động** → thiếu quyền Mua hàng · Quản trị.\n- Nút Excel / báo giá mờ → chọn dự án và kho nhận trước. Không thấy **Chụp / dán báo giá** → Admin chưa gán kết nối AI.\n- Dòng ghi \"Chưa có mã trong danh mục\" → đề xuất cấp mã ở Danh mục vật tư rồi nhập lại.\n**Lưu ý:**\n- Đề xuất cùng vật tư đến sau sẽ hiện \"Đã có trong đơn chủ động\" ở phiếu Cần mua → bấm **Gắn …** thay vì mua thêm.\n- Đã có phiếu đề xuất thì lập đơn từ ô **Cần mua**.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-cap-tu-kho",
  "title": "Cấp đề xuất từ kho khác thay vì mua mới",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "cap tu kho chuyen kho tu kho khac kho tong con hang khong can mua dieu chuyen ton kho khac cap hang tu ton phieu chuyen cho de xuat cap de xuat tu kho khac thay vi mua moi",
  "questions": "kho khac con hang cap de xuat · mua lay kho tong · cap kho · thay nut cap kho · kho chua bat chuyen kho buoc · phieu chuyen cap kho dang",
  "body": "**Khi nào:** đề xuất công trường thiếu vật tư mà kho khác (kho tổng, công trường khác) còn tồn.\n**Các bước:**\n1. Mua hàng → **Cần mua** → mở phiếu đề xuất.\n2. Dòng còn thiếu có hàng ở kho khác sẽ có nút **Cấp từ kho** (kèm số tồn) và chữ \"N kho khác còn hàng\".\n3. Chọn kho gửi ở **Kho đang có hàng**, nhập **Số lượng chuyển** → **Lập phiếu chuyển**.\n4. Thủ kho kho gửi xuất hàng, thủ kho công trường nhận; nhận xong dòng đề xuất tính là đã nhận. Trạng thái trên dòng: Chờ kho gửi xuất → Đang chuyển → Đã nhận.\n**Không làm được?**\n- Không thấy **Cấp từ kho** → không kho nào khác còn tồn khả dụng của mã đó.\n- Kho bị mờ, ghi chưa bật chuyển kho 2 bước → nhờ quản trị bật cho kho, hoặc **Lập đơn hàng** mua mới.\n- Báo \"SL chuyển lớn hơn phần còn thiếu\" / \"Kho gửi không còn đủ hàng khả dụng\" → giảm SL, tải lại.\n**Lưu ý:**\n- Chi phí đi theo hàng theo giá vốn bình quân kho gửi.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-duyet-don",
  "title": "Duyệt hoặc trả lại đơn hàng (PO)",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị, được chọn làm người duyệt (hoặc Admin)",
  "keywords": "duyet don hang duyet po tra lai don cho ban duyet nguoi duyet vuot du toan vuot ngan sach phe duyet don mua hang truoc khi duyet duyet hoac tra lai don hang (po)",
  "questions": "duyet po · don cho duyet · thay nut duyet don · tra don hang nguoi lap · don vuot du toan duyet · duyet don mua hang",
  "body": "**Khi nào:** có đơn gửi cho bạn duyệt (có thông báo).\n**Các bước:**\n1. Mua hàng → **Đơn hàng (PO)** → ô **Lập & duyệt đơn** (ghi \"N chờ bạn duyệt\") → nhóm **Chờ bạn duyệt**.\n2. Mở đơn: xem khung **Trước khi duyệt** (điểm bất thường), dòng vật tư, đơn giá, VAT, tổng cộng.\n3. Đồng ý → **Duyệt đơn**: đơn chuyển \"Đã duyệt · chờ giao\"; đơn giao 1 lần có ngay phiếu nhập (QR) cho thủ kho.\n4. Không đồng ý → **Trả lại**, ghi lý do để người lập sửa.\n**Không làm được?**\n- Không thấy **Duyệt đơn** → bạn không phải người được chọn duyệt, hoặc bạn là người lập (không tự duyệt đơn mình).\n- Duyệt mà báo vượt dự toán vật tư → đơn chờ người duyệt vượt ngân sách ở Tài chính → Chi phí & ngân sách; xong bạn được báo để duyệt tiếp.\n**Lưu ý:**\n- Đơn đã duyệt không sửa được; điều chỉnh bằng đợt giao hoặc kết thúc thiếu (xem mục \"Sửa hoặc hủy đơn hàng đã duyệt\").",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-giao-nhan-viec",
  "title": "Giao phiếu cần mua cho người mua, nhận việc",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "giao viec mua hang nguoi xu ly nhan viec phan cong nguoi mua giao dong de xuat chia dong can mua viec cua toi chua giao nhan dong nay nguoi dieu phoi giao phieu can mua cho nguoi mua, nhan viec",
  "questions": "giao phieu de xuat nguoi mua · chia tung dong de xuat nhieu nguoi mua · nhan viec mua hang · viec mua · phieu mua chua giao ai · doi nguoi xu ly phieu mua",
  "body": "**Khi nào:** trưởng nhóm phân việc mua, hoặc người mua tự nhận phiếu / dòng.\n**Các bước:**\n1. Mua hàng → tab **Đơn hàng (PO)** → ô **Cần mua** (phiếu xếp theo dự án, có nhãn \"N chưa giao\").\n2. Giao cả phiếu: tick các phiếu → thanh dưới chọn **Giao cho…** → **Giao**; hoặc mở phiếu → ô **Người xử lý** chọn tên.\n3. Giao theo dòng: mở phiếu → tick các dòng → **Giao cho…** → **Giao**; tự nhận thì bấm **Nhận** hoặc **Nhận dòng này**.\n4. Người được giao nhận thông báo; chọn **Việc của tôi** ở ô **Mọi người xử lý** để lọc phần của mình.\n**Không làm được?**\n- Không có ô tick, ô Người xử lý chỉ là chữ → thiếu quyền Mua hàng · Quản trị.\n- Nút **Nhận** mờ → có dòng đã giao người khác → dùng **Giao cho…** nếu cần chuyển người.\n- Phiếu ghi \"Nguồn đã thu hồi\" → phiếu nguồn bị rút lại, không giao / lập đơn được.\n**Lưu ý:**\n- Dòng chưa giao riêng thuộc người xử lý (người điều phối) của phiếu; chọn **↩ Trả về người điều phối** để bỏ giao riêng.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-giao-nhieu-dot",
  "title": "NCC giao nhiều đợt: lập đợt giao",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "giao nhieu dot dot giao lap dot giao giao tung chuyen ncc giao nhieu lan giao bu phan thieu phieu nhap qr duyet bo sung huy dot giao thep tam giao nhieu lan giao lam nhieu lan giao tung dot giao tung dot ncc giao thieu giao bo sung nha cung cap giao nhieu lan ncc giao nhieu dot: lap dot giao",
  "questions": "ncc giao nhieu lan · lap dot giao · giao bu thieu · dot giao vuot gia tri don · thu kho chua thay phieu nhap dot giao · huy dot giao",
  "body": "**Khi nào:** hàng về nhiều chuyến, mỗi chuyến SL / giá / VAT có thể khác (VD thép tấm).\n**Các bước:**\n1. Lúc lập đơn chọn **Giao nhiều đợt** (đơn **Giao 1 lần** thì duyệt xong có ngay phiếu nhập cho thủ kho).\n2. Đơn đã duyệt: mở đơn → **Lập đợt giao** (đơn đã về một phần: **Giao bù phần thiếu**).\n3. Nhập **Ngày giao dự kiến**, VAT của đợt, chọn vật tư, SL và đơn giá của đợt.\n4. Trong giá trị đơn đã duyệt → **Tạo đợt & phiếu nhập kho**: thủ kho thấy ngay ở Kho → **Hàng về chờ nhận**.\n5. Vượt giá trị đơn → chọn người duyệt bổ sung → **Gửi duyệt bổ sung**; người đó bấm **Duyệt bổ sung** thì mới có phiếu nhập.\n**Không làm được?**\n- Không có **Lập đợt giao** → đơn chưa duyệt, đã giao đủ, hoặc mọi SL đã nằm trong đợt đang mở.\n- Đợt **Bị trả lại** → người lập đợt bấm **Sửa đợt** rồi gửi lại.\n- **Hủy đợt** chỉ được khi kho chưa bắt đầu nhận.\n**Lưu ý:**\n- Đơn gom nhiều dự án: mỗi đợt chọn một công trường nhận.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-gui-duyet-don",
  "title": "Gửi duyệt đơn hàng và xem đang chờ ai",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị (người lập đơn)",
  "keywords": "gui duyet don hang po cho duyet nguoi duyet don dang cho ai duyet don bi tra lai sua don nhap xoa nhap in de nghi duyet lich su don gui duyet don hang va xem dang cho ai",
  "questions": "gui duyet po · don hang dang cho ai duyet · nut gui duyet mo · don tra sua · xoa don nhap · ten nguoi duyet danh sach · in phieu de nghi duyet don",
  "body": "**Khi nào:** đã lưu đơn nháp, cần người có thẩm quyền duyệt.\n**Các bước:**\n1. Mua hàng → **Đơn hàng (PO)** → ô **Lập & duyệt đơn** → mở đơn (nhóm **Nháp** hoặc **Bị trả lại — cần sửa**).\n2. Chọn người ở ô **Chọn người duyệt…** → **Gửi duyệt**.\n3. Đơn đang chờ: dòng vàng ghi \"Đang chờ [tên] duyệt\"; mục **Lịch sử** ghi ai làm gì, lúc nào.\n4. Bị trả lại: đọc lý do ở dòng **Bị trả lại**, bấm **Sửa**, lưu rồi **Gửi duyệt** lại.\n5. Cần bản ký giấy: **In đề nghị duyệt**.\n**Không làm được?**\n- **Gửi duyệt** mờ → còn vật tư chưa có đơn giá → **Sửa** nhập đủ giá.\n- Không thấy **Sửa** / **Gửi duyệt** → chỉ người lập mới sửa và gửi đơn nháp / bị trả lại.\n- Không có tên trong danh sách duyệt → người duyệt phải có quyền Mua hàng · Quản trị (hoặc Admin) và không phải người lập.\n- Đơn vượt dự toán vật tư → chờ người duyệt vượt ngân sách ở Tài chính → Chi phí & ngân sách trước.\n**Lưu ý:**\n- **Xóa nháp** chỉ có với đơn chưa từng gửi duyệt.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-hop-dong-nguyen-tac",
  "title": "Gọi hàng theo hợp đồng nguyên tắc",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị, hoặc Gọi hàng HĐ NCC · Tạo của dự án",
  "keywords": "hop dong nguyen tac hd khung goi hang theo hd goi hang bang gia hd han muc doi soat thang be tong cat da ghi cong no khai hd moi goi hang theo hop dong nguyen tac",
  "questions": "goi hang theo hop dong nguyen · dat be tong theo hd khung · goi hang phai gui mua hang duyet · bang gia hd · doi soat hang thang ncc · vat tu chua gia hd",
  "body": "**Khi nào:** NCC đã có HĐ nguyên tắc kèm bảng giá; cần gọi hàng về công trường.\n**Các bước:**\n1. Mua hàng → tab **Hợp đồng nguyên tắc** (người công trường: tab **Hợp đồng**) → **Gọi hàng theo HĐ** (hoặc mở HĐ → **Gọi hàng theo HĐ này**).\n2. Chọn HĐ, kho nhận, **Ngày cần giao** (giá lấy theo bảng giá HĐ tại ngày này).\n3. Chọn vật tư từ bảng giá HĐ, nhập SL; ghi chú cho NCC / thủ kho.\n4. Bấm **Gửi NCC** (không cần duyệt): thủ kho kho nhận thấy phiếu nhập như đơn PO.\n5. Cuối tháng Mua hàng mở HĐ → **Lập bảng đối soát** → **Chốt & gửi kế toán** → kế toán **Ghi công nợ**.\n**Không làm được?**\n- Nút đổi thành **Gửi Mua hàng duyệt** → đơn vượt hạn mức / giá trị HĐ → chọn người duyệt; duyệt xong thủ kho mới thấy phiếu nhập.\n- Vật tư \"chưa có giá trong HĐ\" → nhập giá tạm, Mua hàng chốt khi đối soát; hoặc bổ sung bảng giá HĐ.\n- Các vật tư khác mức VAT → tách thành đơn riêng.\n- HĐ ghi **Hết hiệu lực** → không gọi hàng được.\n**Lưu ý:**\n- Khai HĐ mới: **Khai HĐ mới** (Mua hàng · Quản trị).",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-ket-thuc-thieu",
  "title": "Kết thúc thiếu đơn khi NCC không giao đủ",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "ket thuc thieu chot thieu don ncc het hang giao thieu dong don phan thieu ve can mua khong can nua po con thieu don treo giao mot phan ket thuc thieu don khi ncc khong giao du",
  "questions": "ncc giao thieu giao nua dong don · chot thieu po · thieu mua ncc khac · ket thuc thieu · bam ket thuc thieu bao con dot giao chua nhan · don treo giao",
  "body": "**Khi nào:** đơn đã nhận một phần (hoặc chưa nhận) và NCC không giao tiếp.\n**Các bước:**\n1. Mua hàng → **Đơn hàng (PO)** → ô **Đang giao** hoặc **Chờ giao** → mở đơn.\n2. Bấm **Kết thúc thiếu**.\n3. Chọn **Đưa phần thiếu về Cần mua** (mua tiếp NCC / đơn khác) hoặc **Không cần nữa** (nhu cầu xong với số đã nhận).\n4. Ghi lý do (bắt buộc, VD \"NCC hết hàng\") → **Kết thúc thiếu**. Đơn ghi \"Đã kết thúc thiếu\" kèm lý do.\n**Không làm được?**\n- Báo \"Còn đợt giao chưa nhận xong…\" → chờ kho nhận, hoặc **Hủy đợt** đó (khi kho chưa bắt đầu nhận).\n- Không thấy nút → đơn chưa duyệt, đã nhận đủ hoặc đã đóng; hoặc thiếu quyền Mua hàng · Quản trị.\n**Lưu ý:**\n- Lúc nhận thiếu, thủ kho chọn **Chốt thiếu — báo Mua hàng** (đơn dừng ở Về một phần) hoặc **NCC giao tiếp phần còn lại** (mở đợt mới chờ xe sau).",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-lap-don-tu-de-xuat",
  "title": "Lập đơn hàng từ phiếu cần mua (đề xuất)",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "lap don tu de xuat lap po tu can mua don gom nhieu du an gop nhieu de xuat mot don chia nhieu ncc lap don dong cua toi tach dong giao 1 lan giao nhieu dot lap don hang tu phieu can mua (de xuat)",
  "questions": "lap po de xuat vat tu · gop nhieu de xuat vao don · don nhieu du an · de xuat mua ncc · nut lap don gom mo · lap don chi vai dong phieu",
  "body": "**Khi nào:** phiếu nhu cầu (đề xuất công trường, kế hoạch vật tư) đã duyệt, cần đặt NCC.\n**Các bước:**\n1. Mua hàng → **Đơn hàng (PO)** → **Cần mua**: mở phiếu → **Lập đơn hàng**; hoặc tick nhiều phiếu → **Lập đơn hàng** (cùng công trường) / **Lập đơn gom N dự án**.\n2. Chia NCC: tick một số dòng trong phiếu → **Lập đơn N dòng**; dòng còn lại lập đơn khác.\n3. Chọn **Nhà cung cấp**, **Ngày đặt hàng**, **Ngày cần giao**, **Thuế VAT**, **Giao 1 lần** hoặc **Giao nhiều đợt**.\n4. Mỗi vật tư nhập **Đơn giá**, quy cách; SL đặt theo từng phiếu (giảm dưới số \"còn\" nếu mua một phần); **Tách dòng** khi khác quy cách / giá.\n5. **Lưu đơn nháp** → chọn người duyệt → **Gửi duyệt**.\n**Không làm được?**\n- **Lập đơn gom** mờ → có phiếu chưa chọn kho nhận → sửa kho nhận ở phiếu đề xuất trong dự án.\n- Phiếu nguồn Yêu cầu / Quy trình chỉ tiếp nhận và phân công, chưa đưa vào đơn được.\n- Không tìm thấy NCC → khai NCC mới ở Hợp đồng → Đối tác.\n- Báo có hai dòng cùng mã cùng quy cách → ghi quy cách khác nhau hoặc gộp lại.\n**Lưu ý:**\n- Đơn gom: mỗi đợt giao chọn một công trường; công nợ, chi phí ghi theo dự án nhận.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-phieu-giao-cho",
  "title": "Xử lý phiếu giao chờ (thủ kho chụp mà chưa nhận được)",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị (Mua hàng · Xem chỉ xem)",
  "keywords": "phieu giao cho phieu giao chup ncc moi chua khop ncc chua co don hang ve chua co po tao ncc tu phieu thu kho chup phieu lap don tu phieu giao xu ly phieu giao cho (thu kho chup ma chua nhan duoc)",
  "questions": "phieu giao cho · thu kho chup phieu chua don · ncc phieu giao · tao ncc phieu giao · phieu giao thu kho chup chua nhan · lap don phieu giao chup",
  "body": "**Khi nào:** thủ kho đã chụp phiếu giao nhưng chưa nhận được vì NCC chưa có trong danh mục hoặc chưa có đơn mua về kho đó.\n**Các bước:**\n1. Mua hàng → tab **Phiếu giao chờ** (số trên tab = phiếu đang chờ).\n2. Mở phiếu: xem ảnh, hàng trên phiếu, nhãn **NCC mới** / **Chưa khớp NCC** / **Chưa có đơn**.\n3. NCC chưa có: **Tạo NCC từ phiếu** (điền sẵn tên, MST trên phiếu) hoặc chọn ở **Hoặc chọn NCC có sẵn**; báo trùng thì **Dùng NCC này**.\n4. Chưa có đơn: bấm **Lập đơn · [tên NCC]** → mở đơn chủ động điền sẵn NCC → lưu, gửi duyệt.\n5. Đơn duyệt xong, thủ kho mở lại phiếu chụp ở Kho → chọn đơn → **Nhận hàng**.\n**Không làm được?**\n- Báo \"Bạn chỉ xem được — tạo NCC, lập đơn cần quyền Mua hàng — Quản trị\" → nhờ người có quyền.\n- Thủ kho báo \"Đơn chờ duyệt — Mua hàng duyệt xong mới nhận được\" → duyệt đơn trước.\n**Lưu ý:**\n- Phiếu chụp nhầm / trùng: thủ kho bấm **Bỏ phiếu** ở Kho.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-sua-huy-don-da-duyet",
  "title": "Sửa hoặc hủy đơn hàng đã duyệt",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Mua hàng · Quản trị",
  "keywords": "sua don da duyet huy don hang huy po doi gia doi so luong po da duyet huy dot giao ncc khong giao don sai khong mua nua sua hoac huy don hang da duyet",
  "questions": "po da duyet sua · huy don hang da duyet · don duyet doi gia · ncc giao nua huy don · thay nut sua don · huy po",
  "body": "**Khi nào:** đơn đã duyệt nhưng cần đổi số lượng, giá, hoặc không mua nữa.\n**Các bước:**\n1. Đơn đã duyệt không còn nút **Sửa** (chỉ sửa khi Nháp / Bị trả lại).\n2. Đơn **Giao nhiều đợt**: SL, giá, VAT ghi riêng từng đợt khi **Lập đợt giao**; đợt làm vượt giá trị đơn phải **Gửi duyệt bổ sung**.\n3. Không mua nữa: ở mục **Đợt giao** bấm **Hủy đợt** (ghi lý do) cho đợt kho chưa nhận.\n4. Rồi bấm **Kết thúc thiếu**, chọn **Đưa phần thiếu về Cần mua** (mua chỗ khác) hoặc **Không cần nữa**, ghi lý do.\n**Không làm được?**\n- Báo \"Kho đã bắt đầu nhận đợt này nên không hủy được\" → nhờ thủ kho nhận nốt hoặc chốt thiếu đợt đó.\n- **Kết thúc thiếu** báo \"Còn đợt giao chưa nhận xong…\" → hủy hoặc chờ kho nhận đợt đang mở trước.\n- Không có nút **Kết thúc thiếu** → đơn đã nhận đủ / đã đóng; hàng thừa thì làm Trả hàng NCC.\n**Lưu ý:**\n- Sai NCC hoặc sai dự án: kết thúc thiếu đơn cũ (đưa phần thiếu về Cần mua) rồi lập đơn mới.",
  "source": "docs"
 },
 {
  "id": "so-tay-mua-hang-tra-hang-ncc",
  "title": "Trả hàng nhà cung cấp: đổi hàng hay giảm trừ",
  "module": "Mua hàng",
  "routes": [
   {
    "route": "/procurement/project-po",
    "label": "Đơn hàng theo dự án"
   },
   {
    "route": "/procurement",
    "label": "Mua hàng"
   }
  ],
  "permission": "Hoàn trả nhà cung cấp · Trả hàng nhà cung cấp (theo kho); Mua hàng · Quản trị để quyết định",
  "keywords": "tra hang ncc tra lai nha cung cap hang loi sai quy cach giao thua hu hong doi hang giam tru cong no phieu tra ncc hoan ncc xuat tra tra hang nha cung cap: doi hang hay giam tru",
  "questions": "hang loi tra ncc · tra hang nha cung cap · ncc giao sai quy cach · giao thua tra · doi hang giam tru cong no · thay nut tra hang ncc",
  "body": "**Khi nào:** hàng đã nhập kho nhưng lỗi, sai quy cách, giao thừa hoặc hư hỏng, cần trả NCC.\n**Các bước:**\n1. Mở đơn trong Mua hàng → **Màn PO dự án** → thao tác **Trả hàng NCC** (đơn đã đóng: **Tạo phiếu hoàn NCC**).\n2. Chọn **Kho đang giữ hàng để xuất trả**, lý do (Lỗi chất lượng, Sai quy cách / chủng loại, Giao thừa…), **SL trả NCC** từng dòng → **Tạo phiếu trả NCC**.\n3. Mua hàng mở đơn ở Mua hàng → mục **Trả hàng NCC** → thống nhất với NCC rồi bấm **Đổi hàng** (NCC giao lại, lập đợt giao bù) hoặc **Giảm trừ** (phần trả quay lại Cần mua).\n4. Kho xuất trả xong, phiếu chuyển \"Kho đã xuất trả\".\n**Không làm được?**\n- Không thấy **Trả hàng NCC** → đơn chưa nhận hàng / đã trả hết, hoặc bạn thiếu quyền trả hàng NCC ở kho đó.\n- Báo SL không hợp lệ → SL trả phải ≤ phần còn trả được và ≤ tồn thực tế ở kho xuất.\n- Báo \"Kho đã xuất trả nên không đổi được quyết định\" → chọn Đổi hàng / Giảm trừ trước khi kho xuất.\n**Lưu ý:**\n- Chỉ ghi nhầm số (thực tế không có hàng) thì dùng **Sửa số nhận nhầm**, không lập phiếu trả.",
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
  "keywords": "xin nghi phep don nghi phep nam nghi om nghi viec rieng nghi khong luong thai san tao don nghi gui don nghi nghi nua ngay nghi buoi sang chieu np xin nghi phep",
  "questions": "nghi phep · don nghi phep the · nghi nua ngay chon · nghi luong · gui don nghi · don nghi om giay to · thay nut tao don",
  "body": "**Khi nào:** nghỉ phép năm, nghỉ không lương, việc riêng, ốm đau / thai sản (BHXH).\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → **Tạo đơn** (hoặc gõ \"xin nghỉ phép\" ở ô Tìm kiếm).\n2. **1. Loại đơn**: chọn loại; loại có danh sách lý do thì chọn thêm **Lý do nghỉ**.\n3. **2. Thời gian**: Từ ngày – Đến ngày; nghỉ nửa ngày bấm **Sáng** hoặc **Chiều**.\n4. **3. Lý do** (ít nhất 3 ký tự); loại bắt buộc giấy tờ thì **Chụp ảnh / chọn file** (tối đa 4).\n5. Xem ô tóm tắt: số ngày làm việc, phép còn trước → sau, chuỗi người duyệt; bấm **Gửi đơn**.\n**Không làm được?**\n- Không thấy **Tạo đơn** → tài khoản chưa gắn hồ sơ nhân sự đang làm việc; báo phòng HCNS.\n- \"Không đủ phép năm\" / \"đang thử việc chưa có phép năm\" → chọn **Nghỉ không lương**.\n- \"Bạn đã có đơn nghỉ trùng những ngày này\" → hủy đơn cũ trước.\n- \"Khoảng ngày này không có ngày làm việc nào\" → ngày chọn rơi vào ngày nghỉ / lễ.\n- \"Tháng … đã chốt công\" → HR phải mở lại kỳ công.\n**Lưu ý:**\n- Người duyệt: người duyệt công trường (nếu ở công trường) hoặc quản lý trên sơ đồ tổ chức; đơn dài ngày thêm Tổng giám đốc.\n- Bảo Trợ lý \"xin nghỉ phép thứ Sáu\" để có đơn nháp, kiểm rồi gửi.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-hang-chup-phieu",
  "title": "Nhận hàng ở kho bằng chụp phiếu giao",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Giao dịch kho · Thủ kho (kho nhận)",
  "keywords": "nhan hang chup phieu giao phieu giao ncc nhap kho phieu nhap ai doc phieu nhan theo xe xap phieu chon tu album thu kho nhan hang o kho bang chup phieu giao",
  "questions": "chup phieu giao nhan hang · xe ncc giao nhan ra · nut nhan hang mo · ai doc phieu giao · chup nhieu to phieu luc · chua thay don khop phieu giao · phieu giao chup trung",
  "body": "**Khi nào:** xe NCC giao hàng, thủ kho chụp tờ phiếu giao để nhận vào đơn mua.\n**Các bước:**\n1. Kho → **Chụp phiếu giao** → **Chụp phiếu** (chụp liền nhiều tờ) hoặc **Chọn từ album** (nhiều ảnh, PDF). Nhiều tờ thành **Xấp phiếu giao**, AI đọc lần lượt.\n2. Giữ nhiều kho thì chọn **Kho nhận**; chờ AI đọc: NCC, số phiếu, xe, dòng hàng được điền sẵn — sửa nếu sai.\n3. Ở **Đơn mua** chọn đơn gợi ý (hoặc **Tìm đơn**); mỗi dòng hàng chọn dòng đơn tương ứng hoặc **Không nhận dòng này**.\n4. Bấm **Nhận hàng** → có phiếu nhập kho theo xe; bấm **Mở phiếu nhập** để xem / in.\n**Không làm được?**\n- **Nhận hàng** mờ, ghi \"Chọn đơn mua\" / \"Chưa thấy đơn khớp\" → bấm **Lưu, nhận sau**; Mua hàng xử lý ở Phiếu giao chờ.\n- \"Đơn chờ duyệt — Mua hàng duyệt xong mới nhận được\" → nhắc người duyệt đơn.\n- \"Số nhận vượt phần đơn còn lại\" → giảm số; phần dư báo Mua hàng.\n- \"Chưa bật AI · nhập tay\" / AI lỗi → bấm **Đọc lại** hoặc gõ tay, vẫn nhận được.\n- Báo phiếu giao này đã nhận vào đơn rồi → phiếu trùng, bấm **Bỏ phiếu**.\n**Lưu ý:**\n- Dòng ghi \"đơn tính theo …\" → phiếu khác đơn vị với đơn (kg ↔ cây), nhập số theo đơn vị của đơn.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-bang-nhan-su-nhap-excel",
  "title": "Sửa, nhập Excel Bảng nhân sự (gửi duyệt)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/employees?view=roster",
    "label": "Bảng nhân sự"
   }
  ],
  "permission": "Nhân viên · Sửa hồ sơ cá nhân (sửa); Nhân viên · Nhập hồ sơ (nhập file)",
  "keywords": "bang nhan su nhap data nhap excel nhan su import ho so nhan vien sua hang loat phieu thay doi nhan su gui duyet xuat excel nhan su them nguoi moi data nhan su sua, nhap excel bang nhan su (gui duyet)",
  "questions": "nhap file excel nhan su · sua chuc danh nhieu nguoi cung luc · phieu thay doi nhan su cho ai duyet · gui phieu bao dang cho duyet · xuat danh sach nhan su ra excel · them nhieu nhan vien file",
  "body": "**Khi nào:** HR cập nhật thông tin nhiều người, hoặc nạp file Data nhân sự theo mẫu chuẩn.\n**Các bước:**\n1. Nhân sự → **Hồ sơ nhân sự** → **Bảng nhân sự**.\n2. Sửa tay: tick chọn người → **Đổi thông tin** (hoặc bấm vào một người) → thay đổi vào phiếu nháp → **Xem & gửi duyệt**.\n3. Nhập file: **Nhập Data** → chọn file .xlsx; xem các tab **Cần chọn người**, **Người mới**, **Thay đổi**, **Không có trong file**, **Lưu ý**.\n4. Chọn **Hiệu lực từ**, ghi **Lý do** (≥ 10 ký tự) → **Gửi duyệt … thay đổi**.\n5. Theo dõi ở tab **Phiếu thay đổi**; người duyệt (đặt ở **Cấu hình**) duyệt xong dữ liệu mới áp dụng. Nút **Xuất Excel** xuất các cột đang hiện.\n**Không làm được?**\n- \"Có ô đang chờ duyệt ở phiếu …\" → chờ phiếu đó xong rồi gửi.\n- \"Số CCCD … đã gắn với một người khác\" / \"Mã NV mới trùng\" → kiểm lại CCCD.\n- \"Không ai duyệt được phiếu này\" → nhờ Admin thêm người duyệt ở **Cấu hình**.\n**Lưu ý:**\n- Lương, phụ cấp chỉ HR Manage được đổi; người vắng trong file giữ nguyên, nghỉ việc ghi ở hồ sơ từng người.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-cham-cong-ngoai-vung",
  "title": "Chấm công báo ngoài phạm vi / GPS chưa chính xác",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/checkin",
    "label": "Check-in / Check-out"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "ngoai vung ngoai pham vi cham cong gps sai vi tri khong chinh xac khong cham duoc dinh vi lech toa do ban kinh cham cong cong truong moi khong lay duoc vi tri bao xa may bao xa qua cach xa diem cham cong cham cong bao ngoai pham vi / gps chua chinh xac",
  "questions": "cham cong bao ngoai pham vi · cham cong bao ngoai vung · gps chua du chinh xac · dang cong truong ko cham · lay vi tri gps · cong truong chua cham cong · dung cong ty ma bao km",
  "body": "**Khi nào:** màn Chấm công báo ngoài phạm vi hoặc GPS kém, nút chấm công bị mờ.\n**Các bước:**\n1. Đọc dòng địa điểm: \"Ngoài phạm vi chấm công · Gần nhất: … · …m\" cho biết bạn cách điểm chấm bao xa.\n2. Xem \"GPS ±… m\": trên 100 m là chưa đủ chính xác → ra chỗ thoáng, bật Vị trí chính xác, bấm nút ngắm **Lấy lại vị trí** bên phải.\n3. Đi vào trong khu vực rồi lấy lại vị trí; bán kính do HR đặt (mặc định công trường 300 m, văn phòng 150 m).\n4. Đang làm việc thật mà vẫn ngoài phạm vi → bấm **Gửi đề xuất chấm công bù**.\n**Không làm được?**\n- \"Chưa có địa điểm chấm công nào được cấu hình tọa độ\" / công trường mới chưa có tọa độ → HR Manage khai ở Cài đặt → **Địa điểm chấm công**.\n- \"Không lấy được vị trí GPS\" → bật định vị (GPS) của máy rồi lấy lại vị trí.\n- \"Chưa cho phép truy cập vị trí\" → xem mục cấp quyền vị trí / camera.\n**Lưu ý:**\n- Ngoài phạm vi thì không chấm được (máy chủ đo lại khoảng cách); chỉ có cách gửi đề xuất bù để người duyệt địa điểm xác nhận.\n- Chấm được ở mọi công trường / văn phòng của công ty đã có tọa độ, không chỉ nơi của mình.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-cho-nghi-viec",
  "title": "Cho nhân viên nghỉ việc (ghi ngày nghỉ)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/employees?view=directory",
    "label": "Danh bạ & hồ sơ"
   }
  ],
  "permission": "Nhân viên · Sửa hồ sơ cá nhân",
  "keywords": "cho nghi viec nhan vien nghi viec ngay nghi viec doi trang thai da nghi viec thoi viec het hop dong nghi huu ho so nhan su cho nhan vien nghi viec (ghi ngay nghi)",
  "questions": "nhan vien nghi viec · doi trang thai da nghi viec · ghi ngay nghi viec · chon ngay nghi viec sau hom · nhap excel doi sang nghi viec",
  "body": "**Khi nào:** nhân viên thôi việc, hết hợp đồng, nghỉ hưu.\n**Các bước:**\n1. Nhân sự → **Hồ sơ nhân sự** → nút **Danh bạ & hồ sơ** (HR mặc định mở Bảng nhân sự).\n2. Tìm người (tên, mã NV, SĐT), bấm biểu tượng **Cho nghỉ việc** (hình người có dấu trừ) trên thẻ / dòng.\n3. Nhập **Ngày nghỉ việc**, chọn **Lý do** (Tự xin nghỉ, Hết hợp đồng, Cho thôi việc, Nghỉ hưu hoặc ghi lý do khác), **Số quyết định** nếu có.\n4. Bấm **Cho nghỉ việc**; hồ sơ chuyển \"Đã nghỉ việc\", không bị xóa.\n**Không làm được?**\n- \"Ngày nghỉ việc không được sau hôm nay\" → chỉ ghi khi đã nghỉ; chờ tới ngày.\n- \"Ngày nghỉ việc không được trước ngày vào làm…\" → kiểm ngày vào làm.\n- Không thấy biểu tượng / \"Bạn chưa có quyền sửa hồ sơ nhân sự\" → cần quyền Nhân viên · Sửa hồ sơ cá nhân.\n**Lưu ý:**\n- Nhập Data ở Bảng nhân sự không cho nghỉ việc: người vắng trong file vẫn giữ nguyên.\n- Nhớ thu hồi điện thoại chấm công ở Chấm công → **Thiết bị & nghi vấn**.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-chot-cong-thang",
  "title": "Chốt công tháng (HR rà soát, HR Manage duyệt)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/timesheet",
    "label": "Chốt công"
   }
  ],
  "permission": "Nhân viên · Xem hồ sơ hạn chế (rà soát); Danh mục nhân sự · Quản trị danh mục (duyệt)",
  "keywords": "chot cong thang chot bang cong khoa thang cong tinh luong ra soat cong gui duyet chot cong mo lai ky cong hr manage xuat excel bang cong sua cong ghi don nghi thay mien di muon chot cong thang (hr ra soat, hr manage duyet)",
  "questions": "chot cong thang · bam bat dau chot cong · gui duyet chot cong · mo thang da chot · sua cong nhan vien quen cham · xuat excel bang cham cong thang",
  "body": "**Khi nào:** đầu tháng, chốt công tháng trước để tính lương.\n**Các bước:**\n1. Nhân sự → **Chốt công**, chọn tháng bằng mũi tên → **Bắt đầu chốt công**.\n2. Khung **Cần xử lý**: duyệt hết đơn nghỉ / đề xuất CC còn chờ, đọc phản hồi nhân viên.\n3. Bấm ô ngày cần sửa → **Sửa công** (0, ½, 1), **Miễn đi muộn / về sớm** hoặc **Ghi đơn nghỉ thay**; lý do ≥ 5 ký tự → **Lưu**.\n4. Kiểm ngày lễ (thiếu thì khai ở Chấm công → **Ngày lễ**) → **Gửi HR Manage duyệt**.\n5. HR Manage xem tổng hợp → **Duyệt chốt** (khóa tháng) hoặc **Trả lại** kèm lý do. Nút **Excel** xuất bảng công.\n**Không làm được?**\n- **Bắt đầu chốt công** mờ → \"Chờ hết tháng mới chốt được\".\n- **Gửi HR Manage duyệt** mờ → còn đơn chờ duyệt; xử lý hết trong **Cần xử lý**.\n- Không thấy **Duyệt chốt** → người gửi không tự duyệt; cần HR Manage khác.\n- Tháng đã chốt cần sửa → HR Manage bấm **Mở lại kỳ công** (bản cũ vẫn giữ).\n**Lưu ý:**\n- Tháng đã chốt khóa đơn nghỉ, chấm bù, sửa chấm công của tháng đó.\n- Thiếu ngày lễ thì ngày đó bị tính vắng.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-cong-tac",
  "title": "Đi công tác thì báo công thế nào",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   },
   {
    "route": "/hrm/attendance?tab=proposals",
    "label": "Đề Xuất CC"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "di cong tac cham cong khi di cong tac don cong tac lam viec ngoai dia diem ct cong tac van tinh cong cham cong o noi khac cong tac quen bao di cong tac thi bao cong the nao",
  "questions": "di cong cham cong · di cong phai nghi · don cong · cong tinh cong · di cong quen don",
  "body": "**Khi nào:** làm việc ở nơi không có điểm chấm công (gặp khách, làm việc với sở, nhà cung cấp…).\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → **Tạo đơn** → loại **Công tác**.\n2. Chọn Từ ngày – Đến ngày (cả ngày / buổi), ghi nơi đến và việc làm → **Gửi đơn**.\n3. Quản lý duyệt (thêm Phòng HCNS nếu loại có bước này); ngày công tác vẫn tính công, không trừ phép.\n4. Quên làm đơn: gửi **Đề xuất CC**, chọn **Trạng thái** \"Công tác (CT)\" cho ngày đó.\n**Không làm được?**\n- Đến công trường / văn phòng khác của công ty có điểm chấm công → chấm bình thường ở đó, không cần đơn.\n- \"Bạn đã có đơn nghỉ trùng những ngày này\" → hủy đơn trùng trước.\n- \"Tháng … đã chốt công\" → liên hệ HR.\n**Lưu ý:**\n- Đi tăng cường dài ngày ở công trường khác → dùng Điều động công trường (quản lý / HR lập phiếu).",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-dang-ky-dien-thoai-cham-cong",
  "title": "Đăng ký điện thoại chấm công (vân tay / Face ID)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/checkin",
    "label": "Check-in / Check-out"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "dang ky dien thoai cham cong passkey van tay face id khoa man hinh doi dien thoai moi may moi cho hr duyet thiet bi cham cong chong cham ho dang ky dien thoai cham cong (van tay / face id)",
  "questions": "dang ky dien thoai cham cong · doi dien thoai cham cong · dien thoai dang hr duyet · bao phai thiet cham cong da dang ky · may van tay cham · cham cong ho may nguoi khac",
  "body": "**Khi nào:** lần đầu chấm công, hoặc đổi sang điện thoại mới.\n**Các bước:**\n1. Mở **Check-in / Check-out** trên điện thoại sẽ dùng hằng ngày (Safari / Chrome, không mở trong Zalo).\n2. Bấm **Đăng ký điện thoại này** → mở khóa bằng vân tay / Face ID / mã PIN khi máy hỏi.\n3. Máy đầu tiên dùng được ngay. Máy thứ hai trở đi, hoặc máy đã đăng ký cho người khác: chờ HR duyệt.\n4. Từ đó mỗi lần bấm chấm công, máy hỏi vân tay / Face ID để mở khóa.\n**Không làm được?**\n- \"Điện thoại chưa bật khóa màn hình … hoặc trình duyệt đã cũ\" → bật khóa màn hình, cập nhật iOS / Chrome rồi mở lại; vẫn không được thì nhờ HCNS miễn tạm thời.\n- \"Điện thoại của bạn đang chờ HR duyệt\" → nhắn HR duyệt ở Chấm công → **Thiết bị & nghi vấn**.\n- \"Đây không phải điện thoại đã đăng ký\" → bấm **Đăng ký điện thoại này** để xin đổi máy (cần HR duyệt).\n- \"Đã hủy hoặc hết thời gian xác thực vân tay / Face ID\" → bấm chấm công lại và xác thực kịp.\n**Lưu ý:**\n- Công ty không lưu vân tay hay khuôn mặt; mỗi người một máy để chống chấm công hộ.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-de-nghi-cap-nhat-ho-so",
  "title": "Đổi CCCD, tài khoản lương, người phụ thuộc (gửi HR)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/my-profile",
    "label": "Hồ sơ của tôi"
   }
  ],
  "permission": "Mọi nhân viên (hồ sơ của mình)",
  "keywords": "de nghi cap nhat ho so doi cccd can cuoc tai khoan nhan luong so tai khoan ngan hang nguoi phu thuoc giam tru gia canh dia chi bhxh bhyt bang cap chung chi sai ten doi cccd, tai khoan luong, nguoi phu thuoc (gui hr)",
  "questions": "doi so tai khoan nhan luong · cap nhat cccd · dang ky nguoi phu thuoc giam tru gia canh · ho so ghi sai thong tin sua · them bang cap chung chi vao ho so · huy de nghi cap nhat da gui",
  "body": "**Khi nào:** đổi giấy tờ, ngân hàng, địa chỉ, người phụ thuộc, BHXH, bằng cấp… cần HR đối chiếu.\n**Các bước:**\n1. **Hồ sơ của tôi** → bấm thẻ **Hồ sơ nhân sự đầy đủ**.\n2. Tab **Tổng quan**, khung **Cập nhật hồ sơ** → **Đề nghị cập nhật** (nút cùng tên cũng có ở các tab hồ sơ).\n3. Chọn mục: Địa chỉ, CCCD / giấy tờ, Tài khoản nhận lương, Người phụ thuộc, BHXH / BHYT, Bằng cấp, Chứng chỉ, Thông tin khác.\n4. Điền thông tin mới, **Thêm ảnh** giấy tờ (ảnh / PDF, tối đa 4), ghi chú → **Gửi HR duyệt**.\n5. Theo dõi trong khung: Chờ HR duyệt / Đã cập nhật / Bị từ chối (kèm lý do).\n**Không làm được?**\n- Nút gửi mờ, chân khung ghi \"Còn thiếu: …\" → điền đủ mục đó (Thông tin khác cần nội dung ≥ 5 ký tự).\n- Gửi nhầm → bấm **Hủy đề nghị** khi còn Chờ HR duyệt.\n**Lưu ý:**\n- Nhân viên không xem được nhóm Lương, thuế & ngân hàng; tài khoản nhận lương vẫn đổi qua đề nghị này.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-di-muon-ve-som",
  "title": "Xin phép đi muộn, về sớm, ra ngoài trong giờ",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "di muon ve som ra ngoai trong gio xin phep di muon giai trinh di muon tru cong di muon phut muon don di muon don ve som den muon toi muon vao muon xin den muon xin ve som xin phep di muon, ve som, ra ngoai trong gio",
  "questions": "phep di muon · di muon ly tru cong · don ve som · ra ngoai gio · giai trinh di muon · di muon da bao nhieu phut",
  "body": "**Khi nào:** đi muộn, về sớm hoặc ra ngoài trong giờ vì việc chính đáng, muốn được tính đủ công.\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → **Tạo đơn** → loại **Đi muộn / về sớm có lý do**.\n2. Chọn **Lý do nghỉ**: Đi muộn, Về sớm hoặc Ra ngoài trong giờ.\n3. Chọn **Ngày** và **Số phút** (tối đa ghi ngay trên ô, hiện là 60).\n4. Ghi lý do (vd \"đi xử lý hồ sơ tại sở xây dựng\") → **Gửi đơn**.\n5. Quản lý duyệt, sau đó Phòng HCNS; được duyệt thì ngày đó tính đủ công.\n**Không làm được?**\n- \"Số phút từ 1 đến …\" → vượt hạn mức mỗi lần; vắng lâu hơn thì xin nghỉ buổi sáng / chiều.\n- Nút **Gửi đơn** mờ, ghi \"Còn thiếu: chọn lý do nghỉ, ghi lý do\" → chọn lý do và ghi ít nhất 3 ký tự.\n- \"Tháng … đã chốt công\" → liên hệ HR.\n**Lưu ý:**\n- Hạn mức phút do HR đặt ở Nghỉ phép → **Thiết lập**.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-dieu-dong-cong-truong",
  "title": "Điều động nhân viên sang công trường khác",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/assignments",
    "label": "Điều động công trường"
   }
  ],
  "permission": "Lập: HR, chỉ huy trưởng / người duyệt công trường, quản lý trực tiếp; Duyệt: Danh mục nhân sự · Quản trị danh mục hoặc Admin",
  "keywords": "dieu dong cong truong chuyen cong truong tang cuong kiem nhiem tam thoi lap phieu dieu dong chuyen nguoi sang cong truong khac duyet dieu dong gia han ket thuc som dieu dong nhan vien sang cong truong khac",
  "questions": "dieu dong nguoi sang cong truong khac · lap phieu dieu dong · ai duyet phieu dieu dong · gia han dieu dong tam thoi · thay nut lap phieu dieu dong · dieu dong xong ai duyet phep nguoi",
  "body": "**Khi nào:** chuyển hẳn, tăng cường có thời hạn hoặc cho kiêm nhiệm người sang công trường khác.\n**Các bước:**\n1. Nhân sự → **Điều động công trường** → **Lập phiếu điều động**.\n2. **1. Ai được điều động**: gõ tên / mã, chọn được nhiều người.\n3. **2. Đến công trường nào**: chọn công trường và loại **Chính** (làm hẳn), **Kiêm nhiệm** (giữ nơi chính) hoặc **Tạm thời** (hết hạn tự về nơi cũ).\n4. **3. Thời gian và lý do**: Từ ngày, Đến ngày (bắt buộc với Tạm thời), lý do ≥ 5 ký tự; xem **Kiểm tra trước khi gửi** → **Gửi duyệt**.\n5. HR Manage / Admin mở phiếu → **Duyệt điều động** hoặc **Từ chối**; CHT nơi đi và nơi đến được báo.\n**Không làm được?**\n- Không thấy **Lập phiếu điều động** → chỉ HR, CHT / người duyệt công trường, quản lý trực tiếp lập được.\n- Công trường ghi \"chưa có tọa độ chấm công\" → người đến chưa chấm được; HR Manage khai ở Cài đặt → Địa điểm chấm công.\n**Lưu ý:**\n- Chưa tới ngày: **Hủy điều động**; đang làm: **Kết thúc sớm** / **Gia hạn**. Từ ngày hiệu lực, phép và chấm bù do người duyệt công trường mới xử lý (trừ Kiêm nhiệm).",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-don-nghi-cho-ai-duyet",
  "title": "Đơn nghỉ đang chờ ai duyệt, người duyệt bị sai",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "don nghi cho ai duyet nguoi duyet don nghi phep dang cho duyet ai duyet don nghi gui sai nguoi duyet quan ly cong truong tong giam doc hcns theo doi don nghi da duyet chua don nghi dang cho ai duyet, nguoi duyet bi sai",
  "questions": "don nghi dang cho ai duyet · don nghi phep gui ai · don nghi gui sai nguoi duyet · don nghi lau chua duyet · ai duyet don nghi ngay · don nghi da duyet chua",
  "body": "**Khi nào:** muốn biết đơn đã duyệt chưa, đang nằm ở ai.\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → tab **Đơn của tôi**: mỗi dòng ghi trạng thái và \"đang chờ: <tên>\".\n2. Bấm vào đơn → khung **Người duyệt** liệt kê từng bước; bước tô vàng \"Đang chờ duyệt\" là người đang giữ.\n3. Xem **Lịch sử** cuối khung: ai tạo, duyệt, từ chối, lúc nào.\n**Không làm được?**\n- Người duyệt bước 1 không đúng → hệ thống lấy người duyệt của công trường bạn đang ở; không ở công trường thì quản lý trên sơ đồ tổ chức; không có ai thì Phòng HCNS. Báo HR sửa, rồi hủy đơn và gửi lại.\n- Đơn chờ lâu → nhắn người đang giữ; HR có thể **HR duyệt thay**.\n- Bị **Từ chối** → mở đơn xem \"Lý do từ chối\".\n**Lưu ý:**\n- Đơn dài hơn ngưỡng HR đặt (vd phép năm trên 3 ngày) thêm bước Tổng giám đốc; một số loại thêm bước Phòng HCNS.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-duyet-de-xuat-cham-cong",
  "title": "Duyệt đề xuất chấm công bù",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/attendance",
    "label": "Chấm công"
   }
  ],
  "permission": "Người quản lý địa điểm (công trường / văn phòng) hoặc Chấm công · Duyệt/chốt công",
  "keywords": "duyet de xuat cham cong duyet cham cong bu duyet bu cong tu choi de xuat cc chi huy truong quan ly dia diem nguoi duyet cong truong duyet de xuat cham cong bu",
  "questions": "duyet cham cong bu · thay nut duyet de xuat cham cong · tu choi de xuat cham cong · ai duyet de xuat cc · duyet xong cong vao bang cong",
  "body": "**Khi nào:** nhân viên ở công trường / văn phòng bạn quản lý gửi đề xuất bù công (số đỏ trên tab).\n**Các bước:**\n1. Nhân sự → **Chấm công** → tab **Đề Xuất CC**.\n2. Đọc từng dòng: người, ngày, Vào / Ra, địa điểm, lý do.\n3. Đúng → bấm **Duyệt**: công ngày đó được ghi vào bảng công ngay.\n4. Sai → **Từ chối**, ghi **Lý do từ chối** → **Xác nhận từ chối**; người gửi thấy lý do.\n**Không làm được?**\n- Không thấy nút **Duyệt** → bạn không phải người quản lý địa điểm ghi trên đề xuất; HR Manage đổi người duyệt ở Cài đặt → **Địa điểm chấm công**.\n- \"Đề xuất này đã được xử lý\" → người khác đã duyệt / từ chối.\n- \"Tháng … đã chốt công\" → tháng đã khóa, nhờ HR mở lại kỳ công.\n**Lưu ý:**\n- HR có quyền Chấm công · Duyệt/chốt công duyệt được mọi đề xuất.\n- Đề xuất còn chờ sẽ chặn HR gửi chốt công tháng — duyệt sớm.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-duyet-dien-thoai-cham-cong",
  "title": "Duyệt, thu hồi điện thoại chấm công (HR)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/attendance",
    "label": "Chấm công"
   }
  ],
  "permission": "Nhân viên · Xem hồ sơ hạn chế",
  "keywords": "duyet dien thoai cham cong thiet bi cham cong thu hoi mien xac thuc van tay face id cham cong ho nghi van hr passkey doi may mat may duyet, thu hoi dien thoai cham cong (hr)",
  "questions": "duyet dien thoai cham cong nhan vien · nhan vien doi may hr · thu hoi dien thoai mat · mien van tay may doi cu · luot cham cong nghi van · tu duyet may",
  "body": "**Khi nào:** nhân viên đăng ký máy mới, mất máy, hoặc máy đời cũ không có vân tay / Face ID.\n**Các bước:**\n1. Nhân sự → **Chấm công** → tab **Thiết bị & nghi vấn**.\n2. Khung **Điện thoại chờ duyệt**: kiểm tên, máy (nhãn \"Đổi sang điện thoại mới\") → **Duyệt**, ghi lý do. Máy mới thay máy cũ.\n3. Mất máy / nghỉ việc: khung **Điện thoại đang dùng** → **Thu hồi**; người đó phải đăng ký lại.\n4. Máy không hỗ trợ: khung **Miễn xác thực vân tay / Face ID** → gõ tên, chọn hạn (để trống = không thời hạn) → **Miễn**, ghi lý do.\n5. Xem **Lượt chấm nghi vấn — 30 ngày**: chung máy, trùng tọa độ, chấm không vân tay.\n**Không làm được?**\n- Không thấy tab → cần quyền HR (Nhân viên · Xem hồ sơ hạn chế).\n- \"Không tự duyệt thiết bị của chính mình\" → nhờ HR khác duyệt.\n- Không có nút **Bật / Tắt** \"Chống chấm công hộ\" → chỉ HR Manage đổi được.\n**Lưu ý:**\n- Lượt chấm của người được miễn vẫn có ảnh, GPS và được gắn nhãn theo dõi.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-duyet-don-nghi",
  "title": "Duyệt đơn nghỉ của nhân viên",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Người duyệt có tên ở bước đang chờ; HR (duyệt thay)",
  "keywords": "duyet don nghi phep duyet nghi cho nhan vien cho toi duyet tu choi don nghi quan ly duyet phep hr duyet thay duyet di muon ve som duyet don nghi cua nhan vien",
  "questions": "duyet don nghi phep nhan vien · thay don nghi duyet · tu choi don nghi phep · hr duyet thay quan ly · bao tu duyet don",
  "body": "**Khi nào:** nhận thông báo \"Đơn chờ bạn duyệt\".\n**Các bước:**\n1. Nhân sự → **Nghỉ phép** → tab **Chờ tôi duyệt** (số trên tab = số đơn đang chờ bạn).\n2. Bấm đơn: xem loại, ngày, số ngày làm việc, lý do, **Giấy tờ đính kèm**, các bước duyệt.\n3. Bấm **Duyệt**: đơn sang bước sau (nếu có) hoặc thành Đã duyệt.\n4. Không đồng ý → **Từ chối**, ghi **Lý do từ chối**; người xin nhận thông báo kèm lý do.\n**Không làm được?**\n- Không thấy đơn → bạn không phải người ở bước đang chờ (xem khung **Người duyệt** của đơn).\n- \"Không tự duyệt đơn của chính mình\" → đơn của bạn do cấp trên / HR duyệt.\n- \"Đơn này đã được xử lý\" → đã có người duyệt / từ chối hoặc người xin đã hủy.\n- \"Tháng … đã chốt công\" → nhờ HR Manage mở lại kỳ công.\n**Lưu ý:**\n- HR thấy nút **HR duyệt thay** ở mọi đơn chờ, bắt buộc ghi lý do duyệt thay.\n- Đơn chờ còn tồn sẽ chặn HR gửi chốt công tháng.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-huy-don-nghi-phep",
  "title": "Hủy hoặc sửa đơn nghỉ đã gửi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Người tạo đơn (đơn chờ duyệt); HR (đơn đã duyệt)",
  "keywords": "huy don nghi phep sua don nghi rut don doi ngay nghi don da duyet muon huy huy don nghi khong luong doi loai nghi huy hoac sua don nghi da gui",
  "questions": "huy don nghi phep · sua ngay don nghi da gui · don nghi da duyet muon huy · thay nut huy don · doi ke hoach nghi nua",
  "body": "**Khi nào:** đổi kế hoạch, chọn sai ngày hoặc sai loại nghỉ.\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → tab **Đơn của tôi**, bấm vào đơn.\n2. Đơn **Chờ duyệt**: bấm **Hủy đơn** ở cuối khung, ghi **Lý do hủy** → **Hủy đơn**.\n3. Cần sửa ngày / loại: hủy đơn cũ rồi **Tạo đơn** mới (không có nút sửa đơn).\n4. Đơn **Đã duyệt**: nhắn phòng HCNS hủy giúp; số phép và bảng công được hoàn lại.\n**Không làm được?**\n- Không thấy **Hủy đơn** ở đơn đã duyệt → \"Đơn đã duyệt chỉ HR được hủy\".\n- \"Nhập lý do hủy (ít nhất 3 ký tự)\" → ghi lý do dài hơn.\n- HR hủy đơn đã duyệt bị báo \"Tháng … đã chốt công\" → HR Manage mở lại kỳ công trước.\n- Đơn **Từ chối** / **Đã hủy** thì không cần hủy; vẫn nghỉ thì tạo đơn mới.\n**Lưu ý:**\n- Hủy đơn chờ duyệt không cần ai đồng ý; đơn dừng xử lý ngay.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-lich-cong-cua-toi",
  "title": "Xem lịch sử chấm công của tôi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/attendance?tab=mine",
    "label": "Lịch của tôi"
   }
  ],
  "permission": "Mọi nhân viên (chỉ của mình)",
  "keywords": "lich su cham cong lich cong cua toi xem gio vao ra cham cong hom qua di muon ve som thieu luot cham vang xem lai cham cong thang nay gio check in check out gio vao ra cham luc may gio tuan truoc xem lich su cham cong cua toi",
  "questions": "gio cham cong · lich su cham cong thang · hom qua cham cong luc may gio · ngay bao thieu luot cham · di muon bao nhieu phut · cham lich chua hien",
  "body": "**Khi nào:** kiểm tra giờ vào / ra, ngày đi muộn, ngày thiếu lượt chấm trong tháng.\n**Các bước:**\n1. Màn Chấm công bấm **Lịch công của tôi** (hoặc Nhân sự → **Chấm công của tôi** → tab **Lịch của tôi**).\n2. Xem dải tổng **Công**, **Nghỉ phép**, **Muộn / sớm**, **Thiếu lượt chấm**, **Vắng**; đổi tháng bằng mũi tên, **Hôm nay** để quay về.\n3. Bấm một ngày: xem ca, **Vào – Ra**, phút muộn / sớm, công, địa điểm, đơn nghỉ trong ngày.\n4. Ngày \"Thiếu lượt chấm\" / \"Vắng\" mà có đi làm → bấm **Đề xuất bù công** ngay trong ô chi tiết.\n**Không làm được?**\n- Không có tab **Lịch của tôi** → tài khoản chưa gắn hồ sơ nhân sự đang làm việc; báo phòng HCNS.\n- Vừa chấm mà lịch chưa đổi → tải lại trang; màn Chấm công vẫn hiện giờ Vào / Ra hôm nay.\n- Ngày ghi \"không bắt buộc chấm\" → bạn thuộc diện không chấm công, ngày làm việc tự đủ công.\n**Lưu ý:**\n- Đơn nghỉ chờ duyệt hiện viền nét đứt; \"Nhân sự đã điều chỉnh khi chốt công\" nghĩa là HR đã sửa ngày đó.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-phieu-luong",
  "title": "Xem phiếu lương của tôi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/my-payroll",
    "label": "Phiếu lương của tôi"
   }
  ],
  "permission": "Mọi nhân viên (chỉ phiếu của mình)",
  "keywords": "phieu luong luong thang cua toi xem luong thuc nhan luong co ban phu cap khau tru khong thay phieu luong luong sai bang luong ca nhan xem phieu luong cua toi",
  "questions": "phieu luong · thay phieu luong thang · phieu luong sai thi hoi ai · luong thuc nhan thang truoc bao nhieu · luong · chua phieu luong",
  "body": "**Khi nào:** xem lương thực nhận, ngày công, phụ cấp, khấu trừ từng tháng.\n**Các bước:**\n1. Gõ \"phiếu lương\" ở ô Tìm kiếm → **Phiếu lương của tôi** (hoặc Tổng quan của tôi → **Phiếu lương**).\n2. Ô đầu: **Thực nhận gần nhất** và **Tổng đã thanh toán**.\n3. Kéo xuống: mỗi tháng một thẻ có **Ngày công**, **Lương cơ bản**, **Phụ cấp**, **Khấu trừ**, số thực nhận và trạng thái Đã xác nhận / Đã thanh toán.\n**Không làm được?**\n- \"Chưa có phiếu lương đã phát hành\" hoặc thiếu tháng này → HR chưa xác nhận phiếu tháng đó (bản nháp không hiện); hỏi phòng HCNS.\n- Lỗi tải → bấm **Tải lại** / **Thử lại**; vẫn lỗi thì gửi Góp ý.\n- Ngày công sai → kiểm Công tháng của tôi và báo HR ở đó trước.\n**Lưu ý:**\n- Chỉ thấy phiếu của chính mình; không có ô chọn tháng, tháng mới nhất ở trên cùng.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-quan-ly-truc-tiep",
  "title": "Quản lý trực tiếp của tôi là ai, đổi ở đâu",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/my-profile",
    "label": "Hồ sơ của tôi"
   },
   {
    "route": "/settings/hrm-shared-catalog",
    "label": "Danh mục dùng chung HRM"
   }
  ],
  "permission": "Mọi nhân viên (xem); đổi: Định biên · Đặt quản lý đơn vị",
  "keywords": "quan ly truc tiep cua toi la ai sep truc tiep cap tren truong don vi truong phong nguoi duyet cua toi doi quan ly truc tiep so do to chuc quan ly truc tiep cua toi la ai, doi o dau",
  "questions": "quan ly truc tiep ai · sep truc tiep ai · quan ly truc tiep sai · doi quan ly truc tiep · ai duyet phep",
  "body": "**Khi nào:** cần biết cấp trên trực tiếp (người duyệt phép, nhận báo cáo) hoặc thấy bị sai.\n**Các bước:**\n1. **Hồ sơ của tôi** → thẻ **Hồ sơ nhân sự đầy đủ** → tab **Công việc & tổ chức**: dòng **Quản lý trực tiếp**.\n2. Quản lý trực tiếp = người giữ vị trí trưởng đơn vị của bạn trên sơ đồ tổ chức.\n3. Sai → báo HR. HR mở Cài đặt → **Danh mục dùng chung HRM** → **Sơ đồ tổng quan**, chọn đơn vị, ở dòng vị trí trưởng bấm vương miện **Đặt làm quản lý trực tiếp**, ghi lý do ≥ 10 ký tự.\n**Không làm được?**\n- Trống → đơn vị chưa có trưởng; đơn nghỉ có thể chuyển Phòng HCNS duyệt.\n- Người ở công trường: đơn nghỉ và chấm công bù do người duyệt của công trường xử lý, không theo quản lý trực tiếp.\n- HR không thấy nút vương miện → cần quyền Định biên · Đặt quản lý đơn vị; vị trí phải có định biên 1 người.\n**Lưu ý:**\n- Ô quản lý ở Cài đặt → Người dùng chỉ để xem; đổi ở Sơ đồ tổ chức.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-quyen-vi-tri-camera",
  "title": "Cấp quyền vị trí, camera để chấm công (iPhone, Android)",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/checkin",
    "label": "Check-in / Check-out"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "quyen vi tri camera cham cong iphone android safari chrome khong mo duoc camera chua cho phep vi tri zalo facebook mo bang trinh duyet hoi quyen moi lan dinh vi cap quyen vi tri, camera de cham cong (iphone, android)",
  "questions": "mo camera cham cong · chua phep truy cap vi tri sua · iphone cham cong lay vi tri · android bat quyen vi tri · mo link zalo cham · lan cung quyen vi tri",
  "body": "**Khi nào:** màn Chấm công báo \"Chưa cho phép truy cập vị trí\", không mở được camera, hoặc đang mở Vioo trong Zalo / Facebook.\n**Các bước:**\n1. Đang mở trong Zalo, Facebook… → bấm **Mở bằng Chrome** (Android) hoặc **Sao chép đường dẫn** rồi dán vào Safari (iPhone).\n2. iPhone: Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị → Trang web Safari → Khi dùng ứng dụng, bật Vị trí chính xác; rồi Cài đặt → Ứng dụng → Safari → Vị trí → Cho phép.\n3. Android: bấm biểu tượng bên trái thanh địa chỉ Chrome → Quyền → Vị trí → Cho phép; bật GPS ở thanh cài đặt nhanh.\n4. Quay lại Vioo, bấm nút ngắm **Lấy lại vị trí**.\n5. Máy tính báo \"Chưa cho phép dùng camera\" → bấm ổ khóa cạnh thanh địa chỉ, cho phép Camera và Vị trí → **Mở lại camera**.\n**Không làm được?**\n- Điện thoại không cần cấp quyền camera cho trang: Vioo mở camera của máy khi bấm **Chụp ảnh chấm công…**.\n- Bị hỏi quyền mỗi lần → đang mở trong ứng dụng khác, hoặc đã chọn \"Chỉ lần này\"; khi Chrome hỏi hãy chọn \"Khi dùng trang web\".\n**Lưu ý:**\n- Khi bị chặn quyền, màn Chấm công tự hiện hướng dẫn đúng theo loại máy (mục \"Cách bật quyền vị trí…\").",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-so-phep-con-lai",
  "title": "Xem số ngày phép còn lại",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Mọi nhân viên (chỉ của mình)",
  "keywords": "con bao nhieu ngay phep so phep phep con lai phep nam so du phep phep ton nam truoc so phep chua co cong phep hang thang so phep xem so ngay phep con lai",
  "questions": "con bao nhieu ngay phep · con bao nhieu ngay phep nam · phep con ghi chua · phep ton nam truoc dung khi · thang cong may ngay phep · lich su cong tru phep",
  "body": "**Khi nào:** trước khi xin nghỉ phép năm, hoặc thấy số phép lạ.\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → ô **Phép còn lại** đầu màn (đã trừ đơn phép năm đang chờ duyệt).\n2. Bấm ô đó (**Xem sổ phép**): thấy **Còn lại**, **Phép tồn năm trước** và **Lịch sử cộng / trừ** từng dòng.\n3. Hoặc hỏi Trợ lý: \"còn bao nhiêu ngày phép\".\n**Không làm được?**\n- Ghi \"Chưa có\" / \"HR chưa thiết lập số phép năm nay cho bạn\" → báo phòng HCNS nhập số phép (HR làm ở tab **Số phép**).\n- Đang thử việc → chưa có phép năm; xin nghỉ thì chọn Nghỉ không lương.\n- Số lệch → xem sổ phép dòng nào trừ; vẫn sai thì báo phòng HCNS.\n**Lưu ý:**\n- Phép cộng 1 ngày vào mùng 1 hằng tháng; phép tồn năm trước chỉ dùng đến hạn ghi trong ô.\n- Đơn đã duyệt bị hủy thì phép được hoàn lại.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-sua-thong-tin-ca-nhan",
  "title": "Sửa thông tin cá nhân, đổi ảnh đại diện",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/my-profile",
    "label": "Hồ sơ của tôi"
   }
  ],
  "permission": "Mọi nhân viên (hồ sơ của mình)",
  "keywords": "sua thong tin ca nhan doi anh dai dien avatar so dien thoai ngay sinh ho ten tinh trang hon nhan email ca nhan cap nhat ho so cua toi doi ten sua thong tin ca nhan, doi anh dai dien",
  "questions": "doi dai dien · sua so dien thoai · sua ngay sinh sai · cap nhat email ca nhan · doi dai dien · doi ten hien thi",
  "body": "**Khi nào:** đổi ảnh đại diện, số điện thoại, thông tin cá nhân cơ bản.\n**Các bước:**\n1. Bấm ảnh / tên của bạn ở thanh bên (hoặc Nhân sự → **Hồ sơ của tôi**).\n2. Đổi ảnh: bấm vào ảnh đại diện (**Đổi ảnh**) → chọn ảnh JPG, PNG hoặc WEBP dưới 2MB.\n3. Tab **Cá Nhân** → **Sửa thông tin**: sửa Họ & Tên, Giới tính, Ngày sinh, Tình trạng HN, Số điện thoại → **Lưu**.\n4. Điện thoại / email cá nhân: thẻ **Hồ sơ nhân sự đầy đủ** → tab **Cá nhân & liên hệ** → **Cập nhật liên hệ** → **Lưu liên hệ**.\n**Không làm được?**\n- \"Ảnh quá lớn\" / \"File không hợp lệ\" → ảnh trên 2MB hoặc sai định dạng; chọn ảnh khác.\n- Màn báo \"Hồ sơ nhân sự chưa được liên kết với tài khoản\" → sửa chỉ đổi tên / SĐT tài khoản; báo Admin / phòng HCNS gắn hồ sơ.\n- Không thấy thẻ **Hồ sơ nhân sự đầy đủ** → cũng do chưa gắn hồ sơ.\n**Lưu ý:**\n- CCCD, tài khoản nhận lương, địa chỉ, người phụ thuộc, bằng cấp không tự sửa: gửi **Đề nghị cập nhật** cho HR (mục riêng).",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-them-nhan-vien-moi",
  "title": "Thêm hồ sơ nhân viên mới",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/employees?view=directory",
    "label": "Danh bạ & hồ sơ"
   }
  ],
  "permission": "Nhân viên · Sửa hồ sơ cá nhân",
  "keywords": "them nhan vien moi tao ho so nhan su nhan vien moi vao lam them moi lien ket tai khoan ma nhan vien tu dong nguoi moi them ho so nhan vien moi",
  "questions": "them nhan vien · tao ho so nguoi vao · ma nhan vien tu sinh tu nhap · lien ket tai khoan dang nhap ho so nhan su · nhan vien bao chua ho so nhan su",
  "body": "**Khi nào:** có một người mới vào làm (nhiều người thì dùng **Nhập Data** ở Bảng nhân sự).\n**Các bước:**\n1. Nhân sự → **Hồ sơ nhân sự** → **Danh bạ & hồ sơ** → **Thêm Mới**.\n2. Nhập **Họ & Tên** (bắt buộc), giới tính, số điện thoại, email, ngày sinh, **Ngày Bắt Đầu (Thử Việc)**, ngày ký chính thức; tải ảnh nếu có.\n3. Ô **Liên kết tài khoản hệ thống / kho (nếu có)**: chọn tài khoản đăng nhập của người này.\n4. Bấm **Lưu Thông Tin**; mã nhân sự tự tạo.\n5. Tiếp theo: thêm hợp đồng ở **Hợp đồng LĐ**, nhập số phép ở Nghỉ phép → **Số phép**.\n**Không làm được?**\n- Không thấy **Thêm Mới** → cần quyền Nhân viên · Sửa hồ sơ cá nhân.\n- \"Thiếu họ tên\" → nhập Họ & Tên.\n- Người mới chấm công báo \"Chưa có hồ sơ nhân sự\" → hồ sơ chưa liên kết tài khoản; mở hồ sơ, chọn ô liên kết rồi lưu.\n**Lưu ý:**\n- Tài khoản chưa có trong danh sách liên kết → Admin tạo trước ở Cài đặt → **Người dùng**.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-tra-cuu-dong-nghiep",
  "title": "Tìm số điện thoại, email đồng nghiệp",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/ep",
    "label": "Tra cứu nhân viên"
   },
   {
    "route": "/hrm/employees",
    "label": "Danh bạ nhân sự"
   }
  ],
  "permission": "Hồ sơ nhân sự · Xem hoặc Nhân viên · Xem danh bạ",
  "keywords": "tim so dien thoai dong nghiep email dong nghiep danh ba nhan vien tra cuu nhan vien sdt lien he tim nguoi ma nhan vien ho so nv so dien thoai dien thoai sdt lien he dong nghiep tim so dien thoai, email dong nghiep",
  "questions": "tim so dien thoai dong nghiep · tra cuu email · danh ba nhan vien · tim nhan vien theo ma nv · thay menu tra cuu nhan vien",
  "body": "**Khi nào:** cần liên hệ đồng nghiệp hoặc tra mã nhân viên.\n**Các bước:**\n1. Nhanh nhất: gõ tên đồng nghiệp ở ô **Tìm kiếm** đầu màn.\n2. Hoặc mở **Hồ sơ NV** → **Tra cứu nhân viên**, gõ vào ô \"Tìm theo mã NV, tên, email, SĐT...\", lọc trạng thái nếu cần.\n3. Thẻ nhân viên hiện mã, chức danh, số điện thoại, email; bấm thẻ để xem hồ sơ (chỉ các phần bạn được xem).\n4. Người có quyền danh bạ: Nhân sự → **Danh bạ nhân sự** cũng tìm theo tên, mã NV, SĐT.\n**Không làm được?**\n- Không thấy menu / ô Tìm kiếm không ra người → chưa được cấp quyền xem danh bạ hoặc hồ sơ nhân sự; nhờ Admin.\n- Thẻ không có số điện thoại → hồ sơ người đó chưa nhập.\n- Mở hồ sơ thấy ổ khóa → phần đó bị giới hạn theo vai trò.\n**Lưu ý:**\n- Người đã nghỉ việc hiện thẻ đỏ, nhãn \"Đã nghỉ việc\".",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-xac-nhan-lam-them-gio",
  "title": "Xác nhận làm thêm giờ",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/hrm/leave",
    "label": "Nghỉ phép"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "lam them gio tang ca ot xac nhan lam them phut du den som ve muon gio lam them overtime xac nhan ot xac nhan lam them gio",
  "questions": "them gio khai · xac nhan tang ca the · phut du chua xac nhan · bao vuot tran them · ot tu tinh",
  "body": "**Khi nào:** muốn tính giờ làm thêm từ số phút đến sớm / về muộn đã chấm công trong tháng.\n**Các bước:**\n1. Nhân sự → **Nghỉ phép của tôi** → **Tạo đơn** → loại **Xác nhận làm thêm giờ**.\n2. Chọn **Tháng**; màn báo \"Tháng này còn … phút đến sớm / về muộn chưa xác nhận\".\n3. Nhập **Số phút xác nhận** hoặc bấm **Dùng hết**.\n4. Ghi lý do (việc gì phải làm thêm) → **Gửi đơn**; quản lý rồi Phòng HCNS duyệt.\n**Không làm được?**\n- \"Tháng … chỉ còn … phút dư chưa xác nhận\" → nhập không quá số phút dư.\n- \"Vượt trần làm thêm 40 giờ/tháng\" → giảm số phút.\n- \"Nhập số phút làm thêm cần xác nhận\" → ô số phút đang 0.\n**Lưu ý:**\n- Phút dư chỉ tính từ giờ chấm công so với ca; không chấm công thì không có phút để xác nhận, OT không tự tính khi chưa có đơn được duyệt.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhan-su-xem-hop-dong-lao-dong",
  "title": "Xem hợp đồng lao động, quá trình làm việc của tôi",
  "module": "Nhân sự",
  "routes": [
   {
    "route": "/my-profile",
    "label": "Hồ sơ của tôi"
   }
  ],
  "permission": "Mọi nhân viên (hồ sơ của mình)",
  "keywords": "xem hop dong lao dong cua toi hdld hop dong het han qua trinh lam viec ngay vao lam ngay chinh thuc bhxh so so bao hiem ho so nhan su day du giay to xem hop dong lao dong, qua trinh lam viec cua toi",
  "questions": "hop dong lao dong · hop dong het han chua · ngay vao ngay chinh thuc · so bhxh · ho so ghi quyen",
  "body": "**Khi nào:** cần xem số hợp đồng, loại, hiệu lực, quá trình công tác, giấy tờ, bảo hiểm của mình.\n**Các bước:**\n1. Nhân sự → **Hồ sơ của tôi** → bấm thẻ **Hồ sơ nhân sự đầy đủ**.\n2. Tab **Hợp đồng & quá trình** (màn nhỏ ghi **Hợp đồng**): xem **Hợp đồng lao động** (Số hợp đồng, Loại, Hiệu lực từ / đến) và **Quá trình làm việc**.\n3. Tab **Pháp lý & bảo hiểm**: giấy tờ định danh, bảo hiểm, người phụ thuộc. Tab **Trình độ & hồ sơ**: bằng cấp, chứng chỉ.\n4. Ngày vào làm, ngày chính thức: **Hồ sơ của tôi** → tab **Công Việc**.\n**Không làm được?**\n- Tab có ổ khóa / \"Không có quyền xem\" → nhóm đó không mở cho nhân viên (vd **Lương, thuế & ngân hàng**).\n- \"Chưa có dữ liệu\" → HR chưa nhập; bấm **Đề nghị cập nhật** gửi HR kèm ảnh giấy tờ.\n**Lưu ý:**\n- Chỉ bạn và HR xem được các nhóm này; màn Hợp đồng LĐ trong menu Nhân sự chỉ dành cho HR.",
  "source": "docs"
 },
 {
  "id": "so-tay-nhat-ky-cong-truong",
  "title": "Ghi phiếu nhật ký công trường hằng ngày",
  "module": "Dự án",
  "routes": [
   {
    "route": "/da",
    "label": "Dự án"
   }
  ],
  "permission": "Nhật ký dự án · Tạo + Gửi (Room Nhật ký công trường: Sửa, Gửi)",
  "keywords": "nhat ky cong truong ghi nhat ky nkct phieu ky su phieu thi cong ngay bao cao ngay khoi luong hang muc wbs mui thi cong to doi nhan cong may anh hien truong gui tong hop luy ke phan tram ghi phieu nhat ky cong truong hang ngay",
  "questions": "ghi nhat ky cong truong · ghi nhat ky hom · bam ghi nhat ky · nhat ky nhap khoi luong · ghi phieu ky su xong gui ai · ko them hang muc vao nhat ky · nut gui tong hop mo",
  "body": "**Khi nào:** cuối ngày thi công, kỹ sư ghi việc mũi mình làm. Luồng: phiếu kỹ sư → người tổng hợp → CHT duyệt.\n**Các bước:**\n1. Gõ \"ghi nhật ký\" ở ô Tìm kiếm → chọn dự án (hoặc mở dự án → **Nhật ký**) → bấm **Ghi nhật ký chi tiết**.\n2. Kiểm **Ngày lập phiếu**, gõ tên ở ô **Mũi thi công** rồi chọn (chưa có thì **+ Tạo mũi mới**).\n3. Gõ mã / tên ở ô thêm hạng mục; mỗi dòng chọn cách nhập **Hôm nay**, **Lũy kế** hoặc **%**; thêm tổ đội (số người × giờ), máy, ảnh ngay trên dòng.\n4. Có gợi ý **Chép từ phiếu dd/mm** thì bấm để lấy lại hạng mục, tổ đội phiếu trước rồi chỉ sửa số.\n5. **Lưu nháp** để làm tiếp, hoặc **Gửi tổng hợp**.\n**Không làm được?**\n- Nút Ghi nhật ký mờ → chưa có quyền Sửa trong Room Nhật ký công trường → nhờ Admin cấp ở tab Phân quyền của dự án.\n- Gửi tổng hợp mờ, báo quá ngày kế hoạch → ghi ngày dự kiến xong mới và **Lý do đổi ngày**.\n- \"Chưa có cơ sở quy đổi\" → hạng mục không có khối lượng KH → chọn **%**.\n- \"Khu vực này đã có phiếu trong ngày\" → bấm **Mở phiếu có sẵn**.\n**Lưu ý:**\n- % tiến độ chỉ đổi khi CHT **Duyệt & công bố**. Dự án chưa dùng luồng mới thì là form một trang, cần ít nhất 1 ảnh.",
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
  "permission": "Phiên quy trình · Tạo",
  "keywords": "tao phieu quy trinh workflow qt trinh ky de nghi tam ung de nghi thanh toan xuat vat tu ra ngoai phieu moi luu nhap nhan ban nhap excel bang nguoi xu ly buoc dau tao phieu quy trinh (trinh ky)",
  "questions": "tao phieu quy trinh · tao phieu trinh ky · tao phieu de nghi thanh toan · nut tao phieu mo · ko gui phieu quy trinh · tao phieu giong phieu cu · nhap bang excel vao phieu qt",
  "body": "**Khi nào:** cần trình ký theo mẫu: đề nghị tạm ứng, thanh toán, xuất vật tư ra ngoài…\n**Các bước:**\n1. Mở **Quy trình** ở thanh bên → bấm **Tạo phiếu**.\n2. **Chọn quy trình**, gõ **Tiêu đề phiếu**.\n3. Chọn **Người xử lý bước đầu** (một hoặc nhiều người tùy mẫu).\n4. Điền **Thông tin bổ sung** (ô có dấu * là bắt buộc); ô dạng bảng có nút **Nhập từ Excel**; thêm **Ghi chú** nếu cần.\n5. Bấm **Gửi phiếu**. Chưa xong thì **Lưu nháp**: phiếu nháp nằm ở **Phiếu của tôi**, bấm **Tiếp tục soạn** để làm tiếp.\n**Không làm được?**\n- Nút **Tạo phiếu** mờ → chưa có mẫu quy trình nào đang bật → nhờ người quản trị quy trình bật mẫu.\n- Báo \"Mẫu quy trình chưa cấu hình người nhận hợp lệ cho bước đầu\" → mẫu thiếu người xử lý bước 1 → báo người quản trị mẫu.\n- **Gửi phiếu** không bấm được → còn thiếu tiêu đề, người xử lý bước đầu hoặc ô bắt buộc.\n**Lưu ý:**\n- Làm phiếu giống phiếu cũ: mở phiếu cũ → **Nhân bản**.\n- Phiếu đề xuất vật tư dự án và phiếu Yêu cầu không tạo ở đây.",
  "source": "docs"
 },
 {
  "id": "so-tay-quy-trinh-bi-yeu-cau-bo-sung",
  "title": "Phiếu quy trình bị yêu cầu bổ sung: bổ sung, gửi lại",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Quy trình"
   }
  ],
  "permission": "Phiên quy trình · Xử lý được giao",
  "keywords": "phieu quy trinh bi tra lai yeu cau bo sung sua phieu qt gui lai bo sung chung tu dinh kem them tai lieu thao luan ly do tra lai nhan ban phieu bi tu choi phieu quy trinh bi yeu cau bo sung: bo sung, gui lai",
  "questions": "phieu tra sua · phieu qt yeu cau bo sung · sua phieu quy trinh da gui · bo sung chung vao phieu qt · gui phieu tra · nut sua phieu · ly tra phieu",
  "body": "**Khi nào:** người duyệt bấm **Yêu cầu bổ sung**, phiếu quay về bước liền trước (có thể về bạn).\n**Các bước:**\n1. **Quy trình** → **Chờ tôi duyệt**, bấm vào phiếu: lý do trả nằm ở **Hoạt động gần nhất**.\n2. Bấm **Xem chi tiết**. Bổ sung giải trình / giấy tờ ở ô thảo luận: **Thêm tài liệu** hoặc dán ảnh bằng Ctrl+V → **Gửi thảo luận**.\n3. Bấm **Chuyển tiếp / Duyệt** (hoặc **Hoàn thành**), chọn người nhận bước kế tiếp → **Xác nhận xử lý** để gửi đi lại.\n**Không làm được?**\n- Không có nút sửa tiêu đề / ô thông tin → phiếu đang chạy chỉ Admin hoặc người có quyền \"Phiên quy trình · Quản trị phiên quy trình\" sửa được → ghi phần cần sửa vào thảo luận hoặc nhờ người đó sửa.\n- Không thấy nút gửi lại → phiếu được trả về người khác ở bước trước, không phải bạn → xem ô **Xử lý:**.\n- Phiếu bị **Từ chối** → phiếu đã kết thúc → mở phiếu → **Nhân bản** để làm phiếu mới.\n**Lưu ý:**\n- Người bấm Yêu cầu bổ sung là người chọn ai nhận lại phiếu.",
  "source": "docs"
 },
 {
  "id": "so-tay-quy-trinh-duyet-phieu",
  "title": "Duyệt hoặc chuyển bước phiếu quy trình",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Quy trình"
   }
  ],
  "permission": "Phiên quy trình · Xử lý được giao",
  "keywords": "duyet phieu quy trinh qt phe duyet chuyen tiep hoan thanh buoc tu choi yeu cau bo sung cho toi duyet keo tha kanban chon nguoi nhan buoc tiep theo y kien xu ly duyet hoac chuyen buoc phieu quy trinh",
  "questions": "duyet phieu quy trinh · duyet phieu qt · phieu cho duyet nam · duyet xong chon nguoi buoc sau · choi phieu quy trinh · tra phieu ve nguoi truoc · bam duyet bao phai nguoi phan cong",
  "body": "**Khi nào:** phiếu quy trình tới lượt bạn duyệt hoặc làm một bước.\n**Các bước:**\n1. Mở **Quy trình** → **Chờ tôi duyệt** (điện thoại: nút ngay dưới tiêu đề).\n2. Bấm **Duyệt** ngay trên dòng, hoặc bấm vào phiếu để xem nhanh rồi **Xem chi tiết**.\n3. Trong chi tiết chọn **Chuyển tiếp / Duyệt** (bước làm việc thì là **Hoàn thành**), **Yêu cầu bổ sung** hoặc **Từ chối**.\n4. Chọn **Người nhận bước \"…\"** kế tiếp, ghi **Ý kiến / Ghi chú xử lý**.\n5. Bấm **Xác nhận xử lý**.\n**Không làm được?**\n- Báo \"Bạn không phải người được phân công xử lý bước hiện tại\" → bước đang do người khác giữ → xem ô **Xử lý:** trên đầu phiếu.\n- Báo \"Phiếu đã được người khác xử lý…\" → bấm nút làm mới rồi xem lại.\n- Không có nút **Từ chối** → bước dạng Hành động hoặc mẫu tắt từ chối → dùng **Yêu cầu bổ sung**.\n- Báo \"Không tìm thấy nhân sự phù hợp để chỉ định\" → mẫu chưa có người cho bước sau → báo người quản trị mẫu.\n**Lưu ý:**\n- Bước \"tất cả phải duyệt\": bạn duyệt xong phiếu vẫn chờ những người còn lại.\n- **Từ chối** là kết thúc phiếu; chỉ cần sửa thì dùng **Yêu cầu bổ sung**. Ở chế độ **Kanban** kéo thẻ sang cột kế tiếp cũng là duyệt.",
  "source": "docs"
 },
 {
  "id": "so-tay-quy-trinh-khong-thay-nut-duyet",
  "title": "Không thấy nút Duyệt phiếu quy trình",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Quy trình"
   }
  ],
  "permission": "Phiên quy trình · Xử lý được giao",
  "keywords": "khong thay nut duyet quy trinh qt khong duyet duoc phieu nut duyet mo khong co trong cho toi duyet chua toi luot nguoi xu ly tat ca phai duyet quyen xu ly duoc giao khong thay nut duyet phieu quy trinh",
  "questions": "thay nut duyet phieu · ko thay nut duyet quy trinh · phieu hien cho duyet · nut duyet mo · bao duyet bam · tai duyet phieu qt",
  "body": "**Khi nào:** được báo phải duyệt phiếu nhưng không thấy nút hoặc không thấy phiếu.\n**Các bước:**\n1. Mở phiếu từ thông báo, hoặc gõ mã phiếu vào ô **Tìm mã hoặc tiêu đề…** ở Quy trình.\n2. Xem trạng thái: chỉ phiếu **Đang xử lý** mới duyệt được.\n3. Xem ô **Xử lý:** cạnh tiêu đề có tên bạn không.\n4. Xem dải bước bên dưới: ô xanh dương đậm là bước hiện tại.\n**Không làm được?**\n- Ô **Xử lý:** là người khác → chưa tới lượt bạn hoặc bước trước chọn người khác → nhờ người xử lý bước trước hoặc người quản trị quy trình.\n- Nút ghi \"Bạn đã duyệt · chờ N người\" → bước cần tất cả cùng duyệt, bạn đã duyệt rồi.\n- Phiếu **Hoàn thành / Từ chối / Đã hủy** → không duyệt được nữa; muốn chạy lại phải nhờ người có quyền mở lại.\n- Phiếu nằm trong **Chờ tôi duyệt** nhưng dòng chỉ có nút **Xem**, không có **Duyệt** → tài khoản thiếu quyền \"Phiên quy trình · Xử lý được giao\" → nhờ Admin cấp; tạm thời bấm **Xem** → **Xem chi tiết** vẫn duyệt được.\n**Lưu ý:**\n- Phiếu đề xuất (module Yêu cầu) duyệt ở **Yêu cầu** → **Phiếu yêu cầu**, không ở Quy trình.",
  "source": "docs"
 },
 {
  "id": "so-tay-quy-trinh-tao-mau",
  "title": "Tạo mẫu quy trình, thêm trường tùy chỉnh",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf/templates",
    "label": "Mẫu quy trình"
   }
  ],
  "permission": "Mẫu quy trình · Tạo; Mẫu quy trình · Sửa; Mẫu quy trình · Phát hành",
  "keywords": "tao mau quy trinh moi thiet ke quy trinh workflow builder giai doan buoc duyet nguoi xu ly sla truong tuy chinh them truong bat buoc bat quy trinh tat quy trinh nhan ban mau mau in tao mau quy trinh, them truong tuy chinh",
  "questions": "tao quy trinh · tao mau quy trinh · them truong vao mau quy trinh · sua nguoi duyet quy trinh · bat quy trinh nhan vien dung · nhan vien thay quy trinh · dat sla buoc duyet",
  "body": "**Khi nào:** cần quy trình duyệt mới, hoặc đổi bước / người xử lý / ô thông tin của mẫu.\n**Các bước:**\n1. **Quy trình** → **Mẫu quy trình** → **Tạo quy trình mới**: gõ **Tên quy trình**, chọn **Nhóm quy trình** → **Tạo & Thiết kế**.\n2. Tab **Giai đoạn** → **Thêm giai đoạn**: tab **Thông tin** đặt **Tên bước**, **Loại bước** (Phê duyệt / Hành động); tab **Người xử lý** chọn ai làm; tab **Theo dõi/SLA** đặt **SLA (giờ)**.\n3. Tab **Trường tùy chỉnh** → **+ Thêm**: tên trường, loại (văn bản, số, ngày, danh sách chọn, tệp, bảng) → **Thêm trường**; bấm **Không bắt buộc** trên dòng để chuyển thành **Bắt buộc**.\n4. Bấm **Lưu**, rồi **Bật quy trình** để nhân viên thấy khi tạo phiếu.\n**Không làm được?**\n- Không thấy **Tạo quy trình mới** → thiếu quyền \"Mẫu quy trình · Tạo\".\n- Nút ghi **Chưa bật được** → còn giai đoạn chưa có người xử lý → bổ sung rồi **Lưu**.\n- Nút ghi **Lưu trước khi bật** → bấm **Lưu** trước.\n- Không có nút **Bật quy trình** → thiếu quyền \"Mẫu quy trình · Phát hành\".\n**Lưu ý:**\n- Sửa mẫu chỉ áp dụng cho phiếu tạo mới. Làm mẫu tương tự: biểu tượng **Nhân bản quy trình** trên thẻ mẫu (bản sao ở trạng thái tắt).",
  "source": "docs"
 },
 {
  "id": "so-tay-quy-trinh-xem-buoc-theo-doi",
  "title": "Phiếu quy trình đang ở bước nào, ai giữ, theo dõi",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Quy trình"
   }
  ],
  "permission": "Phiên quy trình · Xem",
  "keywords": "phieu quy trinh dang o buoc nao ai dang giu ai dang xu ly da duyet chua tien trinh lich su duyet theo doi phieu them nguoi theo doi phieu cua toi tim phieu qt nhac duyet phieu quy trinh dang o buoc nao, ai giu, theo doi",
  "questions": "phieu quy trinh dang buoc · phieu dang dau ai dang giu · phieu qt da duyet chua · phieu lau chua ai duyet · them nguoi theo doi phieu · theo doi phieu nguoi khac · lich su duyet phieu",
  "body": "**Khi nào:** muốn biết phiếu tới đâu, ai đang giữ, ai đã duyệt; hoặc cho người khác cùng theo dõi.\n**Các bước:**\n1. **Quy trình** → **Phiếu của tôi** (hoặc gõ mã / tiêu đề vào ô **Tìm mã hoặc tiêu đề…**).\n2. Mỗi dòng ghi **Bước x/y**, tên bước và **Người xử lý**.\n3. Bấm phiếu → **Xem chi tiết**: ô **Xử lý:** là người đang giữ; khung **TIẾN TRÌNH CỦA CÁC GIAI ĐOẠN** ghi ai duyệt, lúc nào.\n4. Cho người khác theo dõi: khung **NGƯỜI THEO DÕI** → **Thêm người**; tự theo dõi thì bấm **Theo dõi**.\n5. Phiếu bạn theo dõi nằm ở mục **Theo dõi**.\n**Không làm được?**\n- Không tìm thấy phiếu → bạn không tạo, không xử lý, không theo dõi phiếu đó → nhờ người tạo thêm bạn vào theo dõi.\n- Phiếu đứng lâu → nhắc người ở ô **Xử lý:** bằng @tên trong ô thảo luận.\n**Lưu ý:**\n- Lọc nhanh theo **Đang xử lý**, **Hoàn thành**, **Từ chối**, **Đã hủy**, **Bản nháp**.\n- Hỏi Trợ lý \"việc tôi gửi đang chờ ai\" để xem nhanh các phiếu đang chờ người khác.",
  "source": "docs"
 },
 {
  "id": "so-tay-quy-trinh-xoa-nhap-huy-mo-lai",
  "title": "Xóa bản nháp, hủy hoặc mở lại phiếu quy trình",
  "module": "Quy trình",
  "routes": [
   {
    "route": "/wf",
    "label": "Quy trình"
   }
  ],
  "permission": "Phiên quy trình · Xóa bản nháp của mình; mở lại cần Phiên quy trình · Mở lại phiên quy trình",
  "keywords": "xoa phieu quy trinh huy phieu qt xoa ban nhap gui nham rut lai phieu mo lai phieu da hoan thanh mo lai phieu bi tu choi keo tha kanban tiep tuc soan xoa ban nhap, huy hoac mo lai phieu quy trinh",
  "questions": "xoa phieu quy trinh · huy phieu quy trinh da gui · gui nham phieu qt rut · xoa ban nhap phieu · mo phieu da hoan thanh · nut huy phieu",
  "body": "**Khi nào:** tạo nhầm, gửi nhầm, hoặc cần chạy lại phiếu đã kết thúc.\n**Các bước:**\n1. Bản nháp: **Quy trình** → **Phiếu của tôi** → dòng phiếu → **Tiếp tục soạn**.\n2. Trong hộp **Sửa phiếu**: bấm nút thùng rác → xác nhận để xóa; hoặc **Gửi xử lý** để gửi luôn.\n3. Phiếu đã gửi nhầm: nhờ người đang xử lý bấm **Từ chối** kèm lý do \"gửi nhầm\" (chỉ cần sửa thì **Yêu cầu bổ sung**).\n4. Phiếu đã **Hoàn thành / Từ chối** cần chạy lại: người có quyền mở lại bấm **Kanban**, kéo thẻ từ cột kết thúc về bước cần làm lại, ghi lý do.\n**Không làm được?**\n- Không thấy nút hủy cho phiếu đang chạy → màn Quy trình hiện chưa có nút hủy → làm như bước 3; bước không có **Từ chối** thì nhờ Admin.\n- Không kéo được thẻ trên Kanban → thiếu quyền \"Phiên quy trình · Mở lại phiên quy trình\" → nhờ Admin.\n- Không thấy nút thùng rác → phiếu không còn là bản nháp.\n**Lưu ý:**\n- Muốn làm phiếu mới giống phiếu cũ: mở phiếu → **Nhân bản**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-bao-cao-xuat-excel",
  "title": "Báo cáo tuổi nợ, lãi lỗ dự án và xuất Excel",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/reports",
    "label": "Báo cáo"
   }
  ],
  "permission": "Tài chính · Xem Tài chính toàn công ty",
  "keywords": "bao cao tai chinh tuoi no phai tra tuoi no phai thu lai lo du an lai gop xuat excel bao cao cong no ncc bao cao cong no cdt qua han 90 ngay bao cao tuoi no, lai lo du an va xuat excel",
  "questions": "xuat excel cong no ncc · bao cao tuoi no phai tra · lai lo tung du an · bao cao cong no chu dau tu qua han · ncc no qua 90 ngay · bao cao phai thu thieu no cu",
  "body": "**Khi nào:** cần số liệu tổng hợp để báo cáo lãnh đạo hoặc đối chiếu.\n**Các bước:**\n1. Tài chính → **Báo cáo**.\n2. Chọn tab **Tuổi nợ phải trả**, **Tuổi nợ phải thu** hoặc **Lãi lỗ dự án**.\n3. Tuổi nợ: gộp **Theo NCC** / **Theo dự án**, chọn dự án; bấm ô **Đã quá hạn**, **Quá hạn trên 90 ngày**, **Chưa có hạn** để lọc.\n4. Lãi lỗ: chọn cách **Sắp xếp**; bấm mã dự án để xem chi phí theo loại.\n5. Bấm **Xuất Excel** để tải bảng đang xem.\n**Không làm được?**\n- Báo chưa có quyền → cần Tài chính · Xem Tài chính toàn công ty; người chỉ được xem vài dự án dùng **Tài chính dự án**.\n- Phải thu thiếu nợ trước 30/09 → HĐ chưa đối chiếu đầu kỳ: Phải thu → chọn HĐ → **Đối chiếu đầu kỳ**.\n- Nhiều khoản \"Chưa có hạn\" → khai hạn thanh toán ở NCC / HĐ.\n**Lưu ý:**\n- Số tính đến hôm nay. Xuất Excel lấy đúng bộ lọc đang chọn.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-chot-gia-ncc",
  "title": "Chốt giá khi NCC đổi đơn giá",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/invoices",
    "label": "Hóa đơn NCC"
   }
  ],
  "permission": "Tài chính · Ghi nhận (duyệt theo ma trận)",
  "keywords": "chot gia ncc doi don gia ncc giam gia tang gia gia chot bien ban thoa thuan gia khac don hang dieu chinh gia cong no hoa don dieu chinh ncc no lai chot gia khi ncc doi don gia",
  "questions": "ncc giam gia sau khi giao sua cong no · chot gia theo bien ban · gia hoa don khac gia don hang · ncc tang gia ai duyet · sua don gia don hang da nhan · chot gia tra",
  "body": "**Khi nào:** NCC tính đơn giá khác đơn hàng (giảm giá, tăng giá) cho hàng đã nhận.\n**Các bước:**\n1. Tài chính → **Phải trả** → bước **Hóa đơn NCC**.\n2. Có hóa đơn: **Ghi hóa đơn** → chọn chứng từ → bấm **Đơn giá** ở chứng từ → nhập giá chốt từng dòng → ghi lý do → **Gửi duyệt giá**.\n3. Chưa có hóa đơn: **Chốt giá theo biên bản** → chọn NCC, nhập giá chốt, ngày thỏa thuận, lý do, đính biên bản / email NCC → **Gửi duyệt giá**.\n4. Theo dõi ở tab **Chờ duyệt**; duyệt xong công nợ và chi phí dự án điều chỉnh theo phần chênh.\n**Không làm được?**\n- Ai duyệt: tăng giá → ma trận theo số tăng; chỉ giảm → Kế toán trưởng. Người lập không tự duyệt.\n- \"Chứng từ đang nằm trong đề nghị chi…\" → rút đề nghị chi hoặc chờ chi xong rồi chốt giảm.\n- \"Dòng này đang có bản chốt giá khác chờ duyệt\" → duyệt / rút bản đó trước.\n- \"Chưa cài người duyệt\" → nhờ Quản trị Tài chính bổ sung.\n**Lưu ý:**\n- Đơn hàng và phiếu kho giữ nguyên giá cũ. Chốt giảm sau khi đã trả → khoản **NCC nợ lại** tự trừ công nợ kế tiếp hoặc **Ghi NCC hoàn tiền**. NCC phải xuất HĐ điều chỉnh: tab **Chờ HĐ điều chỉnh** → **Gắn HĐ điều chỉnh**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-cong-no-khac-tong-don",
  "title": "Vì sao công nợ NCC khác tổng tiền đơn hàng",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Tài chính · Xem Tài chính toàn công ty",
  "keywords": "cong no khac tong don no ncc khac gia tri don hang po vi sao no it hon don cong no theo so nhan thuc te chua giao du vat chenh lech cong no giam tru vi sao cong no ncc khac tong tien don hang",
  "questions": "cong no ncc it hon tong don hang · vi no ncc khac gia tri po · don 100 trieu cong no chi 60 trieu · cong no tinh theo so nhan so dat · no ncc cao hon don · cong no ko khop don hang",
  "body": "**Khi nào:** số nợ NCC không bằng tổng tiền các đơn đã đặt.\n**Các bước:**\n1. Tài chính → **Phải trả** → **Đang nợ** → bấm NCC.\n2. Tab **Đơn hàng**: so **Giá trị đặt**, **Đã nhận**, **Chưa nhận** (tiền hàng chưa VAT).\n3. Tab **Công nợ**: mỗi lần kho nhận hàng sinh một chứng từ nợ theo số nhận thực tế, đã gồm VAT. Bấm chứng từ xem \"Ghi nhận · giảm trừ · đã trả\".\n**Không làm được?**\n- Nợ ít hơn đơn → hàng chưa giao đủ, phần chưa nhận chưa thành nợ. NCC không giao nữa thì Mua hàng **Kết thúc thiếu** đơn.\n- Lệch vì VAT → tab Đơn hàng tính chưa VAT, công nợ gồm VAT.\n- Đã trừ tạm ứng / đã trả → xem mục **Tạm ứng** và **Khoản chi** trong khung NCC.\n- Nợ tăng / giảm sau khi ghi hóa đơn → hóa đơn lệch trong dung sai hoặc chốt giá đã duyệt tự điều chỉnh.\n- Kho nhận dư → người duyệt ngoại lệ ở Mua hàng sửa số nhận, công nợ giảm bằng khoản giảm trừ (chỉ khi chứng từ chưa có hóa đơn, chưa trả, chưa đề nghị chi). Kế toán không sửa tay công nợ.\n**Lưu ý:**\n- HĐ nguyên tắc: hàng nhận chỉ thành nợ khi bảng đối soát tháng được ghi công nợ. Phiếu nhập trực tiếp (không qua đơn) thành nợ khi kế toán ghi ở bước **Chờ ghi nợ**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-de-nghi-chi-dang-o-dau",
  "title": "Đề nghị chi đang chờ ai duyệt, đã chi chưa",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/requests",
    "label": "Đề nghị chi"
   },
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Tài chính · Xem Tài chính toàn công ty",
  "keywords": "de nghi chi cho ai duyet ai dang giu de nghi chi trang thai dntt da duyet chua cho chi da chi chua so unc theo doi de nghi chi bi tra lai tam ung phieu chi khac de nghi chi dang cho ai duyet, da chi chua",
  "questions": "de nghi chi dang cho ai duyet · dntt da duyet chua · de nghi chi dang buoc · de nghi chi mai chua chi · de nghi chi tra vi · de nghi chi da chi chua so unc bao nhieu",
  "body": "**Khi nào:** muốn biết đề nghị chi / tạm ứng / phiếu chi khác đang ở đâu, ai đang giữ.\n**Các bước:**\n1. Tài chính → **Phải trả**; ba bước: **Đề nghị chi** (đang duyệt), **Chờ chi** (duyệt đủ, chờ kế toán chi), **Đã chi**.\n2. Ở **Đề nghị chi**, mỗi dòng ghi \"Bước 1/2: …\"; bấm để mở.\n3. Phần **Luồng duyệt**: bước đã duyệt có tên + giờ; bước hiện tại ghi \"đang chờ A hoặc B\".\n4. Bị trả lại: nhãn **Bị trả lại**, lý do hiện ngay dưới số tiền; mở **Nhật ký** xem từng thao tác.\n5. Đã chi: ở bước **Đã chi** có ngày chi, số UNC, file UNC, người xác nhận.\n**Không làm được?**\n- Không thấy ở **Đề nghị chi** → đã duyệt đủ (xem **Chờ chi**) hoặc đã chi (xem **Đã chi**).\n- Đề nghị bị từ chối / đã rút / đã hủy không còn ở ba bước → xem mục **Lịch sử** trong khung NCC; chứng từ đã trở lại **Đang nợ**.\n- Nằm lâu ở **Chờ chi** → kế toán có Tài chính · Xác nhận (khác người lập, người duyệt) chưa bấm **Xác nhận đã chi**.\n**Lưu ý:**\n- Người lập nhận thông báo khi đề nghị được duyệt đủ, bị trả lại, bị hủy, đã chi; bấm thông báo mở đúng đề nghị.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-dieu-chinh-cong-no",
  "title": "Điều chỉnh công nợ NCC (trả ngoài, ghi sai, sửa hạn)",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Tài chính · Ghi nhận (xác nhận: Tài chính · Xác nhận; sửa hạn: Tài chính · Quản trị Tài chính)",
  "keywords": "dieu chinh cong no ncc ghi chi ngoai he thong da tra ngoai vioo unc ngoai huy cong no ghi sai ghi trung dieu chuyen noi bo sua han thanh toan khai han thanh toan dieu chinh cong no ncc (tra ngoai, ghi sai, sua han)",
  "questions": "da chuyen khoan ncc ngoai ghi · cong no ghi trung huy · sua han thanh toan chung ncc · ncc tra cham 45 ngay khai · thay nut de xuat huy · cong no dieu chuyen noi bo phai no",
  "body": "**Khi nào:** công nợ NCC trên Vioo không đúng thực tế.\n**Các bước:**\n1. Tài chính → **Phải trả** → **Đang nợ** → bấm NCC.\n2. Đã trả ngoài Vioo (UNC, phiếu chi): **Ghi chi ngoài hệ thống** (hoặc **Ghi đã trả ngoài** ở chứng từ) → chọn chứng từ, số tiền, ngày, số UNC, đính file → **Gửi xác nhận**.\n3. Chứng từ không phải nợ (ghi trùng, điều chuyển nội bộ): mở chứng từ → **Đề xuất hủy** → ghi lý do.\n4. Sai hạn: mở chứng từ → **Sửa hạn** (ghi lý do); hạn chung của NCC / HĐ: bấm **Khai hạn thanh toán**.\n5. Người khác có Tài chính · Xác nhận bấm **Xác nhận đã chi** / **Xác nhận hủy**.\n**Không làm được?**\n- Không thấy **Đề xuất hủy** → chứng từ đã có khoản chi hoặc chi đang chờ xác nhận.\n- Không xác nhận được việc mình lập → phải người khác xác nhận, kể cả Admin.\n- Không thấy **Sửa hạn** / **Khai hạn thanh toán** → chỉ Admin / Quản trị Tài chính.\n**Lưu ý:**\n- Không sửa, xóa đè chứng từ: mọi điều chỉnh lưu người, lúc, lý do.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-du-bao-dong-tien",
  "title": "Xem dự báo dòng tiền 1, 3, 6 tháng",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/forecast",
    "label": "Dự báo dòng tiền"
   }
  ],
  "permission": "Tài chính · Quản trị Tài chính (dự báo một dự án: người xem được Tài chính dự án)",
  "keywords": "du bao dong tien thu chi 1 thang 3 thang 6 thang 13 tuan thieu tien thang cang nhat can chuan bi von kich ban than trong khoan vay khoan du kien dong tien du an xem du bao dong tien 1, 3, 6 thang",
  "questions": "thang cong ty thieu tien · du bao dong tien thang · chuan bao nhieu von · mo du bao dong tien · khai khoan vao du bao · du bao thu chi du an",
  "body": "**Khi nào:** muốn biết tiền sẽ vào, ra bao nhiêu và tháng nào thiếu để chuẩn bị vốn.\n**Các bước:**\n1. Tài chính → **Dự báo dòng tiền**.\n2. Chọn kịch bản **Cơ sở** / **Thận trọng** / **Thuận lợi** và khoảng **1 tháng** / **3 tháng** / **6 tháng** / **13 tuần**.\n3. Đọc ô **Tháng căng nhất**, **Cần chuẩn bị thêm** và khung **Gợi ý cho GĐ tài chính**.\n4. Bấm **Thu dự kiến** / **Chi dự kiến** để xem từng nguồn ở **Chi tiết theo nguồn**; **Xuất Excel** nếu cần.\n5. Khai thêm cho đúng: **Thêm khoản vay**, **Thêm khoản** dự kiến (hoặc **Import Excel** theo **Tải file mẫu**).\n**Không làm được?**\n- Báo dự báo toàn công ty dành cho Quản trị Tài chính và Admin → xem dự báo từng dự án ở **Tài chính dự án** → tab **Dự báo**.\n- Ô **Tiền đang có** ghi \"Chưa khai\" / \"Chưa biết\" → khai tài khoản tiền và chốt số dư đầu kỳ ở **Thu chi & quỹ**.\n- Khung \"Dự báo còn thiếu … dữ liệu\" → bấm **Khai** ở từng dòng.\n**Lưu ý:**\n- Số tính lại mỗi lần mở từ hợp đồng, Gantt, công nợ, đơn mua. Khoản lặp hằng tháng khai ở **Thu chi & quỹ** → **Khoản định kỳ**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-duyet-de-nghi-chi",
  "title": "Duyệt đề nghị chi",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/requests",
    "label": "Đề nghị chi"
   }
  ],
  "permission": "Người có tên trong ma trận duyệt chi + Tài chính · Xem Tài chính toàn công ty",
  "keywords": "duyet de nghi chi duyet nghi chi duyet dntt phe duyet chi tien duyet de nghi thanh toan tu choi de nghi thanh toan duyet tam ung tra lai de nghi chi cho ban duyet nguoi duyet ma tran duyet chi uy quyen duyet chi di vang duyet de nghi chi",
  "questions": "duyet de nghi chi · thay nut duyet de nghi chi · de nghi chi cho duyet nam · tra de nghi chi ke toan · bao phai nguoi duyet buoc · di phep ai duyet chi thay",
  "body": "**Khi nào:** có thông báo \"Đề nghị chi chờ bạn duyệt\".\n**Các bước:**\n1. Bấm thông báo, hoặc Tài chính → **Phải trả** → bước **Đề nghị chi** (ô ghi \"… chờ bạn duyệt\").\n2. Chọn đề nghị có nhãn **Chờ bạn duyệt**; xem chứng từ, số tiền, ghi chú, **Luồng duyệt**.\n3. Đồng ý: bấm **Duyệt** → xác nhận. Bước cuối thì đề nghị sang **Chờ chi**, kế toán được báo.\n4. Cần sửa: **Trả lại** + lý do (người lập sửa, gửi lại). Không chi: **Từ chối** + lý do (chứng từ về **Đang nợ**).\n**Không làm được?**\n- Không thấy nút **Duyệt** → bạn không có tên ở bước hiện tại, đã duyệt bước trước, là người lập, hoặc đã nhận hàng / chốt chứng từ của đề nghị này. Máy chủ chặn, kể cả Admin.\n- Mở Tài chính báo chưa có quyền → nhờ Admin cấp Tài chính · Xem Tài chính toàn công ty.\n- Sắp đi vắng → Tài chính → **Quản trị** → **Duyệt chi & ủy quyền** → **Ủy quyền**: chọn người nhận, từ ngày, đến ngày, lý do → **Lưu ủy quyền** (hết hạn tự hết hiệu lực).\n**Lưu ý:**\n- Người duyệt do **Ma trận duyệt chi** quyết theo số tiền (Quản trị Tài chính sửa); đổi ma trận không ảnh hưởng đề nghị đang chờ.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-ghi-hoa-don-ncc",
  "title": "Ghi hóa đơn NCC (đọc XML hoặc đọc ảnh bằng AI)",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/invoices",
    "label": "Hóa đơn NCC"
   }
  ],
  "permission": "Tài chính · Ghi nhận",
  "keywords": "hoa don ncc hoa don dau vao ghi hoa don nhap hoa don doc file xml hoa don dien tu doc anh hoa don ai pdf khop 3 ben lech hoa don dung sai cho hang hoa don gtgt ghi hoa don ncc (doc xml hoac doc anh bang ai)",
  "questions": "nhap hoa don ncc · doc file xml hoa don dien tu · chup hoa don giay ai doc · hoa don lech nhan hang · hoa don ve truoc hang ghi · tim thay ncc theo ma so thue",
  "body": "**Khi nào:** nhận hóa đơn GTGT của NCC cho hàng đã nhận / đã đối soát.\n**Các bước:**\n1. Tài chính → **Phải trả** → bước **Hóa đơn NCC** → **Ghi hóa đơn**.\n2. Có XML: bấm **Đọc file XML hóa đơn điện tử**. Hóa đơn giấy / PDF: **Đọc ảnh / PDF hóa đơn (AI)**. Hệ thống điền ký hiệu, số, ngày, tiền, VAT và tìm NCC theo MST; kiểm lại, sai thì sửa tay.\n3. Ở **Chứng từ hóa đơn này thanh toán**, tích chứng từ nhận hàng / đối soát, hoặc bấm **Chọn tự động theo tổng tiền**.\n4. Xem dòng lệch rồi bấm **Ghi hóa đơn** (khớp / lệch trong dung sai), **Gửi duyệt lệch** (vượt dung sai, ghi lý do) hoặc **Ghi chờ hàng** (chưa chọn chứng từ).\n**Không làm được?**\n- \"Không tìm thấy NCC có MST…\" → chọn NCC tay hoặc bổ sung MST ở Hợp đồng → **Đối tác**.\n- AI báo chưa cấu hình / chưa được cấp / hết lượt → nhập tay như thường.\n- \"Hóa đơn này đã ghi rồi\" → trùng NCC + ký hiệu + số.\n- Hóa đơn ghi **Chờ hàng** → kho nhận xong bấm **Khớp chứng từ**.\n**Lưu ý:**\n- Dung sai 0,5% hoặc 50.000 đ: trong dung sai thì công nợ + chi phí tự điều chỉnh phần lệch. NCC đổi đơn giá → bấm **Đơn giá** ở chứng từ để chốt giá.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-hoan-tam-ung-ncc",
  "title": "NCC hoàn tạm ứng hoặc chuyển tạm ứng sang đơn khác",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/advances",
    "label": "Tạm ứng NCC"
   }
  ],
  "permission": "Tài chính · Ghi nhận (xác nhận: Tài chính · Xác nhận)",
  "keywords": "ncc hoan tam ung hoan ung tra lai tien ung ncc hoan tien chuyen tam ung sang don khac can tru tam ung qua han hoan ung cho hoan thu hoi tam ung ncc hoan tam ung hoac chuyen tam ung sang don khac",
  "questions": "ncc tra tien tam ung ghi · chuyen tam ung sang don khac ncc · tam ung qua han hoan ung xu ly · can tru tam ung vao cong no tay · don ket thuc thieu ncc tra tien ung · hoan ung ncc",
  "body": "**Khi nào:** NCC không giao / giao thiếu nên trả lại tiền ứng, hoặc tiền ứng đơn này dùng cho đơn khác.\n**Các bước:**\n1. Tài chính → **Phải trả** → **Tạm ứng NCC**; bấm ô **Quá hạn hoàn ứng** hoặc **Chờ hoàn** để lọc, rồi chọn khoản tạm ứng.\n2. NCC trả tiền: **NCC hoàn tiền** → số tiền, ngày nhận, số giấy báo có, **Tiền vào tài khoản**, đính chứng từ, lý do → **Gửi xác nhận**.\n3. Chuyển đơn: **Chuyển sang đơn khác** → chọn đơn cùng NCC, cùng dự án, ghi lý do → **Gửi xác nhận**.\n4. Trừ vào chứng từ nợ: **Cấn trừ tay** → chọn chứng từ, số tiền → **Cấn trừ**.\n5. Người khác có Tài chính · Xác nhận bấm **Xác nhận**.\n**Không làm được?**\n- Không thấy các nút → tạm ứng còn đang duyệt / chờ chi, hoặc đang có phiếu hoàn / chuyển chờ xác nhận (xử lý xong mới lập tiếp).\n- Không có đơn để chuyển → NCC không còn đơn chờ giao cùng dự án; ghi NCC hoàn tiền.\n- Không xác nhận được phiếu mình lập → nhờ người khác.\n**Lưu ý:**\n- Cấn trừ sai thì bấm **Hoàn tác** ở dòng cấn trừ. Tiền NCC trả lại do chốt giảm giá ghi ở **Hóa đơn NCC** → **Ghi NCC hoàn tiền**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-khong-thay-so-lieu",
  "title": "Không vào được Tài chính, không thấy số liệu tài chính",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/project",
    "label": "Tài chính dự án"
   },
   {
    "route": "/finance",
    "label": "Tài chính"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "khong thay tai chinh khong co quyen tai chinh khong xem duoc so lieu tai chinh du an cong tac xem tai chinh bi an so tien chua co quyen xem tai chinh toan cong ty quyen tai chinh ghi nhan xac nhan khong vao duoc tai chinh, khong thay so lieu tai chinh",
  "questions": "vao tai chinh · thay so lieu tai chinh du an · bao chua quyen tai chinh · quyen tai chinh du an · chi thay tai chinh du an thay phai tra · ko tai chinh",
  "body": "**Khi nào:** mở Tài chính bị báo chưa có quyền, hoặc ô số tiền ở dự án bị ẩn.\n**Các bước:**\n1. Có việc kế toán toàn công ty → nhờ Admin cấp một trong các quyền: Tài chính · Xem Tài chính toàn công ty, · Ghi nhận, · Xác nhận, · Quản trị Tài chính (Cài đặt → **Người dùng** → Sửa → Tài chính).\n2. Chỉ cần xem tài chính vài dự án → nhờ Admin bật ở Dự án → **Thiết lập** → **Phân quyền** → thẻ **Ai được xem Tài chính & Hợp đồng**.\n3. Được bật rồi: mở dự án → thẻ **Tài chính dự án** ở trang điều hành → **Mở ở Tài chính** (chỉ xem).\n**Không làm được?**\n- \"Chưa có dự án nào bạn được xem tài chính\" → chưa được bật ở dự án nào.\n- Thấy **Tài chính dự án** nhưng các mục khác báo chưa có quyền → bạn chỉ được xem theo dự án, không có quyền toàn công ty.\n- Xem được nhưng không có nút thao tác → quyền Xem chỉ đọc; ghi cần Ghi nhận, xác nhận cần Xác nhận (khác người lập).\n- Dự báo toàn công ty báo dành cho Quản trị → chỉ Quản trị Tài chính và Admin.\n**Lưu ý:**\n- Người duyệt chi trong ma trận vẫn cần ít nhất quyền Xem để mở được màn duyệt.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-ngan-sach-du-an",
  "title": "Lập ngân sách dự án và xem cảnh báo vượt ngân sách",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/cost",
    "label": "Chi phí & ngân sách"
   }
  ],
  "permission": "Tài chính · Ghi nhận (duyệt: Tài chính · Quản trị Tài chính)",
  "keywords": "ngan sach du an lap ngan sach dieu chinh ngan sach chi phi theo khoan muc vuot ngan sach canh bao vuot don mua vuot ngan sach vat tu du toan quy du an cap von du bao khi hoan thanh lap ngan sach du an va xem canh bao vuot ngan sach",
  "questions": "lap ngan sach du an · du an dang vuot ngan sach · don mua vuot ngan sach vat tu ai duyet · ngan sach vat tu sua · chi phi theo khoan muc · nut lap ngan sach mo",
  "body": "**Khi nào:** kế toán / QS lập hoặc điều chỉnh ngân sách chi phí của dự án; theo dõi vượt.\n**Các bước:**\n1. Tài chính → **Chi phí & ngân sách** → tab **Dự án & quỹ dự án**; xem khung **Cần chú ý** (vượt, sắp chạm, chưa có ngân sách).\n2. Bấm dự án → tab **Ngân sách & chi phí** → **Lập ngân sách** (hoặc **Điều chỉnh ngân sách**).\n3. Nhập số cho từng khoản mục (để trống = chưa lập), ghi **Lý do lập / điều chỉnh** → **Gửi duyệt**.\n4. Quản trị Tài chính (khác người lập) bấm **Duyệt** / **Trả lại**; duyệt xong thay bản đang áp dụng.\n**Không làm được?**\n- Nút mờ → đang có bản chờ duyệt; duyệt / trả lại hoặc **Rút** bản đó trước.\n- Ngân sách vật tư không nhập được → lấy từ dự toán vật tư, sửa ở Dự án → Vật tư.\n- Đơn mua vượt ngân sách vật tư → nằm ở **Chờ xử lý**; người duyệt vượt ngân sách (cài ở **Quản trị**) bấm **Duyệt vượt ngân sách** hoặc **Không duyệt**.\n- Không thấy nút → thiếu Tài chính · Ghi nhận.\n**Lưu ý:**\n- \"Đã dùng\" gồm chi phí đã ghi nhận và đơn mua chưa nhận. Đơn quá hẹn giao mà NCC không giao nữa → Mua hàng **Kết thúc thiếu** để số không bị sai.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-nghiem-thu-thau-phu",
  "title": "Nghiệm thu và thanh toán hợp đồng thầu phụ",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/subcontracts",
    "label": "Thầu phụ"
   }
  ],
  "permission": "Tài chính · Ghi nhận (ghi nhận đợt: Tài chính · Xác nhận)",
  "keywords": "thau phu to doi nghiem thu thanh toan thau phu dot nghiem thu luy ke giu lai bao hanh thu hoi tam ung thue tncn khau tru tam ung thau phu tra tien thau phu chi phi nhan cong nghiem thu va thanh toan hop dong thau phu",
  "questions": "thanh toan thau phu · lap dot nghiem thu thau phu · nut lap dot nghiem thu mo · tam ung to doi · giu bao hanh thau phu khi tra · khau tru vat tu cap thau phu",
  "body": "**Khi nào:** có biên bản nghiệm thu khối lượng của thầu phụ / tổ đội cần trả tiền.\n**Các bước:**\n1. Tài chính → **Thầu phụ** → chọn hợp đồng.\n2. Bấm **Lập đợt nghiệm thu** → nhập kỳ, nội dung, **giá trị LŨY KẾ đến kỳ này**; thêm khấu trừ (vật tư cấp, chi hộ, phạt…) nếu có; đính biên bản.\n3. Bấm **Lưu và gửi ghi nhận** (hoặc **Lưu nháp**, sau bấm **Gửi ghi nhận**).\n4. Người khác có Tài chính · Xác nhận bấm **Ghi nhận** → sinh công nợ, khoản giữ lại, chi phí nhân công.\n5. Trả tiền: **Phải trả** → **Đang nợ** → chọn đối tác → **Lập đề nghị chi**.\n**Không làm được?**\n- Nút mờ, khung \"Chưa lập đợt được\" ghi rõ thiếu gì: HĐ chưa gắn đối tác (Quản trị Tài chính khai ở **Điều khoản**), chưa gắn dự án, chưa ở trạng thái Đã ký / Đang thi công / Hoàn thành, chưa chốt đầu kỳ (**Khai đầu kỳ** → người khác **Chốt đầu kỳ**), hoặc đang có đợt nháp / chờ ghi nhận.\n- Lũy kế vượt giá trị HĐ → ghi lý do / số phụ lục.\n- Tiền giữ lại chưa đến hạn bảo hành → chưa chọn được để trả.\n**Lưu ý:**\n- Ứng tiền: nút **Tạm ứng**; mỗi đợt tự thu hồi theo %. HĐ thầu phụ khai ở Hợp đồng → **HĐ Thầu phụ** → **Thêm hợp đồng**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-phieu-chi-khac",
  "title": "Lập phiếu chi khác (lương, thuế, văn phòng…)",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/cash",
    "label": "Thu chi & quỹ"
   }
  ],
  "permission": "Tài chính · Ghi nhận",
  "keywords": "phieu chi khac chi luong nop thue bao hiem chi phi van phong dien nuoc lai vay tra no vay tam ung nhan vien phi ngan hang chi khong qua ncc chi phi chung lap phieu chi khac (luong, thue, van phong…)",
  "questions": "chi luong nop thue lap phieu · khoan chi phai ncc ghi · tam ung nhan vien lap · thay nut phieu chi khac · phi ngan hang ghi vao · chi phi van phong tinh vao du an",
  "body": "**Khi nào:** chi tiền không qua NCC: lương, thuế, bảo hiểm, văn phòng, điện nước, lãi vay, tạm ứng nhân viên, phí ngân hàng…\n**Các bước:**\n1. Tài chính → **Thu chi & quỹ** → phần **Sổ thu chi** → **Phiếu chi khác**.\n2. Chọn **Loại chi**, nhập **Người / nơi nhận**, **Số tiền**, **Ngày dự kiến chi**, **Hình thức**, **Nội dung**.\n3. **Tính vào chi phí dự án**: chọn dự án + **Khoản mục chi phí**; để \"Không — chi phí chung\" nếu là chi phí công ty.\n4. Xem **Luồng duyệt** → **Gửi duyệt**. Theo dõi ở **Phải trả** → **Đề nghị chi**; duyệt xong người khác **Xác nhận đã chi** (chọn tài khoản).\n**Không làm được?**\n- Không thấy nút **Phiếu chi khác** → chưa khai tài khoản tiền nào (bấm **Khai tài khoản tiền**) hoặc thiếu Tài chính · Ghi nhận.\n- Bước duyệt báo \"chưa có người duyệt\" → nhờ Quản trị Tài chính sửa ma trận duyệt chi.\n- Bị trả lại → mở ở **Đề nghị chi** → **Sửa và gửi lại**.\n**Lưu ý:**\n- Khoản lặp hằng tháng (lương, thuê nhà) khai thêm ở **Khoản định kỳ** để dự báo tính trước. Sổ thu chi không sửa / xóa được: chi nhầm thì đảo.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-quy-cong-truong",
  "title": "Ghi khoản chi quỹ công trường",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/site-fund",
    "label": "Quỹ công trường"
   }
  ],
  "permission": "Người giữ quỹ công trường (không cần quyền Tài chính)",
  "keywords": "quy cong truong chi tien mat cong truong cht chi huy truong ghi khoan chi anh hoa don quyet toan quy cap quy nop lai tien quy am cong ty no ghi khoan chi quy cong truong",
  "questions": "chi huy truong ghi tien chi cong truong · quy cong truong · chup hoa don chi cong truong gui ke toan · khoan chi quy tra sua · bao chua giu quy cong truong · chi qua so cap",
  "body": "**Khi nào:** người giữ quỹ (thường là CHT) chi tiền mặt ở công trường và cần báo kế toán.\n**Các bước:**\n1. Gõ \"quỹ công trường\" ở ô Tìm kiếm → mở **Quỹ công trường của tôi** (dùng tốt trên điện thoại).\n2. Xem **Đang giữ**, **Chờ duyệt**, **Đã được cấp** → bấm **Thêm khoản chi**.\n3. Nhập **Nội dung chi**, **Số tiền**, **Ngày chi**, **Khoản mục chi phí**, **Chi cho ai**; chụp **Ảnh hóa đơn / phiếu chi**.\n4. Bấm **Gửi duyệt** → kế toán duyệt ở Tài chính → **Thu chi & quỹ** → mục **Quỹ công trường**.\n5. Bị trả lại: bấm **Bổ sung, gửi lại**; ghi nhầm khi chưa duyệt: **Sửa** hoặc **Rút**.\n**Không làm được?**\n- \"Bạn chưa giữ quỹ công trường nào\" → kế toán chưa khai quỹ cho bạn (Thu chi & quỹ → **Khai tài khoản tiền**, loại Quỹ công trường, chọn **Người giữ quỹ**).\n- Khoản thiếu ảnh chứng từ dễ bị trả lại.\n- Ngày chi không được sau hôm nay.\n**Lưu ý:**\n- Chi quá số được cấp → ô hiện \"Công ty đang nợ\", bù ở lần cấp sau. Cấp thêm quỹ / nộp lại tiền: kế toán dùng **Chuyển tiền** ở sổ thu chi. Người duyệt phải khác người lập và người giữ quỹ.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-sao-ke-ngan-hang",
  "title": "Nhập sao kê ngân hàng và khớp với sổ",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/cash",
    "label": "Thu chi & quỹ"
   }
  ],
  "permission": "Tài chính · Ghi nhận (hủy file: Tài chính · Xác nhận)",
  "keywords": "sao ke ngan hang nhap sao ke excel khop sao ke doi chieu ngan hang so phu internet banking vietcombank bidv techcombank tu khop doi chieu sao ke cuoi thang chot thang nhap sao ke ngan hang va khop voi so",
  "questions": "nhap ke ngan hang vao · file ke bao doc dong · dong ke chua khop xu ly · phi ngan hang ke ghi · nhap nham file ke huy · doi chieu ke cuoi thang",
  "body": "**Khi nào:** đối chiếu tiền vào ra trên tài khoản ngân hàng với sổ thu chi Vioo.\n**Các bước:**\n1. Tải sao kê dạng Excel từ internet banking.\n2. Tài chính → **Thu chi & quỹ** → khung **Tài khoản tiền** → ở tài khoản ngân hàng bấm **Sao kê ngân hàng**.\n3. Bấm **Nhập file sao kê** → chọn file → **Nhập**; Vioo tự đọc cột và tự khớp.\n4. Tab **Chưa khớp**: bấm **Khớp …** theo gợi ý; không có trong sổ thì **Ghi phiếu thu khác** / **Lập phiếu chi khác**, hoặc **Bỏ qua** (ghi lý do). Ghi xong bấm **Tự khớp lại**.\n5. Cuối tháng: ở tài khoản bấm **Đối chiếu sao kê** → nhập số dư sao kê → **Gửi chốt tháng**.\n**Không làm được?**\n- \"Không đọc được dòng giao dịch nào\" → file thiếu cột Ngày và Ghi nợ / Ghi có (hoặc Số tiền); xuất lại dạng Excel.\n- Khớp mà số tiền lệch → phải ghi lý do (VD ngân hàng trừ phí).\n- Tiền CĐT trên sao kê → ghi ở **Phải thu**, không ghi thu khác.\n- Nhập nhầm tài khoản → **Huỷ** file ở mục File sao kê đã nhập.\n- Không thấy **Đối chiếu sao kê** → tài khoản chưa chốt số dư đầu kỳ.\n**Lưu ý:**\n- Mỗi lần tối đa 5.000 dòng; dòng đã nhập trước tự bỏ. Chốt tháng xong không ghi lùi ngày vào tháng đó.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-sua-huy-dao-de-nghi-chi",
  "title": "Sửa, rút, hủy hoặc đảo đề nghị chi",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/requests",
    "label": "Đề nghị chi"
   },
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Người lập đề nghị; hủy / đảo: Tài chính · Xác nhận",
  "keywords": "sua de nghi chi gui lai rut de nghi chi huy de nghi chi da duyet dao phieu chi chi nham chi trung sai so tien huy dntt xoa de nghi chi sua, rut, huy hoac dao de nghi chi",
  "questions": "de nghi chi tra sua · rut de nghi chi da gui · huy de nghi chi da duyet · chi nham ncc sai so tien · xoa phieu chi · thay nut sua gui",
  "body": "**Khi nào:** đề nghị chi cần sửa, không chi nữa, hoặc đã chi nhầm.\n**Các bước:**\n1. Tài chính → **Phải trả** → mở đề nghị ở bước đang nằm.\n2. **Bị trả lại**: đọc lý do (khung đỏ) → **Sửa và gửi lại** → sửa chứng từ / số tiền → **Gửi lại**; luồng duyệt chạy lại từ đầu.\n3. Đang duyệt hoặc bị trả lại, không chi nữa: **Rút** → chứng từ về **Đang nợ**.\n4. Đã duyệt đủ (ở **Chờ chi**) mà không chi: **Hủy đề nghị** + lý do.\n5. Đã chi nhầm (ở **Đã chi**): **Đảo phiếu chi** + lý do → công nợ cộng lại, dòng tiền ghi đảo; lập đề nghị đúng sau.\n**Không làm được?**\n- Không thấy **Rút** / **Sửa và gửi lại** → chỉ người lập thấy; người khác chờ người lập.\n- Không thấy **Hủy đề nghị** → chỉ người lập hoặc người có Tài chính · Xác nhận.\n- Không thấy **Đảo phiếu chi** → cần Tài chính · Xác nhận.\n- Đảo tạm ứng báo đã cấn trừ / có phiếu hoàn → vào **Tạm ứng NCC** hoàn tác cấn trừ, xử lý phiếu hoàn trước.\n**Lưu ý:**\n- Không xóa phiếu: mọi lần rút, hủy, đảo lưu người, lúc, lý do.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-tam-ung-ncc",
  "title": "Lập đề nghị tạm ứng cho NCC",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/advances",
    "label": "Tạm ứng NCC"
   },
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Tài chính · Ghi nhận",
  "keywords": "tam ung ncc ung tien nha cung cap ung truoc dat coc ncc tam ung theo don hang tam ung hop dong nguyen tac han hoan ung de nghi tam ung lap de nghi tam ung cho ncc",
  "questions": "tam ung ncc · ncc doi ung truoc 30 lap · lap de nghi tam ung theo don hang · tam ung theo hop dong nguyen · chon don tam ung · dat coc nha cung cap",
  "body": "**Khi nào:** NCC yêu cầu ứng tiền trước khi giao hàng.\n**Các bước:**\n1. Tài chính → **Phải trả** → bước **Tạm ứng NCC** → **Lập đề nghị tạm ứng** (hoặc trong khung NCC bấm **Lập tạm ứng**).\n2. Chọn NCC (chỉ hiện NCC có đơn đang chờ giao) → chọn **Theo đơn hàng** hoặc **Theo HĐ nguyên tắc**.\n3. Nhập **Tỷ lệ** hoặc **Số tiền tạm ứng**, **Hạn hoàn ứng**, **Lý do tạm ứng**, **Hình thức**, **Ngày dự kiến chi**.\n4. Xem **Luồng duyệt** → **Gửi duyệt**. Duyệt xong, kế toán **Xác nhận đã chi** như đề nghị chi.\n**Không làm được?**\n- Không có đơn để chọn → đơn đã giao đủ / hủy, hoặc là đơn gọi hàng theo HĐ nguyên tắc (chọn **Theo HĐ nguyên tắc**).\n- \"Vượt giá trị đơn còn ứng được\" → tổng tạm ứng của đơn không quá giá trị đơn gồm VAT.\n- Tỷ lệ vượt ngưỡng cảnh báo → ghi rõ lý do; vượt ngưỡng duyệt thêm sẽ có thêm bước duyệt.\n- \"NCC chưa có số tài khoản\" → chọn Tiền mặt hoặc nhờ Mua hàng khai ở hồ sơ đối tác.\n**Lưu ý:**\n- Tạm ứng không phải chi phí: khi kho nhận hàng của đơn (hoặc chốt đối soát HĐ), công nợ tự trừ tạm ứng. Tạm ứng thầu phụ lập ở **Thầu phụ**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-thu-tien-cdt",
  "title": "Thu tiền chủ đầu tư (đợt thanh toán, phiếu thu)",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/receivables",
    "label": "Phải thu"
   }
  ],
  "permission": "Tài chính · Ghi nhận (xác nhận phiếu thu: Tài chính · Xác nhận)",
  "keywords": "phai thu chu dau tu cdt thu tien cdt dot de nghi thanh toan nghiem thu khoi luong cdt xac nhan ghi cdt tra tien giay bao co phieu thu tam ung cdt giu lai bao hanh qua han thu thu tien chu dau tu (dot thanh toan, phieu thu)",
  "questions": "chu dau tu chuyen tien ghi · lap dot de nghi thanh toan cdt · cdt duyet khac so gui · cdt con no bao nhieu · thay hop dong cdt phai thu · ghi giay bao tien cdt",
  "body": "**Khi nào:** đòi tiền CĐT theo khối lượng nghiệm thu và ghi khi tiền về.\n**Các bước:**\n1. Tài chính → **Phải thu** → chọn hợp đồng CĐT.\n2. **Lập đợt đề nghị thanh toán**: loại đợt, nội dung, giá trị trước VAT, đính hồ sơ → **Lưu đợt nháp**.\n3. Gửi hồ sơ cho CĐT xong bấm **Đã gửi CĐT**. CĐT chốt số: **CĐT xác nhận** → ngày, số CĐT xác nhận (gồm VAT) → **Ghi CĐT xác nhận**; lúc này mới thành phải thu. CĐT trả hồ sơ: **CĐT trả lại**.\n4. Có hóa đơn: **Ghi hóa đơn** ở đợt.\n5. Tiền về: **Ghi CĐT trả tiền** → số tiền, ngày, số giấy báo có, tài khoản, đính giấy báo có, trừ vào đợt → **Gửi xác nhận**; người khác xác nhận mới vào sổ.\n**Không làm được?**\n- Không có HĐ ở danh sách → chưa khai HĐ nhận thầu: Hợp đồng → **HĐ Nhận thầu** → **Tạo HĐ nhận thầu**.\n- CĐT duyệt khác số gửi → bắt buộc ghi lý do.\n- Thu hồi tạm ứng / giữ lại khác gợi ý → ghi lý do; % mặc định do Quản trị Tài chính sửa ở **Khai điều khoản**.\n- Tiền về chưa có đợt xác nhận → ghi là CĐT trả trước, trừ vào đợt sau.\n**Lưu ý:**\n- Đợt thu và phiếu thu chỉ lập ở đây; Dự án → Hợp đồng chỉ xem.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-xac-nhan-da-chi",
  "title": "Xác nhận đã chi (đính UNC)",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Tài chính · Xác nhận",
  "keywords": "xac nhan da chi cho chi unc uy nhiem chi phieu chi danh dau da thanh toan ncc chuyen khoan xong ghi da tra ke toan chi tien tai khoan chi xac nhan da chi (dinh unc)",
  "questions": "chuyen khoan ncc xong xac nhan · dinh unc vao de nghi chi · thay nut xac nhan da chi · bao so unc da ghi ncc · de nghi chi da duyet chi tien · xac nhan da chi mo",
  "body": "**Khi nào:** đề nghị đã duyệt đủ và kế toán đã chuyển khoản / chi tiền mặt.\n**Các bước:**\n1. Tài chính → **Phải trả** → bước **Chờ chi**; mở đề nghị có nhãn **Bạn chi được**.\n2. Bấm **Xác nhận đã chi**.\n3. Nhập **Ngày chi** (không sau hôm nay), **Số UNC / phiếu chi**; chọn **Chi từ tài khoản**; đính file UNC (ảnh hoặc PDF).\n4. Đọc khung **Hệ thống sẽ ghi** rồi bấm **Xác nhận đã chi**.\n**Không làm được?**\n- Không thấy nút → người xác nhận phải khác người lập, người duyệt và người đã nhận hàng / chốt đối soát (kể cả Admin); hoặc thiếu Tài chính · Xác nhận.\n- Nút mờ → còn thiếu tài khoản, số UNC hoặc file UNC (dòng chữ cam ghi rõ).\n- \"Số UNC / phiếu chi này đã được ghi cho NCC\" → kiểm tra có chi trùng không.\n- Tháng của tài khoản đã chốt đối chiếu sao kê → không ghi lùi ngày vào tháng đó.\n- Không có tài khoản để chọn → khai ở **Thu chi & quỹ** → **Khai tài khoản tiền**.\n**Lưu ý:**\n- Xong: công nợ giảm, sổ thu chi tự ghi; đề nghị nhiều dự án tự tách phiếu chi theo dự án. Chi nhầm thì **Đảo phiếu chi**, không xóa.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-chinh-xem-cong-no-ncc",
  "title": "Xem công nợ một nhà cung cấp",
  "module": "Tài chính",
  "routes": [
   {
    "route": "/finance/payables",
    "label": "Phải trả"
   }
  ],
  "permission": "Tài chính · Xem Tài chính toàn công ty",
  "keywords": "cong no ncc no nha cung cap xem no ncc con no bao nhieu qua han den han phai tra ncc lich su tra tien ncc so du ncc cong no theo du an xem cong no mot nha cung cap",
  "questions": "con no ncc bao nhieu · cong no nha cung cap · ncc dang qua han thanh toan · lich su tra tien ncc · so qua han ghi tam tinh · cong no ncc theo du an the",
  "body": "**Khi nào:** cần biết đang nợ NCC bao nhiêu, khoản nào quá hạn, đã trả gì.\n**Các bước:**\n1. Tài chính → **Phải trả** → bước **Đang nợ**.\n2. Gõ tên NCC vào ô \"Tìm NCC, dự án…\"; lọc **Mọi dự án** / **Mọi nguồn**, sắp **Quá hạn trước** hoặc **Nợ nhiều nhất**. Bấm ô **Quá hạn** / **Đến hạn 7 ngày** để lọc nhanh.\n3. Bấm NCC: xem **Đang nợ**, **Quá hạn**, **Đến hạn 7 ngày**, số đã trả; tab **Công nợ** nhóm theo dự án → hợp đồng.\n4. Bấm một chứng từ để xem nguồn gốc (đơn, đợt giao, kho nhận, hạn) và hóa đơn.\n5. Tab **Đơn hàng** xem giá trị đặt / đã nhận; mục **Lịch sử** xem ai ghi, ai duyệt, ai chi.\n**Không làm được?**\n- Màn báo chưa có quyền → nhờ Admin cấp Tài chính · Xem Tài chính toàn công ty.\n- NCC có nhãn \"Chưa đối chiếu đầu kỳ\", số quá hạn \"tạm tính\" → nợ cũ trước khi dùng Vioo chưa chốt theo sổ MISA; kế toán bấm **Đối chiếu đầu kỳ** ở NCC trước khi chi để tránh trả trùng.\n- Không thấy NCC → NCC không còn chứng từ đang mở, hoặc đang lọc; bấm **Xóa lọc**.\n**Lưu ý:**\n- Trên điện thoại: chọn NCC rồi bấm **Danh sách** để quay lại. Xuất Excel tuổi nợ ở Tài chính → **Báo cáo**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-san-bao-tri",
  "title": "Ghi bảo trì, sửa chữa tài sản",
  "module": "Tài sản",
  "routes": [
   {
    "route": "/ts/maintenance",
    "label": "Bảo trì / Sửa chữa"
   }
  ],
  "permission": "Bảo trì tài sản · Tạo",
  "keywords": "bao tri tai san sua chua tai san bao hanh kiem tra may hong bao hong chi phi sua chua hoa don sua chua bao tri dinh ky danh dau hoan thanh import excel bao tri ghi bao tri, sua chua tai san",
  "questions": "bao hong tai san · ghi sua chua may tinh · tao phieu bao tri · dinh kem hoa don sua chua · danh dau bao tri xong · bam hoan thanh bao tri luu · nhap bao tri excel",
  "body": "**Khi nào:** tài sản hỏng cần sửa, đến kỳ bảo trì, hoặc gửi bảo hành.\n**Các bước:**\n1. **Tài sản** → **Bảo trì / Sửa chữa** → **Tạo mới**.\n2. Chọn **Tài sản**, **Loại** (Sửa chữa / Bảo trì định kỳ / Kiểm tra / Bảo hành), **Trạng thái**, ghi **Mô tả**.\n3. Ghi ngày, **Chi phí dự kiến (báo giá)**, **Đơn vị sửa chữa / Nhà cung cấp**, **Số hoá đơn**; kéo thả hóa đơn / chứng từ vào ô đính kèm.\n4. Bấm **Lưu bản ghi**.\n5. Sửa xong: bấm biểu tượng **Đánh dấu hoàn thành** trên dòng.\n**Không làm được?**\n- **Lưu bản ghi** mờ → chưa chọn tài sản hoặc chưa ghi mô tả.\n- Tạo với trạng thái **Hoàn thành**, hoặc bấm **Đánh dấu hoàn thành**, báo xong nhưng tải lại không thấy đổi → hiện chỉ Admin cập nhật được bản ghi bảo trì → nhờ Admin.\n- Nhân viên muốn báo hỏng → chưa có nút báo hỏng riêng → báo người phụ trách tài sản tạo bản ghi **Sửa chữa**.\n**Lưu ý:**\n- Nhiều bản ghi một lúc: **Import Excel**.\n- Chi phí sửa chữa cộng dồn vào hồ sơ tài sản (**Chi phí BT/SC**).",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-san-cap-phat-thu-hoi",
  "title": "Cấp phát, thu hồi, luân chuyển tài sản",
  "module": "Tài sản",
  "routes": [
   {
    "route": "/ts/assignment",
    "label": "Cấp phát / Thu hồi"
   }
  ],
  "permission": "Cấp phát tài sản · Cấp phát; Cấp phát tài sản · Thu hồi; Cấp phát tài sản · Luân chuyển",
  "keywords": "cap phat tai san thu hoi tai san luan chuyen ban giao may tinh laptop thiet bi van phong ts giao tai san cho nhan vien nghi viec tra tai san ai dang giu lich su cap phat cap phat, thu hoi, luan chuyen tai san",
  "questions": "cap phat tai san nhan vien · thu hoi laptop · nhan vien nghi viec thu hoi tai san · chuyen tai san nguoi sang nguoi khac · ai dang giu tai san · nut cap phat",
  "body": "**Khi nào:** giao tài sản cho nhân viên, nhận lại, hoặc chuyển từ người này sang người khác.\n**Các bước:**\n1. **Tài sản** → **Cấp phát / Thu hồi**.\n2. Cấp phát: tab **Cấp phát / Thu hồi**, cột **Tài sản sẵn sàng** → **Cấp phát** → chọn **Giao cho**, ghi chú → **Xác nhận cấp phát**.\n3. Thu hồi: cột **Đang sử dụng** → **Thu hồi** → ghi **Lý do thu hồi** → **Xác nhận thu hồi**.\n4. Chuyển thẳng người khác: tab **Luân chuyển** → chọn tài sản → **Chuyển cho** → **Xác nhận luân chuyển**.\n5. Xem lại các lần giao / nhận: tab **Lịch sử**.\n**Không làm được?**\n- Không có nút **Cấp phát** / **Thu hồi** → thiếu quyền tương ứng của \"Cấp phát tài sản\" → nhờ Admin.\n- Tài sản không nằm ở **Tài sản sẵn sàng** → đang có người dùng, đang bảo trì hoặc không còn dùng → thu hồi hoặc hoàn tất bảo trì trước.\n**Lưu ý:**\n- Ai đang giữ tài sản: mở tài sản ở **Danh mục tài sản**, xem **Người dùng hiện tại**.",
  "source": "docs"
 },
 {
  "id": "so-tay-tai-san-kiem-ke",
  "title": "Kiểm kê tài sản",
  "module": "Tài sản",
  "routes": [
   {
    "route": "/ts/audit",
    "label": "Kiểm kê TS"
   }
  ],
  "permission": "Kiểm kê tài sản · Kiểm kê",
  "keywords": "kiem ke tai san doi soat tai san thuc te tot hu hong mat sai vi tri phien kiem ke hoan tat xuat excel kiem ke lich su kiem ke ts kiem ke tai san",
  "questions": "kiem ke tai san · kiem ke ts · danh dau tai san mat · tai san sai vi tri ghi · xuat excel ket qua kiem ke · tab kiem ke · phien kiem ke cu",
  "body": "**Khi nào:** đối chiếu tình trạng tài sản thực tế với hệ thống (định kỳ, bàn giao, cuối năm).\n**Các bước:**\n1. **Tài sản** → **Kiểm kê TS** → tab **Kiểm kê**.\n2. Tìm tài sản theo tên / mã hoặc lọc theo loại.\n3. Từng tài sản bấm tình trạng thực tế: **Tốt**, **Hư hỏng**, **Mất**, **Sai vị trí** (bấm lại để bỏ chọn); **Sai vị trí** thì ghi vị trí thực tế; thêm ghi chú nếu cần.\n4. Bấm **Hoàn tất** để lưu phiên kiểm kê.\n5. Xem lại hoặc **Xuất Excel** ở tab **Lịch sử**.\n**Không làm được?**\n- Chỉ thấy tab **Lịch sử** → thiếu quyền \"Kiểm kê tài sản · Kiểm kê\" → nhờ Admin cấp (Cài đặt → Người dùng → Sửa → Tài sản).\n- **Hoàn tất** mờ → chưa bấm tình trạng cho tài sản nào.\n- Báo \"Chưa lưu được phiên kiểm kê\" → dữ liệu vẫn trên màn, bấm **Hoàn tất** lại.\n**Lưu ý:**\n- Chỉ tài sản đã bấm tình trạng mới vào phiên kiểm kê.",
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
  "keywords": "tim kiem global search o tim tim ho so mo nhanh phim tat ctrl k tim ma phieu tim don hang tim nguoi tim nhan vien tim vat tu so dien thoai khong dau viet tat tim gan day tim nhanh ho so, man hinh, thao tac",
  "questions": "tim phieu cu · tim po-646 · go ten vat tu tim ra · phim tat tim kiem · tim nhan vien theo so dien thoai · tim thay phieu nguoi khac · tim dien thoai",
  "body": "**Khi nào:** muốn mở nhanh một hồ sơ, màn hình hay thao tác mà không cần dò menu.\n**Các bước:**\n1. Bấm ô **Tìm kiếm…** ở đầu thanh bên (điện thoại: biểu tượng kính lúp ở đầu màn), hoặc phím Ctrl K (Mac: ⌘K).\n2. Gõ mã phiếu (PO-646, VT0000116), tên vật tư, tên / số điện thoại nhân viên, tên màn (\"tồn kho\") hay việc muốn làm (\"xin nghỉ phép\"). Không dấu, viết tắt (po, ncc, pnk) cũng hiểu.\n3. Lọc bằng chip nhóm (Thao tác nhanh, Chức năng, Dự án, Nhân sự, Vật tư & kho…) hoặc phím Tab.\n4. Chọn kết quả: hồ sơ mở đúng màn; thao tác mở form (việc cần dự án sẽ hỏi **Chọn dự án**).\n5. Không thấy: bấm **Hỏi Trợ lý AI** ở cuối (chỉ hiện khi bạn dùng được Trợ lý).\n**Không làm được?**\n- \"Không thấy kết quả\" → gõ ít chữ hơn hoặc gõ đúng mã phiếu; hồ sơ ngoài quyền xem không hiện.\n- \"Chưa tìm được trong hồ sơ (mất mạng hoặc máy chủ bận)\" → bấm **Thử lại**; chức năng, thao tác vẫn tìm được.\n- Không thấy màn quen dùng → chưa có quyền vào màn đó → nhờ Admin cấp.\n**Lưu ý:**\n- Ô trống hiện **Tìm gần đây**; bấm **Xóa** để dọn.",
  "source": "docs"
 },
 {
  "id": "so-tay-tro-ly-ai",
  "title": "Dùng Trợ lý AI",
  "module": "Chung",
  "routes": [
   {
    "route": "/center?view=assistant",
    "label": "Trợ lý"
   }
  ],
  "permission": "Người được Quản trị AI cấp (và được bật Trung tâm điều hành)",
  "keywords": "tro ly ai hoi tro ly chat ai bieu do bao cao thong ke tim ho so dinh kem anh pdf excel tri nho lich su hoi thoai hoi thoai moi chon model chua dung tom tat ban tin the nhap dung tro ly ai",
  "questions": "tro ly ai dung · ai so ton kho · gui bao gia tro ly · tro ly ai dau · tro ly tra loi sai bao · hoi thoai cu tro ly · tro ly tu gui phieu",
  "body": "**Khi nào:** hỏi số liệu, tìm hồ sơ, vẽ biểu đồ, chuẩn bị phiếu nháp, hỏi cách dùng / vì sao lỗi.\n**Các bước:**\n1. Mở **Trung tâm điều hành** → tab **Trợ lý** (điện thoại: nút **Trợ lý** ở thanh dưới), hoặc ô Tìm kiếm → **Hỏi Trợ lý AI**.\n2. Hỏi bằng câu thường: \"tồn thép D16 kho SMB\", \"thống kê phiếu quy trình quý 3\", \"còn bao nhiêu ngày phép\". Gõ mã hồ sơ (PO-646, DA29) là mở ngay, không hỏi AI.\n3. Đính kèm bằng nút kẹp giấy (hoặc kéo thả, dán ảnh), tối đa 4 ảnh + 3 tệp Excel / PDF: báo giá → thẻ đơn mua; phiếu viết tay → đề xuất; ảnh lỗi → phiếu sự cố.\n4. Thẻ nháp chỉ gửi khi bạn bấm nút trên thẻ. Trả lời sai: bấm 👎 (**Chưa đúng**) rồi chọn lý do.\n5. **Lịch sử** xem hội thoại cũ (giữ 90 ngày); **Hội thoại mới** để bắt đầu lại; **Trí nhớ** xem / quên điều Trợ lý đã nhớ.\n**Không làm được?**\n- Ô hỏi khóa \"Trợ lý AI chưa được cấp…\" / báo hết lượt → nhờ Quản trị AI cấp hoặc nâng trần.\n- Trả lời \"ngoài phạm vi được xem\" → bạn không có quyền xem dữ liệu đó.\n- Tệp bị từ chối (\"ảnh quá lớn\", \"Tối đa 4 ảnh mỗi lần\") → bớt tệp, gửi ở câu sau.\n**Lưu ý:**\n- Trợ lý chỉ thấy dữ liệu bạn được xem; tệp không lưu lại, câu sau cần thì đính lại.",
  "source": "docs"
 },
 {
  "id": "so-tay-van-ban",
  "title": "Soạn và gửi duyệt văn bản đi, nội bộ, thông báo",
  "module": "Văn bản",
  "routes": [
   {
    "route": "/office/new",
    "label": "Tạo văn bản"
   },
   {
    "route": "/office/documents",
    "label": "Văn bản"
   }
  ],
  "permission": "Văn bản · Soạn / tiếp nhận văn bản",
  "keywords": "soan van ban cong van van ban di van ban noi bo thong bao quyet dinh quy dinh to trinh trinh ky gui duyet tuyen duyet mau van ban vioo office nguoi nhan toan cong ty soan va gui duyet van ban di, noi bo, thong bao",
  "questions": "soan cong van · tao van ban gui duyet · soan thong bao toan cong ty · dung mau van ban san · thay nut tao van ban · van ban tra sua · tuyen duyet chon",
  "body": "**Khi nào:** ban hành công văn gửi đối tác, quyết định / quy định nội bộ, thông báo.\n**Các bước:**\n1. **Vioo Office** → **Tạo văn bản** (hoặc ở **Tổng quan** chọn **Văn bản đi** / **Văn bản nội bộ** / **Thông báo**).\n2. Gõ **Tiêu đề văn bản**, chọn **Loại văn bản**, **Nghiệp vụ**, **Kho lưu trữ**, **Ngày văn bản**.\n3. Chọn **Người nhận** (người, phòng ban, dự án… hoặc **Thêm toàn công ty**); văn bản đi ghi **Đơn vị / đối tác nhận văn bản**; chọn **Tuyến duyệt** nếu loại văn bản cần duyệt.\n4. Soạn **Nội dung** (bấm **Chọn mẫu văn bản** để dùng mẫu), đính kèm tệp; mở **Thông tin thêm** để chọn người ký, mức khẩn, bảo mật.\n5. Bấm **Lưu & gửi duyệt** (chưa xong thì **Lưu nháp**).\n**Không làm được?**\n- Không thấy **Tạo văn bản** → thiếu quyền \"Văn bản · Soạn / tiếp nhận văn bản\".\n- \"Chưa có tuyến duyệt phù hợp\" → **Lưu nháp**, nhờ người quản trị Office cấu hình tuyến duyệt.\n- Văn bản bị **Trả lại** → mở văn bản → **Chỉnh sửa** → **Lưu & gửi duyệt** lại.\n**Lưu ý:**\n- Duyệt xong, Văn thư **Cấp số văn bản** rồi **Phát hành văn bản** thì người nhận mới thấy.\n- Gửi nhầm khi đang chờ duyệt: **Thao tác khác** → **Hủy văn bản**.",
  "source": "docs"
 },
 {
  "id": "so-tay-van-ban-den-tiep-nhan",
  "title": "Tiếp nhận văn bản đến và giao xử lý",
  "module": "Văn bản",
  "routes": [
   {
    "route": "/office/new?group=INCOMING",
    "label": "Tiếp nhận văn bản đến"
   },
   {
    "route": "/office/documents?group=INCOMING",
    "label": "Văn bản đến"
   }
  ],
  "permission": "Văn bản · Soạn / tiếp nhận văn bản; Văn bản · Giao xử lý văn bản đến",
  "keywords": "van ban den tiep nhan cong van den vao so van ban den dang ky tiep nhan phan phoi giao xu ly han xu ly nguoi phu trach phoi hop van thu doc anh pdf ai xuat excel so van ban den tiep nhan van ban den va giao xu ly",
  "questions": "nhan cong van nhap · vao so van ban · giao xu ly van ban ai · dat han xu ly cong van · ai doc cong van · xuat so van ban ra excel · nut giao xu ly",
  "body": "**Khi nào:** Văn thư nhận công văn giấy / email từ bên ngoài.\n**Các bước:**\n1. **Vioo Office** → **Tổng quan** → **Văn bản đến** (hoặc **Tạo văn bản**, **Nghiệp vụ** = Văn bản đến).\n2. Đính kèm bản scan hoặc **Chụp bản giấy**; có AI thì bấm **Đọc từ ảnh / PDF (AI)** để điền sẵn, rồi kiểm lại.\n3. Điền **Đơn vị gửi**, **Số văn bản bên gửi**, **Ngày nhận**, **Người nhận** → **Lưu & đăng ký tiếp nhận**.\n4. Mở văn bản → **Phân phối văn bản** để gửi tới người nhận.\n5. Khung **Xử lý văn bản đến** → **Giao xử lý**: chọn **Người phụ trách**, **Hạn xử lý**, **Yêu cầu xử lý**, thêm **Người phối hợp**.\n**Không làm được?**\n- Không có nút **Giao xử lý** → văn bản chưa phân phối, hoặc thiếu quyền \"Văn bản · Giao xử lý văn bản đến\".\n- AI đọc sai / không đọc được → nhập tay các ô.\n- Giao nhầm người → bấm **Giao lại**.\n**Lưu ý:**\n- Văn bản quá hạn chưa có kết quả nằm ở mục **Quá hạn xử lý**.\n- Ra sổ văn bản đến: **Văn bản** → nhóm **Văn bản đến** → **Xuất Excel**.",
  "source": "docs"
 },
 {
  "id": "so-tay-van-ban-duyet-cap-so-phat-hanh",
  "title": "Duyệt, cấp số và phát hành văn bản",
  "module": "Văn bản",
  "routes": [
   {
    "route": "/office/documents?view=approval",
    "label": "Chờ tôi duyệt"
   },
   {
    "route": "/office/documents?view=numbering",
    "label": "Chờ cấp số"
   }
  ],
  "permission": "Văn bản · Duyệt nội dung; Văn bản · Cấp số văn bản; Văn bản · Phát hành / phân phối",
  "keywords": "duyet van ban duyet noi dung cap so van ban phat hanh van thu so cong van tra lai van ban tu choi thu hoi van ban luu tru gui bo sung nguoi nhan cho cap so cho toi duyet duyet, cap so va phat hanh van ban",
  "questions": "duyet van ban · van thu cap so van ban · phat hanh cong van · van ban chua nguoi nhan · thu hoi van ban da phat hanh · tra van ban nguoi soan · gui them nguoi nhan sau khi phat hanh",
  "body": "**Khi nào:** văn bản chờ bạn duyệt, hoặc bạn là Văn thư cấp số / phát hành.\n**Các bước:**\n1. **Vioo Office** → **Văn bản** → mục **Chờ tôi duyệt** (người duyệt) hoặc **Chờ cấp số** (Văn thư).\n2. Mở văn bản, đọc nội dung, tệp đính kèm.\n3. Người duyệt: **Duyệt nội dung**, hoặc **Trả lại** (ghi lý do); bỏ hẳn thì **Thao tác khác** → **Từ chối văn bản**.\n4. Văn thư: **Cấp số văn bản** (cấp số người soạn đã chọn; để trống thì lấy số tiếp theo trong sổ).\n5. Bấm **Phát hành văn bản**: chốt người nhận, khóa nội dung, người nhận được thông báo.\n**Không làm được?**\n- Không thấy nút **Cấp số văn bản** / **Phát hành văn bản** → thiếu quyền tương ứng, hoặc văn bản chưa tới bước đó.\n- Văn bản chờ duyệt mà không có nút **Duyệt nội dung** → chưa tới lượt bạn trong tuyến duyệt.\n**Lưu ý:**\n- Số đã cấp giữ vĩnh viễn. Phát hành sai: **Thao tác khác** → **Thu hồi văn bản** (người nhận được báo).\n- Thêm người nhận sau khi phát hành: **Gửi bổ sung / tag bộ phận**.",
  "source": "docs"
 },
 {
  "id": "so-tay-van-ban-xu-ly-duoc-giao",
  "title": "Xử lý văn bản được giao, xác nhận đã đọc",
  "module": "Văn bản",
  "routes": [
   {
    "route": "/office/documents?view=assigned",
    "label": "Được giao xử lý"
   },
   {
    "route": "/office/documents?view=unread",
    "label": "Chưa đọc"
   }
  ],
  "permission": "Văn bản · Xử lý văn bản được giao",
  "keywords": "xu ly van ban den duoc giao cong van giao cho toi xac nhan tiep nhan bat dau xu ly hoan thanh xu ly ket qua xu ly qua han xu ly xac nhan da doc thong bao chua doc xu ly van ban duoc giao, xac nhan da doc",
  "questions": "van ban giao xu ly · bao ket qua xu ly cong van · xac nhan da doc thong bao · van ban qua han xu ly · bam hoan thanh xu ly · cong van chua doc",
  "body": "**Khi nào:** bạn được giao xử lý công văn đến, hoặc nhận thông báo cần xác nhận đã đọc.\n**Các bước:**\n1. **Vioo Office** → **Văn bản** → mục **Được giao xử lý** (hoặc **Quá hạn xử lý**, **Chưa đọc**).\n2. Mở văn bản, xem **Yêu cầu xử lý** và **Hạn xử lý** ở khung **Xử lý văn bản đến**.\n3. Bấm **Xác nhận tiếp nhận** → **Bắt đầu xử lý**.\n4. Xong việc: **Hoàn thành xử lý**, ghi **Kết quả xử lý** (bắt buộc).\n5. Thông báo có yêu cầu xác nhận: bấm **Tôi đã đọc và hiểu nội dung**.\n**Không làm được?**\n- Không thấy các nút xử lý → chỉ **Người phụ trách** bấm được; người phối hợp / người nhận chỉ xem.\n- Giao nhầm người → nhờ người giao bấm **Giao lại**.\n**Lưu ý:**\n- Mở văn bản chỉ ghi nhận đã xem; muốn xác nhận đã đọc phải bấm nút xác nhận.\n- Văn bản có hạn mà chưa ghi kết quả sẽ tính quá hạn xử lý.",
  "source": "docs"
 },
 {
  "id": "so-tay-vpp",
  "title": "Đề xuất văn phòng phẩm (VPP)",
  "module": "Văn phòng phẩm",
  "routes": [
   {
    "route": "/vpp",
    "label": "Văn phòng phẩm"
   }
  ],
  "permission": "Mọi nhân viên",
  "keywords": "van phong pham vpp de xuat xin vpp giay a4 but bi ghim kep muc in so tay kho vpp het hang mon chua co ma sua de xuat huy de xuat vpp nguoi duyet phong de xuat van phong pham (vpp)",
  "questions": "van phong pham · de xuat vpp · de xuat giay a4 but · mon danh sach vpp · sua huy de xuat vpp · vpp ai duyet · de xuat vpp da cap chua",
  "body": "**Khi nào:** cần giấy, bút, ghim, mực in… từ Kho VPP.\n**Các bước:**\n1. Gõ \"VPP\" ở ô Tìm kiếm, hoặc mở **Văn phòng phẩm** → **Đề xuất VPP**.\n2. Gõ tên món (giấy A4, bút bi…) rồi chọn; món chưa có trong danh sách thì bấm **Thêm \"tên món\"** và chọn đơn vị.\n3. Nhập số lượng từng món; ghi chú dùng cho việc gì, cần trước ngày nào.\n4. Bấm **Gửi đề xuất** → người duyệt của phòng duyệt → thủ kho VPP cấp phát.\n5. Theo dõi ở tab **Của tôi**: **Chờ duyệt** → **Chờ cấp** → **Đã cấp**.\n**Không làm được?**\n- Nút **Đề xuất VPP** mờ → chưa thiết lập kho VPP → báo Hành chính.\n- Form ghi **Chưa có người duyệt** → Quản trị VPP sẽ duyệt thay; báo HCNS đặt người duyệt cho phòng.\n- Phiếu ở trạng thái **Cần sửa** (bị trả lại) → mở phiếu → **Sửa** → **Gửi lại**.\n- Báo \"Phiếu đã được duyệt, không sửa được nữa.\" → chỉ sửa được trước khi duyệt.\n**Lưu ý:**\n- Chưa cấp thì tự **Hủy phiếu** được (ghi lý do). Món ghi **Hết hàng** vẫn đề xuất được, chờ nhập thêm.\n- Một phiếu tối đa 60 món.",
  "source": "docs"
 },
 {
  "id": "so-tay-vpp-duyet-cap-phat",
  "title": "Duyệt, cấp phát và nhập kho văn phòng phẩm",
  "module": "Văn phòng phẩm",
  "routes": [
   {
    "route": "/vpp",
    "label": "Văn phòng phẩm"
   }
  ],
  "permission": "Người duyệt của phòng; thủ kho kho VPP; Văn phòng phẩm · Quản trị VPP",
  "keywords": "duyet vpp cap phat vpp thu kho vpp nhap kho vpp mua ve hoa don vpp duyet vuot nguong duyet thay nguoi duyet theo phong dong phan con lai nhan tra lai kho gan ma vpp duyet, cap phat va nhap kho van phong pham",
  "questions": "duyet de xuat vpp · thu kho cap phat vpp · nhap vpp mua ve · cap vi kho du · dat nguoi duyet vpp phong · duyet vuot nguong vpp · mon chua ma cap",
  "body": "**Khi nào:** bạn duyệt VPP cho phòng, hoặc là thủ kho VPP cấp phát / nhập hàng.\n**Các bước:**\n1. Người duyệt: **Văn phòng phẩm** → tab **Chờ duyệt** → mở phiếu, sửa số duyệt từng món nếu cần → **Duyệt** (hoặc **Trả lại để sửa** / **Từ chối**, ghi lý do).\n2. Thủ kho: tab **Cấp phát** → phiếu **Chờ cấp** → nhập số cấp lần này; món chưa có mã thì chọn mã VPP → **Cấp phát** → xác nhận.\n3. Hết hàng: cấp phần đang có; phần còn lại chờ nhập thêm hoặc **Đóng phần còn lại**.\n4. Mua về: **Nhập kho** → ngày chứng từ, nơi mua, số hóa đơn, món, số lượng, đơn giá, **Chụp / chọn ảnh** hóa đơn → **Nhập kho**.\n**Không làm được?**\n- Báo \"Kho không đủ hàng để cấp\" → nhập kho trước hoặc cấp bớt.\n- Báo \"Món chưa có mã: chọn mã VPP trước khi cấp.\" → chọn mã ở dòng món.\n- Báo \"Bạn không phải người duyệt phiếu này.\" → phiếu thuộc phòng khác / người duyệt khác.\n- Phiếu ghi **Vượt ngưỡng** → cần thêm người duyệt vượt ngưỡng.\n**Lưu ý:**\n- Quản trị VPP đặt **Người duyệt theo phòng**, người duyệt vượt ngưỡng, người duyệt thay ở tab **Thiết lập**.\n- Cấp nhầm: **Nhận trả lại** → nhập số → **Nhập lại kho**.",
  "source": "docs"
 },
 {
  "id": "so-tay-xuat-kho-chuyen-kho",
  "title": "Lập phiếu xuất kho cho tổ đội, thầu phụ",
  "module": "Kho",
  "routes": [
   {
    "route": "/inventory",
    "label": "Kho"
   }
  ],
  "permission": "Giao dịch kho · Thủ kho (kho xuất)",
  "keywords": "xuat kho phieu xuat pxk xuat cap cap phat vat tu cho to doi thau phu xuat thi cong nguoi nhan xuat vat tu cong truong lap phieu xuat kho cho to doi, thau phu",
  "questions": "xuat kho to doi · lap phieu xuat kho · cap vat tu thau phu · tim thay to doi nguoi nhan · xuat bao vuot ton · xuat kho cong truong · thay nut xuat cap",
  "body": "**Khi nào:** giao vật tư từ kho cho tổ đội / thầu phụ thi công.\n**Các bước:**\n1. Kho → **Xuất cấp** (hoặc **Tồn kho** → bấm vật tư → **Xuất**).\n2. Chọn **Kho xuất** (nếu giữ nhiều kho); ô **Người nhận** gõ tên tổ đội / thầu phụ / số HĐ rồi chọn.\n3. Ô **Thêm vật tư — gõ tên / mã** (chỉ hiện mã còn tồn), chọn quy cách, nhập SL.\n4. Chọn **Ngày chứng từ** (không sau hôm nay), ghi chú hạng mục / tổ → **Xuất kho**.\n5. Phiếu ghi sổ ngay, tồn trừ ngay; mở phiếu bấm **In phiếu** cho người nhận ký.\n**Không làm được?**\n- Không thấy nút **Xuất cấp** → bạn chưa là thủ kho kho nào (chỉ xem) → nhờ Admin ở Phân quyền kho.\n- Dòng đỏ \"vượt tồn\", nút **Xuất kho** mờ → giảm SL; hoặc còn thiếu người nhận / vật tư.\n- Ô người nhận báo \"Không có trong danh sách\" → nhờ Mua hàng thêm đối tác (tổ đội, thầu phụ).\n- Báo \"Chỉ thủ kho của kho xuất (hoặc Admin) được xuất\" → đúng người giữ kho mới xuất.\n**Lưu ý:**\n- Xuất nhầm hoặc tổ đội trả thừa: xem mục \"Tổ đội trả lại vật tư thừa\". Đưa sang kho khác: mục \"Chuyển kho\".",
  "source": "docs"
 },
 {
  "id": "so-tay-yeu-cau-duyet-tra-lai",
  "title": "Duyệt, trả lại, chuyển người duyệt đề xuất",
  "module": "Yêu cầu",
  "routes": [
   {
    "route": "/rq",
    "label": "Phiếu yêu cầu"
   }
  ],
  "permission": "Phiếu yêu cầu · Duyệt yêu cầu được giao",
  "keywords": "duyet de xuat chap thuan phieu yeu cau rq tra lai tu choi chuyen nguoi duyet duyet thay di vang gui den toi cho duyet in de xuat duyet, tra lai, chuyen nguoi duyet de xuat",
  "questions": "duyet de xuat · chap thuan de xuat · tra de xuat nguoi gui · chuyen de xuat nguoi khac duyet · di vang ai duyet thay de xuat · thay nut chap thuan · bao loi con luot duyet",
  "body": "**Khi nào:** có đề xuất gửi tới bạn duyệt.\n**Các bước:**\n1. **Yêu cầu** → **Phiếu yêu cầu** → mục **Gửi đến tôi**, lọc **Chờ duyệt**; bấm đề xuất để mở.\n2. Đọc nội dung, tệp đính kèm, luồng duyệt.\n3. Chọn **Chấp thuận**, **Trả lại** (người gửi sửa rồi gửi lại) hoặc **Từ chối** (kết thúc đề xuất).\n4. Không đúng người / đi vắng: **Chuyển người duyệt** → chọn **Người duyệt mới**.\n5. Ghi **Ý kiến / Lý do** (bắt buộc khi Trả lại, Từ chối, Chuyển) → bấm nút xác nhận.\n**Không làm được?**\n- Không thấy nút xử lý → chưa tới lượt bạn (luồng lần lượt) hoặc bạn đã xử lý rồi.\n- Báo \"Bạn không còn lượt duyệt đang chờ ở đề xuất này\" → lượt đã được xử lý hoặc đã chuyển → tải lại.\n- Báo \"Đề xuất vừa được người khác cập nhật…\" → tải lại rồi làm tiếp.\n- Báo \"Vui lòng nhập lý do cho hành động này.\" → ghi lý do.\n**Lưu ý:**\n- Nút **In** để in đề xuất khổ A4 (nếu mẫu cho in).\n- Hỏi Trợ lý \"việc chờ tôi xử lý\" để xem nhanh đề xuất đang chờ bạn.",
  "source": "docs"
 },
 {
  "id": "so-tay-yeu-cau-sua-gui-lai-huy",
  "title": "Sửa, gửi lại, hủy hoặc xóa đề xuất",
  "module": "Yêu cầu",
  "routes": [
   {
    "route": "/rq",
    "label": "Phiếu yêu cầu"
   }
  ],
  "permission": "Phiếu yêu cầu · Sửa nội dung yêu cầu của mình; Phiếu yêu cầu · Hủy yêu cầu",
  "keywords": "sua de xuat phieu yeu cau rq bi tra lai gui lai huy de xuat xoa de xuat gui nham luu va duyet lai toi gui di sua, gui lai, huy hoac xoa de xuat",
  "questions": "sua de xuat da gui · de xuat tra lai sua · gui de xuat · huy de xuat · xoa de xuat gui nham · xoa de xuat · nut sua hien",
  "body": "**Khi nào:** đề xuất bạn gửi cần sửa, bị **Trả lại**, hoặc gửi nhầm.\n**Các bước:**\n1. **Yêu cầu** → **Phiếu yêu cầu** → **Tôi gửi đi** → mở đề xuất (lọc **Trả lại** để thấy phiếu bị trả).\n2. Sửa: bấm **Sửa** → chỉnh **Tên đề xuất**, nội dung → **Lưu thay đổi**. Đề xuất đang chờ duyệt thì nút là **Lưu và duyệt lại**: lượt duyệt chạy lại từ đầu.\n3. Bị trả lại: sửa xong bấm **Gửi lại**.\n4. Không cần nữa: **Hủy đề xuất**.\n5. Xóa hẳn: **Xóa** → **Xóa đề xuất**.\n**Không làm được?**\n- Không có nút **Sửa** → đề xuất đã kết thúc (Hoàn thành / Từ chối / Đã hủy) hoặc bạn không phải người gửi.\n- Không có nút **Xóa** → đã có người xử lý → chỉ **Hủy đề xuất**; hủy xong mới xóa được.\n- Báo \"Phiếu đã có đơn mua liên quan…\" → xử lý các đơn mua đó trước.\n- Báo \"Đề xuất đã kết thúc nên không thể chỉnh sửa nội dung.\" → tạo đề xuất mới.\n**Lưu ý:**\n- Xóa không hoàn tác; đề xuất bị ẩn khỏi mọi danh sách.",
  "source": "docs"
 },
 {
  "id": "so-tay-yeu-cau-tao-de-xuat",
  "title": "Tạo đề xuất (phiếu Yêu cầu)",
  "module": "Yêu cầu",
  "routes": [
   {
    "route": "/rq",
    "label": "Phiếu yêu cầu"
   }
  ],
  "permission": "Phiếu yêu cầu · Tạo",
  "keywords": "tao de xuat phieu yeu cau rq xin duyet to trinh de xuat cap phat bao ho lao dong thiet bi van phong tuyen dung bao hiem xa hoi dieu dong cong truong luong duyet nguoi duyet khac quy trinh tao de xuat (phieu yeu cau)",
  "questions": "tao de xuat · gui de xuat duyet · phieu yeu cau khac phieu quy trinh · de xuat cap bao ho lao dong · bao chua thiet lap nguoi quan ly truc tiep · chon nguoi duyet · de xuat gui ai duyet",
  "body": "**Khi nào:** xin duyệt theo mẫu có sẵn, VD cấp phát bảo hộ lao động, thiết bị văn phòng, tuyển dụng, điều động công trường.\n**Các bước:**\n1. Gõ \"tạo đề xuất\" ở ô Tìm kiếm (form mở ngay), hoặc **Yêu cầu** → **Phiếu yêu cầu** → **Tạo đề xuất**.\n2. Chọn **Mẫu đề xuất**, gõ **Tiêu đề**, **Nội dung & Lý do đề xuất**, điền **Thông tin đề xuất**.\n3. Phần **Luồng duyệt**: bước có dấu * thì gõ tên để chọn người duyệt; bước khác tự động (quản lý trực tiếp hoặc người cố định theo mẫu).\n4. Thêm **Người theo dõi**, **Tệp đính kèm** nếu cần → **Gửi đề xuất**.\n5. Theo dõi ở mục **Tôi gửi đi**.\n**Không làm được?**\n- Báo \"Tài khoản của bạn chưa được thiết lập người quản lý trực tiếp\" → nhờ HR / Admin đặt quản lý trực tiếp.\n- Báo \"Bạn không thuộc phạm vi được dùng mẫu này\" → mẫu chỉ mở cho một số phòng / người.\n- Báo \"Bạn không thể chọn chính mình làm người duyệt\" → chọn người khác.\n**Lưu ý:**\n- Khác Quy trình: đề xuất đi theo luồng duyệt cố định của mẫu, người duyệt chỉ Chấp thuận / Trả lại / Từ chối; Quy trình là phiếu nhiều giai đoạn, mỗi bước người xử lý chọn người làm bước sau.\n- Ảnh tối đa 5 MB; PDF, Word, Excel tối đa 25 MB.",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
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
  "questions": "",
  "body": "**Tạo phiếu quy trình** — Trình ký theo quy trình.\n**Cách mở:** gõ \"tạo phiếu quy trình\" vào ô Tìm kiếm rồi chọn thao tác, hoặc mở màn /wf.",
  "source": "catalog"
 }
];
