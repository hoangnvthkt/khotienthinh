# Đợt 2 — Kế hoạch vật tư tháng/tuần (thiết kế + audit vòng 2)

Nối K3 (Kế hoạch tuần/tháng đã duyệt) → K4 (Kế hoạch vật tư). Quyết định chủ sản phẩm: mục 5 của `00-audit.md`.

## Audit vòng 2 (production 30/09)
- Các bảng `material_plans*` (G-series) vẫn rỗng; chúng gắn chặt với sổ nguồn mua hàng (lưu là đăng ký `procurement_source_documents`) và chuyển sang đề xuất vật tư nháp. Màn "Vật tư → Kế hoạch" dựa trên read model cân đối BOQ rất chặt: SMB chỉ 203/556 dòng chọn được, 256 "effect chưa phân bổ" → khó dùng. Không dùng lại ở Đợt 2.
- Mua hàng hiện chỉ nhận nguồn từ đề xuất vật tư (`project_material_request`, 80) và PO (61) → Đợt 3 nối KH vật tư đã duyệt vào đó.
- BOQ vật tư gắn công việc + mã kho đầy đủ ở SMB (56 mã, 100% khớp danh mục); mỗi công trường có 1 kho mặc định; một số kho tồn âm (RICO, kho tổng).

## Cách tính
- Nhu cầu = KL kế hoạch / KL công việc × SL vật tư BOQ của công việc (làm tròn 3 số lẻ), gộp theo mã vật tư + ĐVT. Có bảng nguồn từng công việc để giải thích.
- Công việc không quy đổi được được liệt kê kèm lý do (chưa KL kế hoạch / công việc chưa có KL / chưa khai vật tư BOQ / vật tư chưa có mã kho). SMB tuần 41: 160 việc → 52 vật tư, 61 việc chưa khai vật tư BOQ.
- SL đề nghị gợi ý = nhu cầu − tồn kho công trường dương. Kho có nhưng chưa có dòng tồn của mã = 0; không có kho = "Chưa rõ tồn". Tồn âm hiện cảnh báo.
- BOQ: (đã cấp + đề nghị) / BOQ; ≥ 80% vàng, vượt (dung sai làm tròn 0,01%) đỏ và **bắt buộc lý do** mới gửi được.

## Duyệt
Room `work_plan`: lập/gửi như KH thi công; CHT (`verify`) duyệt cả KH vật tư tuần và tháng. Đã duyệt thì không sửa; "Tạo bản điều chỉnh" tính lại nhu cầu từ KH thi công đã duyệt mới nhất, giữ SL đề nghị đã nhập.

## Giao diện
Tab Kế hoạch có công tắc **Thi công | Vật tư** dùng chung chọn kỳ. Nhóm vật tư dạng accordion thu gọn, đánh số 1 / 1.1, tô màu theo mức dùng BOQ; mở dòng để xem công việc nguồn. Tab Vật tư → Kế hoạch có lối vào sang màn mới (màn cũ giữ nguyên chờ chủ sản phẩm quyết định).
