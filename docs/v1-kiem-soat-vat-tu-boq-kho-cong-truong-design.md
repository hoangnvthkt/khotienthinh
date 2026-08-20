# Thiết kế V1 kiểm soát vật tư từ kho công trường đến BOQ

Ngày: 2026-08-20  
Trạng thái: Đã triển khai V1 trên Supabase Cloud  
Phạm vi: Danh mục kho, WMS, sổ kho, xuất cấp thi công, hoàn trả, tiêu hao,
hao hụt và báo cáo đối chiếu BOQ.

## 0. Kết quả triển khai

- Migration: `20260820025355_project_warehouse_material_control_v1.sql`.
- Ba kho công trường active đã có đủ scope dự án/công trường: Kho RICO →
  `PRJ-12788C72`, Kho Sơn Miền Bắc → `SMB-2026`, Kho Xin Hai Vina → `DA29`.
- Không gắn kho nào với dự án đã loại `PRJ-240AC280`.
- 200 giao dịch hiện hữu đã có loại nghiệp vụ; không còn giao dịch `COMPLETED`
  chưa phân loại.
- Không có kho `SITE` active thiếu scope và không có ledger kho công trường lệch
  scope so với kho.
- Smoke test Cloud đã kiểm tra bốn nguồn nhập, chống ghi sai scope, quyết toán
  đã dùng/hao hụt, reversal và số liệu drill-down của báo cáo; toàn bộ dữ liệu
  test được rollback.
- Kiểm thử ứng dụng: 274 test files, 1.283 tests đạt; TypeScript và production
  build đạt.
- Bảng kế hoạch vật tư tuần/tháng vẫn được hoãn đúng phạm vi đã thống nhất;
  V1 dùng `Tổng BOQ × % tiến độ kế hoạch tại ngày báo cáo`.

## 1. Mục tiêu

V1 tạo một chuỗi dữ liệu thống nhất để mọi vật tư đi vào kho công trường,
bất kể xuất phát từ đề xuất, PO chủ động, mua nóng hay nhập trực tiếp, đều
được ghi nhận cho đúng dự án. Số liệu cuối cùng dùng để so sánh với BOQ là
**khối lượng đã sử dụng được xác nhận**, không phải khối lượng đã mua hoặc đã
nhập kho.

V1 phải trả lời được, theo từng dự án và mã vật tư:

1. BOQ vật tư hiện hành là bao nhiêu?
2. Đến ngày báo cáo, kế hoạch dự kiến cần bao nhiêu?
3. Đã đề xuất, đặt mua và nhập kho bao nhiêu?
4. Đã xuất cho thi công, hoàn trả, hao hụt và xác nhận sử dụng bao nhiêu?
5. Còn bao nhiêu tại kho và bao nhiêu đang do tổ đội/người nhận giữ?
6. Khối lượng sử dụng xác nhận đang thiếu hay vượt so với BOQ/kế hoạch?

## 2. Ngoài phạm vi V1

Các nội dung sau được để cho giai đoạn sau:

- Bảng kế hoạch vật tư tuần/tháng được phát hành và phê duyệt.
- Chuyển dự báo 7/30/90 ngày thành snapshot kế hoạch tuần.
- Reservation tồn kho và bảng allocation thống nhất giữa đề xuất, kho và PO.
- Bắt buộc phân bổ sử dụng vào từng WBS/hạng mục BOQ.
- Quy trình version/variation đầy đủ cho BOQ vật tư.

V1 vẫn giữ các trường `work_boq_item_id` và `material_budget_item_id` hiện có
để chuẩn bị cho các giai đoạn trên, nhưng báo cáo chính được nhóm theo mã vật
tư toàn dự án.

## 3. Hiện trạng được tái sử dụng

Hệ thống hiện đã có các thành phần nền tảng:

- `warehouses.construction_site_id` và kho mặc định theo công trường.
- `transactions` làm chứng từ WMS nhập, xuất, chuyển, điều chỉnh và thanh lý.
- `inventory_transactions`, `inventory_ledger_entries` và
  `inventory_balances` làm sổ kho và cache tồn.
