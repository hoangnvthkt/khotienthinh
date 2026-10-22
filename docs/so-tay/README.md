# Sổ tay Vioo — nguồn cho công cụ `so_tay` của Trợ lý (B3, 22/10/2026)

Mỗi tệp `.md` ở đây là một mục "làm sao để…": phần đầu (frontmatter) ghi tiêu đề, phân hệ, màn hình mở, từ khóa (không dấu, cách gọi quen), quyền; phần thân là các bước ngắn
theo đúng màn hình thật. Trợ lý chỉ trả lời từ sổ tay này + danh mục màn hình / thao tác trong mã (`lib/search/searchCatalog.ts`) + hướng dẫn Dự án
(`docs/huong-dan-su-dung-phong-quan-ly-du-an.md`), không bịa bước.

Sinh lại sau khi sửa: `npm run handbook:build` → `supabase/functions/ai-gateway/handbook.generated.ts` (test `assistantHandbook` báo đỏ nếu quên).
Rồi deploy `ai-gateway`.

Quy ước thân mục: `**Khi nào:**` một câu · `**Các bước:**` danh sách đánh số 3–7 bước, mỗi bước một thao tác thấy được trên màn · `**Lưu ý:**` 1–3 gạch đầu dòng
(quyền, lỗi hay gặp, cách khác). Không quá 900 ký tự.
