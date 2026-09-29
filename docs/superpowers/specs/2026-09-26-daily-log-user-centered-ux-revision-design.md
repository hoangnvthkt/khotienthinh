# Điều chỉnh UX Nhật ký công trường — phiếu kỹ sư làm trung tâm

**Trạng thái:** Đã được người dùng duyệt ngày 26/09/2026 với xác nhận “ok, bắt đầu đi em”. Triển khai tuần tự theo kế hoạch liên kết; chưa nghiệm thu hoặc phát hành.

**Cơ sở:** Yêu cầu ngày 26/09/2026, ảnh tham khảo “Chi tiết kế hoạch thi công”, [kết quả rà soát](../evidence/2026-09-26-daily-log-usage-model-review.md) và đặc tả đã duyệt [Nhật ký/WBS/nguồn lực](2026-09-23-daily-log-wbs-progress-resources-cost-design.md).

## 1. Mục tiêu và ranh giới

Kỹ sư nhìn vào biết đây là phiếu của mình, ghi công việc/khối lượng/nhân công/máy ở đâu và gửi cho ai. Người tổng hợp nhìn vào biết còn thiếu phiếu nào, phiếu nào cần xử lý. CHT nhìn vào biết kết quả cả ngày, mở đúng phiếu và duyệt hoặc trả sửa có lý do. Vòng sử dụng phải khép kín, không chỉ thay CSS.

Giữ nguyên các quyết định đã khóa: một phiếu theo người + khu vực/mũi, một bản tổng hợp ngày, CHT duyệt bản tổng hợp, sửa trên bản sao và truy vết nguồn, không tự cộng % giữa khu vực, không suy đoán/backfill lịch sử. Một người có hai khu vực vẫn có hai phiếu. Bổ sung UI chọn các phiếu của cùng người, không đổi đơn vị báo cáo thành một phiếu chứa nhiều khu vực.

Phạm vi: chỉ luồng WBS Nhật ký mới sau cutover và thành phần hiển thị nguồn lực liên quan. Không chỉnh Project V2, Procurement V2, BOQ, HRM, điều kiện vào Finance, giá/tiền/accrual/project transactions. Dùng agent chính, tuần tự; Cloud từ `.env`, không local/Docker. Không merge/deploy/bật enforced theo kế hoạch này.

## 2. Phân tích ảnh tham khảo

Những đặc điểm lấy làm định hướng:

- Nền trắng, khối nội dung phẳng, viền xám mảnh; không dùng nhiều card lớn với bo góc/shadow nặng.
- Tiêu đề trái, hành động phải trong thanh đầu ổn định; trạng thái dễ thấy.
- Tab gạch chân xanh ngọc; metadata hai cột, nhãn và ô nhập thẳng hàng.
- Bảng là khu vực làm việc chính: tiêu đề nền xám nhẹ, số canh phải, công việc canh trái, nhóm cột dễ quét mắt.
- Có tìm kiếm và hành động thêm công việc ngay trên bảng; font sans-serif, phân cấp bằng size/weight, không lạm dụng chữ đậm.

Không sao chép: cột đơn giá/thành tiền, các số 0 thiếu căn cứ, nút xóa ở mọi trạng thái, bảng quá rộng bị cắt trên điện thoại. Không thể xác định chắc tên font từ ảnh; reuse **Inter hiện có** thay vì khẳng định ảnh dùng font này.

## 3. Phương án chọn

**Đề xuất: cải thiện UI theo vai trò, giữ mô hình và bổ sung command nguồn còn thiếu.** Reuse React/Tailwind/Lucide, sửa trong module Daily Log; phân tách component nhỏ tại điểm chạm, không refactor toàn trang 3.800 dòng.

Hai phương án không chọn:

- Chỉ đổi màu/spacing: nhanh nhưng không sửa được thiếu nhập khối lượng, mất ngữ cảnh trả sửa và thiếu chọn phiếu.
- Đổi database sang một phiếu/người/ngày chứa nhiều khu vực: khớp cách diễn đạt “mỗi người một tờ” theo nghĩa tuyệt đối, nhưng thay quyết định trách nhiệm đã khóa và mở rộng migration. Không làm trong đợt này.

Hai **bổ sung được duyệt cùng bản thiết kế này**: nhập khối lượng hôm nay như cách nhập tiện dụng có điều kiện; trả phiếu nguồn WBS trực tiếp cho kỹ sư trong vòng tổng hợp chưa xác nhận. Bổ sung không thay semantics lũy kế hoặc duyệt chính thức.

## 4. Màn hình và hành động

### 4.1 Điểm vào Nhật ký

