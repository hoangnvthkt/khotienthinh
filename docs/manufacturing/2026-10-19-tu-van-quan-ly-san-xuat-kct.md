# Tư vấn: phần mềm quản lý sản xuất Nhà máy kết cấu thép Tiến Thịnh — mua, tích hợp hay xây trong Vioo

Ngày: 19/10/2026. Người hỏi: chủ SP. Bối cảnh: nhà máy 30.000 m², nhiều máy CNC / robot, chưa có phần mềm quản lý tổng thể; hiện chỉ dùng Vioo cho nhân sự, quy trình, đề xuất. Luồng: hợp đồng → kỹ sư Tekla bóc tách → mua thép tấm / thép hình → gia công theo tiến độ lắp dựng → phần không làm được thuê ngoài; đồng thời bán cho đơn vị khác. Kế thừa bản thiết kế `2026-10-05-steel-fabrication-and-procurement-design.md`.

## 1. Kết luận ngắn

**Làm phần "quản lý" trong Vioo, mua phần "máy" từ hãng máy.** Vioo đã có 6/10 khối mà phần mềm KCT thương mại bán (mua hàng, kho theo quy cách, tài chính, nhân sự, quy trình duyệt, tiến độ công trường) và có lợi thế không hãng nào có: **kế hoạch sản xuất bám tiến độ lắp dựng của chính công trường** trong cùng hệ thống. Phần không nên tự làm là nesting / CAM / điều khiển CNC — mua theo máy (SigmaNEST, ProNest, Lantek, VACAM, Steel Projects…) và nhận dữ liệu về Vioo bằng tệp. Tekla PowerFab / STRUMIS là chuẩn thế giới nhưng giá 10.000–50.000 USD+/năm, tiếng Anh, tách rời Vioo; chỉ đáng cân nhắc khi nhà máy lên vài nghìn tấn/tháng và cần chuỗi Tekla → xưởng khép kín do hãng bảo trì.

## 2. Thị trường

### Quốc tế (chuyên kết cấu thép)

| Phần mềm | Phù hợp | Có gì | Giá (bên thứ ba, cần hỏi hãng) |
|---|---|---|---|
| **Tekla PowerFab** (Trimble) | xưởng đã dùng Tekla, 100+ người | dự toán theo mô hình, quản lý dự án / bản vẽ / thay đổi, **nesting**, mua hàng, tồn kho + bãi, điều độ sản xuất, ghi nhận xưởng (PowerFab Go), giao hàng, dashboard; nối Peddinghaus, Ficep, Voortman, ProNest, SigmaNEST; Open API | quote; ~10.000–50.000 €/năm hoặc ~50.000 USD trọn đời |
| **STRUMIS** | xưởng vừa–lớn, chuẩn EN 1090 | ước giá, hợp đồng, mua hàng, tồn + truy xuất vật liệu nhiều kho, điều độ + mã vạch, QS so ngân sách/thực tế, tài liệu; 45.000 người dùng / 70 nước | quote; năm đầu thường ≥ 15.000 £ |
| ConstruSteel | xưởng châu Âu, BIM | nesting thanh, CAD | quote |
| **EZIIL** (cloud) | 15–150 người | app xưởng, kéo thả kế hoạch, truy xuất EN 1090; **không có nesting, không ước giá** | 140–338 USD/tháng theo cỡ đội |
| Odoo + app "Fabrication Management" | làm theo đơn, thuê ngoài | MRP, thuê ngoài gia công, QC; app bên thứ ba ~900 USD | giấy phép Odoo + triển khai |
| ERPNext | nhỏ–vừa, mã nguồn mở | BOM, lệnh sản xuất, QC, thuê ngoài (inward/outward) | miễn phí + công triển khai |
| SAP (ATAD, Đại Dũng dùng) | tập đoàn | ERP lõi; sản xuất dùng phần mềm riêng (ATAD: SPM + Primavera; Đại Dũng: Tekla + Primavera + QR/RFID) | rất cao |

Lớp máy (không phải lớp quản lý): **SigmaNEST / ProNest / Lantek** (nesting tấm), **VACAM** của Voortman (chuẩn bị – điều độ – theo dõi theo máy), **Steel Projects** (CAM + nesting + MES, định dạng PNI), phần mềm theo máy Peddinghaus / Ficep. Các hãng này **trả dữ liệu về ERP** (lệnh cắt, tiến độ, dư) — đây là chỗ Vioo nhận.

