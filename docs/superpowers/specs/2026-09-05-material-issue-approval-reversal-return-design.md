# Thiết kế hủy duyệt phiếu xuất và nhập hoàn vật tư

**Ngày chốt thiết kế:** 2026-09-05

**Trạng thái:** Đã được chủ dự án duyệt cơ chế nghiệp vụ; chờ review tài liệu trước khi lập implementation plan

**Phạm vi:** Phiếu xuất cấp thi công, giao dịch WMS, nhập hoàn, sổ tồn kho, sổ trách nhiệm vật tư và phân quyền thao tác đảo phiếu

## 1. Mục tiêu

Hệ thống phải sửa được sai sót sau khi lập hoặc duyệt phiếu xuất mà không sửa
hay xóa chứng từ đã ghi sổ. Ba tình huống phải được phân biệt:

1. Phiếu chưa làm giảm tồn kho: hủy phiếu hiện có.
2. Phiếu đã làm giảm tồn kho nhưng hàng thực tế chưa rời kho: tạo chứng từ đảo
   toàn bộ bằng thao tác `Hủy duyệt - hàng chưa giao`.
3. Hàng đã bàn giao nhưng còn thừa: tạo phiếu nhập hoàn một phần hoặc toàn bộ,
   sau đó WMS kiểm nhận trước khi cộng tồn.

Kết quả phải giữ đầy đủ dấu vết người thực hiện, lý do, thời điểm, chứng từ gốc
và chứng từ bù. Báo cáo tồn kho và trách nhiệm vật tư phải phản ánh giá trị ròng
đúng sau mọi thao tác.

## 2. Thuật ngữ và ranh giới nghiệp vụ

| Thuật ngữ | Ý nghĩa |
| --- | --- |
| Hủy phiếu | Kết thúc phiếu chưa ghi sổ, không tạo biến động tồn bù |
| Hủy duyệt | Đảo toàn bộ phiếu xuất đã ghi sổ vì hàng chưa rời kho |
| Nhập hoàn | Nhận lại hàng đã thực sự bàn giao cho người/tổ đội/thầu phụ |
| Chứng từ đảo | Giao dịch WMS ngược chiều, tham chiếu duy nhất tới chứng từ đã ghi sổ |
| Còn giữ | Lượng đã xuất nhưng chưa trả, chưa dùng và chưa ghi nhận hao hụt |
| Đang chờ hoàn | Lượng đã nằm trên phiếu nhập hoàn chưa `COMPLETED` |

`Chưa sử dụng` không đồng nghĩa với `chưa giao`. Nếu hàng đã rời kho hoặc bên
nhận đã xác nhận nhận, dù chưa sử dụng, người dùng bắt buộc đi theo luồng nhập
hoàn. Hủy duyệt chỉ áp dụng khi hàng thực tế vẫn ở kho xuất.

## 3. Nguyên tắc đã chốt

1. Chứng từ WMS `COMPLETED` không được đổi ngược về `PENDING`, sửa số lượng
   hoặc xóa.
2. Mọi điều chỉnh sau khi ghi sổ phải dùng chứng từ bù liên kết chứng từ gốc.
3. Hủy duyệt chỉ đảo toàn bộ phiếu; sửa một phần dùng nhập hoàn.
4. Nhập hoàn chỉ làm tăng tồn khi giao dịch WMS nhập chuyển sang `COMPLETED`.
5. Tổng đã trả, đã dùng, hao hụt và đang chờ hoàn không được vượt số đã xuất.
6. Phiếu nhập hoàn mặc định và trong phạm vi thiết kế này chỉ trả về đúng kho
   đã xuất.
7. Chỉ hàng còn dùng được mới nhập lại tồn khả dụng. Hàng đã dùng ghi
   `consume`; hàng mất hoặc hỏng không tái sử dụng ghi `loss`.
8. Hủy duyệt được thực hiện tức thời bởi người có capability riêng, không có
   vòng phê duyệt thứ hai.
9. Quyền giao diện không phải biên bảo mật; mọi điều kiện và quyền phải được
   kiểm tra lại trong RPC PostgreSQL.
10. Các command tạo chứng từ phải idempotent và khóa dữ liệu liên quan trước
    khi kiểm tra số lượng.

