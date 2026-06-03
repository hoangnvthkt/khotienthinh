# Doi chieu kien truc vat tu ERP voi he thong hien tai

Ngay lap: 2026-06-03

Tai lieu nay bo sung cho `docs/phuong-an-nang-cap-quy-trinh-de-xuat-du-an.md`.

Muc tieu cua phu luc nay khong phai thiet ke them buoc duyet. Muc tieu la tach ro lop nghiep vu vat tu:

- Workflow chi quyet dinh **ai duyet, ai tra lai, ai tu choi**.
- Supply chain engine quyet dinh **yeu cau duoc dap ung tu dau, bao nhieu, luc nao**.
- Inventory ledger quyet dinh **ton kho thuc su tang/giam nhu the nao**.

Ket luan ngan: file goi y ERP nen ap dung. He thong hien tai da co nhieu nen tang dung huong, nhung can nang cap tu "document status + stock cache" sang "ledger + reservation + allocation" de xu ly dung cac case huy phieu, tra hang, giao nhieu dot, mua nhieu dot va giao truc tiep cong truong.

## 1. Doi chieu hien trang

| Mang nghiep vu | Hien tai da co | Diem can nang |
|---|---|---|
| BOQ lien ket phieu vat tu | Dong request co `workBoqItemId`, `materialBudgetItemId`, snapshot so luong va vuot BOQ. Fulfillment line cung luu lai BOQ refs. | Nen giu. Can them allocation de truy vet BOQ line duoc cap boi stock/PO/receipt nao. |
| Workflow phe duyet | Dang co workflow hard-code cho phieu vat tu va module Quy trinh dong. | Ke hoach nang cap workflow dong la dung, nhung workflow khong duoc tinh ton kho. |
| Fulfillment nhieu dot | Da co `material_request_fulfillment_batches` va `material_request_fulfillment_lines`, co dot cap tu kho, dot nhan PO, so luong issued/received. | Hien batch la lop thuc thi. Can them `fulfillment_plans` de lap ke hoach nguon cap truoc khi tao dot cap/PO/receipt. |
| PO nhieu dot | PO co trang thai `partial`, `delivered`; co bang link PO line voi request line. | Can them allocation line de biet 1 request line duoc PO nao cap bao nhieu, da nhan bao nhieu, da tra bao nhieu. |
| Kiem tra ton kha dung | `inventoryStockGuard` tinh on hand tu `items.stock_by_warehouse`, reserved tu request/transaction dang pending/approved. | Nen chuyen reservation thanh bang rieng. On hand lay tu ledger/view, `stock_by_warehouse` chi la cache. |
| Ton kho | RPC `process_transaction_status` cap nhat `items.stock_by_warehouse` khi transaction completed. | Can inventory ledger append-only. Khong tinh ton kho tu status chung tu, khong sua JSON stock truc tiep. |
| Hoan tac/tra hang | Da co cancel pending, return batch, return PO sau khi nhan. | Sau khi da posted ton kho, moi hoan tac phai sinh transaction dao chieu, khong update nguoc stock hay xoa chung tu. |
| Dau ky du an | Opening balance dang update `stock_by_warehouse` va tao transaction adjustment completed. | Nen tao opening transaction/ledger la nguon goc, stock cache duoc rebuild tu ledger. |

## 2. Nguyen tac kien truc nen chot

1. **Inventory ledger la nguon su that**.
   Ton kho tinh tu tong ledger line theo item + warehouse + project/site/lot neu co.

2. **Document status khong duoc la nguon tinh ton**.
   Trang thai MR/PO/GR/Return chi phuc vu dieu hanh chung tu. Ton kho chi doi khi co ledger posting.

3. **Khong xoa chung tu da phat sinh ledger**.
   Draft chua phat sinh co the xoa. Da posted thi cancel/reverse bang transaction dao chieu.

