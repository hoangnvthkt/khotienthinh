# Vòng khép kín Module Dự án — Audit vòng 1 (30/09/2026)

Mục tiêu do chủ sản phẩm giao (30/09/2026):

> Bảng tiến độ thi công → Kế hoạch tháng → Kế hoạch tuần → Kế hoạch vật tư tháng/tuần → Đề xuất vật tư, cung ứng → Nhập xuất kho → Ghi nhận, so sánh, cảnh báo với BOQ vật tư → Báo cáo.
> Mọi dữ liệu phát sinh đều lưu, thống kê, tổng hợp, báo cáo được.

Tài liệu này là audit vòng 1: chia vòng thành 8 khâu (K1–K8), mỗi khâu ghi **tham chiếu FastCons**, **hiện trạng Vioo trên production** (số liệu đọc ngày 30/09) và **khoảng trống**. Cuối tài liệu là cách nối các khâu lại và các quyết định cần chủ sản phẩm chốt.

Nguồn số liệu: truy vấn chỉ-đọc production `ftciqmqhmfvjtwoycswe`; code `main` = `b73ea43`; FastCons bản dùng thử (fc.fastwork.vn).

---

## 0. Bối cảnh: phần Codex đã làm

- Nhánh `archive/project-v2-procurement-v2` và checkout gốc (`feature/refactor-du-an-t9-1`, lệch `main` 64/58 commit, còn thay đổi chưa commit ở mua hàng/kế hoạch vật tư) chứa **Project V2**: kế hoạch tháng, kế hoạch thi công, kế hoạch vật tư sinh từ công việc, mua hàng nhận kế hoạch vật tư đã duyệt, tạo PO từ nhu cầu.
- **11 migration `project_v2_*` / `material_plan_procurement_intake` / `procurement_v2_*` chưa từng lên production.** Không có bảng `project_v2_*` nào trên production. Mọi thứ Codex làm cho K2–K4 hiện **chưa dùng được**.
- Quyết định chủ sản phẩm ngày 22/09 (trong `docs/designs/erp-completion-2026-09-19/project-planning-workflow-20260922.md` của checkout gốc) vẫn khớp mô hình hôm nay và được giữ:
  1. Kế hoạch tháng mô tả sản lượng; kế hoạch thi công (tuần/ngày) tổ chức thực hiện từ kế hoạch tháng.
  2. Chọn công việc trong kế hoạch thi công để lập kế hoạch vật tư theo định mức gắn kèm.
  3. Kế hoạch vật tư đã duyệt đi thẳng sang Mua hàng; công trường không phải lập lại đề xuất cho cùng khối lượng.
  4. Công trường vẫn được lập đề xuất vật tư bổ sung độc lập.
  5. Màn Bàn làm việc Mua hàng hiện tại **chưa được chấp nhận** về giao diện.

## 1. Tham chiếu FastCons — chuỗi Quản lý thi công

| Khâu | FastCons làm gì | Nên lấy | Nên tránh |
|---|---|---|---|
| Tiến độ | Công việc = dòng BOQ (mã định mức, ĐVT, KL, đơn giá); KH vs TT theo KL, "Chậm 1,9 ngày", thành tiền KH/TT, KL còn lại; Baseline | Tiến độ theo **khối lượng** và tiền, chênh lệch ngày | 25+ cột một bảng, khó đọc |
| KH thi công | Kỳ **Ngày/Tuần/Tháng**; chọn công việc; KL tổng, lũy kế, KL KH kỳ này, thời gian, tổ đội; có duyệt | Một mẫu kế hoạch cho 3 kỳ | Nhập tay toàn bộ, không gợi ý từ tiến độ |
| KH tháng (theo HĐ) | Riêng cho HĐ nhận thầu và giao thầu | Sản lượng tháng theo hợp đồng | Hai nơi lập kế hoạch tháng song song dễ lệch |
| KH vật tư | Kỳ Tuần/Tháng; "Lấy vật tư theo: **Định mức / KH thi công / KH tháng**"; cột định mức, đã nhập kho, còn lại, SL, ngày cấp; có duyệt | Sinh vật tư từ KH công việc × định mức | Trống khi công việc chưa có định mức mà không báo |
| Đề xuất / cung ứng | Đề xuất mua / cấp vật tư (quy trình duyệt); Phiếu mua gắn Đề xuất + KH vật tư + HĐ NCC + hạng mục; tiến độ nhập %, hóa đơn mua, thu chi | Dấu vết nguồn trên mọi chứng từ | — |
| Kho | Phiếu **Mua / Nhập / Xuất / Hoàn**; nhập bắt buộc ảnh (vật liệu, phiếu giao, cân xe, biển số); xuất gắn **công việc, hạng mục, nhà thầu, HĐ giao thầu** | Xuất gắn công việc → đo tiêu hao | — |
| So sánh BOQ | Định mức VL với **2 ngưỡng cảnh báo (80%, 90%)**; "So sánh định mức": định mức nội bộ / theo KH thi công / theo BOQ; cảnh báo nhập vượt, xuất vượt, **sử dụng vượt định mức**, **sử dụng vượt tiến độ**; cấu hình chặn/cho phép vượt | Cảnh báo theo tiến độ, không chỉ theo tổng BOQ | Cho vượt mặc định mà không ghi lý do |
| Báo cáo | 22 báo cáo vật liệu: tồn kho kỳ, vật liệu dùng theo công việc/ngày, theo nhật ký KL, tiến độ mua, quyết toán vật tư, VL phát sinh, VL cần dùng theo dự trù, theo dõi KH vật tư, tổng hợp vật tư… | Danh mục báo cáo | 22 báo cáo rời, trùng nhau |

