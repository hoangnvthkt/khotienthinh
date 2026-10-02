# Rà soát Module Nhân sự · Chấm công · Nghỉ phép — Vioo

Ngày rà soát: 02/10/2026 · Phạm vi: toàn bộ HRM (hồ sơ, tổ chức, chấm công, ca/lịch, nghỉ phép, quyền riêng tư; lương ở mức liên quan).
Cách làm: đọc mã nguồn, truy vấn **chỉ đọc** Supabase Cloud (`ftciqmqhmfvjtwoycswe`), log Postgres 24 giờ gần nhất, đối chiếu luật hiện hành.
**Chưa sửa code, chưa đổi dữ liệu hay schema.** Mọi số liệu dưới đây lấy từ Cloud ngày 02/10/2026; số liệu vị trí chỉ dùng ở dạng tổng hợp.

---

## 0. Tóm tắt cho chủ sản phẩm

1. **Chấm công vừa chạy đại trà từ 01/10** (46–47 người/ngày, tháng 9 chỉ 1–5 người/ngày), nhưng **58% lượt chấm 01–02/10 bị gắn "ngoài phạm vi"** (114/195 lượt). Phần lớn **không do nhân viên**: 4/6 công trường chưa có tọa độ, tọa độ Sơn Miền Bắc lệch ~33 km, và một lỗi code biến tọa độ trống thành (0,0) nên khoảng cách hiện ra **~11.692 km**.
2. **Ngoài phạm vi vẫn được chấm và tự động "Đã duyệt"**. Khoảng cách và cờ "trong phạm vi" do điện thoại tự tính rồi gửi lên; ngày, giờ chấm cũng lấy theo đồng hồ điện thoại. Bảng công hiện chưa đủ tin cậy để tính lương.
3. **Quy tắc "chưa vào thì không được ra" khiến nhân viên phải lách**: 59 ngày có người bấm "vào" rồi "ra" cách nhau ≤ 10 phút lúc khoảng 17h, chỉ để ghi được giờ ra. Bảng công vì thế ghi giờ vào là 17:0x.
4. **Nghỉ phép gần như không dùng được**: lưu số dư phép **lỗi 100%** (28 lỗi trong 24 giờ qua), đơn nửa ngày không lưu được, người duyệt do người xin tự chọn nhưng chỉ 10 tài khoản có quyền duyệt, không có thông báo. Từ tháng 3 đến nay chỉ có 6 đơn.
5. **Quyền riêng tư chưa đạt yêu cầu "chỉ HR thấy của người khác"**: **50/88 tài khoản** đang xem được toàn bộ đơn nghỉ phép của công ty, kể cả lý do (do chuyển đổi quyền legacy ở P3). Trợ lý AI tra được ngày sinh, tình trạng hôn nhân và giờ chấm công của bất kỳ ai (hiện 5 người dùng AI).
6. **Nền móng tốt đã có, nên giữ**: hồ sơ 8 nhóm có phân lớp dữ liệu C1–C4, vai trò HR / HR_MANAGE, RPC có kiểm soát, đề xuất bù công xử lý ở server, sơ đồ tổ chức và định biên, phiếu lương cá nhân chỉ hiện bản đã chốt. Chỗ thiếu là **dữ liệu nền** (0/78 người xác định được quản lý trực tiếp, 0 hồ sơ CCCD/BHXH/HĐLĐ) và **giao diện nhập liệu** còn theo cấu trúc database.
7. **Đề xuất 5 giai đoạn**: G0 sửa gấp trong tuần → G1 chấm công đúng và tự động → G2 chính sách nghỉ và phê duyệt → G3 hồ sơ, tổ chức → G4 ca, OT, chốt công, nối lương. Có **10 quyết định** cần anh chốt (mục 10).

---

## 1. Hiện trạng bằng số liệu

| Chỉ số | Giá trị | Ghi chú |
|---|---|---|
| Nhân sự đang làm việc | 78 (80 hồ sơ) | 88 tài khoản đang hoạt động; 6 tài khoản thật chưa có hồ sơ nhân sự nên không chấm công được |
| Số người chấm công/ngày | 47 (01/10), 46 (02/10) | Tháng 9: 1–5 người/ngày → mới triển khai đại trà |
| Lượt chấm camera ngoài phạm vi (toàn kỳ) | 332/1.021 (~33%) | Tất cả vẫn `approved` |
| Ngoài phạm vi 01–02/10 | **114/195 (58%)** | Phân tích nguyên nhân ở mục 3.2 |
| Ngày có giờ vào nhưng thiếu giờ ra | 86/522 (16%) | Từ 22/06 (bắt đầu chấm camera) |
| Ngày có lượt vào đầu tiên sau 12h | 78, trong đó **59 ngày "vào–ra" cách nhau ≤ 10 phút** | 61 ngày lượt vào đầu tiên sau 16:30 → lách quy tắc chưa vào thì không được ra |
| Ngày công thứ Bảy | 77/594 (13%) | Nhưng tính ngày phép và "điền ca cả tháng" đang bỏ qua thứ Bảy |
| Giờ tăng ca được ghi nhận | 0 bản ghi | Dù 15 ngày có giờ ra sau 19:00 |
| Đơn nghỉ phép | 6 đơn (03→10/2026) | 3 hủy, 1 duyệt, 2 đang chờ, không có người duyệt |
| Số dư phép | 2 dòng (năm 2026) | Dừng cộng từ tháng 4; mọi lần lưu đều lỗi (mục 4.1) |
| Có quản lý trực tiếp xác định được | **0/78** | Chế độ quản lý chưa bật: 63/78 chưa có vị trí chính, 21/23 đơn vị chưa có trưởng đơn vị |
| Hồ sơ: ngày vào làm / ngày sinh / đơn vị + vị trí | 12/78 · 32/78 · 44/78 | Bảng CCCD, BHXH, ngân hàng, người phụ thuộc, HĐLĐ, quá trình công tác: **0 bản ghi** |
| Danh mục vị trí | 115 đang dùng | 13 tên chỉ là số ("7", "16"…), 1 mục test, 6 tên trùng, 4 chức danh gắn tên dự án |
| Ca làm việc | 4 ca, chỉ "Ca Hành chính" được dùng (31 người, 06→09/2026) | 3 "lịch làm việc" giống hệt nhau (8–12h, 13–17h) |
| Ngày lễ 2026 trong hệ thống | 5 ngày | Thiếu Tết Nguyên đán, Giỗ Tổ (CN 26/4, nghỉ bù 27/4), **Ngày Văn hóa Việt Nam 24/11** (mới, từ 01/07/2026) |

---

## 2. Người dùng và việc họ cần làm

| Vai trò | Việc chính khi vào HRM | Thông tin cần thấy đầu tiên |
|---|---|---|
| Nhân viên văn phòng (K1) | Chấm công trong 5 giây; xin nghỉ; xem công, phép, lương của mình | "Hôm nay đã chấm chưa, đúng giờ không"; số ngày phép còn lại |
| Cán bộ công trường (K2) | Chấm công ở công trường (ngoài trời, sóng yếu, có thể đi nhiều công trường) | Đang ở công trường nào, trong phạm vi chưa |
| Trưởng bộ phận / Chỉ huy trưởng | Duyệt phép, xác nhận ngoại lệ chấm công, xem ai vắng hôm nay | Hộp "chờ tôi duyệt" và lịch vắng mặt của đội |
| HR (HCNS) | Hồ sơ, chính sách, chốt công cuối tháng | Ngoại lệ chưa xử lý, hồ sơ thiếu, HĐ sắp hết hạn |
| HR Manage / Ban giám đốc | Lương, báo cáo, duyệt cấp 2 | Tổng công, chi phí nhân sự, việc chờ duyệt |

