# Đặc tả ứng dụng bán hàng và quản lý kho nội bộ một cửa hàng

- Ngày chốt đặc tả: 2026-08-21
- Trạng thái: Bản thiết kế đã được chủ dự án duyệt, sẵn sàng để review trước khi lập implementation plan
- Loại dự án: Dự án mới hoàn toàn, độc lập với Vioo và mọi mã nguồn hiện có
- Đối tượng sử dụng: Nội bộ cửa hàng
- Nền tảng: Web responsive, mobile-first, cài được như PWA

## 0. Cách sử dụng tài liệu

Tài liệu này là nguồn yêu cầu chính thức để Codex hoặc đội phát triển dựng một repository mới từ đầu. Không được suy diễn rằng dự án phụ thuộc vào Vioo, không tái sử dụng schema, quyền, component hoặc dữ liệu của Vioo nếu chưa có chỉ dẫn riêng.

Khi triển khai:

1. Đọc toàn bộ tài liệu trước khi tạo code hoặc migration.
2. Lập implementation plan theo từng phase và có checkpoint kiểm thử sau mỗi phase.
3. Không mở rộng MVP bằng các tính năng nằm ngoài phạm vi.
4. Mọi invariant về tồn kho, giá vốn, trả hàng và phân quyền phải được bảo vệ tại database, không chỉ ở giao diện.
5. Nếu gặp yêu cầu có thể hiểu theo nhiều cách, ưu tiên quy tắc đã ghi rõ trong tài liệu này; không tự thêm nghiệp vụ mới.

## 1. Mục tiêu sản phẩm

Xây dựng một ứng dụng nội bộ cho một cửa hàng nhỏ để:

- Quản lý danh mục hàng hóa, ảnh, mã hàng, mã vạch và thông số sản phẩm.
- Xem tổng số sản phẩm và lượng tồn hiện tại của từng sản phẩm.
- Nhập hàng và cập nhật giá vốn bình quân.
- Bán hàng, thu tiền đủ tại thời điểm thanh toán và phát hành hóa đơn nội bộ.
- Trả một phần hoặc toàn bộ hàng theo đúng hóa đơn gốc.
- Kiểm kho và điều chỉnh chênh lệch có kiểm soát.
- Theo dõi doanh thu, giá vốn và lợi nhuận gộp.
- Giới hạn dữ liệu và chức năng theo vai trò, đồng thời cho phép chủ cửa hàng tùy chỉnh quyền vận hành của từng nhân viên.

Ứng dụng không phải website bán hàng công khai. Khách mua hàng không có tài khoản và không tự đặt hàng trên hệ thống.

## 2. Nguyên tắc và quyết định đã chốt

1. Chỉ có một cửa hàng và một kho logic.
2. Chỉ quản lý tồn tổng hợp theo sản phẩm; không quản lý lô, hạn sử dụng hoặc serial.
3. Không cho phép tồn kho âm.
4. Chỉ có một bảng giá bán hiện hành cho mỗi sản phẩm.
5. Giá bán và giá vốn của dòng hóa đơn được chốt tại thời điểm hoàn tất bán hàng.
6. Giá vốn dùng phương pháp **bình quân gia quyền liên hoàn**.
7. Trả hàng bắt buộc chọn hóa đơn gốc.
8. Tổng lượng đã trả của một dòng không được vượt lượng đã mua.
9. Hàng trả được chấp nhận mặc định nhập lại kho.
10. Giá trị hoàn tiền và giá vốn hoàn lại lấy theo snapshot của hóa đơn gốc, không dùng giá bán hoặc giá vốn hiện tại.
11. Chỉ chủ cửa hàng được xem giá nhập, giá vốn, giá trị tồn kho và lợi nhuận gộp.
12. Chứng từ đã hoàn tất không được sửa hoặc xóa trực tiếp; sửa sai bằng nghiệp vụ trả hàng, hủy hoặc đảo chứng từ.
13. Mọi giao dịch hoàn tất phải chạy online và atomically trong Postgres.
14. Thanh toán MVP chỉ gồm tiền mặt hoặc chuyển khoản và phải thanh toán đủ. Không quản lý công nợ.
15. Báo cáo tài chính trong MVP là **lợi nhuận gộp**, không phải lợi nhuận ròng vì chưa quản lý chi phí vận hành.
16. Giao diện lấy cảm hứng từ cách bố trí của ứng dụng tham khảo nhưng phải dùng nhận diện, component và tài sản hình ảnh riêng; không sao chép logo hoặc tài sản thương hiệu.

## 3. Phạm vi MVP

### 3.1 Trong phạm vi

- Đăng nhập nội bộ bằng email và mật khẩu.
- Quản lý tài khoản nhân viên, trạng thái hoạt động, vai trò mẫu và quyền tùy chỉnh.
- Danh mục sản phẩm, nhóm hàng, ảnh, SKU, mã vạch, đơn vị tính và thông số linh hoạt.
- Tìm kiếm theo tên, SKU hoặc mã vạch; hỗ trợ quét mã vạch bằng camera khi trình duyệt cho phép.
- Tồn kho hiện tại, ngưỡng tồn tối thiểu, lịch sử tăng giảm số lượng.
- Nhà cung cấp và khách hàng ở mức thông tin cơ bản.
- Phiếu nhập hàng hai bước: nhân viên lập số lượng, chủ cửa hàng nhập giá và ghi sổ.
- POS, giỏ hàng, lưu tạm, giảm giá toàn hóa đơn, thanh toán đủ và phát hành hóa đơn.
- Danh sách và chi tiết hóa đơn.
- Trả hàng theo hóa đơn gốc, hỗ trợ trả một phần hoặc toàn bộ.
- Hủy hóa đơn theo quyền và điều kiện nghiệp vụ.
- Kiểm kho, chốt chênh lệch và số dư đầu kỳ.
- Dashboard và báo cáo theo quyền.
- Nhật ký audit cho thao tác nhạy cảm.
- PWA, responsive mobile/desktop, deploy trên Vercel.
- Supabase Cloud cho Auth, Postgres, RLS, Storage và Realtime.

### 3.2 Ngoài phạm vi

- Website bán hàng công khai hoặc tài khoản khách hàng.
- Nhiều cửa hàng, nhiều kho hoặc luân chuyển giữa kho.
- Công nợ khách hàng, công nợ nhà cung cấp, bán thiếu hoặc trả góp.
- Quản lý lô, hạn sử dụng, serial, IMEI hoặc vị trí kệ.
- Nhiều bảng giá, giá theo nhóm khách hoặc chương trình khuyến mãi phức tạp.
- Tích điểm, thành viên, voucher và hoa hồng.
- Đặt hàng online, giao hàng, đối tác vận chuyển hoặc đồng bộ sàn.
- Hóa đơn điện tử, kê khai thuế hoặc nghiệp vụ kế toán đầy đủ.
- Chi phí vận hành và lợi nhuận ròng.
- Đổi hàng trong cùng một giao dịch. Đổi hàng được thực hiện bằng một phiếu trả hàng và một hóa đơn bán mới.
- Trả hàng không có hóa đơn gốc.
- Hoàn tất giao dịch khi offline.

## 4. Thuật ngữ nghiệp vụ

| Thuật ngữ | Định nghĩa |
| --- | --- |
| Tồn kho | Số lượng thực tế hiện có của sản phẩm trong kho duy nhất |
| Giá nhập | Đơn giá thực tế của dòng phiếu nhập, do chủ cửa hàng nhập |
| Giá vốn bình quân | Giá trị tồn kho chia cho số lượng tồn sau mỗi biến động làm thay đổi giá trị |
| Giá vốn hàng bán | Phần giá trị tồn kho được xuất khi hoàn tất bán hàng |
| Doanh thu thuần | Tiền hàng sau giảm giá, trừ giá trị hàng trả hoặc hủy |
| Lợi nhuận gộp | Doanh thu thuần trừ giá vốn thuần |
| Hóa đơn gốc | Hóa đơn bán hàng đã hoàn tất chứa mặt hàng được yêu cầu trả |
| Chứng từ ghi sổ | Chứng từ đã hoàn tất và đã tạo biến động tồn kho/giá trị |
| Lưu tạm | Chứng từ nháp, chưa ảnh hưởng tồn kho hoặc báo cáo |

## 5. Người dùng và phân quyền

### 5.1 Ba vai trò mẫu

Hệ thống có đúng ba vai trò mẫu:

1. `SALES_WAREHOUSE` — **Bán hàng & Kho**.
2. `BUSINESS` — **Nhân viên kinh doanh**.
3. `OWNER` — **Chủ cửa hàng**.

Không có vai trò Quản lý. Nhân viên mới mặc định nhận vai trò `SALES_WAREHOUSE`; chủ cửa hàng có thể đổi sang `BUSINESS` và điều chỉnh quyền vận hành sau đó.

Vai trò chỉ là bộ quyền mặc định. Quyền hiệu lực của nhân viên được tính theo:

```text
quyền hiệu lực = quyền mặc định của vai trò + quyền cấp riêng - quyền thu hồi riêng
```

Các quyền đánh dấu “chỉ chủ cửa hàng” là quyền khóa cứng, không thể cấp cho tài khoản nhân viên bằng override. Tài khoản `OWNER` luôn có toàn quyền và không áp dụng override. Hệ thống phải luôn còn ít nhất một tài khoản chủ cửa hàng hoạt động; không cho phép tự khóa tài khoản chủ cửa hàng cuối cùng.