Các điểm yếu chung đã thấy ở FastCons: không chặn số vô lý (lũy kế thanh toán gấp 6.496 lần giá trị HĐ vẫn duyệt được), phiếu đã duyệt vẫn sửa được, danh mục do người dùng tự thêm nên trùng lặp, vỡ layout khi màn hẹp, quá nhiều tab/cột.

## 2. Hiện trạng Vioo theo khâu

Số liệu production 30/09. Dự án có dữ liệu thật: **SMB-2026** (349 công việc, 556 dòng BOQ vật tư, 44 PO, 54 phiếu xuất) và **DA29** (363 công việc, 362 dòng BOQ vật tư, 16 PO, 3 phiếu xuất).

### K1. Bảng tiến độ
- Có: `project_tasks` (863) gắn 1–1 với `project_work_boq_items` (789); tab **Tiến độ** (`GanttTab`, 3,9 nghìn dòng); tiến độ thực tế theo ngày `project_daily_task_progress` (13,6 nghìn dòng), theo tuần `project_weekly_task_progress` (7,4 nghìn), tab **Chốt tiến độ** + khóa kỳ. Từ 01/10 Nhật ký V2 đưa tiến độ ngày theo khu vực vào cùng bảng (khi `enforced`).
- Thiếu: **baseline** (`project_schedule_revisions` rỗng); so sánh KH–TT theo khối lượng trong kỳ; chênh lệch ngày.

### K2. Kế hoạch tháng
- **Chưa có trên production.** (Project V2 của Codex có, chưa triển khai.)
- `planning_curve_*` chỉ là đường cong S, không phải kế hoạch tháng.

### K3. Kế hoạch tuần
- **Chưa có.** "Chốt tiến độ tuần" là **thực tế**, không phải kế hoạch.

### K4. Kế hoạch vật tư tháng/tuần
- Bảng `material_plans`, `material_plan_lines`, `material_plan_revisions`, `material_plan_allocations`, `material_plan_conversions` **có trên production nhưng rỗng (0 dòng)**. Tab **Vật tư → Kế hoạch** (`BoqMaterialPlanningWorkspace`) lập kế hoạch từ BOQ, chưa từ kế hoạch công việc.
- Điểm mạnh sẵn có: **BOQ vật tư đã gắn công việc** — `material_budget_items.work_boq_item_id` (SMB 556/556, DA29 271/362) và có mã kho (`inventory_item_id`) ở 100% dòng. Vì vậy có thể quy đổi KL công việc trong kỳ → vật tư theo tỷ lệ `KL kỳ / KL công việc × SL vật tư BOQ` ngay cả khi chưa có định mức chi tiết.
- Định mức chi tiết (G8): thư viện `cost_norm_items` (316) có, nhưng gắn vào dự án rất ít (`project_work_boq_norm_mappings` 3 dòng; SMB có 8 dòng BOQ lấy từ định mức).

### K5. Đề xuất vật tư, cung ứng
- Có và đang dùng: đề xuất vật tư theo luồng yêu cầu dùng chung (`requests` 78, `material_request_events` 346), cảnh báo so BOQ và tồn kho công trường (migration 24/09 đã lên production); nguồn mua hàng `procurement_source_documents` (141), PO `purchase_orders` (61), giao hàng `purchase_order_delivery_lines` (156), NCC giao thẳng, bảng kê NCC.
- Thiếu: nguồn "Kế hoạch vật tư đã duyệt" vào Mua hàng (quyết định 22/09) — code Codex chưa lên production; giao diện Mua hàng chưa được chấp nhận.

### K6. Nhập xuất kho
- Có và đang dùng: `inventory_transactions` (290), `inventory_ledger_entries` (471), `inventory_balances` (189), 6 kho; phiếu cấp/xuất `material_issue_orders` (63) với dòng `material_issue_lines` (155) **đã gắn `work_boq_item_id`, `material_budget_item_id`, `subcontractor_contract_id`, dòng đề xuất**; hoàn (`material_issue_returns`), quyết toán (`material_issue_settlements`), trả NCC.
- Thiếu: ảnh bắt buộc khi nhập (cân xe, phiếu giao) — cần kiểm tra; kiểm kê `wms_inventory_counts` rỗng.