4. **Moi nghiep vu hoan tac sinh but toan dao**.
   Tra hang, huy phieu da nhap/xuat, dieu chinh sai so luong deu tao ledger entry moi co `reversal_of_transaction_id`.

5. **Reservation tach khoi on hand**.
   Cong thuc:

```text
on_hand_qty = sum(inventory_ledger_entries.qty_delta)
reserved_qty = sum(inventory_reservations.qty where status in ('soft_reserved', 'hard_reserved'))
available_qty = on_hand_qty - reserved_qty
```

6. **Workflow chi mo khoa nghiep vu**.
   Khi workflow duyet xong, he thong moi duoc tao fulfillment plan, PO, warehouse transfer, receipt. Workflow khong lam tang/giam ton.

## 3. Business Architecture

Kien truc vat tu nen chia thanh 6 engine doc lap:

| Engine | Vai tro | Vi du trong he thong |
|---|---|---|
| Demand Engine | Tao nhu cau tu BOQ/MR, kiem vuot BOQ, ghi snapshot. | De xuat vat tu D16 100 tan. |
| Approval Engine | Duyet/tra lai/tu choi theo workflow dong. | Quan ly cong truong -> QLDA -> Phong vat tu. |
| Fulfillment Engine | Lap ke hoach dap ung nhu cau bang kho, PO, giao truc tiep. | 30 tan tu kho, 70 tan mua NCC. |
| Reservation Engine | Giu cho ton kha dung cho MR/transfer/PO allocation. | MR001 giu 80 tan, MR002 chi thay con 20 tan kha dung. |
| Inventory Ledger Engine | Ghi but toan ton kho tang/giam/dao chieu. | Receipt, issue, transfer, return, adjustment, supplier return. |
| Audit/Trace Engine | Truy vet ai tao, ai duyet, ai posted, chung tu nao sinh chung tu nao. | MR -> plan -> PO001/PO002 -> GR -> site receipt -> return. |

## 4. Domain Model de xuat

```text
Project / Construction Site
  -> BOQ / Material Budget
  -> Material Request
      -> Request Lines
      -> Workflow Instance
      -> Fulfillment Plan
          -> Fulfillment Plan Lines
          -> Material Allocations
              -> Stock Reservation
              -> Purchase Order Line
              -> Fulfillment Batch / Delivery Batch
              -> Inventory Transaction / Ledger Entries
```

### Cac bang hien tai nen giu

- `requests`: van la Material Request.
- `purchase_orders`: van la PO.
- `purchase_order_request_lines`: tiep tuc link PO line voi MR line.
- `material_request_fulfillment_batches`: giu vai tro dot giao/dot nhan thuc te.
- `material_request_fulfillment_lines`: giu vai tro so luong cap/nhan theo tung dot.
- `transactions`: co the giu lam WMS document header trong giai do chuyen doi.

### Cac bang nen bo sung

- `inventory_transactions`: header cua inventory posting.
- `inventory_transaction_lines` hoac `inventory_ledger_entries`: cac dong signed quantity.
- `inventory_reservations`: giu cho ton.
- `fulfillment_plans`: ke hoach dap ung 1 MR.
- `fulfillment_plan_lines`: moi dong ke hoach theo nguon cap.
- `material_allocations`: truy vet MR line duoc cap boi stock/PO/receipt/batch nao.
- `inventory_document_links`: link chung tu goc va chung tu sinh sau neu can audit sau hon.

## 5. PostgreSQL Schema de xuat

### 5.1. Inventory transaction header

```sql
create type inventory_transaction_type as enum (
  'receipt',
  'issue',
  'transfer',
  'return',
  'adjustment',
  'supplier_return',
  'opening_balance'
);

create type inventory_posting_status as enum (
  'draft',
  'posted',
  'reversed'
);

create table inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_no text not null unique,
  transaction_type inventory_transaction_type not null,
  status inventory_posting_status not null default 'posted',
  document_type text,
  document_id text,
  reversal_of_transaction_id uuid references inventory_transactions(id),
  project_id text references projects(id),
  construction_site_id text,
  supplier_id text references suppliers(id),
  source_warehouse_id text references warehouses(id),
  target_warehouse_id text references warehouses(id),
  posted_at timestamptz,
  posted_by uuid references users(id),
  reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references users(id)
);
```

