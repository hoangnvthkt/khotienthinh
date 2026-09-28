# Hướng dẫn sử dụng và rà soát mô hình Nhật ký công trường

Ngày rà soát: 26/09/2026. Bản ứng dụng: `codex/daily-log-bootstrap-integration`, HEAD trước rà soát `03ff13b`.

**Cập nhật 27/09/2026:** Giữ nguyên nội dung dưới đây làm bằng chứng rà soát trước triển khai. Với bản UX mới, dùng [bảng hướng dẫn theo nút hiện tại](2026-09-27-daily-log-user-guide.md); không dùng nhãn hoặc kết luận về chức năng cũ trong bản rà soát này thay cho trạng thái triển khai mới. Nghiệm thu người dùng và phát hành vẫn là gate riêng.

## 1. Kết luận

Đã có cấu trúc phiếu nguồn → bản tổng hợp ngày → CHT duyệt. Tuy nhiên, chưa đủ điều kiện kết luận trải nghiệm đã đúng mô hình “tờ giấy của kỹ sư”: nhập liệu còn thiên về phần trăm tiến độ, xem phiếu còn giống màn hình chỉnh sửa, và luồng trả đúng phiếu cho kỹ sư sửa/gửi lại chưa nối đầy đủ trong giao diện WBS.

Đây là hướng dẫn và kết quả rà soát, không phải xác nhận nghiệm thu hoặc một thiết kế mới đã được duyệt. Chưa thay đổi code, database, quyền hay rollout. Không chạm Project V2, Procurement V2 và BOQ.

## 2. Bảng hướng dẫn theo quy trình thực tế

Cách vào: **Dự án → Nhật ký công trường → chọn ngày**. Nút thao tác hiện theo quyền và trạng thái. Bảng phân biệt rõ quy trình cần đạt với khả năng hiện có, không hướng dẫn người dùng bấm một chức năng chưa được nối.

| Bước | Người thực hiện | Cách dùng / thông tin cần ghi | Kết quả cần đạt và tình trạng hiện tại |
|---|---|---|---|
| 1. Mở phiếu trong ngày | Kỹ sư hiện trường | Bấm **Ghi nhật ký**, kiểm tra ngày, người lập, khu vực/mũi thi công. Chọn hạng mục bằng **Chọn WBS**. | Phiếu ghi rõ trách nhiệm của người lập; không phải bản tổng hợp toàn công trường. Hiện editor nhận một khu vực cho mỗi phiếu. |
| 2. Ghi công việc | Kỹ sư hiện trường | Với mỗi hạng mục: ghi khối lượng thực hiện, đơn vị, lũy kế, ghi chú/bằng chứng nếu có. | Khối lượng đo đếm phải dễ ghi và dễ đọc. **Hiện chỉ nhập được % lũy kế**, hệ thống tính khối lượng khi đủ cơ sở; chưa có lựa chọn nhập khối lượng lũy kế như đặc tả. Không biến khối lượng chưa biết thành 0. |
| 3. Ghi nhân công và máy | Kỹ sư hiện trường | Mở chi tiết nguồn lực của đúng hạng mục. Nhân công: loại/tổ đội, số người, giờ/người, bên cung cấp. Máy: loại máy, số máy, giờ/máy, chủ máy/bên cung cấp. Chọn danh mục hoặc nhập tay đúng loại nguồn. | Tổng giờ công = người × giờ/người; tổng giờ máy = máy × giờ/máy. Không nhập giá, tiền hoặc chi phí. Không ghi cùng lượng giờ hai lần cho các hạng mục khác nhau. |
| 4. Gửi cuối ngày | Kỹ sư hiện trường | Trong ngày dùng **Lưu nháp**; cuối ngày rà soát và bấm **Gửi tổng hợp**. | Phiếu đã gửi khóa phần công việc/nguồn lực. Đây là báo cáo đầu vào, chưa phải tiến độ chính thức hoặc bằng chứng đã xác nhận. |
| 5. Lập bản tổng hợp ngày | Người tổng hợp/Kỹ thuật trưởng | Bấm **Tổng hợp** ở đúng ngày; rà soát người lập, khu vực và từng hạng mục. Kiểm tra thiếu/trùng, điều chỉnh bản sao có lý do hoặc yêu cầu sửa nguồn. Dùng **Lưu tổng hợp**, sau đó **Gửi CHT**. | Một bản tổng hợp giữ từng phiếu nguồn riêng, không sửa ngược bản gốc. Hiện các nguồn được đưa vào workspace; có **Bỏ card**, chưa có luồng lựa chọn phiếu rõ ràng như hồ sơ giấy. Chức năng trả nguồn WBS cho tác giả chưa nối đầy đủ. |
| 6. Duyệt hoặc trả sửa | CHT | Xem tổng quan trước, mở phiếu để kiểm tra khối lượng/giờ công/giờ máy. Đạt thì duyệt; chưa đạt ghi lý do và chỉ rõ phiếu/hạng mục cần sửa. | Hiện **Trả lại toàn bộ** trả bản tổng hợp; **Yêu cầu sửa khu vực** ghi nhận xét theo khu vực và cũng trả bản tổng hợp cho người tổng hợp. **Không tự trả phiếu gốc cho kỹ sư**. Ở chế độ chính thức nút là **Duyệt & công bố**; Cloud test đang pilot có **Đối chiếu thử nghiệm**, chưa công bố tiến độ. |
| 7. Sửa và gửi lại | Kỹ sư → người tổng hợp → CHT | Kỹ sư nhận đúng lý do, sửa đúng phiếu, gửi lại; người tổng hợp cập nhật nguồn mới, rà soát và gửi lại CHT. | Editor hỗ trợ sửa phiếu có trạng thái `returned`, nhưng đường thao tác trả phiếu nguồn WBS từ màn hình tổng hợp tới trạng thái này chưa được nối. Vì vậy chưa thể coi vòng sử dụng này đã hoàn chỉnh. |
| 8. Tra cứu hồ sơ đã duyệt | Kỹ sư/người tổng hợp/CHT/QS có quyền | Xem phiếu đã xác nhận; truy vết người lập, khu vực, công việc, bên cung cấp và bản tổng hợp. | Bản đã xác nhận chỉ đọc; điều chỉnh phải có phiên bản/lý do, không sửa lịch sử. Số liệu nguồn lực không phải hồ sơ thanh toán hay giao dịch tài chính. |

