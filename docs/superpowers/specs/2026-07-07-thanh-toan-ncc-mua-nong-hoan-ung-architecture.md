# Kiến trúc thanh toán NCC theo đợt, mua nóng công trường và hoàn ứng

Ngày: 2026-07-07
Trạng thái: Draft để review nghiệp vụ
Phạm vi: Cung ứng dự án, WMS, công nợ phải trả NCC, thanh toán theo đợt, quỹ/hoàn ứng công trường, QR truy vết chứng từ

## 1. Mục tiêu

Xây một luồng kế toán công trình giống cách tư duy của MISA nhưng vẫn đồng nhất với phần mềm hiện tại:

- Công trường đề xuất vật tư, phòng cung ứng tạo PO, thủ kho nhập kho, kế toán thanh toán NCC.
- Công trường có thể mua nóng: hoặc đề xuất trước rồi mua, hoặc mua ngay bằng quỹ công trường rồi hoàn ứng cuối tháng.
- Kế toán thanh toán theo NCC và theo đợt, không bị giới hạn một lần thanh toán cho một PO.
- Mỗi chứng từ phải có lưu vết: ai tạo, ai duyệt, duyệt lúc nào, phát sinh từ đâu, tác động tồn kho/công nợ/tiền thế nào.
- Mỗi chứng từ quan trọng có QR; quét QR mở đúng phiếu và thấy toàn bộ chuỗi liên quan.

Nguyên tắc lõi: mỗi sổ có một nguồn dữ liệu chính. Tồn kho do WMS quản. Công nợ NCC do sổ phải trả NCC quản. Tiền/quỹ do chứng từ thanh toán, phiếu thu/chi hoặc `project_transactions` quản. QR và audit chỉ nối chứng từ, không thay thế chứng từ gốc.

## 2. Hiện trạng hệ thống

Các phần đang có thể tận dụng:

- `purchase_orders` là chứng từ thương mại mua hàng. Bảng đã có `source_mode`, `qr_token`, `target_warehouse_id`, `received_transaction_ids`, scope dự án/công trường, snapshot NCC và danh sách dòng hàng JSONB.
- WMS `transactions` là chứng từ nhập/xuất/chuyển kho. Tồn kho chỉ cập nhật qua trạng thái WMS, không cập nhật trực tiếp từ tài chính.
- `projectFinanceWorkspaceService` hiện tính phải trả PO bằng `receivedQty - returnedQty`, rồi trừ các `project_transactions` có `sourceRef` trỏ về PO.
- `project_transactions` hiện là sổ giao dịch tài chính/dòng tiền của công trình.
- Database baseline đã có `cash_funds` và `cash_vouchers`, có thể dùng cho quỹ công trường và phiếu thu/chi.
- UI hiện chỉ ghi thanh toán từng PO; chưa có đợt thanh toán gom nhiều đơn theo NCC.

Điểm cần nâng cấp: tạo một lớp "sổ phải trả NCC" để gom công nợ theo nhà cung cấp, rồi cho thanh toán một phần hoặc toàn phần qua các đợt.

## 3. Nguyên tắc kế toán

### 3.1. Chuỗi chứng từ chuẩn

Mua vật tư chuẩn phải đi qua chuỗi:

```text
Đề xuất vật tư / Phiếu mua nóng
  -> PO hoặc chứng từ mua nóng
  -> Đợt giao / QR nhận hàng
  -> Phiếu WMS IMPORT
  -> Chứng từ phải trả NCC
  -> Đợt thanh toán NCC
  -> Dòng phân bổ thanh toán
  -> Phiếu chi / ngân hàng / project_transactions
  -> Bộ hoàn ứng công trường, nếu dùng quỹ công trường
```

Mỗi node có số chứng từ, trạng thái, người tạo, người duyệt, thời gian, file đính kèm và QR token nếu cần.

### 3.2. Tách rõ các loại giá trị

Không dùng một trường tiền để đại diện mọi nghiệp vụ.

