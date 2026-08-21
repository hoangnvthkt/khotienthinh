# Thiết kế Safety Workforce theo hồ sơ gốc và công trường

Ngày thiết kế: 2026-08-21

Trạng thái: Bản chốt để review trước khi lập implementation plan

Phạm vi: Dự án → An toàn → Hồ sơ nhân công, Nhân công công trường, Nhà thầu phụ, Tổ đội và Thẻ an toàn

## 1. Mục tiêu

Thiết kế lại luồng quản lý nhân công an toàn theo nguyên tắc:

- Mỗi người chỉ có một hồ sơ nhân thân gốc trên toàn hệ thống.
- Mỗi công trường chỉ nhìn thấy người đã có membership tại công trường đó.
- Một người chỉ được có một assignment đang hoạt động tại một thời điểm.
- Nhà thầu hoặc tổ đội có thể hoạt động đồng thời tại nhiều công trường và phân bổ người khác nhau cho từng nơi.
- Nhà thầu/tổ đội khi tạo hồ sơ được lấy trực tiếp từ dữ liệu Nhà thầu phụ và Tổ đội của công trường hiện tại.
- Mỗi lần tham gia, rời hoặc chuyển công trường đều được lưu thành lịch sử, không ghi đè hồ sơ gốc.
- Thẻ an toàn được quản lý ngay trong hồ sơ nhân công, nhưng vẫn giữ bảng riêng để bảo toàn lịch sử cấp, in và thu hồi.
- Màn hình mở nhanh, không tải thừa các tab khác và không ký URL của tài liệu nhạy cảm trước khi người dùng mở chi tiết.

## 2. Ràng buộc triển khai

- Chỉ dùng Supabase Cloud đã cấu hình trong `.env`; không dùng Supabase local hoặc Docker.
- Không đưa `service_role` hoặc secret key vào frontend.
- RLS và RPC là biên bảo vệ dữ liệu; filter frontend không được xem là ranh giới bảo mật.
- Mọi mutation ảnh hưởng assignment, transfer hoặc card phải chạy trong transaction phía database.
- Dữ liệu CCCD, sức khỏe, bảo hiểm và signed URL chỉ được giữ trong memory; không lưu vào `localStorage`, IndexedDB hoặc cache offline.
- Không thêm React Query/SWR trong phase này. Cache dùng pattern `Map + TTL + invalidation` đã có trong repository.
- Migration phải additive trước, backfill có thể chạy lặp an toàn, có preflight và hậu kiểm trước khi siết RLS.
- Các bảng/view/RPC mới trong exposed schema phải tuân thủ RLS; view nếu có phải dùng `security_invoker = true`.
- `construction_site_id` mới trong domain Safety Workforce dùng kiểu `uuid` và có foreign key tới `public.hrm_construction_sites(id)`.

## 3. Hiện trạng đã xác minh

### 3.1 Dữ liệu Cloud

Tại thời điểm audit:

- Có 54 `safety_worker_profiles`.
- Chỉ 1 hồ sơ có `safety_project_assignments`; 53 hồ sơ chưa được gán công trường.
- Có 54 ảnh thẻ và 107 ảnh CCCD trên hồ sơ gốc.
- Có 216 `safety_worker_documents` với 107 file đính kèm.
- Không có nhóm CCCD trùng sau khi chuẩn hóa `identity_type + identity_number`.
- Có đúng một công trường khớp tên chuẩn hóa `Công trường Sơn Miền Bắc` và đúng một dự án liên kết công trường này.
- Có 3 Nhà thầu phụ và 1 Tổ đội tại Sơn Miền Bắc.
- Tên nhà thầu legacy đang gắn với hồ sơ nhân công khớp duy nhất với một Nhà thầu phụ tại Sơn Miền Bắc sau khi chuẩn hóa tên.

### 3.2 Nguyên nhân lẫn dữ liệu

`safety_worker_profiles` và `safety_contractors` hiện là dữ liệu toàn cục, không có scope công trường. `listWorkers()` tải toàn bộ hồ sơ mà không nhận `projectId` hoặc `constructionSiteId`. RLS hiện cho Admin/Module Admin DA bypass toàn bộ Safety Passport, còn người dùng có nhiều công trường nhận hợp dữ liệu của các công trường họ được phép xem.

Frontend truyền đúng project/site vào `SafetyTab`, nhưng riêng màn Hồ sơ nhân công không áp dụng scope này. Do đó chuyển từ công trường A sang B vẫn thấy cùng một danh sách toàn cục.

