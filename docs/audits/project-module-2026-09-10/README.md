# Audit module Dự án — 10/09/2026

Phạm vi: tiến độ → BOQ vật tư → đề xuất → mua hàng → kho → công nợ → thanh toán → báo cáo; trải nghiệm người thực thi và nhu cầu bốn vai trò điều hành.

## Trạng thái khắc phục

- **10/09/2026 — F06 đã triển khai trong code:** từ chối và rollback đều bị khóa trong lúc kiểm tra, khi kiểm tra lỗi hoặc còn dependency hoạt động. Danh sách PO hiển thị số PO và có đường mở PO; lỗi race từ server được đổi thành hướng dẫn nghiệp vụ và tự tải lại dependency.
- **10/09/2026 — F07 đã triển khai trong code:** `constructionSiteId` là nguồn xác định dự án đã liên kết. Trạng thái loading/error/unavailable của metadata công trường được hiển thị riêng, có thử lại khi lỗi và không khóa các tab đã có site scope. Tiến độ Gantt đang tải hiển thị trạng thái chờ thay vì `0%`, và chưa tạo cảnh báo trễ/chi phí so với tiến độ cho tới khi có số tiến độ hợp lệ.
- Kiểm thử hồi quy nằm tại `lib/__tests__/projectOperationalUxPolicy.test.ts`. Trạng thái triển khai ở đây là trạng thái source checkout; chưa đồng nghĩa đã phát hành production.

Checkout nền được kiểm tra: `306991d`. Kiểm tra Supabase Cloud đã đối chiếu target CLI với URL trong `.env`. Không dùng Supabase local/Docker. Bước audit ban đầu không triển khai migration và không sửa chứng từ thật để chữa số liệu; các thay đổi source xử lý F06–F07 được ghi riêng ở phần trạng thái khắc phục. Các smoke có thao tác ghi đều kết thúc bằng rollback; sequence cấp mã có thể vẫn tăng dù rollback.

## 1. Kết luận điều hành

**Chưa đủ cơ sở coi toàn bộ báo cáo Dự án là nguồn số liệu đã đối soát.** Hệ thống đã có các thành phần quan trọng: sổ kho, phân biệt nguồn nhập, xác nhận sử dụng, công nợ NCC, sổ chi tiền, workflow có chặn chứng từ phía sau. Tuy nhiên các màn tổng hợp chưa dùng thống nhất các nguồn này.

Ưu tiên cao nhất là đối soát số lượng/giá trị kho và thống nhất công thức tài chính. Song song cần sửa trạng thái tải dữ liệu và cách xử lý đề xuất có PO liên quan. Không nên bắt đầu bằng việc bổ sung biểu đồ dự báo khi các đầu vào này còn lệch.

Các phát hiện dưới đây phân biệt ba mức bằng chứng: **Cloud** (đã đọc trạng thái thực tế), **code** (đã truy nguyên logic), **rủi ro** (cần kiểm thử thêm trước khi kết luận có phát sinh sai dữ liệu thực tế). Số lượng thống kê là tại thời điểm audit, không phải kết quả kiểm kê vật lý.

## 2. Phát hiện và mức ưu tiên

### F01 — P1: WMS và sổ kho chưa đồng nhất; tồn giá trị có bất thường

**Cloud:** 20 cặp vật tư–kho có tổng `inventory_balances.on_hand_qty` khác `items.stock_by_warehouse`. Phép so sánh chỉ bao phủ các cặp đã có trong bảng số dư; chưa phải phép đối soát full outer bao phủ mọi cặp chỉ tồn tại ở WMS.

- 18 dòng số dư sổ kho âm: 9 kho tổng, 9 kho công trường.
- 17 dòng số lượng bằng 0 nhưng còn giá trị: 1 kho tổng, 16 kho công trường.
- 2 dòng kho công trường số lượng dương nhưng giá trị âm.
- Các nhóm trên thuộc kho chưa lưu trữ; có thể giao nhau với 20 cặp lệch, không cộng các con số thành tổng lỗi.
- Tổng phát sinh ledger khớp số lượng bảng số dư trên các dòng được so sánh (0 lệch). Vì vậy cần truy từ số dư đầu kỳ, nguồn WMS và lịch sử ghi sổ, không chỉ tính lại tổng ledger.