### 5.2. Inventory ledger entries

```sql
create table inventory_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references inventory_transactions(id) on delete restrict,
  item_id text not null references items(id) on delete restrict,
  warehouse_id text not null references warehouses(id) on delete restrict,
  qty_delta numeric not null,
  unit text,
  unit_cost numeric,
  amount numeric,
  request_id text references requests(id),
  request_line_id text,
  purchase_order_id text references purchase_orders(id),
  purchase_order_line_id text,
  fulfillment_batch_id uuid references material_request_fulfillment_batches(id),
  fulfillment_line_id uuid references material_request_fulfillment_lines(id),
  material_budget_item_id text references material_budget_items(id),
  work_boq_item_id text references project_work_boq_items(id),
  lot_no text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (qty_delta <> 0)
);

create index idx_inventory_ledger_stock
  on inventory_ledger_entries(item_id, warehouse_id);

create index idx_inventory_ledger_request_line
  on inventory_ledger_entries(request_id, request_line_id);

create index idx_inventory_ledger_boq
  on inventory_ledger_entries(material_budget_item_id, work_boq_item_id);
```

### 5.3. Stock summary view

```sql
create view inventory_stock_balances as
select
  item_id,
  warehouse_id,
  sum(qty_delta) as on_hand_qty
from inventory_ledger_entries
group by item_id, warehouse_id;
```

Neu can toc do, tao materialized view hoac bang cache `inventory_stock_cache`. Cache nay chi duoc update boi posting function, khong update tay tu UI.

### 5.4. Reservation

```sql
create type inventory_reservation_status as enum (
  'soft_reserved',
  'hard_reserved',
  'released',
  'consumed',
  'expired'
);

create table inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references items(id) on delete restrict,
  warehouse_id text not null references warehouses(id) on delete restrict,
  request_id text references requests(id),
  request_line_id text,
  fulfillment_plan_line_id uuid,
  qty numeric not null check (qty > 0),
  status inventory_reservation_status not null,
  reserved_by uuid references users(id),
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  consumed_transaction_id uuid references inventory_transactions(id),
  reason text,
  metadata jsonb not null default '{}'
);

create index idx_inventory_reservations_available_calc
  on inventory_reservations(item_id, warehouse_id, status);
```

### 5.5. Fulfillment plan va allocation

```sql
create type fulfillment_source_type as enum (
  'stock',
  'purchase_order',
  'direct_delivery',
  'transfer',
  'manual_adjustment'
);

create table fulfillment_plans (
  id uuid primary key default gen_random_uuid(),
  material_request_id text not null references requests(id) on delete restrict,
  project_id text references projects(id),
  construction_site_id text,
  status text not null default 'draft',
  planned_by uuid references users(id),
  planned_at timestamptz,
  created_at timestamptz not null default now()
);

create table fulfillment_plan_lines (
  id uuid primary key default gen_random_uuid(),
  fulfillment_plan_id uuid not null references fulfillment_plans(id) on delete cascade,
  request_line_id text not null,
  item_id text not null references items(id) on delete restrict,
  source_type fulfillment_source_type not null,
  source_warehouse_id text references warehouses(id),
  target_warehouse_id text references warehouses(id),
  purchase_order_id text references purchase_orders(id),
  purchase_order_line_id text,
  planned_qty numeric not null check (planned_qty > 0),
  allocated_qty numeric not null default 0,
  received_qty numeric not null default 0,
  returned_qty numeric not null default 0,
  status text not null default 'planned',
  note text,
  created_at timestamptz not null default now()
);

create table material_allocations (
  id uuid primary key default gen_random_uuid(),
  material_request_id text not null references requests(id) on delete restrict,
  request_line_id text not null,
  item_id text not null references items(id) on delete restrict,
  fulfillment_plan_line_id uuid references fulfillment_plan_lines(id),
  source_type fulfillment_source_type not null,
  source_ref_type text,
  source_ref_id text,
  allocated_qty numeric not null default 0,
  issued_qty numeric not null default 0,
  received_qty numeric not null default 0,
  returned_qty numeric not null default 0,
  reservation_id uuid references inventory_reservations(id),
  inventory_transaction_id uuid references inventory_transactions(id),
  created_at timestamptz not null default now()
);
```

