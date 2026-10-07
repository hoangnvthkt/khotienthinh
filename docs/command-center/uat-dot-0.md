# Trung tâm điều hành đợt 0 — kịch bản nghiệm thu (UAT) theo vai

Chạy sau khi deploy `20261008138000` … `20261008138004` và bật thí điểm bằng `supabase/operations/center_dot0_pilot.sql`. Mỗi vai đăng nhập tài khoản thật, làm trên **máy tính (1440)** và **điện thoại (iPhone / Android)**. Đánh dấu ✅ / ❌ và ghi chú ngay dưới dòng. Nguyên tắc: **số ở Center phải bằng số ở màn module** (kế hoạch 07 mục 3.1 luật 2, 6).

## Chung cho mọi vai

- [ ] Mới đăng nhập: vẫn là giao diện hiện tại (Home như cũ, thanh bên không có mục Center). Người thí điểm thấy công tắc "Trung tâm điều hành" ở khối tài khoản (điện thoại: nút cạnh sáng/tối).
- [ ] Bật công tắc → lời chào "Chào anh/chị …" hiện mượt rồi mờ dần vào Center (bấm để bỏ qua); tải lại trang không chạy lại lời chào; trang chủ "/" giờ mở Center; thanh bên có mục kèm số việc chờ.
- [ ] Đang ở giao diện mới: máy tính có rail gọn (biểu tượng + tên app, số việc chờ ở Trung tâm, công tắc góc dưới trái); vào module khác rail vẫn giữ; không treo / đơ khi mở Center (sự cố 07/10).
- [ ] Lịch: số việc tới hạn hôm nay đúng; chọn một ngày và một khoảng ngày → cột việc lọc đúng (đếm khớp); Bỏ lọc; trên iPhone lịch vừa màn hình.
- [ ] Tắt công tắc (máy tính: góc dưới rail; điện thoại: ☰) → về Home cũ; bong bóng Chat không che công tắc; logo đầu rail về Center; người ngoài danh sách thí điểm **không** thấy công tắc, gõ `/center` thì bị chặn.
- [ ] Mở `/center`: thấy lời chào, ngày, "N việc chờ bạn · M ngày tới hạn hợp đồng" (khi có dự án).
- [ ] Số "Chờ tôi" ở cột trái = số cạnh mục ở thanh bên = số "Việc chờ bạn" trên Home.
- [ ] Việc của tôi: nhóm mặc định thu gọn, có số việc và "N gấp"; bấm nhóm để mở.
- [ ] Bấm một việc của **mỗi loại** đang có (nghỉ phép, chấm công bù, nhật ký, kế hoạch, đề xuất vật tư, phiếu kho, văn bản, Vioo Work, đặt xe, bảng công…) → màn xử lý mở **ngay trong tab**, đúng hồ sơ; duyệt / từ chối được tại chỗ; bấm qua lại trong màn đó không rời Center. Ghi lại loại nào hiển thị chật / lỗi.
- [ ] Ô "Hôm nay" chỉ có nút thao tác nhanh, tối đa 4 nút. Bấm 3 nút bất kỳ → mở ngay form / đúng màn (Xin nghỉ phép, Tạo đề xuất mở form tại chỗ).
- [ ] Bấm "… Xem thêm" hoặc nền ô → bung thư mục đủ nút, nút khóa ghi lý do; bấm ra ngoài → thu về chỗ cũ. "Chọn nút trên ô" → đổi nút, Lưu; tải lại trang vẫn giữ.
- [ ] Tùy chỉnh: ẩn 1 ô, đổi thứ tự, Xong; tải lại trang vẫn giữ; "Về mặc định" trả lại.
- [ ] Điện thoại: bấm một việc → mở hồ sơ; nút Back của máy về lại danh sách (không rời Center); thanh 3 nút đáy không che nội dung cuối.
- [ ] Sáng / tối đều đọc rõ; không có gì nhấp nháy liên tục; iPhone không bị "A problem repeatedly occurred".

## Theo vai

| # | Vai (người thử) | Kịch bản | Kết quả mong đợi |
|---|---|---|---|
| 1 | **Chỉ huy trưởng** SMB-2026 | Mở Center lúc đầu ngày. Duyệt 1 đề xuất vật tư / nhật ký từ cột việc (mở ở màn Dự án). Xem ô Dự án: thi công hôm nay, vật tư đang về, tiến độ. | Thấy đủ việc chờ duyệt của dự án; bấm việc mở đúng hồ sơ; sau khi duyệt, việc biến khỏi "Chờ tôi" (bấm làm mới). Ô Đội công trường hiện số đã chấm công. |
| 2 | **Kỹ sư / cán bộ kỹ thuật** công trường | Xem "Tôi gửi": phiếu kỹ sư, đề xuất đang chờ ai. Từ ô Dự án → "Tạo nhật ký", "Lập đề xuất vật tư". Từ ô Nhân sự → "Xin nghỉ phép" (form mở ngay, gửi thử rồi hủy ở màn Nghỉ phép). | Phiếu bị trả lại nằm ở "Chờ tôi" với nhãn "Cần bạn làm". Form nghỉ phép tính đúng số ngày và người duyệt như màn Nghỉ phép. |
| 3 | **Kế toán** | Mở Center: ô Tài chính lên đầu (mặc định). "Chờ tôi" có đề nghị chi đến lượt duyệt / chờ xác nhận đã chi, khoản chi quỹ công trường. Bấm đề nghị chi → mở ngay trong tab. | Đúng danh sách như màn Tài chính › Đề nghị chi (cùng người duyệt, cùng ủy quyền). |
| 4 | **HR / HR Manage** | "Chờ tôi" có nghỉ phép đến bước HR, điều động chờ duyệt, hồ sơ nhân viên chờ duyệt, kỳ công đang rà soát. Từ ô Nhân sự → "Điều động" mở bảng điều động trong tab. | Đúng như màn HRM tương ứng; người không phải HR không thấy các việc này. |
| 5 | **Mua hàng** | Ô Mua hàng & Kho lên đầu. "Chờ tôi" có PO / đợt giao chờ duyệt, đối chiếu nhận hàng. "Xem Cần mua", "Mua nóng" mở hub Mua hàng trong tab. | Đúng như hub Mua hàng; đơn hàng mở đúng PO. |
| 6 | **Tổng giám đốc** (nếu thử) | "Chờ tôi" có văn bản cần duyệt / ký, đề nghị chi vượt ngưỡng. | Đúng như Office và Tài chính. |

## Ghi nhận khi xong

- Thời gian mở Center lần đầu trong ngày (ước lượng): …… giây. Mục tiêu dưới 2 giây trên 4G.
- Việc nào bạn cần mà Center chưa có: ……
- Số nào lệch với màn module (kèm ảnh): ……
