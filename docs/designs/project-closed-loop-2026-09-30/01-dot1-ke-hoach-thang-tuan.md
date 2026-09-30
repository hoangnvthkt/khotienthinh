# Đợt 1 — Kế hoạch tháng & tuần (thiết kế)

Nối K1 (Bảng tiến độ) → K2 (Kế hoạch tháng) → K3 (Kế hoạch tuần). Thực tế lấy từ tiến độ ngày (Nhật ký/Chốt tiến độ) để so KH–TT. Quyết định chủ sản phẩm: mục 5 của `00-audit.md`.

## Audit vòng 2 — điều kiện dữ liệu (production 30/09)

- Công việc lá có khối lượng + ĐVT: SMB 329/332, DA29 299/312; đều có ngày BĐ/KT. **Chưa công việc nào có đơn giá** → cột giá trị hiện "Chưa có đơn giá", không hiện 0.
- Tiến độ thực tế `project_daily_task_progress` có `quantity_done` (lũy kế) và `daily_quantity_done` ở 100% dòng (SMB 11.620 dòng) → tính được "thực hiện trong kỳ".
- Tab Tiến độ hiện "Tiến độ theo giá trị 0%" và "Sản lượng thực tế 0%" dù chưa có đơn giá — lỗi hiển thị unknown thành 0 (ghi nhận, sửa ở đợt báo cáo).
- Tab Vật tư → Kế hoạch hiện dùng thuật ngữ nội bộ ("B ngân sách · I cấp ròng · O đang mở · C đóng", "Task <uuid>", "effect chưa phân bổ", "bước G3") → sẽ thay ở Đợt 2.
- Code Project V2 (Codex): kế hoạch tháng theo **dòng hợp đồng**, có workspace/cohort, bắt buộc người duyệt khác người lập, content-hash. Không lấy nguyên; chỉ lấy ý tưởng: bảng kế hoạch chung cho nhiều kỳ, dòng giữ snapshot, lịch sử sự kiện, bản điều chỉnh thay thế bản đã duyệt.

## Dữ liệu

- `project_work_plans`: 1 bản kế hoạch = 1 kỳ (tháng dương lịch hoặc tuần Thứ Hai–Chủ Nhật) của 1 dự án/công trường. Trạng thái `draft → submitted → approved`, `returned` quay lại sửa, `cancelled`, `superseded` (bị bản điều chỉnh thay). Mỗi kỳ chỉ có 1 bản đang hiệu lực. Bản điều chỉnh: `revision_no + 1`, `supersedes_plan_id`.
- `project_work_plan_lines`: công việc lá + KL kế hoạch trong kỳ, ngày BĐ/KT trong kỳ, tổ đội/nhà thầu (chữ), ghi chú. Snapshot khi lưu: mã WBS, tên, ĐVT, KL tổng, lũy kế trước kỳ.
- `project_work_plan_events`: lịch sử lập/gửi/trả/duyệt/điều chỉnh/hủy (audit).
- Thực hiện trong kỳ **không lưu**, tính từ `project_daily_task_progress`: lũy kế cuối kỳ − lũy kế trước kỳ.

## Quyền — Room mới "Kế hoạch tháng/tuần" (`work_plan`, nhóm Tiến độ)

| Quyền | Nhãn | Ai |
|---|---|---|
| view | Xem | mọi người trong dự án cần xem |
| edit | Lập/sửa kế hoạch | CHT, kỹ sư |
| delete | Xóa bản nháp | người lập |
| submit | Gửi duyệt | CHT, kỹ sư |
| verify | Duyệt KH tuần | CHT |
| approve | Duyệt KH tháng | GĐ dự án |

## Màn hình — tab "Kế hoạch" (sau tab Tiến độ)

- Đầu trang: **Tháng | Tuần**, chọn kỳ (‹ Tháng 10/2026 ›). Thẻ kỳ hiện tại: trạng thái, số công việc, % đạt (khi đã có thực hiện), thao tác chính.
- Kỳ chưa có kế hoạch: "Chưa có kế hoạch tháng 10/2026" + **Lập kế hoạch** — gợi ý sẵn các công việc có lịch trong kỳ và chưa xong, KL gợi ý = phần còn lại chia theo số ngày giao với kỳ; KL tuần gợi ý từ KH tháng nếu có.
- Bảng kế hoạch nhóm theo hạng mục lớn (thu gọn được): Công việc · ĐVT · Còn lại đầu kỳ · **KL kế hoạch** · Tổ đội/nhà thầu · Thời gian · Thực hiện · % đạt.
- Thao tác theo trạng thái: Lưu nháp / Gửi duyệt / Duyệt / Trả lại (bắt buộc lý do) / Tạo bản điều chỉnh / Xóa nháp.
- Unknown hiển thị đúng: chưa có thực hiện → "Chưa có số liệu", không có ĐVT/KL → "Chưa có khối lượng".

## Ngoài phạm vi Đợt 1

Kế hoạch vật tư (Đợt 2), Mua hàng (Đợt 3), tiêu hao (Đợt 4), báo cáo (Đợt 5), đơn giá/giá trị.