Nguyên tắc thiết kế: **chấm công một chạm, nghỉ phép ba bước, duyệt một màn hình**. Người dùng không cần biết vào/ra, mã danh mục hay cấu trúc phòng ban.

---

## 3. Chấm công (ý 2, 3, 4)

### 3.1 Giao diện chấm công trên điện thoại bị che camera (ý 2)

**Nguyên nhân** (`pages/hrm/CheckIn.tsx:431-555`):
- Khung camera tỷ lệ 3:4 rộng toàn màn hình. Trên máy 390 px, khung cao khoảng 500 px, cộng thêm tiêu đề và 3 ô thống kê (Ngày công / Chuỗi / Lần ghi) nên **ô chọn địa điểm và hai nút chấm nằm dưới mép màn hình**. Người dùng phải cuộn ~250 px mới tới, và camera bị đẩy khỏi tầm nhìn đúng lúc chụp.
- Chọn địa điểm bằng `<select>` gốc: trên iOS, bánh xe chọn che thêm nửa dưới màn hình.
- Ảnh vẫn được chụp từ luồng video kể cả khi khung camera đã khuất, nên người dùng không căn được mặt.

**Đề xuất "một màn hình, không cuộn"** (giữ đúng theme xanh FastCons):

```
┌─────────────────────────────────────┐
│ Chấm công                08:02:15   │  tiêu đề gọn
│ Thứ Năm 02/10 · Ca HC 08:00–17:00   │
├─────────────────────────────────────┤
│ 📍 Công trường Xin Hai Vina   [Đổi] │  tự nhận theo GPS
│    Trong phạm vi · cách 35 m · ±12 m│
├─────────────────────────────────────┤
│        ╭───────────────╮            │  camera ~40% chiều cao,
│        │  khung mặt    │            │  khung oval căn mặt,
│        ╰───────────────╯            │  luôn nhìn thấy
├─────────────────────────────────────┤
│ Hôm nay: Vào 07:58 ✓                │
├─────────────────────────────────────┤
│ [        CHẤM CÔNG RA         ]     │  nút chính dính đáy (trên thanh menu)
└─────────────────────────────────────┘
```

- Một nút chính, nhãn tự đổi: "Chấm công vào" / "Chấm công ra" (xem 3.4).
- "Đổi địa điểm" mở bottom sheet, chỉ liệt kê địa điểm được phép, kèm khoảng cách.
- Các trạng thái phải hiển thị rõ:
  - Đang xác định vị trí (±85 m) → nút khóa, ghi lý do.
  - Chưa cấp quyền camera hoặc GPS → hướng dẫn mở quyền.
  - Ngoài phạm vi → nút đổi thành "Gửi chấm công ngoài vị trí" và bắt buộc nhập lý do.
  - Hôm nay nghỉ phép buổi sáng → "Ca chiều bắt đầu 13:00".
  - Đã chấm xong → giờ vào/ra và trạng thái.
- Ô thống kê "chuỗi ngày" chuyển xuống dưới hoặc bỏ, vì không phục vụ việc chấm công.

### 3.2 GPS sai khoảng cách, phải chọn công trường thủ công (ý 3)

Phân tích 195 lượt chấm ngày 01–02/10, trong đó 114 lượt ngoài phạm vi:

| Nguyên nhân | Bằng chứng | Lượt bị ảnh hưởng |
|---|---|---|
| **A. Công trường chưa có tọa độ + lỗi code** | Xin Hai Vina, RICO, Richain, Donglim không có lat/lng. `finiteOrNull(null)` trả về `0` (`CheckIn.tsx:48-51`) nên công trường bị coi là nằm ở (0,0) → hiện "11.692.749 m" | 42 (100% lượt ở XHV và RICO) |
| **B. Tọa độ Sơn Miền Bắc lệch ~33 km** | Điểm chấm trung vị cách tọa độ cấu hình 33,2 km | 27 (100% lượt ở SMB) |
| **C. Tự chọn "gần nhất" chọn nhầm vì A và B** | Người ở XHV bị gán "Nhà máy KCT" (13,2 km; 19 lượt, 10 người). Người ở SMB bị gán "Văn phòng Hà Nội" (27,3 km; 17 lượt, 8 người). Hai khoảng cách này trùng khớp vị trí thật của XHV và SMB | 36 |
| **D. Bán kính văn phòng 100 m quá chặt, không xét độ chính xác GPS** | VP Hưng Yên: 5 lượt chỉ cách vài trăm mét (từ 200 m, trung vị 241 m). Code có lấy `accuracy` nhưng không dùng và không lưu; chỉ đọc GPS một lần, cho phép dùng kết quả cũ 15 giây | 5 |
| E. Chấm ở nơi khác, cách VP Hưng Yên trên 1 km | Chưa rõ lý do (đi công tác, chấm từ nhà…) → cần luồng "chấm ngoài vị trí có lý do" | 4 |

Các vấn đề nền phía sau:
- **Không còn màn hình nhập tọa độ**: màn cũ có nút "Lấy tọa độ hiện tại", bán kính, người quản lý địa điểm. Màn này đã bị ẩn khi chuyển sang "Danh mục dùng chung HRM" (`pages/Settings.tsx:1825`, tab `__legacy-hrm-master-data`) nên HR không có chỗ sửa.
- Tọa độ "Nhà máy KCT Tiến Thịnh" trùng tọa độ "Văn phòng Hưng Yên" (cách 3 m), cần kiểm tra lại tại chỗ.
- Danh sách địa điểm là **tất cả công trường + văn phòng của công ty** (`get_my_checkin_context`), không lọc theo nơi người đó được phân công. Trong khi đó dữ liệu phân công đã có trong `project_staff` (45 người ở 3 công trường, 16 người thuộc nhiều công trường).
- Vẫn tồn tại hai nguồn giờ làm không dùng: giờ vào/ra theo địa điểm (07:30–17:00 công trường, 08:00–17:30 VP) có nhập nhưng không đâu dùng.

**Đề xuất** (làm lần lượt):
1. **Chữa cấu hình ngay**: chỉ huy trưởng hoặc HR đứng tại công trường bấm "Lấy vị trí hiện tại" (hiện độ chính xác, xem trước trên bản đồ). Nhập cho XHV, RICO, Richain, Donglim; kiểm tra lại SMB và Nhà máy KCT. Bán kính mặc định: công trường 300 m, văn phòng 150 m (anh chốt, mục 10). Công trường rộng cho phép nhiều điểm (cổng, lán, xưởng).
2. **Sửa logic GPS**:
   - Theo dõi vị trí 5–10 giây cho tới khi sai số ≤ 50 m.
   - Quy tắc: *trong* nếu khoảng cách ≤ bán kính; *chưa chắc* nếu khoảng cách − sai số ≤ bán kính; *ngoài* nếu vượt.
   - Lưu sai số kèm lượt chấm.
   - Coi tọa độ trống là "chưa cấu hình", không bao giờ quy về 0.
3. **Tự chọn địa điểm theo "vùng chứa mình"**, không theo "gần nhất". Tập địa điểm được phép = nơi làm việc chính (VP/nhà máy theo hồ sơ) + công trường đang được điều động (có hiệu lực từ–đến) + điều động tạm thời. Có đúng một địa điểm chứa mình thì tự chọn, người dùng chỉ việc bấm.
4. **Chấm công tập trung** cho nơi GPS kém hoặc tổ đội không có smartphone (G4): mã QR đổi liên tục dán tại cổng công trường, hoặc chỉ huy trưởng chấm hộ có ảnh. Các phần mềm chấm công phổ biến ở VN đều hỗ trợ nhiều hình thức (GPS, Wi-Fi, QR, khuôn mặt) cho trường hợp này.

### 3.3 Làm ở công trường mà chấm ở văn phòng vẫn được (ý 3)