### 3.3 Nguyên nhân tải chậm

Mỗi lần mount `SafetyPassportPanel`, sáu loader cùng chạy bất kể tab hiện tại chỉ dùng một phần dữ liệu. Với dữ liệu hiện có, màn hình ký riêng từng URL ảnh và có thể phát sinh khoảng 173–187 request Supabase cho một lần mở.

`pg_stat_statements` ghi nhận truy vấn toàn bộ `safety_worker_profiles` có mean database time khoảng 48,95 ms; network và Storage signing nằm ngoài con số này. Bảng chỉ có 54 dòng nên nút thắt chính là request fan-out, tải `select('*')`, RLS lặp theo row và ký file trước nhu cầu, không phải dung lượng bảng.

## 4. Các quyết định nghiệp vụ đã chốt

1. Hồ sơ nhân công là dữ liệu gốc toàn công ty và không bị nhân bản khi người đó đổi công trường.
2. Membership quyết định công trường nào được biết và nhìn thấy hồ sơ.
3. Assignment là một giai đoạn làm việc thực tế tại công trường.
4. Một người chỉ có tối đa một assignment `active` trên toàn hệ thống, không phân biệt nhân công nhà thầu hay cán bộ công ty.
5. Một Nhà thầu phụ hoặc Tổ đội có thể có người ở nhiều công trường cùng lúc; giới hạn chỉ áp dụng trên từng cá nhân.
6. Khi tạo hồ sơ tại công trường, Nhà thầu/Tổ đội phải lấy từ `safety_subcontractors` và `safety_teams` đúng scope hiện tại.
7. Hồ sơ gốc không lưu Nhà thầu/Tổ đội như quan hệ có hiệu lực lâu dài. Đơn vị làm việc được lưu trên membership và snapshot vào assignment để giữ lịch sử.
8. Một membership được giữ lại khi người đã rời công trường để công trường cũ vẫn xem được lịch sử của chính mình.
9. Công trường mới không được duyệt danh sách người của công trường cũ. Tìm hồ sơ gốc để gán lại chỉ hỗ trợ exact lookup bằng mã nhân công hoặc CCCD đã chuẩn hóa và chỉ trả dữ liệu tối thiểu.
10. Nếu người vẫn có assignment active ở nơi khác, thao tác gán mới bị từ chối. Assignment cũ phải được kết thúc trước hoặc người có quyền trên cả hai scope thực hiện transfer.
11. Backfill lần đầu đưa toàn bộ 54 hồ sơ hiện có vào Sơn Miền Bắc và tạo assignment active cho 53 hồ sơ chưa có assignment.
12. Thẻ an toàn được hiển thị và thao tác trong chi tiết hồ sơ/assignment; không còn tab Thẻ an toàn độc lập sau cutover.

## 5. Mô hình domain

```text
safety_worker_profiles (hồ sơ nhân thân gốc)
        │
        ├── safety_worker_documents / safety_worker_certificates
        │
        ├── safety_worker_site_memberships (quyền hiện diện theo công trường)
        │       │
        │       └── safety_project_assignments (các giai đoạn công tác)
        │               │
        │               ├── safety_site_inductions
        │               └── safety_cards
        │
        └── lịch sử tổng hợp từ assignments của các membership
```

### 5.1 Hồ sơ nhân công gốc

`public.safety_worker_profiles` tiếp tục là nguồn sự thật của:

- Mã nhân công.
- Họ tên, ngày sinh, số điện thoại.
- CCCD/hộ chiếu và ảnh nhận diện.
- Phân loại `company_staff | contractor_worker`.
- Trạng thái hồ sơ gốc `active | suspended | inactive`.

Migration bổ sung hai cột authoritative trên hồ sơ gốc:

- `worker_kind text not null` với check `company_staff | contractor_worker`.
- `identity_number_normalized text` được chuẩn hóa nhất quán từ `identity_number` trong RPC/trigger database, không nhận giá trị tùy ý từ client.

Các trường `contractor_id` và `team_name` hiện tại không còn authoritative. Phase chuyển đổi giữ chúng để rollback và đối chiếu; frontend mới không ghi các trường này. Chỉ drop sau khi cutover, backfill và audit dữ liệu đã hoàn tất.

