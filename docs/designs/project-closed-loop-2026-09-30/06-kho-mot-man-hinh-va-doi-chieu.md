# Kho một màn hình + đối chiếu phiếu treo

Ngày: 30/09/2026 · Mockup: `.superpowers/review/work-plan/wms-mockup.html` (chạy `project-loop`, cổng 5181; `?view=doichieu` để mở màn đối chiếu).

## 1. Vấn đề hiện tại (màn Nghiệp vụ kho)

- 5 tab ngang: Nhập / Xuất vật tư / Chuyển / Thanh lý / Quản lý phiếu. Form lập phiếu và danh sách phiếu cần xử lý nằm ở hai nơi khác nhau. "Quản lý phiếu" lại có 2 tab con: hàng đợi và lịch sử.
- Nhận hàng mua theo PO có 2 bước, mỗi bước là một hộp thoại đếm ngược:
  1. Thủ kho kiểm SL/CL.
  2. Xác nhận nhập kho.
- Dữ liệu thật cho thấy hậu quả:
  - PO-259 đợt 1 (thép, 776 triệu) đã được kiểm ngày 31/07 nhưng chưa bao giờ nhập kho.
  - 5 phiếu nhập khác cũng dừng ở bước 1.
  - 15/20 phiếu treo nằm ở Kho Sơn Miền Bắc, lâu nhất 69 ngày.

## 2. Học từ FastCons

- Danh sách gọn, mã phiếu và NCC màu xanh (link), bấm vào để mở phiếu ngay tại chỗ.
- Form một màn:
  - Trái: lưới hàng hóa, có tìm nhanh và Excel, cảnh báo tồn kho ngay trên dòng.
  - Phải: thông tin chung.
  - Nút "Xác nhận" ở góc.
- Tồn kho và Kiểm kê là các mục riêng, đơn giản.

## 3. Đề xuất "Nhập xuất kho — Hằng ngày"

Một màn, chia 2 cột trên máy tính. Điện thoại: danh sách trước, chạm vào để mở phiếu, có nút Quay lại.

| Vùng | Nội dung |
|---|---|
| Trên | Chọn kho, tên thủ kho, nút **Tồn kho**, nút chính **+ Lập phiếu** (Nhập / Xuất / Chuyển). |
| Trái | Lọc nhanh "Cần xử lý / Nhập / Xuất / Chuyển / Đã xong". Mỗi dòng gồm: mã PO + đợt, NCC, bước hiện tại, giá trị. Phiếu treo quá 3 ngày hiện đỏ "Treo N ngày". |
| Phải | Phiếu đang chọn. Bên trái là lưới hàng; bên phải là NCC, dự án, người đặt, **ngày hàng về thực tế**, biển số, người giao, lý do nhận thiếu. Nút hành động nằm cố định ở chân phiếu. |

Thay đổi nghiệp vụ:

1. **Gộp "kiểm SL/CL" và "nhập kho" thành một bước** cho thủ kho: "Nhận đủ · nhập kho" hoặc "Nhận thiếu · nhập kho".
   - SL thực nhận điền sẵn bằng SL đợt giao (hoặc SL đã kiểm), thủ kho chỉ sửa dòng lệch.
   - Nhận thiếu bắt buộc chọn lý do: giao bù đợt sau / chốt thiếu / hàng lỗi trả NCC / cân thấp hơn.
   - Công nợ tạm tính chuyển kế toán ngay khi nhập kho, như hiện nay.
2. **"Hàng không về"**: một chạm để báo Mua hàng; Mua hàng sẽ hủy hoặc dời đợt. Thủ kho không phải để phiếu treo.
3. **Nhập hàng mua theo PO chỉ qua danh sách đợt giao.** "Lập phiếu nhập" chỉ dùng cho tồn đầu kỳ, hàng tặng, hàng thu hồi, và có nhắc rõ điều này.
4. **Xuất / chuyển**: hiện cột Tồn ngay trên từng dòng; nếu vượt tồn thì báo đỏ và khóa nút (luật K1 đã có ở DB). Hai nút: "Duyệt & xuất kho" / "Từ chối".
5. Màu theo theme:
   - Mã phiếu, NCC, dự án, người, vật tư: xanh ngọc.
   - Số liệu: xanh lá.
   - Đỏ chỉ dùng khi quá hạn hoặc vượt tồn; cam cho thiếu hàng.
   - Nút chính xanh lá.

## 4. Đối chiếu nhận hàng tồn đọng (đã làm — chờ duyệt deploy)

### 4.1 Đối chiếu để làm gì

Mỗi đợt giao theo PO phải khớp ba sổ:

| Sổ | Ai giữ | Ghi gì |
|---|---|---|
| Đơn mua (PO, đợt giao) | Mua hàng | Đặt bao nhiêu, NCC nói giao bao nhiêu |
| Kho (phiếu nhập, sổ kho) | Thủ kho | Thực nhận bao nhiêu, ngày nào |
| Công nợ NCC, chi phí dự án | Kế toán | Phải trả bao nhiêu, ghi nhận ngày nào |

Luồng chuẩn: thủ kho nhận hàng thì PO, kho, công nợ và chi phí dự án tự khớp. Khi đợt giao treo, cả ba lệch nhau:

- tồn kho thiếu hàng đã về;
- PO vẫn "đang giao";
- công nợ NCC và chi phí dự án chưa ghi.

Màn đối chiếu chốt **sự thật vật lý** của từng đợt (về bao nhiêu, ngày nào) bằng hai chữ ký độc lập (Mua hàng và Thủ kho). Sau đó hệ thống ghi đồng loạt cả ba sổ theo đúng ngày hàng về.

### 4.2 Vai trò kế toán

- Kế toán **không ký** đối chiếu: đây là xác nhận hàng vật lý, việc của Mua hàng và kho.
- Nhưng ghi sổ **tạo công nợ NCC và chi phí dự án ngày quá khứ**. Mỗi công nợ loại này được gắn nhãn `origin = receipt_reconciliation` (kèm mã đối chiếu, ngày hàng về, thời điểm ghi) để kế toán lọc và đối chiếu hóa đơn.
- Hiện hệ thống **chưa có hóa đơn NCC và phiếu chi nào**. Có 7 PO treo, giá trị đặt hàng ~5,2 tỷ, tất cả `unpaid`. Nếu kế toán đã trả NCC ngoài hệ thống, số trả đó phải ghi vào K3 trước khi thanh toán tiếp, **tránh trả trùng**.
- Chi phí dự án tháng 7–8 sẽ tăng theo số ghi sổ. Báo cáo các tháng đó thay đổi. Chưa có khóa kỳ (K5), nên cần báo kế toán trước khi ghi sổ.
- Chủ sản phẩm chốt 30/09: tạm thời chỉ Mua hàng và Thủ kho tham gia. Kế toán tham gia từ K3 (đối chiếu hóa đơn, thanh toán).

### 4.3 Người tham gia (chủ sản phẩm chốt 30/09/2026)

- **Mua hàng:** Nguyễn Thị Mơ, Bùi Quang Chung, Đặng Thị Thu Hà.
  - Điều kiện: có quyền Mua hàng — Quản lý.
  - Chung đã có quyền. Mơ và Thu Hà cần được cấp (script `grant-procurement-buyers.mjs`, chờ duyệt).
- **Thủ kho:** người được giao đúng kho nhận (Kho Sơn Miền Bắc: Nguyễn Văn Luật, Bùi Thị Tâm), hoặc Quản trị WMS / Admin.
  - Kho RICO và Kho Tổng chưa có thủ kho, nên chỉ Admin làm được.
- Một người **không được ký cả hai phía**, kể cả Admin.
- Chỉ phía Thủ kho được **ghi sổ**.

### 4.4 Phạm vi dữ liệu thật (30/09/2026)

Có hai loại lệch.

**(a) Mua hàng đã lập đợt, kho chưa nhập.** Kho Sơn Miền Bắc có 10 đợt:

| PO | Đợt | Ghi chú |
|---|---|---|
| PO-259 | 3 đợt | Đợt 1 đã kiểm 17/08 (Bùi Thuỳ Linh) nhưng chưa nhập |
| PO-143, PO-145 | mỗi PO 1 đợt | Trạng thái cũ `wms_pending`, màn nhận hàng hiện tại không xử lý được |
| PO-261, PO-263, PO-272, PO-387, PO-390 | mỗi PO 1 đợt | |

**(b) Lệch ngược: kho đã nhập phiếu WMS, PO và công nợ chưa ghi.**

| PO | Tình trạng |
|---|---|
| PO-116 | Phiếu kho chỉ có 1/5 dòng (thép buộc 1.200 kg). 4 dòng thép ~48 tấn chưa vào kho. |
| PO-163 | Đã nhập kho đủ, PO và công nợ chưa ghi |
| PO-181 | Đã nhập kho đủ, PO và công nợ chưa ghi |

Mua hàng thấy thêm 2 đợt ở kho khác.

### 4.5 Bảng tình huống