### 5.2 Ma trận quyền mặc định

Ký hiệu:

- `Có`: quyền mặc định bật.
- `Không`: quyền mặc định tắt nhưng chủ cửa hàng có thể cấp riêng nếu đây là quyền vận hành.
- `Khóa`: chỉ chủ cửa hàng, không thể cấp cho nhân viên.

| Mã quyền | Chức năng | Bán hàng & Kho | Kinh doanh | Chủ cửa hàng |
| --- | --- | ---: | ---: | ---: |
| `dashboard.operational.read` | Xem dashboard vận hành | Có | Có | Có |
| `catalog.read` | Xem sản phẩm, ảnh, thông số | Có | Có | Có |
| `catalog.basic.manage` | Thêm/sửa thông tin cơ bản sản phẩm | Có | Không | Có |
| `pricing.sale.read` | Xem giá bán | Có | Có | Có |
| `pricing.sale.manage` | Thay đổi giá bán | Khóa | Khóa | Có |
| `inventory.read` | Xem tồn kho từng sản phẩm | Có | Có | Có |
| `inventory.count.draft` | Lập phiếu kiểm kho | Có | Không | Có |
| `inventory.adjustment.post` | Ghi sổ điều chỉnh kho | Khóa | Khóa | Có |
| `purchase.draft.manage` | Lập phiếu nhập và số lượng | Có | Không | Có |
| `purchase.operational.read` | Xem phiếu nhập không có giá vốn | Có | Không | Có |
| `purchase.cost.read` | Xem giá nhập | Khóa | Khóa | Có |
| `purchase.cost.enter` | Nhập giá nhập | Khóa | Khóa | Có |
| `purchase.post` | Ghi sổ phiếu nhập | Khóa | Khóa | Có |
| `sale.draft.manage` | Lập và sửa hóa đơn nháp của mình | Có | Có | Có |
| `sale.complete` | Hoàn tất bán hàng | Có | Có | Có |
| `sale.discount.apply` | Áp dụng giảm giá toàn hóa đơn | Có | Có | Có |
| `sale.own.read` | Xem hóa đơn do mình tạo | Có | Có | Có |
| `sale.all.read` | Xem tất cả hóa đơn | Không | Không | Có |
| `sale.cancel` | Hủy hóa đơn đã hoàn tất | Khóa | Khóa | Có |
| `return.request.create` | Tạo yêu cầu trả hàng từ hóa đơn gốc | Có | Có | Có |
| `return.complete` | Kiểm nhận và hoàn tất trả hàng | Có | Không | Có |
| `customer.manage` | Thêm/sửa khách hàng cơ bản | Có | Có | Có |
| `supplier.manage` | Thêm/sửa nhà cung cấp | Có | Không | Có |
| `report.own_revenue.read` | Xem doanh thu của bản thân | Có | Có | Có |
| `report.all_revenue.read` | Xem tổng doanh thu cửa hàng | Không | Không | Có |
| `report.cost_profit.read` | Xem giá vốn, giá trị tồn và lợi nhuận | Khóa | Khóa | Có |
| `staff.manage` | Tạo, khóa và phân quyền tài khoản | Khóa | Khóa | Có |
| `settings.manage` | Cấu hình cửa hàng/chứng từ | Khóa | Khóa | Có |
| `audit.read` | Xem nhật ký audit | Khóa | Khóa | Có |

### 5.3 Quy tắc dữ liệu theo người dùng

- Nhân viên chỉ thấy hóa đơn và doanh thu do chính họ tạo, trừ khi được cấp `sale.all.read` hoặc `report.all_revenue.read`.
- Quyền xem tất cả hóa đơn và quyền xem tổng doanh thu là hai quyền riêng biệt.
- Nhân viên có thể xem tồn kho và giá bán nhưng mọi DTO/API dành cho nhân viên phải loại bỏ giá nhập, giá vốn, giá trị tồn và lợi nhuận.
- Ẩn trường ở giao diện không phải biên bảo mật. Database/RLS/RPC phải từ chối truy cập trực tiếp.
- Tài khoản `is_active = false` không được đọc hoặc ghi dữ liệu dù access token chưa hết hạn.

## 6. Cấu trúc điều hướng và màn hình

### 6.1 Điều hướng chính

Thanh điều hướng dưới trên mobile gồm năm mục:

1. **Tổng quan** — dashboard theo quyền.
2. **Hàng hóa** — danh sách, tìm kiếm và chi tiết sản phẩm.
3. **Bán hàng** — POS và giỏ hàng.
4. **Hóa đơn** — danh sách và chi tiết hóa đơn.
5. **Nhiều hơn** — nhập hàng, kiểm kho, đối tác, báo cáo, nhân viên và cài đặt.

Trên desktop, các mục tương tự được trình bày bằng sidebar. Route đề xuất:

```text
/login
/
/products
/products/new
/products/:productId
/pos
/sales
/sales/:saleId
/sales/:saleId/return
/purchases
/purchases/:purchaseReceiptId
/stock-counts
/stock-counts/:stockCountId
/customers
/suppliers
/reports
/staff
/settings
```

Route phải kiểm tra quyền trước khi render. Việc người dùng biết URL không được giúp họ vượt RLS/RPC.

### 6.2 Đăng nhập

- Không có đăng ký công khai.
- Đăng nhập bằng email và mật khẩu Supabase Auth.
- Chủ cửa hàng tạo nhân viên bằng email, tên hiển thị, vai trò và mật khẩu tạm.
- Form tạo nhân viên chỉ cho chọn `SALES_WAREHOUSE` hoặc `BUSINESS`. Tài khoản `OWNER` đầu tiên được tạo bằng quy trình bootstrap bảo mật; việc tạo/thăng cấp thêm owner nằm ngoài UI MVP.
- Nhân viên phải đổi mật khẩu trong lần đăng nhập đầu tiên.
- Khi bị khóa, phiên hiện tại bị đăng xuất ở lần kiểm tra tiếp theo và mọi command nhạy cảm bị database từ chối ngay.
- Không lưu access token hoặc dữ liệu nhạy cảm bằng cơ chế tự chế; dùng cơ chế session chính thức của Supabase client.

### 6.3 Tổng quan

**Bán hàng & Kho** mặc định thấy:

- Tổng số sản phẩm đang hoạt động.
- Số sản phẩm sắp hết và đã hết.
- Doanh thu/hóa đơn của chính mình theo ngày hoặc tháng.
- Các phiếu nhập, kiểm kho hoặc yêu cầu trả đang chờ mình xử lý, không kèm giá vốn.

**Kinh doanh** mặc định thấy:

- Tổng số sản phẩm, tồn từng sản phẩm và cảnh báo hết hàng.
- Doanh thu/hóa đơn của chính mình.
- Yêu cầu trả hàng do mình tạo.

**Chủ cửa hàng** thấy thêm:

- Tổng doanh thu, giảm giá, hàng trả và doanh thu thuần.
- Giá vốn thuần, lợi nhuận gộp và tỷ suất lợi nhuận gộp.
- Giá trị tồn kho hiện tại.
- Hóa đơn, phiếu nhập và kiểm kho chờ xử lý.

Bộ lọc thời gian: hôm nay, tuần này, tháng này và khoảng ngày tùy chọn. Múi giờ nghiệp vụ cố định `Asia/Ho_Chi_Minh`.

### 6.4 Hàng hóa

Danh sách hàng hóa hiển thị:

- Ảnh đại diện.
- Tên hàng.
- SKU.
- Giá bán hiện tại.
- Tồn hiện tại.
- Nhãn sắp hết/hết hàng dựa trên `min_stock_qty`.

Phần đầu danh sách hiển thị:

- Tổng số sản phẩm đang hoạt động.
- Tổng số lượng đơn vị đang tồn, chỉ là tổng số lượng tham khảo vì có thể có nhiều đơn vị tính khác nhau.

Tìm kiếm theo tên, SKU hoặc mã vạch; hỗ trợ lọc nhóm hàng và trạng thái tồn. Danh sách dùng cursor pagination, không dùng tải toàn bộ hoặc OFFSET sâu.

Chi tiết sản phẩm gồm:

- Tên, SKU, mã vạch, nhóm hàng, đơn vị tính.
- Mô tả và thông số dạng cặp khóa–giá trị.
- Tối đa năm ảnh, có một ảnh đại diện.
- Giá bán hiện tại và lịch sử giá bán chỉ cho chủ cửa hàng khi cần.
- Tồn hiện tại và lịch sử biến động số lượng.
- Giá nhập gần nhất, giá vốn bình quân và giá trị tồn chỉ cho chủ cửa hàng.

Không cho xóa cứng sản phẩm đã có giao dịch. Chỉ được ngừng kinh doanh bằng `is_active = false`.

### 6.5 Bán hàng/POS

