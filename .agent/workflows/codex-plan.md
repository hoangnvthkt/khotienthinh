---
description: Plan Khắc Phục Module Dự Án Theo Logic Xây Dựng
---

# Plan Khắc Phục Module Dự Án Theo Logic Xây Dựng

## Summary
Mục tiêu là chuẩn hóa Module Dự án thành một luồng nghiệp vụ xây dựng đúng: **Hợp đồng/BOQ là nguồn gốc doanh thu/khối lượng**, **Nhật ký chỉ ghi nhận hiện trường**, **Nghiệm thu xác nhận khối lượng**, **Thanh toán tính từ nghiệm thu**, **Dòng tiền tách khỏi lãi/lỗ**, và **Tiến độ/WBS không bị trộn với BOQ**.

Mặc định triển khai theo hướng chặt nghiệp vụ, chấp nhận ảnh hưởng dữ liệu demo. Các thay đổi schema/workflow/công thức sẽ cần migration rõ ràng, backfill dữ liệu cũ, test bằng tình huống RICO trước khi dùng thật.

## Key Changes

### 1. Chuẩn hóa dữ liệu hợp đồng, BOQ và WBS
- Giữ `contract_items` là nguồn dữ liệu duy nhất cho BOQ: mã hạng mục, tên, đơn vị, khối lượng hợp đồng, đơn giá, thành tiền, loại hợp đồng khách hàng/thầu phụ.
- Không dùng các field BOQ trong `ProjectTask` nữa: `code`, `quantity`, `unit`, `unitPrice`, `totalPrice`, `completedQuantity`.
- Thay bằng bảng liên kết `task_contract_items` để một task Gantt có thể liên kết nhiều BOQ item, và một BOQ item có thể trải qua nhiều task.
- BOQ sau khi đã phát sinh nghiệm thu/thanh toán sẽ bị khóa các trường gốc; thay đổi giá trị phải qua `contract_variations`.

Lý do: WBS là kế hoạch thi công, BOQ là hợp đồng/thanh toán. Trộn hai nguồn này sẽ gây lệch khối lượng, lệch giá trị hợp đồng và sai báo cáo.

### 2. Tách Nhật ký, Khối lượng hiện trường và Nghiệm thu
- Chuyển chi tiết nhật ký từ JSONB trong `daily_logs` sang bảng chuẩn hóa:
  `daily_log_volumes`, `daily_log_materials`, `daily_log_labor`, `daily_log_machines`.
- Thêm trạng thái xác nhận nhật ký: `draft`, `submitted`, `verified`, `rejected`.
- Thêm lớp nghiệp vụ nghiệm thu khối lượng:
  `quantity_acceptances` và `quantity_acceptance_items`.
- Luồng chuẩn:
  `Nhật ký verified -> Đề xuất nghiệm thu -> PM/QS duyệt -> Payment Certificate`.
- Payment không lấy trực tiếp từ nhật ký chưa duyệt.

Lý do: nhật ký là ghi nhận hiện trường, chưa phải giá trị được nghiệm thu. Nếu lấy nhật ký thẳng sang thanh toán sẽ sai khi có khối lượng không đạt, sai đơn vị, hoặc chưa được chủ đầu tư/thầu phụ xác nhận.

### 3. Sửa công thức thanh toán FastCons
- Thay công thức hiện tại bằng công thức tách rõ kỳ này và lũy kế:
  `grossThisPeriod = Σ currentCertifiedQty × unitPrice`
  `grossCumulative = Σ cumulativeCertifiedQty × unitPrice`
  `retentionThisPeriod = grossThisPeriod × retentionPercent`
  `advanceRecoveryThisPeriod = min(advanceRemaining, grossThisPeriod × recoveryPercent)`
  `payableThisPeriod = grossThisPeriod - retentionThisPeriod - advanceRecoveryThisPeriod - penalties - deductions`