### Trong nước

Không tìm thấy phần mềm Việt chuyên kết cấu thép. Các ERP / MES nội (Viindoo cơ khí, 3S MES của ITG, BRAVO, MISA AMIS Sản xuất, InfoAsia ERP có đơn vị m³ / md / kg) là sản xuất chung: có BOM, lệnh sản xuất, công đoạn, nhưng không có **bản vẽ theo revision, cấu kiện theo ký hiệu Tekla, nesting, dư tấm, heat number**. Hai nhà máy lớn nhất (ATAD, Đại Dũng) đều đi đường **SAP + phần mềm sản xuất riêng + Tekla + Primavera**, không mua trọn gói PowerFab — tức là thị trường VN cũng đang "lắp ghép", không có lựa chọn mua sẵn hoàn chỉnh.

## 3. Nhà máy cần gì — Vioo có gì

| # | Khả năng phần mềm KCT cần | Vioo hôm nay | Cách lấp |
|---|---|---|---|
| 1 | Hồ sơ **đơn hàng gia công** (công trình nội bộ / khách ngoài), gói, đợt giao | chưa | **xây** (thiết kế 05/10 §2) |
| 2 | **Bảng bóc tách** cấu kiện ↔ nguyên liệu theo **revision bản vẽ**, nhập từ Tekla / Excel / dán / ảnh | có đọc Excel / ảnh / dán cho Mua hàng, Đề xuất | **xây** phần KCT, tái dùng bộ đọc |
| 3 | Dự trù vật tư → Mua hàng → nhận theo lô, cân thực, chứng chỉ | có Mua hàng, nhận hàng, chụp phiếu AI, tồn theo quy cách | nối + thêm lô / heat number |
| 4 | **Lệnh sản xuất theo công đoạn** (cắt → tổ hợp → hàn → làm sạch / sơn → QC → giao), điều độ xưởng, ghi nhận tablet / QR | chưa | **xây** (đây là cái đo được hiệu suất) |
| 5 | **Nesting / phương án cắt**, chương trình CNC, robot | không | **mua theo máy**, nhận tệp kết quả |
| 6 | Tồn **tấm / dư / phế**, truy xuất heat number, chứng chỉ vật liệu | tồn theo quy cách; chưa có lô / dư | **xây** (thiết kế 05/10 §3, §5) |
| 7 | QC / nghiệm thu / NCR theo cấu kiện | Nhật ký công trường có QC; xưởng chưa | **xây** rubric QC xưởng |
| 8 | **Thuê ngoài** gia công: cấp vật liệu, đối soát dư / phế, giao thẳng | có ngược chiều Mua hàng / Kho | **xây** đơn thuê gia công (05/10 §4C–E) |
| 9 | Chi phí theo đơn, so ngân sách | Tài chính có chi phí theo dự án | mở rộng theo đơn gia công |
| 10 | Kế hoạch sản xuất **bám tiến độ lắp dựng** | có tiến độ hạng mục, nhật ký, Dòng chảy | **lợi thế riêng**: nối ngày cần của công trường vào điều độ xưởng |
| — | Nhân sự, chấm công, quy trình duyệt, phân quyền, Trợ lý AI, Jev | **có** | dùng luôn |

## 4. Đọc hai bảng dự trù trong ảnh (dữ liệu thật)

- **Thép hình (Nhà xe Hương Liên)**: mỗi dòng = **quy cách** (`I200x100x5.5x8 thép đen`, `V50*4`, `[]100*50*2`, `D12 trơn`) + ĐVT `cây 6m` + số lượng + **kg** (quy đổi kg/m theo tiêu chuẩn thép hình) + **ghi chú = cấu kiện / vị trí dùng** (ty giằng xà gồ, lan can, hộp panel) + cột **Tồn kho để trống** (chờ kho trả). Cột nhóm (I) có tổng kg.
- **Tôn (RICO)**: mỗi dòng = **chi tiết theo bản vẽ** (mã S1…S4, TCP1, TV1…TV53) với khổ hiệu dụng, chiều dài, số tấm, m², md, màu, **hình dạng cong kèm phác thảo**; nhóm theo loại tôn (seam lock 0,45; 5 sóng 0,45; 6 sóng 0,4).