Hàm `app_private.employee_camera_checkin_v1`:
- **Tin khoảng cách và cờ trong phạm vi do điện thoại gửi** (`p_distance_m`, `p_in_range`), không tự tính lại.
- Lượt ngoài phạm vi vẫn ghi `status = present` và **`approvalStatus = approved`**. Nút chấm cũng không khóa khi ngoài phạm vi (`CheckIn.tsx:538`).
- **Ngày và giờ chấm lấy từ điện thoại** (`p_work_date`, `p_event_time`); server chỉ kiểm định dạng HH:mm, chỉ lưu thêm `recorded_at = now()` để đối chiếu. Ngày làm việc được tính **một lần khi mở trang** (`CheckIn.tsx:144`), nên app để mở qua đêm sẽ ghi lượt sáng hôm sau vào ngày hôm trước. Đã có 1 trường hợp lệch đúng 1 ngày; chưa thấy dấu hiệu chỉnh đồng hồ để gian lận (1/1.022 lượt).
- Ảnh chấm công upload với `upsert: true`, và quyền storage cho chủ ảnh **sửa và xóa** ảnh của mình, nên bằng chứng có thể bị thay hoặc mất.

**Đề xuất**:
- Server tự tính khoảng cách từ tọa độ địa điểm và dùng **giờ server** (Asia/Ho_Chi_Minh) làm giờ chấm.
- Lượt ngoài phạm vi hoặc GPS kém **không tự duyệt**: trạng thái "Chờ xác nhận", kèm lý do và ảnh, quản lý địa điểm hoặc trưởng bộ phận xác nhận trong 24–48h. Chưa xác nhận thì không tính công.
- Ảnh chấm công bất biến: không sửa, không xóa phía nhân viên; xóa theo chính sách lưu giữ (mục 7).

### 3.4 Chưa check-in sáng thì không check-out được (ý 4)

Server chặn bằng lỗi "Chưa có check-in ngày …", client cũng khóa nút. Đây là lỗi tư duy mô hình chứ không chỉ là lỗi nút.

**Quan điểm quản trị nhân sự**: chấm công là **ghi nhận sự kiện có mặt**; còn **công** là kết quả hệ thống tự tính theo ca và đơn từ. Nhân viên không phải tự phân biệt vào hay ra.

**Đề xuất**:
- Một nút "Chấm công". Lượt đầu tiên trong ngày là *vào*, lượt cuối cùng là *ra* (ca đêm tính theo ngày bắt đầu ca). Không bao giờ chặn lượt chấm.
- Xử lý các tình huống:

| Tình huống | Hệ thống xử lý |
|---|---|
| Nghỉ phép buổi sáng (đã có đơn nửa ngày), chiều đi làm | Ca hôm đó bắt đầu 13:00; chấm lúc 13:05 là đúng giờ; công = 0,5 làm + 0,5 phép |
| Không có đơn, buổi chiều mới đi làm | Ghi nhận vào 13:05 → "đi muộn / vắng sáng không phép" → nhắc làm đơn bổ sung hoặc giải trình |
| Quên chấm vào buổi sáng | Chiều vẫn chấm được; ngày đó "thiếu giờ vào" → nhắc **giải trình** (đã có luồng đề xuất bù công ở server, chỉ cần đưa ra thành nút "Giải trình" ngay trên ngày bị thiếu) |
| Quên chấm ra | Hôm sau nhắc giải trình; không tự cho đủ công |
| Sáng ở công trường A, chiều ở B | Mỗi lượt giữ địa điểm riêng; công chia theo thời gian ở từng nơi (phục vụ chi phí nhân công theo dự án) |
| Ca đêm 22:00–06:00 | Lượt 06:00 hôm sau thuộc ca của ngày trước |
| Mất sóng ở công trường | (G4) lưu lượt chấm offline, đồng bộ sau, gắn cờ "offline" để xác nhận |

### 3.5 Các điểm khác của chấm công

- **Không có chốt công**: HR bấm vào ô để đổi trạng thái (có → vắng → nửa ngày → phép…) hoặc chuột phải để xóa ngày, không cần lý do, không lưu lịch sử. Bảng `hrm_attendance` không có trigger kiểm toán (`pages/hrm/Attendance.tsx:193-213`).
- Mỗi ngày chỉ một dòng và một địa điểm, nên không phân bổ được công theo công trình.
- Không ghi nhận tăng ca, không có cảnh báo trần làm thêm giờ (50% giờ làm/ngày, 40 giờ/tháng, 200 giờ/năm; từ trên 200 tới 300 giờ phải thông báo cơ quan lao động theo Nghị định 145/2020).
- Nhắc chấm công đang tắt (quyết định 28/09). Nên bật lại sau khi xử lý G0 và đã thông báo nhân viên.

---

## 4. Nghỉ phép (ý 5)

### 4.1 Lỗi đang có (đã kiểm chứng)

| # | Lỗi | Bằng chứng | Hậu quả |
|---|---|---|---|
| 1 | Trigger `accrue_leave_balances` dùng tên cột kiểu `last_accrual_month`, trong khi bảng dùng `"lastAccrualMonth"` | Log Postgres: **28 lỗi** `record "new" has no field "last_accrual_month"` (01/10 03:35 → 02/10 01:25 UTC) | HR **không lưu được số dư phép**; duyệt đơn không trừ được phép; 2 dòng số dư hiện có dừng cộng từ tháng 4 |
| 2 | Không có dòng số dư = còn lại 0 | `LeaveManagement.tsx:149-162` | 76/78 người bị báo "Hết phép", không gửi được phép năm |
| 3 | `totalDays` kiểu số nguyên | Schema `hrm_leave_requests` | Đơn nửa ngày (0,5) không lưu được. Luật BHXH 2024 cũng đã có chế độ ốm nửa ngày |
| 4 | Đơn "Không lương" vẫn lưu `isPaid = true` | 2/2 đơn không lương | Sai khi tính lương |
| 5 | Người xin tự chọn chuỗi duyệt từ toàn bộ người dùng (`:207`), nhưng chỉ **10 tài khoản** có quyền duyệt | RLS cập nhật đơn cần `hrm.leave.approve` | Trưởng phòng được chọn không duyệt được, đơn treo; 2 đơn đang chờ không có người duyệt |
| 6 | Không thông báo, không đưa vào "Việc cần làm" | Không có luồng thông báo cho `hrm_leave_requests` | Người duyệt không biết có đơn |
| 7 | HR duyệt thay thì nhật ký ghi tên người duyệt của bước đó | `LeaveManagement.tsx:233-235`, `AppContext.tsx:3479` | **Sai người thực hiện** trong lịch sử |
| 8 | Trừ phép, sinh công "nghỉ", hoàn phép khi thu hồi chạy ở trình duyệt, nhiều lệnh rời rạc; mã NP-xxxx sinh ở máy | `:231-311` | Lỗi giữa chừng làm dữ liệu lệch; có thể trùng mã |
| 9 | Duyệt đơn nửa ngày đánh cả ngày là "nghỉ phép" | `:247-258` | Ghi đè công buổi làm còn lại |
| 10 | Tính ngày nghỉ bỏ qua thứ Bảy | `:113-125` | Sai với lịch làm thứ Bảy của công trường |
| 11 | Người có quyền duyệt sửa và xóa được nhật ký duyệt | RLS `hrm_leave_logs_approve_update/delete` | Lịch sử không còn bất biến |
| 12 | Trigger mặc định cộng 1,5 ngày/tháng (18 ngày/năm) | `accrue_leave_balances` | Khác mức luật (12 ngày/năm cho điều kiện bình thường) |
| 13 | Form có "Mức ưu tiên", "Hạn SLA", Kanban 4 cột; thiếu loại đi muộn/về sớm, ra ngoài, công tác, giải trình | UI | Không hợp với người xin nghỉ |