- `material_issue_orders` và `material_issue_lines` làm phiếu xuất cấp thi
  công cho nhân viên, tổ đội, thầu phụ hoặc đối tác.
- `material_issue_returns` tạo phiếu nhập hoàn trả liên kết dòng xuất gốc.
- `material_party_ledger` ghi các sự kiện `issue`, `return`, `consume`, `loss`
  và `adjustment` theo bên nhận.
- `material_budget_items` làm BOQ vật tư và liên kết mã vật tư kho.
- `projectMaterialPlanningService` đã có dự báo 7/30/90 ngày; V1 không thay đổi
  chức năng này.

V1 mở rộng các thành phần hiện hữu thay vì tạo một hệ thống kho song song.

## 4. Nguyên tắc nghiệp vụ

### 4.1. Kho quyết định dự án

- Một kho `SITE` đang hoạt động thuộc đúng một công trường và một dự án.
- Một dự án có thể có nhiều kho `SITE`; mỗi công trường vẫn chỉ có một kho mặc
  định tại một thời điểm.
- Khi giao dịch được hoàn tất, backend lấy scope dự án/công trường từ kho,
  không tin `projectId` do frontend hoặc JSON dòng chứng từ truyền lên.
- Kho đã có WMS, ledger hoặc tồn không được chuyển sang dự án/công trường khác.
- Kho tổng, kho văn phòng và kho không thuộc dự án được phép để trống dự án.

### 4.2. Workflow không thay thế ledger

- Đề xuất và PO quyết định nhu cầu, nguồn cung và quyền phê duyệt.
- WMS quyết định thời điểm hàng thực sự vào/ra kho.
- Inventory ledger là nguồn sự thật duy nhất của tồn kho.
- Material party ledger là nguồn sự thật của lượng đã cấp cho bên nhận, đã
  hoàn trả, đã dùng và hao hụt sau khi cấp.
- Chứng từ đã post không được sửa/xóa để thay lịch sử; hoàn tác phải tạo sự
  kiện đảo.

### 4.3. Mọi nguồn nhập hợp lệ đều được phép

V1 chấp nhận các nguồn nhập kho công trường:

- PO từ đề xuất vật tư.
- PO chủ động không qua đề xuất.
- Mua nóng công trường.
- NCC cấp trực tiếp theo hợp đồng/hóa đơn.
- Điều chuyển từ kho khác.
- Nhập trực tiếp có kiểm soát.
- Vật tư tổ đội/người nhận hoàn trả.
- Tồn đầu kỳ hoặc điều chỉnh được phê duyệt.

Không tạo đề xuất giả cho PO chủ động, mua nóng hoặc nhập trực tiếp. Những
nguồn này làm tăng tồn kho dự án nhưng không tự động làm tăng nhu cầu và không
được coi là đã sử dụng.

### 4.4. Xuất kho không đồng nghĩa đã sử dụng

Đối với một dòng xuất cấp thi công:

```text
open_qty = issued_qty - returned_qty - consumed_qty - lost_qty

consumed_qty = issued_qty - returned_qty - lost_qty - open_qty
```

Trong đó:

- `issued_qty`: đã xuất khỏi kho công trường cho bên nhận.
- `returned_qty`: đã nhập hoàn trả và WMS đã hoàn tất.
- `consumed_qty`: đã được xác nhận sử dụng cho thi công.
- `lost_qty`: hao hụt/mất mát sau khi đã cấp cho bên nhận.
- `open_qty`: còn do bên nhận giữ, chưa quyết toán.

Hao hụt khi vật tư vẫn còn trong kho dùng nghiệp vụ WMS `LIQUIDATION` hoặc
`ADJUSTMENT_OUT` và làm giảm tồn. Hao hụt sau khi đã xuất cho bên nhận chỉ
phân loại lại lượng đang giữ thành `lost_qty`; không trừ tồn kho lần thứ hai.