- Tìm hoặc quét sản phẩm.
- Chỉ cho thêm sản phẩm đang hoạt động.
- Hiển thị giá bán, tồn hiện tại và số lượng trong giỏ.
- Cho tăng/giảm số lượng, xóa dòng và nhập số lượng hợp lệ theo đơn vị.
- Khách hàng là tùy chọn; mặc định “Khách lẻ”.
- Cho giảm giá toàn hóa đơn nếu có `sale.discount.apply`.
- Giảm giá phải từ 0 đến tổng tiền hàng.
- Có nút **Lưu tạm** và **Thanh toán**.
- Lưu tạm không giữ chỗ và không làm giảm tồn.
- Thanh toán yêu cầu chọn tiền mặt hoặc chuyển khoản và thanh toán đủ.
- Khi giá hoặc tồn thay đổi sau lúc thêm vào giỏ, server từ chối hoàn tất với lỗi cụ thể để giao diện cập nhật và yêu cầu xác nhận lại.

### 6.6 Hóa đơn

Danh sách hỗ trợ:

- Tìm theo mã hóa đơn, khách hàng hoặc sản phẩm.
- Lọc khoảng ngày, người tạo, trạng thái và phương thức thanh toán theo quyền.
- Nhóm theo ngày.
- Hiển thị tổng tiền, trạng thái và phương thức thanh toán.

Chi tiết hóa đơn hiển thị:

- Mã, thời gian, trạng thái, nhân viên, khách hàng.
- Danh sách dòng với snapshot tên/SKU, đơn giá, số lượng và thành tiền.
- Tổng tiền hàng, giảm giá, khách cần trả và đã trả.
- Lịch sử trả hàng hoặc hủy.
- Nút in/chia sẻ bản nội bộ.
- Nút trả hàng nếu còn số lượng có thể trả.
- Nút hủy chỉ cho chủ cửa hàng và khi thỏa điều kiện.

Giá vốn và lợi nhuận của hóa đơn chỉ xuất hiện với chủ cửa hàng.

### 6.7 Nhiều hơn

Menu chỉ hiển thị mục người dùng có quyền:

- Nhập hàng.
- Kiểm kho.
- Khách hàng.
- Nhà cung cấp.
- Báo cáo.
- Nhân viên và phân quyền.
- Cấu hình cửa hàng.
- Nhật ký audit.

## 7. Luồng nghiệp vụ và trạng thái chứng từ

### 7.1 Quản lý nhân viên

1. Chủ cửa hàng nhập email, tên hiển thị và chọn vai trò; mặc định là Bán hàng & Kho.
2. Edge Function xác minh JWT, kiểm tra tài khoản chủ cửa hàng còn hoạt động và có `staff.manage`.
3. Edge Function dùng secret server-side để tạo Supabase Auth user, không lộ secret cho frontend.
4. Database tạo `profiles` và quyền hiệu lực mặc định.
5. Chủ cửa hàng có thể thêm override cho các quyền vận hành.
6. Khóa tài khoản đặt `is_active = false`, thu hồi/đăng xuất phiên khi khả dụng và mọi RLS/RPC tiếp tục kiểm tra trạng thái hoạt động.

Không xóa vật lý tài khoản đã phát sinh chứng từ; tên và ID nhân viên phải còn để truy vết.

### 7.2 Sản phẩm và giá bán

- Nhân viên có `catalog.basic.manage` được tạo/sửa tên, SKU, mã vạch, nhóm, đơn vị, mô tả, thông số, ảnh và ngưỡng tồn tối thiểu.
- Chỉ chủ cửa hàng được thay đổi giá bán.
- Sản phẩm mới chưa có giá bán hiện hành vẫn xuất hiện trong quản lý hàng hóa với nhãn “Chưa có giá”, nhưng không được thêm vào giỏ hoặc bán cho đến khi chủ cửa hàng đặt giá.
- Thay đổi giá bán đóng bản ghi giá hiện hành và tạo bản ghi lịch sử mới.
- Hóa đơn nháp chỉ giữ giá xem trước; lúc hoàn tất phải so sánh với giá hiện hành.
- Hóa đơn đã hoàn tất giữ snapshot và không thay đổi khi giá sản phẩm thay đổi.

### 7.3 Phiếu nhập hàng

Trạng thái:

```text
DRAFT -> AWAITING_COST -> POSTED -> REVERSED
   \-> CANCELLED       \-> CANCELLED
```

Luồng chuẩn:

1. Bán hàng & Kho hoặc Chủ cửa hàng tạo phiếu `DRAFT`.
2. Nhập nhà cung cấp tùy chọn, ngày nhận, ghi chú, sản phẩm và số lượng thực nhận.
3. Nhân viên gửi phiếu, trạng thái thành `AWAITING_COST`.
4. Chủ cửa hàng nhập đơn giá thực tế từng dòng. Mọi chiết khấu hoặc chi phí mua muốn đưa vào giá vốn phải được quy đổi sẵn vào đơn giá này; MVP không có mô-đun phân bổ chi phí mua riêng.
5. Chủ cửa hàng bấm ghi sổ.
6. Database khóa các số dư theo `product_id` tăng dần, tính giá trị mới, cập nhật tồn, cost balance, movement ledger, số chứng từ và audit trong một transaction.
7. Phiếu thành `POSTED`; không được sửa dòng hoặc giá.

Mã phiếu nhập: `PN` + số tăng dần tối thiểu sáu chữ số, ví dụ `PN000001`.

Đảo phiếu nhập chỉ cho chủ cửa hàng và chỉ được phép khi phiếu là biến động ghi sổ mới nhất của tất cả sản phẩm liên quan, đồng thời tồn hiện tại đủ để trừ đúng lượng đã nhập. Nếu đã có bán, trả hoặc điều chỉnh sau phiếu đó, command phải từ chối; chủ cửa hàng phải dùng chứng từ điều chỉnh phù hợp để giữ lịch sử đúng.

### 7.4 Bán hàng

Trạng thái:

```text
DRAFT -> COMPLETED -> PARTIALLY_RETURNED -> RETURNED
                 \-> CANCELLED
```

Luồng hoàn tất:

1. Nhân viên tạo hoặc lưu hóa đơn `DRAFT`; chưa thay đổi kho.
2. Server xác minh tài khoản hoạt động và có `sale.complete`.
3. Server lấy giá bán hiện hành, kiểm tra giảm giá và so sánh snapshot xem trước.
4. Nếu giá thay đổi, trả `PRICE_CHANGED`; chưa ghi bất kỳ biến động nào.
5. Khóa `inventory_balances` và `inventory_cost_balances` theo `product_id` tăng dần.
6. Kiểm tra lại tồn. Nếu thiếu, trả `INSUFFICIENT_STOCK`; toàn bộ giao dịch rollback.
7. Phân bổ giảm giá cho từng dòng.
8. Snapshot đơn giá bán, doanh thu thuần, đơn giá vốn và tổng giá vốn từng dòng.
9. Trừ tồn và giá trị tồn; tạo stock/cost movement.
10. Tạo một payment `CAPTURED` bằng đúng tổng thanh toán, với phương thức tiền mặt hoặc chuyển khoản.
11. Cấp mã `HDxxxxxx`, chuyển hóa đơn thành `COMPLETED`, ghi audit và trả DTO kết quả.

Không nhận giá bán tùy ý từ client khi hoàn tất. Client gửi sản phẩm, số lượng, giảm giá và phương thức; server là nguồn giá bán cuối cùng.

### 7.5 Trả hàng theo hóa đơn gốc

Trạng thái phiếu trả:

```text
DRAFT -> REQUESTED -> COMPLETED
   \-> CANCELLED
REQUESTED -> CANCELLED
```

Quy tắc:

- Phải chọn một hóa đơn `COMPLETED` hoặc `PARTIALLY_RETURNED`.
- Không cho trả từ hóa đơn `DRAFT`, `CANCELLED` hoặc đã `RETURNED` toàn bộ.
- Chỉ cho chọn các dòng thuộc hóa đơn gốc.
- `tổng đã trả hoàn tất + số đang trả <= số đã bán` cho từng dòng.
- Bắt buộc có lý do trả.
- Giá hoàn tiền lấy theo doanh thu thuần đã phân bổ của dòng gốc.
- Giá vốn hoàn lại lấy theo cost snapshot dòng gốc.
- Hàng được chấp nhận luôn tăng lại tồn kho.
- Không cho thêm sản phẩm ngoài hóa đơn gốc.
- Sản phẩm đã ngừng kinh doanh vẫn được trả theo hóa đơn gốc và nhập lại tồn; trạng thái sản phẩm không tự đổi sang hoạt động nên sản phẩm đó vẫn không thể bán tiếp cho đến khi được kích hoạt lại.
- Nhân viên không có `sale.all.read` vẫn được tra đúng một hóa đơn bằng toàn bộ mã hóa đơn để tạo trả hàng. Đây là exact lookup có audit, chỉ trả dữ liệu hóa đơn cần cho việc trả và không hỗ trợ liệt kê/prefix/fuzzy search; cơ chế này không đồng nghĩa được xem danh sách hóa đơn của người khác.

Luồng quyền:

1. Cả Bán hàng & Kho và Kinh doanh có thể tạo yêu cầu `REQUESTED`.
2. Bán hàng & Kho hoặc Chủ cửa hàng có `return.complete` kiểm nhận và hoàn tất.
3. Người hoàn tất có thể giảm số lượng chấp nhận so với yêu cầu nhưng không được tăng; thay đổi phải được audit.
4. Phiếu chỉ được hoàn tất khi có ít nhất một dòng `accepted_qty > 0`; nếu từ chối toàn bộ thì phải chuyển phiếu sang `CANCELLED` và ghi lý do.
5. Chọn hoàn tiền mặt hoặc chuyển khoản; số tiền hoàn đúng bằng giá trị hàng được chấp nhận.
6. Database khóa hóa đơn gốc, các dòng và số dư sản phẩm; kiểm tra tổng trả lũy kế lần cuối.
7. Tạo movement tăng số lượng và tăng giá trị tồn bằng giá vốn gốc được hoàn lại.
8. Tạo refund payment và mã `THxxxxxx`.
9. Cập nhật hóa đơn gốc thành `PARTIALLY_RETURNED` hoặc `RETURNED`.

Nếu Bán hàng & Kho tự khởi tạo, giao diện có thể nối bước tạo yêu cầu và hoàn tất, nhưng database vẫn phải lưu phiếu trả riêng.

### 7.6 Hủy hóa đơn

Chỉ chủ cửa hàng được hủy. Điều kiện:

- Hóa đơn đang `COMPLETED`.
- Chưa có phiếu trả `COMPLETED` nào.
- Bắt buộc nhập lý do.

Hủy tạo biến động đảo toàn bộ:

- Tăng lại số lượng tồn.
- Tăng lại giá trị tồn bằng cost snapshot gốc.
- Đảo payment trong sổ giao dịch.
- Ghi sự kiện doanh thu âm và giá vốn âm tại thời điểm hủy.
- Giữ nguyên hóa đơn với trạng thái `CANCELLED`; không xóa.

### 7.7 Kiểm kho và điều chỉnh

Trạng thái:

```text
DRAFT -> COUNTED -> POSTED
   \-> CANCELLED  \-> CANCELLED
```

1. Bán hàng & Kho hoặc Chủ cửa hàng tạo phiếu kiểm kho.
2. Mỗi dòng snapshot tồn hệ thống và ghi số đếm thực tế.
3. Nhân viên gửi phiếu thành `COUNTED`.
4. Chủ cửa hàng xem chênh lệch và ghi sổ.
5. Database khóa số dư, kiểm tra version/tồn đã thay đổi kể từ lúc đếm.
6. Nếu có thay đổi, trả `STALE_STOCK_COUNT` và yêu cầu đếm/xác nhận lại.
7. Nếu hợp lệ, tạo movement chênh lệch và mã `KKxxxxxx`.

Giảm tồn dùng giá vốn bình quân hiện tại. Tăng tồn dùng giá vốn bình quân hiện tại; nếu sản phẩm đang có số lượng và giá trị bằng 0, chủ cửa hàng bắt buộc nhập đơn giá ước tính cho phần tăng. Số dư đầu kỳ được ghi bằng một phiếu kiểm/điều chỉnh loại `OPENING`, do chủ cửa hàng nhập số lượng và đơn giá đầu kỳ.

## 8. Giá vốn, doanh thu và lợi nhuận

### 8.1 Kiểu số và làm tròn

- Tiền tổng: `numeric(20,2)`.
- Đơn giá nhập/bán: `numeric(18,2)`.
- Đơn giá vốn bình quân/snapshot: `numeric(20,6)`.
- Số lượng: `numeric(18,3)`.
- Không dùng `float` hoặc `double precision` cho tiền và giá vốn.
- Mọi phép tính chính thức thực hiện trong Postgres bằng `numeric`.
- Tổng tiền dòng và giá vốn dòng làm tròn hai chữ số bằng `round(value, 2)`.
- Giao diện VND mặc định hiển thị không có phần thập phân, nhưng database vẫn giữ hai chữ số để tránh sai số khi phân bổ.

### 8.2 Bình quân gia quyền liên hoàn

Trước khi nhập:

- `Q` = số lượng tồn hiện tại.
- `V` = giá trị tồn hiện tại.

Phiếu nhập:

- `q` = số lượng nhập.
- `c` = đơn giá nhập thực tế.
- `receipt_value = round(q × c, 2)`.

Sau khi nhập:

```text
new_qty        = Q + q
new_value      = V + receipt_value
new_avg_cost   = new_value / new_qty
```

Khi bán số lượng `s`:

```text
sale_cogs      = round(s × current_avg_cost, 2)
new_qty        = Q - s
new_value      = V - sale_cogs
```

Nếu bán hết tồn, command ép `new_qty = 0`, `new_value = 0`, `new_avg_cost = 0` để loại bỏ sai số dư. Mỗi dòng hóa đơn lưu cả `unit_cost_snapshot` và `cogs_total_snapshot`.

### 8.3 Ví dụ chuẩn để kiểm thử

| Sự kiện | Số lượng tồn | Giá trị tồn | Giá vốn bình quân | Doanh thu | Giá vốn bán | Lợi nhuận gộp |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Nhập 10 × 40.000 | 10 | 400.000 | 40.000 | 0 | 0 | 0 |
| Nhập 5 × 50.000 | 15 | 650.000 | 43.333,333333 | 0 | 0 | 0 |
| Bán 6 × 60.000 | 9 | 390.000 | 43.333,333333 | 360.000 | 260.000 | 100.000 |
| Trả 1 từ hóa đơn trên | 10 | 433.333,33 | 43.333,333000 | -60.000 | -43.333,33 | -16.666,67 |

Giá trị có thể lệch rất nhỏ ở đơn giá bình quân do làm tròn tổng tiền hai chữ số; total value và snapshot dòng là số liệu đối soát authoritative.

### 8.4 Phân bổ giảm giá và hoàn tiền

Với giảm giá toàn hóa đơn `D` và tổng tiền hàng `S`:

```text
allocated_discount_i = round(D × line_gross_i / S, 2)
line_net_i            = line_gross_i - allocated_discount_i
```

Dòng cuối nhận phần dư để tổng `allocated_discount_i` bằng chính xác `D`.

Khi trả một phần dòng:

```text
refund_i = round(line_net_i × return_qty / sold_qty, 2)
```

Nếu lần trả làm tổng lượng trả đạt toàn bộ lượng bán, lần cuối lấy phần doanh thu thuần còn lại sau các lần hoàn trước. Giá vốn hoàn lại áp dụng cùng nguyên tắc trên `cogs_total_snapshot`; nhờ vậy trả hết luôn đảo đúng toàn bộ doanh thu và giá vốn của dòng.

### 8.5 Báo cáo

Các chỉ tiêu:

```text
gross_sales       = tổng tiền hàng của các sự kiện bán hoàn tất
discounts         = tổng giảm giá đã phân bổ
sales_returns     = tổng tiền hoàn của phiếu trả hoàn tất
cancellations     = giá trị hóa đơn bị hủy
net_revenue       = gross_sales - discounts - sales_returns - cancellations
net_cogs          = sale_cogs - returned_cogs - cancelled_cogs
gross_profit      = net_revenue - net_cogs
gross_margin_pct  = gross_profit / net_revenue × 100, nếu net_revenue != 0
```

Báo cáo theo khoảng ngày dùng thời điểm phát sinh sự kiện:

- Bán hàng theo `completed_at`.
- Trả hàng theo `return_completed_at`.
- Hủy theo `cancelled_at`.

Do đó một hóa đơn bán hôm trước nhưng trả hôm nay ghi doanh thu âm và giá vốn âm vào hôm nay. Không sửa ngược báo cáo ngày bán. Báo cáo phải đối soát từ movement/event ledger, không tính lại bằng giá vốn hiện tại.

Doanh thu cá nhân được quy cho `sales.created_by`. Trả hàng hoặc hủy hóa đơn làm giảm doanh thu của người đã tạo hóa đơn gốc, không quy cho nhân viên thực hiện thao tác trả/hủy.

## 9. Kiến trúc kỹ thuật

### 9.1 Stack

- React + TypeScript + Vite.
- Tailwind CSS.
- React Router cho route.
- TanStack Query cho server state và cache trong memory.
- React Hook Form + Zod cho form/validation phía client.
- Supabase JS dùng publishable key trên frontend.
- `vite-plugin-pwa` hoặc giải pháp tương đương cho manifest/service worker.
- Vitest + Testing Library cho unit/component tests.
- Playwright cho end-to-end.
- Supabase Cloud cho Auth, Postgres, RLS, Database Functions, Storage, Realtime và Edge Functions.
- Vercel cho Preview và Production.

Không khóa phiên bản thư viện trong đặc tả. Khi khởi tạo, dùng bản stable tương thích mới nhất, ghi chính xác trong lockfile và không nâng major version giữa phase nếu chưa kiểm thử hồi quy.

### 9.2 Biên hệ thống

```text
PWA trên Vercel
    |
    |-- Supabase Auth: đăng nhập/session
    |-- Data API + RLS: read model an toàn
    |-- Database RPC: command giao dịch atomically
    |-- Realtime: báo thay đổi tồn để invalidate cache
    |-- Storage private: ảnh sản phẩm
    `-- Edge Function: tạo/khóa/reset tài khoản nhân viên
