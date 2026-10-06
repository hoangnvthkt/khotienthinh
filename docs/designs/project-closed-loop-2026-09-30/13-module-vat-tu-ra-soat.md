# Rà soát Module Vật tư (kho toàn công ty)

Ngày: 03/10/2026 · Số liệu đo trên production cùng ngày · Mockup: `.superpowers/review/work-plan/kho-v1.html` (server `project-loop`, cổng 5181).

Góc nhìn khi rà soát:
- **Thủ kho:** ghi đúng hàng vào/ra, ít bước, làm được trên điện thoại ở công trường.
- **Kế toán kho:** một sổ duy nhất, giá xuất đúng phương pháp, khóa kỳ, khớp MISA.
- **Giám đốc vật tư:** nhìn tồn và giá trị toàn công ty, thấy ngay chỗ bất thường, kiểm soát ngoại lệ.

---

## 0. Tóm tắt

1. **Sổ kho chưa phản ánh đúng thực tế.** Có tồn ảo, giá trị âm, gần một nửa dòng nhập không có giá, phiếu treo tới 72 ngày, chưa kiểm kê lần nào. Nguyên nhân chính:
   - Ghi xuất quá nặng (12 trạng thái, 2 người, quyết toán theo từng phiếu).
   - Hàng dùng ngay (bê tông, Base) vẫn bị coi là hàng lưu kho.
   - Giá xuất không theo bình quân, trừ chuyển kho.
2. **Module bị trùng và rối.**
   - 8 mục menu.
   - Tồn kho xem được ở 3 nơi, lấy từ 2 nguồn số khác nhau.
   - Có 3 cửa tạo mã vật tư.
   - Có 2 luồng chuyển kho.
   - Có một màn "Đề xuất vật tư" lặp lại việc của Dự án và Mua hàng.
3. **Đề xuất gom lại thành 5 việc, mỗi việc một màn:** Tồn kho · Phiếu kho (Nhập / Xuất / Chuyển) · Kiểm kê · Danh mục vật tư (cấp mã) · Báo cáo.
   - Khung giống Mua hàng: danh sách bên trái, chi tiết bên phải, nút thao tác ghim ở đáy.
   - Lập phiếu, xem thẻ kho, cấp mã đều làm ngay tại chỗ, không phải chuyển màn.

---

## 1. Hiện trạng

### 1.1 Menu hiện tại

| Menu | Có gì | Dùng thật (03/10) |
|---|---|---|
| Dashboard | Giá trị kho, "Tổng tồn kho", cảnh báo tồn, biểu đồ 7 ngày, nhật ký | "Tổng tồn kho" = 201.263, **cộng lẫn cây + kg + m3 + viên** nên con số vô nghĩa |
| Đề xuất vật tư | Kanban phiếu đề xuất (Chờ duyệt / Chờ xuất / Đang giao / Đã nhận) | 78/78 phiếu sinh từ Dự án. Nhãn "Chờ xuất" mâu thuẫn với "Đang cung ứng" của việc 1 |
| Đề xuất cấp mã | Gửi đề xuất mã, Admin hoặc thủ kho toàn công ty cấp | 43 phiếu, **9 phiếu treo từ 06–08** |
| Kho & Vật tư | Bảng vật tư (số tồn lấy từ bản sao trong danh mục), bảng "Kiểm soát vật tư" (lấy từ sổ kho), Thêm mới, Excel nhập mới / cập nhật, quét QR nhận hàng | Hai bảng trên cùng một màn, lấy từ hai nguồn số khác nhau |
| Nhập / Xuất | 6 tab: Nhập kho · Xuất cấp thi công · Chuyển kho · Xuất hủy · Xử lý phiếu (gồm Hằng ngày / Lịch sử) · Đối chiếu | 317 phiếu, 22 đang mở |
| Kiểm kê | Phiên kiểm kê K5 + lịch sử cũ | **0 phiên** |
| Báo cáo WMS | Tổng quan tồn · Thẻ kho vật tư · Thẻ kho theo kho · Lịch sử | Tab "Tổng quan" lặp lại màn Tồn kho |
| Đồng bộ MISA | Xuất phiếu kho ra Excel MISA (chỉ Admin) | — |

### 1.2 Số liệu theo kho

| Kho | Thủ kho | Dòng có tồn | Giá trị tồn | Dòng tồn không có giá | Không biến động > 60 ngày | Ghi chú |
|---|---|---|---|---|---|---|
| Kho Sơn Miền Bắc | Luật | 75 | 5,23 tỷ | **40** | 51 | Tồn ảo bê tông, Base (mục L2) |
| Kho Xin Hai Vina | Minh | 11 | 7,03 tỷ | 0 | 0 | Sạch nhất (cọc D300 4,69 tỷ) |
| Kho Tổng Hưng Yên | **chưa có** | 11 | **−1,52 tỷ** | 11 | 11 | Cả 11 dòng thuộc vật tư đã bị xóa |
| Kho RICO | **chưa có** | 4 | **−1,66 tỷ** | 4 | 4 | Dữ liệu thử tháng 3–7 |

Ai đang giữ vai trò "thủ kho toàn công ty":
- Bùi Thùy Linh.
- Phạm Thị Thủy, đồng thời là **kế toán**.
- Nguyễn Thị Mơ, đồng thời là **GĐ vật tư**.

---

## 2. Sai logic (xếp theo mức nghiêm trọng)

| # | Vấn đề | Bằng chứng | Hậu quả |
|---|---|---|---|
| L1 | **Giá xuất kho không theo bình quân.** Chỉ chuyển kho lấy giá bình quân (K3a-2). Xuất thi công, xuất hủy, điều chỉnh lấy đơn giá gõ trên phiếu hoặc giá danh mục | 11/07 xuất hủy ở RICO tính theo giá danh mục, trong khi hàng nhập có giá 0. Phiếu điều chỉnh K1 đưa số lượng về 0 nhưng giá trị vẫn âm (−1,66 tỷ RICO, −1,52 tỷ Kho Tổng). Tháng 9 Kho XHV xuất 9 vật tư (1.749 m cọc D300, 192,5 m3 bê tông…) đều ghi **giá 0**, dù cọc đang tồn 4,69 tỷ | Giá trị tồn và giá vốn sai, không khớp MISA. Chi phí vật tư xuất dùng của dự án bằng 0, còn giá trị tồn thì không giảm |
| L2 | **Tồn ảo: hàng dùng ngay bị coi là hàng lưu kho** | Kho SMB "đang tồn" bê tông M350 1.272,5 m3 (1,87 tỷ), Base B 1.861,5 m3 (0,98 tỷ), M250 23,5 m3. Bê tông xuất lần cuối ngày 22/07, từ đó tới nay chỉ có nhập | Tồn và chi phí dự án sai. Không so được BOQ |
| L3 | **Ghi xuất quá nặng nên thủ kho bỏ qua** | Xuất cấp thi công có 12 trạng thái (nháp → gửi → chờ kho xuất → đã xuất → người nhận xác nhận → quyết toán → đóng). Trong 63 phiếu: 33 dừng ở "đã nhận", 22 bị hủy, chỉ 3 phiếu đóng. 51/75 dòng tồn SMB không biến động quá 60 ngày dù tiến độ thi công đã 82%. **Cả tháng 9, Kho SMB không có phiếu xuất nào** (nhập 909 triệu) | Xuất không được ghi, dẫn tới tồn ảo (L2). Thủ kho tự xoay xở: 5 phiếu ghi người nhận là "Xuất chốt vật tư tháng 6 V2", "XUẤT CHỐT T6", "Tài khoản 627"… chiếm 57/119 dòng xuất cấp (48%) — tức là thực tế công trường **chốt tiêu hao cuối tháng** chứ không xuất từng lần |
| L4 | **Thiếu giá khi nhập** | 167/356 dòng nhập mua (47%) và 100/163 dòng xuất thi công có giá 0. 40/75 dòng tồn SMB không có giá trị | Báo cáo giá trị không dùng được. Hiện đang che bằng số 0 |
| L5 | **Xóa được vật tư đã có phát sinh** | Ngày 06/06 có 14 mã thép bị xóa. 51 dòng sổ và 15 dòng tồn (16.503 đơn vị) giờ trỏ tới vật tư không còn tồn tại | Mất truy vết. Tồn treo ở Kho Tổng và RICO |
| L6 | **Hai nguồn số tồn** | Màn Tồn kho, Dashboard và phần tính "khả dụng" lấy từ bản sao trong danh mục. Báo cáo và Kiểm kê lấy từ sổ kho. SMB lệch 7 dòng; Kho Tổng và RICO lệch 15/15 dòng | Mỗi màn hiện một số khác nhau |
| L7 | **Cảnh báo tồn vô nghĩa** | Badge menu hiện **1.438** vật tư "sắp hết", vì công thức là tồn ≤ tồn tối thiểu mà 1.509 mã có tồn tối thiểu = 0 | Người dùng sẽ bỏ qua mọi cảnh báo |
| L8 | **Duyệt chỉ là hình thức** | Từ 01/07: 114/137 phiếu nhập (83%) và 49/57 phiếu xuất (86%) do chính người lập tự duyệt. Riêng phiếu nhập còn bước "Đã duyệt, chờ nhập kho": 5 phiếu kẹt ở bước này | Thêm thao tác mà không kiểm soát thêm được gì |
| L9 | **Không khóa kỳ** | 83/254 phiếu hoàn tất có ngày chứng từ lùi hơn 3 ngày so với ngày lập. Bảng khóa kỳ đang rỗng | Số tháng trước có thể đổi bất kỳ lúc nào, nên đối chiếu MISA không chốt được. Cột "tồn sau" của thẻ kho tính theo thứ tự ghi sổ chứ không theo ngày chứng từ, nên ghi lùi ngày làm số dư từng dòng sai |
| L10 | **Phiếu treo** | 22 phiếu mở, 19 phiếu quá 3 ngày, cũ nhất 72 ngày (PO giao SMB từ 23/07) | Tồn thiếu hàng thật, Mua hàng và kho lệch nhau |
| L11 | **Danh mục lộn xộn** | 9 tên trùng (Đá 1x2 có 3 mã). 42 đơn vị tính (Cái/cái, Kg/kg, Mét/mét/m/md). 21 nhóm vừa là mã vừa là tên, có cả tiếng Anh và nhóm "Đầu kỳ". 22 tiền tố mã khác nhau. 24 mã là dịch vụ (ca bơm, vận chuyển) nằm trong danh mục kho | Tìm sai mã, tồn bị chia ra nhiều mã |
| L12 | **Phân công kho chưa đúng** | Kho Tổng và RICO không có thủ kho. Kế toán (Thủy) và GĐ vật tư (Mơ) mang vai trò "thủ kho toàn công ty" | Không tách được người giữ hàng, người ghi sổ và người duyệt |

---

## 3. Dư thừa, trùng lặp