### 4.2 Đề xuất: "Chính sách nghỉ & phê duyệt" — phần quản trị riêng cho HR

Gồm 3 lớp, HR tự cấu hình, không cần lập trình:

**(1) Danh mục loại nghỉ / đơn từ.** Mỗi loại có thuộc tính: ai trả lương, có trừ phép năm không, đơn vị tính (ngày / nửa ngày / giờ), có cần chứng từ không, báo trước bao lâu, trần mỗi lần, áp dụng cho ai.

| Loại | Trả lương | Trừ phép năm | Đơn vị | Căn cứ |
|---|---|---|---|---|
| Phép năm | Công ty | Có | Ngày / nửa ngày | Điều 113–114 BLLĐ 2019: 12/14/16 ngày theo điều kiện công việc; +1 ngày mỗi 5 năm; dưới 12 tháng tính theo tỷ lệ |
| Việc riêng có lương: kết hôn 3 ngày; con kết hôn 1; bố mẹ (hai bên), vợ/chồng, con mất 3 | Công ty | Không | Ngày | Điều 115 khoản 1 |
| Việc riêng không lương 1 ngày (ông bà, anh chị em ruột mất; bố mẹ, anh chị em kết hôn) và nghỉ không lương thỏa thuận | Không | Không | Ngày / nửa ngày | Điều 115 khoản 2–3 |
| Ốm đau, con ốm (có chế độ nửa ngày) | Quỹ BHXH | Không | Ngày / nửa ngày | Luật BHXH 2024 (hiệu lực 01/07/2025); cần giấy nghỉ hưởng BHXH |
| Thai sản, khám thai, vợ sinh con | Quỹ BHXH | Không | Ngày | Luật BHXH 2024 |
| Đi muộn / về sớm / ra ngoài có lý do | Theo giờ làm thực tế | Không (hoặc trừ phép theo giờ nếu chính sách cho phép) | Phút / giờ | Nội quy lao động. **Không được phạt tiền hoặc cắt lương thay kỷ luật** (Điều 127 khoản 2) |
| Công tác | Tính công | Không | Ngày / nửa ngày | Quy chế công ty; nối Tạm ứng |
| Giải trình chấm công (quên vào/ra, ngoài vị trí) | — | — | Lượt | Quy chế chấm công |
| Nghỉ lễ, Tết | Công ty | — | Tự động từ lịch | Điều 112 + Nghị quyết Ngày Văn hóa Việt Nam 24/11 |

**(2) Quy tắc phê duyệt**: điều kiện → chuỗi người duyệt. Hệ thống **tự xác định người duyệt** theo sơ đồ tổ chức; người xin không phải chọn. Ví dụ theo yêu cầu của anh:

| Loại | Điều kiện | Bước 1 | Bước 2 | Nhận thông báo |
|---|---|---|---|---|
| Phép năm | ≤ 3 ngày làm việc | Trưởng bộ phận | — | HR |
| Phép năm | > 3 ngày | Trưởng bộ phận | Giám đốc phụ trách | HR |
| Không lương (chưa có hoặc hết phép) | ≤ 3 ngày | Trưởng bộ phận | — | HR |
| Không lương | > 3 ngày | Trưởng bộ phận | Giám đốc phụ trách | HR |
| Đi muộn / về sớm có lý do | Mọi trường hợp | Trưởng bộ phận | — | — |
| Ốm (BHXH) | Mọi trường hợp | Trưởng bộ phận | HR kiểm chứng từ | — |
| Giải trình chấm công | Mọi trường hợp | Quản lý địa điểm hoặc trưởng bộ phận | — | — |

Cách hiểu "Trưởng bộ phận": văn phòng là trưởng phòng; công trường là **Chỉ huy trưởng** của công trường đang điều động; nhà máy là Giám đốc hoặc Quản đốc nhà máy. Các quy tắc đi kèm:
- Người xin là trưởng bộ phận thì tự nhảy lên cấp trên, không tự duyệt.
- Một người đứng hai bước thì gộp thành một.
- Người duyệt vắng thì dùng ủy quyền có thời hạn; quá hạn SLA thì nhắc, rồi chuyển cấp.
- HR "duyệt thay" phải ghi lý do và ghi đúng tên HR.
- Trước khi gửi, người xin thấy rõ: "Đơn sẽ do A duyệt → B duyệt".

**(3) Sổ phép** (ledger, không sửa đè con số). Mỗi biến động là một dòng, có người, thời điểm, lý do:
- cấp đầu kỳ hoặc cộng tháng; cộng thâm niên;
- giữ chỗ khi gửi đơn → trừ khi duyệt → hoàn khi từ chối, hủy hoặc đi làm sớm;
- điều chỉnh tay (bắt buộc lý do);
- chuyển phép tồn sang năm sau, hết hạn phép tồn;
- thanh toán phép chưa nghỉ khi thôi việc.

Số dư = tổng các dòng.

Tình huống cần tính sẵn:
- Đơn vắt qua năm (30/12 → 03/01): tách theo số dư từng năm.
- Đơn trùng ngày lễ, ngày nghỉ theo lịch làm việc: không tính.
- Xin sau khi đã nghỉ (đột xuất): cho phép trong N ngày, có lý do.
- Hủy hoặc rút một phần sau khi duyệt.
- Sửa sau khi đã chốt công hoặc lương: chuyển thành điều chỉnh kỳ sau.
- Nhân viên thử việc, mới vào làm giữa năm.

**Trải nghiệm**:
- Nhân viên xin nghỉ trong 3 bước: chọn loại → chọn ngày (cả ngày / sáng / chiều / giờ) → xem trước số dư và người duyệt, rồi gửi.
- Người duyệt có một hộp "Chờ tôi duyệt": duyệt hoặc từ chối nhanh, xem lịch vắng của đội.
- HR có lịch nghỉ toàn công ty và màn cấu hình chính sách có "thử quy tắc" (nhập một đơn giả định để xem ai sẽ duyệt).

**Kiến trúc**: dùng chung lõi duyệt với Module Yêu cầu (hộp việc cần làm, nhắc hạn, chuyển người duyệt, ủy quyền, lịch sử) để người dùng chỉ có một nơi duyệt. Phần riêng của HR là "bộ phân giải chính sách": từ loại đơn, số ngày và nhân viên sinh ra chuỗi bước. Lõi Yêu cầu hiện chỉ có nguồn người duyệt cố định / quản lý trực tiếp / người tạo chọn, chưa có bước theo điều kiện; cần bổ sung.

---

## 5. Lịch làm việc và phân ca (ý 6)

Hiện trạng:
- Có "Ca" (giờ, thời gian ân hạn, hệ số OT, ca đêm) và lưới phân ca theo tháng (bấm từng ô). Chỉ một ca được dùng.
- "Lịch làm việc" chỉ có 4 mốc giờ, 3 lịch giống hệt nhau.
- Giờ vào/ra theo địa điểm có nhập nhưng không dùng.
- Server chấm công không biết ca; đi muộn chỉ tô màu trên bảng công.
- "Điền cả tháng" bỏ qua thứ Bảy. Ca qua nửa đêm không hoạt động (lượt ra 06:00 sẽ bị từ chối vì "chưa có check-in").

