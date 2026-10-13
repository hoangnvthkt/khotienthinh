# Dòng chảy công việc — mô hình điều hành trực quan cho Ban lãnh đạo (13/10/2026)

Trạng thái: chủ SP **đồng ý cả 9 câu** (13/10) → **PR-1 #183 lên production + merged 13/10** (mục 10) → **PR-2 tab giao diện đã code** (mục 11), chờ duyệt merge. Quyền `center.flow.view` đã cấp cho 5 người Ban lãnh đạo 13/10. Bản xem thử v0 ở mục 8.

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