| # | Tính năng | Trùng với | Đề xuất |
|---|---|---|---|
| D1 | Menu **Đề xuất vật tư** (/requests) | Dự án → Đề xuất vật tư, và Mua hàng → Cần mua (Cấp từ kho) | Bỏ khỏi menu Vật tư. Thủ kho thấy việc "cấp từ kho" ngay trong hàng đợi Phiếu kho |
| D2 | **Dashboard** | Tồn kho và Báo cáo | Gộp thành dải chỉ số ở đầu màn Tồn kho |
| D3 | Hai bảng trên màn Kho & Vật tư | Lặp nhau, lấy từ 2 nguồn | Chỉ giữ một bảng, đọc từ sổ kho |
| D4 | Báo cáo → "Tổng quan tồn kho" | Màn Tồn kho | Bỏ |
| D5 | **Thêm mới** vật tư và **Excel nhập mới** ở màn Tồn kho, cộng **Cài đặt → Dữ liệu gốc** (thêm, sửa, xóa vật tư, Excel) | Đề xuất cấp mã | Hiện có tới 4 cửa tạo mã. Chỉ giữ một cửa cấp mã, nằm trong Danh mục |
| D6 | Nhập tồn ngay khi tạo vật tư (ô "tồn ban đầu") | Phiếu nhập | Bỏ. Tồn đầu kỳ đi bằng phiếu nhập "Tồn đầu kỳ" có duyệt |
| D7 | Bước duyệt riêng cho nhập/xuất thường + trạng thái "đã duyệt, chờ nhập kho" | — | Gộp thành 1 bước ghi sổ (mục 4) |
| D8 | Người nhận xác nhận + quyết toán **từng phiếu** xuất | Quyết toán vật tư với tổ đội/thầu phụ theo tháng (thuộc Dự án) | Xuất 1 bước. Quyết toán chuyển về theo kỳ |
| D9 | Hai luồng chuyển kho: tab Chuyển kho cũ (1 bước) và chuyển 2 bước (gửi → nhận, đang chỉ bật thử ở XHV, 0 phiếu) | — | Giữ một luồng 2 bước |
| D10 | Tab **Đối chiếu** ở Kho và ở Mua hàng | Cùng một màn | Giữ ở Mua hàng. Kho chỉ hiện dải "phiếu treo" bấm được |
| D11 | Quét QR phiếu ở màn Tồn kho | Hàng đợi nhận hàng | Chuyển nút quét QR lên đầu màn Phiếu kho |
| D12 | **Đồng bộ MISA** là một menu riêng | Báo cáo | Chuyển vào Báo cáo, mục "Kết xuất & khóa kỳ" |

---

## 4. Mô hình quản lý kho đề xuất

### 4.1 Sáu nguyên tắc

1. **Một sổ kho duy nhất.** Mọi màn, mọi con số đều đọc từ sổ kho. Bỏ bản sao trong danh mục.
2. **Ghi sổ ngay khi hàng thực sự vào hoặc ra, chỉ 1 bước, do thủ kho làm.**
   - Duyệt chỉ áp cho ngoại lệ: xuất hủy, điều chỉnh, chênh lệch kiểm kê, nhập không có nguồn (tồn đầu kỳ, hàng tặng).
   - Kế toán hậu kiểm giá. Kế toán không phải duyệt từng phiếu.
3. **Giá xuất = bình quân gia quyền cuối kỳ (tháng), áp cho mọi loại xuất** — chủ SP chốt 03/10, khớp MISA.
   - Trong tháng, phiếu xuất mang **giá tạm tính** (bình quân tới thời điểm xuất) để CHT xem chi phí sơ bộ. Nhãn "tạm tính".
   - Khi kế toán khóa tháng, hệ thống tính giá cuối kỳ cho từng mã ở từng kho: (giá trị tồn đầu + giá trị nhập trong kỳ) ÷ (SL tồn đầu + SL nhập trong kỳ). Giá này áp lại cho mọi dòng xuất trong kỳ. Phần chênh so với giá tạm tính được ghi thành dòng điều chỉnh chi phí dự án (không sửa đè).
   - Chuyển kho: kho nhận nhập theo giá xuất của kho gửi. Vì vậy phải tính kho gửi trước (Kho Tổng trước, kho công trường sau). Nếu trong cùng kỳ hàng chuyển qua lại giữa hai kho thì tính lặp cho tới khi giá ổn định.
   - Không khóa được kỳ khi còn dòng nhập chưa có giá. Dòng chưa có giá hiện "Chưa có giá" và nằm trong việc của kế toán; không hiện số 0.
4. **Mỗi vật tư có một "cách quản lý kho":**
   - **Lưu kho:** thép, gạch, xi măng…
   - **Dùng ngay:** bê tông, Base, dầu cấp máy. Khi nhận hàng, hệ thống tự ghi cả nhập và xuất dùng, có gắn hạng mục nếu có.
   - **Không qua kho:** dịch vụ như ca bơm, vận chuyển. Chỉ ghi chi phí, không có tồn.
5. **Không xóa, không sửa đè.**
   - Phiếu đã ghi sổ: chỉ được đảo, kèm lý do.
   - Vật tư đã có phát sinh: chỉ được "Ngừng dùng" hoặc "Gộp vào mã khác", có nhật ký.
6. **Khóa kỳ theo tháng.** Kế toán chốt tháng. Sai sót của kỳ đã khóa được điều chỉnh ở kỳ đang mở.

### 4.2 Bảy công tác kho

**1. Tổng quan tồn kho** — dành cho GĐ vật tư, thủ kho, kế toán.

Mỗi vật tư ở mỗi kho có các cột:

| Cột | Ý nghĩa |
|---|---|
| Tồn | Số đang có trong kho |
| Đang về | Đơn đã đặt nhưng chưa nhận |
| Đang chuyển đến | Hàng đi đường từ kho khác |
| Giá bình quân / Giá trị | Theo giá bình quân của kho |
| Biến động cuối | Ngày phát sinh gần nhất |
| Cảnh báo | Chậm luân chuyển > 60 ngày, dưới tồn tối thiểu (chỉ khi đã đặt tồn tối thiểu), chưa có giá, hàng "dùng ngay" mà vẫn còn tồn |

Bấm một dòng thì mở **thẻ kho** ngay bên phải. Từ thẻ kho bấm được luôn **Xuất · Chuyển · Kiểm đếm**.

**2. Cấp mã vật tư** — chỉ một cửa.

- Ai cũng gõ tên để tìm. Hệ thống gợi ý các mã gần giống (đo độ giống tên). Không thấy mã phù hợp thì bấm "Đề xuất mã mới".
- Người cấp mã (GĐ vật tư hoặc người được giao) xử lý ngay trong hàng đợi:
  - **Dùng mã có sẵn:** trả lời người đề xuất, kèm link tới mã đó.
  - **Cấp mã mới:** mã sinh tự động theo tiền tố nhóm. Chọn đơn vị tính từ danh sách chuẩn. Khai đơn vị mua kèm hệ số quy đổi (ví dụ thép: Cây ↔ kg, đây chính là lỗi của việc 1). Chọn cách quản lý kho.
- Mã trùng thì **gộp**: phát sinh cũ vẫn giữ nguyên, chỉ trỏ thêm sang mã chính.
- Ngừng dùng thay cho xóa.

**3. Nhập kho** — mọi nguồn hàng vào đều đi qua một hàng đợi.

| Nguồn | Cách làm |
|---|---|
| Đợt giao của đơn mua (PO, HĐ nguyên tắc, mua nóng) | Hàng hiện sẵn trong hàng đợi. SL thực nhận điền sẵn, thủ kho chỉ sửa dòng lệch rồi bấm **Nhập kho**. Thiếu thì chọn lý do (giao bù / chốt thiếu / lỗi trả NCC), phần thiếu tự quay về Mua hàng |
| Hàng chuyển đến | Bấm Nhận đủ, hoặc Nhận thiếu kèm lý do |
| Nhập trực tiếp NCC (K3a-3) | Như hiện nay: phải có giá và VAT, đi vào "Chờ ghi nợ" |
| Công trường trả lại hàng thừa | Phiếu nhập trả, giá = giá đã xuất |
| Tồn đầu kỳ / hàng tặng | Cần duyệt |

**4. Xuất kho** — 1 bước, có 2 cách ghi tùy công trường.

**Cách A — Xuất từng lần** (cấp cho tổ đội / thầu phụ):
- Thủ kho chọn người nhận (tổ đội hoặc thầu phụ), hạng mục (không bắt buộc), gõ vật tư (thấy tồn ngay trên dòng; vượt tồn thì báo đỏ và khóa nút), rồi bấm **Xuất kho**.
- Người nhận ký trên điện thoại hoặc quét QR. Bước này không bắt buộc.

**Cách B — Chốt tiêu hao cuối tháng** (đúng cách công trường đang làm, xem L3):
- Cuối tháng thủ kho đếm tồn thực tế bằng phiên kiểm kê.
- Phần chênh lệch = tồn đầu + nhập − tồn đếm được, chọn lý do "Đã dùng, chưa lập phiếu". Duyệt xong thì hệ thống tự lập phiếu xuất dùng cho dự án, giá theo bình quân (K5 đã có lý do này).
- Không phải tạo "người nhận" giả như "XUẤT CHỐT T6".

Chung cho cả hai cách:
- Bỏ quyết toán theo từng phiếu. Quyết toán vật tư với thầu phụ sẽ làm theo tháng ở Dự án (cấp so với định mức × khối lượng nghiệm thu), là việc sau.
- Xuất hủy / hao hụt cần duyệt. Xuất trả NCC đi từ Mua hàng (K2), giữ như cũ.

**5. Chuyển kho** — 2 bước, chỉ một luồng.

- Ai lập phiếu: Mua hàng ("Cấp từ kho") hoặc thủ kho kho gửi.
- Bước 1: thủ kho kho gửi **Gửi hàng**. Tồn giảm, hàng chuyển sang "đi đường".
- Bước 2: thủ kho kho nhận **Nhận hàng**. Thiếu thì phải ghi lý do, phần chênh lệch quay về kho gửi xử lý.
- Giá đi theo giá bình quân của kho gửi (K3a-2 đã có).

**6. Kiểm kê** — dùng tiếp K5 (đếm mù, có duyệt).

- Bổ sung **lịch kiểm kê**: kho công trường mỗi tháng, Kho Tổng mỗi quý.
- **Kiểm nhanh 1 vật tư** ngay từ thẻ kho.
- Kiểm theo nhóm vật tư, không bắt đếm hết 75 dòng một lúc.
- Trước khi kiểm phải xử lý xong phiếu treo của kho đó (hệ thống nhắc, không chặn cứng).

**7. Báo cáo**

1. Tổng hợp Nhập – Xuất – Tồn theo kỳ, cả SL và giá trị, lọc theo kho / nhóm / dự án (mẫu S10/S11).
2. Thẻ kho.
3. Bảng kê phiếu nhập / xuất theo kỳ và theo đối tượng.
4. Vật tư chậm luân chuyển.
5. Kết quả kiểm kê và chênh lệch.
6. Kết xuất MISA và khóa kỳ.

So sánh cấp phát với BOQ vẫn nằm ở Dự án; Báo cáo chỉ đặt link sang đó.

### 4.3 Tình huống ngược

| Tình huống | Xử lý |
|---|---|
| Nhận thiếu | Chọn lý do. Phần thiếu về Mua hàng (giao bù hoặc chốt thiếu) |
| Nhận thừa | Mặc định chỉ nhận đúng SL đợt giao. Muốn nhận thừa phải có lý do, và Mua hàng phải xác nhận trước khi ghi nợ |
| Hàng lỗi | Không nhập phần lỗi: chọn "Nhận thiếu · hàng lỗi trả NCC". Lỗi phát hiện sau khi đã nhập thì trả NCC (K2) |
| Hàng không về | Một chạm báo Mua hàng (đã đề xuất ở 06-kho-mot-man-hinh) |
| Xuất nhầm hoặc thừa | Phiếu nhập trả từ công trường, giá = giá đã xuất |
| Ghi sai đã ghi sổ | Đảo phiếu (có lý do) rồi lập lại. Nếu kỳ đã khóa thì điều chỉnh ở kỳ đang mở |
| Chuyển kho nhận thiếu | Chênh lệch nằm ở trạng thái "đi đường". Kho gửi xác nhận mất, hoặc hàng quay về |
| Ghi lùi ngày | Chỉ được lùi trong kỳ chưa khóa, phải ghi lý do |
| Vật tư trùng mã | Gộp mã, có nhật ký; báo cáo cộng chung |

### 4.4 Phân quyền theo bậc