- `committed_amount`: giá trị đặt mua theo PO hoặc phiếu mua nóng.
- `received_amount`: giá trị hàng đã nhận/đạt SL-CL.
- `recognized_amount`: giá trị được ghi nhận là phải trả NCC.
- `paid_amount`: số tiền đã phân bổ thanh toán.
- `outstanding_amount`: còn phải trả, bằng `recognized_amount - paid_amount - credit_amount`.
- `cash_out_amount`: tiền thật đã chi từ ngân hàng/quỹ.
- `site_reimbursed_amount`: giá trị được chấp nhận trong hoàn ứng công trường.

Ví dụ: NCC A tháng 7 có 10 đơn hàng, tổng đã nhập/được ghi nhận phải trả là 1 tỷ. Ngày 15/07 thanh toán 300 triệu. Sổ phải trả NCC A còn 700 triệu, đồng thời vẫn truy ngược được 300 triệu đó đã phân bổ vào PO nào.

### 3.3. Tồn kho không do tài chính ghi

Tài chính không được cộng/trừ tồn kho trực tiếp.

- Hàng NCC giao vào kho: WMS `IMPORT`.
- Trả hàng NCC: WMS `EXPORT` hoặc phiếu trả NCC.
- Mua nóng là vật tư tồn kho: vẫn phải có WMS `IMPORT`.
- Mua nóng tiêu hao ngay hoặc dịch vụ nhỏ: không nhập kho, nhưng phải có chứng từ chi phí và duyệt tài chính.

### 3.4. Ghi nhận phải trả theo thực nhận hợp lệ

Với PO, công nợ NCC chỉ ghi theo phần đã nhận hợp lệ:

```text
net_received_qty = max(0, receivedQty - returnedQty)
recognized_amount = sum(net_received_qty * unitPrice)
```

Với mua nóng không qua kho, ghi nhận phải trả sau khi kế toán/CHT duyệt chứng từ và file hóa đơn/phiếu giao hàng.

## 4. Luồng nghiệp vụ chi tiết

### 4.1. Đề xuất công trường -> PO -> nhập kho -> thanh toán

1. Công trường tạo đề xuất vật tư.
2. Cung ứng gom dòng đề xuất, tách theo NCC và tạo PO.
3. PO được duyệt/xác nhận như hiện tại.
4. NCC giao hàng, dùng QR/desktop để tạo đợt nhận hàng hoặc WMS import.
5. Thủ kho kiểm SL/CL. Phiếu WMS hoàn tất thì tồn kho mới tăng.
6. Hệ thống tạo/cập nhật chứng từ phải trả NCC theo giá trị thực nhận.
7. Kế toán lọc công nợ theo NCC/kỳ, tạo đợt thanh toán.
8. Đợt thanh toán phân bổ tiền vào các chứng từ phải trả.
9. Khi đợt thanh toán được duyệt chi/trả tiền, hệ thống tạo phiếu chi, chứng từ ngân hàng hoặc `project_transactions`.
10. QR ở bất kỳ phiếu nào đều mở được trace từ đề xuất đến thanh toán.

### 4.2. Mua nóng có đề xuất trước

Dùng cho món lớn, cần xin duyệt trước nhưng vẫn nhanh hơn quy trình mua thường.

1. BCHT tạo "Đề xuất mua nóng": NCC dự kiến, vật tư, số lượng, đơn giá tạm tính, lý do, kho nhận hoặc tiêu hao ngay.
2. CHT/KTT/PM duyệt theo phân quyền.
3. Sau duyệt, hệ thống tạo PO rút gọn với `sourceMode = site_direct_planned` hoặc giữ phiếu mua nóng ở trạng thái `approved_to_buy`.
4. Hàng về thì stock line đi qua WMS import; expense-only line đi qua duyệt tài chính.
5. Giá trị phải trả được ghi nhận từ thực nhận hoặc từ dòng chi phí đã duyệt.
6. Thanh toán có thể đi qua đợt thanh toán NCC bình thường hoặc đi vào hoàn ứng quỹ công trường.