**Code:** `app_private.post_inventory_ledger_entry` lấy giá truyền vào để cộng/trừ giá trị; không tự lấy giá vốn bình quân khi xuất. `sync_wms_transaction_to_inventory_ledger` dùng `items[].price`, thiếu giá thì 0, kể cả xuất/chuyển kho. Đã đối chiếu công thức giá truyền vào trên function Cloud. Đây là cơ chế có thể tạo tồn giá trị bất hợp lý; chưa chứng minh nó là nguyên nhân duy nhất của mọi dòng bất thường.

**Cần làm:** xuất bảng chênh lệch theo mã vật tư/kho/kỳ; đối chiếu mở sổ, quy đổi đơn vị, chứng từ nhập/xuất/đảo và giá vốn từng dòng. Không tự ghi đè WMS bằng ledger hoặc ngược lại. Chốt chính sách định giá xuất/chuyển kho và tạo chứng từ điều chỉnh có căn cứ sau đối soát.

### F02 — P1: KPI tài chính bỏ sót cam kết PO vì truy vấn sai bảng

**Code + Cloud:** `lib/projectFinancialService.ts:98` truy vấn `project_purchase_orders`; Cloud không có relation này, PO thực tế ở `purchase_orders`. Nhánh `.then(r => r.data || [])` không kiểm tra `error`, biến lỗi thành danh sách rỗng. Cam kết PO trong KPI có thể thành 0 mà người xem không nhận được cảnh báo tải lỗi.

Ngoài sửa nguồn, phải sửa công thức: hiện `forecastFinalCost = actualCost + toàn bộ giá trị HĐ thầu phụ + toàn bộ PO đang mở`. Khi đã ghi nhận một phần thực hiện, cộng toàn bộ cam kết sẽ đếm lặp phần đã thực hiện. Hai hàm `getKPIs` và `buildFinancialSummary` còn dùng công thức dự báo khác nhau. Giá trị hợp đồng bán cũng đang được dùng thay ngân sách khi thiếu ngân sách, làm chỉ tiêu mang tên “ngân sách” đổi nghĩa.

**Cần làm:** một hợp đồng dữ liệu tài chính chung, lỗi tải phải hiện trạng thái chưa đủ dữ liệu; cam kết còn lại phải trừ phần đã ghi nhận/đóng nhu cầu; ngân sách chưa lập phải hiện chưa lập. Không chỉ đổi tên bảng rồi coi vấn đề đã xong.

### F03 — P1: Công nợ NCC trên dashboard chưa lấy từ sổ công nợ

**Code:** `lib/projectDashboardMetricsService.ts:525`, `buildSupplierMetric` lấy tổng PO để suy ra số đề nghị thanh toán rồi trừ chi tiền. Không dùng `supplier_payable_document_balances`. Do đó PO chưa nhận có thể xuất hiện như nợ, trong khi mua nóng/giao trực tiếp theo HĐ không đi qua cùng tập PO có thể bị thiếu.

**Cloud:** đang có 5 AP nguồn `purchase_delivery_receipt` và 10 AP nguồn `supplier_delivery_statement` ở trạng thái không phải draft/cancelled/reversed. Đây là các nguồn đang tồn tại thực tế, không chỉ thiết kế dự kiến.

`buildMaterialMetric` cũng cộng `totalAmount` của cả PO draft vào “chi phí mua thực tế”. Dự báo 7 ngày ở cùng service hard-code `materialCost: 0`, dù đã có service dự báo vật tư riêng.

**Cần làm:** công nợ lấy từ AP còn phải trả; chi tiền lấy từ batch đã hạch toán và bút toán đảo; báo cáo tách dự toán, cam kết, hàng nhận, sử dụng và tiền chi. Dự báo vật tư phải nối với kế hoạch BOQ, tồn khả dụng và lịch giao.

### F04 — P1: Từ chối bị chặn nhưng trả lại vẫn cho đề xuất quay về nháp khi PO đang chạy

**Cloud:** PO trong ảnh là **PO-462**, trạng thái `in_transit`, có 4 dòng liên kết tới **MR-2026-9819**, allocation `open`. Tại thời điểm audit workflow đề xuất đã ở `RETURNED`, khác thời điểm chụp ảnh. Có 1 đề xuất RETURNED liên kết PO còn hoạt động trong phép kiểm tra này; không thấy PO liên kết workflow REJECTED/CANCELLED còn hoạt động qua bảng liên kết dòng.

**Code + function Cloud:** nhánh reject gọi kiểm tra dependency; nhánh return không gọi kiểm tra này và đưa `requests.status` về `DRAFT`. Việc trả bổ sung hồ sơ khi PO đang chạy có thể là nghiệp vụ hợp lệ, nhưng phải phân biệt với cho sửa nhu cầu gốc đã mua. Hiện hai trạng thái dễ bị người dùng hiểu là “đề xuất đã quay lại từ đầu”.