Ví dụ cách đọc số liệu:

- Hạng mục có kế hoạch 100 m³; lũy kế trước ngày báo cáo 40 m³; làm thêm 12 m³ → lũy kế 52 m³, tương ứng 52%. Không ghi “12% lũy kế” nếu đang nói phần thực hiện hôm nay.
- 5 người × 8 giờ/người = **40 giờ công**, không phải 40 giờ/người.
- 2 máy × 6 giờ/máy = **12 giờ máy**, không phải mỗi máy làm 12 giờ.
- Hai khu vực cùng báo 30% không có nghĩa toàn hạng mục đạt 60%. Cần biết cơ sở/phạm vi khối lượng và xử lý trùng trước khi chốt.

## 3. Đối chiếu đặc tả và code

### A. Những phần đã đi đúng hướng

- Tách phiếu nguồn của người lập và bản tổng hợp; bản tổng hợp giữ nguồn gốc theo khu vực/người phụ trách.
- Chọn công việc lá từ WBS; nhân công và máy gắn với từng công việc trong dữ liệu nguồn.
- Nguồn cung cấp bắt buộc, hỗ trợ danh mục và nhập tay; nguồn lực là số liệu vật lý, không phải định giá.
- Phiếu đã gửi chỉ đọc; bản tổng hợp đã xác nhận không cho sửa trực tiếp các ô công việc/quyết định trong chế độ xem.
- Không tự cộng phần trăm của các khu vực thiếu phân bổ; có bước quyết định và lý do khi tổng hợp.

Những nhận định này dựa trên code, SQL và các test hiện có; không phải một vòng nghiệm thu thao tác thực tế mới với toàn bộ vai trò.

### B. Những khoảng thiếu cần xử lý trước nghiệm thu trải nghiệm

1. **Khối lượng thi công chưa là đầu vào thuận tiện.** `DailyLogWorkItemTable` chỉ có input `% lũy kế`; `DailyLogContributionWorkEditor` cũng chỉ gửi phần trăm. Đặc tả §7.4 cho phép nhập % hoặc khối lượng lũy kế. Chưa thể dùng editor này như một tờ ghi khối lượng đo đếm mà không phải tự quy đổi phần trăm. Việc cho nhập trực tiếp *khối lượng trong ngày* là lựa chọn UX cần xác nhận nếu bổ sung, không mặc nhiên đã được đặc tả khóa.

