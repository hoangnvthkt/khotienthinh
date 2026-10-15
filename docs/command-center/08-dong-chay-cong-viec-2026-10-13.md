# Dòng chảy công việc — mô hình điều hành trực quan cho Ban lãnh đạo (13/10/2026)

Trạng thái: chủ SP **đồng ý cả 9 câu** (13/10) → **PR-1 #183** (mục 10) và **PR-2 #186** (mục 11) **lên production + merged 13/10** → **PR-3 danh sách phiếu + Nhắc đã code** (mục 12), chờ duyệt deploy migration + merge. Quyền `center.flow.view` đã cấp cho 5 người Ban lãnh đạo 13/10. Bản xem thử v0 ở mục 8.

Tệp đi kèm:

- Bản xem thử: `mockups/flow-map-v0.html` (mở trực tiếp, không cần build; ảnh `mockups/flow-map-v0-*.png`).
- Số liệu thật và cách đọc: `evidence/2026-10-13-dong-chay-so-lieu.md`.

## 0. Kết luận ngắn

1. **Làm được, và dữ liệu đã có sẵn phần lớn.** Mỗi lần hệ thống giao một bước cho một người đều ghi lại: ai giao, ai nhận, lúc nào, hạn, xử lý lúc nào, kết quả. Riêng Quy trình và Đề xuất 90 ngày qua có 366 lượt như vậy. 18 nguồn việc khác (đơn hàng, phiếu kho, nhật ký, đề nghị chi, nghỉ phép, văn bản…) đã được gom trong hàm "Việc của tôi" của Trung tâm điều hành; chỉ cần mở rộng từ "tôi" ra "cả công ty" theo quyền.
2. **Đề xuất một tab "Dòng chảy công việc" trong Trung tâm điều hành**, cạnh Hôm nay và Bảng điều khiển. Một màn, bốn lớp: dải chỉ số → sơ đồ (ba cách nhìn: Dòng chảy, Bản đồ, Xếp hạng) → ngăn Điểm nghẽn → hồ sơ thật. Mọi con số bấm được và mở đúng danh sách phiếu, giống hợp đồng drill-down của đợt 0.
3. **2D trước, 3D sau.** 2D là công cụ làm việc hằng ngày: đọc được số, chạy trên điện thoại, an toàn với WebKit. 3D làm "chế độ trình chiếu" cho TV phòng họp ở đợt 3, tái dùng khung Sơ đồ 3D tổ chức đã có sẵn ở `/org-map`.
4. **"Realtime" theo cách rẻ:** máy chủ chụp số liệu mỗi phút, màn tự làm mới khi đang mở. Không cần đẩy từng phiếu qua websocket.
5. Bản xem thử lộ ra **ba lỗ hổng dữ liệu** phải sửa song song, nếu không sơ đồ sẽ sai: 44/87 nhân viên chưa gắn phòng ban; 21/42 việc đang chờ đã quá 30 ngày (phiếu "chết" từ tháng 6); 66% thông báo không gắn module.

## 1. Người dùng và câu hỏi phải trả lời trong 5 giây

| Người | Vào màn để | Nhìn thấy đầu tiên | Hành động chính |
|---|---|---|---|
| TGĐ, Ban lãnh đạo | Biết công ty đang tắc ở đâu, ai đang giữ nhiều việc | Dải chỉ số (đang chờ, đứng yên, quá hạn) và vạch đỏ trên sơ đồ | Bấm điểm đỏ → thấy người và phiếu → Nhắc hoặc giao lại |
| Trưởng phòng | Phòng mình nhận bao nhiêu, từ đâu, ai đang giữ | Ngăn phòng: đang chờ / đứng yên / quá hạn, trao đổi với phòng khác | Mở N việc đang chờ, Nhắc cả phòng |
| Giám đốc dự án, chỉ huy trưởng | Đề xuất từ công trường đang nằm ở đâu | Bản đồ: công trường → phòng, số đề xuất đã duyệt mà chưa cấp | Mở đề xuất, xem Mua hàng |
| HR, Admin | Dữ liệu thiếu làm sơ đồ sai | Ô "Chưa gắn phòng ban" xám nét đứt | Gắn phòng, dọn phiếu chết |

Màn này không thay module nghiệp vụ. Nó chỉ trả lời "ở đâu, bao nhiêu, bao lâu, ai", rồi mở đúng màn gốc trong tab của Trung tâm.

## 2. "Một dòng chảy" là gì

Một dòng = một lần việc rời tay người này sang tay người khác (hoặc sang một nhóm, một phòng):

| Trường | Ý nghĩa | Lấy từ đâu hôm nay |
|---|---|---|
| Nguồn | module, loại phiếu, mã phiếu, tiêu đề | 19 nguồn của `vcc_my_work_items_v1` |
| Người gửi + phòng | ai đẩy việc đi | `assigned_by` → `employees.org_unit_id` |
| Người nhận (hoặc nhóm) + phòng | ai phải xử lý | `assignee_user_id`, `assignment_group_*` |
| Dự án / công trường | phạm vi | `project_id`, `construction_site_id`, form_data |
| Lúc gửi, hạn | `assigned_at`, `due_at` (SLA từ mẫu quy trình) | có ở 72% lượt |
| Lúc xử lý, kết quả | `acted_at`, `status`: xong / trả lại / từ chối / bỏ qua / hủy | có |
| Hành động cần | duyệt, làm, xác nhận, nhận hàng, ghi sổ | nhóm `action` sẵn có của Center |

Trạng thái của một dòng: **Đang chờ** → **Đứng yên** (chờ quá ngưỡng mà chưa ai đụng) → **Quá hạn** (qua SLA) → kết thúc bằng **Xong / Trả lại / Từ chối / Bỏ qua / Hủy**. **Chưa giao người** là trạng thái lỗi, luôn hiện đỏ.

### Nguồn dữ liệu có sẵn và chỗ thiếu

| Nguồn | Bảng | Đã có | Còn thiếu |
|---|---|---|---|
| Quy trình, Đề xuất, cấp vật tư công trường | `workflow_step_assignments` | đủ: người giao, người nhận, lúc giao, hạn, SLA, lúc xử lý, kết quả, nhóm | 28% lượt chưa có SLA |
| 18 nguồn khác (đơn hàng, đợt giao, phiếu kho, nhật ký, kế hoạch tuần, mua nóng, đề nghị chi, quỹ công trường, nghỉ phép, chấm công bù, điều động, chốt công, hồ sơ NS, văn bản, Vioo Work, đặt xe, kiểm kê, đối chiếu) | RPC `vcc_my_work_items_v1` | ai đang chờ, mã, hạn, nhóm hành động | chỉ trả cho "tôi"; cần bản "cả công ty" theo quyền; thời điểm giao của vài nguồn phải suy từ log |
| Lịch sử đã xong | `workflow_instance_logs`, `material_request_events`, `office_document_approvals`, `hrm_leave_logs`, `audit_trail` | ai làm gì, lúc nào | không đồng nhất giữa module; để đợt 2 |
| Thông tin (không phải việc) | `notifications` | gửi ai, đã đọc chưa | 66% không có `module` |
| Phòng ban, công trường | `org_units`, `employees.org_unit_id`, `linked_construction_site_id` | cây phòng ban | 44/87 nhân viên chưa gắn phòng |

### Số thật 13/10 (90 ngày, chỉ Quy trình và Đề xuất)