**Cần làm:** xác định rõ “trả bổ sung hồ sơ” và “thu hồi nhu cầu”. Khi đã có PO/đợt cấp: khóa hoặc version hóa số lượng, mã vật tư, scope và giá trị đã cam kết; muốn giảm/hủy phải xử lý phần còn mở bằng hành động chuyên biệt. Audit này chưa thực hiện sửa nhu cầu của MR thật để kiểm chứng khả năng ghi đè dòng đã mua.

### F05 — P1: Thao tác nhận đợt cấp có nguy cơ ghi dở dang

**Code:** `lib/materialRequestFulfillmentService.ts:2119`, `receiveBatch` ghi `received_qty` từng dòng trước khi kiểm tra trạng thái WMS. Nếu WMS vẫn PENDING, hàm ném lỗi sau khi các request cập nhật dòng đã thực hiện. Sau đó còn các request riêng hoàn tất WMS và cập nhật batch.

Các caller gồm `ReceiveFulfillmentBatchModal`, `RequestModal` và `AppContext`. Đây là rủi ro ở đường nhận đợt cấp, không quy chụp cho đường PO practical đã dùng RPC riêng. Chưa fault-inject trên Cloud để khẳng định có chứng từ thật bị ghi dở.

**Cần làm:** gom validation, cập nhật dòng, WMS và batch trong một RPC transaction; kiểm tra phiên bản và idempotency. Test mất mạng sau từng bước, nhận lặp và hai người cùng nhận.

### F06 — P1 UX: Đã có khóa dependency nhưng nút từ chối vẫn cho xác nhận

**Code khớp ảnh:** `components/project/ProjectWorkflowActionDialog.tsx:146` tải dependency cho reject và rollback; nhưng validation và `disabled` chỉ áp dụng cho rollback (`:189`, `:292`). Reject vẫn gọi server rồi catch hiển thị nguyên `err.message`.

Danh sách liên quan chỉ hiển thị UUID, không có mã PO dễ đọc/nút mở chứng từ; hướng dẫn dùng thuật ngữ `reverse/cancel/return/rollback`. Người vận hành không biết đến màn nào, xử lý gì và ai có quyền làm.

**Cần làm:** chặn cả khi đang kiểm tra, kiểm tra lỗi hoặc có dependency; hiển thị “Đang có PO-462 vận chuyển — mở PO để xử lý phần giao/nhận còn lại”. Máy chủ vẫn phải kiểm tra lại khi xác nhận vì dữ liệu có thể vừa thay đổi. Không gỡ chốt chặn server để giải quyết lỗi UX.

### F07 — P1 UX: Chưa tải công trường bị hiểu thành chưa liên kết

**Code:** `pages/ProjectDashboard.tsx:439` gọi `useModuleData('da')` nhưng không sử dụng `moduleLoadState/moduleLoadErrors`. Danh sách dự án tải riêng. `selectedSite` phụ thuộc mảng công trường trong context; `renderOverview` tại `:2965` tính `hasSiteLink = Boolean(effectiveSiteId && selectedSite)`.

Trong lúc context chưa tải xong, một dự án đã có `constructionSiteId` vẫn bị xem là không liên kết; các tab tại `:3186–3243` bị gate theo điều kiện này. Tiến độ lại tải tiếp sau `projectFinances`, nên biểu hiện “đợi % xuất hiện rồi vào mới có dữ liệu” phù hợp với chuỗi tải này.

**Cần làm:** tách loading / loaded-linked / loaded-unlinked / error / denied. Dùng ID dự án và công trường làm scope ổn định; không biến mảng chưa tải thành sự thật nghiệp vụ. Deep-link khi cache lạnh phải chờ dữ liệu cần thiết, có retry và không hiển thị số 0 giả. Chưa tái hiện bằng browser đăng nhập + network throttling trong đợt audit này; kết luận nguyên nhân ở mức code, không tuyên bố đã sửa hay browser smoke đã qua.

### F08 — P1/P2: Nhập thiếu giá và đơn vị tổng hợp chưa được kiểm soát đầy đủ

**Cloud, kho công trường đang hoạt động:** có 74 bút toán `legacy_direct_receipt` giá 0 và 18 bút toán `direct_supplier_receipt` giá 0; còn giá 0 ở xuất, chuyển, trả NCC. Đây là số bút toán, không phải số phiếu, và giá 0 ở nguồn lịch sử chưa tự động đồng nghĩa lỗi thao tác hiện tại.