Trước khi thêm unique constraint, migration phải xác minh không có trùng `identity_type + identity_number_normalized`. Với dữ liệu Cloud hiện tại, preflight đang cho kết quả không có nhóm trùng. Partial unique index trên `(identity_type, identity_number_normalized)` chỉ áp dụng khi identity number chuẩn hóa không rỗng.

### 5.2 Membership công trường

Tạo bảng `public.safety_worker_site_memberships`:

| Cột | Ý nghĩa |
| --- | --- |
| `id` | UUID primary key |
| `worker_id` | FK tới hồ sơ gốc |
| `project_id` | FK tới `projects(id)`, bắt buộc |
| `construction_site_id` | UUID FK tới `hrm_construction_sites(id)`, bắt buộc |
| `default_subcontractor_id` | Nhà thầu phụ mặc định tại công trường, nullable với cán bộ công ty |
| `default_team_id` | Tổ đội mặc định thuộc nhà thầu đã chọn, nullable |
| `status` | `candidate | active | inactive` |
| `first_joined_at` | Lần đầu được đưa vào roster công trường |
| `last_left_at` | Lần gần nhất kết thúc assignment, nullable |
| `source` | `manual | transfer | son_mien_bac_backfill_v1` |
| `created_by`, `updated_by`, timestamps | Audit cơ bản |

Unique `(worker_id, construction_site_id)` đảm bảo mỗi người có một membership bền vững cho mỗi công trường. Project và site phải khớp liên kết trong `projects`; RPC từ chối cặp project/site không hợp lệ.

Các bảng Safety legacy đang lưu `construction_site_id` dạng `text`, trong khi `hrm_construction_sites.id` là `uuid`. Phase này không ép đổi kiểu hàng loạt các bảng Safety khác. Membership dùng UUID canonical; RPC so sánh master Nhà thầu/Tổ đội legacy bằng `construction_site_id = p_construction_site_id::text`, đồng thời xác minh site UUID tồn tại và thuộc project. Scope canonical của assignment mới được suy ra từ `membership_id`; cột scope legacy trên assignment chỉ giữ để tương thích trong thời gian cutover.

Trạng thái membership được đồng bộ theo assignment:

- `candidate`: đã tạo hồ sơ/membership nhưng chưa bắt đầu làm việc.
- `active`: có đúng một assignment active tại membership này.
- `inactive`: đã từng tham gia nhưng hiện không còn assignment active.

### 5.3 Assignment và lịch sử làm việc

`public.safety_project_assignments` được nâng cấp để đại diện một giai đoạn công tác:

| Cột mới/chuyển nghĩa | Ý nghĩa |
| --- | --- |
| `membership_id` | FK bắt buộc tới membership sau backfill |
| `assignment_status` | `active | ended | suspended | cancelled` |
| `started_at` | Thời điểm bắt đầu có hiệu lực |
| `ended_at` | Thời điểm kết thúc, bắt buộc với `ended/cancelled` |
| `subcontractor_id` | Snapshot Nhà thầu phụ của giai đoạn |
| `team_id` | Snapshot Tổ đội của giai đoạn |
| `ended_by`, `ended_reason` | Audit kết thúc/chuyển công trường |

Các trường điều kiện an toàn hiện tại như `site_training_status`, `commitment_status`, `ppe_status`, `toolbox_status`, `eligibility_status` tiếp tục thuộc assignment vì chúng có hiệu lực theo từng công trường/giai đoạn.

Database drop unique legacy `(worker_id, project_id, construction_site_id)` sau khi assignment đã liên kết membership, vì constraint này ngăn một người quay lại cùng công trường ở giai đoạn sau. Thay vào đó có partial unique index trên `worker_id` khi `assignment_status = 'active'`, cùng index `(membership_id, started_at desc)`. Mọi command assignment đồng thời lock hồ sơ worker, kiểm tra thời gian và từ chối lịch sử bị chồng lấn. Không dựa vào kiểm tra frontend.

### 5.4 Nhà thầu phụ và Tổ đội

Không tạo thêm master `safety_contractors` cho luồng mới.

Khi mở form tại một công trường:

1. Lấy `safety_subcontractors` đúng `project_id + construction_site_id`.
2. Lấy `safety_teams` đúng scope và nhóm theo `subcontractor_id`.
3. Nếu `worker_kind = contractor_worker`, Nhà thầu phụ là bắt buộc; Tổ đội là tùy chọn.
4. Nếu chọn Tổ đội, database xác minh tổ đó thuộc Nhà thầu phụ đã chọn và cùng công trường.
5. Nếu `worker_kind = company_staff`, cả Nhà thầu phụ và Tổ đội để null.