| Tình huống | Xử lý khi ghi sổ |
|---|---|
| Về đủ | Kiểm SL/CL và nhập kho một lần, ngày hàng về. Công nợ bằng SL đợt. |
| Về thiếu | Nhập SL thực nhận, bắt buộc lý do. Phần thiếu chọn **chờ NCC giao tiếp** (PO vẫn mở) hoặc **chốt thiếu** (PO đóng, phần còn lại về Cần mua). |
| Về dư (thép cân thực tế) | Nhận theo cân. Đợt thành `received_over`. Công nợ theo SL thực nhận. |
| Thủ kho đã kiểm nhưng chưa nhập | SL đã kiểm được điền sẵn. Được sửa, mọi thay đổi ghi lịch sử. |
| Không về | Hủy đợt và phiếu kho, tồn kho không đổi. Chọn chờ giao tiếp hoặc chốt thiếu. |
| Kho đã nhập, PO chưa ghi | Không nhập lại. Chỉ nhập bổ sung phần kho chưa ghi, bằng phiếu riêng (`tx-recon-…`) ngày hàng về. PO và công nợ theo SL thực nhận. |
| Chốt thấp hơn số kho đã nhập | Chặn. Điều chỉnh giảm đi qua kiểm kê (K5), có duyệt. |
| PO còn phần chưa lên đợt nào | Hiện "PO còn …" ở đợt cuối, để Mua hàng chọn chờ giao tiếp hay chốt thiếu. |
| PO còn đợt khác đang mở | Không chốt thiếu được. Ghi sổ các đợt trước, quyết định ở đợt cuối. |
| Hai người sửa cùng lúc | Theo revision: người sau phải tải lại. Sửa nội dung thì mọi xác nhận cũ mất hiệu lực. |
| Kho xử lý đợt ở nơi khác trong lúc đối chiếu | Đợt rời danh sách. Ghi sổ báo "đã xử lý ở nơi khác". |
| Ngày hàng về sau hôm nay | Chặn. |
| Ngày hàng về trước ngày đặt PO | Cảnh báo (hàng giao trước khi lập PO trên hệ thống vẫn xảy ra). |
| Hàng đã dùng cho công trình trước khi nhập (vd. xà gồ PO-145, tồn 0) | Ghi sổ nhập đúng ngày về, sau đó xuất dùng theo ngày thực tế. Kiểm kê K5 phát hiện phần còn lệch. |
| Trả hàng sau khi đã ghi sổ | Dùng K2 (trả NCC: đổi hàng hoặc giảm trừ). |

### 4.6 Dữ liệu sạch, truy vết

- Mỗi thao tác (lập, sửa, xác nhận, bỏ xác nhận, ghi sổ) ghi vào nhật ký **không sửa, không xóa được**. Nhật ký lưu người, thời điểm, bản (revision) và giá trị trước/sau.
- Khi ghi sổ, lưu ảnh trạng thái cũ của đợt: SL thủ kho đã kiểm, trạng thái phiếu, ngày phiếu.
- Phiếu kho, công nợ, chi phí dự án đều có **ngày nghiệp vụ** (ngày hàng về) và **thời điểm ghi** (lúc bấm ghi sổ).
- Đợt giao và PO có dòng ghi chú "Đối chiếu nhận hàng: …". PO có sự kiện `receipt_reconciled` và, nếu chốt thiếu, `close_short` kèm ảnh SL đặt và SL nhận từng dòng.
- Giới hạn đã biết: số dư lũy kế lưu trên từng dòng sổ kho (`balance_after`) là số tại lúc ghi, không tính lại theo ngày. Báo cáo tồn theo ngày tính từ tổng phát sinh nên vẫn đúng. Khóa kỳ và định giá lại thuộc K5.

### 4.7 Sau đối chiếu

Kiểm kê Kho Sơn Miền Bắc (K5) để chốt tồn thực tế. Chênh lệch đi phiếu điều chỉnh có duyệt.

## 5. Quyết định của chủ sản phẩm (30/09/2026)

1. Gộp 2 bước kiểm SL/CL + nhập kho thành 1 bước: **đồng ý**. Làm ở màn Hằng ngày, bước (b).
2. Mua hàng xác nhận đối chiếu: **Nguyễn Thị Mơ, Bùi Quang Chung, Đặng Thị Thu Hà**. Kế toán tạm chưa tham gia.
3. Nhập kho lùi ngày theo ngày hàng về, chỉ trong màn đối chiếu: **đồng ý**.
4. Thứ tự: (a) đối chiếu → (b) màn Hằng ngày → (c) K5 kiểm kê SMB: **đồng ý**.
5. Mọi luồng phải tính đủ tình huống ngược và rẽ nhánh (thiếu, hủy, từ chối, trả lại, hoàn hàng). Dữ liệu giao dịch phải sạch, minh bạch, lịch sử rõ để truy vết.