Giữ đường dẫn/tab hiện có. Trong luồng WBS, hiển thị lối vào theo quyền: **Phiếu của tôi**, **Tổng hợp ngày**, **Chờ tôi duyệt**. Một người nhiều quyền có thể đổi vai trò; không tạo ba bản dữ liệu hay ba route mới. Danh sách phiếu ghi ngày, người lập, khu vực, trạng thái, số hạng mục, giờ công/giờ máy và hành động phù hợp. Có tìm theo người/khu vực, lọc trạng thái; không hiển thị bộ lọc không hoạt động.

Không suy ra “đủ tất cả kỹ sư đã gửi” khi chưa có danh sách người phải báo cáo. Ghi **Phiếu đã nhận**, không ghi “đủ phiếu” hoặc tỷ lệ hoàn tất không có mẫu số.

### 4.2 Phiếu kỹ sư

```text
PHIẾU THI CÔNG NGÀY                         [Lưu nháp] [Gửi tổng hợp] [Đóng]
Nội dung công việc | Lịch sử                 Nháp / Đã gửi / Cần sửa
Ngày ...       Người lập ...                Khu vực/mũi ...
Nếu bị trả: lý do + người yêu cầu + thời điểm + hạng mục liên quan
Tìm hạng mục ...                                         [+ Chọn công việc]
Mã | Hạng mục | ĐVT | Khối lượng hôm nay | Lũy kế | Nhân công/giờ công | Máy/giờ máy
   |          |     |                   |        | [Chi tiết]         | [Chi tiết]
Ghi chú/sự cố và ảnh theo phiếu/hạng mục
```

Bảng thật có nhóm “Khối lượng thi công”: hôm nay, lũy kế, %; đơn vị/kế hoạch là thông tin đọc, không sửa BOQ. Ngày dự kiến hoàn thành và lý do thay đổi nằm trong chi tiết hạng mục, không ép thêm cột rộng.

- Mặc định ưu tiên **Khối lượng hôm nay** khi đã biết đơn vị, khối lượng kế hoạch và baseline khối lượng hợp lệ. Nhập 12 m³ với baseline 40/100 → lũy kế 52 m³, 52%. Server tính lại và kiểm tra, không tin tổng từ browser.
- Lựa chọn phụ **Nhập lũy kế** / **Nhập %**; chỉ một chế độ nhập hoạt động mỗi hạng mục, hai đại lượng còn lại là kết quả, không để ba input độc lập mâu thuẫn.
- Thiếu kế hoạch/đơn vị: giữ luồng nhập % hiện có; khối lượng hiển thị “Chưa có cơ sở quy đổi”, không nhập số có đơn vị suy đoán. Thiếu baseline khối lượng: chưa tính được hôm nay; có thể nhập lũy kế khi có cơ sở, không đổi null thành 0. Ngày đầu chỉ dùng baseline 0 khi server xác định không có lịch sử chính thức trước đó và cơ sở quy đổi hợp lệ; khác với một bản ghi cũ có quantity null.
- Không tự lấy baseline toàn WBS làm baseline của một khu vực nhỏ nếu thiếu cơ sở phân bổ. Với cùng WBS nhiều khu vực, nhắc rõ phạm vi và giữ bước xử lý của người tổng hợp.
- Chi tiết nhân công/máy mở ngay dưới đúng hạng mục. Hiển thị số lượng × giờ mỗi người/máy = tổng giờ, tên bên cung cấp; chọn danh mục/nhập tay là cách khai báo, không chiếm chỗ của số liệu chính.
- Lưu công việc, nguồn lực, nội dung, sự cố, ảnh trong cùng command; tránh lưu công việc mà bỏ thay đổi metadata của phiếu đang có. Nháp chưa hoàn chỉnh được lưu nếu payload an toàn; gửi bị chặn ở đúng lỗi cần hoàn thiện. Không lưu dòng nguồn lực vật lý sai/thiếu nguồn dưới danh nghĩa nháp.
- Khi đã gửi: số liệu chỉ đọc, thông tin “Đã gửi để tổng hợp”; không có nút gửi lần hai hoặc sửa trực tiếp. Khi trả sửa: “Lưu chỉnh sửa” và **Gửi lại tổng hợp**.
- Lịch sử chỉ trình bày sự kiện hệ thống có thật; không thêm tab “Trao đổi” trống hoặc xây chat mới.

### 4.3 Tổng hợp ngày