Nhập trực tiếp đã có yêu cầu lý do ở trigger business event nhưng yêu cầu lý do không giải quyết giá vốn. Với nhận theo HĐ, kho có thể chưa biết giá tại lúc nhận; cần trạng thái chờ định giá và cơ chế cập nhật giá trị có truy vết sau đối chiếu, thay vì dùng 0 như giá chính thức.

**Code:** `summarizeProjectMaterialReconciliation` cộng lượng tất cả vật tư vào một tổng, có thể trộn kg/cây/bao. `plannedQtyToDate` fallback lấy BOQ × % tiến độ chung. Hai giá trị chỉ nên dùng trong ngữ cảnh được chú thích; không dùng tổng lượng khác đơn vị hay % chung thay nhu cầu theo từng công tác.

### F09 — P1 tài chính: Doanh thu chứng nhận có thể lẫn chứng nhận thầu phụ

`paymentCertificateService.listBySite` lấy mọi loại hợp đồng; `projectFinancialService.getKPIs` tính doanh thu certified/paid chỉ lọc status mà không lọc `contractType === 'customer'`. Cần test dự án có đồng thời hồ sơ chủ đầu tư và thầu phụ; chưa lượng hóa sai lệch thực tế trên Cloud trong audit này.

### F10 — P2: Bộ smoke chưa đồng bộ sau thay đổi phân quyền

Smoke practical PO dừng khi tạo fixture với `Legacy permission writes are disabled`. Smoke payment ledger dừng vì thiếu fixture PAY cố định. Không thể dùng kết quả unit test xanh để tuyên bố các nhánh giao dịch đó đã qua trên Cloud. Cần fixture độc lập, dùng phân quyền hiện hành và chạy được lặp lại.

## 3. Vòng đời dữ liệu và nguyên tắc đối soát

Đây là chuẩn nghiệm thu đề xuất, không khẳng định mọi chốt hiện đã triển khai.

| Chặng | Đầu vào và người thực hiện | Đầu ra có căn cứ | Kiểm soát bắt buộc |
|---|---|---|---|
| Tiến độ | QLDA/kỹ sư: công tác, khối lượng, lịch, baseline | Nhu cầu theo công tác và thời điểm | Đổi lịch/khối lượng có phiên bản; không tự sửa lịch sử nhận hàng |
| BOQ | QS/vật tư: định mức, mã hàng, ĐVT, quy đổi, ngân sách | Hạn mức và nhu cầu vật tư | Mã vật tư chuẩn, snapshot quy đổi, ngoài BOQ có lý do/phê duyệt |
| Đề xuất | BCH: hạng mục, lượng, ngày cần, kho nhận, cách cấp | Nhu cầu đã duyệt, người tiếp nhận | Không coi gửi phiếu là đã duyệt; không mua trùng phần đã cam kết |
| Phân nguồn | Vật tư: tồn khả dụng, lịch giao, kho nguồn | Đợt chuyển/cấp hoặc PO cho phần thiếu | Tồn khả dụng trừ giữ chỗ; phân bổ cấp + mua không vượt nhu cầu mở |
| PO | Mua hàng: NCC, giá, VAT, lịch, điều kiện, đợt giao | Cam kết mua đã duyệt | Đơn vị mua/kho tách biệt; sửa giá/lượng vượt hạn mức phải duyệt lại |
| Nhận hàng | Thủ kho/BCH/QC: thực giao, chấp nhận, không đạt | Phiếu nhập hoàn tất đúng lượng chấp nhận | Duyệt chất lượng chưa tăng tồn; hoàn tất nhận ghi tồn đúng một lần |
| Xuất sử dụng | Thủ kho và người nhận | Đã giao cho người nhận, sau đó quyết toán sử dụng | Xuất kho không tự bằng đã thi công; còn tại đội, trả, mất mát tách riêng |
| Công nợ | Kế toán: hàng nhận/hồ sơ đối chiếu, hóa đơn, tín dụng trả hàng | AP được ghi nhận và số còn phải trả | Một nguồn một ghi nhận; hàng trả/điều chỉnh không trừ hai lần |
| Thanh toán | Kế toán/người duyệt/quỹ | Batch đã trả, phân bổ AP, bút toán tiền | Đúng NCC/scope, không vượt dư khả dụng; retry không tạo thêm chi |
| Báo cáo | Đọc sổ đã xác nhận tại ngày chốt | Số lượng, giá trị, cam kết, AP, tiền và dự báo | Truy ngược đến chứng từ; có thời điểm cập nhật và cờ chưa đối soát |

