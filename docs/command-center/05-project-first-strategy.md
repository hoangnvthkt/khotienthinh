# Hướng triển khai lấy dự án và công trường làm trung tâm

Ngày 29/09/2026. Ưu tiên do chủ sản phẩm xác định: phục vụ công tác công trường/dự án trước, bao gồm quyết định, thông báo điều động và đề xuất nhân sự. Thứ tự gói bên dưới là đề xuất triển khai, chưa phải cam kết tiến độ hoặc thiết kế DB đã duyệt.

Tài liệu này cập nhật thứ tự ưu tiên trong audit ban đầu: không lấy tài sản hoặc nghỉ phép độc lập làm luồng thứ hai chỉ để chứng minh tính tổng quát. Giữ mục tiêu toàn ứng dụng; các phòng ban và nghiệp vụ công ty được tích hợp theo cách phục vụ dự án trước.

## 1. Kết quả người dùng cần nhận được

Một chỉ huy trưởng vào Vioo phải trả lời được: hôm nay cần làm gì; đang thiếu nguồn lực nào; hồ sơ nào đang chờ ai; có quyết định nào cần thực hiện; thực tế thi công đang lệch kế hoạch ở đâu. Người ở văn phòng phải thấy yêu cầu từ các dự án và xử lý theo trách nhiệm/phạm vi của mình. Ban lãnh đạo cần so sánh dự án, phân bổ nguồn lực và tháo gỡ điểm nghẽn.

Thiết kế từ các chuỗi công việc liên phòng ban. Mỗi gói phải đi đến một kết quả thực tế, có hồ sơ nguồn, người chịu trách nhiệm và trạng thái kiểm chứng được. Số menu, form hoặc tool AI được thêm không phải thước đo hoàn thành.

## 2. Ba góc nhìn trong cùng hệ thống

| Góc nhìn | Người sử dụng | Nội dung ưu tiên |
|---|---|---|
| Việc của tôi | Mọi người | Việc được giao, phiếu cần duyệt, nháp, quyết định/thông báo liên quan từ các dự án được phép |
| Dự án / công trường | BCH, CHT, kỹ thuật, QS, kho, QC, an toàn | Kế hoạch, nguồn lực, nhu cầu, thực tế, hồ sơ và chỉ đạo tại phạm vi đã chọn |
| Điều hành nhiều dự án | Ban lãnh đạo, phòng dự án, HR, cung ứng, tài chính | Nhu cầu chờ xử lý, xung đột nguồn lực, điều chuyển và cam kết của các bộ phận với dự án |

Đây là các view theo công việc và quyền, không phải ba bộ dữ liệu. Một người có thể dùng nhiều view. Ưu tiên dự án không có nghĩa buộc mọi hồ sơ công ty vào một công trường giả.

Mỗi hồ sơ cần phân biệt phạm vi ảnh hưởng (dự án/công trường nào), đơn vị chủ trì xử lý, người chịu trách nhiệm, ngày cần/ngày hiệu lực và nguồn căn cứ. WBS/công tác, khu vực, kho hoặc ca là thông tin liên kết khi nghiệp vụ thực sự cần. Quyết định áp dụng nhiều dự án có một bản gốc và các liên kết phạm vi rõ ràng; không nhân bản văn bản thành nhiều quyết định khác nhau.

## 3. Các nhóm việc trên workspace dự án

- Hôm nay: việc cần làm/duyệt, hồ sơ đang tắc, thông báo mới và nháp đang soạn.
- Thi công: kế hoạch, tiến độ, nhật ký, khối lượng và vướng mắc.
- Nguồn lực: nhân sự, tổ đội, vật tư, thiết bị, phương tiện và nhu cầu còn thiếu.
- Quyết định và hồ sơ: đề xuất, chỉ đạo, văn bản ban hành, bản thay thế, người nhận và tiến độ thực hiện.
- Chất lượng, an toàn: kiểm tra, vấn đề tồn tại, yêu cầu khắc phục và evidence.
- Chi phí và hợp đồng: ngân sách, nghiệm thu, công nợ, thanh toán và cam kết.