| Bậc | Việc được làm | Phạm vi | Người dự kiến |
|---|---|---|---|
| Xem | Xem tồn, thẻ kho, báo cáo | Theo kho / dự án | CHT, KS, Mua hàng |
| Thủ kho | Nhập, xuất, chuyển (gửi/nhận), đếm kiểm kê | Kho được giao | Luật (SMB), Minh (XHV), Hương (Kho Tổng). RICO chưa có |
| Duyệt ngoại lệ | Xuất hủy, điều chỉnh, chênh lệch kiểm kê, tồn đầu kỳ | Toàn công ty hoặc theo kho | Admin, Mơ (chốt 03/10) |
| Kế toán kho | Bổ sung giá, đảo phiếu, khóa kỳ, kết xuất MISA | Toàn công ty | Hương (khóa kỳ), Thủy |
| Cấp mã | Cấp mã, quy cách, gộp mã, ngừng dùng, đơn vị tính / quy đổi | Toàn công ty | Mơ, Linh (chốt 03/10) |

Tách nhiệm:
- Người đếm kiểm kê không được duyệt chênh lệch của chính mình.
- Thủ kho không được khóa kỳ.
- Áp dụng cho cả Admin.

### 4.5 Cài đặt quyền ở đâu (để chủ SP tự chọn người)

Đường dẫn: **Cài đặt → Người dùng → bấm vào người → "Cập nhật người dùng & phân quyền" → nhóm Kho vật tư**. Ở đây có thể điền theo mẫu chức vụ, sửa từng thao tác và chọn phạm vi (toàn công ty / theo kho).

**Hiện nay** — có việc chưa chọn người được, vì đang gắn cứng vào vai trò:

| Việc | App đang dựa vào | Chọn người khác được không |
|---|---|---|
| Cấp mã | Vai trò **Admin** hoặc **thủ kho toàn công ty**. Đây là vai trò tài khoản, không phải ô quyền. Bên dưới còn cần ô "Đề xuất vật tư → Duyệt" và "Danh mục kho → Quản trị danh mục" | Không. Phải đổi vai trò tài khoản |
| Duyệt kiểm kê | Vai trò **Admin** hoặc ô "Kho vật tư (hệ thống) → Quản trị" | Được, nhưng ô này mở toàn bộ quyền quản trị kho |
| Duyệt xuất hủy | Chỉ vai trò **Admin** | Không |
| Thủ kho | Vai trò **thủ kho** + **một** kho được giao | Một người chỉ giữ được một kho, và không kiêm được vai trò khác (ví dụ chị Hương là kế toán trưởng) |
| Thêm / **xóa** vật tư | Ô "Danh mục kho → Quản trị danh mục" | **19 người đang có**, trong đó 15 nhân viên công trường. Đây là cửa dẫn tới lỗi L5 |

**Sau đợt V1** — bốn ô quyền riêng, chọn người như mọi quyền khác:

| Ô quyền (nhóm Kho vật tư) | Gồm | Phạm vi | Mặc định |
|---|---|---|---|
| Danh mục vật tư → **Cấp mã** | Cấp mã, quy cách, gộp mã, ngừng dùng, chuẩn hóa ĐVT | Toàn công ty | Mơ, Linh |
| Giao dịch kho → **Duyệt ngoại lệ** | Xuất hủy, điều chỉnh, chênh lệch kiểm kê, tồn đầu kỳ | Toàn công ty / theo kho | Mơ (Admin luôn có) |
| Giao dịch kho → **Thủ kho** | Nhập, xuất, gửi/nhận chuyển kho, đếm kiểm kê | Theo kho | Luật–SMB, Minh–XHV, Hương–Kho Tổng |
| Kho vật tư → **Kế toán kho** | Bổ sung giá, đảo phiếu, khóa kỳ, kết xuất MISA | Toàn công ty | Hương, Thủy |

Kèm theo đó: thêm 3 mẫu ở **Cài đặt → Mẫu quyền theo vị trí** là Thủ kho, GĐ vật tư, Kế toán kho. Vai trò "thủ kho toàn công ty" sẽ bỏ khi bốn ô này lên production. Nếu đổi vai trò của chị Thủy và chị Mơ trước thời điểm đó thì hai chị mất việc đang làm (xem câu hỏi 11).

---

## 5. UI/UX — ít chuyển màn hình

### 5.1 Menu: 8 mục còn 5

| Mới | Gom từ |
|---|---|
| **Tồn kho** (trang chính) | Dashboard + Kho & Vật tư + Báo cáo / Tổng quan tồn |
| **Phiếu kho** | 6 tab Nhập/Xuất (Nhập, Xuất cấp, Chuyển, Xuất hủy, Xử lý phiếu, Lịch sử) + quét QR |
| **Kiểm kê** | Giữ như cũ, thêm lịch và kiểm nhanh |
| **Danh mục vật tư** | Đề xuất cấp mã + Thêm mới / Excel vật tư |
| **Báo cáo** | Báo cáo WMS + Đồng bộ MISA |

### 5.2 Khung chung (kế thừa Mua hàng)

- **Đầu trang:** icon teal, tiêu đề, một câu mô tả. Chọn kho bằng **chip** (thủ kho mặc định chỉ thấy kho của mình). Nút chính **Lập phiếu** (Nhập / Xuất / Chuyển) và nút **Quét QR**.
- **Dải chỉ số bấm được** (giống dải bước của Mua hàng). Mỗi ô là một bộ lọc. Ô có vấn đề thì hiện cam/đỏ, kèm `overdue-blink` nếu quá hạn.
- **Thân trang:** danh sách bên trái, chi tiết bên phải. Lập phiếu mở ngay ở cột phải, không đổi tab. Nút thao tác ghim ở đáy.
- **Điện thoại:** hiện danh sách trước; chạm vào thì mở chi tiết toàn màn, có nút "← Danh sách". Nút chính ghim ở đáy.
- **Màu:** mã, tên, kho, NCC dùng `ENT` (mint). Số liệu dùng `NUM` (leaf). Cam/đỏ chỉ dành cho cảnh báo.

### 5.3 Số lần chuyển màn của 5 việc hằng ngày

