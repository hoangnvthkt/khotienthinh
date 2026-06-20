# Hướng Dẫn Sử Dụng Hệ Thống AI ChibiBot & AI Learning

Phiên bản: 2026-06-19

## 1. Mục Tiêu

Hệ thống AI hiện tại giúp công ty dùng AI theo 3 hướng chính:

- **Trợ lý AI dữ liệu**: hỏi số liệu vận hành từ hệ thống ERP, ví dụ tồn kho, nhân sự, dự án, đơn mua hàng, định mức, dự toán.
- **Trợ lý AI kiến thức**: hỏi theo tài liệu nội bộ đã upload vào Kho Kiến Thức.
- **AI Learning**: lưu lại feedback, quy tắc nghiệp vụ, thuật ngữ nội bộ và memory đã được duyệt để AI trả lời ổn định hơn.

AI không học bằng cách fine-tune model. AI học theo cơ chế **RAG + tri thức đã duyệt**:

- Tài liệu đầy đủ nằm trong Kho Kiến Thức.
- Quy tắc quan trọng nằm trong AI Learning.
- Feedback của người dùng được admin review trước khi dùng làm tri thức chính thức.

## 2. Các Khu Vực Chính

| Khu vực | Đường dẫn | Dùng để làm gì |
|---|---|---|
| Kho Kiến Thức | `/knowledge-base` | Upload, đồng bộ, xử lý tài liệu nội bộ |
| Trợ lý AI | `/ai` | Hỏi dữ liệu ERP hoặc hỏi theo tài liệu |
| ChibiBot | Góc dưới giao diện | Hỏi nhanh trong khi đang làm việc |
| AI Learning | `/settings` > AI Learning | Quản lý feedback, memory, rules, glossary, analytics |
| Phân quyền AI Learning | `/settings` > Người dùng | Cấp quyền feature `/settings/ai-learning` |

## 3. Dành Cho Người Dùng Thường

### 3.1. Hỏi dữ liệu công ty

Vào **Trợ lý AI** và chọn mode **Dữ liệu**.

Dùng khi cần hỏi:

- Tổng tồn kho hiện tại.
- Tìm vật tư theo tên hoặc mã.
- Danh sách dự án/công trường.
- Thông tin nhân sự.
- Báo cáo đơn mua hàng, đề xuất vật tư.
- Template dự toán, định mức, đơn giá nội bộ nếu tài khoản có quyền.

Ví dụ câu hỏi:

```text
Tổng tồn kho hiện tại có bao nhiêu mặt hàng?
```

```text
Tìm vật tư thép D10 trong kho.
```

```text
Danh sách các dự án đang hoạt động?
```

Lưu ý:

- AI chỉ đọc dữ liệu, không tự tạo/sửa/xóa dữ liệu.
- Dữ liệu nhạy cảm như đơn giá nội bộ vẫn kiểm tra quyền tài khoản.
- Nếu thiếu thông tin, AI sẽ hỏi lại thay vì đoán.

### 3.2. Hỏi theo tài liệu nội bộ

Vào **Trợ lý AI** và chọn mode **Kiến thức**.

Dùng khi cần hỏi:

- Quy trình công ty.
- Nội quy lao động.
- Chính sách nhân sự.
- Quy định an toàn.
- Hướng dẫn vận hành kho.
- Quy trình dự án hoặc nghiệm thu.

Ví dụ câu hỏi:

```text
Theo tài liệu công ty, quy trình xin nghỉ phép gồm những bước nào?
```

```text
Ai là người duyệt phiếu xuất kho theo quy trình nội bộ?
```

```text
Tóm tắt quy định an toàn lao động trên công trường.
```

Lưu ý:

- AI chỉ trả lời tốt khi tài liệu đã được xử lý xong và có trạng thái **Sẵn sàng**.
- Khi không tìm thấy nguồn phù hợp, AI sẽ báo chưa tìm thấy thay vì bịa.
- Với câu hỏi về quy định, nên hỏi rõ tên quy trình, phòng ban hoặc bối cảnh.

### 3.3. Dùng ChibiBot