Một Nhà thầu có thể có các bản ghi theo nhiều công trường. Sự hiện diện đa công trường của Nhà thầu không tạo hạn chế active; constraint chỉ nằm trên assignment của từng worker.

`public.safety_contractors` được đánh dấu legacy. Sau cutover:

- Thu hồi quyền ghi từ frontend.
- Không dùng trong list/form mới.
- Giữ read-only trong một release để audit/rollback.
- Chỉ drop cùng `safety_worker_profiles.contractor_id` sau khi xác nhận không còn consumer.

### 5.5 Hồ sơ và chứng chỉ

CCCD, ảnh nhận diện, sức khỏe, bảo hiểm và chứng chỉ là dữ liệu gốc của worker. Dữ liệu không bị copy khi tạo membership hoặc assignment mới.

Khả năng nhìn thấy được xác định qua membership của công trường yêu cầu. Basic profile và sensitive documents là hai capability khác nhau:

- Basic roster: mã, họ tên, ảnh thumbnail, vai trò, đơn vị tại assignment và trạng thái eligibility.
- Sensitive detail: CCCD, địa chỉ, sức khỏe, bảo hiểm và file đính kèm; chỉ quyền `project.safety.worker_manage` hoặc `project.safety.document_verify` được xem.

Document type `safety_card` không còn được tạo mới vì thẻ có lifecycle riêng trong `safety_cards`. Dữ liệu legacy loại này được giữ để audit rồi mới quyết định archive.

### 5.6 Thẻ an toàn

`public.safety_cards` tiếp tục lưu từng lần cấp thẻ và liên kết assignment.

Quy tắc:

- Chỉ assignment `active` và `eligibility_status = eligible` mới được cấp thẻ.
- Mỗi assignment có tối đa một thẻ `active` bằng partial unique index.
- Khi assignment kết thúc, transfer hoặc bị suspended, thẻ active được revoke trong cùng transaction.
- Gia hạn tạo event/lịch sử rõ ràng; không sửa im lặng ngày hết hạn mà không audit.
- `site_access_card_code` chỉ được giữ với nhãn `Mã thẻ cổng` nếu đây là mã hệ thống kiểm soát cổng khác Safety Card.
- QR lookup tiếp tục yêu cầu đăng nhập trong phase này; không mở public capability mới.

UI Thẻ an toàn được đưa vào hồ sơ assignment hiện tại: xem, cấp, in, gia hạn và thu hồi. Lịch sử thẻ nằm cùng lịch sử công tác.

## 6. Luồng nghiệp vụ

### 6.1 B1 — Tạo hồ sơ nhân công

1. Người dùng phải đang ở một project/site hợp lệ và có `project.safety.worker_manage`.
2. Chọn loại nhân sự: Cán bộ công ty hoặc Nhân công nhà thầu.
3. Với nhân công nhà thầu, chọn trực tiếp Nhà thầu phụ/Tổ đội của công trường hiện tại.
4. Hệ thống exact-check hồ sơ gốc theo mã nhân công hoặc CCCD chuẩn hóa.
5. Nếu chưa tồn tại, tạo profile gốc và các tài liệu được nhập.
6. Nếu đã tồn tại nhưng chưa thuộc roster công trường, dùng profile cũ; không tạo bản sao.
7. Tạo membership `candidate` tại công trường hiện tại trong cùng transaction.
8. B1 không tự tạo assignment active cho dữ liệu mới; người dùng tiếp tục B2 khi nhân công thực sự bắt đầu làm việc.

### 6.2 B2 — Gán nhân công vào công trường

1. Picker mặc định chỉ hiển thị membership `candidate/inactive` của công trường hiện tại.
2. Có exact lookup theo mã nhân công/CCCD để tìm hồ sơ gốc chưa có membership tại công trường.
3. RPC lock worker và kiểm tra không có assignment active ở công trường khác.
4. Tạo assignment active, snapshot Nhà thầu/Tổ đội, ngày bắt đầu và yêu cầu an toàn.
5. Membership chuyển `active`.
6. Eligibility được tính lại; việc được assignment không đồng nghĩa được phép qua cổng nếu hồ sơ chưa đủ.

Nếu worker vẫn active tại nơi khác, RPC trả lỗi nghiệp vụ chứa scope hiện tại ở dạng tối thiểu, không trả hồ sơ nhạy cảm. Người dùng phải kết thúc assignment cũ hoặc dùng luồng transfer nếu có quyền trên cả hai scope.