## 4. Luồng trạng thái

### 4.1. Hủy trước khi xuất

```text
material_issue_order: draft/submitted/wms_pending -> cancelled
WMS export:            PENDING                    -> CANCELLED
Tồn kho:               không đổi
```

Giữ nguyên `cancel_material_issue_order`. Lý do hủy là bắt buộc. Phiếu đã phát
sinh giao dịch WMS `COMPLETED` không được đi theo luồng này.

### 4.2. Hủy duyệt khi hàng chưa giao

```text
WMS export gốc:         COMPLETED, tồn -Q, được giữ nguyên
WMS reversal import:    tạo mới và COMPLETED atomically, tồn +Q
Material issue return:  completed, return_kind = approval_reversal
Material issue order:   issued -> reversed
```

Ví dụ tồn ban đầu 100, phiếu xuất nhầm 10:

```text
Phiếu xuất gốc:   -10
Chứng từ đảo:     +10
Biến động ròng:     0
Tồn cuối:         100
```

### 4.3. Nhập hoàn sau khi đã bàn giao

```text
Tạo phiếu hoàn       -> return pending, WMS IMPORT PENDING, tồn chưa đổi
Duyệt số lượng       -> WMS IMPORT APPROVED, tồn chưa đổi
Xác nhận hàng về kho -> WMS IMPORT COMPLETED, tồn +Q, returned_qty +Q
Từ chối/hủy trước khi hoàn tất -> return cancelled, giải phóng lượng đang chờ
```

Phiếu xuất cấp được làm mới trạng thái theo số lượng còn giữ:

- còn số lượng chưa quyết toán: `partially_returned`, `received`,
  `partially_received`, `issued` hoặc `settling` theo dữ liệu hiện có;
- không còn số lượng chưa quyết toán: `closed`;
- đảo toàn bộ do duyệt nhầm: `reversed`.

## 5. Điều kiện hủy duyệt

Command chỉ thành công khi đồng thời thỏa tất cả điều kiện:

- `material_issue_orders.transaction_id` trỏ tới một WMS `EXPORT` có trạng
  thái `COMPLETED`;
- phiếu xuất cấp đang ở trạng thái `issued`;
- chưa có bất kỳ lần xác nhận nhận hàng nào;
- mọi dòng có `received_qty = 0`, `consumed_qty = 0`, `returned_qty = 0` và
  `lost_qty = 0`;
- với mọi dòng, `issued_qty > 0` và lượng còn giữ bằng đúng `issued_qty`;
- không có phiếu nhập hoàn `pending` hoặc `completed`;
- không có settlement đã dùng hoặc hao hụt đang `posted`;
- chưa tồn tại chứng từ đảo `COMPLETED` cho WMS gốc;
- người thực hiện có capability `wms.transaction.reverse` trong phạm vi kho
  xuất;
- lý do không rỗng và người thực hiện xác nhận hàng chưa rời kho.

Nếu không đạt điều kiện, RPC trả lỗi nghiệp vụ rõ ràng và không thay đổi dữ
liệu. Giao diện không tự động chuyển hành động; nó hướng người dùng sang nhập
hoàn khi hàng đã bàn giao.

## 6. Quy tắc số lượng nhập hoàn

Mỗi dòng duy trì phương trình:

```text
issued_qty = returned_qty + consumed_qty + lost_qty + open_qty
```

Trong đó:

```text
open_qty = max(issued_qty - returned_qty - consumed_qty - lost_qty, 0)

pending_return_qty = tổng return_qty thuộc các phiếu hoàn pending

returnable_qty = max(open_qty - pending_return_qty, 0)
```

Khi tạo phiếu hoàn:

- mỗi dòng phải lớn hơn 0;
- không được vượt `returnable_qty`;
- một command có thể hoàn một hoặc nhiều dòng;
- được phép hoàn nhiều lần nhưng tổng `completed + pending` không vượt phần
  còn giữ;
- khóa phiếu xuất, dòng xuất và các phiếu hoàn liên quan trước khi tính lại.

