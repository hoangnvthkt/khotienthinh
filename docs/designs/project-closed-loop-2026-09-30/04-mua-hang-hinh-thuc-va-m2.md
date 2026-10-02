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

## 4. M2d — Đơn chủ động tại Mua hàng (chốt 02/10/2026)

**Vì sao:** khi khóa nút "Tạo PO chủ động" ở tab dự án (M2a), Mua hàng chưa có chức năng thay thế, nên từ 01/10 không ai lập được đơn khi chưa có phiếu nhu cầu (trừ Admin). Trước đó dự án đã lập 8 đơn chủ động, khoảng 2,3 tỷ (PO-145: 1,34 tỷ).

**Luật:**
- Mua hàng bấm **"Lập đơn chủ động"** ở đầu màn Mua hàng. Mỗi đơn dành cho **một dự án** và nhận vào **kho công trường** của dự án đó (`source_mode = proactive_project`, `metadata.channel = procurement_hub`).
- **Bắt buộc lý do:** chốt giá tốt / hàng đặt dài ngày / bù tồn tối thiểu / khác (chọn "khác" thì ghi rõ).
- **So với BOQ dự án**, tính theo đơn vị kho: BOQ của vật tư, SL đã đặt ở các đơn khác của dự án, và SL đơn này. Nếu vượt BOQ hoặc vật tư không có trong BOQ thì vẫn lập được nhưng **bắt buộc ghi lý do**. Mỗi dòng lưu lại số BOQ và số đã đặt tại lúc lưu, để người duyệt và người truy vết thấy vì sao đơn được lập.
- **Duyệt, giao hàng, nhận hàng, công nợ như đơn thường** (M2a/M3): gửi người có quyền Mua hàng — Quản trị/Admin, không tự duyệt.
- **Chống mua trùng:** khi có nhu cầu mới (đề xuất hoặc KH vật tư) cùng dự án, cùng vật tư, phiếu đó hiện khối "Đã có trong đơn chủ động — gắn vào thay vì mua thêm". Bấm **Gắn** để phân phần chưa phân bổ của đơn cho nhu cầu. Nhu cầu được tính là đã đặt, không phải lập đơn mới.
- **Mua dự trữ Kho Tổng** (không gắn dự án) **chưa mở**. Hiện công nợ NCC bắt buộc gắn dự án/công trường, và chi phí dự án được ghi ngay khi nhận hàng. Phần này mở cùng K3a (công nợ cấp công ty, chi phí ghi khi xuất kho cho dự án).

**Bảng tình huống:**

| Tình huống | Xử lý | Dấu vết |
|---|---|---|
| Lập đơn không chọn lý do, hoặc chọn "khác" mà để trống | Chặn | — |
| Chọn kho không thuộc dự án | Chặn | — |
| Một vật tư nhập hai dòng | Chặn | — |
| Vượt BOQ hoặc vật tư ngoài BOQ | Cho lập nếu có lý do | `metadata.proactive.overBoqReason` + ảnh chụp BOQ từng dòng |
| Sửa đơn: đổi dự án | Chặn. Xóa nháp và lập đơn mới | — |
| Sửa đơn: bỏ dòng đã gắn nhu cầu, hoặc giảm SL dưới phần đã gắn | Chặn. Gỡ gắn trước | — |
| Sửa đơn chủ động bằng màn lập đơn từ nhu cầu | Chặn ở máy chủ | — |
| Gắn nhiều hơn phần nhu cầu còn thiếu, hoặc nhiều hơn phần chưa phân bổ của đơn | Chặn | — |
| Gắn khác vật tư, khác dự án, nhu cầu đã đóng | Chặn | — |
| Gắn nhầm | **Gỡ** ở chi tiết đơn, bắt buộc lý do. Phần đó quay lại Cần mua | Sự kiện ghi ở cả hai phía: đơn (`unlink_need`) và nhu cầu (`unlink_proactive_po`) |
| Người duyệt trả lại đơn | Nhu cầu đã gắn tạm quay về Cần mua (như đơn thường). Gửi lại thì tính là đã đặt | Lịch sử đơn |
| Xóa đơn nháp | Xóa luôn liên kết nhu cầu, nhu cầu quay lại Cần mua | Lịch sử |
| Hàng về một phần | Chia cho nhu cầu đã gắn **trước**, phần còn lại là tồn dự phòng | — |
| Trả NCC kiểu giảm trừ (K2) | Trừ vào phần **chưa phân bổ** trước, thiếu mới trừ vào nhu cầu đã gắn | — |
| Kết thúc thiếu | Nhu cầu đã gắn giữ phần đã về, phần thiếu quay lại Cần mua (như M3) | — |
| Lập PO chủ động ở tab dự án / chèn thẳng vào bảng | Chặn (`PURCHASE_ORDER_CREATE_MOVED_TO_PROCUREMENT`) | — |

**Phân quyền:**

| Việc | Mua hàng — Xem | Mua hàng — Quản lý | Mua hàng — Quản trị / Admin | Thủ kho, công trường |
|---|---|---|---|---|
| Xem đơn chủ động, lý do, số BOQ | ✓ | ✓ | ✓ | — |
| Lập, sửa nháp, gửi duyệt | — | ✓ (chỉ đơn mình lập) | ✓ | — |
| Duyệt / trả lại | — | — | ✓ (không tự duyệt) | — |
| Gắn / gỡ nhu cầu | — | ✓ | ✓ | — |
| Nhận hàng | — | — | — | Thủ kho nhận như đơn thường |

**Đã kiểm trên production** (giao dịch rollback, các vai Chung / Mơ / Luật): 30 bước gồm luồng chuẩn, các nhánh chặn, trả lại → gửi lại → duyệt (tự có đợt giao và phiếu nhập kho), gắn / gỡ / gắn lại, xóa nháp làm nhả nhu cầu, và chèn thẳng bị chặn. Bốn hàm sao chép (`save_procurement_hub_po_v1`, `list/get_procurement_order(s)_v1`, `procurement_link_credited`) đã đối chiếu md5 khớp với bản đang chạy trước khi ghi đè. Test rollback làm nhảy số PO (sequence không rollback).
