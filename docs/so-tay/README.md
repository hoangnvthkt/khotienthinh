# Sổ tay Vioo — nguồn cho công cụ `so_tay` của Trợ lý (B3, 22/10/2026)

Mỗi tệp `.md` ở đây là một mục "làm sao để…": phần đầu (frontmatter) ghi tiêu đề, phân hệ, màn hình mở, từ khóa (không dấu, cách gọi quen), quyền; phần thân là các bước ngắn
theo đúng màn hình thật. Trợ lý chỉ trả lời từ sổ tay này + danh mục màn hình / thao tác trong mã (`lib/search/searchCatalog.ts`) + hướng dẫn Dự án
(`docs/huong-dan-su-dung-phong-quan-ly-du-an.md`), không bịa bước.

Sinh lại sau khi sửa: `npm run handbook:build` → `supabase/functions/ai-gateway/handbook.generated.ts` (test `assistantHandbook` báo đỏ nếu quên).
Rồi deploy `ai-gateway`.

Quy ước thân mục: `**Khi nào:**` một câu · `**Các bước:**` danh sách đánh số 3–7 bước, mỗi bước một thao tác thấy được trên màn ·
`**Không làm được?**` 2–5 dòng "triệu chứng → nguyên nhân thật → cách xử lý / ai xử lý" (Trợ lý dùng cho câu "tại sao") · `**Lưu ý:**` 1–3 gạch
đầu dòng (quyền, giới hạn, cách khác). Thân không quá 1.150 ký tự.

Frontmatter `questions:` (Đợt 1 hỗ trợ, 23/10/2026): 4–8 câu người dùng thật hay gõ, ngăn bằng ` | ` (có dấu / không dấu / viết tắt "ko, đc").
Bộ dựng bỏ dấu + bỏ từ đệm rồi gộp vào từ khóa. Câu hỏi kiểm tìm mục (không nằm trong sổ tay, để đo đúng) ở `lib/__tests__/assistantHandbookQuestions.test.ts`.
Tiền tố tên tệp theo nhóm: `nhan-su-` `kho-` `mua-hang-` `de-xuat-` `tai-chinh-` `hop-dong-` `du-an-tay-` `quy-trinh-` `yeu-cau-` `van-ban-`
`cong-viec-` `dat-xe-` `tai-san-` `vpp-` `chung-` (mục cũ không tiền tố giữ tên).