### 4.3. Mua nóng đã phát sinh rồi cập nhật sau

Dùng cho tình huống công trường đã mua ngay bằng quỹ tháng hoặc tiền cá nhân.

1. BCHT nhập "Mua nóng đã phát sinh": NCC, ảnh hóa đơn/biên nhận, vật tư, số lượng, đơn giá, người chi tiền, nguồn tiền.
2. Nếu là vật tư tồn kho, bắt buộc tạo WMS import để thủ kho xác nhận trước khi cộng tồn.
3. Nếu là tiêu hao ngay/dịch vụ nhỏ, đánh dấu `expense_only`, không qua tồn kho nhưng phải duyệt chứng từ.
4. Kế toán kiểm tra hóa đơn, NCC, VAT, tổng tiền, file đính kèm.
5. Dòng hợp lệ tạo công nợ NCC hoặc dòng hoàn ứng.
6. Dòng bị loại giữ lại lý do từ chối và không vào thanh toán/hoàn ứng.

### 4.4. Hoàn ứng quỹ công trường cuối tháng

Công trường được cấp quỹ hằng tháng, sau đó tập hợp chứng từ để hoàn ứng/quyết toán.

1. Công ty cấp tiền vào quỹ công trường bằng `cash_vouchers` loại nạp quỹ hoặc chứng từ chuyển tiền tương ứng.
2. Trong tháng, công trường ghi các khoản mua nóng đã dùng quỹ.
3. Cuối tháng, công trường tạo bộ hoàn ứng, ví dụ `HU-202607-CT01`.
4. Kế toán review từng dòng: chấp nhận, điều chỉnh, từ chối.
5. Dòng được chấp nhận:
   - nếu chưa ghi thanh toán NCC, tạo hoặc link tới đợt thanh toán NCC;
   - nếu đã chi bằng quỹ công trường, ghi nhận vào quyết toán quỹ;
   - nếu nhân sự tự ứng tiền, tạo khoản phải hoàn lại cho người chi hoặc phiếu chi hoàn tiền.
6. Duyệt hoàn ứng không được tạo trùng chi phí nếu đợt thanh toán NCC đã post tiền.

## 5. Mô hình dữ liệu đề xuất

### 5.1. Mở rộng `purchase_orders`

Thêm source mode:

```ts
type PurchaseOrderSourceMode =
  | 'from_request'
  | 'proactive_project'
  | 'proactive_stock'
  | 'company_consolidated'
  | 'site_direct_planned'
  | 'site_direct_immediate';
```

Các cột nên bổ sung:

- `direct_purchase_id text null`: link về phiếu mua nóng, nếu có.
- `payment_term text null`: điều khoản thanh toán.
- `invoice_number text null`, `invoice_date text null`: snapshot hóa đơn NCC.
- `payment_status text not null default 'unpaid'`: chỉ là cache; nguồn đúng là bảng phân bổ thanh toán.
- `metadata jsonb not null default '{}'`: metadata phụ, không lưu giá trị kế toán cốt lõi.

Vẫn giữ PO line JSONB để tương thích UI hiện tại. Các phép tính công nợ/thanh toán nên snapshot sang bảng phải trả.

### 5.2. Bảng mới `site_direct_purchases`

Chứng từ mua nóng công trường.

Trường chính:

- `id uuid primary key default gen_random_uuid()`
- `code text unique not null`
- `project_id text null`
- `construction_site_id text not null`
- `supplier_id text null`
- `supplier_name_snapshot text not null`
- `purchase_mode text not null check in ('planned', 'immediate')`
- `payment_source text not null check in ('site_cash', 'company_bank', 'staff_paid', 'supplier_credit')`
- `target_warehouse_id text null`
- `status text not null check in ('draft', 'submitted', 'approved_to_buy', 'purchased', 'received', 'finance_review', 'reconciled', 'closed', 'rejected', 'cancelled')`
- `purchase_date date null`
- `invoice_number text null`
- `invoice_date date null`
- `gross_amount numeric(18,2) not null default 0`
- `vat_amount numeric(18,2) not null default 0`
- `total_amount numeric(18,2) not null default 0`
- `po_id text null references purchase_orders(id)`
- `wms_transaction_id text null references transactions(id)`
- `site_cash_settlement_id uuid null`
- `qr_token text unique null`
- `attachments jsonb not null default '[]'`
- `created_by uuid null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

### 5.3. Bảng mới `site_direct_purchase_lines`

Dòng chi tiết mua nóng.

Trường chính:

- `id uuid primary key default gen_random_uuid()`
- `direct_purchase_id uuid not null references site_direct_purchases(id) on delete cascade`
- `line_no integer not null`
- `line_type text not null check in ('stock_item', 'expense_only')`
- `item_id text null`
- `sku_snapshot text null`
- `item_name_snapshot text not null`
- `unit_snapshot text null`
- `quantity numeric(18,6) not null default 0`
- `unit_price numeric(18,2) not null default 0`
- `vat_rate numeric(5,2) not null default 0`
- `line_amount numeric(18,2) not null default 0`
- `accepted_quantity numeric(18,6) not null default 0`
- `accepted_amount numeric(18,2) not null default 0`
- `rejection_reason text null`
- `work_boq_item_id text null`
- `material_budget_item_id text null`
- `note text null`

### 5.4. Bảng mới `supplier_payable_documents`

Sổ phụ công nợ phải trả NCC. Đây là lớp giống MISA nhất.

Trường chính:

- `id uuid primary key default gen_random_uuid()`
- `code text unique not null`
- `source_type text not null check in ('purchase_order', 'site_direct_purchase', 'supplier_return_credit', 'opening_balance', 'manual_adjustment')`
- `source_id text not null`
- `project_id text null`
- `construction_site_id text null`
- `supplier_id text null`
- `supplier_name_snapshot text not null`
- `document_no text not null`
- `document_date date not null`
- `due_date date null`
- `currency text not null default 'VND'`
- `committed_amount numeric(18,2) not null default 0`
- `recognized_amount numeric(18,2) not null default 0`
- `credit_amount numeric(18,2) not null default 0`
- `status text not null check in ('open', 'partial', 'paid', 'cancelled')`
- `qr_token text unique null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Không nên tin một cột `paid_amount` mutable nếu nhiều service cùng cập nhật. Tốt nhất tạo view tính paid/outstanding từ bảng phân bổ thanh toán, hoặc chỉ cho một RPC duy nhất cập nhật cache.

### 5.5. View mới `supplier_payable_balances`

Nguồn đọc cho dashboard công nợ và màn hình chọn chứng từ thanh toán.

Trường cần có:

- thông tin chứng từ phải trả;
- `allocated_paid_amount = sum(allocation đã paid)`;
- `outstanding_amount = recognized_amount - credit_amount - allocated_paid_amount`;
- `is_overdue`.

Nếu dùng Postgres 15+, view nên dùng `security_invoker = true`.

### 5.6. Bảng mới `supplier_payment_batches`

Header đợt thanh toán theo NCC.

Trường chính:

- `id uuid primary key default gen_random_uuid()`
- `code text unique not null`
- `project_id text null`
- `construction_site_id text null`
- `supplier_id text null`
- `supplier_name_snapshot text not null`
- `period_month date null`: ngày đầu tháng, ví dụ `2026-07-01`
- `payment_date date not null`
- `payment_method text not null check in ('bank_transfer', 'cash', 'site_cash', 'offset', 'other')`
- `cash_fund_id uuid null references cash_funds(id)`
- `cash_voucher_id uuid null references cash_vouchers(id)`
- `project_transaction_id text null references project_transactions(id)`
- `bank_account_snapshot text null`
- `document_ref text null`
- `total_recognized_snapshot numeric(18,2) not null default 0`
- `payment_amount numeric(18,2) not null default 0`
- `status text not null check in ('draft', 'submitted', 'approved', 'paid', 'cancelled')`
- `qr_token text unique null`
- `attachments jsonb not null default '[]'`
- `created_by uuid null`
- `approved_by uuid null`
- `paid_by uuid null`
- `created_at timestamptz not null default now()`
- `approved_at timestamptz null`
- `paid_at timestamptz null`
- `note text null`