| Chỉ số | Giá trị |
|---|---|
| Lượt giao bước xử lý | 366 (282 duyệt, 28 đang chờ, 22 bỏ qua, 17 hủy, 12 trả lại, 5 từ chối) |
| Trung vị giao → xử lý | 19,5 giờ (trung bình 56,5 giờ: ít phiếu kéo rất dài) |
| Đang chờ hôm nay | 42, trong đó 31 đứng yên > 3 ngày, 21 chờ > 30 ngày, 14 quá SLA |
| Ùn ở người | 5 người giữ 5–6 việc; việc cũ nhất từ 04/06 |
| Dòng lớn nhất giữa phòng | Quản lý dự án → Vật tư - Thiết bị: 60 lượt; nội bộ Quản lý dự án: 155 |
| Dòng không biết phòng | 44 lượt gửi và 26 lượt nhận rơi vào "chưa gắn phòng" |
| Đề xuất vật tư đã duyệt chưa cấp | Sơn Miền Bắc 30 (trung bình 53,5 ngày), Thú nhồi bông GĐ2 21 (37,8 ngày) |
| Thông báo chưa đọc > 7 ngày | 1.111 ở 34 người |

Bảng đầy đủ ở `evidence/2026-10-13-dong-chay-so-lieu.md`.

## 3. Thiết kế màn hình

### 3.1 Bố cục (desktop 1440)

1. Header của Trung tâm, tab "Dòng chảy công việc" cạnh Hôm nay và Bảng điều khiển.
2. Thanh công cụ: tiêu đề + "Số liệu lúc … · tự cập nhật mỗi phút"; chọn khoảng 7 / 30 / 90 ngày; chọn dự án; chọn phòng ban; nút Chuyển động (mặc định tắt).
3. Chip nguồn có số đang chờ (Quy trình & Đề xuất 42 · Đề xuất vật tư 15 · Đơn hàng 32 · Phiếu kho 23 …). Bật/tắt chip để lọc sơ đồ.
4. Dải 6 chỉ số bấm được: Đang chờ · Đứng yên > 3 ngày · Quá hạn SLA · Trung vị xử lý · Trả lại / từ chối · Lượt giao 30 ngày (có đường xu hướng).
5. Vùng sơ đồ với ba cách nhìn (3.2). Bên phải ngăn 360px "Điểm nghẽn hôm nay", đổi nội dung theo thứ đang chọn (3.3).

### 3.2 Ba cách nhìn trong cùng một vùng

| Cách nhìn | Vẽ gì | Trả lời câu hỏi |
|---|---|---|
| **Dòng chảy** (Sankey ba cột: Nơi phát sinh → Nơi xử lý → Kết quả) | Độ rộng dải = số lượt; màu dải = kết quả (xanh thép xong, cam đang chờ, tím trả lại, đỏ từ chối, xám bỏ qua / hủy); vạch đỏ cạnh phòng = việc đứng yên hôm nay | Việc từ đâu đến đâu, kết cục ra sao, dải nào đang kẹt |
| **Bản đồ** | Công trường bên trái, phòng ban ở vị trí cố định (ngày nào cũng giống nhau); mũi tên to nhỏ theo lượt giao; vòng tròn ghi số người; huy hiệu đỏ = đang chờ; vòng đỏ quanh = phần đứng yên; nét đứt cam = đề xuất vật tư từ công trường | Công ty đang tắc ở ô nào; công trường nào bị bỏ đói |
| **Xếp hạng** | Nhận nhiều việc nhất; xử lý nhanh nhất; chậm nhất; tạo nhiều phiếu nhất (chỉ xếp người có từ 10 lượt) | Ai gánh nhiều, ai làm tốt, ai cần hỗ trợ |

Sơ đồ chỉ hiện phòng ban và kết quả; **người** và **phiếu** nằm ở ngăn bên phải (progressive disclosure), tránh rối.

### 3.3 Ngăn bên phải theo ngữ cảnh

| Đang chọn | Ngăn hiện | Nút cuối ngăn |
|---|---|---|
| Không chọn gì | Điểm nghẽn hôm nay: ùn ở người (top 5), tuổi của việc đang chờ, theo loại phiếu, thông tin gửi đi chưa được đọc | Xem cả danh sách |
| Một phòng | Số người; đang chờ / đứng yên / quá hạn; nhận / giao đi / nội bộ 90 ngày; trao đổi với phòng khác; người đang giữ việc | Mở N việc đang chờ · Nhắc cả phòng |
| Một dải | Từ → đến, số lượt, trung vị, % đúng hạn, loại phiếu chạy trên dải | Mở danh sách phiếu |
| Một kết quả | Đang chờ → tuổi việc + ùn ở người; Trả lại → số phiếu bị trả, trả nhiều lần; Đã duyệt → phân phối thời gian | Mở danh sách |
| Một công trường | Đề xuất chờ duyệt / đã duyệt chờ cấp / đang chuyển; thời gian chờ cấp | Mở đề xuất · Xem Mua hàng |
| Một ô chỉ số | Danh sách tương ứng, chia theo phòng và người | Mở danh sách |

Mỗi dòng người có hai nút: **Nhắc** (thông báo trong app + Zalo, có nhật ký) và **Xem** (mở danh sách việc của người đó thành tab).

### 3.4 Hợp đồng drill-down

Giữ nguyên luật của đợt 0: mọi con số có đích mở được, test đếm dòng khớp với con số; mở hồ sơ bằng tab của Trung tâm, không rời trang; không che dữ liệu chưa biết bằng 0 (hiện "—" kèm lý do).

### 3.5 Tablet và điện thoại

- Tablet 820: một cột, ngăn chi tiết nằm dưới sơ đồ, sơ đồ vẫn là Sankey.
- Điện thoại 390: dải chỉ số và chip cuộn ngang; **Sankey thay bằng thanh theo phòng** (nhận 90 ngày, đang chờ, đứng yên) vì dải quá nhỏ để đọc; Bản đồ chỉ xem; Xếp hạng xếp dọc; ngăn chi tiết mở dưới và tự cuộn tới.

### 3.6 Trạng thái

Loading: khung xương sơ đồ. Lỗi / không quyền: `StateBox`. Phòng chưa gắn: ô xám nét đứt có nhãn "lỗ hổng dữ liệu", không ẩn. Nguồn chưa nối: chip mờ với nhãn "đợt 1", bấm vào giải thích. Việc đứng yên: nhấp nháy nhẹ bằng opacity, tắt theo prefers-reduced-motion.

## 4. Quy tắc phát hiện điểm nghẽn và chỉ số

Ngưỡng là cấu hình ở Thiết lập, dưới đây là đề xuất ban đầu.

| Tên | Định nghĩa | Ngưỡng | Hiện |
|---|---|---|---|
| Đứng yên | việc chờ quá ngưỡng mà chưa ai mở / ghi chú | 3 ngày làm việc | đỏ |
| Quá hạn | qua `due_at` (SLA của mẫu) | theo mẫu; mẫu chưa đặt → mặc định 48 giờ (câu 4) | đỏ |
| Ùn ở người | một người giữ từ N việc chờ | 5 | huy hiệu đỏ |
| Ùn ở phòng | việc chờ của phòng vượt 2 lần trung vị 30 ngày của chính phòng đó | ×2 | cam |
| Chưa giao người | phiếu chờ mà không có người xử lý | 0 | đỏ nhấp nháy |
| Vòng lặp | phiếu bị trả lại từ 2 lần | 2 | tím |
| Phiếu chết | chờ quá 30 ngày | 30 ngày | đỏ xám, gợi ý Dọn việc cũ |
| Thông tin chưa đọc | thông báo quá 7 ngày chưa đọc | 7 ngày | cam |

