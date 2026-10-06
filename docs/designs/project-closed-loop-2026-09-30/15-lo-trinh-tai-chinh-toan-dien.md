# Lộ trình Tài chính toàn diện — đủ nghiệp vụ, DỰ BÁO, dễ dùng hơn MISA (05/10/2026)

Định hướng chủ SP 05/10:
- Hoàn thiện mọi nghiệp vụ: mua hàng, nhập xuất kho, công nợ, thanh toán với NCC / CĐT / thầu phụ, thống kê, báo cáo.
- **Quan trọng nhất là DỰ BÁO**: GĐ tài chính phải biết 1, 3, 6 tháng tới cần chuẩn bị chi bao nhiêu, cần thu bao nhiêu, để tư vấn TGĐ.
- **Dễ dùng**: ít thao tác, gợi ý, nhập liệu nâng cao, import Excel.

## 1. Vioo khác MISA ở đâu

- MISA là **sổ kế toán**: ghi lại chuyện đã xảy ra theo chứng từ, phục vụ báo cáo thuế.
- Vioo là **hệ điều hành tài chính của công ty xây dựng**:
  - số tài chính sinh ra từ việc thật (đơn mua, kho nhận hàng, nhật ký, Gantt, nghiệm thu);
  - mỗi số truy được về chứng từ và người làm;
  - nhìn về phía trước: dự báo dòng tiền theo tiến độ công trường.
- MISA vẫn giữ vai trò sổ thuế: Vioo xuất chứng từ sang MISA, không bắt kế toán nhập hai lần.

## 2. Đối chiếu nghiệp vụ

