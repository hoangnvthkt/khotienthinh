# Phiên bản kế hoạch — KH tháng / tuần / vật tư và tiến độ tổng (thiết kế)

Chủ sản phẩm giao 06/10/2026: kế hoạch luôn thay đổi (CĐT đổi thiết kế, đổi biện pháp thi công…). Mỗi lần đổi phải có người được quyền sửa, người được quyền duyệt, lưu lịch sử các phiên bản và so sánh trực quan nhanh/chậm so với bản gốc và các bản trước.

## 1. Quyết định đã chốt (06/10/2026 — "đồng ý cả 8, chọn a")

1. **Bản gốc = bảng tiến độ hiện tại** (bổ sung của chủ SP, thay câu 1–2): SMB và DA29 lấy tiến độ đang có tại thời điểm áp dụng làm gốc; các bản chụp baseline cũ giữ nguyên làm lịch sử, không xóa.
2. Người duyệt theo bảng ở mục 3; dời ngày về đích hoặc mốc HĐ → TGĐ (anh Thịnh), như duyệt vượt ngân sách.
3. Chỉ CHT và kỹ sư kế hoạch được lập bản điều chỉnh tiến độ tổng; người khác chỉ xem.
4. **Không sửa lùi**, áp dụng cả Admin: ngày đã qua và việc đã xong không dời kế hoạch, chỉ ghi thực tế; kỳ đã kết thúc không điều chỉnh.
5. Thành tích kỳ chấm theo **bản gốc của kỳ**, hiện thêm số theo bản hiện hành.
6. Danh sách lý do + bên chịu trách nhiệm như mục 4.
7. Vật tư giảm sau khi đã đặt → Mua hàng xử lý (giữ cho kỳ sau / giảm phần NCC chưa giao / nhận về tồn công trường), theo luật hàng thừa đã duyệt ở việc 2.
8. Làm **Đợt 1 trước** (KH tháng/tuần/vật tư + vá lỗi đặt trùng), mockup dữ liệu thật rồi mới code.

## 2. Hiện trạng (production, chỉ đọc 06/10)

- KH tháng/tuần (`project_work_plans`) và KH vật tư (`project_material_plans`) đã có: bản đã duyệt không sửa đè, `revise_*_v1` tạo bản điều chỉnh có lý do (chữ tự do), `superseded`, sự kiện. Chưa có: so sánh giữa các bản, nhóm lý do, bên chịu trách nhiệm, đính kèm, đo theo gốc, chặn sửa lùi, người duyệt khác người lập. **0 bản** trên prod → đặt luật ngay từ đầu, không phải chuyển dữ liệu cũ.
- **Lỗi tiềm ẩn**: `app_private.procurement_inbox_lines` tính "đã đặt" qua `procurement_po_plan_links.material_plan_line_id` = dòng của bản đang duyệt. KH vật tư điều chỉnh sau khi đặt hàng → Mua hàng thấy như chưa đặt (nguy cơ đặt trùng), đơn cũ rời khỏi hộp nhu cầu.
- Tiến độ tổng (Gantt, Room `gantt` chỉ view/edit/delete): không duyệt; SMB 15 người được sửa thẳng (cả Mua hàng, thủ kho, kế toán), DA29 8 người. "Chốt Baseline" bấm tay, không lý do (SMB 7 bản chụp, 3 bản trùng trong 2 giây). `project_gantt_command_requests` chỉ ghi ai bấm lệnh gì, không ghi trước/sau.
- SMB: 57 việc bị dời ngày (bản chụp 09/09: 49, 18/09: 8); ít nhất 48 việc dời tới ngày đã qua lúc sửa, 35 việc khớp ngày làm thực tế ±3; 132 việc trễ chưa xong không được lập lại. DA29: bản chụp gốc 13/08 chỉ phủ 24/312 việc lá.
- Dữ liệu cần sửa trước khi dùng KH vật tư: SMB "Ốp tường WC các tầng" định mức sai ~1000 lần (gạch ốp 376.600 m² cho 369 m², xi măng 3.175 tấn); "Vít tôn" 875.880 con cho 1.946 m² mái; DA29 2.4.4/2.4.5 đảo ĐVT (ván khuôn "kg", cốt thép "m2"); giá gạch rỗng PO-483-03 = 125 đ/viên.

## 3. Ai sửa, ai duyệt