### K7. Ghi nhận, so sánh, cảnh báo với BOQ vật tư
- Có: `material_budget_items` mang lũy kế đề xuất/nhập/xuất, tồn, `% vượt`, `auto_alert`; tab Vật tư hiển thị trạng thái **Chưa yêu cầu / Đang cung ứng / Đủ / Vượt**; tab **Hao hụt**; cảnh báo khi lập đề xuất.
- Thiếu: so với **tiến độ thực hiện** (xuất/tiêu hao so với KL công việc đã làm — "sử dụng vượt tiến độ"); ngưỡng cảnh báo 2 mức; so sánh KH vật tư ↔ đã cấp ↔ đã dùng; Nhật ký V2 hầu như chưa ghi vật tư (`daily_log_materials` 8 dòng).

### K8. Báo cáo
- Tab **Báo cáo** hiện chỉ có báo cáo tiến độ tổng hợp. Báo cáo vật tư rải trong tab Vật tư (Tổng hợp, Dashboard). Chưa có báo cáo xuyên suốt KH → cung ứng → kho → tiêu hao.

## 3. Nối các khâu — đề xuất thứ tự

Nguyên tắc: làm từng đợt **dùng được ngay** trên SMB/DA29, mỗi đợt nối thêm một mắt xích; tái dùng bảng/màn đang chạy trên production; chỉ lấy lại từ code Codex những phần đã đọc kỹ và còn đúng, không merge nguyên nhánh.

| Đợt | Nội dung | Nối |
|---|---|---|
| **Đ1 – Kế hoạch tháng & tuần** | Một mẫu kế hoạch thi công theo kỳ (tháng/tuần), sinh từ bảng tiến độ (gợi ý công việc đang/ sắp chạy + KL còn lại), duyệt; tiến độ thực tế lấy từ Nhật ký/Chốt tiến độ để so KH–TT | K1 → K2 → K3 |
| **Đ2 – Kế hoạch vật tư** | Sinh vật tư từ KH tuần/tháng theo BOQ vật tư gắn công việc (quy đổi tỷ lệ; định mức chi tiết nếu có); hiện rõ dòng thiếu định mức; duyệt | K3 → K4 |
| **Đ3 – KH vật tư → Mua hàng** | KH vật tư đã duyệt thành nguồn cho Mua hàng (không lập đề xuất lại); đề xuất bổ sung vẫn độc lập; dấu vết nguồn đến PO/giao hàng | K4 → K5 → K6 |
| **Đ4 – Tiêu hao & cảnh báo** | So xuất kho/tiêu hao theo công việc với KL đã làm (từ Nhật ký) và BOQ; 2 ngưỡng cảnh báo; chặn/cho phép vượt có lý do | K6 → K7 |
| **Đ5 – Báo cáo** | Bộ báo cáo gọn: theo dõi KH vật tư, tồn kho kỳ, vật tư dùng theo công việc, quyết toán vật tư, tiến độ mua | K1–K7 → K8 |

Audit vòng 2 (trước khi code từng đợt) sẽ đọc sâu màn hình và service của khâu tương ứng, đối chiếu từng migration Codex liên quan, rồi chốt thiết kế dữ liệu + màn hình với chủ sản phẩm.

## 4. Quyết định cần chủ sản phẩm chốt

1. **Kế hoạch tháng lập theo gì?** (a) theo công việc của bảng tiến độ toàn dự án, hay (b) theo từng hợp đồng (CĐT / thầu phụ) như FastCons. Đề xuất: (a), có cột hợp đồng/tổ đội để lọc — một nơi lập, không hai bản song song.
2. **Ai lập, ai duyệt KH tháng / KH tuần / KH vật tư?** Đề xuất: KH tháng — CHT lập, Giám đốc dự án duyệt; KH tuần — kỹ sư/CHT lập, CHT duyệt; KH vật tư — sinh từ KH tuần, CHT duyệt, đi thẳng Mua hàng.
3. **Kỳ nào là chuẩn để mua hàng?** Đề xuất: KH vật tư **tuần** (cần gấp, sát thực tế); KH vật tư tháng chỉ để dự trù và đặt hàng dài.
4. **Vượt BOQ vật tư:** chặn cứng hay cho vượt kèm lý do + người duyệt? Đề xuất: cho vượt kèm lý do, cảnh báo 2 ngưỡng (80% / 100%), người duyệt là CHT.
5. **Code Project V2 của Codex:** đồng ý để em đọc và lấy lại từng phần phù hợp (không merge nguyên nhánh, không chạy 11 migration cũ nguyên trạng)?