2. **Vòng trả phiếu cho kỹ sư chưa hoàn chỉnh.** `request_daily_log_summary_source_changes_v1` cập nhật nhận xét của summary source và chuyển `daily_logs` sang `rejected`; không đổi `daily_log_contributions.status` sang `returned`. Service `returnContribution` tồn tại nhưng tìm kiếm trong code không thấy nơi gọi từ UI. Nút trả nguồn legacy nhận `DailyLog`, không phải contribution WBS, nên không được coi là giải pháp cho luồng mới. Đây là điểm khác biệt giữa “trả bản tổng hợp để người tổng hợp sửa bản sao” và “trả phiếu gốc để kỹ sư sửa/gửi lại”.

3. **Nhận xét đã lưu chưa được đưa lại vào ngữ cảnh sửa phiếu.** Card tổng hợp hiện không hiển thị `reviewStatus`/`reviewComment` đã lưu. Người tổng hợp cần thấy rõ khu vực nào bị yêu cầu sửa, lý do và việc cần làm; nhãn “Hiện hành” chỉ nói về phiên bản nguồn, không nói phiếu đã đạt yêu cầu duyệt.

4. **Màn hình đã duyệt còn giống form đang soạn.** Các input ở chế độ review thực tế có `disabled`, không phải đang cho sửa. Tuy nhiên vẫn hiển thị ô nhập, dropdown, lời nhắc “Chốt ... trước khi gửi CHT” và nền vàng dù đã chốt. Trạng thái “Đã xác nhận” phải đọc như hồ sơ kết quả, phần cách chốt/lý do nên nằm trong lịch sử hoặc chi tiết quyết định.

5. **Tổng quan và phân cấp thông tin chưa đủ.** Workspace mới chỉ có số khu vực, tổng số người theo dòng và cảnh báo; thiếu tổng giờ công, số máy/giờ máy và số WBS duy nhất như §7.3. Card luôn mở chi tiết (`<details open>`), không đúng mặc định tóm tắt có mở rộng. Ngày giờ đang in ISO thô. Nguồn lực được xếp chung dưới khu vực, chưa nằm cạnh đúng hạng mục khi một phiếu có nhiều WBS. Những thông tin “Danh mục/Nhập tay/Đối tác đang hoạt động” nổi bật hơn cần thiết cho màn hình đọc hồ sơ.

6. **Đừng hiểu tổng “người” là số người duy nhất trên công trường.** UI đang cộng số người của các dòng nguồn lực; chưa có bằng chứng phân biệt cùng một tổ tham gia nhiều WBS. Cần ghi rõ ý nghĩa và tránh đếm trùng khi tổng hợp. Giờ công/giờ máy cũng cần nhãn rõ thay cho chữ “giờ” chung.

7. **Trường hợp một người phụ trách nhiều khu vực chưa được phục vụ đầy đủ trong UI.** Đặc tả §7.2 khóa đơn vị báo cáo là người + khu vực/mũi; một người có hai khu vực tạo hai phiếu. Bundle hiện lấy phiếu mới nhất của người/ngày (`ORDER BY created_at DESC LIMIT 1`), editor một khu vực và tái sử dụng phiếu đó; chưa có thao tác chọn/tạo thêm phiếu khu vực của cùng người. Câu “mỗi người một phiếu” trong yêu cầu trải nghiệm cần phân biệt với quy tắc đã chốt này. Rà soát không tự đổi mô hình dữ liệu sang một phiếu/người chứa nhiều khu vực.

8. **Unknown còn bị che bằng số 0 ở baseline.** `ProgressCell` hiển thị `previousCumulativeQuantity || 0`; khi đầu vào là null sẽ in 0. Không nên dùng 0 thay cho khối lượng chưa xác định. Đây khác với 0 thật đã có căn cứ.

### C. Riêng ảnh người dùng gửi

Kiểm tra chỉ đọc Cloud `baseline-vioo-git`, dự án test `DL-WBS-PILOT-20260925`, nhật ký `DL-WBS-PILOT-SUMMARY-20260925`:

- Nhật ký ngày 25/09/2026 có status `verified`.
- Hai dòng nguồn Khu A/B có `% lũy kế = 30`, nhưng `unit_snapshot`, `planned_quantity_snapshot`, `area_planned_quantity_snapshot`, khối lượng lũy kế và khối lượng ngày đều null.
- Quyết định chính thức có % = 30, khối lượng lũy kế = 30, khối lượng ngày = 30, phương pháp `manual_override` và lý do chốt pilot.
- Vì vậy “Chưa có đơn vị/Chưa xác định khối lượng ngày” phản ánh snapshot thiếu dữ liệu thật, không phải lỗi mapper làm rơi một đơn vị đang có. Số 30 trong quyết định là giá trị nhập tay đã lưu; không đủ cơ sở từ phiếu này để diễn giải là 30 m³, cũng không phải kết quả cộng 30% + 30%.
- Không sửa/bổ sung đoán đơn vị hoặc khối lượng cho fixture và không backfill lịch sử trong lần rà soát này.

## 4. Hướng bố trí cần đạt, chưa triển khai

Lấy **phiếu của kỹ sư** làm đối tượng chính, WBS là mã hạng mục bên trong phiếu:

- Đầu phiếu: ngày, người lập, khu vực, trạng thái và lý do trả sửa nếu có.
- Nội dung chính: hạng mục → khối lượng hôm nay/đơn vị, lũy kế → nhân công/giờ công → máy/giờ máy. Nguồn cung cấp và ghi chú nằm trong chi tiết đúng hạng mục.
- Người tổng hợp: danh sách phiếu đã gửi, số phiếu chờ/sửa/thiếu; mở đúng phiếu để rà soát. Giữ trách nhiệm và lịch sử gốc, không nhập lại toàn bộ.
- CHT: tổng quan cả ngày trước, danh sách phiếu sau; mở phiếu để xem. Hành động chính là duyệt hoặc trả sửa có lý do. Chốt xung đột tiến độ là ngoại lệ trong quy trình tổng hợp, không phải trung tâm của mọi phiếu.
- Đã duyệt: trình bày số liệu như báo cáo chỉ đọc, thông tin người duyệt/thời điểm và lịch sử; không để form chốt WBS chiếm toàn bộ màn hình.

Ưu tiên khép vòng trả sửa/gửi lại và nhập khối lượng theo đặc tả trước; sau đó cải thiện hierarchy, chế độ xem và microcopy. Không mở rộng sang tài chính, HRM hay Project V2/Procurement V2.

## 5. Bằng chứng và giới hạn rà soát

**Đính chính khi triển khai Task 2 (26/09/2026):** Kiểm tra index thực tế Cloud và baseline SQL cho thấy `ux_daily_log_contrib_scope_day_author` chặn nhiều phiếu cùng người/ngày dù khu vực khác nhau. Vì vậy khoảng thiếu ở mục 3.B.7 không chỉ là UI/bundle: còn thiếu phân tách ràng buộc dữ liệu của luồng WBS mới với legacy. Chưa xóa/thay index, chưa áp dụng migration hoặc sửa dữ liệu lịch sử. Chi tiết ở [checkpoint Task 2](2026-09-26-daily-log-source-selection-checkpoint.md).

Đã đọc đặc tả §1, §7, code editor/workspace/card/viewer, service lấy/lưu dữ liệu và command yêu cầu sửa nguồn. Đã kiểm tra Cloud chỉ đọc đúng phiếu trong ảnh. Không chạy hành động gửi/duyệt/trả phiếu trong lần rà soát.

Lệnh kiểm tra:

```sh
npm run test -- lib/__tests__/dailyLogSummaryWorkspace.test.tsx lib/__tests__/dailyLogContributionWorkEditor.test.tsx lib/__tests__/dailyLogWbsService.test.ts
```

Kết quả: 3 file, 33 test pass. Các test này xác nhận hành vi đã viết, chưa kiểm tra đầy đủ những yêu cầu UX/vòng trả phiếu đang thiếu; pass test không đồng nghĩa trải nghiệm đã được nghiệm thu. Chưa walkthrough mới trên desktop/tablet/mobile.

Nguồn đối chiếu trong repository:

- `docs/superpowers/specs/2026-09-23-daily-log-wbs-progress-resources-cost-design.md` (§7.2–7.4, §7.9).
- `components/project/daily-log/DailyLogContributionWorkEditor.tsx`.
- `components/project/daily-log/DailyLogWorkItemTable.tsx`.
- `components/project/daily-log/DailyLogSummaryWorkspace.tsx`.
- `components/project/daily-log/DailyLogAreaCard.tsx`.
- `components/project/daily-log/DailyLogConsolidatedWbsTable.tsx`.
- `pages/project/DailyLogTab.tsx`.
- `lib/dailyLogWbsService.ts`, `lib/projectService.ts`.
- `supabase/migrations/20260923093000_daily_log_wbs_area_commands.sql`.