Khi WMS hoàn chuyển sang `COMPLETED`, backend khóa và kiểm tra lại số lượng.
Nếu dữ liệu đã thay đổi do thao tác đồng thời, toàn bộ xác nhận nhập thất bại;
không được cộng tồn trước rồi mới báo lỗi.

Settlement `consume` và `loss` cũng phải trừ `pending_return_qty` khi tính lượng
có thể quyết toán để không chiếm cùng một lượng với phiếu hoàn đang chờ.

## 7. Mô hình dữ liệu

### 7.1. `transactions`

Bổ sung:

- `reversal_of_transaction_id text null references transactions(id) on delete restrict`;
- `idempotency_key text null`;
- unique partial index trên `reversal_of_transaction_id` cho chứng từ đảo chưa
  bị hủy;
- unique partial index trên `idempotency_key` khi giá trị khác null.

Chứng từ đảo có:

- `type = IMPORT`;
- `target_warehouse_id = source_warehouse_id` của phiếu xuất gốc;
- `business_event_type = reversal`;
- `business_event_reason` là lý do bắt buộc;
- `source_type = material_issue_approval_reversal`;
- `source_id` là ID phiếu xuất cấp;
- `reversal_of_transaction_id` là ID WMS xuất gốc;
- `status = COMPLETED` sau khi command hoàn tất atomically.

### 7.2. `material_issue_returns`

Bổ sung:

- `return_kind text not null default 'unused_return'`, giới hạn
  `unused_return | approval_reversal`;
- `idempotency_key text null` với unique partial index;
- `metadata jsonb not null default '{}'::jsonb` và kiểm tra kiểu object.

Với hủy duyệt, metadata lưu ít nhất xác nhận `stockNeverLeftWarehouse = true`
và ID giao dịch xuất gốc. Với nhập hoàn thông thường, `return_kind` là
`unused_return`.

### 7.3. `material_issue_orders`

- Mở rộng check constraint trạng thái với `reversed`.
- `material_issue_refresh_status` coi `reversed` là trạng thái terminal và
  không tự đổi thành `closed`.
- Đồng bộ document link coi `reversed` là liên kết đã đảo, không phải active.

### 7.4. Inventory ledger và party ledger

- Đồng bộ WMS phải đặt `inventory_transactions.reversal_of_inventory_transaction_id`
  của chứng từ nhập đảo tới inventory transaction của phiếu xuất gốc.
- Hủy duyệt ghi một party-ledger event `return` có số lượng âm đúng bằng lượng
  `issue`, kèm metadata `returnKind = approval_reversal`.
- `material_issue_lines.issued_qty` không bị xóa hoặc đưa về 0;
  `returned_qty` tăng bằng lượng đảo để giữ phương trình và lịch sử gốc.

## 8. Database commands

### 8.1. Command hủy duyệt mới

```text
reverse_material_issue_approval_v1(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text
) returns material_issue_orders
```

Trong một PostgreSQL transaction, command phải:

1. Xác thực actor và capability theo kho.
2. Khóa phiếu xuất cấp, WMS gốc, các dòng và chứng từ downstream.
3. Trả kết quả hiện có nếu `p_idempotency_key` đã xử lý thành công.
4. Kiểm tra toàn bộ điều kiện tại mục 5.
5. Tạo WMS nhập đảo và phiếu hoàn loại `approval_reversal`.
6. Hoàn tất biến động tồn đúng một lần.
7. Cập nhật `returned_qty`, party ledger và inventory ledger.
8. Đặt phiếu xuất cấp thành `reversed`.
9. Trả phiếu đã cập nhật; lỗi ở bất kỳ bước nào phải rollback toàn bộ.

### 8.2. Command nhập hoàn

Thêm command:

```text
create_material_issue_return_v2(
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text,
  p_idempotency_key text
) returns material_issue_returns
```

`p_target_warehouse_id` phải bằng kho xuất gốc trong phạm vi này. Command cũ
được giữ như compatibility wrapper trong một release nhưng frontend mới chỉ
gọi V2. Sau khi xác nhận không còn caller cũ, implementation plan mới được
phép loại bỏ wrapper bằng migration sau.