| Kế hoạch | Lập bản điều chỉnh | Duyệt | Cấp cao hơn khi |
|---|---|---|---|
| Tiến độ tổng (đợt 2) | CHT, kỹ sư kế hoạch | GĐ dự án | Dời ngày về đích / mốc HĐ → TGĐ |
| KH tháng | CHT, kỹ sư (`work_plan.edit`) | GĐ dự án (`work_plan.approve`) | — |
| KH tuần | Kỹ sư | CHT (`work_plan.verify`) | — |
| KH vật tư | Kỹ sư, CHT | CHT (`work_plan.verify`) | Vượt BOQ → GĐ dự án |

Mua hàng, kho, kế toán: xem + nhận thông báo. Cập nhật thực tế (% / khối lượng / ngày thực tế) đi qua Nhật ký và Chốt tiến độ, không phải bản điều chỉnh.

## 4. Lý do và bên chịu trách nhiệm

Danh mục dùng chung với lý do chậm ở Nhật ký (bảng cấu hình, sửa ở Thiết lập): Thay đổi thiết kế (CĐT) · Phát sinh khối lượng · Đổi biện pháp thi công · Chậm do vật tư · Chậm do nhân công, máy · Mặt bằng, việc trước chưa bàn giao · CĐT chậm duyệt, chậm thanh toán · Thời tiết · Đẩy nhanh tiến độ.
Bên chịu trách nhiệm: Chủ đầu tư · Công ty · Thầu phụ/NCC · Khách quan (mặc định theo lý do, sửa được). Lý do thuộc CĐT bắt buộc đính kèm văn bản.
Mỗi **dòng** thay đổi có lý do riêng (mặc định = lý do chính của bản) → lọc "thay đổi do CĐT" làm hồ sơ gia hạn/phát sinh.

## 5. Đợt 1 — KH tháng / tuần / vật tư

**Khái niệm**: Bản gốc (bản duyệt đầu tiên của kỳ, khóa) · Bản hiện hành (bản duyệt mới nhất) · Bản điều chỉnh (nháp → chờ duyệt → duyệt thì thay bản hiện hành, bản cũ chỉ xem).

**Luật (máy chủ kiểm, giao diện báo trước)**
- Kỳ đã kết thúc (hôm nay > ngày cuối kỳ): không tạo/sửa/gửi bản điều chỉnh.
- Dòng có trong bản hiện hành mà đã bắt đầu (ngày BĐ < hôm nay): giữ ngày BĐ; ngày KT mới phải ≥ hôm nay. Dòng mới: ngày BĐ ≥ hôm nay.
- KL mới ≥ KL đã làm trong kỳ; dòng đã làm > 0 không được bỏ khỏi kỳ (giảm về phần đã làm).
- Dòng thay đổi phải có lý do; lý do cần văn bản thì phải có đính kèm khi gửi.
- Người duyệt khác người lập và người gửi (cả bản đầu tiên).

**Dữ liệu (migration mới)**
- `project_plan_change_reasons` (mã, nhãn, bên mặc định, cần văn bản, thứ tự, đang dùng) — seed 9 lý do.
- `project_work_plans` + `project_material_plans`: `change_reason_code`, `responsible_party`, `change_summary`, `attachments jsonb`, `needs_review_at`, `needs_review_reason`.
- `project_work_plan_lines`: `change_reason_code`, `responsible_party`, `change_note`.
- Không lưu bản so sánh: so sánh = dòng của 2 bản (bản trước theo `supersedes_plan_id`, gốc = `revision_no` nhỏ nhất đã duyệt).

**RPC**
- `get_project_work_plan_board_v1` trả thêm `versions[]` (id, số bản, trạng thái, lý do, người/giờ lập-gửi-duyệt, đính kèm) và `original` (bản gốc + dòng) để tính "theo gốc".
- `save` / `revise` / `transition(submit|approve)`: thêm các luật trên; `approve` tháng → đánh dấu `needs_review` cho KH tuần đã duyệt/đang mở giao với tháng + KH vật tư cùng kỳ, gửi thông báo người lập.
- KH vật tư: khi KH thi công của kỳ được duyệt bản mới → tự tạo **nháp điều chỉnh vật tư** (giữ SL đề nghị đã nhập, như `revise_project_material_plan_v1`), báo người lập vật tư.
- **Vá đặt trùng**: duyệt bản vật tư mới → chuyển `procurement_po_plan_links` của dòng bản cũ sang dòng cùng `item_id + unit` của bản mới; vật tư không còn nhu cầu → dòng nhu cầu 0 để hiện "dư so với đã đặt". `procurement_inbox_lines` không đổi công thức nhưng đúng số.
- Mua hàng: bảng quyết định phần dư (`procurement_plan_excess_decisions`: dòng, SL, giữ cho kỳ sau / giảm phần NCC chưa giao / nhận về tồn, lý do, người, giờ). "Giảm phần chưa giao" dùng luồng kết thúc thiếu sẵn có (không trả phần thiếu về Cần mua); "giữ cho kỳ sau" thành nguồn có sẵn khi lập KH vật tư kỳ sau.