- Đầu màn hình: ngày, người tổng hợp, trạng thái, **Lưu tổng hợp**, **Gửi CHT**. Tổng quan gọn: phiếu đã nhận/được chọn, WBS duy nhất, tổng giờ công, tổng giờ máy, số vấn đề cần xử lý.
- Danh sách chọn phiếu gồm người lập + khu vực + trạng thái; phiếu đã chọn giữ thành ô khu vực 2 cột desktop như đặc tả, 1 cột mobile. Mặc định tóm tắt, mở chi tiết khi cần. Không đưa toàn bộ form chỉnh sửa ra ngay.
- Trong mỗi ô có bảng công việc cùng cấu trúc phiếu kỹ sư; nguồn lực, ghi chú/sự cố, ảnh gắn đúng công việc/phiếu. Bản sao và bản gốc phân biệt rõ, điều chỉnh có lý do và so sánh.
- Phiếu cần sửa có banner riêng chứa nhận xét đã lưu. Nút **Trả phiếu cho kỹ sư** yêu cầu lý do, không dùng từ “Bỏ card”; loại khỏi tổng hợp là **Bỏ khỏi bản tổng hợp**, không xóa nguồn.
- Phiếu gửi lại không tự ghi đè snapshot đã chỉnh. Hiển thị **Có phiếu gửi lại — Xem thay đổi / Cập nhật từ phiếu**, yêu cầu quyết định cập nhật hoặc xử lý ngoại lệ có lý do theo workflow đang có.
- WBS nhiều nguồn/chồng lấn/forecast khác nhau tạo mục **Cần xử lý trước khi gửi**, mở đúng nguồn liên quan. Bảng kết quả đã chốt đọc gọn; cách chốt/lý do chỉ mở khi cần. Không cộng % hoặc khối lượng khác đơn vị.
- Không gọi tổng số người trên các dòng là số người duy nhất có mặt. Nhãn “Lượt người theo hạng mục”; tương tự số máy là lượt máy nếu chưa có danh tính máy. Giờ ghi nhận theo hạng mục cần tránh ghi trùng; cảnh báo nghi trùng không tự kết luận hay tự trừ.

### 4.4 CHT và hồ sơ đã duyệt

CHT xem tổng quan → danh sách phiếu → chi tiết cần kiểm tra. Toàn bộ số liệu chỉ đọc; không render input/select disabled thay cho báo cáo.

- Hành động chính: **Duyệt & công bố** ở enforced hoặc **Đối chiếu thử nghiệm** ở pilot với lời giải thích chưa công bố.
- **Trả phiếu sửa**: trả đúng nguồn cho kỹ sư và đưa bản tổng hợp về người tổng hợp, cùng lý do/lineage trong một transaction. **Trả bản tổng hợp** chỉ trả người tổng hợp; không tự trả tất cả nguồn.
- **Đã xác nhận**: số liệu kết quả, người duyệt/thời điểm đã lưu; lịch sử quyết định mở rộng; không có lời nhắc chốt trước khi gửi, input, xóa hoặc trả sửa trực tiếp. Điều chỉnh dùng revision hiện có.
- `source_state=current` đổi nhãn thành **Nguồn khớp phiên bản** ở chi tiết; không dùng nhãn này để diễn đạt duyệt. Trạng thái phiếu và review status tách rõ.
- Nếu nguồn tham gia bất kỳ hồ sơ đã xác nhận còn hiệu lực, không mở sửa nguồn ấy qua luồng trả phiếu; hướng dẫn tạo bản điều chỉnh. Snapshot/lịch sử đã duyệt không bị thay đổi.

## 5. Style cụ thể

Reuse Inter và token hiện có; không sửa font, theme, CSS toàn app. Khối Daily Log dùng semantic classes và có thể thêm CSS scoped để tránh global mobile overrides che lỗi hoặc ép table thành block sai.

- Nền nội dung trắng, header bảng `muted`, border 1px `border`; desktop padding 20–24px, khoảng nhóm 16–24px, hàng bảng khoảng 48–56px tùy nội dung.
- Tiêu đề 20–22px/600; tiêu đề nhóm 16px/600; dữ liệu và label 14px/400–500; phụ trợ 12–13px. Mobile input ít nhất 16px để tránh zoom; số tabular và canh phải. Không dùng font-black toàn bộ, không chữ 9–10px cho thông tin cần đọc.
- Accent theo primary hiện có **#0f766e**: nút chính, tab đang chọn, focus. Không đổi cả ứng dụng sang màu turquoise sáng của ảnh. Text thường `foreground`, metadata `muted-foreground` nhưng vẫn đủ tương phản.
- Trạng thái: nháp xám, chờ duyệt xanh ngọc nhẹ, cần sửa amber nhẹ, đã duyệt xanh lá. Luôn có chữ/icon, không chỉ màu. Đỏ cho lỗi/nguy hiểm, không dùng đỏ cho thao tác trả sửa bình thường.
- Bo 4–8px cho field/button/table section; khung modal reuse container hiện có. Bỏ gradient/glow và shadow nhiều lớp trong nội dung Daily Log. Không ép style “landing page”.
- Nút desktop cao 40px, mobile vùng bấm tối thiểu 44px. Primary có nhãn động từ rõ; secondary outline; đóng trung tính. Chỉ một cụm action theo vai trò, không lặp hai hàng nút. Lưu/submit busy riêng; chặn double-click, giữ dữ liệu khi lỗi.
- Desktop thanh hành động đầu sticky; mobile chuyển action chính xuống đáy có safe-area. Nội dung có padding bù, không che hàng cuối/bàn phím. Tab order hợp lý, focus rõ, nhãn input và lỗi có thể đọc bằng screen reader.
- Ngày `dd/mm/yyyy`; giờ `HH:mm` theo Asia/Ho_Chi_Minh, không in ISO. Tên dài wrap; không cắt mất lý do trả sửa.
- Dark mode dùng token hiện có, không đảo màu tùy tiện; kiểm tra tương phản chữ thường tối thiểu 4.5:1 trong các trạng thái thực tế.

