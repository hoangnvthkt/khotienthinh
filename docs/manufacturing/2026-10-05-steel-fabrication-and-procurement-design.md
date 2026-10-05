# Nhà máy kết cấu thép và dữ liệu liên thông mua sắm

Ngày nghiên cứu: 05/10/2026. Trạng thái: thiết kế đề xuất, chưa triển khai chức năng sản xuất hay tạo kho thật.

## Yêu cầu và quyết định đã có

Chủ sản phẩm đã đồng ý triển khai ba phần: (1) công tắc đầu ra Mua hàng trên từng mẫu Yêu cầu/Quy trình; (2) bảng nhu cầu chuẩn; (3) nhận và cấp phát tài sản. Bối cảnh bổ sung yêu cầu thiết kế nhà máy gia công theo bản vẽ: nhận nhu cầu từ công trình nội bộ, nhận đơn hàng khách ngoài, tự mua tấm về gia công hoặc giao bên ngoài gia công toàn bộ/một phần. Kho Nhà Máy kết cấu thép ban đầu chỉ admin quản lý. Không bắt người dùng xin mã SKU cho từng chi tiết phi tiêu chuẩn.

Mục tiêu người dùng: kỹ thuật nhập bảng bóc tách một lần; người mua thấy chính xác thứ cần mua/thuê và nơi nhận; nhà máy biết đơn hàng còn thiếu gì, đang làm gì; thủ kho phân biệt đúng tấm, chi tiết và bản vẽ; công trường/khách hàng nhận đúng đợt; quản lý truy được vật liệu, hao hụt, chi phí và tiến độ theo đơn hàng.

Các phương án đã cân nhắc:

- Chỉ thêm kho, dùng tên hàng tự do: nhanh nhưng không truy được chuyển hóa tấm thành chi tiết, tồn tại bên gia công, thay đổi bản vẽ, thép dư và chi phí theo đơn. Không chọn.
- Tạo SKU danh mục chung cho mọi chi tiết: tận dụng kho hiện có, nhưng tăng thao tác cấp mã và dễ gộp nhầm công trình/phiên bản. Không chọn làm giao diện nghiệp vụ.
- Chọn: hồ sơ đơn hàng gia công + bản vẽ/BOM theo phiên bản + tồn theo lô/vị trí/chủ sở hữu; dùng lại Mua hàng, sổ kho, tài sản và công trường. Các định danh kỹ thuật do hệ thống tạo, ký hiệu trên bản vẽ được giữ nguyên khi có.

## 1. Hai trục độc lập: nhu cầu và cách đáp ứng

Không dùng một trường “loại hàng” để quyết định tất cả:

| Trục | Giá trị |
|---|---|
| Đầu ra phục vụ ai | Công trình nội bộ / đơn hàng khách ngoài |
| Cách đáp ứng mỗi dòng/gói | Cấp từ tồn / mua sẵn / tự gia công / thuê gia công / kết hợp |
| Cách quản lý sau nhận | Vật tư tiêu hao / tài sản quản lý cấp phát / chi tiết theo bản vẽ / dịch vụ |
| Chủ vật liệu | Công ty / khách hàng cụ thể / bên khác theo thỏa thuận |
| Nơi đang giữ | Kho nhà máy / xưởng / đơn vị gia công / đang vận chuyển / điểm nhận |

Máy hàn, máy tính dùng cho doanh nghiệp đi vào quản lý tài sản. Dầm, cột, máng xối sản xuất để giao công trình/khách hàng là đầu ra của đơn gia công; không tự động biến thành tài sản cấp phát chỉ vì có giá trị lớn. Việc phân loại kế toán tài sản cố định/CCDC cần cấu hình riêng của doanh nghiệp; thiết kế này không tự quyết định theo tên hàng hoặc một ngưỡng giá suy đoán.

## 2. Trung tâm điều hành: Đơn hàng gia công

Một hồ sơ cho một công trình hoặc đơn khách hàng, có các gói và đợt giao:

- Nguồn yêu cầu/đơn khách hàng/hợp đồng, người phụ trách, công trình hoặc khách hàng, địa điểm giao, lịch giao.
- Bản vẽ và phiên bản được phép sản xuất; bảng bóc tách cấu kiện và nhu cầu nguyên liệu.
- Phương án tự làm/thuê ngoài theo từng gói hoặc công đoạn. Một đơn có thể 60 cấu kiện tự làm, 40 thuê ngoài.
- Liên kết đề xuất mua tấm, PO, cấp vật liệu, lệnh gia công, nghiệm thu, vận chuyển, nhận hàng và phần dư.
- Theo dõi riêng số lượng yêu cầu, đã duyệt, đã bố trí nguồn, đang làm, đạt QC, đã gửi, bên nhận xác nhận, còn thiếu. Không dùng một trạng thái duy nhất thay cho tất cả các số lượng.

