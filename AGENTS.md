# Workspace instructions

- Không sử dụng Superpowers skills cho các công việc không quá phức tạp. Ưu tiên thực hiện trực tiếp, ngắn gọn và đúng phạm vi.
- Mọi công việc Supabase trong repository này phải dùng Supabase Cloud với cấu hình sẵn có trong `.env`. Không dùng Supabase local và không dùng Docker.
- Không sử dụng sub-agent. Thực hiện công việc bằng agent chính, trừ khi người dùng thay đổi rõ ràng chỉ dẫn này trong yêu cầu sau.

## UI/UX bắt buộc khi task chạm tới giao diện

- Không chỉ đảm bảo đúng chức năng. Phải tư duy đồng thời như Product Designer, người dùng thực tế và Frontend Engineer.
- Thiết kế theo công việc người dùng cần hoàn thành, không theo cấu trúc database hay góc nhìn developer. Trước khi code, xác định người dùng là ai, mục tiêu khi vào màn hình, thông tin cần thấy đầu tiên, action chính và các thao tác có thể rút gọn.
- Giao diện phải dễ hiểu, dễ dùng, đẹp, hiện đại, chuyên nghiệp và phù hợp sử dụng hằng ngày. Chú ý layout, visual hierarchy, màu sắc, typography, icon, spacing, button, card, table, form, trạng thái và microcopy.
- Ưu tiên reuse Design System hiện tại và giữ nhất quán toàn hệ thống. Dùng drill-down, expandable hoặc progressive disclosure khi cần để tránh đưa quá nhiều thông tin và action ra cùng lúc.
- Người dùng phải có thể nhìn, hiểu, quyết định và hành động mà không cần hiểu kiến trúc hệ thống. Primary action phải rõ. Loading, empty, error, unknown, denied, pending và success phải được thể hiện đúng; không che lỗi hoặc unknown bằng `0`.
- Sau khi implement, walkthrough như người dùng lần đầu trên desktop, tablet và mobile phù hợp với scope. Kiểm tra họ có hiểu màn hình trong vài giây, biết bước tiếp theo và không gặp thao tác thừa hoặc gây bối rối.
- Functional correctness là bắt buộc nhưng chưa đủ. Giao diện khó hiểu, thiếu thẩm mỹ, không nhất quán hoặc thao tác rườm rà chưa được coi là hoàn thành.
- Không redesign ngoài scope. Nếu UX hiện tại có vấn đề rõ ràng, cải thiện trong phạm vi an toàn hoặc ghi nhận thành follow-up.