ChibiBot là trợ lý nhanh ở góc màn hình.

Dùng khi:

- Muốn hỏi nhanh mà không rời màn hình đang làm việc.
- Cần tra cứu nhanh số liệu hoặc hỏi câu ngắn.
- Muốn góp ý nhanh cho câu trả lời.

ChibiBot có tuỳ chọn cá nhân:

- **Giọng trả lời**: cân bằng, ngắn gọn, thân thiện, quản trị.
- **Độ dài trả lời**: ngắn, vừa, chi tiết.

Các tuỳ chọn này được lưu theo user và AI sẽ dùng trong các lần trả lời sau.

### 3.4. Góp ý câu trả lời

Ở câu trả lời của AI có nút feedback:

- Chọn **tốt** khi câu trả lời đúng.
- Chọn **chưa tốt** khi câu trả lời sai, thiếu hoặc cần sửa.

Khi góp ý chưa tốt, nên ghi rõ:

- Sai ở điểm nào.
- Câu trả lời đúng nên là gì.
- Nếu có quy trình/tài liệu liên quan, nêu tên tài liệu.

Feedback sẽ được đưa vào hàng chờ để admin review. AI không tự học ngay từ feedback chưa duyệt.

## 4. Dành Cho Admin: Nạp Tài Liệu Công Ty

### 4.1. Chuẩn bị tài liệu

Nên gom tài liệu theo nhóm:

- HRM: nhân sự, nghỉ phép, chấm công, lương, nội quy.
- WMS: kho, nhập xuất, kiểm kê, cấp phát vật tư.
- DA: dự án, công trường, nhật ký, nghiệm thu.
- HD/Tender: hợp đồng, chào thầu, dự toán, định mức.
- Safety/Quality: an toàn, chất lượng, checklist.
- Finance: thanh toán, tạm ứng, đối chiếu, ngân sách.

Nên đặt tên file rõ ràng:

```text
HRM_Quy_trinh_nghi_phep_2026.docx
```

```text
WMS_Quy_trinh_xuat_kho_v2.pdf
```

```text
DA_Quy_trinh_nghiem_thu_chat_luong_2026.pdf
```

Tránh:

- Tên file chung chung như `Quy trình mới.docx`.
- Nhiều bản trùng nhau mà không biết bản nào mới nhất.
- Scan ảnh mờ không có text OCR.
- File có mật khẩu hoặc không copy được text.

### 4.2. Upload vào Kho Kiến Thức

Vào **Kho Kiến Thức** tại `/knowledge-base`.

Thao tác:

1. Kéo thả file vào vùng upload hoặc chọn file.
2. Hệ thống tạo record trong `rag_documents`.
3. Hệ thống gọi function `process-document`.
4. Tài liệu được tách thành chunk trong `rag_chunks`.
5. Chờ trạng thái chuyển thành **Sẵn sàng**.

Định dạng đang hỗ trợ:

- `pdf`
- `docx`
- `doc`
- `txt`
- `md`
- `xlsx`

### 4.3. Đồng bộ từ module tài liệu

Nếu công ty đã upload tài liệu trong module HRM hoặc Project Documents, dùng nút đồng bộ trong Kho Kiến Thức.

Hệ thống sẽ:

- Lấy tài liệu từ `hrm_documents`.
- Lấy tài liệu từ `project_documents`.
- Bỏ qua file ảnh.
- Tạo record mới trong `rag_documents`.
- Gọi xử lý tài liệu cho các file mới.

### 4.4. Kiểm tra sau khi nạp

Sau khi upload, kiểm tra:

- Tài liệu có trạng thái **Sẵn sàng**.
- `chunk_count` lớn hơn 0.
- Không có `error_message`.
- Hỏi thử trong AI Assistant mode **Kiến thức**.

Câu hỏi kiểm tra nên dùng:

```text
Tóm tắt tài liệu [tên tài liệu] trong 5 ý chính.
```

```text
Theo tài liệu [tên tài liệu], ai là người phê duyệt bước cuối?
```

```text
Quy trình [tên quy trình] gồm những bước nào?
```