Đề xuất mô hình, **một nguồn sự thật cho giờ làm**:
1. **Ca**: giờ bắt đầu và kết thúc, nghỉ giữa ca, ân hạn đi muộn/về sớm, số giờ chuẩn, cờ ca đêm, khung được chấm (ví dụ ±2 giờ).
2. **Mẫu lịch tuần**: ví dụ "Văn phòng: T2–T6 ca HC, T7 sáng"; "Công trường: T2–T7 07:30–17:00"; "Nhà máy: 3 ca xoay".
3. **Áp dụng theo nhóm** (khối, đơn vị, công trường, chức danh) có hiệu lực từ–đến, **ghi đè** cho từng người hoặc từng ngày (đổi ca, tăng cường).
4. **Lịch ngày lễ** theo năm, có nghỉ bù; HR được nhắc chuẩn bị lịch năm mới.
5. **"Lịch làm việc của tôi"** cho nhân viên (chỉ xem); đề nghị đổi ca (G4).
6. Bảng công tính theo: ca dự kiến + đơn đã duyệt + lượt chấm → công, phút muộn/sớm, OT, ngoại lệ.
7. **Tăng ca**: đăng ký trước → duyệt → công OT = phần giao giữa giờ đăng ký và giờ chấm thực tế; cảnh báo trần giờ.

---

## 6. Hồ sơ nhân sự và tổ chức (ý 1)

### 6.1 Đang có (giữ lại)

- Hồ sơ 8 nhóm: Tổng quan · Cá nhân & liên hệ · Công việc & tổ chức · Chấm công & nghỉ phép · Hợp đồng & quá trình · Pháp lý & bảo hiểm · Lương, thuế & ngân hàng · Trình độ & hồ sơ.
- Phân lớp C1 (danh bạ) → C4 (ngân hàng, thuế).
- Mức truy cập SELF / MANAGER / HR / HR_MANAGE / DIRECTORY tính ở server; mọi lệnh sửa có lý do và kiểm toán; có bộ nhập Excel nhiều sheet.
- Sơ đồ tổ chức: Tiến Thịnh Group → Khối 1 VP (8 phòng) / Khối 2 công trường (5 BCH) / Khối 3 nhà máy (4 tổ + VP nhà máy). Có định biên theo vị trí, khung bậc E1–E11 theo nhóm vị trí (BoD, CG, CV, NV, CN, QLCT, QLN).

### 6.2 Vấn đề

- **Dữ liệu gần như trống** (mục 1). Nguyên nhân chính là giao diện nhập: biểu mẫu bắt HR gõ "Mã bản ghi", "Mã ngân hàng", "Mã trình độ", "Mã cư trú thuế", "Nguồn tham chiếu" (`pages/ep/HrmPersonnelProfile.tsx:45-100`), tức thiết kế theo database.
- **Hai màn "hồ sơ của tôi" khác nhau**: `/my-profile` (5 tab Cá nhân/Công việc/Liên hệ/Tài sản/Thành tích) và hồ sơ 8 nhóm. Nhân viên không xem được HĐLĐ, BHXH, tài khoản lương của chính mình (quyết định V1 tháng 8). Luật BVDLCN 2025 cho chủ thể dữ liệu quyền truy cập dữ liệu của mình.
- **Hai nguồn "quản lý trực tiếp"**: `users.manager_id` (34/88 người có, Module Yêu cầu và đặt xe đang dùng) và cây vị trí HRM (0/78 xác định được). Cần hợp nhất trước khi làm duyệt phép.
- **Nhân sự công trường không nằm trong cây HR**: các BCH có 0 người, trong khi `project_staff` có 45 người. `project_staff` còn chứa cả TGĐ, kế toán trưởng, lễ tân (để phân quyền Room), nên không dùng thẳng làm "nơi làm việc".
- **Danh mục vị trí bẩn**: 13 tên là số, mục test "G3 BOQ position", 6 tên trùng, 4 chức danh gắn tên dự án (ví dụ "Chỉ huy trưởng BCH RICO"; nên là "Chỉ huy trưởng" + đơn vị). Dự án SMB đã "completed" nhưng 28 người vẫn được gán và vẫn chấm công ở đó.
- **Mô hình địa chỉ còn cấp huyện**: từ 01/07/2025 chính quyền địa phương 2 cấp (34 tỉnh/thành, không còn cấp huyện), địa chỉ mới chỉ còn tỉnh + xã/phường.
- **Mã số thuế cá nhân**: từ 01/07/2025 dùng số định danh (CCCD) thay MST cho người nộp thuế và người phụ thuộc (Thông tư 86/2024/TT-BTC).

### 6.3 Đề xuất

**Thông tin theo vòng đời nhân sự**: Tuyển dụng → Tiếp nhận (onboarding) → Thử việc → Chính thức (HĐLĐ, phụ lục) → Điều chuyển / bổ nhiệm / điều chỉnh lương (quyết định) → Khen thưởng / kỷ luật → Đào tạo / chứng chỉ → Nghỉ việc (bàn giao tài sản, thanh toán phép tồn, chốt BHXH, lưu trữ hoặc xóa dữ liệu theo luật). Mỗi sự kiện là một dòng "quá trình công tác" có quyết định đính kèm, không sửa đè.

**Nhóm thông tin bổ sung** (HR nhập bằng danh sách chọn, không gõ mã):
- *Cá nhân*: họ tên, giới tính, ngày sinh, nơi sinh, quê quán, quốc tịch, dân tộc; CCCD (số, ngày cấp, nơi cấp, hết hạn, ảnh 2 mặt); địa chỉ thường trú / tạm trú theo 2 cấp; liên hệ cá nhân; người liên hệ khẩn cấp. *Tôn giáo và sức khỏe là dữ liệu nhạy cảm, chỉ thu nếu thật cần và có đồng ý.*
- *Công việc*: mã NV, đơn vị, vị trí, bậc, loại nhân sự (chính thức / thử việc / thời vụ / cộng tác / khoán), nơi làm việc chính, quản lý trực tiếp, ngày vào, ngày hết thử việc, ngày chính thức, ngày tính thâm niên, lịch làm việc, trạng thái (đang làm / thử việc / thai sản / tạm hoãn HĐ / nghỉ không lương dài / đã nghỉ).
- *Hợp đồng*: lịch sử HĐ và phụ lục, loại, thời hạn (xác định thời hạn tối đa 36 tháng, tối đa 2 lần), file ký, cảnh báo trước 30 ngày.
- *BHXH và thuế*: số BHXH, nơi khám chữa bệnh, mức đóng theo thời gian, báo tăng / giảm; MST = số CCCD; người phụ thuộc (thời gian giảm trừ).
- *Ngân hàng*: chọn ngân hàng từ danh sách, một tài khoản nhận lương.
- *Năng lực*: bằng cấp; **chứng chỉ có hạn** (ATLĐ, hành nghề xây dựng, thợ hàn, vận hành cẩu, GPLX) có cảnh báo hết hạn, nối với "Hộ chiếu an toàn" ở công trường.
- *Khác*: tài sản và bảo hộ lao động đã cấp (đã có), khen thưởng / kỷ luật, đào tạo, KPI.

**Tự phục vụ**:
- Nhân viên xem toàn bộ hồ sơ của mình (C3/C4 chỉ xem).
- Sửa trực tiếp liên hệ cá nhân.
- Thông tin cần xác thực (CCCD, tài khoản ngân hàng, người phụ thuộc, bằng cấp) gửi **"Đề nghị cập nhật"** kèm ảnh, HR duyệt rồi mới ghi vào hồ sơ. Một màn "Hồ sơ của tôi" duy nhất, dùng chung khung 8 nhóm.

**HR làm việc theo việc cần làm**: bảng "Hồ sơ thiếu" theo người và trường, nhập hàng loạt từ Excel (đã có pipeline, cần đổi sang tên dễ hiểu), HĐ sắp hết hạn, hết thử việc, chứng chỉ sắp hết hạn, sinh nhật.

