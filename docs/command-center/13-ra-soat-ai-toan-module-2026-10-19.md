# Rà soát phủ Trợ lý AI + Jev lên toàn bộ module — 19/10/2026

Chủ SP (19/10): AI và Jev đã làm tốt ở Nhân sự và Mua hàng; mở rộng sang Quy trình, Yêu cầu, Đặt xe, Kho vật tư, Office, Công việc… — **mọi thao tác, báo cáo, thống kê ở mọi module đều có AI hỗ trợ bằng tiếng Việt**. Tài liệu này kiểm kê hiện trạng, đo mức dùng thật, vẽ bản đồ công cụ theo module và đề xuất thứ tự làm. Chưa code.

## 1. Nguyên tắc giữ nguyên (đã chốt 18–19/10)

1. **Quyền do RPC / RLS quyết**, lời nhắc không tự thu hẹp; 42501 → "ngoài phạm vi được xem" (doc 10).
2. **AI chỉ đọc và chuẩn bị nháp**; người bấm Gửi / Duyệt trên thẻ. Không bao giờ tự xóa, duyệt, ghi sổ.
3. Mỗi công cụ mới = **RPC có kiểm quyền + test đơn vị + ca Playwright + ca hồi quy model thật theo vai** (Admin / người có quyền / nhân viên thường).
4. **Tầng tìm ngay** trước AI (hồ sơ, màn hình, thao tác — #254, #258); câu hỏi thật gửi kèm hồ sơ tìm sẵn.
5. **Biểu đồ dùng thẻ chung** (`AssistantChartCard`, #256): mỗi báo cáo mới chỉ cần RPC số liệu + hàm dựng `ChartSpec`.
6. **Jev** lo phân loại / điều hướng / xếp hạng có xác suất (đang chạy bóng, J2 sau ~26/10); không thay code tính toán, không tra chính xác.

## 2. Hiện trạng Trợ lý (19/10)

| Nhóm | Đã có | Phủ module |
|---|---|---|
| Công cụ đọc (7) | `tim_ho_so` (20 loại hồ sơ), `ton_kho`, `chi_tiet_don_mua`, `chi_tiet_de_xuat`, `viec_cua_toi`, `phep_nhan_vien`, `chi_tiet_ho_so` | Mua hàng, Vật tư (tồn), Dự án (đề xuất), Nhân sự, Trung tâm (việc chờ tôi mọi module) |
| Công cụ chuẩn bị (5) | nghỉ phép, đề xuất vật tư, đơn mua, nhật ký từ Zalo, ghi nhớ | Nhân sự, Dự án, Mua hàng |
| Biểu đồ (1) | `bien_dong_nhan_su` | Nhân sự |
| Skill gắn nút | tóm tắt PO trước duyệt, tách đề xuất, đọc báo giá / phiếu / báo cáo, bản tin sáng | Mua hàng, Kho, Nhật ký, Trung tâm |
| Jev | chạy bóng ý định + lệnh cấm (ai_decisions) | chung |

**Chưa phủ**: Quy trình (phiếu, mẫu, SLA), Yêu cầu, Đặt xe, Kho (phiếu kho, thẻ kho, kiểm kê, chuyển kho, phiếu chờ), Office (văn bản, mẫu, VPP), Công việc (Vioo Work), Tài chính (đề nghị chi, công nợ, quỹ, dự báo), Tài sản, Hợp đồng, Dự án (tiến độ, chậm, kế hoạch tuần).

## 3. Mức dùng thật 30 ngày gần nhất (Cloud, 19/10)

| Module | Chứng từ chính | Mới 30 ngày | Nhận xét |
|---|---|---|---|
| **Quy trình** | `workflow_instances` 119 (515 log, 731 người tham gia) | **cao nhất** | người dùng ngày nào cũng trình ký / duyệt |
| Dự án · Nhật ký | `daily_logs` 85, tiến độ ngày 2.272 dòng, lý do chậm 250 | cao | đã có AI nhật ký; thiếu hỏi đáp tiến độ / chậm |
| Mua hàng | `purchase_orders` 77, đợt giao 164 dòng | cao | đã phủ |
| Kho vật tư | `inventory_transactions` 69, sổ kho 261, kiểm kê 111 dòng | cao | chỉ có tồn kho; chưa phiếu kho, thẻ kho, kiểm kê |
| **Yêu cầu** | `requests` 45 | trung bình | chưa phủ |
| Nhân sự | phép 89 biến động, roster, hồ sơ | trung bình | đã phủ phần lớn |
| Office văn bản | `office_documents` 12 (86 phiên bản) | thấp, mới dùng | có sẵn `office_query` / `office_command` |
| Đặt xe | `vehicle_bookings` 1 (6 tổng) | rất thấp | truy vấn bảng qua RLS, 3 RPC duyệt |
| Công việc (Vioo Work) | `work_tasks` 0 (3 tổng) | chưa dùng | 56 RPC sẵn, chưa có người dùng |
| Tài chính | `finance_payment_requests` 0, `transactions` 92 | ít chứng từ, nhiều số liệu | dashboard + 120 RPC sẵn |
| VPP / Tài sản | 1 / 0 | rất thấp | để sau |

→ Thứ tự theo mức dùng: **Quy trình → Kho vật tư → Yêu cầu → Dự án tiến độ → Tài chính → Office → Công việc → Đặt xe / VPP / Tài sản**.

## 4. Bản đồ công cụ theo module

Ký hiệu: Đ = công cụ đọc · C = công cụ chuẩn bị nháp (thẻ) · B = báo cáo / biểu đồ (thẻ chung) · J = điểm Jev.

### 4.1 Quy trình (`/wf`) — đợt 1

| Việc người dùng hay làm | Trợ lý | Nguồn (RPC có sẵn) | Ghi chú |
|---|---|---|---|
| "Phiếu của tôi đang ở bước nào / ai đang giữ / quá hạn chưa" | Đ `chi_tiet_phieu_quy_trinh` (theo mã / hN) | `get_project_workflow_timeline`, `get_project_workflow_action_context`, RLS `workflow_instances` | hiện `tim_ho_so` chỉ thấy tên phiếu |
| "Phiếu nào đang chờ tôi / tôi đang treo của ai" | Đ (đã có `viec_cua_toi`), thêm lọc theo mẫu / dự án | `vcc_my_work_items_v1`, `vcc_flow_items_v1` | gắn SLA, số ngày chờ |
| "Tạo phiếu đề nghị tạm ứng 20 triệu cho SMB" | C `chuan_bi_phieu_quy_trinh`: chọn **mẫu** (J: Choice mẫu từ câu, danh sách mẫu người này được tạo), điền trường chuẩn (dự án, số tiền, lý do), thẻ → form rút gọn → `create_workflow_instance_draft` | `create_workflow_instance_draft`, `get_project_workflow_configuration`, mẫu có version | thẻ chỉ tạo **nháp**; gửi duyệt vẫn bấm |
| "Tuần này bao nhiêu phiếu trễ SLA, bước nào tắc" | B biểu đồ phiếu theo trạng thái / mẫu / tuần; J Score "mức tắc" | `wf/dashboard` đã có số → RPC tổng hợp theo quyền | thẻ chung |
| Duyệt / trả lại | **không** làm qua AI — người bấm ở phiếu | — | AI chỉ dẫn link mở phiếu |

### 4.2 Kho vật tư (`/operations`, `/inventory`, `/audit`, `/reports`) — đợt 2

| Việc | Trợ lý | Nguồn | Ghi chú |
|---|---|---|---|
| "Phiếu nhập 0010042 nhận gì, của đơn nào, ai ký" | Đ `chi_tiet_phieu_kho` | RLS `inventory_transactions`, `get_wms_tx_spec_allocations_v1` | `tim_ho_so` đã thấy phiếu |
| "Thẻ kho thép D16 kho SMB tháng này" | Đ / B `the_kho` (nhập – xuất – tồn theo kỳ) | `get_wms_item_card_v1`, `get_inventory_ledger_report` | biểu đồ nhập xuất theo tuần |
| "Vật tư nào sắp hết / tồn lâu / lệch kiểm kê" | B tồn theo kho + cảnh báo; J Score "đáng lo" | `list_wms_stock_v1`, `get_wms_inventory_workspace_v1`, kiểm kê | thẻ chung |
| "Phiếu giao nào chờ ghi sổ quá 3 ngày" | Đ danh sách phiếu chờ | `list_wms_stale_documents_v1` | đã có số liệu ở Mua hàng → gộp |
| "Chuyển 50 cây thép D16 từ kho SMB sang kho Xinhai" | C `chuan_bi_chuyen_kho` (thẻ → form chuyển kho) | `dispatch_wms_transfer_v1` chỉ chạy khi người bấm | như đề xuất vật tư |
| Xuất kho cấp phát | C `chuan_bi_xuat_kho` theo đề xuất đã duyệt | luồng V2 Kho một màn | đợt 2b |

### 4.3 Yêu cầu (`/rq`) — đợt 2

| Việc | Trợ lý | Nguồn |
|---|---|---|
| "Phiếu yêu cầu RQ-2026-000052 ai duyệt rồi, còn ai" | Đ `chi_tiet_yeu_cau` | `get_request_detail` (đã kiểm quyền) |
| "Tạo yêu cầu … theo mẫu X" | C chọn mẫu (J) + điền trường chuẩn + đính kèm → thẻ → form Yêu cầu | mẫu yêu cầu có version, `request_*` |
| "Tháng này phòng nào gửi nhiều yêu cầu, trễ bao nhiêu" | B theo mẫu / phòng / trạng thái | RPC tổng hợp mới theo quyền |

### 4.4 Dự án · tiến độ (`/da`) — đợt 3

| Việc | Trợ lý | Nguồn |
|---|---|---|
| "SMB chậm hạng mục nào, vì sao" | Đ `tien_do_du_an` (nhanh / chậm, mốc khống chế, lý do chậm từ Nhật ký) | `get_project_task_progress_v1`, `get_project_delay_reasons_v1`, `get_project_schedule_control_v1` |
| "Tuần này SMB làm gì, kế hoạch tuần" | Đ kế hoạch tuần | `get_project_work_plan_board_v1` |
| "Biểu đồ % hoàn thành theo tuần 2 dự án" | B | `project_weekly_task_progress` → RPC theo quyền |
| Nhật ký hôm nay đủ chưa, ai chưa gửi | Đ | `get_daily_log_today_board_v1`, `get_daily_log_review_queue_v1` |

### 4.5 Tài chính — đợt 3 (quyền chặt, Admin bật từng người)

| Việc | Trợ lý | Nguồn |
|---|---|---|
| "Còn phải trả Hợp Thành bao nhiêu, đến hạn khi nào" | Đ công nợ NCC / CĐT | `get_procurement_po_payment_status_v1`, RPC phải trả / phải thu (có `get_my_project_sensitive_access`) |
| "Dòng tiền 1–3 tháng tới" | B từ dự báo đã có | `/finance/forecast` RPC |
| "Đề nghị chi nào chờ tôi duyệt, bao nhiêu tiền" | Đ | `list_finance_payment_requests_v1` |
| "Lập đề nghị chi 50 triệu trả Hợp Thành đợt 2" | C thẻ → form đề nghị chi | `/finance/requests` lệnh tạo nháp |
| Chi phí dự án so ngân sách | B | `get_finance_project_cost_v1`, `get_finance_project_summary_v1` |

### 4.6 Office · văn bản, VPP — đợt 4

| Việc | Trợ lý | Nguồn |
|---|---|---|
| "Công văn đi số 12 gửi ai, ở bước nào" | Đ `chi_tiet_van_ban` | `office_query` (đã có lớp truy vấn riêng), RLS |
| "Soạn công văn gửi NCC về chậm giao" | C thẻ nháp văn bản theo mẫu (AI viết, người sửa, lưu nháp qua `office_command`) | `office_command` + `office_number_suggestion_v1` — đã có `office_ai_begin` → gộp vào cổng chung |
| Báo cáo văn bản đến / đi theo tháng | B | `/office` màn Báo cáo đã có số |
| "Xin 2 ram giấy A4, 5 bút" (VPP) | C thẻ → `save_office_supply_request_v1` | đã có RPC, 82 mã |

### 4.7 Công việc (Vioo Work) — đợt 4 (chưa có người dùng, làm khi mở rộng)

| Việc | Trợ lý | Nguồn |
|---|---|---|
| "Việc của tôi tuần này, việc trễ" | Đ | `list_work_tasks(p_view, filters)` |
| "Giao việc cho Thanh: … hạn thứ 6" | C thẻ → `create_work_task` | có `get_work_creation_context` |
| Biểu đồ việc theo người / trạng thái | B | `list_work_tasks` tổng hợp |

### 4.8 Đặt xe, Tài sản, Hợp đồng — đợt 5

| Việc | Trợ lý | Nguồn |
|---|---|---|
| "Đặt xe đi Hưng Yên 8h mai 3 người" | C thẻ → form đặt xe | bảng `vehicle_bookings` qua RLS, `get_pending_vehicle_booking_approval_cards` |
| "Xe nào đang bận / ai duyệt đặt xe" | Đ | RLS + RPC duyệt |
| "Máy hàn số 12 ai đang giữ" | Đ tài sản + cấp phát | `/ts` RPC (`record_asset_assignment` ghi; đọc qua RLS) |
| "Hợp đồng Dragon còn bao nhiêu chưa nghiệm thu" | Đ | `/hd` RPC hợp đồng (đã có `tim_ho_so` 3 loại HĐ) |

### 4.9 Jev theo module (sau J2)

| Điểm | Choice / Score / Noul | Dùng ở |
|---|---|---|
| Ý định theo module (mở rộng 7 nhãn → ~14 nhãn: quy trình, yêu cầu, kho, văn bản, đặt xe, công việc, tài chính) | Choice | điều hướng công cụ, chọn model rẻ cho tra cứu |
| Chọn **mẫu** quy trình / yêu cầu / văn bản từ câu nói | Choice trên danh sách mẫu người này được tạo + "khác" | C quy trình, yêu cầu, văn bản |
| Mức ưu tiên phiếu chờ duyệt (tiền, SLA, dự án nóng) | Score | sắp hàng đợi "việc chờ tôi" |
| Phiếu kho chờ ghi sổ đáng lo / lệch kiểm kê đáng xem | Score / Noul | B kho |
| Câu đòi thao tác cấm ở mọi module | Noul (đang chạy bóng) | gác chung |

## 5. Lộ trình đề xuất

| Đợt | Nội dung | Vì sao trước |
|---|---|---|
| **1 — Quy trình** (≈ 1 tuần) | Đ chi tiết phiếu + ai giữ + SLA; C tạo phiếu nháp theo mẫu (Jev chọn mẫu, hỏi lại bằng nút khi ≥ 2 mẫu khớp); B phiếu theo trạng thái / tuần; mở rộng `tim_ho_so` nhận mã phiếu; ca theo vai | dùng nhiều nhất (119 phiếu / 30 ngày), đã có RPC kiểm quyền và RLS |
| **2 — Kho + Yêu cầu** (≈ 1,5 tuần) | Đ phiếu kho, thẻ kho, phiếu chờ; B nhập – xuất – tồn, sắp hết / tồn lâu; C chuyển kho, yêu cầu theo mẫu; Đ chi tiết yêu cầu | 69 phiếu + 261 dòng sổ kho; kho là nơi Jev kiểm chéo mạnh nhất |
| **3 — Dự án tiến độ + Tài chính** (≈ 1,5 tuần) | Đ tiến độ / chậm / kế hoạch tuần; B % hoàn thành theo tuần; Đ công nợ, đề nghị chi chờ; B dòng tiền; C đề nghị chi nháp | BLĐ hỏi nhiều; quyền Tài chính chặt nên làm sau khi khung ổn |
| **4 — Office + Công việc** (≈ 1 tuần) | Đ / C văn bản (gộp `office_ai_begin` vào cổng), VPP; Đ / C công việc | Office mới dùng, Work chưa có người dùng |
| **5 — Đặt xe, Tài sản, Hợp đồng** (≈ 1 tuần) | Đ / C đặt xe; Đ tài sản; Đ hợp đồng | ít dùng |
| **J2 (sau ~26/10)** | Đọc `shadow-report` → bật tầng tự chạy: điều hướng ý định 14 nhãn, chọn mẫu, model rẻ cho câu dễ, Score ưu tiên | cần số thật từ chạy bóng |

Mỗi đợt: một PR nhóm (công cụ + lời nhắc + test + ca hồi quy + fixture Playwright), deploy `ai-gateway`, cập nhật HANDOFF mục 4, chủ SP thử rồi mới sang đợt sau. RPC tổng hợp mới (báo cáo) đi kèm migration + smoke rollback như doc 10.

## 6. Quyết định của chủ SP (20/10)

**Ưu tiên báo cáo và biểu đồ trước**; phần "tạo phiếu bằng câu nói" **không làm** — tạo nhanh đã có ở ô Tìm kiếm (thao tác nhanh). Đợt báo cáo A1 (PR cùng ngày): công cụ `bao_cao` với 3 loại — phiếu quy trình (cột 3 chuỗi theo kỳ + tròn theo mẫu), nhập xuất kho (giá trị theo kỳ + tròn vật tư xuất nhiều; theo vật tư thì số lượng + tồn hiện tại; lọc kho), đơn mua (giá trị theo kỳ + tròn NCC + tròn dự án). RPC `security invoker` chạy dưới RLS → mỗi người thấy đúng số mình được xem. Thẻ biểu đồ có thêm dạng cột chồng và tròn (chú giải có số và %). Đợt A2 dự kiến: tiến độ dự án theo tuần, nhật ký / lý do chậm, tài chính (dòng tiền, công nợ, đề nghị chi), nhân sự (chấm công, phép theo phòng), yêu cầu theo mẫu / phòng ban, đặt xe, văn bản đến / đi.

## 6b. Câu cũ (giữ để tham chiếu)

1. Thứ tự đợt như mục 5 có đúng ý không (em đề xuất bắt đầu **Quy trình**).
2. "Tạo phiếu quy trình / yêu cầu bằng câu nói" dừng ở **phiếu nháp** (người mở phiếu, bổ sung rồi bấm Gửi) — đúng nguyên tắc không tự gửi?
3. Báo cáo nào anh muốn Trợ lý vẽ **trước** ở mỗi module (mỗi module một biểu đồ đầu tiên).