### 6.3 Chuyển công trường

`transfer_safety_worker_site` chạy một transaction:

1. Lock worker và assignment active hiện tại.
2. Xác minh actor có quyền quản lý tại cả nguồn và đích, hoặc là system admin trong context quản trị.
3. Kết thúc assignment nguồn, ghi `ended_reason = transfer`.
4. Revoke thẻ active nguồn.
5. Chuyển membership nguồn sang `inactive`.
6. Tạo hoặc kích hoạt membership đích.
7. Tạo assignment active đích với Nhà thầu/Tổ đội đích.
8. Tính lại eligibility; không tự cấp thẻ mới.
9. Ghi audit chứa source/destination scope và các ID liên quan.

### 6.4 Kết thúc công tác

Kết thúc assignment yêu cầu `ended_at >= started_at` và lý do. Assignment chuyển `ended`, thẻ active bị revoke, membership chuyển `inactive`. Profile gốc và lịch sử công trường không bị xóa.

### 6.5 B3 — Quản lý thẻ trong hồ sơ

Trong chi tiết assignment active:

- Nếu chưa đủ điều kiện: hiển thị nguyên nhân thiếu và không cho cấp thẻ.
- Nếu đủ điều kiện và chưa có thẻ: hiển thị `Cấp thẻ an toàn`.
- Nếu có thẻ: hiển thị preview, QR, ngày hết hạn, số lần in, Gia hạn, Thu hồi và In.
- Lịch sử công tác hiển thị thẻ đã cấp/thu hồi tương ứng từng assignment.

Tab `passportCards` bị bỏ khỏi navigation sau khi toàn bộ thao tác trên đã có trong hồ sơ.

## 7. Database commands và read models

Frontend không thực hiện chuỗi direct insert/update cho các invariant nhiều bảng. Các command công khai là wrapper `security invoker`; logic đặc quyền nếu cần đặt trong `app_private`, có explicit actor/scope authorization và `search_path = ''`.

Các interface cần có:

| Interface | Trách nhiệm |
| --- | --- |
| `list_safety_site_worker_roster` | Danh sách phân trang theo đúng project/site, filter/search server-side |
| `get_safety_site_worker_detail` | Basic profile, sensitive sections theo capability, membership, assignment, documents, card và history |
| `lookup_safety_worker_exact` | Tìm đúng một hồ sơ gốc bằng worker code/CCCD, trả dữ liệu tối thiểu |
| `create_safety_worker_profile_for_site` | Tạo/reuse profile và tạo membership candidate atomically |
| `assign_safety_worker_to_site` | Tạo assignment active và enforce một active assignment toàn hệ thống |
| `end_safety_worker_assignment` | Kết thúc assignment, revoke card và cập nhật membership |
| `transfer_safety_worker_site` | Chuyển nguồn–đích trong một transaction |
| `issue_safety_assignment_card` | Cấp thẻ khi đủ điều kiện |
| `revoke_safety_assignment_card` | Thu hồi thẻ có lý do và audit |
| `get_safety_passport_dashboard` | Aggregate theo project/site, không tải raw rows toàn cục |

Tên tham số RPC dùng prefix `p_`. Public wrapper không nhận `actor_user_id` từ client; actor luôn lấy từ session/current app user.

`lookup_safety_worker_exact` chỉ cho actor có quyền quản lý nhân công tại site đích, chỉ nhận exact normalized value, không hỗ trợ fuzzy/prefix search và được audit để tránh biến thành API dò CCCD toàn hệ thống.

Read roster dùng cursor `(created_at, id)` hoặc `(full_name, id)` tùy sort; không dùng OFFSET sâu. Response chỉ chứa cột cần cho list và không chứa JSON attachments.

## 8. RLS và bảo mật

### 8.1 Nguyên tắc

- Không cấp direct global SELECT trên profile/documents cho authenticated client.
- Roster và detail phải đi qua RPC nhận project/site cụ thể và xác minh actor có quyền trên đúng scope.
- Membership, assignment và card có RLS dựa trên project/site của membership.
- Admin hoặc Module Admin không được làm mất filter công trường trong Project page.
- System admin cần xem toàn cục phải dùng màn/RPC audit riêng, không tái sử dụng roster công trường.
- UPDATE luôn có SELECT policy tương ứng.
- Storage path không phải authorization; quyền đọc file được suy ra từ worker membership và capability sensitive.