Các phương trình cần được nghiệm thu theo cùng phạm vi dự án/kho/vật tư/ĐVT/ngày chốt:

- Tồn cuối = tồn đầu + nhập mua + chuyển đến + trả từ đội − xuất đội − chuyển đi − trả NCC − hao hụt ± điều chỉnh/đảo.
- Đã giao ròng cho đội = đã xuất − đội trả = đã sử dụng xác nhận + hao hụt tại đội + còn tại đội.
- Nhu cầu còn mở = nhu cầu được duyệt − đã đáp ứng − cam kết còn hiệu lực − phần được duyệt đóng nhu cầu. Tách phần mua và phần cấp tránh trừ trùng.
- Công nợ còn trả = giá trị được ghi nhận − tín dụng/điều chỉnh giảm − phân bổ thanh toán/khấu trừ hợp lệ. Mỗi loại khấu trừ chỉ xuất hiện một lần.
- Chi phí thực tế, giá trị tồn kho và dòng tiền là ba đại lượng khác nhau. Hàng mua nhập kho chưa dùng cần được trình bày rõ là giá trị nhận mua/tồn, không tự coi toàn bộ là tiêu hao công trình.
- Chi phí cuối kỳ dự báo = chi phí đã ghi nhận + phần cam kết chưa ghi nhận + ước tính phần việc chưa đặt hàng. Không cộng lặp toàn bộ PO/HĐ đã thực hiện một phần.

## 4. Bốn đường vật tư về công trường

| Nguồn | Đường thao tác nên có | Số lượng | Giá trị/công nợ |
|---|---|---|---|
| Nhập PO | PO → đợt giao → QC/thực nhận → nhập hoàn tất | Chỉ lượng chấp nhận, theo ĐVT kho | Giá theo dòng/đợt đã duyệt; ghi AP đúng nguồn sau điều kiện ghi nhận |
| Mua nóng | Đề nghị/phiếu mua nóng → duyệt → mua → nhập hoặc chi phí/CCDC → đối chiếu | Hàng tồn đi qua kho; dịch vụ/chi phí không tạo tồn | Giá, VAT, chứng từ; kiểm soát người đã ứng tiền và tránh chi lại |
| Mua theo HĐ | HĐ NCC → phiếu giao trực tiếp → nhận kho → bảng đối chiếu → AP | Nhận theo phiếu giao thực tế | Có thể chờ giá nhưng phải gắn HĐ; chưa định giá thì báo chưa đủ giá trị |
| Chuyển kho | Lệnh chuyển → kho xuất → đang đi → kho nhận/biên bản lệch | Hai đầu theo cùng định danh; quản lý phần đang đi/không nhận | Chuyển giá vốn, không tạo thêm nợ NCC hay chi phí mua mới |
| Nhập trực tiếp | Ngoại lệ có lý do, nguồn gốc, người duyệt | Có thể tăng tồn sau duyệt | Không được coi giá 0 là đã hoàn tất kế toán; cần bổ sung giá/nguồn hoặc đánh dấu chưa định giá |

Mua nóng và mua theo HĐ được tách thành hai hàng vì hồ sơ và cách đối chiếu khác nhau. Phần nhập trực tiếp vẫn tồn tại cho ngoại lệ, nhưng không nên là đường mặc định để né PO/HĐ.

## 5. Nhu cầu theo vai trò

| Vai trò | Câu hỏi cần trả lời ngay | Chỉ tiêu/màn làm việc | Quyết định và truy vết |
|---|---|---|---|
| Giám đốc tài chính | Cần bao nhiêu tiền, vào ngày nào; đang nợ ai; chi phí cuối kỳ có vượt không? | Tiền 7/30/90 ngày; AP tuổi nợ; đã nhận chưa hóa đơn; tạm ứng/giữ lại; ngân sách–cam kết còn lại–thực tế–dự báo | Ưu tiên chi, cân đối dòng tiền, duyệt vượt; mở từ chỉ tiêu tới AP/PO/phiếu nhận |
| Giám đốc dự án | Công tác nào chậm vì thiếu gì; ai đang giữ bước; còn bao nhiêu vật tư tại đội? | Tiến độ baseline/thực tế; đường găng; vật tư cần theo tuần; đề xuất quá hạn; nghiệm thu; chi phí theo WBS | Điều phối nguồn lực, lịch, nhu cầu; người chịu trách nhiệm và hạn giải quyết rõ |
| Giám đốc vật tư | Nên chuyển hay mua; hàng nào sắp thiếu/thừa; NCC giao đúng không? | Tồn khả dụng và đang đi; nhu cầu mở; PO còn giao; chênh giá/lượng; tuổi tồn; trả NCC | Phân nguồn, gom mua, điều chuyển; không tạo PO trùng phần đã giữ chỗ |
| Tổng giám đốc | Dự án nào cần can thiệp, tác động tiền/lợi nhuận/tiến độ là bao nhiêu? | Danh mục dự án cùng định nghĩa KPI; cảnh báo trọng yếu; dự báo có độ tin cậy; quyết định đang chờ | Giao người và hạn; drill-down đến bằng chứng; chỉ tiêu chưa đối soát phải được đánh dấu |