Đơn của khách ngoài không buộc phải tạo dự án thi công giả. Công trình nội bộ tiếp tục dùng định danh dự án/công trường hiện có.

## 3. Định danh và cách người dùng nhìn hàng

### Nguyên liệu có quy cách chuẩn

Thép tấm/thép hình có thể dùng danh mục quy cách tái sử dụng: nhóm thép, mác thép, dày, rộng, dài, đơn vị. Khi nhận lưu thêm lô nhập, số mẻ luyện (heat number) nếu được cung cấp, chứng chỉ vật liệu và số cân thực tế. Không bịa heat number khi chưa có; cấu hình bắt buộc chứng chỉ theo công trình.

### Chi tiết/cấu kiện theo bản vẽ

Tên + đơn hàng/công trình + ký hiệu bản vẽ + phiên bản + thông số. Ví dụ: `Máng xối · Sơn MB · MX-01 · Rev B · dày 2 mm`.

Không bắt người dùng tạo SKU. Bên trong có ID bất biến cho chi tiết, phiên bản và lô. Ký hiệu chi tiết/assembly do kỹ thuật cung cấp là dấu nhận biết khi gia công và lắp dựng, khác với SKU danh mục toàn công ty. Nếu chưa có ký hiệu thì hệ thống tạo số dòng/nhãn nhận diện; không giả mạo ký hiệu kỹ thuật của bản vẽ.

Không gộp khác bản vẽ, phiên bản, chủ sở hữu hoặc đơn hàng bằng tên giống nhau. Gộp các lô tương đương để hiển thị tổng chỉ được phép khi vẫn drill-down được từng lô.

### Thép dư và phế liệu

- Thép dư tái sử dụng có ID mới, tham chiếu tấm cha/lần cắt, mác thép, độ dày, kích thước còn lại, ảnh hoặc file hình dạng, khối lượng và vị trí.
- Với mảnh không chữ nhật, kích thước bao ngoài không đủ để khẳng định cắt được chi tiết; đánh dấu cần kỹ thuật xác nhận.
- Phế liệu thu hồi được cân và lưu riêng; hao hụt quá trình được ghi riêng. Không coi toàn bộ phần chênh là hao hụt.
- Tấm lớn có thể cấp cho nhiều đơn hàng bằng một đợt cắt được phê duyệt, ghi phân bổ vật liệu cho từng đầu ra; không trừ cả tấm lặp lại cho từng đơn.

## 4. Luồng nghiệp vụ

### A. Tự gia công cho công trình nội bộ

Nhu cầu công trường → kỹ thuật bóc tách và duyệt bản vẽ/BOM → kiểm tra tồn, giữ vật liệu đủ điều kiện → đề xuất mua phần thiếu → nhận tấm thực tế → cấp vật liệu cho đợt gia công → ghi đầu ra/tiêu hao/dư/phế → QC → xuất theo đợt → công trường xác nhận nhận.

Nhu cầu thành phẩm (ví dụ 20 máng xối) khác nhu cầu mua nguyên liệu (số tấm theo phương án cắt). Không chuyển đồng thời cả hai thành đơn mua gây mua trùng. Luồng “tự gia công” sinh nhu cầu mua nguyên liệu thiếu từ BOM/phương án được duyệt.

### B. Gia công bán cho khách ngoài

Đơn khách hàng/hợp đồng → bản vẽ đã thống nhất → các bước sản xuất tương tự → QC → giao từng đợt cho khách → xác nhận giao nhận, bàn giao chứng chỉ. Không ghi là điều chuyển nội bộ. Liên kết báo cáo chi phí và hợp đồng; không tự phát hành hóa đơn từ sự kiện sản xuất.

### C. Thuê ngoài, công ty cấp thép

Đơn thuê gia công ghi chi tiết đầu ra, bản vẽ, phạm vi công việc, giá dịch vụ, hạn giao và trách nhiệm vật liệu dư/phế. Chuyển vật liệu tới vị trí theo dõi của nhà gia công; chủ sở hữu vẫn là công ty. Khi nhận đầu ra, đối soát vật liệu đã giao, thực tiêu hao, còn ở đơn vị gia công, phần trả về và phế liệu. Không tự tiêu hao toàn bộ vật liệu ngay khi xuất khỏi kho nhà máy.

Cho phép giao thẳng từ bên gia công tới công trường/khách hàng: ghi rõ nơi thực xuất và người thực nhận, QC và chứng từ vận chuyển. Không tạo lượt nhập kho nhà máy giả.

