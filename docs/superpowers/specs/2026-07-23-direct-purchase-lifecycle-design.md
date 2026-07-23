# Vòng đời Mua nóng / CCDC và công nợ nhà cung cấp

## Mục tiêu

Chuẩn hóa vòng đời một phiếu mua nóng/CCDC để dữ liệu mua hàng, nhập kho,
CCDC, công nợ phải trả và thanh toán có trạng thái nhất quán; mọi bước đi tới
phải có đường đảo có kiểm soát. Nhãn nghiệp vụ không sử dụng thuật ngữ `AP`;
giao diện gọi là **công nợ nhà cung cấp**.

## Phạm vi

Áp dụng cho phiếu `site_direct_purchase`, dòng phiếu, WMS nhập kho, CCDC nhỏ,
`supplier_payable_documents` và đợt thanh toán nhà cung cấp có nguồn từ phiếu.

Không tự động thực hiện hoàn tiền qua ngân hàng. **Đảo thanh toán** là bút toán
đảo nội bộ; việc chuyển tiền thực tế theo quy trình ngân hàng bên ngoài.

## Trạng thái và quyền thao tác

| Trạng thái phiếu | Ý nghĩa | Thao tác cho phép |
| --- | --- | --- |
| `draft` — Nháp | Chưa trình duyệt, chưa có chứng từ sau | Sửa, xóa, gửi duyệt |
| `submitted` — Chờ duyệt | Đã gửi người duyệt mua | Duyệt mua, trả về nháp, từ chối phiếu |
| `approved_to_buy` — Đã duyệt mua | Được phép mua | Đánh dấu đã mua, hủy duyệt về chờ duyệt, từ chối phiếu |
| `purchased` / `received` / `finance_review` — Đã mua, chờ xác nhận công nợ | Có hàng/chứng từ; vật tư tồn phải hoàn tất WMS trước khi xác nhận công nợ | Xác nhận công nợ nhà cung cấp, từ chối phiếu khi chưa có chứng từ khóa |
| `reconciled` — Đã xác nhận công nợ | Đã có công nợ mở hoặc thanh toán một phần | Xem; bỏ xác nhận công nợ khi chưa có thanh toán |
| `closed` — Đã thanh toán | Công nợ đã thanh toán đủ | Xem; đảo thanh toán tại Phải trả |
| `rejected` — Từ chối | Từ chối toàn phiếu, không còn công nợ hoạt động | Chỉ xem lịch sử |
| `cancelled` — Đã hủy | Hủy nghiệp vụ trước khi phát sinh chứng từ khóa | Chỉ xem lịch sử |

Quyền được phân theo hành động hiện hữu của module Mua nóng/PO: tạo, sửa,
xóa, duyệt mua và xác nhận công nợ. Thanh toán và đảo thanh toán tiếp tục dùng
quyền Phải trả/Tài chính. Backend phải kiểm tra trạng thái và quan hệ phát sinh
thay vì chỉ ẩn nút ở frontend.

## Nhãn giao diện

- `Ghi AP` đổi thành **Xác nhận công nợ nhà cung cấp**.
- Thao tác `Từ chối` ở cấp dòng bị loại bỏ; thay bằng **Từ chối phiếu** ở cấp
  phiếu.
- Thêm **Bỏ xác nhận công nợ** cho phiếu đã xác nhận nhưng chưa có thanh toán.
- Giữ **Đảo thanh toán** ở Phải trả cho đợt thanh toán đã `paid`.

## Luồng xuôi và đảo

1. Người mua tạo phiếu ở `draft`; chỉ trạng thái này được sửa/xóa.
2. Phiếu đi qua `submitted` và `approved_to_buy`, sau đó là `purchased`.
3. Vật tư tồn phải có WMS hoàn tất. CCDC và chi phí không tự tạo công nợ lúc
   lưu phiếu.
4. Người có quyền chọn **Xác nhận công nợ nhà cung cấp**. Backend tạo hoặc cập
   nhật một công nợ theo cặp `(site_direct_purchase, purchase_id)`, phiếu sang
   `reconciled`.
5. Thanh toán cập nhật công nợ `open`/`partial`/`paid`; khi thanh toán đủ,
   phiếu sang `closed`.
6. **Từ chối phiếu** trước khi có thanh toán hủy công nợ về `cancelled` và đưa
   phiếu sang `rejected`. Không xóa lịch sử.
7. **Bỏ xác nhận công nợ** chỉ khi số tiền đã thanh toán bằng 0: hủy công nợ,
   đảo CCDC phát sinh theo nguồn (nếu có), và trả phiếu về chờ xác nhận công nợ.
8. Nếu đã thanh toán: phải **Đảo thanh toán** trước. Hệ thống tạo giao dịch âm
   và mở lại công nợ; khi đó mới có thể bỏ xác nhận hoặc từ chối.
9. Nếu WMS đã hoàn tất: không được từ chối/xóa trực tiếp. Phải có chứng từ
   xuất/hoàn kho đảo trước. Cùng nguyên tắc áp dụng cho CCDC đã bàn giao/ghi
   nhận.

## Quy tắc dữ liệu và lỗi

- Không được tự đồng bộ công nợ khi chỉ lưu phiếu CCDC/chi phí. Công nợ chỉ
  phát sinh từ thao tác xác nhận rõ ràng.
- Từ chối phải là giao dịch nguyên tử: nếu không thể hủy công nợ, đảo CCDC hay
  kiểm tra WMS thì không đổi trạng thái phiếu và trả về lý do cụ thể.
- Không được sửa/xóa khi đã rời `draft`; không được sửa phiếu đã thanh toán.
- Backend sẽ từ chối các chuyển trạng thái không nằm trong ma trận trên, dù UI
  bị gọi trực tiếp.
- Phiếu cũ vẫn đọc được. Các công nợ đã có được suy ra sang trạng thái phù hợp
  thay vì bị xóa hoặc tạo lại.

## Kiểm thử chấp nhận

1. Nháp sửa/xóa được; sau khi trình không sửa/xóa được.
2. CCDC/chi phí lưu nháp không sinh công nợ.
3. Xác nhận công nợ tạo đúng một công nợ và không tạo trùng khi bấm lại.
4. Từ chối phiếu đã xác nhận nhưng chưa thanh toán đặt công nợ `cancelled`.
5. Phiếu đã thanh toán không từ chối/bỏ xác nhận được; sau đảo thanh toán thì
   thực hiện được.
6. Phiếu có WMS hoàn tất bị chặn từ chối/xóa cho đến khi có nghiệp vụ kho đảo.
7. Phân quyền và API/RPC đều chặn hành động không đúng vai trò hoặc trạng thái.