## 5. Phân loại nghiệp vụ kho

`transactions.type` tiếp tục phản ánh chuyển động vật lý (`IMPORT`, `EXPORT`,
`TRANSFER`, `ADJUSTMENT`, `LIQUIDATION`). V1 bổ sung `business_event_type` để
phản ánh mục đích nghiệp vụ.

Các giá trị V1:

| `business_event_type` | Chuyển động | Ý nghĩa |
| --- | --- | --- |
| `request_po_receipt` | IMPORT | Nhập từ PO có đề xuất |
| `proactive_po_receipt` | IMPORT | Nhập từ PO chủ động |
| `site_hot_purchase_receipt` | IMPORT | Mua nóng công trường |
| `direct_supplier_receipt` | IMPORT | NCC cấp trực tiếp |
| `direct_manual_receipt` | IMPORT | Nhập trực tiếp có lý do |
| `project_return_receipt` | IMPORT | Hoàn trả từ bên nhận |
| `warehouse_transfer` | TRANSFER | Điều chuyển kho |
| `construction_issue` | EXPORT | Xuất cho thi công |
| `supplier_return` | EXPORT | Trả NCC |
| `warehouse_loss` | LIQUIDATION/ADJUSTMENT | Mất/hỏng khi còn trong kho |
| `inventory_adjustment` | ADJUSTMENT | Điều chỉnh kiểm kê |
| `opening_balance` | IMPORT/ADJUSTMENT | Tồn đầu kỳ |
| `reversal` | Theo chứng từ gốc | Bút toán đảo |
| `legacy_direct_receipt` | IMPORT | Dữ liệu nhập cũ chưa phân loại |
| `legacy_direct_issue` | EXPORT | Dữ liệu xuất cũ chưa phân loại |

Từ sau cut-over, giao dịch vào trạng thái `COMPLETED` phải có loại nghiệp vụ
hợp lệ. Backend tự suy ra loại từ chứng từ nguồn khi có thể; nhập/xuất trực
tiếp bắt buộc người dùng chọn mục đích.

## 6. Luồng nghiệp vụ V1

### 6.1. Nhập từ đề xuất và PO

```text
Đề xuất → PO → Đợt giao/WMS → Duyệt SL/CL → IMPORT COMPLETED
        → inventory ledger + tồn kho dự án
```

Số lượng tồn và giá trị nhập dùng số thực nhận đã duyệt. Ledger giữ liên kết
đề xuất, dòng đề xuất, PO, dòng PO và đợt giao nếu có.

### 6.2. PO chủ động, mua nóng và NCC cấp trực tiếp

```text
Chứng từ nguồn → WMS IMPORT → Duyệt SL/CL → COMPLETED
               → inventory ledger + tồn kho dự án
```

Các trường tối thiểu:

- Kho nhận.
- Mã vật tư chuẩn và đơn vị tồn kho.
- Số lượng thực nhận.
- NCC/người giao khi áp dụng.
- Đơn giá hoặc lý do chưa có giá.
- Loại nguồn nhập.
- Số hợp đồng/hóa đơn/phiếu giao hàng khi có.
- Lý do nếu nhập trực tiếp không có đề xuất/PO.
- Tệp chứng minh thực nhận.

BOQ/WBS là tham chiếu tùy chọn đối với đầu vào trực tiếp. Vật tư chưa có trong
BOQ vẫn được nhập kho nhưng được đưa vào hàng đợi ngoại lệ của báo cáo.

### 6.3. Xuất cấp thi công

Từ cut-over, mọi `EXPORT` từ kho `SITE` với mục đích thi công phải đi qua
`material_issue_orders`, kể cả khi người dùng khởi tạo từ màn hình Nhập/xuất
kho. Màn hình WMS trực tiếp sẽ yêu cầu bên nhận và tạo phiếu xuất cấp liên kết
trong cùng command nguyên tử.

