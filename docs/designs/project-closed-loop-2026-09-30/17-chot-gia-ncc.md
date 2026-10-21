# 17. Chốt giá NCC — giá thanh toán khác giá đặt (10/10/2026)

Chủ SP hỏi ngày 08/10, duyệt 3 ý ngày 10/10:
- **(a)** Chốt giá gộp vào màn **Hóa đơn NCC**, không thêm màn riêng.
- **(b)** Tăng giá thì luôn phải duyệt theo ma trận. Giảm giá thì Kế toán trưởng xác nhận.
- **(c)** Được chốt giảm giá khi chưa có hóa đơn, chỉ cần biên bản thỏa thuận.

Mockup: `.superpowers/price/price-app.html` (component thật, dữ liệu prod 10/10, cổng 5187). Mở `?as=thuy` để xem bằng mắt người lập.

## 1. Bài toán

PO-001 đặt 100 thùng sơn giá 1 triệu, kho thực nhận 10 thùng. Hệ thống ghi công nợ 10 × 1 tr = 10 tr. Khi thanh toán, NCC giảm còn 900 nghìn/thùng, nên công nợ đúng phải là 9 tr.

**Nguyên tắc** (memory `erp-exception-flows-clean-history`): mỗi bộ phận chỉ ghi phần thật của mình.
- Mua hàng ghi đơn: số lượng và giá đặt.
- Kho ghi số thực nhận, không quan tâm giá.
- Kế toán ghi giá thật.
- Không bộ phận nào sửa đè chứng từ của bộ phận khác. Chênh lệch được ghi bằng **chứng từ điều chỉnh** có lý do và người duyệt.

## 2. Vioo đang có gì (10/10)

| Có | Thiếu |
|---|---|
| Đối soát nhận hàng ghi công nợ = SL thực nhận × giá đơn (`post_receipt_reconciliation_v1`) | Chỉ nhập được **tổng tiền** hóa đơn, chưa nhập được đơn giá từng dòng |
| K3c: hóa đơn lệch vượt dung sai thì có lý do và duyệt, sau đó tự điều chỉnh công nợ + chi phí dự án | Chưa ghi được giảm giá **không có hóa đơn** (`finance_payable_adjustments.kind` chỉ có `cancel`) |
| Phân bổ thanh toán có sẵn cột `discount_amount` (chiết khấu thanh toán) | Mua hàng chưa thấy giá chốt; chưa có nhãn "chờ hóa đơn điều chỉnh" |

**Dữ liệu prod:**
- 35 chứng từ công nợ: 11 nhận hàng PO (656,6 tr) + 24 bảng đối soát (2,48 tỷ).
- 0 hóa đơn, 0 phiếu chi. Vì vậy đổi luật bây giờ không ảnh hưởng dữ liệu đang chạy.

## 3. Cách làm

**Một khái niệm duy nhất: "Chốt giá"** (`supplier_price_settlements`, mã `CG-YYMM-####`). Mỗi dòng chốt giá gắn với một dòng hàng của chứng từ công nợ và ghi: SL thực nhận (khóa) · giá đang áp · giá chốt · VAT · chênh.

Có hai cách tạo:

1. **Kèm hóa đơn**, trong ngăn Ghi hóa đơn.
   - Mỗi chứng từ được chọn có nút "Đơn giá · n dòng". Mở ra là bảng Hàng | SL thực nhận | Giá đặt | **Giá chốt** | Chênh. Ô Giá chốt để trống nghĩa là giữ giá cũ.
   - Hóa đơn lệch vượt dung sai mà chưa chốt giá thì màn tự nhắc "NCC đổi đơn giá? Bấm Đơn giá…".
   - Khung so sánh: Theo nhận hàng → Chốt giá → Theo giá chốt → Hóa đơn → Lệch còn lại. Dung sai tính trên giá trị theo giá chốt.
   - Có đổi giá thì nút đổi thành **Gửi duyệt giá**. Duyệt xong mới ghi cả hóa đơn và giá.
2. **Theo biên bản**: nút "Chốt giá theo biên bản" trên đầu màn Hóa đơn NCC.
   - Chọn NCC, hiện mọi chứng từ của NCC đó, **kể cả chứng từ đã có hóa đơn**, rồi nhập giá chốt từng dòng.
   - Nhập thêm: số biên bản (không bắt buộc), ngày thỏa thuận, lý do, tệp đính kèm (bắt buộc).
   - Màn cảnh báo theo từng chứng từ: đã có hóa đơn giá cũ, đã trả, hàng Kho Tổng.

**Duyệt** (xem trước luồng ngay trong ngăn nhập):
- Chỉ có giảm: 1 bước "Kế toán trưởng xác nhận" (người duyệt bậc 1 của ma trận: Hương / Chuẩn).
- Có phần tăng: theo ma trận, tính trên **tổng số tiền tăng**. Đến 100 tr: KTT; 100 tr–1 tỷ: KTT → GĐTC; trên 1 tỷ: thêm TGĐ.
- Người lập không tự duyệt. Người nhận hàng hoặc chốt đối soát chứng từ đó cũng không duyệt (dùng lại `finance_doc_handlers`).
- **Đổi luật K3c:** hóa đơn lệch vượt dung sai (không chốt giá) cũng đi theo luật này, thay vì "người có quyền Xác nhận bất kỳ".