## 6. Workflow và dữ liệu

Giữ trạng thái database hiện có. Nhãn người dùng là lớp trình bày, không thêm status mới chỉ để đổi câu chữ.

```text
Kỹ sư: Nháp → Đã gửi → [Cần sửa → Chỉnh sửa → Gửi lại]
                           ↓
Người tổng hợp: Chọn phiếu → Rà soát → Gửi CHT
                                          ↓
CHT: Duyệt bản tổng hợp / Trả bản tổng hợp / Trả đúng phiếu nguồn
```

Commands nguồn v2 dùng effective Room/canonical permissions đúng scope; author do server xác định. RPC trả nguồn kiểm tra log chưa verified, source thuộc summary/scope, version/fingerprint hợp lệ, actor có verify (người tổng hợp) hoặc approve (CHT), không có nguồn gắn hồ sơ verified còn hiệu lực. Owner chỉ sửa draft/returned và gửi lại nguồn của mình. Không dùng admin bypass để chứng minh hoạt động.

Command có optimistic concurrency, idempotency với command UUID và receipt lưu private; lock thứ tự thống nhất khi thao tác nhiều đối tượng (log theo ID → summary sources theo ID → contribution). Command save nguồn chỉ khóa nguồn, không khóa ngược log để gây deadlock; trạng thái changed của summary được nhận biết bằng fingerprint. Không nới quyền cập nhật trực tiếp status từ browser. Internal helpers nằm app_private, public entry point nhỏ và kiểm tra quyền, revoke anon/public.

V2 được thêm bằng migration mới sinh qua CLI sau khi triển khai được duyệt; không sửa file migration đã chạy. RPC/legacy trước cutover giữ nguyên. Evidence Plan 2 chỉ dùng verified; draft/returned/resubmit chưa duyệt không trở thành evidence. Không bật enforced, không ghi ledger sản xuất.

## 7. Tiêu chí nghiệm thu

- Người dùng thử lần đầu nhìn trong khoảng 5 giây trả lời được: phiếu của ai/ngày nào/khu vực nào, trạng thái gì và bấm đâu tiếp theo. Đây là kiểm tra với người dùng thật, không suy từ screenshot test.
- Kỹ sư nhập và gửi phiếu mà không phải nhập lại nguồn lực ở tab khác; sửa đúng nguồn bị trả và gửi lại được trên route ERP thật.
- Người tổng hợp thấy đúng nhận xét, xử lý nguồn gửi lại có chủ đích; không làm mất chỉnh sửa hoặc hồ sơ gốc.
- CHT trả một phiếu không mở sửa phiếu khác; duyệt không tạo duplicate. Hồ sơ đã duyệt nhìn như báo cáo, không form.
- Unknown khác 0; thiếu đơn vị/kế hoạch/baseline không sinh số đo giả; hai khu vực 30% không ra 60%.
- Nguồn lực gắn đúng WBS, không có trường tiền; evidence/publication chỉ sau duyệt hợp lệ, pilot vẫn shadow.
- Walkthrough desktop 1440×900, tablet 1024×768 và 768×1024, mobile 390×844 và 360×800, light/dark; keyboard và tên/lý do dài. Không horizontal overflow của toàn trang; cuộn bảng chỉ trong wrapper.
- TDD, test RPC/RLS bằng non-admin đủ vai trò, test browser ERP không chỉ wrapper fixture; full test/typecheck/build/migration check; audit scope diff và bằng chứng trước kết luận.

## 8. Điều kiện chuyển sang triển khai

Người dùng đã duyệt bản thiết kế này và kế hoạch liên kết ngày 26/09/2026. Tiếp tục bằng một agent chính với executing-plans, tuần tự, commit riêng từng task. Phê duyệt thiết kế không đồng nghĩa nghiệm thu hoặc cho phép phát hành; các giới hạn release gate trước đó vẫn giữ nguyên.