Hai bảng này khẳng định cấu trúc trong thiết kế 05/10: **nguyên liệu có quy cách chuẩn** (thép hình, tôn theo khổ / dày) tái dùng danh mục + bảng kg/m; **chi tiết theo bản vẽ** (S1, TV53) mang thông số riêng, không ép thành mã SKU; mọi dòng gắn **cấu kiện / hạng mục** để truy chi phí và tiến độ. Việc đầu tiên Vioo làm được ngay là **điền cột Tồn kho và tạo đề xuất mua phần thiếu** từ chính bảng này (nhập Excel / dán / ảnh — bộ đọc đã có).

## 5. Ba phương án

| | A. Mua PowerFab / STRUMIS, nối Vioo | B. ERP Việt / Odoo cho xưởng | **C. Xây trong Vioo + mua lớp máy** |
|---|---|---|---|
| Thời gian có ích | 6–12 tháng (triển khai, đào tạo, tiếng Anh) | 4–8 tháng, nhưng vẫn thiếu bản vẽ / revision / dư tấm | 3 tháng đợt 1 có ích, 9–12 tháng đủ |
| Chi phí | 10.000–50.000 USD+/năm + tích hợp | giấy phép + tùy biến nhiều | công đội Vioo + giấy phép nesting (thường đi kèm máy) |
| Rủi ro | hai hệ thống, hai bộ dữ liệu NCC / vật tư / người; Tekla-centric | tùy biến sâu rồi vẫn là ERP chung | tự gánh nghiệp vụ xưởng; **không được** tự làm nesting / CNC |
| Lợi thế | chuẩn thế giới, nối máy sẵn, chứng chỉ EN | nhà cung cấp trong nước | một dữ liệu, một quyền, một Trợ lý; bám tiến độ công trường; UX Việt; học được từ Jev |

**Đề xuất C**, với hai điều kiện: (1) mua nesting / CAM theo máy và chỉ nhận tệp (kế hoạch cắt, dư, tiến độ máy), (2) lấy **Tekla làm đầu vào chuẩn** (xuất danh sách cấu kiện / nguyên liệu dạng XML / Excel / IFC) thay vì tự đọc bản vẽ.

## 6. Lộ trình đề xuất (mỗi đợt có ích, dùng được rồi mới sang đợt sau)

| Đợt | Nội dung | Kết quả thấy được |
|---|---|---|
| **Đ1 (4–6 tuần)** | Hồ sơ **đơn hàng gia công** + **bảng dự trù KCT chuẩn** (nhập Excel / dán / ảnh đúng 2 mẫu trên; quy đổi cây ↔ kg theo bảng thép hình; nhóm / dòng / cấu kiện) → tự điền **Tồn kho theo quy cách** → **đề xuất mua phần thiếu** sang Mua hàng; kho nhà máy chỉ Admin | bỏ Excel dự trù; biết thiếu gì, mua gì, bao giờ cần |
| **Đ2 (6–8 tuần)** | **Lệnh sản xuất theo công đoạn** cho từng gói cấu kiện, bảng điều độ xưởng (kéo thả), **tablet / QR ghi nhận** bắt đầu – xong – số lượng – người – máy; QC đạt / sửa / loại; "Hoàn thành & xuất" nối Kho | lần đầu đo được **tấn / ngày, giờ công / tấn, tỉ lệ sửa** theo tổ và máy |
| **Đ3 (6 tuần)** | **Lô tấm / heat number / chứng chỉ**, nhận kết quả nesting (tệp từ SigmaNEST / ProNest / VACAM) → cấp tấm cho đợt cắt, ghi **dư tái dùng / phế / hao hụt**; **thuê ngoài** (cấp vật liệu, đối soát, giao thẳng) | đối soát vật liệu từng đơn; biết dư tấm còn dùng được ở đâu |
| **Đ4 (4 tuần)** | **Nhập Tekla** (danh sách cấu kiện + nguyên liệu, revision, so sánh tăng / giảm), **kế hoạch sản xuất bám ngày cần của công trường** (từ tiến độ hạng mục), đơn khách ngoài + báo cáo chi phí theo đơn; **Jev** gợi ý cách đáp ứng dòng (tồn / mua / tự làm / thuê), phân lớp BOM, chấm QC rubric | một màn: công trường cần gì ngày nào → xưởng làm gì tuần này → thiếu gì phải mua / thuê |