```text
Phiếu xuất cấp → WMS EXPORT → COMPLETED
               → giảm tồn kho
               → issued_qty + material_party_ledger(issue)
```

Xuất trả NCC, thanh lý và điều chỉnh không được tự động phân loại thành xuất
thi công.

### 6.4. Xác nhận nhận hàng

Sau khi WMS xuất, bên nhận xác nhận số thực nhận. `received_qty` dùng để kiểm
soát giao nhận và chênh lệch, không làm thay đổi tồn lần nữa.

### 6.5. Xác nhận sử dụng

Thao tác **Đã dùng** tạo một chứng từ quyết toán tiêu hao, không chỉ cập nhật
trực tiếp bộ đếm. Chứng từ gồm:

- Phiếu xuất và dòng xuất nguồn.
- Số lượng sử dụng.
- Ngày sử dụng/xác nhận.
- Người xác nhận và người duyệt.
- Lý do/ghi chú và tệp chứng minh nếu có.
- WBS/hạng mục tùy chọn.

Khi post, hệ thống tăng `consumed_qty`, ghi `material_party_ledger(consume)` và
giảm `open_qty`. Không phát sinh inventory ledger vì hàng đã rời kho lúc xuất.

### 6.6. Hoàn trả vật tư

```text
Phiếu hoàn trả liên kết dòng xuất
 → WMS IMPORT vào kho nhận
 → COMPLETED
 → tăng tồn kho
 → tăng returned_qty
 → material_party_ledger(return)
 → giảm open_qty và giảm xuất thi công ròng
```

Chỉ khi WMS hoàn trả `COMPLETED` mới cập nhật `returned_qty`. Phiếu đang chờ
không được cộng tồn hoặc giảm số đã cấp. Nếu phiếu hoàn trả đã post bị sai,
phải tạo reversal thay vì xóa/sửa.

### 6.7. Hao hụt/mất mát

- Hao hụt trong kho: tạo phiếu `warehouse_loss`, bắt buộc lý do và người duyệt;
  WMS post giảm tồn.
- Hao hụt sau xuất: tạo chứng từ quyết toán `loss`, tăng `lost_qty`, giảm
  `open_qty`, không tạo thêm xuất kho.
- Mọi hao hụt bắt buộc có nhóm nguyên nhân, nội dung chi tiết và tệp chứng minh
  theo ngưỡng cấu hình.

## 7. Thay đổi dữ liệu

### 7.1. `warehouses`

Bổ sung:

```text
project_id text null references projects(id) on delete restrict
```

Ràng buộc bằng trigger/RPC:

- Kho `SITE` active phải có `project_id` và `construction_site_id`.
- `projects.construction_site_id` phải bằng `warehouses.construction_site_id`.
- Không cho đổi/xóa scope sau khi có WMS, ledger, tồn hoặc phiếu xuất cấp.
- Index `warehouses(project_id)` và index kết hợp
  `(project_id, construction_site_id)`.

### 7.2. `transactions`

Bổ sung:

```text
business_event_type text null
business_event_reason text null
```

`business_event_type` bắt buộc trước khi post đối với chứng từ tạo sau
cut-over. Dữ liệu cũ được phân loại bằng migration hoặc gắn nhãn legacy.

### 7.3. Inventory ledger

`inventory_transactions` và `inventory_ledger_entries` tiếp tục lưu snapshot
`project_id`, `construction_site_id`; bổ sung `business_event_type` để báo cáo
không phải giải đoán lại JSON.

Quy tắc scope theo từng entry:

| WMS | Entry | Scope lấy từ |
| --- | --- | --- |
| IMPORT | In | Kho đích |
| EXPORT | Out | Kho nguồn |
| TRANSFER | Out | Kho nguồn |
| TRANSFER | In | Kho đích |
| ADJUSTMENT | In/Out | Kho điều chỉnh |
| LIQUIDATION | Out | Kho nguồn |