### 5.7. Bảng mới `supplier_payment_allocations`

Dòng phân bổ tiền từ một đợt thanh toán vào từng chứng từ phải trả.

Trường chính:

- `id uuid primary key default gen_random_uuid()`
- `payment_batch_id uuid not null references supplier_payment_batches(id) on delete cascade`
- `payable_document_id uuid not null references supplier_payable_documents(id)`
- `source_type text not null`
- `source_id text not null`
- `document_no_snapshot text not null`
- `recognized_amount_snapshot numeric(18,2) not null default 0`
- `paid_before_snapshot numeric(18,2) not null default 0`
- `outstanding_before_snapshot numeric(18,2) not null default 0`
- `allocated_amount numeric(18,2) not null default 0`
- `discount_amount numeric(18,2) not null default 0`
- `withholding_amount numeric(18,2) not null default 0`
- `note text null`

Ràng buộc:

- `allocated_amount >= 0`
- `allocated_amount + discount_amount + withholding_amount <= outstanding_before_snapshot`
- unique `(payment_batch_id, payable_document_id)`.

### 5.8. Bảng mới cho hoàn ứng quỹ công trường

`site_cash_settlement_batches`:

- `id uuid primary key default gen_random_uuid()`
- `code text unique not null`
- `project_id text null`
- `construction_site_id text not null`
- `period_month date not null`
- `cash_fund_id uuid null references cash_funds(id)`
- `opening_balance numeric(18,2) not null default 0`
- `topup_amount numeric(18,2) not null default 0`
- `accepted_spend_amount numeric(18,2) not null default 0`
- `rejected_spend_amount numeric(18,2) not null default 0`
- `closing_balance numeric(18,2) not null default 0`
- `status text not null check in ('draft', 'submitted', 'reviewing', 'approved', 'closed', 'cancelled')`
- `qr_token text unique null`
- các trường actor/timestamp.

`site_cash_settlement_lines`:

- `id uuid primary key default gen_random_uuid()`
- `settlement_id uuid not null references site_cash_settlement_batches(id) on delete cascade`
- `source_type text not null check in ('site_direct_purchase', 'cash_voucher', 'manual_adjustment')`
- `source_id text not null`
- `supplier_id text null`
- `document_no_snapshot text not null`
- `spend_amount numeric(18,2) not null default 0`
- `accepted_amount numeric(18,2) not null default 0`
- `status text not null check in ('pending', 'accepted', 'adjusted', 'rejected')`
- `review_note text null`

## 6. Kiến trúc post chứng từ

### 6.1. Post công nợ phải trả

Chỉ tạo/cập nhật chứng từ phải trả từ các sự kiện đã hợp lệ:

- PO có thực nhận WMS hoàn tất hoặc số thực nhận thay đổi bằng workflow duyệt.
- Phiếu trả NCC hoàn tất.
- Mua nóng được kế toán/CHT duyệt.
- Nhập số dư đầu kỳ.

Việc post phải idempotent theo `source_type + source_id`. Chạy lại post cho cùng PO chỉ cập nhật một chứng từ phải trả, không tạo trùng.

### 6.2. Post đợt thanh toán

Trạng thái đợt thanh toán:

```text
draft -> submitted -> approved -> paid
draft/submitted/approved -> cancelled
```

Khi chuyển `paid`, một RPC/database function atomic cần:

1. Lock payment batch và allocation rows.
2. Tính lại outstanding hiện tại của từng chứng từ phải trả.
3. Chặn trả vượt outstanding.
4. Cập nhật batch thành `paid`, set `paid_at`, `paid_by`.
5. Tạo `cash_vouchers` nếu thanh toán bằng tiền mặt/quỹ công trường.
6. Tạo hoặc link một dòng `project_transactions` để tương thích tài chính hiện tại.
7. Ghi audit event và document link.

`project_transactions` nên dùng:

```text
type = expense
category = materials
source = workflow
sourceRef = supplier_payment_batch:<batch_id>
```

Không tạo một `project_transactions` cho từng PO allocation, vì sẽ nhân đôi dòng tiền.

### 6.3. Chiến lược phân bổ tiền

Modal thanh toán hỗ trợ:

- FIFO theo hạn thanh toán/ngày chứng từ.
- Nhập tay từng chứng từ.
- Phân bổ tỷ lệ theo outstanding.

Ví dụ NCC A tháng 7:

```text
Tổng phải trả đã ghi nhận: 1,000,000,000
Đợt thanh toán ngày 15/07: 300,000,000
Phân bổ:
  PO-001: 100,000,000
  PO-002: 80,000,000
  PO-003: 120,000,000
Còn phải trả sau post: 700,000,000
```

### 6.4. Hủy và đảo bút toán

Không xóa cứng đợt đã thanh toán.

- Batch chưa paid: cho `cancelled`.
- Batch đã paid: tạo chứng từ đảo/reversal.
- Reversal tạo dòng âm tương ứng ở cash voucher/project transaction và khôi phục outstanding.

## 7. QR và truy vết chứng từ

### 7.1. Payload QR

Payload tối giản:

```json
{
  "v": 1,
  "type": "supplier_payment_batch",
  "id": "uuid-or-text-id",
  "token": "public-random-token"
}
```

QR chỉ định danh chứng từ, không tự cấp quyền. User vẫn phải qua RLS/app permission.

### 7.2. Trace graph

`documentTraceService` cần hiển thị:

- phiếu hiện tại;
- chứng từ cha;
- chứng từ con;
- timeline duyệt;
- tác động tồn kho;
- tác động công nợ/thanh toán;
- file đính kèm;
- audit log.

Ví dụ chuẩn:

```text
MR-0007
  -> PO-202607-001
  -> WMS IMPORT TX-abc123
  -> AP NCC-A PO-202607-001
  -> Supplier Payment Batch SPB-20260715-001
  -> Project Transaction PTX-...
```

Ví dụ mua nóng:

```text
SDP-202607-004
  -> PO-202607-HOT-004
  -> WMS IMPORT TX-def456
  -> AP NCC-B SDP-202607-004
  -> Site Cash Settlement SCS-202607
  -> Supplier Payment Batch / Cash Voucher
```

## 8. Service architecture

### 8.1. `siteDirectPurchaseService`

- Tạo mua nóng planned/immediate.
- Validate dòng tồn kho và dòng tiêu hao ngay.
- Tạo/link PO nếu cần.
- Tạo WMS import draft khi stock line nhận hàng.
- Submit sang finance review.
- Link vào bộ hoàn ứng.

### 8.2. `supplierPayableService`

- Tạo chứng từ phải trả từ PO/mua nóng/source event.
- Tính lại recognized amount sau trả hàng hoặc điều chỉnh thực nhận.
- Query payable balance theo NCC/dự án/công trường/kỳ.
- Sinh QR công nợ.

### 8.3. `supplierPaymentBatchService`

- Query công nợ mở theo NCC/kỳ.
- Tạo đợt thanh toán.
- Phân bổ FIFO/manual/proportional.
- Validate không overpay.
- Submit/approve/post/reverse.
- Sinh QR đợt thanh toán.

### 8.4. `siteCashSettlementService`

- Mở bộ hoàn ứng tháng.
- Kéo các mua nóng từ quỹ công trường hoặc nhân sự tự chi.
- Review từng dòng.
- Tính tồn quỹ đầu kỳ, nạp thêm, chi được duyệt, chi bị loại, tồn cuối.
- Link dòng được duyệt với payment batch hoặc cash voucher.