Chỉ số khối lượng và hiệu quả theo phòng và theo người: lượt nhận, lượt xong, trung vị giờ, % đúng hạn, % trả lại, đang giữ. "Hoàn thành tốt nhất" = % đúng hạn cao và trung vị thấp, tối thiểu 10 lượt.

Lưu ý công bằng: hôm nay một lượt duyệt 1 phút và một bước nhận hàng cả ngày được đếm như nhau. Cần **trọng số theo loại phiếu** trước khi công bố "tốt nhất / chậm nhất" (câu 5).

## 5. 2D hay 3D

| Tiêu chí | 2D (SVG, có thể Canvas) | 3D (three.js, khung `/org-map` sẵn có) |
|---|---|---|
| Đọc số, so độ rộng dải | tốt | kém vì phối cảnh làm méo |
| Điện thoại, iPad của Ban lãnh đạo | tốt | nặng; iOS cũ rủi ro |
| WebKit, CPU khi trang đứng yên (bài học PR #117) | kiểm soát được | GPU chạy liên tục |
| Bấm, drill-down, chữ | tự nhiên | cần raycast, chữ nhỏ, khó chạm |
| Ấn tượng khi trình chiếu | vừa | cao |
| Công | 2–3 PR | thêm 2–3 PR sau khi 2D đúng số |

Đề xuất: **2D là bản chính**. 3D là "chế độ trình chiếu" ở đợt 3: tái dùng Scene3D (phòng ban = phòng trong toà nhà, công trường = nhánh), dòng chảy = hạt chạy giữa các phòng, điểm nghẽn = phòng đỏ; chỉ bật trên desktop / TV, tự tắt trên điện thoại, và chỉ sau khi 2D đã chứng minh số đúng.

## 6. Kỹ thuật

- **Máy chủ:** RPC `vcc_flow_v1(p_range, p_project, p_unit, p_sources)` trả `{as_of, nodes, links, outcomes, waiting, people, gaps}`. Nguồn đợt 1 = `workflow_step_assignments` (366 dòng / 90 ngày, tính trực tiếp đủ nhanh) + phần "đang chờ" của 18 nguồn qua `vcc_my_work_items_v1` mở rộng `p_scope = 'company'`. Khi nhiều nguồn: bảng chụp `vcc_flow_snapshot` làm mới mỗi phút bằng pg_cron; màn đọc bản chụp, không tính lại.
- **Làm mới:** màn gọi lại mỗi 60 giây khi tab đang hiện (`visibilitychange`), có nút Cập nhật; không dùng Supabase Realtime ở đợt 1.
- **Quyền (quyết định ở máy chủ, như `cdb_*` của Bảng điều khiển):** Admin và mẫu quyền Ban lãnh đạo xem toàn công ty; trưởng phòng xem phòng mình và dòng vào / ra; giám đốc dự án xem dự án mình; người khác không có tab.
- **Riêng tư:** tên người ở Xếp hạng chỉ cho Ban lãnh đạo và trưởng phòng; nhân viên thấy số của phòng và của chính mình (câu 6).
- **Giao diện:** SVG thuần trong React, không thêm thư viện (nếu cần `d3-sankey` ~10 KB); animation lặp chỉ opacity / transform; hạt chạy trên dải mặc định tắt, đo WebKit trước khi mở; kiểm 3 khổ 1440 / 820 / 390 và `mobile-safari`.
- **Drill-down:** tái dùng DrillLink, WorkItemTab, nhóm hành động và mã dễ đọc của Center.
- **Nhắc:** ghi `notifications` + Zalo như nhắc chấm công, có nhật ký ai nhắc ai lúc nào; không gửi hàng loạt không xác nhận.

## 7. Lộ trình

| Đợt | Nội dung | Kết quả thấy được |
|---|---|---|
| **1** (3 PR) | PR-1: RPC `vcc_flow_v1` + smoke + rollback. PR-2: tab Dòng chảy với Sankey, dải chỉ số, ngăn Điểm nghẽn, chip nguồn, ba khổ màn. PR-3: drill mở phiếu, nút Nhắc, và sửa ba lỗ hổng dữ liệu (HR gắn phòng, thông báo gắn module, liệt kê phiếu chết để dọn) | Ban lãnh đạo thấy tắc ở đâu, bấm ra đúng phiếu |
| **2** | Bản đồ + lọc theo dự án; Xếp hạng có trọng số; Chuyển người xử lý và Dọn việc cũ (có lý do, nhật ký); lịch sử 7 / 30 / 90 từ log; tua lại theo ngày; thống kê lý do trả lại | Xử lý được ngay trên màn, so được tuần này với tuần trước |
| **3** | Chế độ trình chiếu 3D cho TV phòng họp; AI tóm tắt "3 điểm nghẽn hôm nay" theo lộ trình A0–A4 | Dùng trong họp giao ban |

Không hứa thời gian; mỗi PR có smoke rollback trên Cloud, Playwright ba khổ, và đo WebKit nếu có chuyển động.

## 8. Bản xem thử v0

- Mở `mockups/flow-map-v0.html` bằng trình duyệt (hoặc launch `flow-mockup` cổng 5190). Thử: bấm phòng, bấm dải, bấm kết quả, bấm ô chỉ số, chuyển Bản đồ / Xếp hạng, chọn công trường, bật Chuyển động, nút ◐ sáng / tối, thu nhỏ cửa sổ xuống 390 để xem bản điện thoại.
- **Số thật:** lượt giao phòng → phòng, tổng kết quả, đang chờ theo phòng và theo người, tuổi việc, loại phiếu, người xử lý, người tạo, đề xuất vật tư theo công trường, thông báo chưa đọc, nhịp 30 ngày.
- **Ước lượng để vẽ:** cột Kết quả chia theo từng phòng (tổng mỗi kết quả là thật, chia theo phòng là tỷ lệ); trung vị và % đúng hạn trên từng dải (hiện "—", đợt 1 tính); người giữ việc trong vài phòng (bản xem thử chưa gắn hết).
- Ảnh: `flow-map-v0-desktop.png`, `flow-map-v0-ban-do.png`, `flow-map-v0-xep-hang.png`, `flow-map-v0-phong-vat-tu.png`, `flow-map-v0-mobile.png`.

## 9. Câu hỏi cần anh chốt

1. **Vị trí:** tab "Dòng chảy công việc" trong Trung tâm điều hành (em đề xuất), hay một bảng thứ năm trong Bảng điều khiển?
2. **Ai được xem:** toàn công ty = Admin + mẫu Ban lãnh đạo; trưởng phòng = phòng mình; giám đốc dự án = dự án mình; người khác không thấy tab. Đồng ý?
3. **Ngưỡng ban đầu:** đứng yên 3 ngày làm việc; ùn ở người 5 việc; phiếu chết 30 ngày; thông tin chưa đọc 7 ngày. Chỉnh được ở Thiết lập.
4. **SLA mặc định 48 giờ** cho mẫu quy trình chưa đặt SLA (28% lượt), hay bắt buộc đặt SLA khi tạo mẫu?
5. **Xếp hạng người:** đợt 1 chỉ hiện trung vị và % đúng hạn, chưa gắn nhãn "tốt nhất / chậm nhất" cho tới khi có trọng số theo loại phiếu. Anh muốn trọng số do ai đặt (Admin theo mẫu quy trình)?
6. **Tên người** ở Xếp hạng và Ùn ở người: chỉ Ban lãnh đạo + trưởng phòng thấy; nhân viên thấy số phòng và số của mình. Đồng ý?
7. **Làm mới mỗi phút** khi đang mở (em đề xuất) hay bấm Cập nhật như Bảng điều khiển?
8. **Ba lỗ hổng dữ liệu:** (a) HR gắn phòng cho 44 người, gộp với việc H2 rà soát 38 người; (b) em liệt kê 21 phiếu chết để người duyệt hủy / bỏ qua có lý do; (c) sửa nơi phát thông báo để gắn module. Làm song song đợt 1?
9. **3D:** để đợt 3 như đề xuất, hay anh muốn một bản xem thử 3D sớm để quyết?

## 10. PR-1 — hàm máy chủ `vcc_flow_v1` (13/10/2026)

Tệp: `supabase/migrations/20261013141500_center_flow_v1.sql` · smoke `supabase/tests/center_flow_v1_smoke.sql` · gỡ `supabase/tests/center_flow_v1_rollback.sql`
· cấp quyền Ban lãnh đạo `supabase/tests/center_flow_v1_grant_executive.sql` (mặc định ROLLBACK) · trình duyệt `lib/center/centerFlowService.ts` (kiểu + bộ đọc, test).

Một hàm đọc, một lần gọi, trả JSON ~38 KB:

| Khối | Nguồn | Ghi chú |
|---|---|---|
| `links`, `outcomes`, `unitOutcomes`, `people`, `creators`, `daily` | `workflow_step_assignments` + `work_task_assignments` trong 7 / 30 / 90 ngày | kết quả theo từng phòng là **số thật** (bản xem thử phải ước lượng); trung vị giờ, % đúng hạn theo người |
| `waiting` | 19 nguồn "đang chờ hôm nay" (quy trình, đề xuất vật tư, phiếu kho, nhật ký, kế hoạch tuần, đơn hàng, đợt giao, mua nóng, đề nghị chi, quỹ công trường, nghỉ phép, chấm công bù, điều động, chốt công, hồ sơ NS, văn bản, Vioo Work, đặt xe, kiểm kê, đối chiếu) | đề xuất vật tư đã có bước quy trình đang chờ chỉ đếm ở quy trình (12/15 phiếu hôm nay); việc chờ một vai (HR, Kế toán, Thủ kho, Văn thư) ghi `byRole`, không tính là "chưa giao người" |
| `projects` | `requests` theo dự án + việc chờ theo dự án | chỉ dự án trong phạm vi Bảng điều khiển (`cdb_in_scope`) |
| `notifications` | 30 ngày: tổng, chưa đọc, chưa đọc > 7 ngày, số người, thiếu module | chỉ phạm vi toàn công ty |
| `gaps` | nhân viên chưa gắn phòng, lượt giao chưa có SLA, phòng chưa có trưởng phòng | hiện thẳng trên màn, không giấu |
| `thresholds` | đứng yên > 3 ngày làm việc (tuần 6 ngày), ùn ở người ≥ 5, phiếu chết > 30 ngày, chưa đọc > 7 ngày, SLA mặc định 48 giờ | hằng số trong hàm ở đợt 1; Thiết lập ở đợt 2 |

Quyền, quyết định ở máy chủ (câu 2): toàn công ty = Admin hoặc `center.flow.view` (mẫu "Ban giám đốc" đã có quyền này; người đã áp mẫu cấp bằng script hoặc màn Phân quyền);
phòng mình + phòng con = người giữ slot trưởng phòng (`org_units.manager_slot_id`); dự án mình = giám đốc dự án hoặc Room duyệt nhật ký / phân công / đề xuất vật tư.
Lọc phòng / dự án ngoài phạm vi → `42501 FLOW_SCOPE_DENIED`; không thuộc bậc nào → `{access:false}` để giao diện ẩn tab. Hôm nay chỉ 2/17 phòng có trưởng phòng gắn slot (`gaps.unitsWithoutManager`) — HR cần gắn để trưởng phòng tự xem.

Hiệu năng (câu 7, làm mới mỗi phút): 2 tập dữ liệu dựng một lần bằng CTE materialized rồi mọi số đếm đọc trong bộ nhớ; thêm 2 chỉ mục
(`assigned_at`, `PENDING`; `employees.user_id` đã có sẵn trên production). Đo trên Cloud với dữ liệu thật + dữ liệu mẫu: **toàn công ty 56 ms, một phòng 41 ms, JSON 38.656 byte**.
Không trả danh sách phiếu (PR-3 có hàm theo trang).

Smoke (giao dịch rollback trên Cloud, đạt 13/10): 6 vai (Admin, quyền toàn công ty, trưởng phòng, giám đốc dự án, vào Center không bậc nào, không vào Center);
đứng yên / quá hạn / SLA mặc định / phiếu chết / chưa giao người / trả lại; loại trùng đề xuất vật tư; 7 ngày và khoảng lạ; lọc ngoài phạm vi bị chặn; ngày làm việc tuần 5 / 6.

Chạy lại: `node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe --migration supabase/migrations/20261013141500_center_flow_v1.sql --smoke supabase/tests/center_flow_v1_smoke.sql` (nạp `.env` gốc trước).

Sau khi lên production: bỏ `center.flow.view` khỏi `FRONTEND_AHEAD_OF_DB` trong `lib/permissions/__tests__/permissionCatalogContract.test.ts` và làm mới fixture
(`scripts/authorization-v2/export-permission-catalog.mjs`); chạy `center_flow_v1_grant_executive.sql` (COMMIT) để cấp cho 5 người Ban lãnh đạo.

Tiếp: PR-2 tab "Dòng chảy công việc" trong Trung tâm (Sankey, dải chỉ số, ngăn Điểm nghẽn, chip nguồn, 3 khổ màn, làm mới mỗi phút).

## 11. PR-2 — tab "Dòng chảy công việc" trong Trung tâm điều hành (13/10/2026)

Tệp: `components/flow/FlowView.tsx` (màn), `FlowSankey.tsx` (SVG thuần, không thư viện), `FlowPanel.tsx` (ngăn Điểm nghẽn), `flow.css`;
`lib/center/flowModel.ts` (bố cục dải, nhãn, bảng bấm xuống, thanh điện thoại — thuần, có test); nối `CenterShell` / `CenterPage`;
fixture `tests/center/flowFixture.ts`, Playwright `tests/e2e/center-shell.spec.ts` (3 khổ) + `center-idle.spec.ts` (WebKit đứng yên).

| Lớp | Có gì | Bấm vào → |
|---|---|---|
| Thanh công cụ | 7 / 30 / 90 ngày · chọn phòng (toàn công ty hoặc phòng mình quản lý) · chọn dự án · Cập nhật · "Số liệu lúc … · tự cập nhật mỗi phút khi đang mở" · chip phạm vi khi là trưởng phòng / giám đốc dự án | lọc gọi lại máy chủ (`p_range_days`, `p_unit_id`, `p_project_id`), số cũ vẫn hiện trong lúc chờ |
| Chip nguồn | 19 nguồn đang chờ: số đang chờ (xanh) · đứng yên (đỏ) | ngăn "theo loại phiếu" của nguồn đó |
| 6 ô chỉ số | Đang chờ · Đứng yên > 3 ngày · Quá hạn · Trung vị xử lý · Trả lại / từ chối · Lượt giao 30 ngày (đường xu hướng) | ngăn bấm xuống của Bảng điều khiển (DrillDrawer): theo phòng / theo người / kết quả / theo ngày, có dòng Tổng |
| Sơ đồ dải | 3 cột Nơi phát sinh → Nơi xử lý → Kết quả, **kết quả theo từng phòng là số thật** (`unitOutcomes`); vạch đỏ cạnh phòng = phần đứng yên hôm nay; phòng "Chưa gắn phòng ban" vẽ xám nét đứt | phòng → ngăn phòng; dải → ngăn dải; kết quả → ngăn kết quả |
| Người xử lý | bảng: nhận, xong, trung vị, % đúng hạn, trả lại, đang giữ — **không** gắn nhãn tốt nhất / chậm nhất (câu 5) | |
| Ngăn Điểm nghẽn | ùn ở người (huy hiệu "ùn" từ 5 việc), tuổi việc, chưa giao người / phiếu chết / quá SLA mặc định, theo loại phiếu, chờ một vai, thông báo chưa đọc (toàn công ty), lỗ hổng dữ liệu | ngăn phòng: đang chờ / đứng yên / quá hạn, nhận / giao đi / nội bộ, kết quả, trao đổi với phòng khác, người đang giữ việc |
| Điện thoại | ô chỉ số và chip cuộn ngang; sơ đồ dải thay bằng **thanh theo phòng**; ngăn nằm dưới | |

Làm mới mỗi phút (câu 7): một `setTimeout` 60 giây chỉ khi tab Dòng chảy đang hiện và cửa sổ đang mở; tab ẩn hoặc cửa sổ ẩn thì không hẹn gì; không Realtime, không interval.
Tab chỉ hiện khi `vcc_flow_v1(p_access_only)` trả có phạm vi; `/center?view=flow` mở thẳng tab.

Kiểm (13/10): tsc, vitest 103 test Center (gồm 12 test `flowModel`), Playwright desktop 1440 / tablet 820 / iPhone WebKit: tab, 6 ô, chip, chọn phòng → ngăn,
bấm xuống → dòng Tổng, đổi 30 ngày → gọi lại máy chủ, Người xử lý, trang đứng yên không animation; không có tab khi không có phạm vi; cập nhật lỗi vẫn giữ số cũ;
trưởng phòng chỉ thấy phòng mình. WebKit đứng yên: 0 timer / animation / thay đổi DOM trong 10 giây ở cả sơ đồ dải (820) và thanh (390).
Ảnh: `evidence/2026-10-13-flow-tab-{desktop,tablet,iphone,truong-phong}.png`.

Chưa làm (đợt 2–3, theo lộ trình mục 7): Bản đồ công trường → phòng (máy chủ chưa trả dòng theo dự án), nút Nhắc / Xem phiếu / Chuyển người / Dọn việc cũ,
trọng số theo loại phiếu, ngưỡng ở Thiết lập, chế độ trình chiếu 3D.

## 12. PR-3 — danh sách phiếu đang chờ, mở phiếu, Nhắc, Dọn việc cũ (13/10/2026)

Tệp: `supabase/migrations/20261013180000_center_flow_items_v1.sql` · smoke `supabase/tests/center_flow_items_smoke.sql` · gỡ `center_flow_items_rollback.sql`
· `components/flow/FlowItemsDrawer.tsx` · nối vào `FlowView` / `FlowPanel` / `CenterShell` / `CenterPage` · service + test `lib/center/centerFlowService.ts`, `__tests__/centerFlowItems.test.ts`.

| Hàm máy chủ | Làm gì |
|---|---|
| `app_private.vcc_flow_thresholds_v1()` | ngưỡng dùng chung (đứng yên 3 ngày làm việc, phiếu chết 30 ngày, SLA mặc định 48 giờ, tuần 6 ngày) |
| `app_private.vcc_flow_scope_v1(project, unit)` | phạm vi người gọi — cùng luật PR-1 (toàn công ty / phòng mình / dự án mình), ngoài phạm vi → `42501 FLOW_SCOPE_DENIED` |
| `app_private.vcc_flow_waiting_rows_v1` | mọi việc đang chờ hôm nay trong phạm vi, 19 nguồn, có mã / tiêu đề / người gửi / người giữ / `ref` mở phiếu; bước quy trình tự nhận ra là phiếu Yêu cầu, đề xuất vật tư hay phiếu quy trình chung |
| `public.vcc_flow_items_v1(filter, limit, offset)` | trang danh sách (≤ 200 dòng); lọc `holderUserId` · `holderUnit` · `source` · `kindName` · `status` (stuck / overdue / dead / unassigned / role) · `role` · `project`; xếp phiếu chết → đứng yên → quá hạn → cũ nhất; **mỗi dòng đúng khuôn `vcc_item` của "Việc của tôi"** nên Center mở phiếu thành tab bằng cơ chế sẵn có (`resolveDrillTarget`), nhãn tab "Đang theo dõi" |
| `public.vcc_flow_remind_v1(filter, note)` | nhắc người đang giữ các việc khớp lọc: một thông báo mỗi người (tiêu đề "Nhắc: N việc đang chờ bạn xử lý", thân ghi mã phiếu + ghi chú, link `/center`), push điện thoại qua trigger sẵn có; **mỗi người tối đa 1 lần / 24 giờ / người nhắc**, không tự nhắc mình, việc chờ một vai (HR, Kế toán, Thủ kho…) không nhắc; `audit_trail` mỗi người |

Giao diện: nút **Xem** cạnh mỗi người ở ngăn Điểm nghẽn và ngăn phòng; **Mở N việc đang chờ** ở ngăn phòng / dự án / kết quả "Đang chờ"; **Dọn N việc cũ** (chờ trên 30 ngày) và **N việc chưa giao người** ở tổng quan;
chip nguồn, loại phiếu, vai chờ → danh sách. Ngăn danh sách: mã · tiêu đề · nguồn / loại / dự án / người gửi · người giữ · chờ bao lâu (vạch trái đỏ = đứng yên / phiếu chết, cam = quá hạn); bấm phiếu → tab;
chân ngăn **Nhắc N người** → ô ghi chú + xác nhận → "Đã nhắc N người · M bỏ qua". Danh sách luôn nằm trong phạm vi đang xem (phòng / dự án ở thanh công cụ).

Không có Zalo: hệ thống chưa có kênh gửi Zalo (chỉ phát hiện trình duyệt Zalo ở chấm công); nhắc = thông báo trong app + push. Chuyển người xử lý / hủy phiếu: mở phiếu và dùng thao tác gốc của module
(đổi người ngay trên sơ đồ cần sửa động cơ quy trình, để đợt sau).

Kiểm (13/10): smoke Cloud rollback (6 vai; danh sách, lọc từng loại, phân trang, kẹp 200, khuôn vcc_item, nhắc + audit + chống nhắc dồn + tự mình + người nhắc khác); tsc; vitest 3.542
(gồm 4 test bộ đọc); Playwright 39 bài × 3 khổ (Xem → 6 phiếu, phiếu chết lên đầu, bấm phiếu mở tab, Nhắc với ghi chú → máy chủ nhận đúng lọc, Dọn việc cũ 3 phiếu, chip Phiếu kho → "Chờ Thủ kho"
không có nút Nhắc, không nối danh sách thì về bảng PR-2); WebKit đứng yên 4 bài. Ảnh: `evidence/2026-10-13-flow-items-{desktop,iphone}.png`.

Chạy lại smoke: `node scripts/run-supabase-cloud-transaction.mjs --expected-ref ftciqmqhmfvjtwoycswe --migration supabase/migrations/20261013180000_center_flow_items_v1.sql --smoke supabase/tests/center_flow_items_smoke.sql`.

## 13. Chuyển động trên dải + mô hình 3D thử (13/10/2026, chủ SP yêu cầu)

**Chuyển động (sản phẩm):** chủ SP thấy thiếu phần "dữ liệu động" của bản xem thử v0. Đưa lại thành công tắc **Chuyển động** ở đầu sơ đồ: hạt chạy dọc 20 dải lớn nhất
(dải to chạy nhanh hơn, dải "Đang chờ" màu cam). Bật sẵn trên máy tính (≥ 1024 px), tắt sẵn trên máy tính bảng / điện thoại và khi hệ điều hành chọn giảm chuyển động;
nhớ lựa chọn trên máy. Cách làm và số đo WebKit (iPhone 13, 820 px):

| Cách | CPU khi đứng yên | Kết luận |
|---|---|---|
| SMIL `animateMotion` trong SVG sơ đồ | 38,7 % | vẽ lại cả sơ đồ mỗi khung hình — loại |
| SMIL ở lớp SVG riêng đè lên | 26,1 % | vẫn vẽ lại lớp lớn — loại |
| **Phần tử HTML, keyframe `transform` thuần (17 mốc lấy mẫu dọc đường cong)** | **4,8 %** (tắt: 0,8 %) | bộ tổng hợp GPU dịch chuyển, không vẽ lại — dùng |

Bài `webkit-idle` đo cả hai trạng thái: tắt (ngưỡng 5 điểm, như mọi màn) và bật (ngưỡng 10 điểm, chuyển động người dùng tự bật). Trình ghi vết Playwright và chờ
"animation kết thúc" phải bỏ qua animation lặp vô hạn, nếu không bài đo treo.

**Mô hình 3D thử (tham khảo, không phải sản phẩm):** `mockups/flow-3d-v0.html` (three.js từ CDN, mở qua launch `flow-mockup` cổng 5190; ảnh `mockups/flow-3d-v0-*.png`).
Phòng ban là ô sàn (số người thật), công trường có cần cẩu; người đi lại trong phòng, mang phiếu (thẻ vàng) từ phòng gửi sang bàn nhận theo nhịp tỷ lệ với lượt giao
90 ngày; phiếu chờ chất đống ở khay bàn nhận (cam = đang chờ, đỏ = đứng yên, số thật); người giữ nhiều việc có tên và huy hiệu đỏ; bấm ô → bảng số của phòng / công trường;
Dừng / 1× 3× 10× / Tự xoay / Toàn cảnh; dòng thông báo "A giao phiếu → B" mỗi lần trao. Để lên sản phẩm cần: nguồn dữ liệu theo người (PR-3 đã có), người thật theo
phòng, đo WebKit (three.js vẽ liên tục ~ GPU), và quyết định của chủ SP về vị trí (chế độ trình chiếu trong tab Dòng chảy hay màn riêng cho TV phòng họp).

**Khuôn viên thật (v1, 13/10 tối):** chủ SP gửi ảnh văn phòng và ảnh chụp trên cao → `mockups/flow-3d-campus-v1.html` dựng theo ảnh: văn phòng 3 tầng mặt nan gỗ,
hai mảng kính lệch, logo xanh "TIEN THINH", biển "VĂN PHÒNG THIẾT KẾ - KINH DOANH", mái hiên; nhà máy 3 khoang mái xanh có ô lấy sáng, khối trắng phía trước ghi
"XÂY DỰNG & KẾT CẤU THÉP", khoang phụ; hồ nước với chòi lục giác và cầu gỗ; nhà mái đỏ; nhà bảo vệ và dãy nhà phụ mái xanh; hàng rào, cổng trượt, đường có vạch,
hàng cau dọc đường; xe ở sân. Phòng ban đặt vào toà nhà (tầng là giả định, ghi rõ trên màn): T1 Tài chính - Kế toán, T2 Quản lý dự án, T3 Ban lãnh đạo + Hành chính -
Nhân sự; Vật tư - Thiết bị ở kho đầu khoang tây, Văn phòng nhà máy ở khối trắng, 44 người chưa gắn phòng ở sân nhà máy. Nút "Nhìn vào trong" làm mờ mặt tiền để thấy
từng tầng. Người đi theo đường thật: lõi thang → cửa → sân → cửa toà kia; 3 xe công trường (Sơn Miền Bắc, Thú nhồi bông GĐ2, G3) từ đường vào cổng, dừng ở sân,
người xuống mang đề xuất vật tư tới Vật tư hoặc Quản lý dự án theo số thật. Góc nhìn: Toàn cảnh · Văn phòng · Nhà máy · Cổng. Ảnh `mockups/flow-3d-campus-v1-*.png`.
Cần chủ SP xác nhận tầng thật của từng phòng và vị trí kho / văn phòng nhà máy.

**Khuôn viên v2 (14/10): tầng thật, hai công trường, phiếu thật bấm xem được.** Chủ SP xác nhận: T1 Hành chính - Nhân sự; T2 Kế toán + Ban lãnh đạo;
T3 Vật tư - Thiết bị + Quản lý dự án + Thiết kế - Đấu thầu; VP nhà máy ở nhà máy kết cấu thép; công trường là hai khu bên ngoài công ty; "dữ liệu khi chuyển bấm vào
xem được". Cùng tệp `mockups/flow-3d-campus-v1.html` đổi thành:

- **Phát lại lượt chuyển thật**: đọc chỉ đọc 389 bước quy trình (`workflow_step_assignments` 90 ngày + mọi bước đang chờ) lúc 14/10 13:47, nhúng vào trang (~29 KB:
  mã phiếu, tiêu đề, loại, bước, người gửi → người nhận, giờ giao, giờ xử lý, kết quả, quá hạn). Đồng hồ phát lại 22/09 → 14/10 (bắt đầu 06/10 07:00, thanh tua bấm được),
  giờ làm việc 1 giờ = 3 giây, đêm và Chủ nhật tua nhanh. Mỗi bước là một người thật mang tờ phiếu thật tới bàn người nhận; bước kế của cùng phiếu chờ phiếu tới tay
  mới đi tiếp; nhiều phiếu cùng người gửi, cùng nơi nhận trong ~20 phút gộp thành một chuyến ("9 phiếu" — Phạm Đức Thiện duyệt dồn 12/10). Người gửi đang bận thì
  đồng nghiệp cùng phòng mang hộ. Tiêu đề loại "hồ sơ phòng HCNS" (thử việc, hoàn chi phí cá nhân) được ẩn.
- **Chồng phiếu trên bàn = việc đang chờ tại thời điểm phát lại** (đã giao, chưa xử lý): vàng < 1 ngày, cam 1–3 ngày, đỏ > 3 ngày. Phát tới hiện tại thì tổng các chồng
  đúng bằng 37 bước đang chờ thật.
- **Bấm được dữ liệu**: nhãn vàng trên người / xe đang mang phiếu → thẻ phiếu (mã, tiêu đề, bước, người gửi, người nhận, giờ gửi, kết quả bước) + **hành trình phiếu**
  (mọi bước của phiếu, chấm màu theo kết quả) + "Theo người mang" (camera bám người/xe) + "Mở phiếu" (trong Vioo sẽ mở tab). Bấm người → phiếu trên bàn + nhận / xử lý 90 ngày
  + thời gian xử lý trung vị. Bấm phòng / công trường → người, chờ, quá 3 ngày, chuyển với nơi khác 90 ngày. Bảng phải mặc định là "Đang mang đi" + "Vừa chuyển".
- **Hai công trường ngoài công ty** bên kia đường: Sơn Miền Bắc (SMB-2026, khung thép đang dựng, cẩu bánh lốp, máy xúc) và Thú nhồi bông GĐ2 (DA29, khung bê tông có
  thép chờ, giàn giáo lưới xanh, cẩu tháp quay). Ban chỉ huy ngồi dưới mái che cạnh container: Luật, Sơn ở SMB; Thảo, Năm, Đoàn Văn Dương, Hoàng Công Minh,
  Nguyễn Quang Huy ở DA29 — **suy từ dữ liệu** (người tạo / duyệt bước "BCH CT Duyệt" của đúng dự án đó). Phiếu đi giữa công trường và công ty bằng xe tải công trường
  hoặc xe con công ty: người ra xe → xe chạy đường → đỗ ở sân → người lên đúng tầng giao phiếu → quay lại xe về.
- **Lỗ hổng dữ liệu hiện ra**: Phạm Đức Thiện duyệt bước "Phòng TKĐT duyệt" 27 lần nhưng chưa gắn phòng → ngồi ở Thiết kế - Đấu thầu, thân màu xám; 4 người chưa gắn
  phòng khác đặt tạm ở sân nhà máy. Công nhân mũ vàng là minh họa (không có trong Vioo).
- Góc nhìn: Toàn cảnh · Văn phòng (thẳng mặt tiền, mặt nan / mái hiên mờ khi "Nhìn vào trong") · Nhà máy · CT Sơn Miền Bắc · CT Thú nhồi bông. Ảnh
  `mockups/flow-3d-campus-v1-{overview,office,phieu,smb,da29,factory}.png`. `window.campusDebug` (tua / đổi góc tức thì) chỉ để chụp ảnh tự động khi tab ẩn.

## 14. Công trường 3D theo tiến độ hạng mục — Sơn Miền Bắc (14/10)

Chủ SP gửi phối cảnh 3D công trình Sơn Miền Bắc, muốn "chia tiến độ đã thực hiện ra để mô hình hoá: làm xong phần móng thì thể hiện phần móng, tương tự các
hạng mục khác", máy móc và vật tư giống thực tế. Trang `mockups/site-3d.html?site=SMB` (three.js, không tải mô hình ngoài; máy, vật tư dựng bằng hình học), từ khuôn viên
bấm công trường Sơn Miền Bắc → "Mở công trường 3D theo tiến độ".

**Dữ liệu thật, đọc chỉ đọc 14/10** (nhúng ~65 KB): `project_tasks` SMB-2026 349 đầu việc (WBS 1–17, % hiện tại, ngày kế hoạch, ngày thực tế), khối lượng
`project_work_boq_items` (kích thước nhà suy từ đây), `project_daily_task_progress` 564 điểm đổi % từ 01/07, `daily_logs` 186 ngày có người (công nhân, tổ đội theo việc,
máy) và sổ `inventory_balances` Kho Sơn Miền Bắc 68 dòng.

**Nhà và kích thước** (theo BOQ, không theo nhãn ảnh): NX1 = NX2 = 1.980 m² nền, 39,4 t thép mái, 1.946 m² tôn → 30 × 66 m; NX3 = 5.550 m², zone 1 + zone 2 mỗi zone
2.750 m², 160 t thép, 6.174 m² tôn → nhà hai nhịp 66 × 83 m; nhà văn phòng ~400 m²/sàn, 4 tầng + tum. Vì vậy em hiểu: khối dài sau nhà 4 tầng là **NX2**, khối hai
nhịp phía sau là **NX3** (ảnh ghi "Nhà xưởng 2 / 3" trên hai nhịp) — **cần chủ SP xác nhận**. Giả định thêm: zone 1 = nhịp tây; khu S2 (cos 3.5) và S1 (sàn deck) ở
đầu nhà phía đường.

**Quy tắc dựng theo %** (mỗi nhóm phần tử gắn đúng mã WBS; phần tử thứ i hiện khi i < số phần tử × %):
- Móng: cọc → hố đào → đế móng → giằng; lấp đất xong thì móng khuất, hiện nền cát → base → nilong + lưới thép → bê tông nền.
- Cột từng tầng / cos: cốt thép (lồng thép cam) → ván khuôn (ván ép) → bê tông. Sàn từng tầng: cây chống → ván khuôn → lưới thép → bê tông; "Tháo giáo" xoá cây chống.
- Tường gạch nhà văn phòng theo tầng; tường ALC nhà xưởng; khung kèo thép (chữ I đỏ) + xà gồ C theo bước cột; tôn mái, tôn/panel bao; ống PCCC đỏ có ty treo;
  giàn giáo ngoài; 4 tuyến đường (base → bê tông) và cống D400 dọc tuyến 1.
- Hoàn thiện (kính mặt tiền, ốp, sơn ngoài, mái sảnh) mới 0% nên chưa hiện; hình hoàn thành của từng nhà (và hồ, vườn, bãi đỗ, nhà bảo vệ theo phối cảnh) là
  bóng mờ, tắt được.
- % tại một ngày: chuỗi % theo ngày (từ 01/07); trước 01/07 nội suy theo ngày bắt đầu / kết thúc thực tế (có dòng ngày thực tế bắt đầu sau ngày kết thúc — lỗi nhập
  liệu, đã đảo lại). Kế hoạch tại ngày = nội suy theo ngày kế hoạch → thanh xám sau thanh thực tế, chậm hơn 5 điểm thì cam / đỏ.

**Thanh thời gian 01/04 → 14/10**: tua hoặc Phát (0,3 s/ngày); nhà mọc theo đúng ngày. Ngày có đầu việc "Đổ bê tông …" tăng % → xe bơm cần + 2 xe bồn tới đúng nhà.
Công nhân theo nhật ký ngày (gần nhất trong 7 ngày): tổ ghi việc ("Xây ALC 6", "Lắp dựng kc 8", "PCCC 7", "Tường rào 4", "Hạ tầng 3", "NVP, X1, X3 8", "Sơn bả 6"
ngày 08/10) đứng đúng chỗ làm; nhật ký chỉ ghi "Tổ đội" thì chia cho các nhà có đầu việc tăng % trong 7 ngày. Máy theo nhật ký 7 ngày (máy cẩu, máy xúc, máy lu,
máy ủi, đầm cóc, ô tô tải) — vị trí trên mô hình là minh hoạ.

**Máy và vật tư dựng chi tiết**: máy xúc (xích rỗng, bánh sao, con lăn, đối trọng bo, cần cong, tay gầu, gầu răng, 4 xi lanh, đào theo chu kỳ), ô tô cẩu 25 t (4 trục,
chân chống chữ H, cần ống lồng 4 đoạn, xi lanh nâng cần, móc cẩu treo dầm thép), xe lu rung, máy ủi, ô tô ben, xe bồn (bồn sọc quay), xe bơm cần (chân chữ X, cần 4
khúc có xi lanh và ống bê tông), đầm cóc; bãi vật tư: thép cây theo đường kính, xà gồ C, thép hộp, lưới hàn, tấm ALC, gạch, xi măng bao PCB30, đống cát, đống base,
cọc tre, cống D400, tấm cách nhiệt, nilong, phuy dầu, bu lông móng, Sika. Bấm đống vật tư → số tồn theo sổ kho; lưu ý sổ kho còn ghi cả vật tư đã dùng hết
(bê tông 1.272 m³, base 1.861 m³) → cần đối soát xuất dùng.

**Bấm được**: hạng mục (nhà) → % từng phần so với kế hoạch + đầu việc đang dở; đầu việc (trên cây hoặc bấm vào phần tử 3D) → % thực tế / kế hoạch, ngày, khối lượng
BOQ, số phần tử 3D, % theo ngày; phần tử 3D của đầu việc nhấp nháy vàng.

Ảnh: `mockups/site-3d-smb-{overview,office,nx1-task,yard,2026-07-15,2026-05-16-pour,crane,excavator}.jpg`. `window.siteDebug` (setDay, view, focus) chỉ để chụp ảnh tự động.

**Còn thiếu / việc tiếp**: (1) chủ SP xác nhận NX2 / NX3 và vị trí zone, khu S1 / S2; (2) XinHai — đã làm, xem mục 15; (3) tường rào có trong nhật ký nhưng không có
trong WBS; (4) lên sản phẩm cần bảng "hạng mục → mẫu 3D" cho mỗi dự án (mẫu: nhà khung BTCT n tầng, nhà xưởng khung thép k nhịp, đường, cống) thay cho mã WBS
viết cứng trong bản thử.

## 15. Công trường XinHai (DA29) 3D theo ảnh flycam (14/10)

Chủ SP chưa có phối cảnh, gửi ảnh flycam thực tế; hình dạng nhà cho giống Sơn Miền Bắc. Cùng trang `mockups/site-3d.html?site=DA29` (nút **Sơn Miền Bắc | XinHai**
trên đầu bảng trái; khuôn viên bấm công trường → "Mở công trường 3D theo tiến độ" mở đúng công trường). Dữ liệu thật đọc chỉ đọc 14/10: 363 đầu việc DA29, 317 chuỗi %
theo ngày (31/08 → 02/10), 90 ngày nhật ký, 13 dòng sổ Kho Xin Hai Vina (cọc ly tâm D300, thép D6–D22, Base B, mũi cọc, thang giáo).

**Bố cục theo ảnh**: đường nhựa 2 làn phía tây, ao cá bên kia đường, cổng + nhà bảo vệ mái đỏ phía tây, BCH là nhà dài mái tôn xanh trắng, khu gia công lưới xanh,
bãi vật tư cạnh BCH, đường tạm đất chạy giữa, nhà xưởng hàng xóm mái đỏ phía đông. Chủ SP xác nhận (14/10): ngôi nhà cạnh BCH là **nhà nghỉ ca**
(3 tầng + tum, 24 × 16 m: móng, lấp nền, cột tầng 1 xong; ảnh đã thấy ván phủ phim đen trên sàn tầng 2 nhưng Vioo còn 0%); **nhà văn phòng là ô cuối cùng phía xa**
(2 tầng + tum ~48 × 24 m; móng đã đổ — ảnh có xe bồn ở đó — và đã lấp đất); **nhà xưởng chạy từ phía trước tới sát nhà văn phòng**: 66 × 150 m (theo ảnh; BOQ tôn mái
3 × 2.567 m², sàn deck 7.462 m² nên nhà thật có thể hẹp hơn), khung thép 2 tầng sàn deck, 18 bước cột, chia 3 phân đoạn theo trục: **PĐ3 (trục 15–19) phía trước,
PĐ2 (6–15) giữa, PĐ1 (1–5) phía xa** — khớp ảnh: phía trước đã lấp và lu nền, giữa đang buộc thép móng (30%), xa mới đào (30%).

**Bổ sung chung cho cả hai công trường**: móng có thêm giai đoạn cốt thép (lồng thép cam ở đế và giằng) và ván khuôn trước bê tông; đầu việc đã xong có ngày thực tế thì
dựng theo ngày thực tế (vì % theo ngày thường nhập muộn — ví dụ đổ bê tông cột tầng 1 nhà nghỉ ca ngày 28/09 nhưng % 100 ghi ngày 02/10); số công nhân lấy số lớn hơn
giữa "số người" và tổng các tổ; nhật ký ghi nhiều máy trong một dòng được tách đủ loại; máy mới: **robot ép cọc tĩnh 260 t** (đối trọng khối bê tông, khung kẹp, cẩu phụ
cầm cọc) và bàn gia công uốn / cắt thép; nhà khung bê tông n tầng dựng bằng một hàm chung. Bảng nhà có mục **"Cần kiểm tra số liệu"**: tầng trên có % khi cột tầng dưới
chưa đổ (DA29: "2.4.2 ván khuôn cột tầng 2 14% nhưng 2.3.3 đổ bê tông cột tầng 1 0%") — phần tử tầng trên không vẽ lơ lửng.

Ảnh: `mockups/site-3d-xinhai-{overview,nha-nghi-ca,mong-pd2,2026-09-15,bai-vat-tu,nha-van-phong}.jpg`.

**XinHai theo phối cảnh và bảng hạng mục thật (15/10).** Chủ SP gửi phối cảnh 3D (4 ảnh: toàn khu, nhà nghỉ ca 3 góc) + bảng cơ cấu đất (50.156,9 m²: xây dựng
26.902,6 · sân đường 10.715,4 · cây xanh 12.538,9) + bảng hạng mục. Dựng lại theo đó:
- Mặt bằng xoay đúng phối cảnh: đường chính dọc mặt trước (phía tây), đường nhánh bên phải (phía nam), xưởng chạy song song đường chính, nhà máy hiện có
  (giai đoạn 1) phía sau.
- Kích thước: **Xưởng sản xuất chính + kho 8.110 m² → 60 × 135 m** (2 nhịp × 30 m, 18 bước cột × 7,5 m, 2 tầng sàn deck); **Nhà điều hành 2 tầng 1.161 m² →
  36,3 × 32 m** ở đầu xa, sát xưởng; **Nhà nghỉ ca 3 tầng 288 m² → 18 × 16 m** ở đầu gần, trước mặt dài của xưởng (đúng ảnh 2–4).
- Hạng mục chưa thi công hiện bóng mờ có tên + diện tích, bật / tắt cùng "Hình hoàn thành" và chỉ hiện nhãn khi lại gần: nhà xe công nhân 5C 844,2 m² (dọc rào
  mặt trước) và 5D 294 m², nhà lán xe 99,8, hồ nước PCCC 235, cột cờ, nhà vệ sinh 6A 105,8 / 6B 110,7, phòng khí nén 52,5, phòng máy phát 66,3, trạm biến áp 36,7,
  nhà nồi hơi 40,2, chòi hút thuốc 11, công viên cây xanh. Vị trí các nhà phụ là ước theo phối cảnh (cụm nhà nhỏ ở đầu xa gần nhà điều hành) — cần mặt bằng tổng thể
  để đặt chính xác.

Ảnh thay mới: `mockups/site-3d-xinhai-{overview,nha-nghi-ca,mong-pd2,2026-09-15,bai-vat-tu,nha-van-phong,hang-muc-phu}.jpg`.