**Kết quả khi duyệt xong** (không sửa PO, không sửa phiếu kho):
- **Giảm:** ghi giảm trừ (`credit_amount`) vào đúng chứng từ, không vượt số còn nợ chưa đề nghị chi. Chi phí dự án ghi dòng âm (`source_ref = supplier_price_settlement:<id>`).
- **Tăng:** tạo chứng từ công nợ mới loại `supplier_price_adjustment` cùng dự án / HĐ, chi phí dự án ghi dòng dương.
- Chứng từ đã có hóa đơn giá cũ: gắn nhãn **Chờ HĐ điều chỉnh**. Kế toán bấm "Gắn HĐ điều chỉnh" (số, ngày, file) khi NCC xuất. Công nợ đã đúng từ lúc duyệt; bước này chỉ để đủ chứng từ thuế.
- Hóa đơn ghi sau đó được khớp với giá trị **theo giá chốt**: phần chưa có hóa đơn = ghi nợ + chốt giá − đã có hóa đơn.
- Ghi `finance_events`. Báo người duyệt từng bước, báo người lập khi xong hoặc bị trả lại, báo **người mua của PO** "PO-xxx đã chốt giá …".
- **Đảo:** chỉ khi phần điều chỉnh chưa được trả hoặc chưa nằm trong đề nghị chi. Bắt buộc lý do, ghi dòng ngược chiều.

## 4. Bảng tình huống

| # | Tình huống | Xử lý |
|---|---|---|
| 1 | NCC giảm giá, hóa đơn theo giá mới | Ghi hóa đơn + giá chốt từng dòng → KTT xác nhận → công nợ, chi phí giảm; hóa đơn khớp 0 |
| 2 | Giảm giá, chưa có hóa đơn (biên bản) | Chốt giá theo biên bản → KTT xác nhận. Hóa đơn đến sau thì khớp với giá chốt |
| 3 | Hóa đơn đã xuất giá cũ, sau đó giảm giá | Chốt theo biên bản → nhãn Chờ HĐ điều chỉnh → gắn HĐ điều chỉnh giảm |
| 4 | NCC tăng giá (dầu theo kỳ điều hành) | Luôn duyệt theo ma trận, tính trên số tăng; tạo chứng từ tăng nợ |
| 5 | Một hóa đơn vừa tăng dòng này vừa giảm dòng khác | Ma trận tính trên tổng phần tăng; kết quả theo từng chứng từ |
| 6 | Giảm giá khi chứng từ **đã trả đủ** | Phần vượt số còn nợ thành **NCC nợ lại** (câu hỏi 1) |
| 7 | Chứng từ đang nằm trong đề nghị chi chờ duyệt / chờ chi | Chặn chốt giảm phần đã đề nghị: "Rút đề nghị DN-… hoặc chờ chi xong" |
| 8 | Chứng từ đã cấn trừ tạm ứng | Trigger sẵn có trả phần dư về tạm ứng (`trg_supplier_advance_release`) |
| 9 | Hàng nhập Kho Tổng còn tồn | Không có dự án nên không ghi chi phí dự án; nhãn để kế toán điều chỉnh giá trị kho (câu hỏi 2) |
| 10 | Giá mới áp luôn cho phần chưa giao (90 thùng) | Báo người mua; Mua hàng sửa đơn bằng điều chỉnh có lịch sử (câu hỏi 3) |
| 11 | Chứng từ không có giá theo dòng (đầu kỳ; bảng đối soát giá 0 như DCHD-202609-B197A6) | Chỉ chỉnh bằng lệch chung trên hóa đơn, kèm lý do |
| 12 | Hai bản chốt giá chờ duyệt trùng một dòng | Chặn: một dòng chỉ có một bản chờ duyệt |
| 13 | Chốt giá lần 2 trên dòng đã chốt | Cho phép; "giá đang áp" = giá đã chốt, ô Giá đặt hiện thêm "đã chốt X" |
| 14 | Trả lại / đảo | Trả lại: người lập sửa và gửi lại. Đảo: dòng ngược chiều, có lý do |
| 15 | Chiết khấu thanh toán sớm (trả trước hạn giảm 2%) | **Không** thuộc chốt giá (về kế toán là thu nhập tài chính). Để ở bước thanh toán (`discount_amount`), làm sau |

## 5. Phân quyền

| Việc | Ai |
|---|---|
| Lập chốt giá, ghi hóa đơn, gắn HĐ điều chỉnh | `system.finance.record` |
| Duyệt giảm giá / duyệt từng bước tăng giá | Người duyệt có tên trong ma trận (Quản trị Tài chính) và có `system.finance.confirm`; khác người lập; không phải người nhận hàng của chứng từ |
| Đảo chốt giá | `system.finance.confirm`, khác người lập |
| Mua hàng | Chỉ xem giá chốt ở đơn |

## 6. Dữ liệu (dự kiến)