Một transfer giữa hai dự án có hai entry mang hai scope khác nhau. Header
`inventory_transactions.project_id` chỉ được điền khi tất cả entry cùng một
dự án; trường hợp đa scope để `null` và giữ danh sách scope trong metadata.

### 7.4. Chứng từ quyết toán sử dụng/hao hụt

Hiện hệ thống cập nhật trực tiếp `consumed_qty`/`lost_qty`. V1 bổ sung chứng
từ audit rõ ràng:

```text
material_issue_settlements
- id uuid primary key
- settlement_no text unique
- issue_order_id uuid
- settlement_type text -- consume | loss
- settlement_date date
- status text -- posted | reversed
- reason text
- attachments jsonb
- idempotency_key text unique
- created_by uuid
- approved_by uuid
- created_at timestamptz
- reversed_at timestamptz null
- reversal_reason text null

material_issue_settlement_lines
- id uuid primary key
- settlement_id uuid
- issue_line_id uuid
- item_id text
- quantity numeric
- work_boq_item_id text null
- note text null
```

Mọi cập nhật `consumed_qty`, `lost_qty` và `material_party_ledger` phải diễn ra
trong cùng RPC/transaction với chứng từ settlement. Reversal tạo event bù và
không xóa settlement gốc.

### 7.5. Nguồn tổng hợp

- Tồn kho: `inventory_ledger_entries`/`inventory_balances`.
- Đã xuất vật lý: `inventory_ledger_entries` theo `business_event_type`, đối
  chiếu với event `issue` trên `material_party_ledger`.
- Hoàn kho vật lý: `inventory_ledger_entries`; số hoàn trả của dự án lấy từ
  event `return` trên `material_party_ledger`. Quy tắc này bảo đảm một vật tư
  trả từ dự án về kho tổng vẫn làm giảm lượng đang giữ của dự án dù entry nhập
  kho tổng không mang `project_id`.
- Đã dùng, hao hụt sau xuất và còn giữ: `material_party_ledger` cùng projection
  trên `material_issue_lines`.
- BOQ: `material_budget_items` nhóm theo `inventory_item_id`.

Không dùng `material_budget_items.actual_qty`, `cumulative_imported` hoặc
`cumulative_exported` làm nguồn sự thật mới. Các field này chỉ là projection
tương thích và phải được tính lại từ ledger nếu còn hiển thị.

## 8. Quy tắc báo cáo đối chiếu BOQ V1

### 8.1. Khóa nhóm

Nhóm chính là `(project_id, inventory_item_id)`; hiển thị SKU, tên và đơn vị
từ master item. Các dòng BOQ chưa map `inventory_item_id` nằm trong nhóm
**Chưa đủ dữ liệu đối chiếu**.

Không gộp theo tên vật tư. Chỉ cộng số lượng cùng đơn vị tồn kho chuẩn; sai
đơn vị hoặc thiếu hệ số quy đổi phải cảnh báo và loại khỏi phép cộng.

### 8.2. Công thức

```text
total_boq_qty = sum(material_budget_items.budget_qty)

planned_qty_to_date = total_boq_qty * planned_project_progress_percent / 100

gross_received_qty = tổng receipt vào kho dự án

construction_issued_qty = tổng issue event đã post,
  đối chiếu với construction_issue inventory entry

project_returned_qty = tổng return event đã post sau khi WMS hoàn trả completed

net_issued_qty = construction_issued_qty - project_returned_qty

confirmed_used_qty = tổng consume event đã post - consume reversal

loss_after_issue_qty = tổng loss settlement đã post - loss reversal

open_with_recipient_qty =
  net_issued_qty - confirmed_used_qty - loss_after_issue_qty

used_variance_to_plan = confirmed_used_qty - planned_qty_to_date

used_variance_to_boq = confirmed_used_qty - total_boq_qty
```

`planned_project_progress_percent` dùng thuật toán tiến độ kế hoạch Gantt tại
ngày báo cáo hiện có. Đây là chỉ báo vĩ mô V1, không dùng để tự động tạo PO.