**Tổ chức**:
- Một nguồn "quản lý trực tiếp" do HR duy trì trên sơ đồ (trưởng đơn vị + người được chỉ định), có hiệu lực từ–đến. Mọi module (nghỉ phép, Yêu cầu, đặt xe) đọc từ đây.
- Mỗi công trường có một đơn vị BCH gắn với dự án; **điều động** nhân sự tới công trường có ngày bắt đầu–kết thúc. Điều động là nguồn cho địa điểm chấm công, người duyệt (chỉ huy trưởng) và phân bổ chi phí nhân công.
- Dọn danh mục vị trí; chức danh không gắn tên dự án.

---

## 7. Quyền riêng tư (ý 7)

### 7.1 Ma trận đề xuất

| Dữ liệu | Bản thân | Đồng nghiệp | Trưởng bộ phận / QL trực tiếp | Quản lý địa điểm | HR | HR Manage | Admin hệ thống |
|---|---|---|---|---|---|---|---|
| Danh bạ: tên, chức danh, đơn vị, SĐT/email công việc | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ngày sinh, hôn nhân, liên hệ cá nhân, địa chỉ | ✓ | Chỉ ngày/tháng sinh nếu NV đồng ý | — | — | ✓ | ✓ | — |
| CCCD, BHXH, thuế, ngân hàng, người phụ thuộc | Xem | — | — | — | ✓ (sửa C3, xem C4) | ✓ | — |
| Lương, đãi ngộ | Phiếu đã chốt | — | — | — | Xem | ✓ | — |
| Giờ chấm công, trạng thái công | ✓ | — | Cấp dưới | Người chấm tại địa điểm mình | ✓ | ✓ | — |
| Ảnh và tọa độ chấm công | ✓ | — | Khi xác nhận ngoại lệ | Khi xác nhận ngoại lệ | ✓ | ✓ | — |
| Ngày nghỉ, loại nghỉ | ✓ | Lịch "vắng mặt" (không lý do) | ✓ | Ai vắng ở công trường | ✓ | ✓ | — |
| Lý do nghỉ, giấy tờ y tế | ✓ | — | Người duyệt đơn | — | ✓ | ✓ | — |
| KPI, khen thưởng, kỷ luật | ✓ | — | Cấp dưới | — | ✓ | ✓ | — |

### 7.2 Lỗ hổng hiện có

| Mức | Vấn đề | Bằng chứng |
|---|---|---|
| Cao | **50/88 tài khoản xem được toàn bộ đơn nghỉ phép của công ty, kể cả lý do**; với quyền này còn tạo được đơn cho người khác | `hrm.leave.view` phạm vi toàn công ty, chủ yếu sinh ra từ "Chuyển từ vai trò LEGACY_HR_… (P3, 28/09)". Màn chấm công đã có bản vá riêng cho trường hợp này (`lib/hrmAttendanceVisibility.ts`), nghỉ phép thì chưa |
| Cao (khi mở rộng AI) | **Trợ lý AI tra được ngày sinh, hôn nhân, SĐT** của bất kỳ ai (`ai_tool_employee_search`) và **giờ chấm công** của mọi người (`ai_tool_attendance_report`). Các tool HR chạy bằng service role, không kiểm quyền HR | `supabase/functions/ai-assistant/index.ts:545`: tool không có trong `TOOL_ACCESS` thì được phép. Hiện 5 tài khoản dùng AI |
| Trung bình | Ảnh chấm công: nhân viên sửa và xóa được ảnh của mình; ảnh lưu vô thời hạn (1.051 ảnh) | Policy `checkin_photos_update/delete` |
| Trung bình | Nhật ký duyệt phép sửa hoặc xóa được; bảng công sửa không lý do, không lịch sử | RLS `hrm_leave_logs`; không có trigger kiểm toán |
| Trung bình | 50 tài khoản có `hrm.employee.view_profile` toàn công ty (cùng nguồn legacy). Server hiện chặn dữ liệu C2 nhờ kiểm vai trò HR, nhưng quyền đang ghi sai ý định | `user_permission_grants` |
| Thấp | Điểm KPI: mọi tài khoản đọc được tất cả (bảng đang trống) | `kpi_scores_select = true` |
| Thấp | Khách chưa đăng nhập (anon) đọc được tên, địa chỉ, tọa độ công trường, văn phòng, lịch làm việc | Policy `{public}` trên `hrm_construction_sites`, `hrm_offices`, `hrm_work_schedules` |

### 7.3 Tuân thủ Luật Bảo vệ dữ liệu cá nhân 2025 (Luật 91/2025/QH15, Nghị định 356/2025, hiệu lực 01/01/2026)

- **Vị trí** và **sinh trắc học** thuộc nhóm dữ liệu cá nhân nhạy cảm. Điều 31 cấm theo dõi vị trí khi không có đồng ý và yêu cầu ngăn thu thập dữ liệu không liên quan.
- Điều 25 khoản 2: dữ liệu thu bằng biện pháp công nghệ trong quản lý lao động phải được người lao động biết. Lưu theo thời hạn luật định hoặc thỏa thuận; xóa, hủy khi chấm dứt hợp đồng, trừ khi luật khác yêu cầu giữ (BHXH, thuế…).
- Việc cần làm:
  1. Thông báo và ghi nhận đồng ý ở lần chấm công đầu: thu ảnh khuôn mặt và vị trí **chỉ tại thời điểm bấm**, dùng cho chấm công và tính lương. Lưu phiên bản điều khoản đã đồng ý.
  2. Đưa vào **Quy chế chấm công / Nội quy lao động**.
  3. Thời hạn lưu ảnh và tọa độ (anh chốt, đề xuất 12 tháng sau kỳ chốt công), sau đó tự xóa ảnh, giữ kết quả công.
  4. Ghi nhật ký mỗi lần HR xem hoặc xuất dữ liệu C3/C4.
  5. **Không** làm nhận diện khuôn mặt tự động ở giai đoạn này: mẫu khuôn mặt là dữ liệu sinh trắc học, nghĩa vụ cao hơn. Ảnh chỉ làm bằng chứng.
  6. Nhờ pháp chế xác nhận nghĩa vụ lập hồ sơ đánh giá tác động xử lý dữ liệu cá nhân.

---

## 8. Phát hiện ngoài 7 ý anh nêu

- **Lương**:
  - Mẫu bảng lương lấy lương từ HĐLĐ, nhưng hệ thống có 0 HĐLĐ, nên đang nhập lương từ Excel. Ngày công chuẩn cố định 26.
  - Công thức chạy ở trình duyệt.
  - Tham số luật 2026 đã đổi: lương tối thiểu vùng (NĐ 293/2025: I 5,31tr; II 4,73tr; III 4,14tr; IV 3,70tr); giảm trừ gia cảnh 15,5tr, người phụ thuộc 6,2tr. Cần bảng tham số có ngày hiệu lực, không ghi cứng trong công thức.
  - Phiếu lương cá nhân đã đúng: chỉ hiện bản `confirmed` / `paid`.
- Cảnh báo "HĐLĐ hết hạn" (đợt 1, 27/09) không có tác dụng vì chưa có HĐ nào; log còn 1 lỗi `column hrm_labor_contracts.employeeId does not exist`.
- 31 lỗi `HRM_EMPLOYEE_DIRECTORY_REQUIRED` và 9 lỗi `HRM_CONTRACT_VIEW_REQUIRED` trong 24 giờ: giao diện gọi dữ liệu khi người dùng chưa có quyền. Cần ẩn đúng theo quyền, không để lỗi im lặng.
- 6 tài khoản thật chưa có hồ sơ nhân sự nên không chấm công được. Cần quy trình "tạo tài khoản ⇄ tạo hồ sơ" một lần.
- Đề xuất phát sinh từ đúng nguồn dữ liệu chấm công: công theo công trường là đầu vào **chi phí nhân công dự án** (nối mô hình vòng khép kín Module Dự án).

---

## 9. Lộ trình đề xuất

