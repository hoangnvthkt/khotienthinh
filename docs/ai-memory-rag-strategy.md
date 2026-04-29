# AI Data Assistant, RAG, and Memory Strategy

## Mục tiêu

Trợ lý AI có hai năng lực tách biệt:

- **Data mode**: hỏi số liệu vận hành trực tiếp từ database. Ví dụ tồn kho, tiến độ dự án, chi phí, nhân sự, tài sản, quy trình.
- **Knowledge mode**: hỏi tài liệu nội bộ qua RAG. Ví dụ quy định, quy trình, hợp đồng mẫu, chính sách, hướng dẫn công trường.

Không trộn hai nguồn này thành một pipeline duy nhất. Dữ liệu giao dịch cần query có kiểm soát; tài liệu nội bộ cần retrieval theo chunk và nguồn trích dẫn.

## Data Mode

Luồng đề xuất:

1. Người dùng hỏi bằng tiếng Việt.
2. Edge Function lấy schema catalog từ `ai_database_catalog()`.
3. LLM sinh SQL đọc-only.
4. Edge Function validate SQL một lần nữa.
5. RPC `execute_ai_readonly_query(p_query)` chạy query với timeout và limit.
6. LLM diễn giải kết quả, luôn nêu nguồn bảng.

Lý do:

- Không đưa `service_role` xuống browser.
- Không cho frontend gọi SQL trực tiếp.
- Có thể truy vấn nhiều bảng nhưng vẫn chặn ghi/xóa/sửa dữ liệu.
- Có chỗ tập trung để log, audit và cải thiện prompt.

## Knowledge Mode

Luồng hiện tại nên giữ:

1. Upload/sync tài liệu vào `rag_documents`.
2. Function `process-document` tách chunk, lưu vào `rag_chunks`.
3. AI Assistant gọi `ai_search_knowledge()` để lấy chunk phù hợp.
4. LLM trả lời có nguồn tài liệu.

Nâng cấp tiếp theo:

- Thêm vector embeddings bằng `pgvector` để search theo ngữ nghĩa thay vì chỉ full-text.
- Tách metadata theo `module`, `department`, `construction_site_id`, `doc_type`, `valid_from`, `valid_to`.
- Khi trả lời quy định/chính sách, ưu tiên tài liệu còn hiệu lực mới nhất.

## Obsidian Memory

Phù hợp khi anh muốn AI có bộ nhớ dạng markdown, dễ chỉnh tay, dễ version bằng Git.

Kiến trúc đề xuất:

- Một vault Obsidian nội bộ, mỗi note có frontmatter:

```yaml
---
type: policy | procedure | project_note | meeting | decision
module: DA | HRM | WMS | TS | WF
owner: user_id
tags: [an-toan, vat-tu, tien-do]
valid_from: 2026-01-01
valid_to:
source: obsidian
---
```

- Một job sync đọc file `.md`, tính hash nội dung, upsert vào `memory_documents`.
- Chỉ re-chunk/re-embed note khi hash thay đổi.
- Link ngược về path note để người dùng kiểm tra nguồn.

Ưu điểm:

- Dễ viết và sửa tri thức nội bộ.
- Có lịch sử thay đổi qua Git.
- Hợp với ghi nhớ dài hạn: quyết định, bài học công trường, quy chuẩn nội bộ.

Hạn chế:

- Cần quy ước tag/frontmatter nghiêm túc.
- Không nên dùng để lưu dữ liệu giao dịch thay đổi liên tục.

## Wiki Memory

Phù hợp khi công ty muốn nhiều người cùng soạn, duyệt, phân quyền nội dung.

Nguồn có thể là Notion, GitBook, Wiki.js, Confluence hoặc Docs nội bộ.

Kiến trúc đề xuất:

- Connector đồng bộ trang wiki theo lịch.
- Mỗi page lưu `source_url`, `space`, `title`, `updated_at`, `author`.
- Chỉ index các page đã publish/approved.
- Khi page bị archive/delete thì đánh dấu inactive trong RAG.

Ưu điểm:

- Tốt cho quản trị tri thức theo phòng ban.
- Dễ phân quyền và review nội dung.
- Người không dùng Git vẫn cập nhật được.

Hạn chế:

- Cần connector riêng.
- Cần xử lý quyền xem theo người dùng nếu tài liệu nhạy cảm.

## Khuyến nghị triển khai cho Kho Tiến Thịnh

Giai đoạn 1:

- Giữ `rag_documents` và `rag_chunks`.
- Bổ sung `ai_search_knowledge()`.
- Chuẩn hóa upload/sync từ HRM documents và Project documents.

Giai đoạn 2:

- Thêm `pgvector`.
- Thêm embedding cho chunk.
- Thêm metadata module/phòng ban/công trường.

Giai đoạn 3:

- Chọn một memory source chính:
  - Obsidian nếu anh muốn tri thức dạng markdown, có Git history.
  - Wiki/Notion nếu nhiều người trong công ty cùng biên tập.

Giai đoạn 4:

- Thêm permission-aware retrieval: AI chỉ lấy tài liệu người dùng hiện tại được xem.
- Thêm trích dẫn bắt buộc và nút mở nguồn.