### D. Thuê ngoài, bên gia công tự cấp thép

Mua đầu ra theo bản vẽ và yêu cầu chất lượng; không trừ kho nguyên liệu công ty. Có thể chỉ định một số vật liệu công ty cấp, phần còn lại bên gia công tự mua; trách nhiệm nguồn vật liệu được ghi theo từng thành phần.

### E. Nhận gia công vật liệu khách cấp (khả năng cần hỗ trợ)

Đây là trường hợp thiết kế dự phòng, chưa khẳng định đang xảy ra ở công ty. Nhận vật liệu với chủ sở hữu là khách và gắn đơn hàng. Không đưa vào lượng vật liệu công ty có thể tự do dùng cho việc khác. Theo dõi sản phẩm, dư, phế và phần phải trả khách theo thỏa thuận. Tách vật liệu công ty cấp thêm và tiền dịch vụ để đối soát.

## 5. Kho và công đoạn

Một kho nhà máy, nhiều vị trí và trạng thái rõ ràng, không tạo mỗi công trình một kho vật lý mới:

- Nguyên liệu; thép dư còn dùng; thành phẩm chờ giao; phế liệu.
- Vật liệu/chi tiết đang gia công; đang ở nhà gia công; đang vận chuyển.
- Chờ QC/giữ lại là trạng thái chất lượng có thể áp dụng ở nhiều vị trí, không chỉ một kho riêng.

Sổ tồn phân biệt hàng hiện có và hàng sẵn sàng: đang giữ cho đơn khác, không đạt/chờ QC, hàng khách gửi không được tính vào tồn có thể cấp tự do. Tổng theo nhà máy vẫn phải phân tách chủ sở hữu và đơn vị đo.

Các công đoạn khởi đầu có thể cấu hình: cắt → tổ hợp/hàn → làm sạch/sơn/mạ → kiểm tra → giao. Không bắt mọi sản phẩm đi qua tất cả công đoạn. Ghi nhận theo đợt/gói để không biến thao tác hằng ngày thành nhập liệu cho từng đường hàn.

Một thao tác “Hoàn thành & xuất ngay” có thể tạo các sự kiện nghiệp vụ liên kết trong cùng giao dịch, nhưng phải kiểm tra số lượng đạt QC và điểm giao; hoàn thành gia công không đồng nghĩa người nhận đã nhận hàng.

## 6. Bóc tách, bản vẽ và số lượng

BOM có lớp cấu kiện/chi tiết và lớp nguyên liệu cần dùng. Kỹ thuật xác nhận khối lượng, phương án cắt, phụ cấp và hao hụt dự kiến. Nhập tay/dán bảng/Excel là giao diện nhập ban đầu đề xuất, chờ xác nhận nguồn bóc tách thực tế. Không cam kết tự bóc tách chính xác PDF/DWG hoặc tự tối ưu nesting trong đợt đầu.

Lưu riêng số cái/tấm/thanh, kg lý thuyết và kg cân. Nếu chưa cân, hiển thị chưa cân; không biến số lý thuyết thành số thực nhận. Quy đổi theo quy cách/lô/đợt nhận được xác nhận, không dùng một hệ số kg chung cho mọi sản phẩm có cùng tên.

Bản vẽ thay đổi tạo revision mới, so sánh phần tăng/giảm/thay đổi. Phần chưa làm cập nhật sau duyệt; phần đã cắt/đang thuê ngoài/đã giao cần quyết định xử lý, không ghi đè lịch sử. Hàng Rev A không tự động coi là hàng Rev B. Thay thế mác thép/quy cách cũng phải được kỹ thuật chấp thuận.

Đối soát vật liệu theo cùng phạm vi và cơ sở đo: đầu vào + bổ sung = phần trong sản phẩm + dư tái sử dụng + phế thu hồi + hao hụt + phần còn dở dang/chưa quyết toán. Các nguồn cân khác nhau và vật liệu phụ/sơn/hàn phải được ghi rõ; không áp một phương trình thép lý thuyết để cưỡng ép số cân thành phẩm sau sơn bằng nhau.

## 7. Bảng nhu cầu chuẩn và kết nối ba phần đã duyệt

### Cấu hình mẫu

Công tắc Mua hàng đi cùng phiên bản mẫu. Cho phép thêm “Nhu cầu mua sắm” chuẩn; giữ các trường tự do bên ngoài. Xuất bản mẫu kiểm tra quyền, kho hợp lệ, cấu trúc trường, đơn vị. Yêu cầu và Quy trình cần chung hợp đồng dữ liệu dù hai bộ tạo mẫu hiện khác nhau.

