# Vioo Office — triển khai production 04/10/2026

Office đã hoạt động tại [app production](https://khotienthinh.vercel.app/#/office). Đợt triển khai thực hiện sau khi chủ dự án yêu cầu áp migration production, chỉ định tài khoản quản trị và chị Đặng Thị Hương làm người duyệt. Mọi thay đổi mã nguồn nằm trên `codex/vioo-office`; không merge main hoặc sửa checkout khác.

## Bản sửa điều hướng

Frontend hiện tại là source `d49ccf9` trên cùng branch, deployment `dpl_CqmQjebuogpys72YazGhRkxK9gMb`: bổ sung Mẫu văn bản/Báo cáo vào global route guard qua danh sách Office dùng chung. Đã kiểm tra hai trang trên phiên đăng nhập thật, tải dữ liệu trống đúng trạng thái và reload không về trang chủ. Không thay database/quyền. [Bằng chứng mới](evidence/route-regression.json). Các thông tin deployment `0773352` bên dưới ghi lại đợt kích hoạt đầu.

## Database và quyền

- Supabase Cloud từ `.env`: `ftciqmqhmfvjtwoycswe`. Chỉ áp migration `20261004085552_office_p0_document_lifecycle.sql` vào 20:15 giờ Việt Nam; SHA-256 `cf809dc9a9157172bb45be6d34bac0838d9049980186ddd84581858faebfe398`.
- Schema, seed, quyền SQL và history đúng version được commit cùng một transaction; lock timeout 3 giây, statement timeout 45 giây, advisory lock, kiểm tra chưa tồn tại và reload PostgREST. Không áp migration module khác. Script `scripts/office/apply-production.mjs` kiểm tra hash đã nghiệm thu và từ chối replay khi Office tồn tại.
- 14 bảng public Office bật RLS; bucket `office-attachments` private, tối đa 50 MB. Có 16 loại và 7 thư mục ban đầu. Không nhập dữ liệu/số cũ từ Base.
- Tài khoản quản trị được chủ dự án chỉ định có 14 quyền Office. Tài khoản người duyệt có thêm đúng 3 quyền: module access global, view assigned, approve assigned; 89 quyền trực tiếp hiện có được giữ về phạm vi/hạn dùng. Cấp người duyệt qua preview/apply permission command v3; preview không có warning/hard deny. Cấp quản trị ADMIN qua canonical grants với audit/refresh riêng vì command v3 chỉ nhận non-Admin.
- Tuyến `Duyệt văn bản — Đặng Thị Hương` có một bước, gán mặc định cho 16 loại. Người soạn không tự duyệt; người duyệt không có quyền cấp số/phát hành từ lần cấp này. Quyền người dùng khác không thay đổi.
- Người nhận khác muốn dùng Office cần module access + view assigned qua hệ thống quyền hiện có. Gửi theo phòng ban không tự cấp quyền cho thành viên. Mốc số ban đầu chưa nối với sổ giấy/Base; phải cấu hình trước nếu tiếp tục một sổ đang dùng.

## Frontend và function

Frontend source `07733527bfe9a02146439572786eb2dacdc91fd4` trên `codex/vioo-office`, nền main `6e32def`, đã build và promote deployment `dpl_EkFmXKj4XxCktmjQuo6qRB8YsbAD`. Các commit báo cáo sau đó không đổi runtime. HTTP app và Office lazy chunk đều 200; bundle trỏ đúng Cloud production. Browser tải được màn hình đăng nhập; không có session thật sẵn để walkthrough các tài khoản sau đăng nhập.

Đây là manual production deployment từ branch riêng. Không đổi cấu hình Git production branch và không merge main; một lần deploy main tiếp theo có thể thay frontend Office. Khi phối hợp release phải giữ điều này trong kế hoạch. Database Office vẫn tồn tại độc lập với frontend.

`office-assistant` đã deploy bằng Cloud bundle `--use-api`, không Docker. Handler tự xác thực bearer qua Supabase Auth, giữ RLS theo caller. Request không có Auth trả 401 `OFFICE_DENIED`. Secrets `OFFICE_AI_API_KEY` và `OFFICE_AI_MODEL` chưa được thêm, nên chưa gọi provider/OCR thật.

## Kiểm chứng

- Bộ SQL P0/P1/extended đạt trên schema production đã áp; toàn bộ fixture trong transaction rollback.
- Luồng dùng request claims/role authenticated của hai tài khoản thật đạt: quản trị tạo/trình, người duyệt xem/duyệt và bị chặn cấp số, quản trị cấp số/phát hành, người nhận đọc. Xác nhận notification yêu cầu duyệt và phát hành đúng người; rollback toàn bộ để không phát push hoặc để lại văn bản/số thử.
- Postflight sau lượt thử hai tài khoản: 0 văn bản, 0 counters, 0 notification Office. Kiểm tra trước đó xác nhận không còn tài khoản fixture.
- Security advisors không có Office WARN/ERROR. Ba INFO về bảng private có RLS nhưng không policy là chủ ý chặn client; privileges đã thu hồi.
- Permission contract cập nhật từ catalog DB, bỏ 14 mã Office khỏi provisional allowlist; 14 tests contract/service đạt. Kết quả toàn repo, 22 browser tests responsive và các kiểm tra khác xem [validation.md](validation.md).
- Chưa nghiệm thu đăng nhập browser, bytes Storage HTTP/signed URL, push trên điện thoại vật lý, hai phiên cấp số cạnh tranh hoặc AI với key/model thật. Không coi SQL role test hay browser fixture là các kiểm thử này.

## Gói deploy và xử lý sai sót

Lần staging CLI đầu từ worktree đã đưa `.env` local cùng log vào source upload của Vercel. Deployment đó không được promote lên địa chỉ app; đã xóa deployment `dpl_Gb92qSdKFzKRQ9VsvFJ8zdPHDJwn` và thông báo chủ dự án. Không có bằng chứng secrets được công khai qua frontend.

Bản thay thế dựng từ Git archive của commit đã kiểm tra, 3.142 files trong manifest, không `.env`, log/test artifacts hoặc node_modules local. Đã thêm `.vercelignore` để ngăn lặp lại. Chỉ bản archive sạch này được promote. Không lưu secrets trong báo cáo/Git.

## Bằng chứng

[Migration](evidence/production-migration.json) · [Backend/roles](evidence/production-verification.json) · [Security](evidence/production-security.json) · [Frontend](evidence/production-frontend.json) · [Contract tests](evidence/production-contract-tests.txt).

Để tắt Office: thu hồi quyền module hoặc rollback frontend có kiểm soát; giữ nguyên bảng, audit và số đã phát hành. Không drop bảng hoặc tái sử dụng số. Migration đã áp không được sửa lại.