Logic đồng bộ khi WMS thay đổi trạng thái phải kiểm tra lại lượng còn có thể
hoàn trước khi tăng `returned_qty`. Khi WMS bị hủy trước `COMPLETED`, phiếu hoàn
chuyển `cancelled` và không tạo ledger/tồn.

## 9. Phân quyền

Khai báo capability mới:

```text
wms.transaction.reverse
```

Đây là action nhạy cảm, hỗ trợ scope `global` và `warehouse`. Quy tắc:

- Admin/quản trị WMS hoặc principal được cấp capability hợp lệ có thể thao tác;
- người tạo hoặc người duyệt phiếu không mặc nhiên có quyền đảo;
- scope kho phải khớp kho xuất gốc;
- account không active, grant hết hạn hoặc sai scope bị từ chối;
- frontend dùng authorization snapshot thống nhất;
- RPC là authority cuối và deny-by-default.

Việc đăng ký quyền phải đi cùng kiến trúc permission unification V2 đang được
triển khai. Không thêm một nhánh role-check mới lâu dài. Nếu thời điểm rollout
vẫn còn compatibility fallback, fallback phải có telemetry và ngày loại bỏ
theo đúng kế hoạch permission unification.

## 10. Giao diện

Trong chi tiết phiếu xuất cấp:

- `Hủy phiếu`: chỉ hiện ở `draft/submitted/wms_pending`;
- `Hủy duyệt - hàng chưa giao`: chỉ hiện khi frontend đánh giá sơ bộ đủ điều
  kiện và actor có capability; RPC vẫn kiểm tra lại;
- `Nhập hoàn`: hiện khi có dòng `returnable_qty > 0`;
- `Đã dùng` và `Hao hụt`: giữ nguyên nhưng dùng số khả dụng đã trừ pending
  return.

Modal hủy duyệt phải:

- cảnh báo đây là thao tác đảo toàn bộ;
- hiển thị phiếu xuất, kho, các dòng và tổng số lượng;
- bắt buộc nhập lý do;
- bắt buộc tick `Tôi xác nhận hàng chưa rời kho`;
- khóa nút khi đang gửi và dùng idempotency key ổn định cho lần submit.

Modal nhập hoàn phải hiển thị theo từng dòng:

```text
Đã xuất | Đã dùng | Đã trả | Đang chờ hoàn | Hao hụt | Có thể hoàn
```

Kho nhận hiển thị đúng kho xuất và không cho đổi. Lý do đầu phiếu là bắt buộc;
ghi chú dòng là tùy chọn. Sau khi tạo, người dùng thấy rõ `Chờ WMS kiểm nhận -
chưa cộng tồn`.

Lịch sử chứng từ phải phân biệt:

- phiếu hoàn đang chờ, đã hoàn tất hoặc đã hủy;
- nhập hoàn thông thường và hủy duyệt;
- WMS gốc và WMS đảo;
- người tạo, người hoàn tất, lý do và thời điểm.

## 11. Báo cáo và audit

Sau hủy duyệt:

- sổ tồn có một dòng xuất và một dòng nhập đảo;
- biến động tồn ròng bằng 0;
- party ledger có `issue + return = 0`;
- báo cáo BOQ không tính lượng đảo là sử dụng;
- phiếu gốc vẫn xuất hiện với nhãn `Đã đảo`.

Sau nhập hoàn một phần:

- tồn tăng đúng lượng WMS đã `COMPLETED`;
- lượng cấp ròng bằng `issued - returned`;
- `confirmed_used_qty` không thay đổi do nhập hoàn;
- `open_with_recipient_qty` giảm đúng lượng hoàn.

Audit phải truy được chuỗi:

```text
material_issue_order
  -> original EXPORT transaction
  -> return/reversal document
  -> IMPORT transaction
  -> inventory ledger and party ledger entries
```

## 12. Kiểm thử chấp nhận

### 12.1. Hủy và hủy duyệt

1. Hủy phiếu `wms_pending` không thay đổi tồn.
2. Tồn 100, xuất nhầm 10, hủy duyệt hợp lệ trả tồn về 100.
3. WMS gốc vẫn `COMPLETED`; phiếu xuất cấp thành `reversed`.
4. Gọi lại cùng idempotency key trả cùng kết quả, không cộng tồn lần hai.
5. Idempotency key khác trên cùng phiếu vẫn bị unique/business guard chặn.
6. Phiếu đã nhận, đã dùng, hao hụt hoặc nhập hoàn không thể hủy duyệt.
7. Actor thiếu quyền hoặc sai scope kho bị từ chối.