**Màn hình** (mockup `pv.html`, 7 cảnh)
1. KH tháng: dải phiên bản (Gốc → … → Hiện hành → Chờ duyệt), "So với: Bản gốc | Bản trước | Không so sánh", tóm tắt (thêm / dời khỏi kỳ / đổi KL / đổi ngày / vật tư kéo theo / bên chịu trách nhiệm), thực hiện theo gốc và theo bản đang xem, bảng so sánh theo hạng mục (KL cũ → mới, ngày cũ → mới, đã làm, lý do từng dòng), lịch sử phiên bản; kỳ đã qua khóa.
2. Soạn bản điều chỉnh: sửa trên bản sao, lỗi "sửa lùi" báo tại dòng kèm nút sửa nhanh; lý do theo dòng; hộp gửi duyệt có lý do chính, bên chịu trách nhiệm, mô tả, đính kèm, tác động tự tính (vật tư + tiền, KH tuần bị ảnh hưởng, Mua hàng).
3. Duyệt: lý do + văn bản, kiểm tra tự động, tác động, bảng so sánh, Trả lại (bắt buộc lý do) / Duyệt; người lập không thấy nút duyệt.
4. KH tuần cần xem lại: cảnh báo + so sánh tuần hiện hành với gợi ý theo KH tháng mới, "Tạo bản điều chỉnh tuần (điền sẵn)" / "Giữ nguyên — ghi lý do".
5. KH vật tư tính lại: nháp vật tư tự sinh, so sánh nhu cầu, ngày cần, đã đặt/đã nhận, kết luận (cần mua thêm / dư so với đã đặt / dùng tồn kho / đủ), tiền chênh (đơn giá dự toán, không có thì giá mua gần nhất, không có nữa thì "chưa có đơn giá").
6. Mua hàng: mục "Thay đổi từ kế hoạch vật tư" — cần mua thêm (gom vào đơn), dư so với đã đặt (gợi ý giữ cho kỳ sau khi việc còn phần chưa làm; giảm phần NCC chưa giao khi việc bị bỏ), đổi ngày cần (báo NCC).
7. Dòng thời gian dự án: mọi lần lập/điều chỉnh/duyệt + Mua hàng xử lý, lọc theo bên chịu trách nhiệm, xuất thay đổi do CĐT.

Lưu ý giao diện: `index.css` cắt chữ `.text-xs` trong `.grid > div` trên mobile — ghi chú lý do, cảnh báo phải ép xuống dòng (`!whitespace-normal`).

## 6. Đợt 2 — Tiến độ tổng

- Gốc = tiến độ hiện tại tại thời điểm áp dụng (quyết định 1); `project_baselines` cũ đánh dấu lịch sử, không xóa.
- Room `gantt`: thêm `submit`, `approve`; thu quyền `edit` về CHT + kỹ sư kế hoạch (SMB: Sơn, Việt, Thành, Khôi; DA29: Năm, Dương, Danh — xác nhận khi triển khai); người duyệt dời ngày về đích = thiết lập, mặc định TGĐ Thịnh.
- Chế độ "Sửa thử" (Sandbox) thành bản điều chỉnh: gửi duyệt → duyệt thì áp và tự lưu phiên bản (bỏ nút "Chốt Baseline" bấm tay); chặn sửa lùi; so sánh 3 lớp thanh (gốc / bản so sánh / thực tế) + ± ngày.

## 7. Đợt 3

Báo cáo biến động kế hoạch cho Ban giám đốc (ngày về đích dự báo so với HĐ, số lần điều chỉnh, theo bên chịu trách nhiệm) và xuất hồ sơ thay đổi do CĐT.