Mỗi đợt một PR nhóm, migration riêng, smoke rollback Cloud như các module khác; kho nhà máy admin-only chặn ở RLS.

## 7. Cần anh chốt trước khi làm Đ1

1. **Máy**: hãng và phần mềm đi kèm (Voortman / Ficep / Peddinghaus / robot hàn hãng nào; đã có SigmaNEST / ProNest / VACAM chưa) — quyết định Vioo nhận tệp gì ở Đ3.
2. **Tekla hiện xuất ra gì** cho xưởng (báo cáo Excel, XML, NC1 / DSTV, IFC) — quyết định Đ4.
3. Sản lượng và nhịp: **tấn / tháng, số đơn gia công / tháng, số tổ, số ca**.
4. Tỉ lệ **thuê ngoài** và hình thức (công ty cấp thép hay bên gia công tự cấp).
5. Tiêu chuẩn **QC** đang áp dụng (TCVN, EN 1090, yêu cầu chứng chỉ vật liệu theo công trình nào).
6. Ai **điều độ xưởng** hôm nay và ghi nhận bằng gì (giấy, Zalo, Excel) — để thiết kế tablet / QR đúng tay người dùng.
7. Có **cân** (cân xe, cân thép) không — quyết định số kg thực nhận.
8. **Muốn đo hiệu suất gì trước**: theo người, theo máy, theo đơn, hay tấn / ngày — đó là KPI Đ2.

## 8. Nguồn đã xem (19/10/2026)

- Tekla PowerFab — [trang sản phẩm](https://www.tekla.com/products/tekla-powerfab), [Capterra](https://www.capterra.com/p/10030015/Tekla-PowerFab/), [SoftwareConnect](https://softwareconnect.com/reviews/tekla-powerfab/)
- STRUMIS — [trang chủ](https://www.strumis.com/), [SoftwareConnect](https://softwareconnect.com/reviews/strumis/)
- Bảng 16 phần mềm + giá — [EZIIL (10/2026)](https://eziil.com/metal-fabrication-software/)
- Lớp máy — [Voortman + SigmaNEST](https://www.voortman.net/en/products/solutions/sigmanest), [SigmaNEST partners](https://www.sigmanest.com/partners), [Steel Projects](https://www.steelprojects.com/?p=165)
- Odoo / ERPNext — [Odoo subcontracting](https://www.odoo.com/documentation/16.0/applications/inventory_and_mrp/manufacturing/management/subcontracting.html), [app Fabrication Management](https://apps.odoo.com/apps/modules/19.0/metal_fabrication_management), [ERPNext metal fabrication](https://frappe.io/erpnext/manufacturing/open-source-metal-fabrication-erp)
- Trong nước — [ITG 3S MES](https://itgtechnology.vn/en/products/3s-mes/), [Viindoo cơ khí](https://viindoo.com/page/erp-for-industrial-manufacturing), [InfoAsia ERP-MES](https://infoasia.com.vn/cloud/ERP-MES.html), [Fast tổng hợp MES](https://fast.com.vn/cac-phan-mem-quan-ly-san-xuat-tot-va-hieu-qua-nhat/)
- ATAD (SAP + SPM + Primavera) — [Tạp chí Công Thương](https://tapchicongthuong.vn/ket-cau-thep-atad--doanh-nghiep-tien-phong-trong-cong-nghe-va-bao-ve-moi-truong-81054.htm), [Thương hiệu quốc gia](https://thuonghieuquocgia.nhandan.vn/doanh-nghiep/cong-ty-cp-ket-cau-thep-atad-178.html); Đại Dũng (SAP, Tekla, Primavera, QR / RFID; chuyển đổi số GĐ2) — [daidung.com](https://daidung.com/nha-thau-ket-cau-thep-dai-dung-group/), [kick-off GĐ2](https://daidung.com/en/tap-doan-dai-dung-kick-off-giai-doan-2-du-an-chuyen-doi-so/); Tekla tại VN — [bim.edu.vn](https://bim.edu.vn/tekla-structures-nha-thep-tien-che.html)

Giá và tính năng lấy từ trang hãng và trang tổng hợp bên thứ ba; chưa hỏi báo giá chính thức.