- `supplier_price_settlements`:
  - Thông tin chung: id, code, supplier, basis `invoice` | `agreement`, invoice_id, agreement_no, agreement_date, reason, attachments.
  - Trạng thái: status `pending_approval` | `posted` | `rejected` | `reversed`.
  - Số tiền: delta_gross, increase_gross.
  - Duyệt: route (bước + người duyệt, chụp lúc gửi), step_index, approvals.
  - Hóa đơn điều chỉnh: needs_adjustment_invoice, adjustment_invoice (số, ngày, file, người, lúc).
  - Kết quả và đảo: effects, decided_*, reversed_*, row_version.
- `supplier_price_settlement_lines`:
  - Liên kết: settlement_id, payable_document_id, source_kind `po_delivery_line` | `statement_line`, source_line_id.
  - Snapshot: item, unit, qty, from_price, to_price, vat_rate, delta_net, delta_gross.
  - Kết quả: credit_applied, increase_document_id.
- RPC mới: `save_finance_price_agreement_v1`, `decide_finance_price_settlement_v1`, `attach_finance_price_adjustment_invoice_v1`.
- RPC vá: `get_finance_invoices_v1` (dòng giá, đếm, ma trận, `forPrice`), `save_finance_invoice_v1` (`prices`), `decide_finance_invoice_v1` (duyệt theo bước).
- RPC Mua hàng: vá chi tiết đơn để hiện giá chốt từng dòng.

## 7. Phát hiện từ dữ liệu

- **2 chứng từ công nợ của Phú Đức (209 tr, PO-143 / PO-145) không có mã NCC** (`supplier_id` null).
  - Đây là lỗi đang có ở màn Hóa đơn NCC trên prod: ô chọn NCC hiện sẵn "Phú Đức" khi chưa chọn, vì NCC thiếu mã trùng với giá trị "chưa chọn".
  - Mockup đã chặn ở giao diện (hiện nhãn "Thiếu mã NCC"). Dữ liệu thì cần sửa riêng.
- Bảng đối soát DCHD-202609-B197A6 (Tín Thành Hưng, 214,76 tr): dòng hàng giá 0, giá chỉ nằm ở tổng → không chốt giá theo dòng được.
- Một NCC có thể giao cùng một mặt hàng ở nhiều mức giá. Ví dụ bê tông M350 của Hợp Thành: 1.537.037 / 1.574.074 / 1.583.333. Vì vậy chốt giá phải theo **dòng**, không theo mã hàng.

## 8. Quyết định 6 câu (10/10, chủ SP: "Đồng ý cả 6, chọn a")

1. **NCC nợ lại:** phần giảm vượt số còn nợ được ghi thành `finance_supplier_credits` (mã `NCN-`).
   - Khoản này tự cấn trừ vào chứng từ còn nợ **cùng NCC + cùng dự án**: ngay khi duyệt, và khi có chứng từ mới (trigger).
   - Nếu NCC hoàn tiền: kế toán ghi phiếu thu, người khác xác nhận. Khi đó ghi sổ thu chi (`supplier_credit_refund`) và dòng tiền dự án âm.
2. **Kho Tổng:** không tự sửa giá trị kho. Bản chốt giá ghi `inventoryDocs` và màn hiện nhãn để kế toán điều chỉnh.
3. **Phần chưa giao:** báo người lập PO (link `/#/procurement?po=`); Mua hàng tự sửa đơn.
4. **Mua hàng xem giá chốt** ở từng dòng của chi tiết đơn, qua `get_procurement_po_price_settlements_v1`. Không vá hàm chi tiết đơn của Mua hàng.
5. **Bảng đối soát dòng giá 0:** không có dòng chốt giá; chỉnh bằng lệch chung trên hóa đơn.
6. **Phú Đức thiếu mã NCC:**
   - Script `.superpowers/price/fix-supplier-id.mjs` gắn NCC theo đơn cho 18 đợt giao PO cũ (tạo trước 21/09) và 2 chứng từ PO-143 / PO-145.
   - Mặc định chạy thử; chủ SP tự chạy `--commit` để ghi thật.

## 9. Đã làm (10/10)

- **Migration** `20261010170000_finance_price_settlements.sql`:
  - Bảng: chốt giá + dòng, NCC nợ lại + phần đã dùng.
  - Luồng duyệt: `finance_price_route`.
  - Ghi / đảo: `finance_price_post` / `finance_price_unpost`.
  - RPC biên bản / duyệt / gắn HĐ điều chỉnh / NCC hoàn tiền.
  - Vá 3 RPC hóa đơn K3c (giá theo dòng, duyệt theo bước).
  - RPC Mua hàng xem giá chốt.
- **Giá trị theo giá chốt** = ghi nợ + chênh của bản đã ghi + chênh của bản **kèm hóa đơn đang chờ duyệt**. Như vậy phần "chưa có hóa đơn" không còn dư ảo và không gắn được vào hóa đơn khác.
- **Test rollback** `.superpowers/price/price-test.mjs`: 75/75 đạt trên prod (begin … rollback).
- **Dữ liệu xem thử** `price-live.mjs` chụp từ hàm thật; fixture `price-app.html` (cổng 5187).