Nếu AI không trả lời đúng, kiểm tra lại file đã ready chưa, có chunk chưa, và nội dung file có text đọc được không.

## 5. Dành Cho Admin: Quản Trị AI Learning

Vào **Cài đặt** > **AI Learning**.

Khu vực này có 5 tab:

- **Feedback Review**
- **Memory**
- **Business Rules**
- **Glossary**
- **Analytics**

### 5.1. Feedback Review

Dùng để xem góp ý từ người dùng.

Mỗi feedback có thể có:

- Câu hỏi gốc.
- Câu trả lời AI.
- Rating tốt/chưa tốt.
- Lý do.
- Correction text.
- Câu trả lời đề xuất.
- Trạng thái review.

Admin có thể:

- Duyệt feedback thành memory.
- Từ chối feedback sai.
- Archive feedback không còn dùng.

Nguyên tắc:

- Chỉ duyệt feedback khi chắc chắn đúng.
- Nếu feedback dựa trên quy trình, nên đối chiếu tài liệu gốc.
- Không duyệt tri thức nhạy cảm hoặc chưa kiểm chứng.

### 5.2. Memory

Memory là ghi nhớ đã duyệt để AI dùng khi trả lời.

Dùng cho:

- Kinh nghiệm vận hành.
- Correction đã xác nhận.
- Ghi nhớ cấp công ty.
- Ghi nhớ theo domain.

Các scope:

| Scope | Ý nghĩa |
|---|---|
| `enterprise` | Áp dụng toàn công ty |
| `domain` | Áp dụng theo mảng như WMS, HRM, Project |
| `user` | Áp dụng riêng cho một user |

Memory nên ngắn, rõ, đã kiểm chứng.

Ví dụ:

```text
Khi người dùng hỏi về quy trình nghỉ phép, ưu tiên tài liệu HRM_Quy_trinh_nghi_phep_2026.
```

Không nên đưa nguyên cả tài liệu dài vào memory. Tài liệu dài phải nằm trong Kho Kiến Thức.

### 5.3. Business Rules

Business Rules là các quy tắc nghiệp vụ quan trọng.

Dùng cho:

- Quy định bắt buộc.
- Điều kiện phê duyệt.
- Nguyên tắc không được vi phạm.
- Cách diễn giải nghiệp vụ thống nhất.

Ví dụ:

```text
Phiếu xuất kho chỉ được xem là hợp lệ khi đã có người phê duyệt theo luồng được cấu hình.
```

```text
AI không được tự suy luận đơn giá nội bộ nếu tool không trả về dữ liệu.
```

Lưu ý:

- Business Rules giúp AI trả lời nhất quán.
- Quyền truy cập dữ liệu vẫn do code/RPC kiểm soát, không chỉ dựa vào prompt.
- Rule nên có domain nếu chỉ áp dụng cho một mảng.

### 5.4. Glossary

Glossary là từ điển thuật ngữ nội bộ.

Dùng cho:

- Tên viết tắt.
- Thuật ngữ công ty.
- Cách gọi khác nhau của cùng một khái niệm.

Ví dụ:

| Term | Definition | Aliases |
|---|---|---|
| MR | Phiếu đề xuất vật tư | Material Request |
| PO | Đơn mua hàng | Purchase Order |
| CHT | Chỉ huy trưởng công trường | Chỉ huy trưởng |

Khi glossary được duyệt, AI sẽ hiểu thuật ngữ nội bộ tốt hơn.

### 5.5. Analytics

Analytics dùng để theo dõi AI vận hành:

- Câu hỏi gần đây.
- Tool được gọi.
- Trạng thái success/error/rejected/clarification.
- Thời gian phản hồi.
- Domain và route action.

Dùng tab này để phát hiện:

- Câu hỏi nào AI hay trả lời lỗi.
- Tool nào hay bị lỗi.
- Chủ đề nào người dùng hỏi nhiều.
- Cần bổ sung tài liệu/rule ở đâu.

## 6. Quy Trình Chuẩn Để AI Học Bộ Tài Liệu Quy Trình Công Ty

### Bước 1: Chuẩn hóa bộ tài liệu