### 8.2 Storage

- Bucket tiếp tục private.
- List roster chỉ lấy photo storage path hoặc thumbnail descriptor; không lấy identity/document attachment.
- Signed URL ảnh roster được tạo theo batch và có TTL ngắn.
- Signed URL hồ sơ nhạy cảm chỉ được tạo khi mở detail và sau kiểm tra capability.
- Signed URL không được persisted và không được dùng làm cache key.

### 8.3 Fail closed

Nếu project/site thiếu, không khớp hoặc actor mất quyền, service trả lỗi scope và UI không fallback sang truy vấn toàn cục. Chuyển site phải thay cache key trước khi render dữ liệu mới để không lóe dữ liệu site cũ.

## 9. Thiết kế frontend

### 9.1 Navigation

Nhóm Safety Passport còn ba bề mặt chính:

- Tổng quan Safety Passport.
- Hồ sơ nhân công của công trường.
- Nhân công đang làm việc tại công trường.

Thẻ an toàn không còn là tab độc lập. Nhà thầu phụ và Tổ đội vẫn là master theo công trường và là nguồn picker của hồ sơ/assignment.

### 9.2 Component boundary

`SafetyPassportPanel` không được mount toàn bộ hook cho mọi mode. Mỗi view có component/fetcher riêng:

- Dashboard chỉ gọi aggregate dashboard.
- Hồ sơ nhân công chỉ gọi roster membership.
- Nhân công công trường gọi active assignment read model.
- Detail modal gọi detail khi mở.

File lớn hiện tại được tách theo trách nhiệm trong phạm vi thay đổi, không refactor các tab Safety khác không liên quan.

### 9.3 Hồ sơ chi tiết

Modal/drawer chi tiết gồm:

1. Hồ sơ gốc.
2. Đơn vị tại công trường hiện tại.
3. Tài liệu cá nhân và chứng chỉ.
4. Điều kiện vào công trường.
5. Thẻ an toàn hiện tại.
6. Lịch sử assignment và thẻ.

Basic section render trước. Sensitive documents và signed URLs được tải khi người dùng mở section tương ứng.

## 10. Cache và hiệu năng

### 10.1 Cache strategy

Dùng cache memory theo pattern hiện có trong repository:

```text
userId | projectId | constructionSiteId | resource | page/cursor | filters
```

TTL:

- Dashboard: 15–30 giây.
- Roster và active assignments: 30–60 giây.
- Nhà thầu phụ/Tổ đội: 5–10 phút.
- Certificate types/card templates: 15–30 phút.

Cache hỗ trợ promise deduplication để hai component yêu cầu cùng key không tạo hai request đồng thời. Cache trả bản sao hoặc immutable data để consumer không sửa trực tiếp entry dùng chung.

### 10.2 Invalidation

- Tạo/sửa profile: invalidate roster và detail của đúng site.
- Tạo/end assignment: invalidate candidate roster, active assignments, detail và dashboard.
- Transfer: invalidate cả source và destination scope.
- Cấp/thu hồi/gia hạn thẻ: invalidate assignment detail, active list và dashboard.
- Logout/đổi user: clear toàn bộ Safety Workforce cache.

Cache không được dùng để bỏ qua authorization hoặc che lỗi API. Mutation luôn dựa trên response authoritative từ RPC.

### 10.3 Mục tiêu đo được

- Mở Hồ sơ nhân công lần đầu: tối đa 1 roster RPC và 1 batch photo-signing request.
- Chỉ khi mở form tạo/gán mới tải 1 request options Nhà thầu phụ/Tổ đội nếu cache master chưa có.
- Mở Nhân công công trường lần đầu: tối đa 1 read-model RPC và 1 batch photo-signing request.
- Không request CCCD, sức khỏe, bảo hiểm hoặc certificate attachment trước khi mở detail.
- Quay lại tab trong TTL không gọi lại cùng request.
- Chuyển site không hiển thị row từ cache của site trước.
- `pg_stat_statements` không còn truy vấn list toàn bộ `safety_worker_profiles` từ Project page.

## 11. Backfill Sơn Miền Bắc

### 11.1 Preflight bắt buộc

Migration dừng nếu bất kỳ điều kiện nào sai:

- Không tìm thấy đúng một site tên chuẩn hóa `Công trường Sơn Miền Bắc`.
- Site không liên kết đúng một project.
- Tổng profile hiện tại khác snapshot audit 54 hoặc có profile mới chưa được rà mapping.
- Có duplicate CCCD đã chuẩn hóa.
- Legacy contractor name không map duy nhất sang Nhà thầu phụ tại site.
- Existing assignment trỏ project/site khác với target nhưng không có quyết định transfer rõ ràng.

### 11.2 Mapping

- Profile có `safety_contractors` legacy được map bằng tên chuẩn hóa sang `safety_subcontractors` tại Sơn Miền Bắc.
- Profile không có contractor được phân loại `company_staff` và để Nhà thầu/Tổ đội null.
- Team chỉ map khi có quan hệ duy nhất; nếu không có thì membership/assignment giữ team null, không tự đoán theo text.

### 11.3 Thao tác

1. Tạo membership cho toàn bộ 54 profiles với source `son_mien_bac_backfill_v1`.
2. Giữ nguyên assignment hiện có và liên kết nó với membership tương ứng.
3. Tạo assignment active cho 53 profiles chưa có assignment.
4. `started_at` của assignment backfill mới dùng thời điểm migration; không giả định profile `created_at` là ngày bắt đầu làm việc.
5. Copy snapshot Nhà thầu/Tổ đội đã map vào assignment.
6. Recompute eligibility cho 54 assignment.
7. Ghi audit tổng hợp và metadata backfill trên các row mới.

Backfill không tự cấp Safety Card. Hồ sơ thiếu điều kiện vẫn có assignment active nhưng eligibility phản ánh đúng nguyên nhân thiếu.

### 11.4 Hậu kiểm

- 54/54 profiles có membership Sơn Miền Bắc.
- 54/54 profiles có đúng một assignment active.
- Không worker nào có hơn một assignment active.
- 53 assignment mới mang source/metadata backfill; assignment gốc không bị thay ID.
- Tổng worker documents và attachments không đổi.
- Không có card được tạo ngoài command cấp thẻ.
- Roster Sơn Miền Bắc trả đúng 54 hồ sơ; một site khác không trả các hồ sơ này nếu chưa có membership.

Rollback dữ liệu chỉ xóa row có source/metadata `son_mien_bac_backfill_v1`; không đụng assignment gốc hoặc hồ sơ/tài liệu gốc.

## 12. Rollout

### Phase 1 — Additive database

- Tạo membership, cột/constraint/index mới và RPC/read models.
- Chưa siết policy cũ.
- Chạy contract/smoke test trên Supabase Cloud.

### Phase 2 — Backfill và đối soát

- Chạy preflight read-only.
- Chạy backfill Sơn Miền Bắc trong transaction.
- Đối chiếu counts, mappings, eligibility và history.
- Không deploy frontend mới nếu bất kỳ hậu kiểm nào sai.

### Phase 3 — Frontend cutover

- Chuyển các view Passport sang RPC scoped.
- Tách conditional loading, thêm cache, lazy sensitive detail và batch photo signing.
- Gộp card vào worker detail.
- Theo dõi request count và lỗi scope.

### Phase 4 — RLS hardening

- Thu hồi direct global access không còn dùng.
- Bật policy/RPC boundary mới.
- Chạy test actor công trường A/B, module admin và system admin.
- Xác minh frontend không fallback global.

### Phase 5 — Legacy cleanup

- Dừng ghi `safety_contractors`, `worker_profiles.contractor_id`, `team_name` và document type `safety_card`.
- Sau ít nhất một release ổn định và audit không còn consumer, lập migration cleanup riêng.
- Cleanup không nằm chung migration backfill để giữ rollback đơn giản.

## 13. Error handling và observability

Các command trả mã lỗi nghiệp vụ ổn định:

- `SAFETY_SCOPE_REQUIRED` — thiếu project/site.
- `SAFETY_SCOPE_MISMATCH` — project không thuộc site.
- `SAFETY_WORKER_ACTIVE_ELSEWHERE` — worker đang active tại công trường khác.
- `SAFETY_CONTRACTOR_SCOPE_MISMATCH` — Nhà thầu không thuộc site.
- `SAFETY_TEAM_SCOPE_MISMATCH` — Tổ đội không thuộc Nhà thầu/site.
- `SAFETY_ASSIGNMENT_NOT_ELIGIBLE` — chưa đủ điều kiện cấp thẻ.
- `SAFETY_ACTIVE_CARD_EXISTS` — assignment đã có thẻ active.
- `SAFETY_TRANSFER_PERMISSION_REQUIRED` — actor không đủ quyền trên nguồn và đích.