Đây là yêu cầu sản phẩm đề xuất. Chưa thực hiện đăng nhập mô phỏng từng chức danh để xác nhận quyền và khả năng nhìn thấy mọi chỉ tiêu.

## 6. Công việc của nhân viên và tiêu chuẩn UX

Mỗi chứng từ phải trả lời được: **tôi đang ở bước nào; cần nhập gì; ai nhận bước tiếp; xác nhận làm thay đổi số nào; nếu không làm được thì mở chứng từ nào để xử lý**.

| Nhân viên | Cần nhập/xác nhận | Kết quả phải nhìn được |
|---|---|---|
| Kỹ sư/BCH | Công tác/BOQ, lượng, ngày cần, kho nhận, lý do ngoài BOQ | Tồn khả dụng, phần đã đề xuất/mua, phần còn thiếu; người nhận phiếu |
| Cán bộ vật tư | Phân nguồn từng dòng, kho cấp, lượng mua, lịch | Đã cam kết bao nhiêu, chưa phân nguồn bao nhiêu; tránh mua trùng |
| Mua hàng | NCC/HĐ, ĐVT mua, quy đổi, giá/VAT, lịch giao | Giá trị trước/sau điều chỉnh, hạn mức còn lại, yêu cầu duyệt bổ sung |
| Thủ kho/QC | Lượng giao/chấp nhận/từ chối, bằng chứng, lý do lệch | Tăng/giảm tồn cụ thể; phần còn chờ, hàng đang đi, người nhận tiếp |
| Người nhận/đội | Đã nhận, đã dùng, còn giữ, trả, hao hụt | Số dư trách nhiệm của mình theo phiếu/vật tư |
| Kế toán | Đối chiếu nguồn, hóa đơn, AP, phân bổ thanh toán | Công nợ trước/sau, tiền đã chi; thiếu hồ sơ nào và ai bổ sung |

Tiêu chuẩn chung: nút theo hành động nghiệp vụ tiếng Việt; mã phiếu có thể mở; pending/error/empty tách riêng; chặn nhấn lặp; server trả lỗi có thể xử lý; thông báo sau thành công nêu rõ số liệu thay đổi. Import phải preview scope/ĐVT/mã trùng và dòng lỗi; export ghi ngày chốt, đơn vị, bộ lọc và trạng thái đối soát.

## 7. Ma trận trường hợp cần nghiệm thu

“Chưa chạy” nghĩa là chưa thực hiện tình huống đó qua UI/Cloud trong audit này; không suy từ unit test sang kết luận end-to-end. Smoke nền chỉ chứng minh phạm vi assertions trong file smoke.