- Lưu snapshot đầy đủ trong `payment_certificate_items`: BOQ code/name/unit, contract qty, previous qty, current certified qty, cumulative qty, unit price, current amount, cumulative amount.
- Thêm bảng `payment_certificate_advance_recoveries` để phân bổ thu hồi theo từng khoản tạm ứng, tránh thu hồi lặp.
- Khi cert chuyển `paid`, cập nhật `advance_payments.recoveredAmount/remainingAmount`.
- Thêm trạng thái workflow: `draft`, `submitted`, `returned`, `approved`, `paid`, `cancelled`.
- Khóa chỉnh sửa cert sau `approved`; chỉ được tạo bản điều chỉnh/đợt bổ sung.

Lý do: công thức cũ trừ trên lũy kế dễ double-count retention/tạm ứng. Thanh toán xây dựng phải phân biệt giá trị kỳ này, lũy kế, đã duyệt, đã thanh toán và tiền thực thu/thực chi.

### 4. Bổ sung phát sinh hợp đồng/change order
- Thêm `contract_variations` và `contract_variation_items`.
- Variation có workflow: `draft -> submitted -> approved/rejected`.
- Variation approved có thể tạo BOQ item mới hoặc tăng/giảm khối lượng/đơn giá bằng dòng điều chỉnh, không sửa mất lịch sử BOQ gốc.
- Dashboard hợp đồng hiển thị:
  `Original Contract Value`, `Approved Variations`, `Revised Contract Value`.

Lý do: dự án xây dựng luôn có phát sinh. Nếu sửa thẳng BOQ gốc thì mất audit trail và không giải trình được vì sao giá trị hợp đồng thay đổi.

### 5. Sửa Dòng tiền, Chi phí và Lãi/Lỗ
- Không dùng `Dự toán - Thực tế` làm “Lãi/Lỗ”.
- Tách thành 4 nhóm KPI:
  `Budget Variance = Budget - Actual Cost`
  `Contract Margin = Revised Contract Value - Forecast Final Cost`
  `Certified Revenue = approved/paid payment certificates`
  `Cash Position = cash in - cash out`
- `CostAnalysisPanel` đổi nhãn “Lãi/Lỗ” thành “Chênh lệch ngân sách” nếu chỉ dựa trên budget/actual.
- Bổ sung `project_cost_actuals` hoặc mapping từ giao dịch thực tế để phân loại chi phí: vật liệu, nhân công, máy, thầu phụ, chi phí chung, khác.
- Chi phí từ nhật ký nhân công/máy/vật tư chỉ là chi phí hiện trường; chi phí tài chính chính thức lấy từ giao dịch, PO, hợp đồng thầu phụ, phiếu chi.

Lý do: lãi/lỗ là chỉ tiêu tài chính dự báo/toàn dự án, không phải chỉ so sánh chi phí thực tế với dự toán.

### 6. Nâng cấp Tiến độ
- Giữ Gantt/WBS làm kế hoạch thi công, không chứa đơn giá/BOQ.
- Progress task có 2 chế độ:
  `manual` hoặc `derived_from_acceptance`.
- Gate approval không mặc định chặn toàn bộ task sau; chỉ chặn khi dependency được cấu hình `requiresGateApproval = true`.
- Bổ sung baseline version rõ: baseline gốc, baseline điều chỉnh, lý do điều chỉnh.
- Critical path tiếp tục dùng engine hiện tại, nhưng validation phải chặn dependency cycle và cảnh báo dependency không hợp lệ.

Lý do: công trường có thể thi công tiếp dù nghiệm thu giấy tờ chưa xong. Gate nên là rule cấu hình, không phải khóa cứng toàn bộ tiến độ.

## Implementation Tasks