Các nhóm trên là tổ chức trải nghiệm đề xuất, không đòi làm xong tất cả trước khi pilot. Chỉ hiển thị action đã tích hợp và phù hợp quyền. Chat hỗ trợ tạo/tìm/chuẩn bị tác vụ; menu và form là đường làm việc đầy đủ.

## 4. Ba chuỗi nghiệp vụ ưu tiên

### A. Nhu cầu nhân sự → phương án điều động → công trường tiếp nhận

Ví dụ minh họa: một dự án cần thêm hai kỹ sư từ ngày cụ thể. Người lập nhập vị trí/năng lực, số lượng, thời gian, công trường, mục đích và mức độ cấp thiết. Nếu đã biết người thì chọn hồ sơ đúng ID; nếu chưa biết, chỉ ghi nhu cầu theo vị trí, không bắt bịa tên.

Chuỗi mục tiêu: đề xuất → thẩm định/phê duyệt nhu cầu → HR/phòng dự án lập phương án → người có thẩm quyền duyệt và ban hành quyết định → thông báo đúng người/đơn vị → bàn giao/tiếp nhận theo quy định → cập nhật phân công có hiệu lực → theo dõi thực hiện. Người duyệt và số bước lấy từ workflow/policy được xác minh, không hard-code chuỗi này làm rule bắt buộc.

Cần phân biệt:

- Đã duyệt nhu cầu không đồng nghĩa đã có đủ người.
- Quyết định đã ban hành, ngày quyết định có hiệu lực và ngày người thực tế đến công trường là các mốc khác nhau.
- Đơn vị công tác chính trong HRM, phân công làm việc tại dự án và quyền truy cập ứng dụng là ba quan hệ khác nhau. Điều động không mặc định chuyển đơn vị chính hoặc cấp toàn bộ quyền.
- Điều động liên dự án phải kiểm tra cả nơi đi, nơi đến, thời gian chồng lấn và nguồn lực của nơi đi. Quyền xem dự án không tự cấp quyền xem lương/hồ sơ riêng tư.
- Nhân viên nội bộ, tổ đội/thầu phụ và lao động thời vụ có thể có cơ chế quản lý khác; không đồng nhất số lượng người trong nhu cầu với số user tài khoản.

### B. Nhu cầu thi công → vật tư/thiết bị sẵn sàng

Kế hoạch/công tác hoặc đề xuất hợp lệ → lượng còn cần và ngày cần → duyệt → cung ứng chọn nguồn kho/điều chuyển/mua → lịch cam kết → giao nhận/QC → cấp dùng → phản ánh phần còn thiếu về đúng công việc.

Ưu tiên cho CHT thấy “đã đề xuất / đã được bố trí / ngày cam kết / đã nhận / còn thiếu”, cùng người xử lý và hồ sơ nguồn. Reuse Project V2, BOQ, Procurement V2, WMS. Không tính nhu cầu bằng tổng đề xuất trừ tổng nhập nếu không có allocation đúng nguồn/đơn vị. Thiết bị cần lịch khả dụng và bàn giao riêng, không áp máy móc logic tiêu hao vật tư.

### C. Chỉ đạo/quyết định → giao thực hiện → kiểm tra hoàn thành

Văn bản được chuẩn bị/duyệt/ban hành theo loại → xác định phạm vi và người nhận → phát hành phiên bản cụ thể → xác nhận tiếp nhận nếu nghiệp vụ yêu cầu → tạo hoặc liên kết công việc có người chịu trách nhiệm và deadline → evidence thực hiện → người có quyền kiểm tra/đóng.

Hồ sơ, workflow, thông báo và task phải có liên kết cùng nguồn. Chat/email-like message chỉ là kênh trao đổi; nút “đã đọc” không có nghĩa đã thi hành quyết định. Quyết định bị thay thế/thu hồi phải giữ lịch sử và chỉ rõ ảnh hưởng đến việc đang mở; không xóa bản cũ hoặc tự đảo ngược thay đổi nghiệp vụ đã xảy ra.