Phiếu mới lưu cấu hình và dữ liệu theo phiên bản lúc gửi. Phiếu đang duyệt không đổi cấu hình ngầm; mẫu cũ còn dùng hai route đã bật cho tới khi được nâng phiên bản rõ ràng. Không backfill phiếu cũ. Phiếu cũ thiếu dữ liệu có bước bổ sung có lịch sử; trường ảnh hưởng số lượng/quy cách/điểm nhận cần quy tắc duyệt lại, không đổi snapshot nguồn im lặng.

### Nội dung chuẩn

Đầu phiếu: bộ phận/công trường hoặc đơn hàng khách, mục đích, ngày cần, điểm/kho nhận mặc định. Dòng: ID ổn định, tên, danh mục tùy chọn, cách quản lý sau nhận, quy cách, bản vẽ/revision, đơn vị, số lượng đề xuất và phê duyệt riêng, kho/điểm nhận, ngày cần, đối tượng sử dụng dự kiến, tệp và ghi chú. Phương án đáp ứng có thể đề xuất tại nguồn nhưng người có thẩm quyền quyết định; không bắt nhân viên đề xuất hiểu luồng kho/sản xuất.

Dòng mua dịch vụ gia công có liên kết lệnh gia công và phạm vi công đoạn. Không tạo tồn kho cho bản thân dịch vụ.

Ngày cần ≠ ngày hẹn giao ≠ ngày nhận thực tế. Điểm nhận có thể là kho, công trường, nhà gia công hoặc khách hàng; kho phù hợp được yêu cầu tại bước thực sự hạch toán tồn, không gắn kho giả cho giao thẳng/dịch vụ.

### Mua hàng

Duyệt cuối tạo nhu cầu bền vững theo source type + source ID + stable line ID + revision, cùng liên kết về nguồn. Tiếp nhận/phân công không đồng nghĩa đặt mua. Trước lập PO phải rõ hàng, đơn vị, số lượng đã duyệt, phương án và điểm nhận. Có giữ phần đã bố trí/cam kết để ngăn tạo mua/gia công trùng. Sửa/hủy nguồn đã có cam kết tạo cảnh báo xử lý thay đổi; không tự xóa đơn mua hay thu hồi vật liệu đã xuất.

### Tài sản

Số thực nhận đạt QC mới được chuyển thành hồ sơ tài sản. Dòng nhận liên kết tài sản theo từng chiếc/lô/bộ theo chính sách nhóm tài sản, serial nếu áp dụng. Tồn vị trí và hồ sơ tài sản là hai góc nhìn của cùng lần nhận, không ghi tăng giá trị/chi phí hai lần. Tạo dự thảo cấp phát nếu nguồn đã có người/bộ phận sử dụng; xác nhận bàn giao thực tế mới cập nhật người giữ. Lỗi giữa ghi kho và tạo tài sản phải rollback cùng giao dịch hoặc có trạng thái chờ đồng bộ và retry không nhân bản.

## 8. Quyền, lịch sử và nền tảng hiện có

Các điểm đã kiểm tra trong code:

- `types.ts`: InventoryItem bắt buộc sku, tồn hiện được tổng hợp theo kho; Warehouse chưa có cờ kho nhà máy chỉ admin.
- `supabase/migrations/20261008137100_wms_v1_catalog_stock.sql`: màn kho đọc inventory_balances/inventory_ledger_entries. Không dùng stock_by_warehouse làm nguồn tồn mới.
- `supabase/migrations/20261008171002_procurement_external_intake.sql`: hai route cố định, snapshot chỉ tiếp nhận; projectId/warehouseId/neededDate hiện null. Không được chỉ bật UI mà bỏ qua thay đổi contract/server.
- `lib/requestTemplateService.ts`, `lib/requestTemplateEditorModel.ts`, `components/request/template/RequestFormBuilder.tsx`: mẫu có phiên bản; bảng tự do chưa có cell type/reference chuẩn.
- `pages/wf/WorkflowBuilder.tsx`: bộ tạo mẫu khác, bảng chủ yếu dựa vào tên cột.
- `lib/purchaseReceiptService.ts`, `lib/purchaseReceiptWorkflow.ts`: đã có số phiếu/kiểm đếm/chấp nhận riêng và command nhận hàng; phải reuse gate này.
- `types.ts`, `lib/assetAssignmentService.ts`, `lib/assetAssignmentPermissions.ts`: đã có tài sản theo chiếc/lô/bộ, vị trí, cấp phát/thu hồi/điều chuyển. Nối thêm nguồn nhận mua thay vì làm sổ tài sản thứ hai.