| Giai đoạn | Nội dung | Tiêu chí xong |
|---|---|---|
| **G0 — Sửa gấp (3–5 ngày)** | (1) Mở lại màn cấu hình địa điểm (lấy tọa độ tại chỗ, bản đồ, bán kính, người quản lý); nhập tọa độ 4 công trường; kiểm SMB và Nhà máy KCT. (2) Sửa lỗi tọa độ trống → 0; dùng sai số GPS; ngày làm việc tính lúc bấm. (3) Cho chấm "ra" khi chưa có "vào" (đánh dấu thiếu giờ vào). (4) Layout mobile một màn hình. (5) Sửa trigger số dư phép; `totalDays` nhận 0,5; `isPaid` theo loại. (6) Thu hồi `hrm.leave.view` toàn công ty của nhóm legacy (giữ HR); chặn tool AI HR theo quyền. (7) Bổ sung ngày lễ 2026 còn thiếu | Lượt ngoài phạm vi do cấu hình về ~0; không còn lỗi `last_accrual_month`; chỉ HR thấy đơn của người khác |
| **G1 — Chấm công đúng & tự động (2–3 tuần)** | Server tính khoảng cách và dùng giờ server; ngoài phạm vi → "Chờ xác nhận"; địa điểm được phép theo nơi làm việc + điều động; tự chọn theo vùng; giải trình ngay trên ngày lỗi; ảnh bất biến + thời hạn lưu; thông báo / đồng ý; kiểm toán bảng công; bật lại nhắc chấm công | Nhân viên chấm trong ≤ 5 giây, không phải chọn địa điểm; mọi sửa công có lý do + lịch sử |
| **G2 — Nghỉ phép & phê duyệt (3–4 tuần)** | Danh mục loại đơn; quy tắc duyệt theo điều kiện; người duyệt tự xác định; sổ phép; đi muộn / về sớm / công tác / giải trình; hộp "chờ tôi duyệt" + thông báo + ủy quyền; lịch vắng mặt của đội | Đơn ≤ 3 ngày tự tới trưởng bộ phận; > 3 ngày tự thêm giám đốc; số dư đúng sau duyệt / hủy |
| **G3 — Hồ sơ & tổ chức (4–6 tuần)** | Một nguồn quản lý trực tiếp; BCH theo công trường + điều động; dọn danh mục vị trí; biểu mẫu hồ sơ thân thiện; tự phục vụ + đề nghị cập nhật; vòng đời và quyết định; cảnh báo HĐ / chứng chỉ; địa chỉ 2 cấp | ≥ 95% nhân sự đủ thông tin bắt buộc; bật được chế độ quản lý trực tiếp |
| **G4 — Ca, OT, chốt công, lương** | Mẫu lịch tuần, ca đêm, đổi ca; đăng ký OT + trần giờ; NV xác nhận bảng công → HR chốt kỳ; chấm công tập trung (QR / chỉ huy chấm hộ / offline); chuyển công sang lương và chi phí dự án | Bảng công khóa theo kỳ; điều chỉnh sau khóa đi kỳ sau |

Nguyên tắc triển khai: làm theo nhánh, migration lên Cloud chỉ sau khi anh xác nhận. Đổi quy tắc chấm công thì **chạy song song 2 tuần không trừ công**, kèm thông báo nhân viên, rồi mới áp dụng chính thức.

---

## 10. Quyết định cần anh chốt

1. **Ngoài phạm vi**: chặn hẳn, hay cho gửi "chấm công ngoài vị trí" (bắt buộc lý do + ảnh) để quản lý địa điểm hoặc trưởng bộ phận xác nhận? *(Đề xuất: cho gửi, chưa xác nhận thì không tính công.)*
2. **Bán kính mặc định**: công trường 300 m, văn phòng / nhà máy 150 m?
3. **Một nút "Chấm công"** (hệ thống tự hiểu vào / ra), hay giữ hai nút nhưng không chặn?
4. **Phép năm**: cấp 12 ngày đầu năm hay cộng 1 ngày/tháng; thử việc có được nghỉ phép không; phép tồn dùng tới hết quý I năm sau?
5. **Ngưỡng 3 ngày** tính theo ngày làm việc (đề xuất) hay ngày lịch; xét từng đơn hay cộng dồn trong tháng?
6. **"Trưởng bộ phận" của nhân sự công trường** là Chỉ huy trưởng hay Trưởng phòng QLDA? **"Giám đốc" ở bước 2** là giám đốc phụ trách khối hay Giám đốc điều hành?
7. **Đi muộn / về sớm**: hạn mức (ví dụ 3 lần/tháng, ≤ 60 phút/lần)? Công tính theo giờ thực tế hay quy đổi nửa ngày? *(Lưu ý: không được phạt tiền.)*
8. **Thời gian lưu ảnh và tọa độ chấm công**: 12 tháng sau kỳ chốt công?
9. **Danh sách HR / HR Manage chính thức**; có cho nhân viên tự xem HĐLĐ, BHXH, tài khoản lương của mình không (đổi quyết định V1)?
10. **Công nhân tổ đội** (nhà máy, công trường) có quản lý và chấm công trên Vioo không? Nếu có thì dùng chấm công tập trung.

---

## 11. Quyết định chủ sản phẩm đã chốt (02/10/2026)