## 6. ERD rut gon

```text
requests
  1 -> n material_request_fulfillment_batches
  1 -> n material_allocations
  1 -> 1 fulfillment_plans

fulfillment_plans
  1 -> n fulfillment_plan_lines

fulfillment_plan_lines
  1 -> n material_allocations
  1 -> n inventory_reservations
  n -> 1 purchase_orders / purchase_order_lines

purchase_orders
  1 -> n purchase_order_request_lines
  1 -> n material_allocations

inventory_transactions
  1 -> n inventory_ledger_entries
  n -> 1 source document
  n -> 1 reversal_of_transaction

inventory_ledger_entries
  n -> 1 items
  n -> 1 warehouses
  n -> 1 requests/request_line
  n -> 1 BOQ/material_budget_line
```

## 7. Inventory Ledger Design

### Transaction flow

| Nghiep vu | Ledger sinh ra |
|---|---|
| Receipt | `+qty` vao kho nhan. |
| Issue | `-qty` tai kho xuat. |
| Transfer | `-qty` kho nguon va `+qty` kho dich trong cung transaction. |
| Return cong truong ve kho | `-qty` kho cong truong va `+qty` kho tong/kho dich. |
| Adjustment | `+qty` hoac `-qty` tai kho dieu chinh, kem ly do. |
| Supplier return | `-qty` tai kho dang giu hang, link PO/GR/NCC. |
| Opening balance | `+qty` vao kho dau ky, link du an/cong truong/BOQ neu co. |

### Cach tinh ton kho

```text
Ton kho mot vat tu tai mot kho =
sum(qty_delta)
where item_id = X
and warehouse_id = Y
and transaction.status = 'posted'
```

Khong can doc `requests.status`, `purchase_orders.status` hay `fulfillment_batches.status` de tinh on hand.

### Audit

Moi posting can luu:

- `document_type`, `document_id`: chung tu goc.
- `posted_by`, `posted_at`: nguoi va thoi diem ghi so.
- `reversal_of_transaction_id`: neu la hoan tac.
- `metadata`: snapshot du lieu can truy vet.
- BOQ refs: `material_budget_item_id`, `work_boq_item_id`.

## 8. Fulfillment Design

Vi du MR can D16 100 tan, kho tong co 30 tan kha dung:

```text
MR001 / D16 / requested 100
  Plan line 1: stock / kho tong -> cong truong / 30
  Plan line 2: purchase_order / NCC A / 40
  Plan line 3: purchase_order / NCC B / 30
```

Lop `fulfillment_plans` quyet dinh **se cap bang nguon nao**.
Lop `material_request_fulfillment_batches` hien co quyet dinh **dot nao da giao/da nhan thuc te**.

Voi kien truc nay, he thong tinh duoc:

```text
requested_qty = request line qty
allocated_qty = sum(material_allocations.allocated_qty)
issued_qty = sum(material_allocations.issued_qty)
received_qty = sum(material_allocations.received_qty)
returned_qty = sum(material_allocations.returned_qty)
remaining_qty = requested_qty - received_qty + returned_qty
unplanned_qty = requested_qty - allocated_qty
```

Khong can gan cung request status de biet phieu dang thieu bao nhieu.

## 9. Reservation Design

Cong thuc:

```text
on_hand = sum(ledger qty_delta)
reserved = sum(active reservation qty)
available = on_hand - reserved
```