## 5. Bằng chứng mới từ repository và phần còn thiếu

| Phần đã thấy trong source | Có thể tận dụng | Cần xác minh/bổ sung |
|---|---|---|
| `pages/project/ProjectOrgTab.tsx`, `types.ts:ProjectStaff`, `lib/projectStaffService.ts` | Nhân sự dự án/công trường, vị trí, ngày bắt đầu/kết thúc | Liên kết hồ sơ nhân viên và quyết định; quyền command; policy kiêm nhiệm/điều chuyển. UI hiện có kiểm role ADMIN nên không bê nguyên vào quy trình nghiệp vụ mới |
| `lib/hrmSharedCatalogService.ts:adjustStaffing/assignEmployeeToStaffing/unassignEmployeeFromOrganization` | Định biên, bố trí vị trí, ngày hiệu lực, sourceReference | Đây là bố trí cơ cấu tổ chức; chưa chứng minh đã là quy trình điều động dự án end-to-end |
| `HrmEmployeeAssignmentDialog.tsx:submit` | Form lựa chọn vị trí và ngày | UI hiện chặn ngày tương lai. Không dùng nguyên trạng cho quyết định điều động có hiệu lực tuần sau; cần audit backend/scheduling trước |
| `lib/hrmDocumentService.ts:HrmDocument`, `pages/hrm/HrmDocuments.tsx` | Hồ sơ nhân viên, công văn đến/đi, số văn bản, người ký/nhận, file | Contract đã đọc chưa có project/site refs, issue revision, confirmation của tập người nhận hay lifecycle điều động hoàn chỉnh. Lưu file/sửa nhãn trạng thái không thay thế ban hành quyết định |
| `lib/requestRuntimeService.ts`, `components/request/` | Đề xuất theo mẫu, workflow và assignment | Xác minh mẫu nhu cầu nhân sự; thêm liên kết scope chuẩn, không chỉ lưu tên dự án trong text form |
| `lib/work/workTypes.ts`, Work services | Task theo project, nhiều người nhận, acknowledgment, deadline, người kiểm tra | Liên kết task với quyết định/hồ sơ nguồn; không biến Work thành workflow phê duyệt thứ hai |

Các kết luận trên dựa trên đọc source, chưa phải test Cloud hay xác nhận không tồn tại chức năng tương đương ở nơi khác. Cần mở rộng inventory mới cho request nhân sự, phương án, ban hành, gửi/nhận, hiệu lực, tiếp nhận, kết thúc/thu hồi và đối chiếu phân công. Không nâng readiness từ sự có mặt của service.

## 6. Chia chặng để dùng được sớm

| Gói | Phạm vi | Kết quả bàn giao có thể kiểm chứng |
|---|---|---|
| P0 — Nền tảng vừa đủ cho pilot | Context dự án/công trường; actor/quyền; query/preview/execute/receipt; nháp; flags và đường UI trực tiếp | Một query và một command thật, có allow/deny/conflict/retry; không làm nền tảng chung vô hạn |
| P1 — Một ngày làm việc ở công trường | Việc của tôi và dự án; xem kế hoạch/nhật ký gần nhất; đề xuất theo scope; duyệt/trả lại; giao việc/vướng mắc; đọc hồ sơ/thông báo liên quan | CHT thấy việc cần xử lý; kỹ sư gửi đề xuất; phòng ban nhận đúng việc; mở được kết quả trong Center và UI cũ |
| P2 — Nguồn lực phục vụ thi công | Hai luồng ưu tiên: nhân sự/điều động/quyết định và vật tư/cung ứng/giao nhận | Đề xuất được theo dõi đến đáp ứng thực tế; biết ai xử lý, hạn và phần còn thiếu. Mỗi luồng bàn giao độc lập khi đủ gate |
| P3 — Điều hành thực hiện | Kế hoạch/Gantt/BOQ, nhập nhật ký và phê duyệt, tiến độ, QC/an toàn, chỉ đạo gắn công tác | So kế hoạch với thực tế; vấn đề có người xử lý/evidence; action chuyên ngành giữ invariant riêng |
| P4 — Chi phí và điều phối nhiều dự án | Tài chính/hợp đồng/nghiệm thu; nhân lực/thiết bị giữa dự án; dashboard có nguồn | Quyết định phân bổ và chi phí dựa dữ liệu thật trong quyền; không tạo KPI từ tổng sai semantics |
| P5 — Mở rộng còn lại | Tự phục vụ cá nhân, nghiệp vụ hành chính độc lập và các action chưa tích hợp | Hoàn thành phạm vi toàn ứng dụng theo inventory; không loại bỏ blocked/legacy để làm đẹp coverage |