| # | Quyết định | Hệ quả thiết kế |
|---|---|---|
| 1 | **Chặn hẳn** chấm công ngoài phạm vi | Server tự tính khoảng cách + giờ server; ngoài vùng hoặc GPS chưa đủ chính xác thì không ghi lượt. Người dùng thấy lý do + nút "Đề xuất chấm công bù" (luồng đã có ở server, người duyệt theo #6) |
| 2 | Bán kính mặc định: công trường **300 m**, văn phòng / nhà máy **150 m** | Admin chỉnh từng địa điểm |
| 3 | **Một nút "Chấm công"** | Lượt đầu = vào, lượt cuối = ra; không chặn "ra" khi thiếu "vào"; ngày thiếu lượt → nhắc giải trình |
| 4 | Phép năm **cộng 1 ngày vào mùng 1 mỗi tháng**; **thử việc không có phép**; **phép tồn dùng tới hết quý I** năm sau; **HR và HR Manage được sửa trực tiếp số phép còn lại** | Job chạy ngày 1 hằng tháng (chỉ nhân sự đã chính thức); hết 31/03 tự hết hạn phép tồn. Sửa trực tiếp vẫn ghi thành một dòng "điều chỉnh" trong sổ phép (người sửa, giá trị trước/sau, lý do) để truy vết |
| 5 | Ngưỡng ngày tính theo **ngày làm việc** | Trừ ngày nghỉ theo lịch làm việc và ngày lễ |
| 6 | Mỗi **địa điểm chấm công** (công trường / văn phòng) có **người duyệt chấm công do Admin chọn** (bất kỳ ai). Đề xuất chấm công bù gửi người này; duyệt xong công ghi vào bảng công | Trường `managerId` của địa điểm đã có và RPC duyệt bù công đã dùng nó; chỉ cần đưa lại màn cấu hình (tọa độ, bán kính, người duyệt) vào Cài đặt. Hiện 6/8 địa điểm đang gán Admin Hoàng |
| 7 | Hạn mức đi muộn / về sớm là tùy chọn, mẫu **60 phút**; HR chỉnh sau | Tham số trong chính sách |
| 8 | Lưu ảnh chấm công **60 ngày**; **nén ảnh** sau khi chụp | Nén ở máy trước khi tải lên (cạnh dài ~720 px, JPEG ~0,6 → khoảng 40–80 KB/ảnh); job hằng ngày xóa ảnh quá 60 ngày, giữ kết quả công |
| 9 | HR chính thức: **Trần Thị Tươi**; HR Manage: **Nguyễn Thị Giang**. Nhân viên **được tự xem hợp đồng và BHXH** của mình | Đổi quyết định V1: thêm mục HĐ + BHXH chỉ xem ở mức SELF. Hiện có vai trò HR: Admin Hoàng (HR Manage), Đặng Thị Hương, Hà Thị Hải Hồng, Hoàng Công Minh, Nguyễn Thị Giang (HR Manage); **Trần Thị Tươi chưa có** |
| 10 | Tạm chưa chấm công công nhân tổ đội | Bỏ "chấm công tập trung" khỏi G4 |

Bổ sung 02/10 (lần 2):
- **Không thu hồi** vai trò HR hiện có; chủ sản phẩm tự thêm HR cho Trần Thị Tươi.
- Hạn mức đi muộn / về sớm **60 phút mỗi lần**. Muộn có lý do (ví dụ đi xử lý công việc), gửi trưởng bộ phận và được duyệt → **tính đủ công**. Muộn không lý do hoặc không được duyệt → ghi **giờ muộn**, cộng dồn tới hết tháng.
- G0 triển khai trên nhánh riêng `feature/hrm-g0-attendance-leave` (worktree `.worktrees/hrm-g0`, tách từ `origin/main`).

Còn mở (cần trước G2): người duyệt **nghỉ phép** của nhân sự văn phòng ở bước 1 (trưởng phòng theo sơ đồ hay người duyệt của địa điểm) và "Giám đốc" ở bước 2 (> 3 ngày).

---

## Phụ lục A — Vị trí lỗi chính trong mã

| Vấn đề | Vị trí |
|---|---|
| Tọa độ trống thành 0 | `pages/hrm/CheckIn.tsx:48-51` |
| Ngày làm việc tính một lần khi mở trang | `pages/hrm/CheckIn.tsx:144` |
| GPS đọc một lần, bỏ qua sai số | `pages/hrm/CheckIn.tsx:258-278` |
| Camera 3:4 đẩy nút xuống dưới; nút không khóa khi ngoài phạm vi; khóa "ra" khi chưa "vào" | `pages/hrm/CheckIn.tsx:449-555` |
| Upload ảnh `upsert` | `lib/checkInService.ts:150-156` |
| RPC chấm công tin dữ liệu điện thoại, tự duyệt, chặn "ra" | `app_private.employee_camera_checkin_v1` |
| Danh sách địa điểm toàn công ty | `app_private.get_my_checkin_context` |
| Màn cấu hình địa điểm bị ẩn | `pages/Settings.tsx:1825` |
| Trigger số dư phép sai tên cột | `public.accrue_leave_balances()` |
| Tính ngày nghỉ, số dư, chuỗi duyệt, duyệt ở client | `pages/hrm/LeaveManagement.tsx:113-311`, `context/AppContext.tsx:3479-3515` |
| Đổi / xóa ô công không lý do | `pages/hrm/Attendance.tsx:193-213` |
| Tool AI HR không kiểm quyền | `supabase/functions/ai-assistant/index.ts:545` + `public.ai_tool_employee_search`, `public.ai_tool_attendance_report` |

## Phụ lục B — Nguồn tham khảo

- Luật BVDLCN 2025, Điều 31 (vị trí, sinh trắc học): [xaydungchinhsach.chinhphu.vn](https://xaydungchinhsach.chinhphu.vn/quy-dinh-bao-ve-du-lieu-ca-nhan-doi-voi-du-lieu-vi-tri-ca-nhan-du-lieu-sinh-trac-hoc-119250730155653784.htm)
- 13 nhóm dữ liệu nhạy cảm, Nghị định 356/2025: [doanhnghiephoinhap.vn](https://doanhnghiephoinhap.vn/13-nhom-du-lieu-ca-nhan-nhay-cam-phai-duoc-bao-ve-tu-nam-2026-149766.html)
- Điều 25, dữ liệu người lao động: [lsvn.vn](https://lsvn.vn/nhung-du-lieu-doanh-nghiep-khong-duoc-thu-thap-khi-tuyen-dung-quan-ly-nhan-su-a169304.html), [mps.gov.vn](https://mps.gov.vn/chinh-sach-phap-luat/bai-viet/mot-so-quy-dinh-dang-chu-y-trong-luat-bao-ve-du-lieu-ca-nhan-2025-1753847906)
- Ngày Văn hóa Việt Nam 24/11 (nghỉ hưởng lương, từ 01/07/2026): [xaydungchinhsach.chinhphu.vn](https://xaydungchinhsach.chinhphu.vn/ngay-24-11-hang-nam-la-ngay-van-hoa-viet-nam-nguoi-lao-dong-duoc-nghi-huong-nguyen-luong-119260113152642414.htm)
- Giỗ Tổ 2026 (CN 26/4, nghỉ bù 27/4): [cafef.vn](https://cafef.vn/gio-to-hung-vuong-2026-roi-vao-ngay-nao-duong-lich-188260311171031505.chn) · Tết 2026: [anloc.dongnai.gov.vn](https://anloc.dongnai.gov.vn/vi/news/thong-bao/lich-nghi-tet-nguyen-dan-2026-voi-nguoi-lao-dong-445.html)
- Trần làm thêm giờ, Nghị định 145/2020: [snv.dongnai.gov.vn](https://snv.dongnai.gov.vn/vi/news/thong-bao/dong-nai-luu-y-doanh-nghiep-thuc-hien-dung-quy-dinh-ve-lam-them-gio-319.html)
- Điều 127 BLLĐ 2019 (cấm phạt tiền, cắt lương): [hethongphapluat.com](https://hethongphapluat.com/bo-luat-lao-dong-2019/dieu-127)
- Luật BHXH 2024, ốm đau (có nửa ngày): [xaydungchinhsach.chinhphu.vn](https://xaydungchinhsach.chinhphu.vn/nhieu-diem-moi-bao-ve-quyen-loi-nguoi-lao-dong-khi-om-dau-tu-1-7-119250701055407208.htm), [baohiemxahoi.gov.vn](https://baohiemxahoi.gov.vn/tintuc/Pages/linh-vuc-bao-hiem-xa-hoi.aspx?ItemID=23392&CateID=168)
- Lương tối thiểu vùng 2026, NĐ 293/2025: [thuvienphapluat.vn](https://thuvienphapluat.vn/phap-luat-doanh-nghiep/bai-viet/cap-nhat-muc-luong-toi-thieu-vung-2026-chinh-thuc-theo-nghi-dinh-293-2025-nd-cp-15934.html)
- Giảm trừ gia cảnh 15,5tr / 6,2tr từ kỳ tính thuế 2026: [vnexpress.net](https://vnexpress.net/giam-tru-gia-canh-len-15-5-trieu-dong-tu-ky-tinh-thue-2026-4952515.html)
- Số định danh thay MST từ 01/07/2025: [lsvn.vn](https://lsvn.vn/tu-ngay-01-7-2025-so-dinh-danh-ca-nhan-se-duoc-su-dung-thay-cho-ma-so-thue-a153020.html)
- Chính quyền 2 cấp từ 01/07/2025: [thuvienphapluat.vn](https://thuvienphapluat.vn/chinh-sach-phap-luat-moi/vn/ho-tro-phap-luat/chinh-sach-moi/87400/luat-to-chuc-chinh-quyen-dia-phuong-moi-chi-con-don-vi-hanh-chinh-cap-tinh-va-cap-xa-tu-01-7-2025)
- Thực tiễn phần mềm chấm công VN (GPS / Wi-Fi / QR / khuôn mặt): [amis.misa.vn](https://amis.misa.vn/amis-cham-cong/)
- Điều khoản BLLĐ 2019 dẫn theo số điều: 98 (lương làm thêm), 105 (giờ làm), 107 (làm thêm), 112 (lễ, Tết), 113–115 (phép năm, thâm niên, việc riêng), 127 (cấm phạt tiền).