Phan loai:

| Loai | Khi nao dung | Tac dung |
|---|---|---|
| Soft reserve | MR moi gui/cho duyet hoac plan nhap nhap | Canh bao va tranh over-plan. |
| Hard reserve | MR da duyet va da chot nguon tu kho | Khong cho MR khac lay. |
| Consumed | Khi ledger issue/transfer da posted | Reservation ket thuc, ton thuc giam. |
| Released | Khi huy plan, tra lai, doi nguon cap | Tra lai available. |

Hien tai `inventoryStockGuard` da mo phong y nay bang cach tinh tu request/transaction dang pending. Nen chuyen no thanh bang `inventory_reservations` de:

- Khong phu thuoc vao status nhieu chung tu.
- Truy vet ai reserve, reserve luc nao, vi sao release.
- Xu ly duoc partial consume va partial release.

## 10. Material Allocation

Allocation tra loi cau hoi: "Mot dong yeu cau vat tu duoc dap ung boi nhung nguon nao?"

Vi du:

```text
MR001 / D16 / 100 tan
  Allocation A: stock WH01, reserve 30, transfer TX001, received 30
  Allocation B: PO001 line 1, ordered 40, GR001, received 40
  Allocation C: PO002 line 1, ordered 30, GR002, received 20, remaining 10
```

Day la lop dang thieu ro nhat trong he thong hien tai. `purchase_order_request_lines` va `material_request_fulfillment_lines` da co mot phan trace, nhung chua gom thanh mot bang allocation duy nhat de bao cao end-to-end.

## 11. State Machine chung tu

Luu y: state machine chi dieu hanh chung tu. Ton kho chi doi khi co ledger posting.

### Material Request

```text
draft
 -> in_review
 -> returned_to_creator
 -> in_review
 -> rejected
 -> approved
 -> planned
 -> partially_fulfilled
 -> fulfilled
 -> closed
```

Dieu kien:

- `approved`: workflow hoan tat.
- `planned`: co fulfillment plan.
- `partially_fulfilled`: received_qty > 0 va remaining_qty > 0.
- `fulfilled`: received_qty >= requested_qty.
- `closed`: nguoi co quyen dong phieu, khong con tranh chap/variance.

### Purchase Order

```text
draft -> sent -> confirmed -> in_transit -> partial -> delivered -> closed
                               -> supplier_returned
                               -> cancelled
```

Dieu kien:

- `partial`: GR/receipt nhan chua du.
- `delivered`: received_qty >= ordered_qty.
- `supplier_returned`: co supplier_return transaction.
- `cancelled`: chi cancel thang neu chua posted GR; neu da posted thi phai return/reverse.

### Goods Receipt

```text
draft -> posted -> reversed
```

`posted` tao receipt ledger. `reversed` tao transaction dao chieu, khong sua ledger cu.

### Warehouse Transfer

```text
draft -> reserved -> picked -> in_transit -> received -> closed
                         -> cancelled
                         -> reversed
```

Transfer ledger co 2 dong:

- `-qty` kho nguon.
- `+qty` kho dich.

Neu cong ty muon kiem soat hang dang van chuyen chat hon, co the them warehouse ao `IN_TRANSIT`:

- Pick: `-qty` kho nguon, `+qty` in-transit.
- Site receipt: `-qty` in-transit, `+qty` kho cong truong.

### Site Receipt

```text
draft -> quality_check -> posted -> variance_pending -> closed
```

Cong truong nhan thieu/du/kems chat luong thi luu variance va tao ledger theo so luong thuc nhan.

### Material Return

```text
draft -> approved -> posted -> closed
```

Return cong truong ve kho tao transfer/return ledger:

- `-qty` kho cong truong.
- `+qty` kho nhan lai.

### Supplier Return

```text
draft -> approved -> posted -> closed
```

Return cho NCC tao supplier_return ledger:

- `-qty` tai kho dang giu hang.
- Link ve PO/GR/NCC.