### 8.3. Cột báo cáo

| Nhóm | Cột |
| --- | --- |
| BOQ | Tổng BOQ, % KH, nhu cầu KH đến ngày |
| Nguồn vào | Nhập từ đề xuất/PO, PO chủ động, mua nóng, cấp trực tiếp, chuyển kho |
| Kho | Tổng nhập, tồn hiện tại, trả NCC/điều chuyển ra |
| Thi công | Đã xuất, đã trả, xuất ròng, đã dùng xác nhận, hao hụt, còn giữ |
| Chênh lệch | Dùng so KH, dùng so BOQ, tỷ lệ sử dụng/BOQ |
| Chất lượng dữ liệu | Chưa map mã, sai đơn vị, nhập/xuất legacy, chờ quyết toán |

### 8.4. Ngày báo cáo

Mọi chỉ tiêu tại ngày quá khứ phải tổng hợp từ event có ngày không sau cuối
ngày báo cáo theo múi giờ `Asia/Ho_Chi_Minh`. Không dùng các counter hiện tại
trên dòng phiếu để dựng lại báo cáo quá khứ.

## 9. Backfill và cut-over Cloud

### 9.1. Mapping kho/dự án

Mapping đã xác định:

| Kho | Dự án |
| --- | --- |
| Kho RICO | Dự án RICO hiện liên kết Công trường RICO |
| Kho Sơn Miền Bắc | `SMB-2026` |
| Kho Xin Hai Vina | `DA29` |

`PRJ-240AC280` vẫn còn record dự án nhưng không còn liên kết công trường, nên
không được dùng để backfill Kho Sơn Miền Bắc.

### 9.2. Dữ liệu hiện tại cần xử lý

Audit Cloud ngày 2026-08-19 ghi nhận:

- 537 inventory ledger entries chưa có `project_id`.
- 395 entries thuộc kho công trường đã gắn site nhưng thiếu cả project/site.
- 58 phiếu xuất cấp và 146 dòng xuất cấp đều thiếu scope dự án/công trường.
- 190 party-ledger events hiện có.
- 54 phiếu/126 dòng nhập kho công trường cũ chưa phân loại nguồn.
- 11 phiếu/14 dòng xuất kho công trường cũ chưa phân loại nguồn.
- 34 phiếu/107 dòng xuất đã nhận diện được là `construction_issue`.
- 3 phiếu/6 dòng xuất đã nhận diện được là trả NCC.
- Dữ liệu xuất cấp hiện có: issued `109519.945518`, consumed `5900`, returned
  `112`, lost `0`, còn mở `103507.945518` theo đơn vị hỗn hợp. Các tổng này
  chỉ dùng để đối chiếu migration, không được cộng chung khác đơn vị.

### 9.3. Chiến lược backfill

Thực hiện trong migration/command có kiểm soát:

1. Gán `warehouses.project_id` theo mapping đã duyệt.
2. Backfill scope từng inventory ledger entry từ warehouse của chính entry.
3. Backfill `inventory_transactions` nếu tất cả entry cùng scope.
4. Backfill `material_issue_orders` từ `source_warehouse_id`.
5. Backfill scope cho `material_party_ledger` từ issue order.
6. Phân loại nguồn theo metadata rõ ràng:
   - `materialIssueReturnId` → `project_return_receipt`.
   - `supplierDirectDeliveryNoteId` → `direct_supplier_receipt`.
   - PO/request refs → loại receipt tương ứng.
   - `materialIssueOrderId` → `construction_issue`.
   - `supplierReturnId` → `supplier_return`.
7. Nhập không nhận diện được gắn `legacy_direct_receipt`.
8. Xuất không nhận diện được gắn `legacy_direct_issue` và đưa vào hàng đợi
   quyết toán; không tự động coi là đã dùng.
9. Sinh settlement legacy có truy vết cho các event `consume`/`loss` hiện hữu;
   không làm thay đổi các tổng đã quyết toán.
