# Rà soát Quản lý dự án: Kế hoạch thi công, Kế hoạch vật tư, Nhật ký (08/10/2026)

Phạm vi: code đang chạy production (`origin/main` d2796772, gồm #114 phiên bản kế hoạch, #96/#100/#132 Nhật ký).
Cách làm: đọc code giao diện + hàm máy chủ (migration), chạy test tự động. Chạy thử trên dữ liệu thật SMB-2026 bằng `tools/flow-test.mjs`, trong `begin … rollback` nên không ghi lại dữ liệu. Lần 1 do chủ SP chạy ngày 08/10; kết quả ở mục 4.

## 1. Luồng dữ liệu: nơi tạo, nơi nhận

| # | Khâu (màn hình) | Ai làm | Tạo dữ liệu | Nhận dữ liệu từ | Đẩy dữ liệu sang |
|---|---|---|---|---|---|
| 1 | **Tiến độ** (Dự án → Tiến độ) | KS/CHT có quyền sửa Gantt | `project_tasks` (việc, KL, ngày) | BOQ công việc | Gợi ý việc + KL cho KH tháng/tuần |
| 2 | **Kế hoạch → Thi công → Tháng** | KS lập, GĐ/Admin duyệt (Room *Kế hoạch*: Duyệt KH tháng) | `project_work_plans` (tháng) | Khâu 1 (việc có lịch trong tháng, việc trễ) | KL tháng hiện ở KH tuần; nguồn của KH vật tư tháng |
| 3 | **Kế hoạch → Thi công → Tuần** | KS lập, CHT duyệt (Duyệt KH tuần) | `project_work_plans` (tuần) | Khâu 1 + KL KH tháng để đối chiếu | Nguồn của KH vật tư tuần |
| 4 | **Kế hoạch → Vật tư** (tháng hoặc tuần) | KS lập, CHT duyệt | `project_material_plans` | KH thi công đã duyệt × vật tư BOQ, trừ tồn kho CT | **Mua hàng → Cần mua** |
| 5 | **Mua hàng** (`/procurement`) | Phòng Mua hàng | PO, đợt giao | Khâu 4 (+ Đề xuất vật tư) | Kho nhận hàng; "đã đặt" quay về KH vật tư |
| 6 | **Nhật ký** (lịch tháng) | KS ghi phiếu → người tổng hợp → CHT duyệt | `daily_log_contributions`, `daily_logs` | Danh mục việc của bảng tiến độ | Chế độ chính thức: tiến độ ngày. **Chế độ thí điểm: chỉ đối chiếu, không ghi** |
| 7 | **Chốt tiến độ** | KS/CHT | `project_daily_task_progress` (tiến độ ngày, chốt tuần) | Nhập tay (thí điểm) / Nhật ký (chính thức) | Cột **Thực hiện** và **% đạt** của KH tháng/tuần; % tiến độ trên Gantt |

Điểm then chốt: cột "Thực hiện" của kế hoạch **chỉ đọc từ tiến độ ngày** (`project_daily_task_progress`). Kế hoạch không lưu riêng số thực hiện, nên kế hoạch và thực tế không bị lệch nhau.

## 2. Phần đã chạy đúng (theo code + test)

- **KH tháng/tuần**:
  - Hệ thống gợi ý sẵn việc có lịch trong kỳ, KL gợi ý = phần còn lại chia theo ngày. Có nhắc việc trễ hạn chưa đưa vào kế hoạch.
  - Đủ các thao tác: lưu nháp, gửi (chọn người duyệt), rút về, trả lại (bắt buộc lý do), xóa nháp.
  - Người lập/gửi không tự duyệt được. KH tháng do người có quyền *Duyệt KH tháng* duyệt, KH tuần do CHT (*Duyệt KH tuần*).
  - Có bản điều chỉnh với lý do theo dòng, bên chịu trách nhiệm và văn bản đính kèm. Người duyệt xem được bản so với bản đang áp dụng hoặc bản gốc, kèm tác động vật tư.
  - Luật không sửa lùi: không dời ngày đã qua, KL không thấp hơn phần đã làm. Kỳ đã kết thúc thì chỉ xem.
  - Thông báo mở đúng dự án, tab, kỳ.
- **KH vật tư**:
  - Nhu cầu = KL kế hoạch / KL công việc × vật tư BOQ. SL đề nghị gợi ý = nhu cầu − tồn kho CT. Hiện % đã cấp + đề nghị so với BOQ.
  - Vượt BOQ thì bắt buộc ghi lý do. Có danh sách "việc chưa quy đổi được" kèm nguyên nhân.
  - Duyệt xong thì vào Mua hàng → Cần mua. Khi điều chỉnh, liên kết đơn đã đặt chuyển sang bản mới, tránh đặt trùng (#114).
- **Điều chỉnh lan xuống**: duyệt bản điều chỉnh KH tháng thì KH tuần và KH vật tư liên quan bị đánh dấu "Cần xem lại / Cần tính lại". Người lập chọn *Tạo bản điều chỉnh* hoặc *Giữ nguyên — ghi lý do*.
- **Test tự động**: 83 tệp, 521 test của Kế hoạch, KH vật tư, Nhật ký, Chốt tiến độ, Gantt đều **đạt**.

## 3. Vấn đề phát hiện

| Mức | Vấn đề | Hậu quả thực tế | Đề xuất |
|---|---|---|---|
| **Cao** | **KH vật tư lập được cho cả tháng lẫn tuần, cả hai đều vào "Cần mua"** (`procurement_inbox_lines` lấy mọi KH vật tư đã duyệt, không phân biệt kỳ) | Cùng một vật tư bị đề nghị 2 lần (tháng + từng tuần trong tháng), dễ **mua trùng**. Màn hình không cảnh báo. | Chủ SP chọn **một** cấp đi vào Mua hàng. Gợi ý: KH vật tư **tuần** là đề nghị mua; KH vật tư **tháng** chỉ để dự báo/đặt trước, không vào Cần mua. |
| **Cao** | **SMB/DA29 đang ở chế độ thí điểm Nhật ký**: CHT duyệt nhật ký nhưng **không ghi tiến độ** | Cột *Thực hiện* của KH tháng/tuần trống ("Chưa có số liệu") nếu công trường không nhập thêm ở **Chốt tiến độ**, tức phải nhập 2 nơi. Dòng mô tả trên màn Kế hoạch ("lấy tự động từ Nhật ký") dễ gây hiểu nhầm. | Quyết định một trong hai: (a) chuyển SMB/DA29 sang **chính thức**, Nhật ký là nguồn duy nhất; (b) giữ thí điểm và ghi rõ trong hướng dẫn "nhập Chốt tiến độ hằng ngày". Cần kiểm tra số đối chiếu thí điểm đã khớp chưa (script mục TC12d). |
| Vừa | Nhật ký **không gợi ý việc từ KH tuần đã duyệt**: KS chọn trong toàn bộ danh mục việc | Ghi phiếu chậm. Không biết việc nào làm ngoài kế hoạch, việc nào trong kế hoạch mà không ai làm. | Phiếu KS hiện trước "Việc KH tuần này" và đánh dấu "ngoài kế hoạch". |
| Vừa | **3 đường tạo nhu cầu vật tư song song**: KH vật tư mới; màn cũ *Vật tư → Kế hoạch* (BOQ, vẫn tạo đề xuất được); *Đề xuất vật tư* | Người mới không biết dùng màn nào. Dễ tạo nhu cầu trùng. | Màn cũ được quyết "bỏ sau Đợt 3" (30/09). Đợt 3 đã xong, nên ẩn hoặc chỉ cho xem. |
| Vừa | **Bảng tiến độ (nguồn gốc) không có duyệt**, quyền sửa rộng (SMB ~15 người, gồm cả Mua hàng, kho, kế toán) | Ai đó sửa Gantt thì gợi ý KH và "việc trễ" đổi theo, không có dấu vết trước/sau. | Đợt 2 phiên bản kế hoạch đã duyệt 06/10 nhưng chưa làm. Trước mắt nên cắt quyền sửa Gantt về đúng danh sách người lập. |
| Vừa | **Chưa tự tạo nháp KH vật tư** khi KH thi công được duyệt (đã duyệt 06/10, đợt 1b) | Người dùng phải tự nhớ sang tab Vật tư. | Làm cùng 1b. |
| Thấp | KH tuần lập được khi KH tháng chưa duyệt | Có thể chấp nhận (tuần đầu tháng). Cột "KH tháng" trong gợi ý trống. | Ghi chú trong hướng dẫn. |
| Thấp (dữ liệu) | Định mức/ĐVT BOQ sai ở vài việc (ghi nhận 06/10: SMB "Ốp tường WC" ~1000×, "Vít tôn" 875.880 con; DA29 2.4.4/2.4.5 đảo ĐVT) | KH vật tư sinh số khổng lồ, dòng vượt BOQ đỏ hàng loạt. | QS sửa BOQ trước khi công trường lập KH vật tư. |

## 4. Bộ case test luồng (dữ liệu SMB-2026, kỳ tháng 11/2026, chạy trong giao dịch hoàn tác)

Vai trò: Khôi, Thành = KS (lập/gửi) · Sơn = CHT (duyệt KH tuần, KH vật tư) · Admin Hoàng = duyệt KH tháng.

Lần chạy 1 (08/10, chủ SP chạy, đã hoàn tác):

| Mã | Bước | Kết quả mong đợi | Lần 1 |
|---|---|---|---|
| TC01 | Khôi lập KH tháng 11, 3 việc, lưu nháp | Tạo bản nháp | ✓ |
| TC02 | Khôi gửi duyệt | Chờ duyệt, báo người duyệt tháng | ✓ 1 thông báo → Admin Hoàng |
| TC03 | Khôi tự duyệt | Bị chặn | ✓ APPROVE_DENIED |
| TC04 | CHT Sơn duyệt KH tháng | Bị chặn | ✓ APPROVE_DENIED |
| TC05 | Admin trả lại không lý do / có lý do | Không lý do: chặn; có lý do: "Bị trả lại", báo Khôi | ✓ |
| TC06 | Khôi sửa, gửi lại, Admin duyệt | Đã duyệt (bản gốc) | ✓ |
| TC07 | Thành lập KH tuần 02/11, Sơn duyệt | Gợi ý có KL KH tháng; duyệt; báo Thành | ✓ 162 việc có lịch, trát ngoài KH tháng = 600 |
| TC08 | Sơn tự lập, gửi, tự duyệt KH tuần | Bị chặn | ✓ SELF_APPROVAL_DENIED |
| TC09 | KH vật tư tháng từ KH tháng → gửi → Thành tự duyệt → Sơn duyệt | Có dòng; tự duyệt bị chặn; duyệt OK | ✓ 5 vật tư (4 có SL đề nghị), 0 việc chưa quy đổi |
| TC10 | Mua hàng → Cần mua | Có dòng từ KH vật tư tháng | Lỗi script (sai tên cột) → đã sửa, chạy lại |
| TC11 | KH vật tư tuần 02/11 | Kiểm tra trùng với tháng | Lần 1: SL gợi ý = 0 vì tồn kho CT đủ cho KL tuần nhỏ, nên "rỗng". **Đã sửa script**: KS tự nhập SL, một dòng vượt BOQ để thử chốt chặn |
| TC12 | Ghi tiến độ ngày 03/11 (+80) cho việc T1 | Thực hiện = 80 ở KH tháng và tuần | ✓ trước 0 → sau 80 / 80. **SMB: Nhật ký ở chế độ `pilot` từ 01/10** |
| TC13 | Bản điều chỉnh KH tháng (trát ngoài 600 → 800), Admin duyệt | Bản 1 "Đã thay", bản 2 duyệt; tuần + vật tư bị đánh dấu; có thông báo | ✓ 3 thông báo xem lại |
| TC14 | Người ngoài Room *Kế hoạch* mở KH | Bị chặn | ✓ VIEW_DENIED |
| TC15 | CHT mở lịch Nhật ký tháng 10 | Đọc được | ✓ nhưng **chỉ 1 ngày có phiếu/bản tổng hợp** từ 01/10 tới 08/10 |

Lần chạy 2 (08/10, script đã sửa, **chưa** nạp migration — đúng như production hiện tại):
- TC10 ✓: Cần mua nhận 4 dòng từ KH vật tư tháng.
- TC11a: KL tuần nhỏ (cát 5,994, xi măng 1,566) nên tồn kho CT đủ, SL gợi ý = 0.
- TC11b ✓: dòng vượt BOQ chưa ghi lý do thì gửi bị chặn (`MATERIAL_PLAN_OVER_BOQ_REASON_REQUIRED`).
- TC11 ✗ **xác nhận lỗi trùng**: "Cát xây, trát" có ở Cần mua từ cả KH tháng lẫn KH tuần. SL tuần lớn vì script cố ý cho vượt BOQ.
- Các case khác giống lần 1.

Lần chạy 3 (08/10, **có nạp thử migration** `--migration`, đã hoàn tác):
- TC10 ✓ 0 dòng: KH vật tư tháng không còn vào Cần mua.
- TC11 ✓ 0 vật tư trùng.
- Các case khác không đổi, migration không làm hỏng luồng nào.
- Script đã thêm TC11e in số dòng KH tuần trong Cần mua, cho lần chạy sau.

Ghi chú TC11: theo code (`material_plan_fill_lines`, `procurement_inbox_lines`), SL gợi ý chỉ trừ **tồn kho**. Không trừ phần KH tháng đã đề nghị, không trừ hàng đã đặt chưa về. Cần mua cũng lấy mọi KH vật tư đã duyệt. Lần chạy 2 sẽ xác nhận con số trùng cụ thể.

Chạy:
```
node docs/audits/project-planning-2026-10-08/tools/flow-test.mjs
```
Mỗi dòng in ra `## <mã> → <kết quả>`. Các dòng `LỖI …` ở TC03, TC04, TC05a, TC08c, TC09e, TC11b, TC14 là **đúng mong đợi** (bị chặn).

Phát hiện thêm từ lần chạy 1: Nhật ký SMB gần như chưa được dùng (1 ngày trong 8 ngày đầu tháng 10). Kế hoạch có thực hiện hay không phụ thuộc Chốt tiến độ.

## 5. Quyết định của chủ SP (08/10/2026) và cách làm

1. **Chỉ KH vật tư tuần vào Mua hàng.** Migration `20261009150000_material_plan_week_to_procurement.sql`: Cần mua chỉ nhận KH vật tư tuần. KH vật tư tháng là dự báo; bản tháng đã có đơn đặt vẫn hiện để không mất dấu. Màn Kế hoạch → Vật tư có dòng giải thích theo kỳ. Chạy thử: `flow-test.mjs --migration`.
2. **Nhật ký SMB/DA29 chuyển chính thức.** Script `tools/daily-log-enforce.mjs`, mặc định chạy thử, `--commit` mới ghi. Chốt an toàn của hệ thống: mọi bản tổng hợp chờ duyệt phải có số đối chiếu thí điểm khớp. Sau khi chuyển: CHT duyệt nhật ký là công bố tiến độ ngày; Chốt tiến độ ngày từ 01/10 chỉ đọc (chốt tuần, khóa kỳ vẫn làm).
   Chạy thử 08/10: **CHƯA ĐẠT** (`PILOT_SHADOW_UNRESOLVED`). Mỗi dự án có 1 bản tổng hợp chờ duyệt và 2 lần đối chiếu đều lệch.
   "Lệch" nghĩa là số nhật ký khác số Chốt tiến độ của cùng ngày. Chốt an toàn đòi hai nơi khớp nhau trước khi chuyển, mâu thuẫn với quyết định bỏ nhập hai nơi.
   Chi tiết lệch: bản tổng hợp **01/10** (SMB 6 việc, DA29 1 việc) **không có số khối lượng**, chờ duyệt 8 ngày. Thử cho CHT duyệt sau khi chuyển: **bị chặn** `STALE_PROGRESS_BASELINE`, vì số tiến độ nền trước 01/10 đã bị sửa ở Chốt tiến độ.
   Phương án: `--override-gate`, có ghi vết. Mốc chính thức **09/10/2026**, không phải 01/10.
   - Đến hết 08/10: vẫn nhập, sửa ở Chốt tiến độ (bù các ngày 01–08/10).
   - Từ 09/10: Nhật ký là nguồn duy nhất; CHT duyệt nhật ký là công bố tiến độ.
   - Bản 01/10: CHT **trả lại**, vì nó nằm trước mốc nên không công bố được nữa.
   **ĐÃ GHI production 08/10/2026** (chủ SP chạy `--override-gate --commit`): SMB-2026 và DA29 chính thức từ 09/10.
   Dự phòng: `tools/daily-log-back-to-pilot.mjs` (chạy thử mặc định, `--commit` để ghi, `--only=SMB-2026|DA29`).
   Theo dõi lần công bố thật đầu tiên ngày 09/10: chế độ chính thức chưa từng chạy trên production.
3. **Ẩn màn cũ Vật tư → Kế hoạch.** Bỏ khỏi thanh tab Vật tư. Liên kết cũ (lệnh nhanh, nút tắt, truy vết chứng từ) chuyển sang Kế hoạch → Vật tư (tuần). Code màn cũ còn trong `MaterialTab.tsx`, xóa ở đợt dọn sau.