Lập danh sách tài liệu theo bảng:

| Nhóm | Tên tài liệu | Phiên bản | Chủ sở hữu | Trạng thái |
|---|---|---|---|---|
| HRM | Quy trình nghỉ phép | 2026 | Phòng HCNS | Còn hiệu lực |
| WMS | Quy trình xuất kho | v2 | Phòng Kho | Còn hiệu lực |
| DA | Quy trình nghiệm thu | 2026 | Phòng Dự án | Còn hiệu lực |

Chỉ upload tài liệu đang còn hiệu lực hoặc ghi rõ tài liệu cũ.

### Bước 2: Upload vào Kho Kiến Thức

Upload từng nhóm tài liệu vào `/knowledge-base`.

Sau khi upload, chờ hệ thống xử lý xong.

### Bước 3: Kiểm tra chất lượng retrieval

Vào `/ai`, chọn mode **Kiến thức**.

Hỏi thử mỗi tài liệu ít nhất 3 câu:

- Câu hỏi tóm tắt.
- Câu hỏi chi tiết.
- Câu hỏi kiểm tra người phê duyệt/trách nhiệm/thời hạn.

Nếu AI trả lời thiếu, xem lại tài liệu có phải file scan ảnh hoặc thiếu text không.

### Bước 4: Chắt lọc rule/glossary/memory

Với các quy định quan trọng, nhập vào AI Learning:

- Quy tắc bắt buộc đưa vào **Business Rules**.
- Từ viết tắt đưa vào **Glossary**.
- Kinh nghiệm hoặc correction đã xác nhận đưa vào **Memory**.

### Bước 5: Cho người dùng thật sử dụng và feedback

Người dùng hỏi trong AI Assistant hoặc ChibiBot.

Khi AI trả lời chưa đúng:

- Người dùng bấm feedback chưa tốt.
- Ghi lý do/correction.
- Admin review trong Feedback Review.
- Nếu đúng, admin duyệt thành memory.

### Bước 6: Bảo trì định kỳ

Hàng tháng hoặc khi có quy trình mới:

- Upload bản mới.
- Xóa/archive bản cũ nếu hết hiệu lực.
- Cập nhật Business Rules.
- Cập nhật Glossary.
- Review feedback pending.
- Kiểm tra Analytics để biết AI còn yếu ở chủ đề nào.

## 7. Phân Quyền

### 7.1. Người dùng AI thông thường

Người dùng có thể:

- Dùng AI Assistant.
- Dùng ChibiBot nếu được cấp module ChibiBot.
- Hỏi tài liệu trong Kho Kiến Thức nếu có quyền vào module.
- Gửi feedback.

### 7.2. Admin AI Learning

Người quản trị AI Learning cần quyền:

```text
/settings/ai-learning
```

Người này có thể:

- Xem feedback.
- Duyệt/từ chối feedback.
- Thêm/sửa/xóa memory.
- Thêm/sửa/xóa business rules.
- Thêm/sửa/xóa glossary.
- Xem analytics.

### 7.3. Nguyên tắc phân quyền

- Không cấp quyền AI Learning cho toàn bộ user.
- Chỉ cấp cho người hiểu nghiệp vụ và có trách nhiệm duyệt tri thức.
- Với dữ liệu nhạy cảm, quyền truy cập vẫn theo module nghiệp vụ, không theo AI Learning.

## 8. Nguyên Tắc An Toàn

AI được phép:

- Đọc dữ liệu qua tool/RPC đã kiểm soát.
- Trả lời theo tài liệu đã upload.
- Dùng memory/rule/glossary đã approved.
- Ghi feedback và telemetry.

AI không được phép:

- Tự sửa dữ liệu ERP.
- Tự tạo phiếu nghiệp vụ.
- Tự duyệt chứng từ.
- Tự học từ feedback chưa duyệt.
- Tự bịa quy định nếu không có tài liệu hoặc rule.
- Bỏ qua quyền dữ liệu nhạy cảm.

## 9. Cách Viết Câu Hỏi Để AI Trả Lời Tốt

Nên hỏi rõ:

```text
Theo quy trình xuất kho, thủ kho cần kiểm tra những gì trước khi xuất vật tư?
```

```text
Tóm tắt quy trình xin nghỉ phép cho nhân viên văn phòng.
```

```text
Danh sách các bước nghiệm thu chất lượng theo tài liệu nội bộ.
```

Nên tránh:

```text
Quy trình sao em?
```

```text
Cái này làm thế nào?
```

```text
Theo luật thì sao?
```

Nếu câu hỏi có nhiều khả năng hiểu, hãy nêu thêm:

- Tên phòng ban.
- Tên quy trình.
- Tên dự án/công trường.
- Mốc thời gian.
- File/tài liệu cần căn cứ.

## 10. Xử Lý Sự Cố

### Tài liệu upload nhưng AI không tìm thấy

Kiểm tra:

- Tài liệu có trạng thái **Sẵn sàng** chưa.
- `chunk_count` có lớn hơn 0 không.
- File có phải scan ảnh không có OCR không.
- Tên tài liệu có quá chung chung không.
- Câu hỏi có dùng đúng thuật ngữ trong tài liệu không.

Hành động:

- Bấm xử lý lại tài liệu.
- Upload bản text/OCR tốt hơn.
- Thêm thuật ngữ vào Glossary.
- Thêm rule quan trọng vào Business Rules.

### AI trả lời theo quy trình cũ

Kiểm tra:

- Có nhiều bản tài liệu trùng nhau không.
- Bản cũ còn trạng thái ready không.
- Business Rules có còn rule cũ không.
- Memory có ghi nhớ cũ không.

Hành động:

- Archive hoặc xóa bản tài liệu cũ.
- Cập nhật rule/memory.
- Hỏi lại và kiểm tra nguồn.

### AI không gọi được dữ liệu nhạy cảm

Nguyên nhân thường gặp:

- User chưa đăng nhập bằng session hợp lệ.
- User không có quyền admin/module phù hợp.
- Tool bị chặn theo chính sách bảo mật.

Hành động:

- Kiểm tra quyền module của user.
- Kiểm tra admin module.
- Không bypass bằng prompt hoặc memory.

### Feedback không thành tri thức ngay

Đây là hành vi đúng.

Feedback phải qua admin review. Chỉ feedback đã approved mới nên trở thành memory/rule/glossary.

## 11. Checklist Vận Hành Hàng Tuần

- Xem tài liệu nào đang `error` hoặc `processing` quá lâu.
- Review feedback pending.
- Duyệt memory đúng, từ chối feedback sai.
- Kiểm tra Analytics các lỗi gần đây.
- Bổ sung Glossary cho thuật ngữ người dùng hay hỏi.
- Cập nhật Business Rules khi có quy trình mới.
- Hỏi thử 5-10 câu thực tế để kiểm tra chất lượng.

## 12. Checklist Khi Có Quy Trình Mới

1. Xác định tài liệu chủ nguồn.
2. Đặt tên file rõ phiên bản/ngày hiệu lực.
3. Upload vào Kho Kiến Thức.
4. Chờ trạng thái ready.
5. Hỏi thử trong mode Kiến thức.
6. Chắt lọc rule quan trọng vào Business Rules.
7. Thêm thuật ngữ mới vào Glossary.
8. Thông báo người dùng có thể hỏi AI theo quy trình mới.

## 13. Tóm Tắt Cách Dùng Đúng

- Muốn AI biết toàn bộ tài liệu: upload vào **Kho Kiến Thức**.
- Muốn AI nhớ quy tắc quan trọng: nhập vào **Business Rules**.
- Muốn AI hiểu từ nội bộ: nhập vào **Glossary**.
- Muốn AI sửa dần theo thực tế: dùng **Feedback Review** và duyệt thành **Memory**.
- Muốn kiểm tra AI đang hoạt động thế nào: xem **Analytics**.

Hệ thống tốt nhất khi công ty duy trì một vòng lặp đều đặn:

```text
Upload tài liệu -> AI tra cứu -> Người dùng feedback -> Admin duyệt -> AI Learning cải thiện
```