10. Rebuild `inventory_balances` từ ledger sau khi scope đổi, không cộng delta
   lần thứ hai.
11. So sánh trước/sau theo từng `(warehouse, item)`:
    tổng nhập, tổng xuất, tồn, giá trị tồn và số lượng ledger entry.

Migration phải rollback nếu bất kỳ tổng tồn nào lệch hoặc entry không tìm được
kho/scope bắt buộc.

## 10. Giao diện V1

### 10.1. Cài đặt kho

- Bổ sung chọn dự án sau khi chọn công trường.
- Chỉ hiển thị dự án thuộc công trường đó.
- Hiển thị nhãn “Đã khóa scope” khi kho đã phát sinh nghiệp vụ.
- Không cho lưu kho `SITE` active thiếu dự án.

### 10.2. Nhập/xuất kho

- Bổ sung “Mục đích nghiệp vụ”.
- Với nhập trực tiếp: chọn mua nóng, NCC cấp trực tiếp hoặc nhập khác; yêu cầu
  lý do/chứng từ tương ứng.
- Với xuất từ kho công trường: mục đích thi công mở form phiếu xuất cấp và bên
  nhận; không tạo EXPORT rời rạc.
- Trả NCC, thanh lý và hao hụt có form/lý do riêng.

### 10.3. Xuất cấp thi công

Tái sử dụng `MaterialIssuePanel`, bổ sung:

- Lịch sử chứng từ **Đã dùng** và **Hao hụt**.
- Quyền reversal với lý do.
- Ngày quyết toán.
- Hiển thị phương trình từng dòng: xuất, trả, dùng, hao hụt, còn giữ.
- Hàng đợi phiếu đã xuất nhưng chưa quyết toán.

### 10.4. Đối chiếu BOQ

Thêm màn hình theo dự án với:

- Ngày báo cáo.
- Bộ lọc nhóm vật tư, trạng thái chênh lệch và chất lượng dữ liệu.
- Bảng chỉ tiêu tại mục 8.3.
- Drill-down từ mã vật tư đến BOQ, nhập kho, phiếu xuất, hoàn trả và settlement.
- Hàng đợi ngoại lệ: chưa map mã, sai đơn vị, legacy direct, chờ quyết toán.

## 11. Quyền và RLS

- Quản lý binding kho/dự án: Admin, WMS admin hoặc quyền master-data hiện có.
- Nhập/xuất/duyệt WMS: quyền WMS hiện có theo kho.
- Tạo và quyết toán xuất cấp: quyền phòng Vật tư tương ứng và người chịu trách
  nhiệm/bên nhận theo rule hiện có.
- Xem đối chiếu: quyền xem BOQ vật tư hoặc xem sổ vật tư dự án.
- Reversal settlement/loss: quyền riêng, không mặc nhiên cấp cho người tạo.

Các bảng public mới phải bật RLS và cấp quyền Data API rõ ràng. Policy dùng
helper quyền authoritative hiện có, không dùng `user_metadata` trong JWT.
Các RPC đặc quyền đặt logic nội bộ trong `app_private`, `security definer` với
`search_path = ''` và chỉ expose wrapper cần thiết.

## 12. Tính nguyên tử, idempotency và xử lý lỗi

- Posting WMS, sinh inventory ledger và đồng bộ issue/return phải thành công
  hoặc thất bại cùng nhau.
- Mỗi command create/post/reverse settlement có `idempotency_key`; bấm lặp
  trả lại cùng kết quả.
- Khóa các dòng kho/issue liên quan trong thời gian ngắn bằng `FOR UPDATE`.
- Không gọi dịch vụ ngoài trong transaction database.
- Scope chứng từ khác scope kho: chặn và báo rõ kho, dự án chứng từ và dự án
  cấu hình.
- Return/consume/loss vượt `open_qty`: chặn tại RPC.
- Return chỉ cập nhật projection sau khi WMS `COMPLETED`.
- Reversal không được làm tổng return/consume/loss âm.