Kho chỉ admin phải chặn ở server/RLS, các RPC đọc/ghi, báo cáo, xuất dữ liệu và dropdown; không chỉ ẩn menu hay bỏ người phụ trách. Quyền nhìn nguồn, mua, duyệt kỹ thuật, kho, tài sản và chi phí tách biệt. Giai đoạn đầu nhà máy chỉ admin, sau đó cấu hình được người phụ trách.

Lịch sử gắn actor, thời điểm, nguồn và revision. Retry cùng sự kiện không sinh trùng PO, chuyển kho, sản xuất hoặc tài sản. Không sửa số tồn trực tiếp. Chứng từ đã ghi sổ sửa bằng đảo/điều chỉnh có truy vết. Mọi kiểm thử nghiệp vụ có thay đổi dữ liệu trên Cloud chạy transaction rollback; không tự duyệt phiếu thật.

## 9. Trình tự triển khai và nghiệm thu

1. Hợp đồng dữ liệu bảng chuẩn và cấu hình mẫu có version; giao diện desktop dán bảng, mobile thẻ; validation ID/kho/ngày/quyền ở server. Công tắc cho cả Yêu cầu và Quy trình.
2. Nhu cầu có stable line/revision, phân nguồn đáp ứng; nối tới PO và nhận hàng cho vật tư/tài sản. Kiểm thử chống mua trùng, mua từng phần, trả/hủy/sửa nguồn, dữ liệu legacy và quyền.
3. Nhận hàng → hồ sơ tài sản → dự thảo cấp phát → bàn giao xác nhận. Kiểm thử nhận thiếu/nhiều đợt, serial trùng, không có người nhận, hoàn trả và retry.
4. Hồ sơ đơn gia công, revision bản vẽ/BOM, kho nhà máy admin-only, lô tấm/dư/cấu kiện và QC. Kiểm thử hai máng xối cùng tên khác công trình; chia tấm nhiều chi tiết; thép dư tái dùng; bản vẽ đổi khi đã cắt.
5. Thuê ngoài theo từng phần/công đoạn, ai cấp vật liệu, tồn tại đơn vị gia công, giao thẳng, đối soát dư/phế. Kiểm thử giao thiếu, nhận nhiều lần, vật liệu bên nhận đang giữ, không tạo nhập kho nhà máy giả.
6. Đơn khách ngoài và vật liệu khách cấp; báo cáo tiến độ/vật liệu/chi phí quản trị theo đơn. Quy tắc kế toán chính thức cần xác nhận cùng người phụ trách, không suy ra từ phần mềm tham khảo.

Các bước là thứ tự phụ thuộc, không phải đã triển khai. Nghiên cứu này không tạo kho, chỉnh quyền, cập nhật phiếu RQ-2026-000052 hoặc áp migration mới.

## 10. Nguồn tham khảo và cách áp dụng

- Tekla PowerFab, Material traceability (2026, truy cập 05/10/2026): https://support.tekla.com/doc/tekla-powerfab/2026/start_material_traceability — tham khảo heat number/chứng chỉ và truy ngược vật liệu đã dùng. Đề xuất cho Vioo: liên kết lô tấm tới đầu ra và chứng chỉ, bắt buộc tùy yêu cầu công trình.
- Tekla PowerFab API, Inventory Remnant: https://developer.tekla.com/doc/tekla-powerfab/2025/fsreq-inventory-remnant-properties-56564 — tham khảo đối tượng thép dư độc lập và liên kết vật liệu. Vioo không tích hợp API Tekla trong phạm vi nghiên cứu này.
- Odoo 19, Resupply subcontracting: https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/subcontracting/subcontracting_resupply.html — tham khảo vị trí theo dõi vật liệu công ty gửi bên gia công, tách khỏi mua trọn gói.
- ERPNext, Subcontracting: https://docs.frappe.io/erpnext/subcontracting — tham khảo đối soát vật liệu cấp, vật liệu bên gia công tự cung ứng và nhận sản phẩm theo đơn thuê gia công.
- ERPNext, Subcontracting Inward: https://docs.frappe.io/erpnext/subcontracting-inward — tham khảo theo dõi riêng vật liệu khách gửi, giữ cho đúng đơn, trả phần dư. Không sao chép mặc định sổ sách hoặc giao dịch giả của phần mềm này vào Vioo.

Các quyết định quy trình, phân quyền, UX và kiến trúc nêu trên là đề xuất riêng dựa trên bối cảnh người dùng và code hiện có; nguồn tham khảo không phải chứng nhận quy trình hiện tại của công ty.