## 12. Event Flow mau

### 12.1. MR 100 tan, kho co 30 tan

```text
1. MR duoc tao tu BOQ: D16 100 tan.
2. Workflow duyet xong.
3. Fulfillment engine doc available:
   on_hand 30, reserved 0, available 30.
4. Tao plan:
   - Stock allocation 30.
   - Procurement allocation 70.
5. Tao hard reservation 30 cho kho tong.
6. Tao PO cho 70 hoac tach PO001 40 + PO002 30.
7. Khi xuat 30 tu kho:
   - Consume reservation.
   - Post transfer/issue ledger.
8. Khi NCC giao 70:
   - Neu qua kho tong: post receipt vao kho tong, sau do transfer di cong truong.
   - Neu giao truc tiep: post receipt truc tiep vao kho cong truong.
9. MR summary tinh tu allocation/ledger, khong tu status cung.
```

### 12.2. Giao truc tiep cong truong

Case: NCC giao thang cong truong, khong qua kho tong.

Ledger:

```text
receipt:
  +70 tai site_warehouse
  source document = PO/GR
  supplier_id = NCC
  request_id/request_line_id = MR001/D16
```

Khong tao `+70` tai kho tong, nen khong co ton ao. Van truy vet duoc nguon hang qua PO, GR, supplier va allocation.

### 12.3. Return flow

Case:

```text
Cong truong nhan: 100
Su dung: 70
Tra kho: 20
Hao hut: 10
```

Neu cong truong co kho site:

```text
1. Site receipt:
   +100 tai kho cong truong

2. Usage/issue to consumption:
   -70 tai kho cong truong
   document_type = site_consumption

3. Material return:
   -20 tai kho cong truong
   +20 tai kho tong/kho nhan lai

4. Loss/adjustment:
   -10 tai kho cong truong
   document_type = material_loss
   reason = hao hut
```

Ton cuoi:

```text
Kho cong truong: +100 -70 -20 -10 = 0
Kho tong/kho nhan lai: +20
Chi phi/hao hut: 10 duoc audit rieng
```

Neu cong ty khong muon quan ly "su dung" thanh ledger rieng, ton cong truong se van con 70 tren so lieu. Vi vay nen co nghiep vu `site_consumption` hoac `material_usage` de phan biet da nhan va da su dung.

## 13. Cut-over Data Migration

Khi trien khai giua du an, khong nen sua `stock_by_warehouse` truc tiep lam nguon chinh.

Du lieu dau ky can nhap:

- BOQ va material budget.
- Ton kho tong.
- Ton kho cong truong.
- Vat tu da nhan nhung chua su dung.
- Vat tu da su dung/hao hut neu can bao cao chi tiet.
- PO dang mo, PO da dat nhung chua nhan du.
- MR dang mo, MR da duyet nhung chua cap du.
- Cong no NCC va chi phi vat tu da phat sinh.

Nguyen tac cut-over:

```text
opening_balance transaction
  -> inventory_ledger_entries +qty cho tung item/kho
  -> link project/site/BOQ neu co
```

Sau do:

- Open PO tao PO voi received_qty thuc te va remaining_qty.
- Open MR tao MR + fulfillment plan/allocations theo phan con thieu.
- Stock cache rebuild tu ledger.
- Financial opening tao project transaction/cost opening rieng, khong tron voi inventory ledger.

## 14. Edge cases can xu ly ro