## 13. Chỉ mục chính

- `warehouses(project_id, construction_site_id)`.
- `inventory_ledger_entries(project_id, material_id, transaction_date, id)`.
- Partial index ledger theo `business_event_type` cho `construction_issue`,
  `project_return_receipt`, `warehouse_loss`.
- `material_issue_orders(project_id, construction_site_id, status, created_at)`.
- `material_issue_lines(issue_order_id, item_id)`.
- `material_party_ledger(project_id, item_id, created_at, ledger_type)`.
- `material_issue_settlements(issue_order_id, status, settlement_date)`.
- `material_issue_settlement_lines(issue_line_id)`.
- `material_budget_items(project_id, inventory_item_id)`.

Thứ tự cột equality trước, ngày range sau. Mọi FK mới phải có index hỗ trợ.

## 14. Tiêu chí nghiệm thu

### Scope kho và ledger

1. Cả bốn nguồn nhập vào cùng kho công trường đều ghi đúng project/site.
2. Nhập/xuất trực tiếp không thể post nếu thiếu mục đích nghiệp vụ.
3. Scope chứng từ khác scope kho bị chặn nguyên tử.
4. Transfer giữa hai dự án ghi đúng scope riêng cho entry out/in.
5. Không thể đổi dự án của kho đã phát sinh nghiệp vụ.

### Nhập trực tiếp

6. Mua nóng và NCC cấp trực tiếp nhập tồn mà không cần request giả.
7. Phiếu nhập trực tiếp có nguồn, lý do, NCC/chứng từ và file theo rule.
8. Nhập trực tiếp không tự tăng số đề xuất hoặc số đã sử dụng.

### Xuất, trả, dùng và hao hụt

9. Xuất thi công giảm tồn đúng một lần và tăng `issued_qty` đúng một lần.
10. Hoàn trả chỉ tăng tồn/tăng `returned_qty` khi WMS hoàn tất.
11. Settlement dùng/hao hụt không trừ tồn lần thứ hai.
12. `issued = returned + consumed + lost + open` đúng cho mọi dòng.
13. Reversal tạo event bù, giữ chứng từ gốc và cập nhật báo cáo đúng.
14. Xuất trả NCC, transfer, liquidation và adjustment không bị tính là dùng.

### Báo cáo

15. Báo cáo nhóm theo project + inventory item, không gộp theo tên.
16. Đã dùng thực tế lấy từ consume event, không lấy từ nhập site hoặc request.
17. Ngày báo cáo quá khứ chỉ dùng event đến cuối ngày đó.
18. Dòng chưa map/sai đơn vị/legacy được hiển thị ngoại lệ, không cộng âm thầm.
19. Drill-down tổng bằng đúng chứng từ chi tiết.

### Migration

20. Tổng tồn từng warehouse/item trước và sau cut-over không đổi.
21. 395 ledger entry kho công trường được backfill scope hoặc migration fail.
22. 58 phiếu xuất cấp và party ledger liên quan được backfill đúng scope.
23. Không tự chuyển 14 dòng legacy direct issue thành `consumed`.

## 15. Thứ tự triển khai đề xuất

1. Migration kho → dự án, validation và UI cấu hình.
2. Central scope resolver và sửa ledger posting.
3. `business_event_type` cùng rule phân loại nhập/xuất.
4. Hardening phiếu xuất cấp, hoàn trả và settlement/reversal.
5. Backfill Cloud và rebuild balances với audit trước/sau.
6. Service/RPC báo cáo đối chiếu BOQ.
7. UI đối chiếu và hàng đợi chất lượng dữ liệu.
8. Pilot một dự án, sau đó mở lần lượt các dự án còn lại.

Không triển khai bảng kế hoạch tuần trong chuỗi trên. Sau khi V1 ổn định và dữ
liệu nhập–xuất–dùng đủ tin cậy, dự báo 7/30/90 ngày mới được dùng làm đầu vào
cho bảng kế hoạch vật tư tuần/tháng.