Frontend hiển thị thông báo nghiệp vụ ngắn, giữ error code/message gốc trong logging. Signed URL ảnh lỗi chỉ làm ảnh dùng placeholder; không làm hỏng toàn bộ roster. Sensitive detail lỗi quyền phải đóng section và không giữ dữ liệu cũ.

Theo dõi sau rollout:

- Số request khi mở từng view.
- Mean/total time của các Safety RPC trong `pg_stat_statements`.
- Số lỗi active-assignment conflict và scope mismatch.
- Cache hit/miss ở development diagnostics, không gửi PII.
- RLS/security advisor cho bảng, view và function mới.

## 14. Kiểm thử và tiêu chí nghiệm thu

### 14.1 Database và RLS

- User chỉ có quyền site A không đọc được roster/detail/membership/assignment/card site B.
- User có quyền cả A và B vẫn chỉ nhận dữ liệu site được truyền vào RPC.
- Module Admin DA trong Project page không nhận union dữ liệu đa site.
- System admin chỉ xem toàn cục qua audit interface riêng.
- Direct insert tạo hai assignment active cho cùng worker bị database từ chối.
- Assign vào site B khi worker active tại A trả `SAFETY_WORKER_ACTIVE_ELSEWHERE`.
- Transfer có quyền hai phía kết thúc A, revoke card A và tạo assignment B atomically.
- Transfer lỗi ở bất kỳ bước nào rollback toàn bộ transaction.
- Contractor/team khác scope bị từ chối.
- Card không cấp được nếu assignment không active hoặc không eligible.

### 14.2 Frontend/service

- Mỗi Passport view chỉ gọi loader của chính view đó.
- Cache key phân biệt user/project/site/view/cursor/filter.
- Mutation invalidate đúng scope; transfer invalidate cả nguồn và đích.
- Đổi site không render cache của site cũ.
- Danh sách không gọi signed URL cho CCCD, bảo hiểm, sức khỏe hoặc certificate.
- Detail chỉ tải sensitive data khi actor có capability và section được mở.
- Dropdown Hồ sơ nhân công chỉ lấy Nhà thầu phụ/Tổ đội của site hiện tại.
- Card issue/print/revoke/renew hoạt động từ worker detail; navigation không còn tab card riêng.

### 14.3 Backfill

- Preflight chạy xanh trước mutation.
- Backfill chạy lần hai không tạo membership/assignment trùng.
- Hậu kiểm đạt đủ các count trong mục 11.4.
- Có script/query rollback được giới hạn bằng marker backfill.

### 14.4 Verification cuối

- Targeted Vitest cho service/cache/components.
- `npm run lint`.
- `npm run build`.
- Supabase Cloud smoke test dưới JWT authenticated cho ít nhất hai actor ở hai site.
- Query hậu kiểm dữ liệu, index usage và `pg_stat_statements`.
- Security advisor không có lỗi mới trong phạm vi Safety Workforce.

## 15. Ngoài phạm vi

- Không xây public QR capability trong phase này.
- Không hợp nhất Nhà thầu phụ Safety với toàn bộ master nhà cung cấp/đối tác toàn công ty.
- Không thêm chấm công, tính lương hoặc nhận diện khuôn mặt.
- Không xây workflow phê duyệt chuyển công trường nhiều bước; phase này dùng end-then-assign hoặc transfer atomically khi actor có đủ quyền.
- Không drop bảng/cột legacy trong cùng migration backfill.
- Không refactor các module Dự án khác ngoài các điểm tích hợp cần thiết của An toàn.

## 16. Kết quả mong đợi

Sau cutover:

- Hồ sơ gốc chỉ tồn tại một lần và theo người lao động xuyên suốt lịch sử.
- Công trường chỉ nhìn thấy roster và lịch sử thuộc membership của mình.
- Không thể có một người active tại hai công trường cùng lúc.
- Một Nhà thầu/Tổ đội có thể chia người làm đồng thời ở nhiều công trường.
- Tạo hồ sơ dùng trực tiếp Nhà thầu phụ/Tổ đội đang khai báo tại công trường.
- Thẻ an toàn nằm trong hồ sơ/assignment thay vì một tab rời.
- Màn hình Passport giảm từ hàng trăm request xuống số request có giới hạn và cache theo scope an toàn.