| Case | Cach xu ly dung |
|---|---|
| Huy MR chua duyet, chua reserve | Cancel/delete theo quyen. Khong anh huong stock. |
| Huy MR da reserve | Release reservation, cancel plan. Khong tao ledger neu chua posted. |
| Huy MR da xuat/nhan | Khong xoa. Tao return/reversal transaction. |
| Huy PO chua co GR | Cancel PO, release allocation. |
| Huy PO da co GR | Tao supplier return hoac reversal GR, cap nhat allocation. |
| NCC giao nhieu dot | Moi dot la GR/fulfillment batch rieng, ledger rieng. |
| Cong truong nhan nhieu dot | Moi site receipt la posting rieng, request summary cong don. |
| Tra hang mot phan | Tao material return/supplier return theo so luong thuc tra. |
| Nhap sai so luong | Neu chua posted thi sua draft. Neu da posted thi adjustment/reversal. |
| Cap phat thieu | Allocation con remaining, MR khong closed. |
| Cap phat qua BOQ | Van cho tao neu co ly do/quyen, snapshot over BOQ da co nen giu. |
| Direct delivery | Receipt truc tiep vao kho cong truong, khong qua kho tong. |

## 15. SAP/Odoo/Dynamics thuong xu ly nhu the nao

| He thong | Cach lam tuong ung |
|---|---|
| SAP MM/WM | Ton kho den tu material documents va movement types. Huy/tra hang dung movement dao chieu, khong xoa material document da posted. Reservation, PO, GR va transfer posting tach rieng. |
| Odoo Inventory | Dung `stock.move`, `stock.move.line`, `stock.quant`. Picking/receipt/delivery la document dieu hanh; ton thuc o quant/stock move. Return picking tao move nguoc. Reservation tach voi on hand. |
| Dynamics Supply Chain | Dung inventory transactions, marking/reservation, warehouse work/load/receipt. Posted inventory transactions la audit trail; return/reversal tao transaction moi. |

Diem chung cua cac ERP lon: workflow/doc status khong phai ledger. Chung tu co the pending/approved/closed, nhung ton kho luon quy ve inventory transaction/ledger.

## 16. Lo trinh ap dung vao he thong hien tai

### Phase 1: Ledger foundation

- Tao `inventory_transactions` va `inventory_ledger_entries`.
- Sua RPC WMS: khi complete `transactions`, sinh ledger entries.
- Giu `items.stock_by_warehouse` nhu cache trong giai do chuyen doi.
- Tao view `inventory_stock_balances`.

### Phase 2: Reversal policy

- Chan delete voi chung tu da co ledger.
- Tao RPC `reverse_inventory_transaction`.
- Chuyen cac nut "huy/hoan tra" sau posted sang tao reversal/return transaction.

### Phase 3: Reservation engine

- Tao `inventory_reservations`.
- Chuyen `inventoryStockGuard` sang doc reservation table + ledger stock.
- Khi plan tu kho: tao hard reserve.
- Khi posted issue/transfer: consume reservation.
- Khi huy/doi nguon: release reservation.

### Phase 4: Fulfillment plan va allocation

- Tao `fulfillment_plans`, `fulfillment_plan_lines`, `material_allocations`.
- `material_request_fulfillment_batches` tiep tuc la dot thuc thi.
- UI phong vat tu lap plan: tach stock/PO/direct delivery.
- Bao cao MR tinh theo allocation, khong theo status cung.

### Phase 5: Return/direct delivery/cut-over

- Them document cho goods receipt, site receipt, material return, supplier return neu can UI rieng.
- Direct delivery post receipt vao site warehouse.
- Opening balance sinh ledger opening, rebuild stock cache.

## 17. Tac dong vao tai lieu workflow de xuat

Phuong an workflow dong van giu nguyen, nhung can them mot nguyen tac:

```text
Workflow approval = quyen cho phep nghiep vu tiep theo.
Inventory posting = hanh dong ghi ledger rieng, co audit va co reversal.
```

Sau khi MR duoc duyet, thay vi chuyen thang sang "xuat kho/mua hang", he thong nen:

```text
MR approved
  -> create fulfillment plan
  -> create reservation / PO / direct delivery plan
  -> execute batches
  -> post inventory ledger
  -> compute fulfillment summary
```

Nhu vay viec them buoc QLDA duyet van la cau hinh workflow, con cac loi ton kho/phieu huy/tra hang duoc giai quyet o supply chain engine.
