---
description: Multi-Agent RAG
---

[Chia sẻ] Tại sao chatbot AI vẫn "ngáo" khi gặp data doanh nghiệp phức tạp?

— Và cách chúng mình giải quyết bằng Multi-Agent RAG

━━━━━━━━━━━━━━━━━━

Chào anh em,

Mình làm AI chatbot cho e-commerce được 2 năm. Bài toán quen thuộc ai làm chatbot cũng gặp:

- Khách hỏi "Nike Air Force 1 size 42 còn trắng không?" → Bot: "Dạ shop còn nhiều mẫu Nike ạ" (bịa, không biết tồn kho thật)

- Khách gửi ảnh sản phẩm hỏi giá → Bot: "Dạ anh cho em xin tên sản phẩm" (không nhận diện được)

- Khách chat 3 câu liên tục → Bot quên context, trả lời lạc đề

Vấn đề không phải LLM dở — mà là KIẾN TRÚC.

━━━━━━━━━━━━━━━━━━

Hầu hết chatbot hiện tại chạy 1 pipeline đơn giản:

Tin nhắn → 1 Prompt → 1 LLM → Trả lời

Một con AI duy nhất phải vừa:

• Hiểu ý định (intent)

• Tìm đúng thông tin (retrieval)

• Kiểm tra độ chính xác (grounding)

• Viết câu trả lời đúng giọng (generation)

• Ghi nhận thông tin khách (CRM)

• Chốt đơn nếu cần (checkout)

→ Dồn tất cả vào 1 prompt = bot "ngáo" là tất yếu.

Giống bắt 1 người vừa bán hàng, vừa kế toán, vừa quản kho, vừa CSKH. Không ai làm tốt tất cả cùng lúc.

━━━━━━━━━━━━━━━━━━

Cách mình giải quyết: thay vì 1 con AI, dùng CẢ ĐỘI NGŨ AI.

Kiến trúc Multi-Agent mình xây (xem hình 1):

🔹 Router (Screenwriter) → Phân tích tin nhắn, quyết định cần agent nào

🔹 Strategist → Phân tích ý định sâu, chọn chiến lược trả lời

🔹 RAG Agent → Tìm thông tin từ tài liệu (PDF, video, web) — Self-RAG với reranker

🔹 SQL Agent → Query TRỰC TIẾP database sản phẩm — giá, tồn kho REAL-TIME

🔹 Visual Agent → Nhận diện ảnh sản phẩm khách gửi

🔹 CRM Extractor → Tự ghi nhận tên, SĐT, nhu cầu → xây hồ sơ khách

🔹 Sales Closer → Nhận diện ý định mua → tạo link thanh toán 1-click

🔹 Content Writer → Viết câu trả lời đúng giọng brand

🔹 + 8 agents chuyên trách khác chạy song song...

Tất cả phối hợp trong vài giây, xử lý MỖI tin nhắn.

Kết quả (xem hình 2, 3, 4, 5):

✅ Khách hỏi size → Bot tra kho thật, trả lời chính xác tới từng biến thể

✅ Khách gửi ảnh → Bot nhận diện, tìm sản phẩm match

✅ Bot vừa chat vừa tự xây hồ sơ CRM — chủ shop không nhập tay 1 dòng nào

✅ Khách nói "chốt" → Bot tạo đơn + link thanh toán trong 3 giây

━━━━━━━━━━━━━━━━━━

Mình đã đóng gói toàn bộ kiến trúc này thành EVOKA — nền tảng AI bán hàng cho shop online VN. Hiện đang chạy production, phục vụ chủ shop thời trang, mỹ phẩm, F&B.

Anh em nào đang xây chatbot hoặc quan tâm Multi-Agent RAG, comment "AI" mình gửi tài liệu kiến trúc chi tiết + link trải nghiệm thử miễn phí nhé.

Hoặc anh em có cách tiếp cận khác cho bài toán này? Rất muốn nghe chia sẻ 👇

#MultiAgent #RAG #AIChatbot #LangGraph #ChiaSeKyThuat