| Chu trình | Đã có trong Vioo | Còn thiếu | Ưu tiên |
|---|---|---|---|
| **Dự báo dòng tiền** | 8 tuần, chỉ từ chứng từ đã có | 1 / 3 / 6 tháng theo tiến độ Gantt, đơn mua, dự toán, HĐ thầu phụ, lương, chi định kỳ; kịch bản; nhu cầu vốn; theo dự án | **1** |
| Tách Tài chính khỏi Dự án | Đã duyệt doc 14 | P1 menu + Tài chính dự án + quyền theo dự án; P2 bỏ tab; P3 nhập MISA, chặn ghi tay | **2** |
| Tiền & ngân hàng | Tài khoản, đầu kỳ, sổ thu chi, đối chiếu sao kê, chuyển tiền | **Import sao kê ngân hàng (Excel) + tự khớp** phiếu thu / chi / đề nghị chi; nhắc khoản chưa khớp | 3 |
| Mua hàng → kho → công nợ NCC | PO, nhận hàng, đối soát HĐ, nhập trực tiếp, trả hàng, công nợ, đề nghị chi, tạm ứng | Hóa đơn đầu vào + khớp 3 bên (K3c), **đọc ảnh / XML hóa đơn điện tử**, chứng từ điều chỉnh | 4 |
| Kho | Vật tư một nguồn số, giá vốn, kiểm kê, phân quyền kho (module Vật tư) | Khóa kỳ kho cùng khóa kỳ kế toán; giá trị tồn kho trên báo cáo tài chính | 6 |
| Phải thu CĐT | Đợt thu, phiếu thu, bảo lãnh, giữ lại, tạm ứng CĐT | Gợi ý lập đợt từ sản lượng Gantt / nghiệm thu; xuất hóa đơn đầu ra; tuổi nợ | 5 |
| Thầu phụ | F4 (PR #103) | Lấy công từ nhật ký làm gợi ý; quyết toán HĐ; nộp TNCN đã khấu trừ | 5 |
| Chi phí, ngân sách, giá thành | Khoản mục, ngân sách, quỹ dự án, phân bổ tháng, quỹ công trường | Giá thành công trình (dở dang / kết chuyển), lãi gộp theo tháng | 6 |
| Lương | Phân bổ lương vào dự án | Chi lương qua sổ thu chi (1 đề nghị chi cho cả bảng lương), BHXH, TNCN | 7 |
| Thuế | TNCN thầu phụ (theo dõi) | VAT đầu vào / đầu ra theo tháng, ước số phải nộp (đưa vào dự báo) | 7 |
| Vay & tài sản | — | Khoản vay, lịch trả gốc lãi (đưa vào dự báo), hạn mức tín dụng; khấu hao từ module Tài sản | 3 (khoản vay) / 8 |
| Báo cáo | Tổng quan, sức khỏe dự án, việc cần làm | Tuổi nợ phải thu / phải trả, lãi lỗ theo dự án và tháng, báo cáo quản trị cho TGĐ, xuất Excel mọi bảng | 5 |
| Kết nối MISA | — | Xuất chứng từ (phiếu chi, UNC, phiếu thu, mua hàng) theo mẫu import MISA | chờ mẫu từ chị Hương |

## 3. Nguyên tắc dễ dùng (áp mọi màn Tài chính)

1. **Điền sẵn, không gõ lại**: mọi phiếu lấy sẵn từ nguồn (đơn, nhận hàng, nghiệm thu, sao kê). Kế toán chỉ kiểm và bấm.
2. **Gợi ý có lý do**: số gợi ý (khấu trừ, hạn, khoản mục) hiện kèm vì sao; khác gợi ý mới phải ghi lý do.
3. **Làm hàng loạt**: chọn nhiều để ghi nhận, duyệt, lập một đề nghị chi cho nhiều chứng từ, tự khớp sao kê.
4. **Import Excel ở mọi danh mục và sổ**: đầu kỳ, kế hoạch thu chi, sao kê, ngân sách, số MISA. Có file mẫu, xem trước, báo dòng lỗi bằng tiếng Việt, chặn trùng.
5. **Đọc chứng từ bằng AI**: ảnh hóa đơn, UNC, biên bản → điền sẵn số tiền, ngày, số chứng từ, đối tác (đã có bộ đọc OCR ở Vioo Office, dùng lại).
6. **Hàng đợi việc**: "Việc cần làm" là điểm vào chính; mỗi ô mở thẳng đúng chỗ xử lý.
7. **Nhập nhanh bằng bàn phím**: Enter để sang ô, gõ số kiểu "1,2 tỷ" / "350tr", tìm đối tác theo vài chữ.
8. **Không che chưa biết bằng 0**; luôn nói thiếu điều kiện gì và ai làm.

## 4. Dự báo dòng tiền 6 tháng — thiết kế (mockup `.superpowers/cost/fc-v1.html`)

**Nguồn tiền vào**
- Phải thu CĐT đã xác nhận (chắc chắn).
- Đợt đã gửi CĐT (đã gửi).
- Sản lượng theo Gantt × giá trị HĐ gồm VAT − giữ lại − thu hồi tạm ứng, tiền về sau thời gian CĐT duyệt + trả (theo tiến độ).
- Sản lượng đã làm chưa đề nghị (ước tính).
- Thu khác định kỳ.

**Nguồn tiền ra**
- Công nợ theo hạn (chắc chắn).
- Đề nghị chi đã lập.
- Đơn mua đã đặt chưa giao, trả theo ngày hẹn + hạn NCC (đã đặt).
- Dự toán vật tư chưa đặt, mua theo Gantt (theo tiến độ).
- HĐ thầu phụ còn lại theo Gantt; chưa có HĐ thì ước theo tỷ lệ nhân công (ước tính).
- Lương (bảng lương gần nhất).
- Chi định kỳ, khoản vay (gốc + lãi), thuế (ước).

**Kết quả**
- Thu, chi, ròng, số dư dự kiến theo tháng (6 tháng) và theo tuần (13 tuần đầu).
- Tháng căng nhất; số tiền cần chuẩn bị thêm (so với tồn quỹ tối thiểu); theo dự án.
- 3 kịch bản: Cơ sở / Thận trọng / Thuận lợi.
- Mỗi dòng có độ tin cậy và bấm xem cách tính, chứng từ nguồn.
- Gợi ý hành động cho GĐ tài chính.

**Số thật 05/10** (chưa gồm tiền đang có, chi chung, thuế):

| | Cơ sở | Thận trọng (CĐT trả chậm thêm 30 ngày, tiến độ chậm 20%) |
|---|---|---|
| Tháng căng nhất | T11/2026 | T12/2026 |
| Lũy kế ròng tại tháng căng nhất | −15,9 tỷ | −40,3 tỷ |
| **Cần chuẩn bị** (gồm tồn quỹ tối thiểu 2 tỷ) | **17,9 tỷ** | **42,3 tỷ** |

Lý do: DA29 còn 93% khối lượng dồn vào T10–T12. Vật tư, nhân công và 17,9 tỷ đơn mua đã đặt phải chi trước, còn CĐT trả sau khoảng 45 ngày kể từ cuối tháng nghiệm thu.

## 5. Đã làm — Dự báo dòng tiền (06/10/2026, 8 câu phương án a)

- **Màn**: Tài chính → **Dự báo dòng tiền** (`/finance/forecast`, Quản trị Tài chính + Admin) và Tài chính dự án → tab **Dự báo** (người xem tài chính của dự án đó).
  Chọn kịch bản Cơ sở / Thận trọng / Thuận lợi, xem 1 / 3 / 6 tháng hoặc 13 tuần. Ô số: tiền đang có, thu, chi, tháng căng nhất, cần chuẩn bị thêm — bấm được.
  Gợi ý cho GĐ tài chính (số cần chuẩn bị, nếu CĐT trả sớm 30 ngày thì cần bao nhiêu — tính lại thật, đơn quá hẹn, nhân công ước). Biểu đồ thu / chi / số dư,
  bảng theo nguồn × tháng (bấm dòng xem cách tính + mở nguồn), theo dự án, giả định, khoản vay, khoản dự kiến (thêm tay / import Excel / bỏ có lý do), xuất Excel.
- **Máy chủ** (`20261008134900_finance_forecast.sql`): `get_finance_forecast_v1` tính từng dòng tiền theo ngày rồi gộp tháng / tuần.
  Tiền vào: đợt CĐT đã xác nhận (chắc chắn), đã gửi, phần đã làm chưa đề nghị (ước tính), sản lượng tương lai theo Gantt (theo kế hoạch) — tổng tiền còn phải thu của HĐ
  = giá trị gồm VAT × (1 − giữ lại) − đã thu − đang chờ, chia theo sản lượng (không lệ thuộc các đợt cũ chưa tách tạm ứng).
  Tiền ra: công nợ theo hạn, tạm ứng / chi khác đã lập, đơn mua chưa giao (quá hẹn > 30 ngày tách dòng), vật tư dự toán chưa đặt, thầu phụ còn lại, nhân công ước theo %,
  lương (bảng lương gần nhất), khoản định kỳ, lãi + gốc vay, khoản dự kiến.
  Giả định ở `finance_settings` (CĐT duyệt 15 ngày + hạn HĐ, trả NCC 30 ngày, nhân công 11,1%, VAT vật tư 8%, Thận trọng +30 ngày & chậm 20%, Thuận lợi sớm 15 ngày).
  Bảng mới `finance_loans`, `finance_forecast_items`. Danh sách "còn thiếu dữ liệu" trả kèm nơi khai.
- **Số thật 06/10** (Cơ sở, chưa gồm tiền đang có vì tài khoản chưa chốt đầu kỳ): tháng căng nhất T11/2026, cần chuẩn bị khoảng 11,6 tỷ (gồm tồn tối thiểu 2 tỷ);
  Thận trọng ≈ 39 tỷ. Thu 6 tháng 120,8 tỷ / chi 80,4 tỷ.
- Rollback `tools/forecast-test.mjs` 43/43 (quyền 4 vai, tổng thu khớp HĐ SMB 35,49 tỷ / DA29 85,29 tỷ, kịch bản dời đúng chiều, giả định, vay một lần / chia đều, khoản dự kiến + import lỗi dòng nào, bỏ khoản).

## 6. Đã làm — Sao kê ngân hàng + tự khớp (06/10/2026, ưu tiên 3)

- **Màn**: Thu chi & quỹ → tài khoản ngân hàng → **Sao kê ngân hàng**. Nhập file Excel sao kê tải từ internet banking (đọc được cột của Vietcombank, BIDV,
  VietinBank, Techcombank, MB, ACB…: Ngày, Ghi nợ / Ghi có hoặc Số tiền + Loại, Nội dung, Số tham chiếu, Đối ứng, Số dư; tự bỏ dòng tiêu đề, số dư đầu, tổng cộng).
  File được lưu làm chứng từ. Dòng đã nhập trước tự bỏ (cùng ngày, chiều, số tiền, số tham chiếu, nội dung).
- **Tự khớp** với sổ thu chi: cùng tài khoản, cùng chiều, cùng số tiền, lệch ngày ≤ 5; số chứng từ Vioo (DNC-…, PT-…) xuất hiện trong nội dung được ưu tiên;
  nhiều ứng viên ngang nhau thì để kế toán chọn. Một dòng sổ chỉ khớp một dòng sao kê.
- **Dòng chưa khớp**: gợi ý tối đa 5 dòng sổ gần số tiền / ngày → bấm khớp (lệch tiền phải ghi lý do); hoặc **Ghi phiếu thu khác** / **Lập phiếu chi khác** điền sẵn từ dòng
  sao kê (phiếu thu tự đính file sao kê); hoặc **Bỏ qua** có lý do. Danh sách **sổ chưa thấy trên sao kê** trong kỳ đã nhập; so số dư cuối sao kê với sổ cùng ngày.
- Huỷ cả file (quyền Xác nhận, có lý do) — sổ thu chi không đổi, nhật ký giữ đủ dòng đã xoá.
- Máy chủ: `20261008135000_finance_bank_statement.sql` (bảng `finance_bank_statements`, `finance_bank_statement_lines`; RPC nhập / xem / khớp / huỷ).
  Rollback `tools/bank-test.mjs` 31/31; đọc file `lib/bankStatementImport.ts` 5 test.
- Còn lại của mục "Tiền & ngân hàng": khoản vay đã làm cùng Dự báo; nhắc dòng chưa khớp ở Việc cần làm (đợt sau).

## 7. Đã làm — K3c hóa đơn đầu vào + khớp 3 bên (06/10/2026, theo quyết định 8 doc 08 duyệt 01/10)

- **Màn**: Tài chính → Phải trả → bước **Hóa đơn NCC**: chờ duyệt lệch, chờ hàng, đã ghi, chứng từ chưa có hóa đơn (theo NCC), trả lại / đã đảo.
  Màn chi tiết NCC ghi rõ từng chứng từ đã có hóa đơn nào / còn bao nhiêu chưa có.
- **Ghi hóa đơn**: nhập tay hoặc **đọc file XML hóa đơn điện tử** (NĐ 123 / TT 78: ký hiệu, số, ngày, tiền hàng, VAT, tổng, thuế suất; tìm NCC theo MST,
  danh mục trùng MST thì ưu tiên NCC đang có chứng từ; file XML tự đính kèm). Chọn chứng từ nhận hàng / bảng đối soát mà hóa đơn thanh toán (tự chọn theo tổng tiền).
  Tính ngay: theo nhận hàng, lệch, dung sai (0,5% hoặc 50.000 đ, lấy số lớn hơn).
  - Khớp / lệch trong dung sai → ghi ngay; lệch dương thành chứng từ "điều chỉnh theo hóa đơn" (tăng nợ), lệch âm giảm trừ vào chứng từ đã gắn; chi phí dự án điều chỉnh theo.
  - Vượt dung sai → ghi lý do, người khác (quyền Xác nhận) duyệt / trả lại; chưa duyệt thì chưa đổi công nợ.
  - Không chọn chứng từ → "Chờ hàng" (hóa đơn đến trước hàng), khớp sau.
  - Đảo hóa đơn (Xác nhận, lý do): gỡ điều chỉnh nếu phần điều chỉnh chưa trả / chưa đề nghị chi.
- **HĐ NCC "bắt buộc hóa đơn trước khi chi"** (cờ đã có ở điều khoản HĐ) giờ chặn thật: đề nghị chi chứng từ chưa có hóa đơn đã ghi bị chặn (`FINANCE_CONTRACT_NEEDS_INVOICE`).
- Khoá 3 hàm ghi hóa đơn kiểu cũ (tab Tài chính dự án đã gỡ); bảng hóa đơn chỉ đọc theo quyền Tài chính.
- Máy chủ: `20261008135100_finance_k3c_invoices.sql` (sinh bằng `tools/gen_k3c.py` từ `k3c_template.sql` + vá 2 hàm đang chạy). Rollback `tools/k3c-test.mjs` 43/43.
- Chưa làm: xuất chứng từ mua hàng sang MISA (chờ mẫu import từ chị Hương); báo Mua hàng ngay trên đơn PO khi hóa đơn lệch (hiện thấy ở Tài chính).

## 8. Đã làm — Báo cáo (06/10/2026)

- **Màn**: Tài chính → **Báo cáo** (`/finance/reports`, quyền Tài chính — Xem), 3 tab, mỗi bảng xuất Excel đúng bộ lọc:
  - **Tuổi nợ phải trả**: theo NCC hoặc theo dự án; nhóm chưa đến hạn / 1–30 / 31–60 / 61–90 / > 90 ngày / chưa có hạn, thanh màu tuổi nợ, đang đề nghị chi,
    ngày quá hạn cũ nhất; ô tổng / quá hạn / > 90 / chưa có hạn bấm để lọc; bấm NCC mở đúng NCC ở Phải trả.
  - **Tuổi nợ phải thu**: theo HĐ CĐT, cùng nhóm tuổi; cột chờ CĐT xác nhận + giữ lại bảo hành; cảnh báo HĐ chưa đối chiếu đầu kỳ; bấm mở đúng HĐ.
  - **Lãi lỗ dự án** (chưa VAT): giá trị HĐ, tiến độ, doanh thu theo sản lượng và đã nghiệm thu (nhắc phần chưa đề nghị), chi phí, lãi gộp tạm tính,
    chi phí dự báo khi xong, lãi dự kiến khi xong; biểu đồ 12 tháng (doanh thu nghiệm thu, chi phí, CĐT trả) toàn công ty hoặc từng dự án; chi phí theo loại.
- Máy chủ: `20261008135200_finance_reports.sql` (`get_finance_reports_v1`, cùng nguồn số với Phải trả / Phải thu / Chi phí & ngân sách). Rollback `tools/reports-test.mjs` 11/11.
- Số thật 06/10: phải trả 1,49 tỷ (quá hạn 348 tr); SMB doanh thu theo sản lượng 86,8 tỷ nhưng đã nghiệm thu 34,6 tỷ — cần lập đợt đề nghị; lãi gộp tạm tính cao
  vì chi phí MISA mới nhập đến 31/07 (SMB) / 19/08 (DA29).