1. **Schema & Migration**
   - Tạo migration mới bằng Supabase CLI, không sửa tay filename tùy ý.
   - Thêm bảng normalized cho daily log details, acceptance, payment allocation, variation, task-BOQ mapping.
   - Backfill dữ liệu từ JSONB hiện tại sang bảng mới.
   - Đánh dấu các cột BOQ trong `project_tasks` là deprecated, ngừng đọc/ghi trước; drop ở migration cleanup sau khi UI/service đã ổn.
   - RLS không dùng policy `USING (true)` cho bảng mới; áp dụng đúng access model hiện tại hoặc route thao tác nhạy cảm qua Edge Function.

2. **Types & Services**
   - Cập nhật `types.ts` theo model mới.
   - Tách service:
     `contractItemService`, `variationService`, `dailyLogDetailService`, `quantityAcceptanceService`, `paymentCertificateService`, `advancePaymentService`, `projectFinancialService`.
   - Đưa toàn bộ công thức thanh toán vào pure calculation module có unit test.
   - Legacy `PaymentSchedule` và `AcceptanceRecord` giữ tương thích, không dùng làm nguồn FastCons chính.

3. **UI Workflow**
   - Tab Hợp đồng: thêm `BOQ`, `Phát sinh`, `Nghiệm thu`, `Thanh toán`, `Tạm ứng`, `Giữ lại`.
   - Tab Nhật ký: lưu detail vào bảng normalized, có trạng thái gửi duyệt/xác nhận.
   - Tab Tiến độ: bỏ nhập BOQ fields trong task, thay bằng liên kết BOQ item và chế độ progress.
   - Tab Dòng tiền: đổi KPI sai nhãn, tách ngân sách/chi phí/lãi gộp/dòng tiền.
   - Tab Báo cáo: báo cáo rõ 4 tiến độ: thi công, nghiệm thu, thanh toán, dòng tiền.

4. **Business Rules**
   - Không cho nghiệm thu vượt khối lượng hợp đồng + variation approved, trừ khi có override có lý do.
   - Không cho tạo payment từ nhật ký chưa verified hoặc nghiệm thu chưa approved.
   - Không cho sửa BOQ item đã có payment approved, chỉ cho variation.
   - Không cho thu hồi tạm ứng vượt số còn lại.
   - Không cho chuyển `paid` nếu `payableThisPeriod <= 0`, trừ trường hợp xác nhận bù trừ có lý do.
   - Mọi chuyển trạng thái nghiệm thu/thanh toán/phát sinh phải ghi audit log.

## Test Plan

- Unit test công thức thanh toán:
  tạm ứng 50 tỷ, recovery 30%, retention 5%, phạt/khấu trừ, nhiều đợt thanh toán, kiểm tra không double-count.
- Unit test BOQ:
  không vượt khối lượng, variation approved làm tăng revised quantity/value, task không còn quyết định giá trị BOQ.
- Workflow test tình huống RICO:
  tạo hợp đồng 450 tỷ -> import BOQ -> ghi nhật ký -> verify -> nghiệm thu -> payment đợt 1 -> paid -> kiểm tra advance remaining, retention, cash in, certified revenue.
- Regression test Gantt:
  critical path, gate approval, baseline, progress weighted không bị sai sau khi bỏ BOQ fields khỏi task.
- Verification:
  `npm run lint`, `npm run build`, kiểm tra migration, chạy Supabase advisors/security nếu MCP/CLI truy cập được.

## Assumptions
- Dữ liệu hiện tại là demo nên có thể backfill/sửa cấu trúc, nhưng vẫn phải giữ đường rollback bằng migration rõ ràng.
- Module FastCons mới sẽ là nguồn nghiệp vụ chính; các bảng/flow cũ chỉ giữ để tương thích trong giai đoạn chuyển đổi.
- Mặc định ưu tiên đúng logic nghiệp vụ hơn tốc độ làm nhanh; các thay đổi ảnh hưởng workflow như khóa BOQ, khóa payment sau duyệt, đổi công thức thanh toán cần được duyệt trước khi triển khai thực tế.