Các chức năng QC/an toàn, tài chính hay HR hiện có vẫn tiếp tục sử dụng trong module gốc trước khi renderer được đưa vào Center. Phần cảnh báo/vướng mắc cần xử lý khẩn có thể hiển thị sớm tại P1 khi read/ACL đủ; không coi Work task chung là biên bản nghiệm thu chuyên ngành.

Phát hành pilot đầu ở một công trường có người dùng tham gia và dữ liệu kiểm thử xác định, sau đó kiểm chứng một tình huống liên hai dự án. Không lấy RICO làm cố định trong schema hoặc code. Sửa nền tảng đúng phạm vi các luồng sắp mở; domain chưa đủ gate vẫn có trạng thái rõ và tiếp tục module cũ.

## 7. Cách quản lý chương trình lớn

1. Giữ một roadmap sản phẩm và inventory chung. Tách work package theo hành trình người dùng, không phân công một gói khổng lồ “tích hợp HRM” hoặc “tích hợp Dự án”. Agent chính thực hiện tuần tự theo chỉ dẫn repo.
2. Trước mỗi gói: chốt 3–5 tình huống, actor/phạm vi, nguồn dữ liệu, hành động cuối và các ngoại lệ; viết thiết kế kỹ thuật/migration/test cụ thể chỉ cho gói đó.
3. Trong mỗi gói: source/backend guards → renderer/form → review/execute/receipt → kiểm đồng bộ với UI cũ → test Cloud và responsive → UAT. Không tích lũy nhiều form trống rồi nối backend sau.
4. Kết thúc gói: chạy một hồ sơ xuyên vai trò, bàn giao evidence, cập nhật inventory/known gaps, kiểm tắt flag/rollback rồi mới mở phạm vi.
5. Ưu tiên theo tần suất sử dụng, tác động thi công và điểm nghẽn; mức sẵn sàng backend quyết định công sức và gate, không tự thay thế ưu tiên nghiệp vụ của chủ sản phẩm.

Theo dõi giá trị: thời gian tìm đúng hồ sơ; thời gian đề xuất đến phản hồi/đáp ứng; số lần nhập lại; việc quá hạn/chưa có người xử lý; thiếu nguồn lực so ngày cần; người nhận chưa xác nhận; lỗi/duplicate/conflict và mức dùng UI trực tiếp khi AI không khả dụng. Chưa đặt chỉ tiêu số học khi chưa có baseline thực đo.

## 8. Các policy cần làm rõ khi đến luồng nhân sự/quyết định

Đơn vị nào được đề xuất/duyệt nhu cầu; ai lập phương án và ban hành; có cần nơi đi/nơi đến chấp thuận không; điều động tạm thời/kiêm nhiệm/chính thức khác nhau thế nào; mốc cập nhật phân công là ngày hiệu lực hay tiếp nhận; hệ thống hỗ trợ ký/phát hành ở mức nào; cách xử lý đổi ngày, thay thế/thu hồi, vắng mặt và điều động khẩn. Đây là các quyết định nghiệp vụ cần đặc tả cho gói P2, chưa tự coi là rule đã được phê duyệt.