| # | Tình huống | Kết quả chuẩn | Bằng chứng hiện tại |
|---|---|---|---|
| 01 | Mở Dự án ngay khi cache lạnh | Loading, scope giữ nguyên, sau tải hiện đúng dữ liệu | F07: code lỗi; chưa browser test |
| 02 | Load công trường lỗi hoặc bị hạn chế quyền | Báo lỗi/quyền, không kết luận chưa liên kết | Chưa chạy UI |
| 03 | Dự án thực sự không có công trường | Hướng dẫn liên kết phù hợp quyền | Cloud có 79 dự án thiếu site; chưa phân loại active/ẩn/không cần site |
| 04 | Đề xuất đúng BOQ | Kiểm tra lượng/ĐVT/ngày cần, giao đúng người | Đã đọc service; chưa end-to-end |
| 05 | Đề xuất ngoài BOQ/vượt BOQ | Có lý do và luồng duyệt ngoại lệ | Chưa chạy |
| 06 | Duyệt bước giữa/cuối | Đúng người tiếp nhận; cuối duyệt bàn giao phân nguồn | Đã đọc UI/service; chưa Cloud smoke mới |
| 07 | Trả lại khi chưa có PO | Về người tạo, gửi lại đúng bước trả | Chưa chạy |
| 08 | Trả lại khi PO đang chạy | Chỉ bổ sung được phần hợp lệ; không sửa ngược nhu cầu đã mua | F04: 1 trường hợp Cloud cần xử lý |
| 09 | Từ chối không có chứng từ sau | Kết thúc, không còn assignment pending | Chưa chạy |
| 10 | Từ chối có PO đang vận chuyển | Chặn, nêu mã PO và đường giải quyết | Server có guard; F06 UI lỗi |
| 11 | Hủy PO nháp chưa giao | Giải phóng cam kết/allocation đúng một lần | Chưa chạy |
| 12 | Đóng phần nhu cầu không mua tiếp | Giữ lịch sử đã giao; đóng riêng phần còn lại | Chưa chạy |
| 13 | Đổi người xử lý | Người cũ hết quyền xử lý bước, người mới có quyền đúng scope | Chưa chạy |
| 14 | Hai người duyệt/nhận cùng lúc | Một kết quả hợp lệ; lần còn lại báo đã xử lý | Chưa concurrency test |
| 15 | Mất mạng sau khi nhấn xác nhận | Retry không sinh thêm phiếu/ghi nhận | F05 rủi ro; chưa fault-injection |
| 16 | Một đề xuất vừa chuyển kho vừa mua | Tổng phân bổ không vượt nhu cầu; tách tình trạng từng dòng | Chưa chạy |
| 17 | Một PO gom nhiều đề xuất | Allocation truy ngược từng dòng, không hủy nhầm nhu cầu khác | Cloud thấy liên kết dòng; chưa chạy gom |
| 18 | PO một lần nhận đủ | QC chưa tăng tồn; hoàn tất nhận tăng tồn/AP một lần | Practical PO smoke bị chặn fixture |
| 19 | PO nhiều đợt, giá từng đợt khác | Ghi nhận theo đợt, không thay giá đợt đã khóa | Practical PO smoke bị chặn fixture |
| 20 | Nhận thiếu/không đạt | Tồn/AP chỉ phần chấp nhận; phần còn thiếu có quyết định rõ | Unit actual receipt có kiểm tra mapping; chưa Cloud practical |
| 21 | Nhận thừa/vượt tiền đã duyệt | Chặn hoặc yêu cầu duyệt bổ sung | Chưa chạy |
| 22 | Đơn vị mua cây, kho kg | Snapshot quy đổi; lượng và giá đổi tương ứng | Unit actual receipt có quy đổi; chưa Cloud practical |
| 23 | Trả NCC trước/sau thanh toán | Giảm hàng, credit/hoàn tiền theo chứng từ; không giảm hai lần | Chưa chạy chuỗi đầy đủ |
| 24 | Chuyển kho đủ/thiếu/từ chối nhận | Bảo toàn lượng hai đầu + đang đi; có xử lý lệch | Smoke kiểm soát kho qua; chưa đủ 3 nhánh |
| 25 | Xuất đội rồi trả phần chưa dùng | Không trả vượt lượng còn giữ; số dư trách nhiệm đúng | Smoke issue reversal/return qua |
| 26 | Xác nhận dùng/hao hụt rồi đảo | Không vượt đã xuất; đảo trả số dư đúng | Smoke kiểm soát vật tư qua |
| 27 | Mua nóng tồn kho/chi phí/CCDC | Đi đúng loại dòng; không tự tăng tồn cho chi phí | Unit service; chưa end-to-end |
| 28 | Nhận theo HĐ chưa có giá rồi đối chiếu | Tồn lượng có; giá trị chờ định giá, sau đó nối AP | Cloud 18 bút toán nguồn này giá 0; cần đối soát |
| 29 | Nhập trực tiếp không giá | Ngoại lệ có lý do và trạng thái thiếu giá; báo cáo không giả đủ | F08; chưa chạy UI |
| 30 | Trả tiền một phần/nhiều AP/khác NCC | Phân bổ đúng, chặn sai NCC/vượt dư | Unit service; Cloud payment smoke thiếu fixture |
| 31 | Đảo thanh toán và retry | Một bút toán đảo, giữ ngày đảo gốc, phục hồi nợ đúng | Chưa chứng minh Cloud do thiếu fixture |
| 32 | PO đã nhận một phần, dự báo cuối kỳ | Không cộng trùng chi phí đã nhận và tổng PO | F02 công thức cần sửa |
| 33 | Dự án có cert chủ đầu tư + thầu phụ | Doanh thu chỉ gồm chủ đầu tư | F09 code thiếu filter |
| 34 | Import trùng/mã lạ/sai ĐVT/sai scope | Preview, lỗi theo dòng, không nhập dở không rõ trạng thái | Chưa chạy UI |
| 35 | Đổi ngày chốt/xuất báo cáo | Số màn hình khớp export và ledger cùng kỳ | Chưa chạy |
| 36 | Đổi BOQ/baseline sau khi đã mua | Version, phê duyệt thay đổi; giữ nguồn nhu cầu lịch sử | Chưa chạy |