### 8.5. `documentTraceService`

- Resolve QR token.
- Traverse document links.
- Trả về graph nodes/edges/status/amount/attachments.
- Ẩn dữ liệu nhạy cảm theo quyền.

## 9. UI architecture

### 9.1. Tab Cung ứng

Thêm entry "Mua nóng công trường":

- Đề xuất trước rồi mua.
- Mua ngay rồi cập nhật hóa đơn.
- Hiển thị trạng thái kho, trạng thái kế toán, trạng thái hoàn ứng và QR.

### 9.2. WMS / Kho

Không tạo đường tắt cộng tồn. Dòng mua nóng là vật tư tồn kho vẫn tạo WMS import và đi qua duyệt/nhận bình thường.

### 9.3. Tài chính công trình

Thêm các view:

- `Công nợ NCC`: gom theo NCC, drilldown đến PO/phiếu nhập.
- `Thanh toán NCC`: danh sách batch, trạng thái, QR, allocation.
- `Hoàn ứng công trường`: bộ hoàn ứng theo tháng.

Điều chỉnh summary:

- Chi phí vật tư đã ghi nhận nên lấy từ `supplier_payable_documents`.
- Dòng tiền chi ra lấy từ payment batch/project transaction.
- Công nợ còn phải trả lấy từ `supplier_payable_balances`.

Nhờ vậy, trường hợp nhập hàng 1 tỷ nhưng mới trả 300 triệu không làm chi phí vật tư bị hiểu sai là chỉ 300 triệu.

### 9.4. Modal tạo đợt thanh toán NCC

Luồng UI:

1. Chọn NCC và kỳ.
2. Hệ thống load công nợ mở.
3. Nhập số tiền thanh toán.
4. Chọn cách phân bổ.
5. Review allocation và outstanding còn lại.
6. Đính kèm chứng từ ngân hàng/phiếu chi.
7. Submit/approve/pay.

## 10. Quyền và RLS

Phân quyền đề xuất:

- Người công trường: tạo mua nóng draft, upload chứng từ, xem chứng từ thuộc công trường.
- CHT/PM: duyệt mua nóng planned, submit bộ hoàn ứng.
- Thủ kho: xử lý WMS import theo kho được giao.
- Cung ứng: tạo/sửa PO trước trạng thái khóa.
- Kế toán/KTT: tạo đợt thanh toán, review công nợ, review hoàn ứng.
- Finance approver/Admin: duyệt và post thanh toán/reversal.

Nguyên tắc RLS:

- Bật RLS cho mọi bảng public mới.
- Scope theo `project_id`, `construction_site_id`, quyền dự án và quyền tài chính.
- Trong policy, dùng `(select auth.uid())` thay vì gọi `auth.uid()` trực tiếp trên từng row.
- Index các cột dùng trong RLS.
- Function post tiền/công nợ nên đặt ở private schema nếu cần `security definer`; không expose tùy tiện ở public.

## 11. Index và hiệu năng

Index cần có:

- `site_direct_purchases(construction_site_id, status, created_at desc)`
- `site_direct_purchases(supplier_id, purchase_date desc)`
- `site_direct_purchase_lines(direct_purchase_id)`
- `supplier_payable_documents(supplier_id, status, document_date desc)`
- `supplier_payable_documents(project_id, construction_site_id, supplier_id)`
- Partial index: `supplier_payable_documents(supplier_id, document_date desc) where status in ('open', 'partial')`
- `supplier_payment_batches(supplier_id, period_month, status)`
- `supplier_payment_batches(construction_site_id, payment_date desc)`
- `supplier_payment_allocations(payment_batch_id)`
- `supplier_payment_allocations(payable_document_id)`
- `site_cash_settlement_batches(construction_site_id, period_month, status)`
- `site_cash_settlement_lines(settlement_id)`

