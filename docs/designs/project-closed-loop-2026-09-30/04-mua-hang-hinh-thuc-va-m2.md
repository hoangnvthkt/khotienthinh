# Mua hàng — hình thức mua và M2 (chốt 01/10/2026)

## 1. Phân loại (chủ sản phẩm đã chốt)

| Khái niệm | Gồm | Ở đâu |
|---|---|---|
| **Nguồn nhu cầu** | KH vật tư đã duyệt, Đề xuất vật tư công trường đã duyệt; sau này module Đề xuất, Quy trình | Mua hàng → Tiếp nhận |
| **Hình thức mua** (chọn khi xử lý nhu cầu) | 1. **Đơn hàng (PO)** — đặt đơn nào về đơn ấy<br>2. **Gọi hàng theo HĐ nguyên tắc** — lũy kế các lần giao, cuối kỳ đối soát tính tiền (xi măng, cát, đá, bê tông, cọc…)<br>3. **Mua nóng** — công trường tự mua gấp/nhỏ lẻ | Mua hàng |
| **CCDC nhỏ** | Loại hàng (sổ theo dõi ngoài kho), không phải hình thức mua | Giữ ở dự án |

Quyết định:
- HĐ nguyên tắc: **công trường gọi thẳng NCC**, nhập phiếu giao từng chuyến. Mua hàng quản HĐ, đơn giá, hạn mức, lũy kế và đối soát cuối kỳ.
- Chuẩn hóa HĐ: **đơn giá khai trong HĐ** (có ngày hiệu lực khi đổi giá) → phiếu giao tự tính tiền tạm; **cuối kỳ (tháng) gom mọi phiếu của HĐ vào 1 bảng đối soát** → công nợ. Cảnh báo lũy kế 80%/100% hạn mức KL hoặc giá trị HĐ.
- PO lập ở Mua hàng **phải duyệt**: người lập gửi cho người có quyền Mua hàng — Quản trị hoặc Admin (không tự duyệt đơn mình lập); trả lại kèm lý do.
- Thứ tự: **M2a PO** → M2b HĐ nguyên tắc → M2c Mua nóng vào Mua hàng.

Hiện trạng dữ liệu 01/10 (production):
- Giao theo HĐ: 18 phiếu giao DA29 tháng 9 (bê tông, cọc, đá, gạch, xi măng) nhưng **18 bảng đối soát — mỗi phiếu một bảng**; đơn giá nhập lúc đối soát vì `supplier_contract_lines` = 0 dòng; 13 HĐ NCC, phần lớn trạng thái nháp, có HĐ trùng số.
- Mua nóng: 1 phiếu (bị từ chối) — gần như chưa dùng.
- PO: 61 đơn, đều lập ở dự án (`from_request` 53, `proactive_project` 8).

## 2. M2a — Đơn hàng tại Mua hàng

Nguyên tắc: **dùng lại PO hiện có** để công trường nhận hàng bằng luồng sẵn có (đợt giao, phiếu nhập WMS). PO lập ở Mua hàng là PO `from_request`/`single` có đánh dấu `metadata.channel = 'procurement_hub'`.

- Tạo đơn từ 1 hoặc nhiều phiếu nhu cầu **cùng dự án/công trường**; gộp theo vật tư, mỗi vật tư 1 dòng PO, phân bổ SL về từng dòng nhu cầu (phiếu đề xuất → `purchase_order_request_lines`; KH vật tư → `procurement_po_plan_links`).
- Luồng: Nháp → Gửi duyệt (chọn người duyệt) → Đã duyệt = đã đặt NCC (`confirmed`) | Trả lại (lý do) → sửa → gửi lại. Xóa được nháp chưa từng gửi.
- Sau khi duyệt: tab dự án lập đợt giao, nhận hàng, nhập kho như PO thường; **không sửa/gửi/duyệt/xóa** PO lập ở Mua hàng.
- Khóa tạo PO từ đề xuất ở tab dự án (UI + server), Admin vẫn được phép khi cần xử lý sự cố.
- **Đóng nhu cầu (không cần mua) + lý do**: phiếu ra khỏi danh sách cần mua, mở lại được.
- Sửa lỗi M1: SL đã nhận theo dòng nhu cầu tính theo tỷ lệ nhận của dòng PO (`actual_received_qty_snapshot` không được cập nhật).
- Các bước Đơn hàng / Đang giao / Đã giao đủ dùng danh sách PO mới (mọi PO, kể cả PO lập ở dự án trước đây — chỉ xem).

## 3. M3 — Giao hàng & nhận hàng (chốt 01/10/2026)

- **Giao 1 lần**: duyệt đơn → tự có đợt giao + phiếu nhập kho chờ (QR). Thủ kho nhận đúng SL thực tế.
- **Giao nhiều đợt** (VD thép tấm): **Mua hàng lập từng đợt** (công trường chỉ nhận hàng) với SL mua, SL kho (nhập tay, VD 100 kg = 10 cây), đơn giá và VAT riêng của đợt.
  - Tổng giá trị các đợt (trước VAT) trong giá trị đơn đã duyệt → tạo ngay phiếu nhập kho + QR.
  - Vượt → phải chọn người duyệt bổ sung (Mua hàng — Quản trị/Admin, không phải người lập); duyệt xong mới có phiếu nhập kho và giá trị đơn đã duyệt được nâng lên.
- **Giao thiếu** (VD 50/100 thùng sơn): thủ kho nhận 50 → đợt "Nhận thiếu", đơn "Giao một phần". Mua hàng chọn:
  - **Giao bù phần thiếu**: lập đợt mới cho phần còn lại (gợi ý sẵn SL còn phải giao).
  - **Kết thúc thiếu** (bắt buộc lý do, không còn đợt mở): phần thiếu **mặc định quay lại Cần mua**, hoặc chọn "Không cần nữa".
- Hủy đợt chỉ khi kho chưa bắt đầu nhận. Phiếu nhận của thủ kho hiện cả SL theo đơn vị kho và đơn vị mua.