### 12.2. Nhập hoàn

1. Xuất 10, tạo hoàn 5: tồn chưa đổi khi return `pending`.
2. WMS `APPROVED`: tồn vẫn chưa đổi.
3. WMS `COMPLETED`: tồn tăng 5 và `returned_qty` tăng 5.
4. Hủy WMS trước hoàn tất: tồn và `returned_qty` không đổi.
5. Xuất 10, đã dùng 5: chỉ được tạo hoàn tối đa 5.
6. Có phiếu hoàn 3 đang chờ trên lượng còn giữ 5: chỉ được tạo thêm tối đa 2.
7. Hai command đồng thời không thể giữ hoặc hoàn vượt số đã xuất.
8. Settlement không thể dùng lượng đã được phiếu hoàn pending giữ.
9. Phiếu hoàn bắt buộc quay lại đúng kho xuất.

### 12.3. Tính toàn vẹn và báo cáo

1. Mọi dòng giữ đúng phương trình số lượng.
2. Inventory ledger của đảo tham chiếu inventory transaction gốc.
3. Tổng tồn trước và sau migration không thay đổi.
4. Báo cáo xuất, trả, sử dụng, hao hụt và còn giữ khớp ledger drill-down.
5. Không có đường gọi trực tiếp Data API nào vượt RLS/RPC để sửa chứng từ đã
   post.

## 13. Triển khai và rollback

Thứ tự rollout:

1. Viết contract test và SQL smoke test trước.
2. Tạo forward migration bằng Supabase CLI.
3. Chạy migration và smoke trong transaction `BEGIN ... ROLLBACK` trên
   Supabase Cloud cấu hình từ `.env`; không dùng Supabase local hoặc Docker.
4. Chạy security advisor và kiểm tra RLS/grants/function exposure.
5. Deploy database trước theo cách tương thích ngược.
6. Deploy service, authorization và UI dùng RPC V2.
7. Chạy postflight: tồn kho, ledger, trạng thái, quyền và idempotency.
8. Chỉ gỡ compatibility wrapper ở một migration sau khi đã xác nhận không còn
   caller cũ.

Migration cấu trúc không backfill chứng từ đảo và không được làm thay đổi tồn
hiện có. Nếu phải rollback ứng dụng, database mới vẫn giữ được caller cũ trong
một release. Nếu command nghiệp vụ đã tạo chứng từ đảo/hoàn thật, không rollback
bằng xóa dữ liệu; phải dùng chứng từ bù phù hợp.

## 14. Ngoài phạm vi

- Hủy duyệt một phần; trường hợp này dùng nhập hoàn.
- Nhập hàng hỏng vào kho cách ly hoặc quản lý trạng thái chất lượng tồn.
- Lô, serial, hạn sử dụng hoặc vị trí kệ của hàng hoàn.
- Đảo một phiếu nhập hoàn đã `COMPLETED`; đây là nghiệp vụ riêng cần kiểm tra
  lượng hàng còn tồn trước khi tạo EXPORT bù.
- Sửa hoặc xóa trực tiếp chứng từ/ledger đã ghi sổ.
- Thêm vòng phê duyệt thứ hai cho hủy duyệt.

## 15. Tiêu chí hoàn thành

Tính năng chỉ hoàn thành khi:

- cả ba nhánh hủy trước xuất, hủy duyệt và nhập hoàn chạy đúng trạng thái;
- mọi biến động tồn chạy atomically trên Supabase Cloud;
- không thể đảo hoặc hoàn trùng/vượt số lượng;
- quyền `wms.transaction.reverse` được enforce ở UI và database;
- tồn kho, inventory ledger, party ledger và báo cáo BOQ đối chiếu khớp;
- targeted tests, SQL Cloud rollback smoke, lint, typecheck và production build
  đều đạt;
- tài liệu vận hành nêu rõ ranh giới `chưa giao` và `đã giao nhưng chưa dùng`.