## 8. Kiểm thử đã thực hiện

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| Vitest checkout hiện tại: `npx --no-install vitest run --exclude '**/.worktrees/**'` | **377 file, 1.780 test qua, 0 fail** | Unit/contract test; không đại diện browser hoặc transaction Cloud |
| `project_warehouse_material_control_v1_smoke.sql` trên Cloud | **Qua, exit 0, rollback** | Phân loại nguồn, scope, phương trình quyết toán và assertions trong file |
| `material_issue_reversal_return_smoke.sql` trên Cloud | **Qua: safeUnusedReturn, materialIssueApprovalReversal**, rollback | Không thay thế test mọi nhánh chuyển kho/PO |
| `material_po_practical_flow_smoke.sql` trên Cloud | **Không tới được phần nghiệp vụ** | Fixture ghi quyền legacy bị chặn: `Legacy permission writes are disabled` |
| `supplier_payment_ledger_recovery_smoke.sql` trên Cloud | **Không tới được phần nghiệp vụ** | Thiếu fixture cố định `PAY-20260807-9D4F5BC7` |
| Query read-only schema, PO ảnh, kho, AP, definitions | **Đã thực hiện** | Snapshot tại thời điểm audit; không kết luận số liệu đúng bằng việc query chạy thành công |

Lần `npm test` đầu quét cả `.worktrees` dẫn đến 43 assertion fail ở checkout cũ và các suite lỗi tải. Đã xác định phạm vi và chạy lại riêng checkout hiện tại như trên. Kết quả của các worktree không được gán là lỗi ứng dụng hiện tại. Đây cũng là điểm cần cải thiện cấu hình test mặc định.

Artifacts: `cloud-readonly.sql`, các `cloud-*.json`, `test-summary.json`, bốn `*-smoke.log`. JSON chứa thống kê và mã chứng từ phục vụ audit, không chứa token/mật khẩu. Các query bổ sung được lưu trong `cloud-followup.sql` để lặp lại.

## 9. Thứ tự khắc phục và điều kiện hoàn thành

1. **Khôi phục trải nghiệm có thể thao tác đúng:** F06–F07; thêm hướng dẫn PO liên quan, load state rõ và browser test cache lạnh/mạng chậm. Giữ nguyên kiểm tra chặn ở server.
2. **Khóa tính toàn vẹn đề xuất–PO–nhận hàng:** F04–F05; thống nhất trả bổ sung/thu hồi/hủy/đóng nhu cầu; RPC nguyên tử; fixtures phân quyền mới; smoke đủ các nhánh 06–24.
3. **Đối soát kho và giá vốn:** F01–F08; danh sách chênh lệch có chủ sở hữu và chứng từ gốc; giải quyết opening/giá/quy đổi/đảo. Nghiệm thu riêng kho tổng và kho công trường, bao phủ cả cặp WMS chưa có ledger.
4. **Thống nhất sổ tài chính:** F02–F03–F09; AP/chi tiền/cert/giá trị tồn/tiêu hao dùng đúng nguồn, đúng scope và cùng ngày chốt. Một bộ công thức dùng cho tổng quan, tài chính và export.
5. **Hoàn thiện điều hành theo vai trò:** dashboard CFO/QLDA/vật tư/TGĐ cùng nguồn đã đối soát; dự báo từ nhu cầu thực và tiến độ; cảnh báo có người/hạn/hành động.

Nghiệm thu cuối: nhân viên thực hiện được trọn chuỗi cả thuận và ngoại lệ; không ghi dở/ghi lặp; kho và giá trị đối soát có giải thích; tiền chi không bị tính lại thành chi phí; số báo cáo mở được chứng từ nguồn; dữ liệu chưa đủ không hiện như số 0 đã xác nhận. Audit này hoàn tất bước xác định hiện trạng và backlog, chưa phải xác nhận module đã hoàn thiện.