```

Frontend chỉ chứa:

- `VITE_SUPABASE_URL`.
- `VITE_SUPABASE_PUBLISHABLE_KEY`.

Không đặt service-role/secret key trong Vercel client environment, source map, bundle hoặc repository. Secret quản trị Auth chỉ tồn tại trong Supabase Edge Function secrets.

### 9.3 Tổ chức frontend đề xuất

```text
src/
  app/                 # router, providers, app shell, permission gates
  components/          # UI dùng chung, không chứa nghiệp vụ domain
  features/
    auth/
    dashboard/
    catalog/
    inventory/
    purchases/
    sales/
    returns/
    reports/
    staff/
    settings/
  lib/
    supabase/           # client, generated types, RPC adapters
    money/              # chỉ format; phép tính chính thức ở database
    errors/             # map mã lỗi sang tiếng Việt
  stores/               # cart/draft UI state không nhạy cảm
  test/
```

Mỗi feature chia rõ:

- UI/components.
- Query/read adapters.
- Command adapters.
- Schema/type phía client.
- Tests.

Không đặt phép tính giá vốn hoặc quyền authoritative trong frontend.

## 10. Mô hình dữ liệu

### 10.1 Quy ước chung

- Tên schema/table/cột dùng `snake_case` chữ thường.
- Primary key nghiệp vụ dùng UUID với `gen_random_uuid()`, trừ sequence nội bộ.
- Thời gian dùng `timestamptz` và lưu UTC; hiển thị theo `Asia/Ho_Chi_Minh`.
- Mọi foreign key phải có index phù hợp.
- Trạng thái dùng `text` với check constraint rõ ràng để migration linh hoạt.
- Chứng từ tài chính không hard delete.
- Bảng exposed phải bật RLS và chỉ cấp grant tối thiểu.
- View exposed phải có `security_invoker = true`.
- Dữ liệu giá vốn đặt trong schema private không expose qua Data API.
- Hệ thống một cửa hàng nên không thêm `tenant_id`/`store_id` vào mọi bảng. `store_settings` có đúng một dòng cấu hình.

Các bảng nghiệp vụ dùng chung các cột audit phù hợp: `created_at`, `updated_at`, `created_by`, `updated_by`. Chứng từ có thêm thời điểm và actor tương ứng từng chuyển trạng thái.

### 10.2 Schema `public` — dữ liệu có thể expose qua RLS

#### Tài khoản và quyền

`profiles`

- `id uuid primary key references auth.users(id)`.
- `email text not null`.
- `display_name text not null`.
- `phone text null`.
- `role_template text not null check (...)`.
- `is_active boolean not null default true`.
- `must_change_password boolean not null default true`.
- `last_login_at timestamptz null`.
- `created_by uuid null references profiles(id)`.
- Timestamps.

`permission_definitions`

- `code text primary key`.
- `category text not null`.
- `label text not null`.
- `owner_only boolean not null default false`.
- `description text not null`.

`role_default_permissions`

- `role_template text`.
- `permission_code text references permission_definitions(code)`.
- `allowed boolean not null`.
- Primary key `(role_template, permission_code)`.

`user_permission_overrides`

- `user_id uuid references profiles(id)`.
- `permission_code text references permission_definitions(code)`.
- `effect text check (effect in ('GRANT','REVOKE'))`.
- `changed_by uuid references profiles(id)`.
- Timestamps.
- Primary key `(user_id, permission_code)`.

Database từ chối `GRANT` nếu permission là `owner_only` và target không phải `OWNER`.

#### Danh mục

`categories`

- `id uuid primary key`.
- `name text not null` và `name_normalized text not null unique`.
- `is_active boolean not null default true`.
- Audit columns.

`products`

- `id uuid primary key`.
- `sku text not null`, `sku_normalized text not null unique`.
- `barcode text null` với partial unique khi không null/rỗng.
- `name text not null`, `name_normalized text not null`.
- `category_id uuid null references categories(id)`.
- `unit_name text not null`.
- `description text null`.
- `specifications jsonb not null default '{}'::jsonb` và phải là JSON object.
- `min_stock_qty numeric(18,3) not null default 0 check (min_stock_qty >= 0)`.
- `is_active boolean not null default true`.
- `version bigint not null default 1`.
- Audit columns.

`product_images`

- `id uuid primary key`.
- `product_id uuid not null references products(id)`.
- `object_path text not null unique`.
- `sort_order integer not null default 0`.
- `is_primary boolean not null default false`.
- `uploaded_by uuid references profiles(id)`.
- `created_at timestamptz`.
- Tối đa năm ảnh/sản phẩm và tối đa một ảnh primary, được enforce bằng command/constraint phù hợp.

`product_sale_prices`

- `id uuid primary key`.
- `product_id uuid not null references products(id)`.
- `sale_price numeric(18,2) not null check (sale_price >= 0)`.
- `valid_from timestamptz not null`.
- `valid_to timestamptz null check (valid_to is null or valid_to > valid_from)`.
- `changed_by uuid not null references profiles(id)`.
- `change_reason text null`.
- Partial unique index bảo đảm tối đa một dòng `valid_to is null` cho mỗi sản phẩm.

`suppliers` và `customers`

- UUID primary key.
- Mã tùy chọn, tên bắt buộc, điện thoại/email/địa chỉ/ghi chú tùy chọn.
- `is_active boolean`.
- Audit columns.
- Khách mặc định “Khách lẻ” được biểu diễn bằng `customer_id null`, không cần một auth user.

#### Tồn kho

`inventory_balances`

- `product_id uuid primary key references products(id)`.
- `on_hand_qty numeric(18,3) not null default 0 check (on_hand_qty >= 0)`.
- `version bigint not null default 0`.
- `updated_at timestamptz not null`.

Bảng này tuyệt đối không chứa giá trị hoặc giá vốn để nhân viên có thể đọc số lượng an toàn qua RLS.

`stock_movements`

- `id uuid primary key`.
- `product_id uuid not null references products(id)`.
- `movement_type text not null check (...)` gồm `OPENING`, `PURCHASE_RECEIPT`, `PURCHASE_REVERSAL`, `SALE`, `SALE_RETURN`, `SALE_CANCEL`, `STOCK_ADJUSTMENT`.
- `quantity_delta numeric(18,3) not null check (quantity_delta <> 0)`.
- `quantity_after numeric(18,3) not null check (quantity_after >= 0)`.
- `reference_type text not null` và `reference_id uuid not null`.
- `occurred_at timestamptz not null`.
- `actor_id uuid not null references profiles(id)`.
- `note text null`.

`stock_counts`

- UUID, `count_number text unique null` trước khi post.
- `status text` gồm `DRAFT`, `COUNTED`, `POSTED`, `CANCELLED`.
- `counted_at`, `submitted_at`, `posted_at`, actor tương ứng, reason/note và audit columns.

`stock_count_lines`

- `stock_count_id`, `product_id` với unique theo cặp.
- `system_qty_snapshot`, `inventory_version_snapshot`, `counted_qty`, `difference_qty`.
- Không chứa đơn giá hoặc giá trị tồn.

#### Nhập hàng

`purchase_receipts`

- UUID và `receipt_number text unique null` đến lúc post.
- `status text` gồm `DRAFT`, `AWAITING_COST`, `POSTED`, `REVERSED`, `CANCELLED`.
- `supplier_id uuid null`.
- `received_at timestamptz not null`.
- `note`, actor/timestamps cho submit, post, reverse và audit columns.
- `idempotency_key uuid null` với unique phù hợp theo actor/command.

`purchase_receipt_lines`

- UUID, `purchase_receipt_id`, `product_id`.
- Snapshot `product_name`, `sku`, `unit_name`.
- `received_qty numeric(18,3) check (received_qty > 0)`.
- Unique `(purchase_receipt_id, product_id)` trong MVP.
- Không có giá nhập trong schema public.

#### Bán hàng

`sales`

- UUID và `sale_number text unique null` đến lúc hoàn tất.
- `status text` gồm `DRAFT`, `COMPLETED`, `PARTIALLY_RETURNED`, `RETURNED`, `CANCELLED`.
- `customer_id uuid null`.
- `subtotal numeric(20,2) not null default 0`.
- `discount_total numeric(20,2) not null default 0`.
- `net_total numeric(20,2) not null default 0`.
- `note text null`.
- `created_by`, `completed_by`, `completed_at`, `cancelled_by`, `cancelled_at`, `cancel_reason`.
- `idempotency_key uuid null`.
- Audit columns.

`sale_lines`

- UUID, `sale_id`, `product_id`.
- Snapshot `product_name`, `sku`, `unit_name`.
- `quantity numeric(18,3) check (quantity > 0)`.
- `unit_sale_price numeric(18,2) check (unit_sale_price >= 0)`.
- `gross_amount`, `allocated_discount`, `net_amount` dạng `numeric(20,2)`.
- Unique `(sale_id, product_id)` trong MVP.

`payments`

- UUID, `sale_id`.
- `method text check (method in ('CASH','BANK_TRANSFER'))`.
- `amount numeric(20,2) check (amount >= 0)`.
- `status text check (status in ('CAPTURED','REVERSED'))`.
- `paid_at`, `reversed_at`, actor và reference đảo.
- Mỗi hóa đơn hoàn tất có đúng một payment captured trong MVP.

#### Trả hàng

`sale_returns`

- UUID, `return_number text unique null`.
- `original_sale_id uuid not null references sales(id)`.
- `status text` gồm `DRAFT`, `REQUESTED`, `COMPLETED`, `CANCELLED`.
- `reason text not null` trước khi request.
- `refund_total numeric(20,2) not null default 0`.
- Actor/timestamps cho request, complete, cancel.
- `idempotency_key uuid null`.
- Audit columns.

`sale_return_lines`

- UUID, `sale_return_id`, `original_sale_line_id`, `product_id`.
- `requested_qty numeric(18,3) check (requested_qty > 0)`.
- `accepted_qty numeric(18,3) null check (accepted_qty >= 0)`.
- `refund_amount numeric(20,2) not null default 0`.
- Snapshot tên/SKU/đơn vị từ dòng gốc.
- Unique `(sale_return_id, original_sale_line_id)`.

`sale_return_payments`

- UUID, `sale_return_id unique`.
- `method text` gồm `CASH`, `BANK_TRANSFER`.
- `amount numeric(20,2)`.
- `status text` gồm `REFUNDED`, `REVERSED`.
- Timestamps và actor.

#### Hệ thống

`store_settings`

- `id smallint primary key check (id = 1)`.
- Tên cửa hàng, logo path, địa chỉ, điện thoại.
- `currency text not null default 'VND' check (currency = 'VND')`.
- `timezone text not null default 'Asia/Ho_Chi_Minh'`.
- Cấu hình prefix chứng từ và audit columns.

`document_sequences`

- `document_type text primary key` gồm `SALE`, `PURCHASE_RECEIPT`, `SALE_RETURN`, `STOCK_COUNT`.
- `prefix text not null` lần lượt `HD`, `PN`, `TH`, `KK`.
- `last_value bigint not null default 0`.
- Cấp số bằng update/lock atomically trong transaction; không dùng `max(number) + 1`.

`audit_events`

- UUID.
- `actor_id`, `action`, `entity_type`, `entity_id`.
- `before_data jsonb`, `after_data jsonb`, `metadata jsonb`.
- `occurred_at`, request/correlation ID.
- Chỉ chủ cửa hàng đọc; dữ liệu cost trong audit phải được bảo vệ tương đương cost tables.

### 10.3 Schema `app_private` — không expose qua Data API

`purchase_receipt_line_costs`

- `purchase_receipt_line_id uuid primary key`.
- `unit_cost numeric(18,2) not null check (unit_cost >= 0)`.
- `line_cost numeric(20,2) not null check (line_cost >= 0)`.
- Actor/timestamps.

`stock_count_line_costs`

- `stock_count_line_id uuid primary key`.
- `opening_unit_cost numeric(18,2) not null check (opening_unit_cost >= 0)`.
- Chỉ tồn tại cho dòng tăng tồn khi số dư trước đó bằng 0; chỉ command owner-only được đọc/ghi.

`inventory_cost_balances`

- `product_id uuid primary key`.
- `inventory_value numeric(20,2) not null default 0 check (inventory_value >= 0)`.
- `avg_unit_cost numeric(20,6) not null default 0 check (avg_unit_cost >= 0)`.
- `version bigint not null default 0`.
- `updated_at timestamptz`.

`sale_line_costs`

- `sale_line_id uuid primary key`.
- `unit_cost_snapshot numeric(20,6)`.
- `cogs_total_snapshot numeric(20,2)`.

`sale_return_line_costs`

- `sale_return_line_id uuid primary key`.
- `returned_cogs numeric(20,2)`.

`inventory_cost_movements`

- `stock_movement_id uuid primary key`.
- `inventory_value_delta numeric(20,2)`.
- `cogs_delta numeric(20,2)`.
- `inventory_value_after numeric(20,2)`.
- `avg_unit_cost_after numeric(20,6)`.
- Reference và timestamp phục vụ đối soát.

`command_deduplication`

- `idempotency_key uuid`.
- `command_name text`.
- `actor_id uuid`.
- `status text` và `result jsonb`.
- Unique `(actor_id, command_name, idempotency_key)`.

Các report/read function của chủ cửa hàng đọc schema này sau khi kiểm tra `OWNER` và `report.cost_profit.read`. Không cấp `SELECT` trực tiếp cho `anon` hoặc `authenticated`.

### 10.4 Read models

Read model public được phép gồm:

- `product_catalog_read`: sản phẩm + giá bán hiện hành + tồn số lượng, tuyệt đối không có cost.
- `my_sales_read`: hóa đơn thuộc actor, trừ khi actor có `sale.all.read`.
- `operational_purchase_read`: phiếu nhập và số lượng, không có giá.

Mọi view exposed dùng `security_invoker = true`. Báo cáo cost/profit không tạo view public; dùng RPC được bảo vệ và chỉ trả DTO cho chủ cửa hàng.

## 11. Database commands và interface

### 11.1 Nguyên tắc chung

- Frontend không tự chạy chuỗi insert/update nhiều bảng cho nghiệp vụ ghi sổ.
- Command public là wrapper có chữ ký rõ ràng; logic đặc quyền nằm trong `app_private`, đặt `security definer set search_path = ''`, dùng tên schema đầy đủ và kiểm tra actor bên trong.
- Revoke execute mặc định khỏi `public`/`anon`; chỉ grant từng function cho `authenticated` khi cần.
- Không nhận `actor_user_id` từ client; actor luôn là `(select auth.uid())`.
- Mỗi command kiểm tra `profiles.is_active`, quyền hiệu lực, trạng thái chứng từ và idempotency.
- Khóa balance theo `product_id` tăng dần để tránh deadlock.
- Transaction không thực hiện HTTP hoặc tác vụ chậm bên ngoài.

### 11.2 Command bắt buộc

| Interface | Trách nhiệm |
| --- | --- |
| `get_my_session_context()` | Profile hoạt động, vai trò và danh sách quyền hiệu lực |
| `set_product_sale_price(...)` | Chủ cửa hàng đóng giá cũ và tạo giá hiện hành mới |
| `save_sale_draft(...)` | Tạo/cập nhật hóa đơn nháp của actor |
| `complete_sale(p_sale_id, p_payment_method, p_idempotency_key)` | Hoàn tất bán, trừ kho, snapshot giá vốn, tạo payment |
| `lookup_sale_for_return(p_full_sale_number)` | Exact lookup một hóa đơn để trả hàng, không cấp quyền duyệt danh sách |
| `create_sale_return_request(...)` | Tạo yêu cầu trả từ hóa đơn gốc |
| `complete_sale_return(p_return_id, p_lines, p_refund_method, p_idempotency_key)` | Hoàn tiền và nhập lại kho |
| `cancel_sale(p_sale_id, p_reason, p_idempotency_key)` | Chủ cửa hàng đảo hóa đơn chưa trả |
| `save_purchase_receipt_draft(...)` | Lưu phiếu nhập/số lượng không cost |
| `submit_purchase_receipt(p_receipt_id)` | Chuyển sang chờ chủ nhập giá |
| `post_purchase_receipt(p_receipt_id, p_cost_lines, p_idempotency_key)` | Ghi sổ nhập và tính lại bình quân |
| `reverse_purchase_receipt(p_receipt_id, p_reason, p_idempotency_key)` | Đảo phiếu khi thỏa điều kiện chặt |
| `save_stock_count(...)` | Lưu số đếm và version snapshot |
| `submit_stock_count(p_count_id)` | Chuyển phiếu sang chờ chốt |
| `post_stock_count(p_count_id, p_opening_costs, p_idempotency_key)` | Chủ cửa hàng ghi chênh lệch |
| `get_my_sales_summary(p_from, p_to)` | Doanh thu/hóa đơn của actor |
| `get_owner_dashboard(p_from, p_to)` | Chỉ số doanh thu, cost, profit, inventory value |
| `get_profit_report(p_from, p_to, p_cursor, p_limit)` | Báo cáo chi tiết owner-only |
| `get_inventory_valuation(p_cursor, p_limit)` | Tồn và giá trị owner-only |

Các command trả envelope thống nhất:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "correlationId": "uuid"
}
```