Dùng `numeric(18,2)` cho tiền, `numeric(18,6)` cho số lượng, `timestamptz` cho timestamp và `date` cho ngày kế toán.

## 12. Chiến lược migration

Phase 1: Thêm AP/payment tables và service layer.

- Backfill `supplier_payable_documents` từ PO hiện có có giá trị thực nhận.
- Suy luận paid từ `project_transactions.sourceRef` dạng `purchase_order:<po_id>:payment:<payment_id>`.
- Có thể tạo synthetic payment batch cho các thanh toán PO cũ để UI mới hiển thị đủ lịch sử.

Phase 2: Thêm UI thanh toán NCC theo đợt.

- Nút thanh toán một PO hiện tại trở thành shortcut tạo batch có một allocation.
- Thêm workflow gom thanh toán theo NCC/kỳ.

Phase 3: Thêm mua nóng công trường.

- UI tạo planned/immediate direct purchase.
- Link direct purchase với WMS, AP và hoàn ứng.

Phase 4: Thêm hoàn ứng công trường và QR trace graph.

- Dùng `cash_funds` / `cash_vouchers` hiện có.
- Thêm UI bộ hoàn ứng tháng và trang quét QR truy vết chứng từ.

## 13. Invariants bắt buộc

- Vật tư tồn kho không tăng nếu chưa có WMS import hoàn tất.
- Một chứng từ phải trả không được trả vượt outstanding.
- Tổng allocation của payment batch phải bằng payment amount, trừ khi có mô hình phí/khấu trừ được duyệt.
- Payment batch đã paid không sửa trực tiếp.
- Đảo thanh toán phải tạo chứng từ reversal, không xóa lịch sử.
- Duyệt hoàn ứng không được ghi trùng chi phí đã post bởi payment batch.
- QR scan không bypass quyền.
- File đính kèm và audit log luôn gắn với chứng từ nguồn.

## 14. Test plan

Unit tests:

- Tính phải trả PO từ `receivedQty`, `returnedQty`, `unitPrice`.
- Tính outstanding từ allocation.
- Phân bổ FIFO/manual/proportional.
- Chặn overpayment.
- Tính tiền dòng mua nóng stock/expense-only.
- Tính hoàn ứng: tồn đầu + nạp thêm - chi được duyệt = tồn cuối.

Database/RPC tests:

- Post payment batch atomic.
- Hai user post đồng thời không thể trả vượt cùng chứng từ.
- RLS chặn xem khác dự án/công trường.
- Reversal khôi phục outstanding và tạo dòng âm.

Integration tests:

- Đề xuất vật tư -> PO -> WMS receipt -> AP -> payment batch -> outstanding.
- NCC A tháng 7: 10 PO, ghi nhận 1 tỷ, trả 300 triệu ngày 15/07, còn 700 triệu.
- Mua nóng planned -> duyệt -> WMS receipt -> AP -> thanh toán.
- Mua nóng immediate -> chứng từ -> WMS import -> hoàn ứng -> thanh toán/cash voucher.
- Quét QR mở được PO, WMS transaction, AP document, payment batch và bộ hoàn ứng liên quan.

## 15. Quyết định kiến trúc khuyến nghị

- Mua nóng nên có `site_direct_purchases` để đúng UX công trường, nhưng vẫn tạo/link PO khi cần để giữ đồng nhất với cung ứng và công nợ NCC.
- `project_transactions` trước mắt giữ vai trò compatibility cashflow. Chi phí vật tư ghi nhận nên đọc từ AP subledger, không chỉ từ số đã thanh toán.
- Thanh toán bằng tiền mặt/quỹ công trường dùng `cash_vouchers`; thanh toán ngân hàng lưu ở payment batch trước, sau này có bank ledger thì nối thêm.
- Hóa đơn NCC lưu snapshot trong AP document ở MVP; chỉ tách bảng hóa đơn riêng nếu cần báo cáo VAT/thuế chi tiết hơn.