| Việc | Hiện nay | Đề xuất |
|---|---|---|
| Nhận hàng đợt giao PO | Nhập/Xuất → Xử lý phiếu → chọn phiếu → Nhập kho (đã gọn ở #41) | Phiếu kho → chọn → **Nhập kho** (giữ nguyên) |
| Xuất cho tổ đội | Tab Xuất cấp thi công → form → Gửi → sang tab Xử lý phiếu → Xuất kho → người nhận xác nhận ở màn khác → quyết toán (**3 màn, 2 người**) | Tồn kho hoặc Phiếu kho → **+ Xuất** ở cột phải → **Xuất kho** (**1 màn, 1 người**) |
| Xem thẻ kho một vật tư | Báo cáo WMS → tab Thẻ kho → chọn vật tư | Tồn kho → bấm dòng → thẻ kho mở bên phải |
| Gặp vật tư chưa có mã khi lập phiếu | Rời phiếu → Đề xuất cấp mã → chờ → quay lại | Trong ô chọn vật tư bấm "Đề xuất mã mới" (drawer); phiếu lưu nháp, có mã thì dùng tiếp |
| Chuyển kho cho công trường | Tab Chuyển kho → form → duyệt → (kho nhận không xác nhận) | Phiếu kho → chọn phiếu "Cấp từ kho" Mua hàng đã lập → **Gửi hàng**; kho nhận → **Nhận hàng** |

---

## 6. Lộ trình đề xuất

| Đợt | Nội dung | Có migration? |
|---|---|---|
| V0 Dọn dữ liệu | Kiểm kê SMB (xử lý tồn ảo bê tông, Base). Đưa 15 dòng tồn mồ côi và giá trị âm ở Kho Tổng/RICO về 0 bằng phiếu điều chỉnh. Xử lý 19 phiếu treo, 9 đề xuất cấp mã treo, 33 phiếu xuất "đã nhận chưa quyết toán" | Có (script dữ liệu, chủ SP duyệt từng việc) |
| V1 Tồn kho + Danh mục | Một nguồn số. Thẻ kho trong panel. Cảnh báo đúng. Cấp mã một cửa có gợi ý trùng. Gộp mã, ngừng dùng, chặn xóa. Cách quản lý kho theo vật tư. **Quy cách theo mã** (mục 9). **Bốn ô quyền mới** (mục 4.5) | Có |
| V2 Phiếu kho một màn | Nhập / xuất / chuyển 1 bước, chỉ duyệt ngoại lệ, xuất cấp gọn, chuyển 2 bước cho mọi kho, hàng "dùng ngay" tự xuất khi nhận | Có |
| V3 Giá & kỳ | **Bình quân cuối kỳ** cho mọi loại xuất (giá tạm tính trong tháng). Việc "chưa có giá" cho kế toán. Khóa kỳ tháng. Báo cáo NXT kỳ và kết xuất MISA | Có |
| V4 Kiểm kê | Lịch kiểm kê, kiểm nhanh, kiểm theo nhóm | Nhỏ |

---

## 7. Câu hỏi cho chủ SP

1. **Giá xuất kho** dùng bình quân gia quyền tức thời cho mọi loại xuất (như chuyển kho đang làm). MISA của công ty đang dùng bình quân tức thời hay bình quân cuối kỳ? Vioo nên theo đúng cách đó để khớp.
2. **Bỏ duyệt cho nhập / xuất / chuyển thường**, chỉ duyệt ngoại lệ (xuất hủy, điều chỉnh, chênh lệch kiểm kê, tồn đầu kỳ). Người duyệt ngoại lệ là GĐ vật tư (chị Mơ) + Admin, đúng không ạ?
3. **Xuất 1 bước, 2 cách ghi:** xuất từng lần cho tổ đội (người nhận ký là tùy chọn) hoặc chốt tiêu hao cuối tháng bằng kiểm kê. Bỏ quyết toán theo từng phiếu. 33 phiếu "đã nhận chưa quyết toán" đóng hàng loạt kèm ghi chú? Mỗi kho công trường dùng cách nào do CHT chọn, hay cho dùng cả hai?
4. **Cách quản lý kho theo vật tư** (Lưu kho / Dùng ngay / Không qua kho). Mặc định bê tông, Base, ca bơm là "Dùng ngay / Không qua kho". Tồn ảo ở SMB xử lý bằng một đợt kiểm kê SMB do anh Luật đếm, chị Mơ duyệt?
5. **Cấp mã một cửa:** bỏ "Thêm mới" và "Excel nhập mới" ở màn Tồn kho. Người cấp mã là chị Mơ + ai nữa? Giữ nguyên mã cũ, mã mới theo tiền tố nhóm. Gộp 9 cặp trùng tên?
6. **Không xóa vật tư đã phát sinh** (thay bằng Ngừng dùng). 15 dòng tồn mồ côi và giá trị âm (−3,18 tỷ) ở Kho Tổng/RICO là dữ liệu thử tháng 3–7: đưa về 0 bằng phiếu điều chỉnh có ghi chú?
7. **Khóa kỳ kho theo tháng** do kế toán (chị Hương) chốt. Bắt đầu từ tháng 9/2026?
8. **Menu 8 → 5:** bỏ Dashboard và Đề xuất vật tư khỏi menu Vật tư, chuyển Đồng bộ MISA vào Báo cáo.
9. **Người phụ trách kho:**
   - Kho Tổng HY và RICO cần thủ kho. Chị Hương có làm thủ kho Kho Tổng không, hay đóng RICO?
   - Chị Thủy (kế toán) và chị Mơ (GĐ vật tư) bỏ vai trò "thủ kho toàn công ty", chuyển sang Kế toán kho / Duyệt ngoại lệ.

---

## 8. Quyết định của chủ SP (03/10/2026)

| # | Quyết định |
|---|---|
| 1 | Giá xuất theo **bình quân gia quyền cuối kỳ** (cách tính ở nguyên tắc 3) |
| 2 | Người duyệt ngoại lệ tạm thời là Admin + chị Mơ. Phải có ô quyền để chủ SP tự chọn người khác (mục 4.5) |
| 3 | Đồng ý xuất 1 bước, có 2 cách ghi. Đóng 33 phiếu "đã nhận chưa quyết toán" |
| 4 | Đồng ý cách quản lý theo vật tư. Tồn ảo SMB xử lý bằng kiểm kê: anh Luật đếm, chị Mơ duyệt |
| 5 | Người cấp mã: chị Mơ + Bùi Thùy Linh. Phải có ô quyền để chọn người khác |
| 6 | Đồng ý đưa 15 dòng tồn mồ côi và giá trị âm ở Kho Tổng/RICO về 0 bằng phiếu điều chỉnh |
| 7 | Đồng ý khóa kỳ theo tháng, chị Hương chốt, bắt đầu từ tháng 9 |
| 8 | Đồng ý menu 8 → 5 |
| 9 | Chị Hương nhận thủ kho Kho Tổng. Kho RICO chưa có thủ kho. Chị Thủy và chị Mơ bỏ vai trò "thủ kho toàn công ty", chuyển sang Kế toán kho / Duyệt ngoại lệ |
| 10 | Một mã vật tư có thể có nhiều quy cách ghi sau tên (mục 9) |

---

## 9. Quy cách ghi sau tên vật tư — một mã, nhiều quy cách

Chủ SP muốn tên trong kho đúng tên đã mua, có quy cách ghi sau tên, nhưng vẫn chung một mã. Ví dụ: VT0000824 "Thép XD D8 – Hòa Phát CB240" và "Thép XD D8 – Việt Nhật CB240".

### 9.1 Hiện trạng

- **Danh mục đang theo kiểu mỗi quy cách một mã:** Tê thu HDPE 54 mã, thép hộp 43, thép ống 40, mũi khoan 34, thép hình 30, thép tấm 24, bulong móng 22…
- Đã có trùng do viết khác nhau: "Bulong móng M24\*650" và "M24x650" là 2 mã.
- Mua hàng đã có ô **quy cách** trên dòng PO (#71), nhưng đó là chữ tự do, chỉ để in. Mới 2/297 dòng dùng, và một dòng ghi như ghi chú ("Bổ sung cọc D300 (Thay đổi tổ hợp từ 28M sang 32-37M)").
- Sổ kho đã có sẵn cơ chế chia tồn theo chiều phụ (lô, mẻ, số seri). Quy cách sẽ thêm vào đúng cơ chế này.

### 9.2 Nguyên tắc: chỉ dùng hậu tố khi các quy cách "thay được cho nhau"

Trước khi tạo quy cách, hỏi 3 câu:

1. Trong thi công và BOQ, hai loại có dùng thay nhau được không?
2. Đơn giá có chênh nhau quá khoảng 10% không?
3. Hệ số quy đổi có khác nhau không (kg/cây, m/cuộn, viên/m2)?

| Kết quả | Cách làm | Ví dụ |
|---|---|---|
| Cả 3 câu đều "không khác" | **Cùng mã + quy cách** | Thương hiệu (Hòa Phát / Việt Nhật), xuất xứ, màu sơn, cách đóng gói, mác tương đương |
| Có 1 câu "khác" | **Mã riêng** | D8 với D10; ống 113,5x4 ly với 141,3x3,96 ly; bulong M20x300 với M20x500 |

Lý do không gộp các loại "khác":
- Giá bình quân cuối kỳ và MISA chỉ biết mã, nên mọi quy cách của cùng một mã sẽ chung một giá xuất. Giá chênh nhiều thì chi phí dự án bị sai.
- Hệ số quy đổi khác nhau thì đặt theo kg nhưng nhận theo cây sẽ ra số sai. Đây chính là lỗi đã gặp ở việc 1 (MR-2026-2671).
- BOQ so theo mã. Gộp hai kích thước thì không còn so được.

Ví dụ của chủ SP, "Thép XD D8 – 2mm / 4mm": nếu 2mm/4mm làm khác trọng lượng hoặc giá thì nên là 2 mã riêng. Nếu chỉ là nhãn nhận diện thì dùng quy cách.

### 9.3 Thiết kế để dữ liệu không xung đột

| Vấn đề | Cách chặn |
|---|---|
| Cùng một quy cách viết nhiều kiểu ("CB240", "cb 240", "CB-240") | Quy cách là **danh sách có kiểm soát của từng mã**, không phải chữ tự do. Hệ thống tự chuẩn hóa để so: chữ thường, bỏ dấu cách thừa, coi `x` / `*` / `×` là một, dấu phẩy thập phân là dấu chấm, `ly` = `mm`. Mỗi mã không được có 2 quy cách trùng sau chuẩn hóa |
| Mua hàng cần quy cách mới ngay khi lập đơn | Gõ vào ô quy cách thì hệ thống gợi ý các quy cách đã có của mã đó. Nếu chưa có thì tạo ngay, gắn nhãn **"mới"**, không chặn đơn. Người cấp mã rà lại trong Danh mục: giữ, sửa chữ, hoặc gộp vào quy cách có sẵn |
| Gõ quy cách mà thực chất là vật tư khác (ví dụ "D10" trong mã D8) | Nếu con số trong quy cách khác con số kích thước trong tên mã thì cảnh báo "có thể là vật tư khác — đề xuất mã mới" |
| Ghi chú bị gõ vào ô quy cách | Tách ô **Quy cách** (ngắn, tối đa ~40 ký tự, có gợi ý) với ô **Ghi chú** (tự do) |
| Đổi tên mã hoặc quy cách làm sai chứng từ cũ | Mỗi dòng chứng từ lưu mã, mã quy cách, **và bản chụp tên đầy đủ lúc lập**. Phiếu in luôn đúng tên đã mua, danh mục đổi cũng không ảnh hưởng |
| Tồn của mã và tồn từng quy cách lệch nhau | Sổ kho ghi tồn theo (mã, quy cách, kho). Tồn của mã = cộng các quy cách, không lưu riêng |
| Nhập nhầm quy cách | Lập phiếu **chuyển quy cách**: xuất quy cách A, nhập quy cách B, cùng mã, cùng giá, có lý do. Không sửa đè phiếu nhập |
| Gộp hai quy cách trùng | Chuyển tồn và lịch sử sang quy cách chính bằng bút toán nội bộ, có nhật ký. Quy cách phụ chuyển "ngừng dùng" |
| Ngừng dùng quy cách còn tồn | Chặn. Chỉ ngừng được khi tồn bằng 0 ở mọi kho |

### 9.4 Quy cách đi qua từng khâu

| Khâu | Theo mã gốc | Theo quy cách |
|---|---|---|
| BOQ, kế hoạch vật tư, đề xuất | ✔ (so BOQ cộng theo mã) | Không bắt buộc, có thể ghi "yêu cầu quy cách" |
| Đơn mua, đợt giao | ✔ | ✔ Chọn hoặc tạo; in "tên – quy cách" |
| Nhập kho | ✔ | ✔ Lấy theo đợt giao, thủ kho sửa được nếu hàng về khác |
| Tồn kho | Dòng tổng | Bấm mở ra từng quy cách |
| Xuất, chuyển kho | ✔ | ✔ Chọn quy cách, thấy tồn từng quy cách; mặc định gợi ý quy cách nhập trước |
| Kiểm kê | ✔ | ✔ Đếm theo quy cách |
| Giá bình quân cuối kỳ | ✔ (khớp MISA) | Chung giá với mã |
| Kết xuất MISA | ✔ Mã, tên gốc | Ghi vào cột diễn giải |

**Dữ liệu cũ:** không tự gộp 1.516 mã, vì phần lớn các họ mã (ống, hộp, bulong…) là kích thước khác nhau, để mã riêng là đúng. Chỉ gộp các cặp trùng thật (9 tên trùng, M24\*650 / M24x650) bằng chức năng Gộp mã. Quy cách áp dụng cho các lần mua từ khi lên bản mới.

---

## 10. Câu hỏi mới (sau quyết định 03/10)

10. MISA của công ty tính bình quân cuối kỳ **theo từng kho** hay **gộp mọi kho**? Vioo cần tính giống để khớp số.
11. Từ 01/08, chị Thủy nhập **64/66 phiếu của Kho XHV**; anh Minh chỉ 2 phiếu. Sau khi bỏ "thủ kho toàn công ty":
    - (a) Chị Thủy làm thủ kho XHV (chỉ nhập liệu kho XHV), hay
    - (b) Giao hẳn cho anh Minh?
    - Đề xuất: đổi vai trò cùng lúc với đợt V1 (khi đã có 4 ô quyền mới), không đổi ngay, để không chặn việc ở XHV.
12. Chị Hương vừa là thủ kho Kho Tổng vừa khóa kỳ, trái luật tách nhiệm. Kho Tổng rất ít phát sinh (2 phiếu từ tháng 8), nên đề xuất: chị Hương vẫn khóa kỳ, nhưng phần Kho Tổng cần chị Mơ hoặc Admin xác nhận số tồn trước khi khóa. Đồng ý?
13. Gỡ ngay ô "Danh mục kho → Quản trị danh mục" (thêm/xóa vật tư) của 16 người, chỉ giữ Admin Hoàng, chị Mơ và chị Linh? Có 2 cách:
    - Anh tự gỡ trên màn Người dùng.
    - Em viết script chạy thử để anh xem danh sách, anh duyệt thì chạy thật.
14. Quy cách: đồng ý quy tắc 3 câu hỏi (mục 9.2)? Mua hàng được tạo quy cách mới ngay khi lập đơn (nhãn "mới", người cấp mã rà sau), đúng không ạ?
15. Ví dụ "Thép XD D8 – 2mm / 4mm": 2mm / 4mm nghĩa là gì? Có làm khác trọng lượng hay giá không? Nếu có thì nên là 2 mã riêng.

### Trả lời của chủ SP (03/10/2026)

| # | Quyết định |
|---|---|
| 10 | MISA tính bình quân cuối kỳ **theo từng kho** → Vioo tính giá cuối kỳ theo (mã, kho) |
| 11 | Kho XHV có **hai thủ kho: chị Thủy và anh Minh**. Ô "Thủ kho" phạm vi XHV cấp cho cả hai. Chị Thủy là thủ kho XHV nên không khóa kỳ (khóa kỳ: chị Hương) |
| 12 | Đồng ý: chị Hương khóa kỳ; riêng tồn Kho Tổng do chị Mơ hoặc Admin xác nhận trước khi khóa |
| 13 | Xem danh sách trước khi gỡ: script `revoke-master-data.mjs` (chạy thử, đóng vai từng người). Kết quả: 16 người, chưa ai từng thêm/sửa/xóa vật tư; sau khi gỡ vẫn đọc đủ 1.516 vật tư và 6 kho; 15/16 người mất quyền xóa. Chị Thủy vẫn còn quyền xóa vì vai trò "thủ kho toàn công ty", phần này hết khi đổi vai trò ở V1 |
| 14 | Đồng ý quy tắc 3 câu hỏi; Mua hàng được tạo quy cách mới khi lập đơn, nhãn "mới", người cấp mã rà sau |
| 15 | Đồng ý: nếu 2mm/4mm làm khác trọng lượng hoặc giá thì là 2 mã riêng |

---

## 11. Tiến độ V0 (03/10/2026)

| Việc | Kết quả | Script |
|---|---|---|
| Gỡ "Quản trị danh mục" của 16 người | **Đã làm.** Còn Admin Hoàng, chị Mơ, chị Linh. Có 16 dòng nhật ký phân quyền. Không ai mất quyền xem danh mục | `revoke-master-data.mjs` |
| V0-1 Kho Tổng + RICO về 0 | **Đã làm.** Phiếu điều chỉnh `tx-v0-clean-wh-1772607466735-0jnui` (27 dòng) và `tx-v0-clean-wh-1` (30 dòng). RICO: 17 dòng / −1,66 tỷ → 0. Kho Tổng: 19 dòng / −1,52 tỷ → 0. Dòng chỉ lệch giá trị ghi bằng cặp nhập/xuất 1 đơn vị (sổ kho chưa có loại dòng "chỉ điều chỉnh giá trị"; V3 sẽ thêm loại này cho bình quân cuối kỳ) | `v0-clean-kho-tong-rico.mjs` |
| V0-2 Đóng 33 phiếu xuất cấp | **Đã làm.** 33 phiếu (105 dòng) quyết toán "đã dùng" qua hàm của app, có lý do. Sổ kho không đổi (764 dòng). Trạng thái phiếu: đóng 3 → 36 | `v0-close-issue-orders.mjs` |
| V0-3 Phiếu treo | 22 phiếu mở, đã chia theo người xử lý (bên dưới) | — |
| V0-4 Kiểm kê SMB | Chờ xử lý xong phiếu treo SMB. Anh Luật lập phiên ở Kiểm kê, chị Mơ duyệt | — |

Kho Tổng sau khi dọn có tồn bằng 0. Nếu thực tế còn hàng, chị Hương lập phiếu nhập tồn đầu kỳ (cần duyệt).

**Phiếu treo theo người xử lý:**

| Nhóm | Phiếu | Ai làm | Làm gì |
|---|---|---|---|
| A. Đợt giao PO chưa nhận — 12 phiếu, ~6,85 tỷ | SMB: PO-143, PO-145 (1,34 tỷ), PO-272, PO-263, PO-261, PO-259 đợt 1/2/3 (2,36 tỷ), PO-390, PO-387 (0,68 tỷ). XHV: PO-429 (2,18 tỷ), PO-477 | Mua hàng (Mơ, Thu Hà) + thủ kho, qua **Mua hàng → Đối chiếu nhận hàng** | Hàng đã về thì nhập, lùi ngày theo ngày về thực tế. Hàng không về thì Mua hàng hủy hoặc dời đợt |
| B. Nhập trực tiếp NCC chưa xong — 5 phiếu SMB | ALC nhà xưởng 3 (102 tr), xốp PE (1,8 tr), cát tường rào (**giá 0**), vật tư điện "Công trình RICO" (**giá 0**), ALC (102 tr) | Anh Luật | Bấm Nhập kho, hoặc hủy nếu trùng / không về. 2 phiếu giá 0 cần bổ sung giá |
| C. Kho XHV — 2 phiếu | Nhận HĐ Phúc Nam (**giá 0**); xuất cấp cho tổ Vũ Văn Vui (chờ kho xuất) | Anh Minh / chị Thủy | Nhập hoặc hủy; xuất hoặc hủy |
| D. Xuất bulong dùng ngay — 3 phiếu SMB | Theo phiếu giao HĐ Hưng Thịnh | Anh Luật | Hủy (đã chốt 03/10) |

---

## 12. V1 — Tồn kho + Danh mục + Người phụ trách (mockup 03/10/2026)

Mockup: `.superpowers/review/work-plan/v1-kho.html` (dữ liệu `tools/v1-data.mjs` + `tools/kho-data.mjs`, sau V0). Quy cách của Thép XD D8 là minh họa.

**Phát hiện thêm (L13) — đổi tên mã đã dùng:**
- Có 27 lần đổi tên mã. 12 lần đổi trên mã đã có chứng từ.
- Phần lớn chỉ ghi rõ thêm (ví dụ "Mũ vàng công nhân" → "Mũ bảo hộ vàng CN").
- Nhưng có lần **đổi hẳn bản chất**:
  - "Chếch PVC 125" → "Chếch PVC 250": đã có 2 dòng đề xuất.
  - "Máng xối inox" → "Phụ kiện tôn (cái)": đã có 7 dòng đơn mua.
  - Mã "chờ" đổi qua lại để dùng lại cho vật tư khác.
- Hệ quả: chứng từ cũ hiện tên mới, nên đọc lịch sử sẽ hiểu sai.

**Phạm vi V1:**

| Màn | Có gì |
|---|---|
| Tồn kho | Số lấy thẳng từ sổ kho; bỏ bản sao trong danh mục và badge 1.438. Dải chỉ số: giá trị tạm tính, đang về, chậm luân chuyển, chưa có giá, cần kiểm tra. Lọc theo kho / nhóm, tìm không cần dấu, xuất Excel. Mở ra từng quy cách. Panel bên phải gồm: thẻ kho (theo ngày chứng từ), tồn ở kho khác, quy cách, cảnh báo kèm cách xử lý. Nút Xuất / Chuyển / Kiểm đếm mở màn hiện có, điền sẵn vật tư (V2 sẽ làm ngay tại chỗ) |
| Danh mục vật tư | Tất cả 1.516 mã, cùng các hàng đợi: đề xuất chờ cấp mã, cần đặt cách quản lý (33 mã gợi ý, đặt hàng loạt), đổi tên khi đã dùng, tên trùng, ĐVT viết khác. Chi tiết mã gồm: ĐVT kho, ĐV mua × hệ số, cách quản lý, quy cách (chuẩn hóa, báo trùng, cảnh báo khác kích thước, gộp), tồn theo kho, nhật ký. Thao tác: Sửa, Gộp, Ngừng dùng (khóa khi còn tồn hoặc đang trong đơn mua). **Không có nút Xóa** |
| Sửa tên mã đã phát sinh | Phải chọn "Sửa chính tả, cùng vật tư" hoặc "Vật tư khác → tạo mã mới / quy cách". Nhật ký ghi tên cũ → tên mới. **Mọi chứng từ lưu tên lúc lập** |
| Đề xuất mã mới (mọi người) | Gợi ý mã gần giống, tìm không cần dấu. Tên trùng sau chuẩn hóa thì khóa nút gửi. Có ô Quy cách riêng |
| Thiết lập → Người phụ trách | 4 việc: thủ kho theo từng kho (nhiều người / nhiều kho), cấp mã, duyệt ngoại lệ, kế toán kho. Hiện màu thêm / gỡ so với hiện trạng. Cảnh báo tách nhiệm. Lưu có hộp xác nhận và nhật ký phân quyền. Cùng dữ liệu với Cài đặt → Người dùng |
| Dọn kèm | Bỏ "Thêm mới" và "Excel nhập mới" ở màn Tồn kho; khóa thêm/xóa vật tư ở Cài đặt → Dữ liệu gốc. Bỏ vai trò "thủ kho toàn công ty" khi lưu Người phụ trách. Bỏ menu Dashboard và Đề xuất vật tư |

**Câu hỏi V1:**
16. Trong 12 lần đổi tên mã đã dùng: tách mã cho 2 lần đổi bản chất (Chếch PVC 125 → 250, Máng xối inox → Phụ kiện tôn), các lần còn lại coi là ghi rõ thêm. Đồng ý?
17. Mã mới vẫn theo dạng **VT + số tăng dần** (VT0001900…) như hiện nay cho khớp MISA, hay đổi sang tiền tố theo nhóm? Đề xuất giữ VT + số.
18. Ở V1, nút Xuất / Chuyển trên Tồn kho mở màn Nhập/Xuất cũ, điền sẵn vật tư. Làm ngay tại chỗ để đến V2. Đồng ý?
19. Màn Người phụ trách: chỉ Admin sửa, chị Mơ chỉ xem; hay chị Mơ cũng được sửa phần thủ kho?
20. 33 mã gợi ý đổi cách quản lý (bê tông, Base, dầu, dịch vụ…): chị Mơ duyệt danh sách trong màn Danh mục sau khi V1 lên, hay em lập danh sách để anh duyệt trước khi deploy?

---

## 13. V1-1 — đã code (03/10/2026)

Chủ SP duyệt 16–21 (19: chỉ Admin sửa Người phụ trách). V1 tách 3 PR:
- **V1-1 (PR này):** danh mục một cửa, Tồn kho một nguồn số, menu 8 → 5.
- **V1-2:** Người phụ trách, gồm thủ kho theo kho, duyệt ngoại lệ, kế toán kho.
- **V1-3:** quy cách xuyên suốt và gộp mã.

**Migration `20261008137100_wms_v1_catalog_stock.sql`:**
- Vật tư có thêm trạng thái Đang dùng / Ngừng dùng và cách quản lý kho (`items.status`, `items.inventory_mode`). Có nhật ký `item_catalog_events`.
- Thêm ô quyền **Danh mục kho → Cấp mã** (`wms.master_data.issue_code`).
- Chặn ở tầng dữ liệu:
  - Không ai xóa được vật tư, kể cả Admin.
  - Sửa mã, tên, ĐVT, nhóm, quy đổi, trạng thái chỉ đi qua hàm.
  - Chỉ người Cấp mã / Admin tạo được mã (bỏ quyền tạo của "Sửa tồn kho", "Quản trị danh mục", Cài đặt dữ liệu gốc).
  - Đề xuất cấp mã chỉ xử lý qua hàm.
- Các hàm cấp mã: cấp mã (VT + 7 số, bắt đầu từ VT0001866; chặn trùng tên sau chuẩn hóa), dùng mã có sẵn / từ chối, sửa, ngừng dùng / mở lại, đặt cách quản lý hàng loạt.
- Các hàm đọc: danh mục, chi tiết mã, tồn kho từ sổ kho, thẻ kho.

**Luật đổi tên mã đã có chứng từ:**
- Bắt buộc lý do.
- Chặn khi tên mới làm mất con số kích thước của tên cũ, hoặc độ giống < 0,2.
- Không đổi được ĐVT.

**Đã kiểm trên production trong giao dịch hoàn tác** (`tools/v1-test.mjs`), đạt toàn bộ:
- Cấp mã → VT0001866. Trùng tên "thep xd  D8" → chặn.
- Dùng mã có sẵn; từ chối thiếu lý do → chặn.
- Sửa chính tả mã đã dùng → qua. D8 → "D10 cuộn" → chặn. "Máng xối inox 304" → chặn. Đổi ĐVT → chặn.
- Ngừng dùng mã còn tồn → chặn; mã chưa dùng → ngừng / mở lại được.
- Admin xóa thẳng → chặn. Sửa tên thẳng → chặn. Sửa giá → vẫn được.
- Anh Luật không cấp mã được; insert thẳng → RLS chặn.
- Tồn kho từ sổ = 12,26 tỷ.

**Giao diện:**
- Tồn kho mới, giữ nguyên nhận hàng bằng QR.
- Danh mục vật tư mới.
- Xuất / Chuyển mở màn Nhập/Xuất cũ, điền sẵn vật tư và kho.
- Cài đặt → Dữ liệu gốc → "Danh mục vật tư" chuyển sang màn mới.
- Menu: Tồn kho · Phiếu kho · Kiểm kê · Danh mục vật tư · Báo cáo. Đồng bộ MISA mở từ Báo cáo (Admin).
- Ô chọn vật tư của phiếu kho ẩn mã ngừng dùng.
- Bỏ 3 hộp thoại cũ: thêm, sửa, xóa vật tư.

**Câu 16, xem lại trên dữ liệu:**
- "Chếch PVC 125 → 250" và "Máng xối inox → Phụ kiện tôn (cái)" được đổi tên **trước khi** mã có chứng từ nào. Mọi đề xuất / đơn mua lập sau đó và mang đúng tên mới, nên lịch sử không sai và **không cần tách mã**.
- Chỉ 8 lần đổi tên xảy ra khi mã đã có chứng từ, cả 8 đều là ghi rõ thêm. Hàng đợi "Đổi tên khi đã có chứng từ" chỉ tính các lần này.
- Mã "Phụ kiện tôn (cái)" đang gom 7 dòng đơn mua với số lượng khác nhau (4, 122, 70, 70, 2.904, 242, 144) — có thể là 7 phụ kiện khác nhau dùng chung một mã. Sẽ xử lý bằng quy cách (V1-3) hoặc tách mã.

**Danh sách 33 mã đề xuất đặt cách quản lý kho (câu 20 — chờ chủ SP duyệt, chạy khi deploy):**

| Mã | Tên | ĐVT | Nhóm | Đề xuất | Đang tồn |
|---|---|---|---|---|---|
| VT0001061 | Chi phí bơm cần (ca) | Ca | DV | Không qua kho | — |
| VT0001060 | Chi phí bơm cần (m3) | m3 | DV | Không qua kho | 65 |
| VT0001056 | Chi phí bơm tĩnh (ca) | Ca | DV | Không qua kho | — |
| VT0001055 | Chi phí bơm tĩnh (m3) | m3 | DV | Không qua kho | 26 |
| VT0001340 | Chi phí ca chờ bơm | Ca | VTTC-XD | Không qua kho | — |
| VT0001057 | Chi phí chuyển chân bơm | Lần | DV | Không qua kho | — |
| VT0001062 | Chi phí đổ bê tông quá giờ | Lần | DV | Không qua kho | — |
| CPMH | Chi phí mua hàng | Lần | DV | Không qua kho | — |
| VT0001094 | Chi phí phụ tải xe bê tông <5m3 | Lần | VTTC-XD | Không qua kho | — |
| CPVC | Chi phí vận chuyển | Lần | DV | Không qua kho | 2 |
| LPXD | Lệ phí xăng dầu | Lần | DV | Không qua kho | — |
| VPP000001 | Mực MáyIn HP LaserJet MFP M440DN | Hộp | DV | Không qua kho | — |
| KHACHSAN_PHI_PHUCVU | Phí phục vụ | Lần | DV | Không qua kho | — |
| VT0001634 | Thuê máy đào bánh xích 55 | Giờ | DV | Không qua kho | — |
| VT0001168 | Thuê máy đầm cóc | Giờ | DV | Không qua kho | — |
| VT0000856 | Thuê máy lu rung 12T | Giờ | DV | Không qua kho | — |
| VT0001158 | Thuê máy lu tĩnh 12T | Giờ | DV | Không qua kho | — |
| VT0001139 | Thuê máy ủi D31 | Giờ | DV | Không qua kho | — |
| VT0001138 | Thuê máy xúc 140 bánh lốp | Giờ | DV | Không qua kho | — |
| VT0001753 | Thuê máy xúc PC120 | Giờ | DV | Không qua kho | — |
| VT0000855 | Thuê máy xúc PC50 | Giờ | DV | Không qua kho | — |
| VT0001698 | Thuê xe cẩu | Ca | DV | Không qua kho | — |
| VT0001754 | Thuê xe chuyển tải ngoài công trường | m3 | DV | Không qua kho | — |
| VT0001639 | Thuê xe chuyển tải trong công trường | Chuyến | DV | Không qua kho | — |
| VT0000840 | Base A | m3 | VTTC-XD | Dùng ngay | — |
| VT0000841 | Base B | m3 | VTTC-XD | Dùng ngay | 1861,5 |
| VT0000845 | Bê tông thương phẩm M100 | m3 | VTTC-XD | Dùng ngay | — |
| VT0000846 | Bê tông thương phẩm M200 | m3 | VTTC-XD | Dùng ngay | — |
| VT0000847 | Bê tông thương phẩm M250 | m3 | VTTC-XD | Dùng ngay | 23,5 |
| VT0000848 | Bê tông thương phẩm M300 | m3 | VTTC-XD | Dùng ngay | — |
| VT0000849 | Bê tông thương phẩm M350 | m3 | VTTC-XD | Dùng ngay | 1272,5 |
| VTM019 | Dầu Diezel | Lít | VTTC-XD | Dùng ngay | 2490 |
| VT0000929 | Dầu DO | Lít | VTTC-TH | Dùng ngay | 400 |

Lưu ý khi duyệt:
- **Mực máy in HP** đang ở nhóm DV nhưng là hàng thật → đề xuất giữ **Lưu kho**.
- **Dầu Diezel / Dầu DO**: SMB đang tồn 2.490 L. Nếu trữ trong bồn và cấp dần cho máy thì giữ **Lưu kho**; nếu mua về là đổ thẳng vào máy thì **Dùng ngay**.

**Việc chạy khi deploy (cần duyệt):**
1. Cấp ô Cấp mã cho chị Mơ và chị Linh.
2. Đặt cách quản lý cho danh sách trên (sau khi anh chốt).
3. Sau khi deploy: refresh fixture quyền, gỡ mục tạm trong `permissionCatalogContract.test.ts`.

**Còn lại:** dòng tồn của "Thép D8" (mã đã xóa) ở Kho SMB có số lượng 0 nhưng còn giá trị 90 triệu → xử lý ở V3 (điều chỉnh giá trị).


**Chủ SP duyệt 03/10/2026:** deploy + merge #88. Dầu Diezel, Dầu DO, mực máy in giữ **Lưu kho**. Còn 30 mã đặt theo danh sách: 7 Dùng ngay (Base A/B, bê tông M100–M350), 23 Không qua kho. Cấp "Đề xuất vật tư → Tạo" cho thủ kho Luật, Minh để gửi đề xuất mã mới. Script chạy sau deploy: `.superpowers/review/work-plan/v1-deploy-data.mjs` (đã chạy thử kèm migration trong giao dịch hoàn tác: đạt).

---

## 14. V1-2 — Người phụ trách kho (mockup 03/10/2026)

V1-1 đã lên production và đã merge (#88, main ebca25f). Chủ SP đã kiểm màn Tồn kho và Danh mục: "OK hết rồi".

Mockup: `.superpowers/review/work-plan/v12.html` (dữ liệu thật qua `tools/v12-data.mjs`).

**Màn Kho vật tư → Thiết lập → Người phụ trách.** Chỉ Admin sửa; người khác chỉ xem.
- **Theo kho & việc:**
  - Mỗi kho một thẻ: danh sách thủ kho (thêm / bỏ), những người đang lập phiếu từ 01/08 kèm số phiếu, và các quyền lẻ của kho (chọn "Thành thủ kho" hoặc "Gỡ").
  - Bên phải là 3 việc toàn công ty: Cấp mã, Duyệt ngoại lệ, Kế toán kho (có ô chọn người khóa kỳ). Bên dưới là cảnh báo tách nhiệm và nhật ký phân công.
- **Theo người:** bảng người × 4 việc. Bấm một người để chỉnh, có nút điền theo mẫu Thủ kho / GĐ vật tư / Kế toán kho.
- Lưu một lần, có hộp xác nhận liệt kê từng thay đổi, có nhật ký phân quyền. Dữ liệu dùng chung với Cài đặt → Người dùng.

**Hiện trạng thật (03/10):**
- Thủ kho theo vai trò cũ: Luật–SMB, Minh–XHV. "Thủ kho toàn công ty": Linh, Mơ, Thủy.
- Quyền lẻ theo kho:
  - Đặng Thị Hương: tạo / duyệt / hoàn tất phiếu ở Kho VPP.
  - Nguyễn Duy Đảng: sửa tồn, hoàn tất phiếu ở XHV.
  - Đoàn Văn Dương: duyệt phiếu ở XHV.
- Luật và Minh có "Tạo phiếu" cho **mọi kho**; Minh có thêm "Sửa tồn" mọi kho.
- Cấp mã: Mơ, Linh. Duyệt ngoại lệ: chỉ Admin. Kế toán kho: chưa có ai. 37 người xem được tồn kho.

**Bộ đề xuất (9 thay đổi):**
- Thủ kho: Kho Tổng → Đặng Thị Hương; XHV → thêm Thủy (cùng Minh).
- Duyệt ngoại lệ → Mơ.
- Kế toán kho → Nguyễn Thị Hương, Thủy. Người khóa kỳ: Nguyễn Thị Hương.
- Bỏ vai trò "thủ kho toàn công ty" của Linh, Mơ, Thủy.

**Câu hỏi V1-2:**
21. "Chị Hương nhận Kho Tổng" là **Đặng Thị Hương** (đang giữ Kho VPP), còn **Nguyễn Thị Hương** (KTT) làm kế toán kho và khóa kỳ — đúng không ạ? Nếu đúng thì không vướng tách nhiệm ở Kho Tổng.
22. Quyền lẻ ở XHV: anh Đoàn Văn Dương (duyệt phiếu) và anh Nguyễn Duy Đảng (sửa tồn, hoàn tất phiếu) — cho làm thủ kho XHV, hay gỡ?
23. Thu "Tạo phiếu" / "Sửa tồn" đang cấp cho mọi kho của anh Luật và anh Minh về đúng kho mình (SMB / XHV)?
24. Kho RICO chưa có thủ kho: để trống (chỉ Admin thao tác) cho tới khi có người?
25. Khi lưu, vai trò tài khoản "thủ kho" của Linh, Mơ, Thủy, Luật, Minh chuyển thành "Nhân viên". Quyền kho từ đó chỉ đi theo 4 việc trên. Đồng ý?
26. Màn Người phụ trách: mọi người có quyền xem kho đều xem được để minh bạch, chỉ Admin sửa. Đồng ý?

**Chủ SP trả lời 04/10/2026:**
- 21: đúng — Đặng Thị Hương giữ Kho Tổng; Nguyễn Thị Hương làm kế toán kho và khóa kỳ.
- 22: quyền lẻ của anh Dương và anh Đảng ở XHV, chủ SP tự xử lý.
- 23: đồng ý thu quyền "mọi kho" về đúng kho.
- 24: chủ SP đã tự xử lý quyền của anh Luật và anh Minh. Kho RICO để trống.
- 25, 26: đồng ý.
- Duyệt mockup, bắt đầu code.

## 15. V1-2 — đã code (04/10/2026)

**Migration `20261008137200_wms_v1_2_owners.sql`:**
- 4 ô quyền mới: `wms.transaction.keeper` (Thủ kho, theo kho), `wms.transaction.exception_approve` (Duyệt ngoại lệ), `wms.accounting.manage` (Kế toán kho), `wms.accounting.close_period` (Khóa kỳ).
- **9 hàm đang dựa vai trò "thủ kho" + kho được gán chuyển sang ô Thủ kho.** Script `tools/gen_v12.py` lấy định nghĩa đang chạy trên production rồi vá từng đoạn. Các hàm: `current_user_is_wms_keeper_for`, `current_user_is_global_wms_keeper`, `wms_warehouse_keepers`, `wms_user_has_action`, `can_read_inventory_scope`, `current_user_can_receive_purchase_batch_v2`, `stock_count_can_approve` (thêm Duyệt ngoại lệ), `process_transaction_status` (Duyệt ngoại lệ duyệt được xuất hủy / điều chỉnh), `list_wms_action_recipients`.
- Tự chuyển thủ kho đang gán theo vai trò + một kho thành ô Thủ kho đúng kho đó (Luật–SMB, Minh–XHV), để không mất nút thao tác trong lúc chờ.
- Trigger: phiếu xuất hủy / điều chỉnh chỉ người Duyệt ngoại lệ (hoặc Admin) duyệt, và người duyệt phải khác người lập (cả Admin).
- Hàm đọc / lưu màn Người phụ trách (`get_wms_owners_v1`, `save_wms_owners_v1`). Lưu chỉ Admin; nhật ký ghi `source = wms_owners`.

**Giao diện:**
- Thêm màn **Kho vật tư → Người phụ trách** (`/wms/owners`), có 2 cách xem: Theo kho & việc, Theo người.
- Các hàm kiểm thủ kho ở giao diện chuyển sang đọc ô quyền.
- Tab Xuất hủy mở cho thủ kho (lập phiếu) và người Duyệt ngoại lệ (duyệt).
- Thủ kho chỉ giữ một kho thì mặc định mở đúng kho của mình.
- Hộp sửa người dùng ẩn lựa chọn cũ "Tài khoản kho".

**Đã kiểm trên production trong giao dịch hoàn tác** (`tools/v12-test.mjs`), tất cả đạt:
- Bước chuyển đổi đúng; anh Luật xem được màn nhưng không lưu được.
- Admin lưu bộ đã duyệt: thêm 7 quyền; lưu lại lần nữa thêm 0.
- Chọn người khóa kỳ không phải kế toán kho → bị chặn.
- Chị Thủy chỉ thao tác được ở XHV, không duyệt được kiểm kê; chị Mơ duyệt được kiểm kê.
- Anh Luật duyệt xuất hủy → bị chặn. Chị Mơ duyệt phiếu của anh Luật → được. Chị Mơ tự duyệt phiếu của mình → bị chặn.

**Script chạy sau deploy:** `.superpowers/review/work-plan/v12-deploy-data.mjs` — đã chạy thử kèm migration, đạt.
- Áp bộ đã duyệt qua đúng hàm của màn.
- Đổi vai trò 5 người sang Nhân viên qua `change_user_account_role_v2`.
- Thu quyền "mọi kho". Sau đó không còn quyền thao tác kho nào ở phạm vi "mọi kho".

**Đã lên production 04/10/2026** (PR #90, main `2786da7`). Chủ SP tự chạy migration và script dữ liệu: thêm 7 quyền, 5 người sang Nhân viên, không còn quyền "mọi kho".

## 16. V1-3 — Quy cách + Gộp mã (mockup 04/10/2026)

Mockup: `.superpowers/review/work-plan/v13.html` (dữ liệu `tools/v13-data.mjs`, chỉ đọc). 4 cảnh: Gộp mã trùng · Quy cách của mã · Đơn mua ô Quy cách · Nhập kho & Tồn.

### 16.1 Phát hiện từ dữ liệu thật

- **20 nhóm tên giống nhau** sau khi bỏ dấu / dấu cách — nhưng không phải nhóm nào cũng trùng:
  - 11 nhóm trùng rõ (chỉ khác hoa thường, dấu cách, `*` / `x`): Đá 1x2 (3 mã), Đá 4x6, Đá hộc, Cát vàng, Bulong móng M24x650, Cáp CXV 4x35, Tôn sóng 0.4mm, Thép tròn trơn D20, Sơn kem Việt Tiệp, Mũi khoan côn/cần 27, Bi treo cửa xếp. Phần lớn có một mã chưa dùng lần nào.
  - 4 nhóm khác ĐVT: Bulong M16x50 / M16x60 / M20x50 / M24x60 — một mã "Cái", một mã "Bộ". Có thể là vật tư khác (bộ gồm đai ốc, long đen).
  - 4 nhóm khác chữ / dấu: "Bu lông móng" / "Bulong móng" M24x750 và M27x900 (cùng vật tư, cả hai mã đều có tồn ở SMB); nhưng "Con lăn sơn nhỏ / nhỡ" và "Tụ điện / Tủ điện" là **vật tư khác**.
  - 1 nhóm khác số: Cáp CXV 4x25 / 4x2.5 → không trùng, tự loại.
  - Ô "Tên trùng" của V1-1 đang so cả các cặp khác nhau này → V1-3 phân loại lại, người Cấp mã quyết định.
- **9/297 dòng đơn mua ghi tên khác tên mã:** "Bật mực màu đen", "Mỡ bò chịu nhiệt - 1 thùng 30 tuýp" (đúng là quy cách); "Dây cáp **D16**" ghi trên mã **D14** (vật tư khác); "Thuê xe cẩu 15 tấn phục vụ…" (là ghi chú); ô quy cách PO-384 ghi cả câu giải thích (là ghi chú).
- **"Phụ kiện tôn" gom 9 vật tư khác nhau** trên PO-334, giá từ 5.500 đến 96.000 đ. Theo quy tắc 3 câu đây không phải quy cách, nên tách mã cho lần mua sau. Đơn cũ giữ nguyên.

### 16.2 Gộp mã — cách làm đề xuất

- **Không sửa lịch sử.** Sổ kho, phiếu, đơn mua đã xong của mã phụ giữ nguyên. Thẻ kho mã giữ hiện kèm, nhãn "từ mã …".
- **Tồn chuyển bằng phiếu gộp mã** (có ghi sổ): xuất khỏi mã phụ, nhập vào mã giữ, cùng kho, **giữ nguyên giá trị**.
- **Kế hoạch chuyển sang mã giữ:** dòng BOQ / ngân sách vật tư, đề xuất đang mở → so BOQ cộng chung.
- **Chặn gộp** khi mã phụ còn: đơn mua chưa xong, phiếu kho chờ duyệt / đang chuyển, hợp đồng nguyên tắc NCC. Xử lý xong (hoặc đổi dòng sang mã giữ) rồi gộp.
- Mã phụ thành "Đã gộp vào …"; gõ tìm mã cũ / tên cũ ra mã giữ. Không hoàn tác bằng một nút.
- Khác ĐVT: phải tick "đã kiểm: cùng vật tư, số lượng tính như nhau" mới gộp được. "Không phải trùng" bắt buộc ghi lý do, không hiện lại.
- Gợi ý mã giữ: mã có kế hoạch → đơn mua mở → phiếu chờ → có tồn → nhiều chứng từ hơn. Người dùng đổi được.

### 16.3 Quy cách — cách làm đề xuất

- **Danh mục, chi tiết mã:** danh sách quy cách kèm tồn từng kho, hàng đang về. Thao tác: Giữ (duyệt quy cách mới), Sửa chữ, Gộp vào…, Ngừng dùng (khóa khi còn tồn / đang về). Thêm quy cách có kiểm trùng sau chuẩn hóa và cảnh báo khác kích thước.
- **Ô "Quy cách chờ rà":** quy cách mới do Mua hàng / thủ kho tạo, có gợi ý: giữ làm quy cách / chuyển thành ghi chú / có thể là vật tư khác (đề xuất mã mới) / không cần quy cách.
- **Đơn mua:** ô Quy cách gợi ý quy cách có sẵn; gõ khác cách viết vẫn khớp ("hoa phat cb 300" → "Hòa Phát CB300"). Gõ mới → tạo nhãn "mới", không chặn đơn. Tối đa 40 ký tự; ô Ghi chú tách riêng. In "Tên – Quy cách".
- **Nhập kho:** quy cách lấy theo đợt giao, thủ kho đổi được nếu hàng về khác (người mua được báo).
- **Tồn kho:** dòng mã mở ra từng quy cách. Hàng nhập trước bản này nằm ở "Chưa ghi quy cách" — không tự đoán.
- **Chuyển quy cách:** phiếu nội bộ cùng mã, cùng giá, bắt buộc lý do. Dùng khi nhập nhầm, hoặc gắn quy cách cho hàng cũ sau khi kiểm thực tế.
- **Xuất / chuyển kho ở V1-3:** tự lấy quy cách nhập trước, in trên phiếu. Chọn tay ở V2 "Phiếu kho một màn". Kiểm kê theo quy cách ở V4.
- Giá bình quân và MISA: theo mã (như đã chốt).
- Dữ liệu cũ ô quy cách: PO-384 → chuyển sang Ghi chú; PO-375 "nối ống lưới D27" → giữ làm quy cách.

### 16.4 Câu hỏi cho chủ SP

28. Gộp mã theo 16.2: không sửa lịch sử, tồn chuyển bằng phiếu gộp mã giữ nguyên giá trị, chặn khi mã phụ còn đơn mua / phiếu đang mở. Đồng ý?
29. 4 cặp Bulong "Cái" / "Bộ" (M16x50, M16x60, M20x50, M24x60): thực tế "Bộ" có gồm đai ốc + long đen không? Nếu có → giữ 2 mã riêng.
30. Xuất kho ở V1-3 tự lấy quy cách nhập trước; chọn tay ở V2. Đồng ý?
31. Hàng cũ để "Chưa ghi quy cách", không tự gắn. Thủ kho muốn thì chuyển quy cách sau khi kiểm thực tế. Đồng ý?
32. "Phụ kiện tôn": lần mua sau cấp mã riêng cho phụ kiện mua thường xuyên (đai kẹp tôn seam, cóc kẹp, chặn trên dưới…), thứ lặt vặt một lần để "Không qua kho". Đồng ý?

### Trả lời của chủ SP (04/10/2026)

- 28–32: đồng ý tất cả. Bulong "Cái" / "Bộ" theo câu 29: chỉ gộp khi người Cấp mã xác nhận cùng vật tư.
- Yêu cầu thêm: một khu vực phân quyền kho "ai làm được gì" (ví dụ việc chị Linh, chị Mơ đang làm), để sau này chọn người khác cùng chức năng → mục 17.

## 17. Phân quyền kho (mockup 04/10/2026)

Mockup: `.superpowers/review/work-plan/v14.html` (dữ liệu `tools/v14-data.mjs`, chỉ đọc). Mở rộng màn **Người phụ trách** (V1-2) thành **Kho vật tư → Phân quyền kho**. Xem: mọi người có quyền xem kho; sửa: chỉ Admin.

### 17.1 Hiện trạng (dữ liệu thật)

- 25 ô quyền kỹ thuật cho kho (`wms.*`, `system.wms.*`, `settings.warehouses.*`); người dùng khó biết ô nào là việc gì.
- Chị Linh (Chuyên viên Vật tư): Cấp mã — 12 lần duyệt đề xuất mã từ 01/07. Chị Mơ: Cấp mã + Duyệt ngoại lệ. Cả hai còn ô cũ "Quản trị danh mục".
- **Ô cũ "Quản trị danh mục" (`wms.master_data.manage`) thực ra đang là quyền tạo / sửa / xóa kho** ở máy chủ (bảng `warehouses`, `warehouse_types`). Cài đặt dùng ô khác (`settings.warehouses.manage`) nên ẩn nút, nhưng máy chủ vẫn cho Admin, chị Linh, chị Mơ tạo / sửa / xóa kho. Thủ kho cũng đang ngầm có quyền này với kho mình giữ.
- **Chị Nguyễn Thị Hương** (Kế toán kho + Khóa kỳ) **không có quyền xem kho**.
- 27 ô quyền lẻ kiểu cũ còn cấp theo kho: 21 ô đã nằm trong Thủ kho (Luật 7, Minh 10, Đặng Hương 4); Dương 1, Đảng 2 chưa thuộc việc nào.
- Mẫu quyền ở Cài đặt → Người dùng: "Quản lý kho" (18 ô kho cũ) và "Cán bộ vật tư, kho" (tạo phiếu…) — áp cho người mới sẽ cấp lại quyền thao tác **mọi kho** đã dọn ở V1-2.

### 17.2 Thiết kế: giao 8 việc, theo bậc

| Bậc | Việc | Phạm vi | Làm được gì | Đang giữ |
|---|---|---|---|---|
| Xem | Xem kho | mọi kho / từng kho | Tồn, thẻ kho, phiếu, danh mục | 35 mọi kho; Luật, Minh theo kho |
| Đề xuất | Đề xuất mã mới | công ty | Gửi đề xuất mã | Thủ kho, Cấp mã tự có |
| Thao tác | Thủ kho | từng kho | Nhập, xuất, chuyển, kiểm kê, lập xuất hủy | Luật, Minh, Thủy, Đặng Hương |
| Danh mục | Cấp mã | công ty | Cấp mã, sửa / ngừng dùng, quy cách, gộp mã | Linh, Mơ |
| Duyệt | Duyệt ngoại lệ | công ty | Xuất hủy, điều chỉnh, chênh lệch kiểm kê | Mơ (Admin luôn có) |
| Ghi sổ | Kế toán kho | công ty | Bổ sung giá, đảo phiếu, MISA | Nguyễn Thị Hương, Thủy |
| Ghi sổ | Khóa kỳ | một người | Khóa sổ tháng | Nguyễn Thị Hương |
| Quản trị | Quản lý danh sách kho | công ty | Tạo / sửa / đóng kho | Admin, Linh, Mơ (qua ô cũ) |

- Cấp mã, Duyệt ngoại lệ, Kế toán kho tự kèm Xem mọi kho. Thủ kho tự kèm Xem kho mình giữ và Đề xuất mã.
- "Phân quyền kho" (màn này) luôn chỉ Admin.

### 17.3 Ba cách xem

1. **Theo việc**: thẻ từng việc theo bậc, thêm / bỏ người ngay trên thẻ.
2. **Theo người**: bảng người × việc. Bấm một người → ngăn kéo:
   - **Điền theo mẫu chức năng**: Người xem kho · Thủ kho · Chuyên viên Vật tư (như chị Linh) · Phụ trách Vật tư (như chị Mơ) · Kế toán kho (như chị Thủy) · Kế toán trưởng (như chị Nguyễn Thị Hương). Chọn "thêm vào việc đang có" hoặc "thay việc đang có".
   - **Giống một người**: chép đúng các việc của người đó.
   - **Bàn giao**: chuyển hết việc kho của người này sang người khác trong một lần, tùy chọn giữ Xem kho.
   - Tick từng việc, từng kho để chỉnh riêng.
3. **Quyền cũ cần dọn**: gom theo người + kho; gỡ ô đã nằm trong Thủ kho; "Cho làm Thủ kho" hoặc gỡ ô chưa thuộc việc nào.

Lưu một lần, xem trước danh sách thêm / gỡ, có nhật ký (dùng tiếp `save_wms_owners_v1` mở rộng). Tách nhiệm giữ như V1-2.

### 17.4 Câu hỏi cho chủ SP

33. Đổi "Người phụ trách" thành "Phân quyền kho", giao theo 8 việc như bảng 17.2. Đồng ý?
34. 6 mẫu chức năng + "Giống một người" + "Bàn giao" như 17.3. Đồng ý?
35. Quản lý danh sách kho (tạo / sửa / xóa kho): chị Linh, chị Mơ đang có qua ô cũ. Đề xuất chỉ Admin. Anh muốn giữ ai?
36. Gỡ 21 ô lẻ đã nằm trong Thủ kho (không mất thao tác nào). Dương / Đảng: anh tự bấm trên màn này. Đồng ý?
37. Mẫu ở Cài đặt → Người dùng: phần kho chỉ còn Xem kho; việc kho khác giao ở màn này. Đồng ý?

### Trả lời của chủ SP (04/10/2026)

- 33, 34, 36, 37: đồng ý. 35: Quản lý danh sách kho **chỉ Admin**. Bắt đầu code.

## 18. Phân quyền kho — đã code (04/10/2026)

**Migration `20261008137300_wms_access_jobs.sql`** (sinh bằng `tools/gen_v12b.py` + `v12b_template.sql`, vá định nghĩa đang chạy trên production):
- `app_private.wms_keeper_excluded_action`: thủ kho **không còn ngầm có** việc quản trị / ghi sổ ở kho mình giữ — Quản lý danh sách kho, Cấp mã, Duyệt ngoại lệ, Kế toán kho, Khóa kỳ, Hủy duyệt. Vá `wms_has_action` và `wms_user_has_action`. Thao tác thủ kho giữ nguyên (lập phiếu, quyết toán xuất cấp…).
- `get_wms_access_v1` / `save_wms_access_v1`: đọc / lưu 8 việc. Lưu chỉ Admin; đối chiếu đủ cho các việc; Xem kho chỉ đổi người được thêm / bỏ; Cấp mã / Duyệt ngoại lệ / Kế toán kho tự kèm bộ Xem mọi kho; dòng quyền đã thu hồi trước đây được kích hoạt lại (bảng quyền giữ một dòng cho mỗi người + ô + phạm vi); gỡ ô lẻ kiểu cũ theo danh sách Admin chọn; bỏ hết Xem kho mà không còn việc thì gỡ luôn ô vào phân hệ Kho. Nhật ký `source = wms_owners` như V1-2.
- Mẫu quyền ở Cài đặt → Người dùng: phần kho chỉ còn 3 ô Xem (6 mẫu).

**Giao diện:** Kho vật tư → **Phân quyền kho** (đường dẫn cũ `/wms/owners`, thay màn Người phụ trách). Logic thuần ở `lib/wmsAccess.ts` (đọc việc từ ô quyền, mẫu chức năng, giống một người, bàn giao, ô lẻ cũ, dòng thay đổi), màn `components/wms/WmsAccessView.tsx`.

**Đã kiểm trên production trong giao dịch hoàn tác** (`tools/v12b-test.mjs`):
- Anh Luật: vẫn lập phiếu, quyết toán xuất cấp ở SMB; không còn sửa / xóa kho, không duyệt ngoại lệ; xem được màn, không lưu được.
- Admin lưu bộ đã duyệt: thêm 13, gỡ 19; lưu lại lần nữa 0 / 0.
- Sau lưu: chị Linh không còn sửa / xóa kho, vẫn Cấp mã; chị Nguyễn Thị Hương xem được kho; 6 mẫu Cài đặt chỉ còn ô Xem.
- Bỏ một người khỏi Xem kho → gỡ bộ Xem + ô vào phân hệ. Người khóa kỳ không phải kế toán kho → bị chặn.

**Script chạy sau deploy:** `.superpowers/review/work-plan/v12b-deploy-data.mjs` (đã chạy thử kèm migration, đạt): gỡ 17 ô lẻ đã nằm trong Thủ kho, gỡ quyền sửa / xóa kho của chị Linh, chị Mơ, cấp bộ Xem cho chị Nguyễn Thị Hương, bổ sung ô còn thiếu trong bộ Xem của vài người. Còn lại 3 ô lẻ của Dương / Đảng — chủ SP tự xử lý trên màn.

**Đã lên production 04/10/2026** (PR #92, main `4b874ad`): thêm 13, gỡ 19 quyền; Quản lý danh sách kho chỉ Admin; chị Nguyễn Thị Hương xem được kho.

## 19. V1-3a — Gộp mã trùng, đã code (04/10/2026)

**Migration `20261008137400_wms_v1_3a_catalog_merge.sql`** (sinh bằng `tools/gen_v13a.py` + `v13a_template.sql`):
- `items.merged_into_id` (chỉ khi ngừng dùng), bảng `catalog_duplicate_dismissals` ("không phải trùng", có lý do).
- `get_catalog_duplicates_v1`, `preview_catalog_merge_v1`, `merge_catalog_items_v1`, `dismiss_catalog_duplicate_v1`.
- Gộp: mỗi kho một phiếu điều chỉnh (xuất mã phụ, nhập mã giữ, cùng giá bình quân của mã phụ → giữ nguyên giá trị); dòng ngân sách vật tư / kế hoạch / quy tắc kế hoạch chuyển sang mã giữ; mã phụ "Đã gộp vào …". Không sửa sổ kho hay phiếu cũ.
- Chặn: đơn mua chưa xong, đề xuất chưa xong, phiếu kho chờ, hợp đồng nguyên tắc chưa xong, tồn âm / giá trị treo, cùng kế hoạch có cả hai mã; khác số kích thước; khác ĐVT chưa xác nhận. Chỉ người Cấp mã / Admin.
- Thẻ kho mã giữ hiện kèm lịch sử mã đã gộp ("từ VTM008").
- **Sửa thêm:** thủ kho và người chỉ xem một kho trước đây không mở được Danh mục vật tư, không gửi được đề xuất mã (màn chỉ nhận quyền "mọi kho"). Nay thủ kho / người xem kho bất kỳ xem được danh mục; thủ kho gửi được đề xuất mã.

**Giao diện:** Danh mục vật tư thêm ô **Có thể trùng** (phân loại Trùng / Cần xem — khác chữ / Cần xem — khác ĐVT / Tự loại vì khác số), khung so sánh chọn mã giữ (`components/wms/CatalogMergePanel.tsx`, logic `lib/wmsCatalogMerge.ts`). Mã đã gộp hiện "Đã gộp → mã giữ", không mở lại được. Ô chọn vật tư: gõ mã / tên cũ ra mã giữ.

**Đã kiểm trên production trong giao dịch hoàn tác** (`tools/v13a-test.mjs`):
- Gộp Bulong móng VTM008 (83 bộ) vào VT0000155 (75 bộ) → SMB còn 158 bộ ở mã giữ; thẻ kho 4 dòng, 2 dòng "từ VTM008".
- Ca có giá trị: 320 cuộn / 76,5 triệu chuyển nguyên vẹn sang mã giữ.
- Đá 1x2 (3 mã), Bulong M16x50 khác ĐVT (sau khi xác nhận) gộp được; Cáp 4x25 / 4x2.5 bị chặn khác số; mã có phiếu chờ / đơn mua mở bị chặn đúng lý do; anh Luật không gộp được nhưng xem được và gửi được đề xuất mã.

**Đã lên production 04/10/2026** (PR #94).

## 20. Ngày chứng từ + lưu vết nhập–xuất thẳng + đảo 4 phiếu bê tông (06/10/2026)

**Hiện trạng chủ SP hỏi:**
- PO-607 (HĐ nguyên tắc Hợp Thành, nhập–xuất thẳng) ghi đúng là không đổi tồn, nhưng **không để lại dòng nào trong sổ kho**. 7,5 m3 thấy trong thẻ kho là phiếu nhập tay cũ NK20260921-00526 (anh Luật nhập 13/09, ngày chứng từ 08/09) — cùng lô với PO-607. Thêm 3 phiếu nhập tay bê tông tường rào (12/09, 14/09, 20/09) → tồn ảo 23,5 m3.
- Ngày ghi sổ đã theo ngày thực tế, nhưng số phiếu lấy ngày bấm lưu: 229 phiếu số lệch ngày; 362 / 764 dòng sổ ghi lùi ngày.

**Chủ SP quyết:** đảo 4 phiếu nhập tay; nhập–xuất thẳng vẫn không lưu kho nhưng phải có lịch sử vật tư; làm gói "Ngày chứng từ" trước V1-3b.

**Migration `20261008137500_wms_document_date.sql`** (sinh bằng `tools/gen_vnd.py` + `vnd_template.sql`):
- Số phiếu mới theo ngày chứng từ (`next_inventory_ledger_code(direction, date)`); phiếu cũ giữ số.
- `set_wms_document_date_v1`: thủ kho của kho trên phiếu, Kế toán kho, Admin sửa ngày chứng từ; phiếu đã ghi sổ cần lý do, sổ kho dời theo; không ngày tương lai; không tạo âm tồn quá khứ; nhật ký `wms_document_date_events`.
- `post_inventory_ledger_entry`: phiếu xuất ghi lùi ngày không được tạo tồn âm mới trong quá khứ (dữ liệu cũ đang âm không bị khóa).
- Nhập–xuất thẳng: sổ kho ghi "nhập mua" + "xuất dùng thẳng" cùng ngày, cùng giá; bỏ qua dịch vụ ("Không qua kho"); bổ sung cho phiếu đã nhận (PO-607). Chi phí dự án vẫn chỉ tính từ đơn mua / công nợ.
- Thẻ kho trả thêm ngày nhập liệu và loại nghiệp vụ.

**Giao diện:** chi tiết phiếu ghi "Ngày chứng từ" + nút "Sửa ngày"; thẻ kho hiện "nhập liệu dd/mm" khi khác ngày chứng từ và nhãn "Xuất dùng thẳng".

**Đảo 4 phiếu nhập tay** (`.superpowers/review/work-plan/vnd-reverse-data.mjs`, chạy sau deploy): mỗi phiếu một phiếu điều chỉnh âm cùng ngày, cùng giá; phiếu gốc "Đã hủy" để kế toán không ghi công nợ (4 phiếu chưa ghi công nợ / chi phí). Tồn bê tông M250 SMB về 0.

**Đã kiểm trên production trong giao dịch hoàn tác** (`tools/vnd-test.mjs`): PO-607 có NK + XK (M250 7,5, M350 100; bỏ dòng bơm); anh Luật sửa ngày PO-607 về 08/09 (thiếu lý do / ngày tương lai bị chặn); dời phiếu nhập tháng 7 làm âm tồn → chặn; phiếu xuất ghi lùi trước khi hàng về → chặn; xuất hôm nay bình thường; đảo 4 phiếu → tồn 0, số phiếu đảo XK20260908…, kế toán hết phiếu chờ.
