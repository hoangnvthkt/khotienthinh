# Workspace instructions

- Không sử dụng Superpowers skills cho các công việc không quá phức tạp. Ưu tiên thực hiện trực tiếp, ngắn gọn và đúng phạm vi.
- Mọi công việc Supabase trong repository này phải dùng Supabase Cloud với cấu hình sẵn có trong `.env`. Không dùng Supabase local và không dùng Docker.
- Không sử dụng sub-agent. Thực hiện công việc bằng agent chính, trừ khi người dùng thay đổi rõ ràng chỉ dẫn này trong yêu cầu sau.

## UI/UX bắt buộc khi task chạm tới giao diện

- **Trước khi làm bất kỳ màn hình nào, đọc `docs/ui/VIOO-UI-UX.md`** và áp dụng mặc định, không chờ người dùng nhắc. Đây là style chủ sản phẩm đã duyệt, rút từ Mua hàng, Tài chính, Quy trình: bộ component dùng lại, màu FastCons xanh, bố cục header → dải bước/KPI → lọc → danh sách nhóm → ngăn chi tiết, trạng thái, microcopy, mobile.

- Không chỉ đảm bảo đúng chức năng. Phải tư duy đồng thời như Product Designer, người dùng thực tế và Frontend Engineer.
- Thiết kế theo công việc người dùng cần hoàn thành, không theo cấu trúc database hay góc nhìn developer. Trước khi code, xác định người dùng là ai, mục tiêu khi vào màn hình, thông tin cần thấy đầu tiên, action chính và các thao tác có thể rút gọn.
- Giao diện phải dễ hiểu, dễ dùng, đẹp, hiện đại, chuyên nghiệp và phù hợp sử dụng hằng ngày. Chú ý layout, visual hierarchy, màu sắc, typography, icon, spacing, button, card, table, form, trạng thái và microcopy.
- Ưu tiên reuse Design System hiện tại và giữ nhất quán toàn hệ thống. Dùng drill-down, expandable hoặc progressive disclosure khi cần để tránh đưa quá nhiều thông tin và action ra cùng lúc.
- Người dùng phải có thể nhìn, hiểu, quyết định và hành động mà không cần hiểu kiến trúc hệ thống. Primary action phải rõ. Loading, empty, error, unknown, denied, pending và success phải được thể hiện đúng; không che lỗi hoặc unknown bằng `0`.
- Sau khi implement, walkthrough như người dùng lần đầu trên desktop, tablet và mobile phù hợp với scope. Kiểm tra họ có hiểu màn hình trong vài giây, biết bước tiếp theo và không gặp thao tác thừa hoặc gây bối rối.
- Functional correctness là bắt buộc nhưng chưa đủ. Giao diện khó hiểu, thiếu thẩm mỹ, không nhất quán hoặc thao tác rườm rà chưa được coi là hoàn thành.
- Không redesign ngoài scope. Nếu UX hiện tại có vấn đề rõ ràng, cải thiện trong phạm vi an toàn hoặc ghi nhận thành follow-up.

## Tương thích trình duyệt (bài học sự cố, bắt buộc)

- Animation lặp vô hạn chỉ được đổi `opacity`/`transform`. Không animate `box-shadow`, `filter`, `background`, kích thước, không dùng `color-mix(currentColor)` trong keyframes. Sự cố 06/10/2026 (PR #117): nhấp nháy bằng box-shadow trên ~40 nhãn làm Safari máy tính và mọi trình duyệt trên iPhone sập trang Quy trình.
- Trên iPhone mọi trình duyệt đều là WebKit; Chrome máy tính chạy được không chứng minh điện thoại chạy được. Màn có trên điện thoại phải được test bằng Playwright WebKit (`mobile-safari`); màn nhiều phần tử động phải đo CPU khi trang đứng yên ≈ 0–2%.
- Thư viện mới phải chạy trên Safari iOS đời cũ. Xem PDF dùng iframe blob URL của trình duyệt (không dùng pdf.js).
- Chi tiết và cách tái hiện lỗi WebKit với dữ liệu thật: `docs/ui/VIOO-UI-UX.md` mục 6.