hoặc:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Tồn kho không đủ để hoàn tất hóa đơn.",
    "details": {}
  },
  "correlationId": "uuid"
}
```

Idempotency trùng của một command đã thành công phải trả lại cùng ID/số chứng từ, không tạo chứng từ mới.

### 11.3 Edge Functions quản trị tài khoản

- `create-employee`.
- `deactivate-employee`.
- `reactivate-employee`.
- `reset-employee-password`.

Mỗi function xác minh user JWT, kiểm tra active owner trong database, validate payload và chỉ sau đó mới dùng admin client. Không tin `user_metadata` để quyết định quyền. Không có endpoint tạo owner công khai.

## 12. Bảo mật Supabase

### 12.1 RLS và grants

- Bật RLS trên mọi bảng trong schema exposed.
- `anon` không có quyền đọc/ghi dữ liệu nghiệp vụ.
- `authenticated` chỉ nhận grant tối thiểu cho table/view/function cần dùng.
- Mọi policy bắt đầu bằng kiểm tra user tồn tại và `is_active = true`.
- Dùng `(select auth.uid())` để tránh tính lại theo từng row.
- Index các cột dùng trong RLS như `created_by`, `user_id`, `status`.
- UPDATE phải có cả SELECT policy phù hợp.
- Authorization authoritative nằm trong database tables, không lấy từ `raw_user_meta_data`.
- View exposed dùng `security_invoker = true`.
- Security-definer function không đặt trong exposed schema; đặt `search_path = ''`, schema-qualify mọi object và audit kỹ quyền execute.

### 12.2 Chống lộ giá vốn

RLS không bảo vệ theo cột một cách đủ an toàn cho thiết kế này. Vì vậy:

- Giá nhập không nằm trong `public.purchase_receipt_lines`.
- Giá vốn tồn không nằm trong `public.inventory_balances`.
- Cost snapshot không nằm trong `public.sale_lines`.
- Cost/profit nằm trong `app_private` không expose.
- RPC nhân viên không bao giờ trả khóa JSON liên quan cost, kể cả giá trị null.
- Kiểm thử trực tiếp bằng publishable key + JWT của từng vai trò phải chứng minh không thể truy cập cost tables/functions.

### 12.3 Storage

Tạo bucket private `product-images`:

- Chỉ authenticated active user có `catalog.read` được tải ảnh.
- Chỉ user có `catalog.basic.manage` được insert/update/delete object của sản phẩm.
- Nếu dùng upsert phải có đủ policy `INSERT`, `SELECT`, `UPDATE`.
- Giới hạn loại file JPEG, PNG, WebP; tối đa 5 MB/file.
- Object path không chứa tên file do người dùng tin cậy; dùng `products/{product_id}/{uuid}.{ext}`.
- Metadata trong `product_images` chỉ tạo sau khi upload thành công.
- Nếu ghi metadata thất bại, client/cleanup job xóa object mồ côi; nếu upload thất bại, sản phẩm vẫn có thể lưu không ảnh.

### 12.4 Session và thiết bị dùng chung

- Đăng xuất xóa query cache, cart/draft local và signed URL đang giữ trong memory.
- Không persist báo cáo giá vốn/lợi nhuận vào IndexedDB, localStorage hoặc service-worker cache.
- Draft cart có thể lưu cục bộ theo `user_id`, chỉ gồm product ID, số lượng, giá xem trước và ghi chú; phải xóa khi đổi user.
- Command luôn kiểm tra trạng thái user trong database để không phụ thuộc JWT quyền cũ.

## 13. Đồng thời, idempotency và tính nhất quán

### 13.1 Thứ tự lock

Mọi command nhiều sản phẩm theo thứ tự:

1. Xác nhận/deduplicate request.
2. Lock chứng từ gốc nếu có.
3. Lock tất cả `inventory_balances` và `inventory_cost_balances` theo `product_id asc`.
4. Kiểm tra invariant và ghi movement.
5. Cấp số chứng từ bằng row sequence tương ứng.
6. Commit và trả kết quả.

Tất cả command dùng cùng thứ tự để ngăn deadlock. Transaction phải ngắn; không upload ảnh, gọi Edge Function hoặc tạo PDF trong transaction.

### 13.2 Các invariant bắt buộc

- `on_hand_qty >= 0` sau mọi movement.
- `inventory_value >= 0`, ngoại trừ sai số tối đa 0,01 được normalize về 0 khi hết hàng.
- Một sản phẩm có tối đa một giá bán hiện hành.
- Một dòng sản phẩm tối đa một lần trong cùng chứng từ MVP.
- Tổng payment captured bằng `sale.net_total`.
- Tổng accepted return lũy kế không vượt lượng bán.
- Tổng refund bằng tổng refund lines.
- Khi trả hết, doanh thu/cost hoàn lũy kế bằng đúng snapshot gốc.
- Chứng từ `POSTED/COMPLETED/RETURNED/CANCELLED/REVERSED` là immutable ngoài trường audit do command hợp lệ cập nhật.
- Mỗi command idempotent chỉ tạo tối đa một kết quả.

## 14. Realtime, cache và offline

- Realtime dùng để nhận thay đổi tồn/sản phẩm và invalidate TanStack Query cache; không coi payload Realtime là nguồn tồn authoritative.
- Trước khi hoàn tất bán/trả/nhập/kiểm kho, database luôn đọc và khóa số dư mới nhất.
- PWA cache app shell, icon và asset tĩnh.
- Có thể cache trong memory danh sách sản phẩm/tồn phục vụ đọc nhanh.
- Khi offline, hiển thị banner rõ ràng; cho tìm dữ liệu đã cache và sửa draft cart không nhạy cảm.
- Không cho Thanh toán, Ghi sổ nhập, Hoàn tất trả hàng, Hủy hóa đơn hoặc Chốt kiểm kho khi offline.
- Khi kết nối lại, không tự động submit giao dịch tài chính; người dùng phải xem lại và xác nhận.

## 15. Xử lý lỗi

Mã lỗi nghiệp vụ tối thiểu:

| Mã | Ý nghĩa và phản ứng UI |
| --- | --- |
| `AUTH_REQUIRED` | Chuyển về đăng nhập |
| `ACCOUNT_INACTIVE` | Đăng xuất và báo tài khoản đã khóa |
| `PERMISSION_DENIED` | Báo không có quyền, không hiển thị dữ liệu nhạy cảm |
| `INVALID_STATE` | Refresh chứng từ vì trạng thái đã thay đổi |
| `PRICE_CHANGED` | Cập nhật giá giỏ và yêu cầu xác nhận lại |
| `INSUFFICIENT_STOCK` | Nêu sản phẩm và tồn mới, giữ giỏ để sửa |
| `RETURN_QTY_EXCEEDED` | Refresh số lượng còn được trả |
| `RETURN_NOTHING_ACCEPTED` | Không cho hoàn tất phiếu khi mọi số lượng chấp nhận đều bằng 0 |
| `ORIGINAL_INVOICE_REQUIRED` | Buộc quay lại chọn hóa đơn gốc |
| `STALE_STOCK_COUNT` | Yêu cầu cập nhật/đếm lại vì tồn đã đổi |
| `DUPLICATE_REQUEST` | Đọc lại kết quả idempotent đã có |
| `NETWORK_OUTCOME_UNKNOWN` | Tra theo idempotency key trước khi cho thử lại |
| `VALIDATION_ERROR` | Hiển thị lỗi theo trường bằng tiếng Việt |

Mọi lỗi command phải rollback toàn bộ. Log kỹ thuật dùng correlation ID; thông báo cho nhân viên không chứa SQL, stack trace, cost hoặc thông tin quyền nội bộ.

## 16. Tìm kiếm, phân trang và hiệu năng

- Chuẩn hóa SKU/mã vạch tại database; tìm chính xác trước, sau đó tìm tên.
- Với quy mô nhỏ, tìm tên server-side bằng chuỗi normalized. Chỉ bật `pg_trgm`/`unaccent` nếu đã xác minh extension trên Supabase Cloud và có nhu cầu tìm không dấu/fuzzy.
- Dùng cursor `(created_at, id)` hoặc khóa tương đương cho sản phẩm, hóa đơn, movement và báo cáo.
- Trang mặc định 30–50 dòng; không tải toàn bộ lịch sử.
- Index tối thiểu:
  - Unique SKU normalized và barcode.
  - Product name normalized/category/active.
  - Mọi foreign key.
  - `sales(created_by, completed_at desc, id desc)`.
  - `sales(status, completed_at desc, id desc)`.
  - `sale_returns(original_sale_id, status)`.
  - `stock_movements(product_id, occurred_at desc, id desc)`.
  - Các cột actor/quyền dùng trong RLS.
- Tránh N+1 bằng read model hoặc query quan hệ có giới hạn.
- Mục tiêu UX với dữ liệu tối đa 10.000 sản phẩm và 100.000 hóa đơn: danh sách đầu tiên hiển thị trong khoảng 2,5 giây trên mạng 4G ổn định; thao tác thêm giỏ phản hồi dưới 100 ms vì dùng state cục bộ.

## 17. UI/UX và khả năng sử dụng

- Mobile-first, hỗ trợ safe-area iOS và bàn phím số.
- Touch target tối thiểu khoảng 44 px.
- Giá và tổng tiền căn phải, dùng format `vi-VN`.
- Trạng thái dùng cả chữ và màu, không chỉ dựa vào màu.
- Loading dùng skeleton; danh sách dài giữ vị trí cuộn.
- Nút hành động ghi sổ có bước xác nhận, disable khi đang gửi và vẫn có idempotency server-side.
- Giỏ bán hàng giữ thanh tổng và nút Thanh toán cố định ở đáy.
- Màn trả hàng hiển thị `đang trả / đã mua` cho từng dòng.
- Màn nhân viên giải thích quyền mặc định và override để chủ cửa hàng hiểu thay đổi.
- Ảnh sản phẩm có placeholder riêng của ứng dụng.
- Không sao chép logo, icon độc quyền, tên hoặc thông báo nâng cấp từ ứng dụng tham khảo.
- Bản in/chia sẻ là chứng từ nội bộ, có tên cửa hàng, mã, ngày, dòng hàng, tổng tiền, phương thức và ghi chú; không tuyên bố là hóa đơn điện tử/thuế.

## 18. Kiểm thử bắt buộc

### 18.1 Unit tests

- Giá bình quân sau nhiều lần nhập giá khác nhau.
- Bán một phần, bán hết và normalize số dư về 0.
- Phân bổ giảm giá có phần dư làm tròn.
- Trả một phần nhiều lần và trả hết.
- Hủy hóa đơn đảo đúng doanh thu/cost/tồn.
- Đảo phiếu nhập đúng điều kiện.
- Quyền hiệu lực từ role + grant - revoke và chặn owner-only grant.
- Format số lượng/tiền và mapping mã lỗi.

### 18.2 Database integration trên Supabase Cloud staging

Không dùng Supabase local hoặc Docker. Test migrations/RPC/RLS trên Supabase Cloud staging cấu hình bằng environment riêng.

- Mỗi vai trò gọi trực tiếp Data API bằng JWT thật.
- Nhân viên thử select cost tables, cost functions và owner reports; tất cả phải bị từ chối.
- Tài khoản vừa bị khóa thử gọi query và command bằng token cũ; phải bị từ chối.
- Hai session bán đồng thời số lượng cuối; chỉ một thành công.
- Hai lần submit cùng idempotency key; chỉ một hóa đơn.
- Hai phiếu trả đồng thời cùng dòng; tổng hoàn không vượt lượng bán.
- Kiểm tra sequence không trùng khi concurrent.
- Kiểm tra rollback không để document/movement/payment dở dang.
- Kiểm tra Storage theo quyền và MIME/size.

### 18.3 End-to-end

- Owner đăng nhập, tạo hai loại nhân viên và đổi quyền.
- Bán hàng & Kho tạo sản phẩm, tải ảnh, lập phiếu nhập; không thấy cost.
- Owner nhập cost và post receipt.
- Kinh doanh tìm/quét sản phẩm, bán hàng, xem doanh thu của mình.
- Nhân viên khác không xem hóa đơn của người trước nếu chưa được cấp quyền.
- Trả một phần theo hóa đơn gốc, kiểm tra tồn tăng.
- Kinh doanh tạo yêu cầu trả nhưng không hoàn tất mặc định.
- Bán hàng & Kho hoàn tất yêu cầu trả.
- Owner thấy báo cáo doanh thu/cost/profit đối soát đúng.
- Owner hủy hóa đơn hợp lệ và bị chặn khi hóa đơn đã trả.
- Bán hàng & Kho kiểm kho; owner post.
- Offline banner và khóa mọi nút ghi sổ.
- Giao diện mobile và desktop, gồm PWA installability.

### 18.4 Quality gates

- TypeScript không lỗi.
- Lint không lỗi.
- Unit/integration/E2E trọng yếu pass.
- Production build pass.
- Supabase database/security advisors không còn lỗi critical liên quan schema mới.
- Không có secret trong git hoặc client bundle.
- Không có bảng exposed thiếu RLS.
- Không có security-definer function exposed sai schema/search path/quyền execute.

## 19. Tiêu chí nghiệm thu MVP

MVP chỉ được nghiệm thu khi:

1. Chủ cửa hàng tạo, khóa, đổi role và tùy chỉnh quyền vận hành cho nhân viên.
2. Nhân viên mới mặc định là Bán hàng & Kho.
3. Ba role hoạt động đúng ma trận và owner-only permissions không thể cấp cho nhân viên.
4. Danh sách hiển thị tổng số sản phẩm và tồn hiện tại của từng sản phẩm, không có lô/hạn dùng.
5. Nhân viên xem được giá bán nhưng không thể đọc giá nhập, giá vốn, giá trị tồn hoặc lợi nhuận qua UI lẫn API trực tiếp.
6. Phiếu nhập hai bước cập nhật đúng số lượng, total value và giá vốn bình quân.
7. Không thể bán vượt tồn, kể cả hai thiết bị thao tác đồng thời.
8. Giá bán và cost snapshot của hóa đơn cũ không đổi khi giá hiện hành đổi.
9. Mỗi hóa đơn hoàn tất có payment đủ bằng tiền mặt hoặc chuyển khoản.
10. Trả hàng luôn yêu cầu hóa đơn gốc, hỗ trợ partial/full và không vượt lượng mua.
11. Hàng trả được chấp nhận tăng lại kho và hoàn đúng revenue/cost snapshot.
12. Hủy hóa đơn chỉ owner, có lý do, không cho hủy hóa đơn đã trả và tạo đảo sổ đầy đủ.
13. Báo cáo owner đối soát được `net revenue - net COGS = gross profit`.
14. Báo cáo nhân viên chỉ chứa doanh thu của bản thân theo quyền.
15. Chứng từ hoàn tất immutable và có audit.
16. Duplicate submit không tạo chứng từ trùng.
17. Ứng dụng deploy Vercel, chạy responsive và cài được như PWA.
18. Giao dịch ghi sổ bị khóa khi offline.

## 20. Thứ tự triển khai khuyến nghị

### Phase 0 — Nền tảng

- Tạo repository mới, React/Vite/TypeScript/Tailwind/PWA.
- Thiết lập Supabase Cloud staging và production, Vercel Preview/Production.
- Quy ước migrations, generated types, lint/test/build và CI.
- App shell, design tokens, error envelope và logging correlation ID.

### Phase 1 — Auth và quyền

- Profiles, permission tables, helpers RLS và session context.
- Login/logout/must-change-password.
- Edge Functions quản trị nhân viên.
- Màn nhân viên và ma trận quyền.
- RLS negative tests trước khi làm nghiệp vụ tài chính.

### Phase 2 — Catalog và tồn nền

- Categories, products, ảnh private, giá bán lịch sử.
- Inventory quantity/cost balances và movement ledgers.
- Import sản phẩm/số dư đầu kỳ bằng command owner-only.
- Danh sách, tìm kiếm, chi tiết và Realtime invalidation.

### Phase 3 — Nhập hàng và giá vốn

- Purchase draft/awaiting cost/post/reverse.
- Moving weighted-average functions và test vectors.
- Owner-only cost reads và inventory valuation.

### Phase 4 — POS và hóa đơn

- Cart, save draft, discount allocation, complete sale.
- Payments, invoice list/detail, print/share nội bộ.
- Concurrency/idempotency tests.

### Phase 5 — Trả, hủy và kiểm kho

- Return request/completion theo hóa đơn gốc.
- Cancel sale reversal.
- Stock count/opening/adjustment.
- Toàn bộ reconciliation tests.

### Phase 6 — Báo cáo và bàn giao

- Dashboard theo role, owner profit report, inventory valuation.
- E2E, security audit, performance check và UAT.
- Import dữ liệu thật, deploy production, backup/runbook và hướng dẫn vận hành.

Mỗi phase phải tạo phần mềm chạy được và kiểm thử độc lập. Không để toàn bộ RLS, concurrency hoặc kiểm thử đến cuối dự án.

## 21. Triển khai Cloud và vận hành

- Dùng Supabase Cloud; không dùng Supabase local và không dùng Docker.
- Development/test automation trỏ vào project Cloud staging, không chạy test phá dữ liệu trên production.
- Migration SQL được lưu trong git, chạy staging trước và production sau khi backup/review.
- Vercel Preview dùng staging URL/key; Vercel Production dùng production URL/key.
- Chỉ public URL/publishable key ở frontend. Edge Function secrets cấu hình trong Supabase.
- Có seed tạo `store_settings`, permission definitions, role defaults và owner profile đầu tiên theo quy trình bảo mật riêng.
- Dữ liệu sản phẩm ban đầu có thể import CSV; ảnh import riêng và liên kết bằng SKU.
- Trước go-live phải có snapshot/backup dữ liệu và quy trình phục hồi. Backup database của Supabase không bao gồm object Storage, vì vậy ảnh sản phẩm cần chiến lược sao lưu/xuất riêng nếu được coi là dữ liệu bắt buộc.
- Có runbook cho: khóa nhân viên, reset mật khẩu, kiểm tra giao dịch outcome unknown, đối soát tồn, đảo chứng từ hợp lệ và phục hồi sự cố.

## 22. Definition of Done

- Tất cả migrations đã áp dụng và xác minh trên Supabase Cloud staging.
- Schema, RLS, grants, functions và Storage policies qua security review.
- Cost/profit không thể truy cập bởi JWT nhân viên trong negative tests.
- Công thức ở mục 8 qua test chính xác.
- Tất cả flow E2E trọng yếu qua trên viewport mobile và desktop.
- Không còn placeholder, mock response hoặc bypass quyền trong production build.
- README mới mô tả setup Cloud, environment variables, migration/deploy/test và account bootstrap.
- `.env.example` chỉ chứa tên biến, không chứa giá trị bí mật.
- Vercel Preview và Production build thành công.
- Owner hoàn thành UAT theo 18 tiêu chí nghiệm thu.
- Có tài liệu vận hành và danh sách giới hạn MVP.

## 23. Nguồn kỹ thuật chính thức cần đối chiếu khi triển khai

- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Database Functions: https://supabase.com/docs/guides/database/functions
- Supabase Data API security: https://supabase.com/docs/guides/api/securing-your-api
- Supabase Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase private/public buckets: https://supabase.com/docs/guides/storage/buckets/fundamentals
- Supabase Edge Function authentication: https://supabase.com/docs/guides/functions/auth
- Supabase database/extensions: https://supabase.com/docs/guides/database/extensions

Các API Supabase có thể thay đổi. Codex triển khai phải kiểm tra tài liệu chính thức hiện hành trước khi chốt syntax, config hoặc thư viện, nhưng không được thay đổi các invariant nghiệp vụ trong đặc tả này.
