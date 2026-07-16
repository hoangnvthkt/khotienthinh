# HANDOFF_SUMMARY

## 1. Mục tiêu ban đầu

Triển khai kiến trúc phân quyền mới cho VIOO theo mô hình:

`Principal - Permission - Scope - Assignment - Workflow - Notification`

Daily Log là pilot đầu tiên. Mục tiêu chính:

- Permission không còn là bộ quyền cố định toàn hệ thống.
- Quyền phụ thuộc vào scope, assignment, workflow state và thời gian hiệu lực.
- Notification đi theo trách nhiệm workflow, không broadcast cho tất cả người có permission.
- Internal/deep link không tự cấp quyền.
- Daily Log khi gửi duyệt CHT phải tự resolve người chịu trách nhiệm, không bắt người gửi tự chọn trong danh sách nhiều người có quyền verify.

## 2. Việc đã hoàn thành

- Tạo tài liệu kiến trúc riêng cho mô hình quyền mới.
- Bổ sung policy về internal deep link, notification action link và public capability link.
- Implement Daily Log pilot trên branch hiện tại `refactor/module-du-an-v1`, không tạo worktree mới.
- Tạo migration `20260716040851_daily_log_responsibility_assignment_pilot.sql`.
- Apply migration lên Supabase Cloud bằng `supabase db query --linked --workdir .`, không dùng `db push`.
- Chạy dry-run `BEGIN ... ROLLBACK` với `lock_timeout = '5s'` trước khi apply thật.
- Repair migration history Cloud cho version `20260716040851` là `applied`.
- Tạo bảng/logic:
  - `public.app_responsibility_slots`
  - `public.app_responsibility_slot_events`
  - `public.app_assignments`
  - `public.app_assignment_events`
  - `public.can_view_subject(...)`
  - `public.can_act_on_subject(...)`
  - `public.get_daily_log_responsibility_target(...)`
  - `public.get_daily_log_assignment_context(...)`
  - `public.upsert_daily_log_responsibility_slot(...)`
- Override `public.transition_daily_log_status(text,text,text,text,text)` để Daily Log submit/verify/return đi qua assignment-aware backend check.
- Revoke `anon` khỏi Daily Log authorization/action RPC mới.
- Cấu hình Cloud responsibility slots cho Daily Log:
  - `current_verifier` theo CHT công trường.
  - `current_approver` theo cấp quản lý/Ban giám đốc.
- Verify Cloud:
  - 4 slot active.
  - Resolver trả đúng người.
  - `can_receive = true`.
  - Không có duplicate active slot.
  - Có đủ audit events.
- Frontend Daily Log đã chuyển hướng submit sang backend resolver thay vì chọn verifier thủ công.
- Thêm test static/contract cho migration, service authorization và UI contract.
- Chạy `npm test`, `npm run lint`, `npm run build` thành công trong phiên implement trước.

## 3. File đã thay đổi

- `docs/security/principal-permission-scope-assignment-workflow-notification-architecture.md`
- `supabase/migrations/20260716040851_daily_log_responsibility_assignment_pilot.sql`
- `lib/subjectAuthorizationService.ts`
- `lib/__tests__/subjectAuthorizationService.test.ts`
- `lib/__tests__/dailyLogResponsibilityAssignmentMigration.test.ts`
- `lib/__tests__/dailyLogAssignmentUiContract.test.ts`
- `lib/__tests__/routeAccess.test.ts`
- `pages/project/DailyLogTab.tsx`

File cần đọc tiếp trước khi làm:

- `docs/security/principal-permission-scope-assignment-workflow-notification-architecture.md`
- `supabase/migrations/20260716040851_daily_log_responsibility_assignment_pilot.sql`
- `pages/project/DailyLogTab.tsx`
- `lib/subjectAuthorizationService.ts`
- `lib/projectStaffService.ts`
- `pages/project/ProjectOrgTab.tsx`
- `components/permissions/PermissionMatrix.tsx`
- `lib/permissions/permissionAdminService.ts`
- `lib/permissions/permissionRegistry.ts`
- `lib/permissions/permissionService.ts`
- `lib/notificationService.ts`
- `lib/notificationAlertRules.ts`
- `context/AuthContext.tsx`

## 4. Quyết định kỹ thuật quan trọng

- Backend là authority cuối cùng. Frontend chỉ hỗ trợ UX, không được tự quyết quyền workflow.
- Internal ERP link không cấp quyền. Copy link không tạo view/action permission.
- Permission chỉ nói user có thể được phép làm gì; assignment mới nói hồ sơ cụ thể đang giao cho ai.
- Daily Log submit không cho frontend truyền người duyệt thật. Tham số legacy `p_requested_verifier_*` được giữ để tương thích nhưng bị backend bỏ qua.
- Daily Log resolver ưu tiên responsibility slot:
  - `construction_site`
  - `project`
  - `global`
- `current_verifier` yêu cầu permission `project.daily_log.verify`.
- `current_approver` yêu cầu permission `project.daily_log.approve`.
- User có cùng permission nhưng không có active assignment không được xử lý hồ sơ.
- User có assignment nhưng mất grant/sai scope/hết hạn vẫn bị deny.
- Notification/inbox hướng đích phải đi theo assignment/relationship, không theo permission pool.
- `app_responsibility_slots` là cấu hình người chịu trách nhiệm mặc định theo scope.
- `app_assignments` là trách nhiệm runtime trên subject cụ thể.
- Không mở `anon` để chữa regression.
- Không dùng `supabase db push` vì remote migration history đã từng drift.

## 5. Lỗi / vấn đề còn tồn tại

- Daily Log pilot chưa được xác nhận end-to-end trên Vercel/Production UI sau khi apply DB Cloud.
- Notification/Inbox chưa hoàn toàn assignment-first ở backend; hiện mới đi được phần Daily Log/resolved target.
- Các module khác như Material Request, Payment/Quantity, Quality, WMS, HRM, Asset, Contract chưa onboard vào mô hình mới.
- Legacy permission vẫn tồn tại:
  - `allowedModules`
  - `adminModules`
  - `allowedSubModules`
  - `adminSubModules`
  - `project_staff_permissions`
- UI phân quyền mới vẫn hiển thị một số quyền `LEGACY`; cần cleanup/transition rõ hơn.
- Người dùng hỏi cách bỏ quyền legacy: hiện có thể set inactive ở DB hoặc qua UI nếu màn hình hỗ trợ, nhưng cần hoàn thiện UX bỏ tích legacy/derived grants.
- Label UI "Tự động theo responsibility slot khi gửi" đúng về kỹ thuật nhưng hơi khó hiểu với người dùng cuối; nên đổi thành tên người nhận đã resolve nếu có thể.
- Chưa theo dõi đủ 24 giờ production logs sau rollout để khẳng định sạch lỗi.
- Chưa triển khai hardening toàn bộ auth/session telemetry trong scope cũ của plan remediation.

## 6. Rủi ro cần chú ý

- Nếu chưa cấu hình responsibility slot cho scope mới, Daily Log submit sẽ fail-closed.
- Nếu gán slot cho user có permission rộng/global nhưng không đúng trách nhiệm thực tế, notification/task sẽ route sai người.
- Nếu frontend vẫn hiển thị manual verifier picker ở flow nào đó, có thể làm người dùng hiểu sai là được chọn người duyệt tùy ý.
- Nếu legacy permission còn được dùng song song, user có thể thấy quyền trong UI nhưng backend mới vẫn deny vì thiếu assignment.
- Nếu notification vẫn dùng `project_permission` pool, sẽ quay lại lỗi gửi cho nhiều người có cùng quyền.
- Nếu reapply migration hoặc repair nhầm history cũ, có thể làm lệch migration state Cloud.
- Nếu mở grant cho `anon` để chữa lỗi nhanh, sẽ phá invariant bảo mật.
- Nếu dùng link/route guard frontend thay backend authorization, shared-link bypass vẫn có thể tái xuất hiện.

## 7. Việc cần làm tiếp theo

1. Test end-to-end Daily Log trên môi trường đang dùng Cloud:
   - Login user lập nhật ký.
   - Tạo/tổng hợp Daily Log.
   - Bấm `Gửi CHT`.
   - Verify assignment tạo đúng CHT theo công trường.
   - Login CHT xử lý được.
   - Login user khác có `project.daily_log.verify` nhưng không assigned bị deny.
2. Cải thiện UI Daily Log:
   - Thay text "Tự động theo responsibility slot khi gửi" bằng tên người nhận resolve được.
   - Nếu chưa có slot, hiển thị cảnh báo cấu hình thiếu trước khi bấm gửi.
3. Hoàn thiện Notification/Inbox Daily Log:
   - Submitted -> active `current_verifier`.
   - Returned -> creator/revision owner.
   - Approved -> creator/watcher.
   - Không gửi theo tất cả user có permission.
4. Hoàn thiện UI quản trị quyền:
   - Bỏ tích quyền mới qua `user_permission_grants`.
   - Legacy/derived grant phải hiển thị rõ nguồn.
   - Không để người dùng tưởng bỏ một ô legacy là đã bỏ hết quyền nếu quyền đó được sinh từ grant mới.
5. Viết migration/logic nếu cần để cleanup dần legacy permission.
6. Sau Daily Log ổn định, rollout module kế tiếp:
   - Material Request.
   - Payment/Quantity.
   - Quality.
7. Theo dõi Supabase Cloud logs tối thiểu 24 giờ sau deploy frontend.

## 8. Lệnh đã chạy và kết quả

- `npm test`
  - Kết quả trong phiên implement trước: passed, 149 test files, 893 tests.
- `npm run lint`
  - Kết quả: passed.
- `npm run build`
  - Kết quả: passed, chỉ có warning chunk size của Vite.
- `psql --version`
  - Kết quả: không có `psql` trên máy.
- Direct connection `db.<project>.supabase.co`
  - Kết quả: lỗi IPv6 `no route to host`.
- `npx supabase db query ... --linked --workdir .`
  - Kết quả: kết nối Cloud thành công, Postgres 17.6.
- Dry-run migration:
  - `BEGIN; set local lock_timeout = '5s'; ... ROLLBACK;`
  - Kết quả: `dry_run_rolled_back`.
- Apply migration Cloud:
  - Chạy migration `20260716040851_daily_log_responsibility_assignment_pilot.sql` trong transaction riêng.
  - Kết quả: `migration_applied`.
- `npx supabase migration repair 20260716040851 --status applied --linked --workdir . --yes`
  - Kết quả: repaired history `[20260716040851] => applied`.
- Verify Cloud sau migration:
  - `migration_history_marked_applied = true`
  - `assignments_exists = true`
  - `can_act_wrapper_exists = true`
  - `transition_exists = true`
  - `assignment_rows = 5`
  - `anon` không có execute trên action RPC.
  - `authenticated` có execute trên public wrapper cần thiết.
- Configure Daily Log slots Cloud:
  - Tạo 2 `current_verifier` slots.
  - Tạo 2 `current_approver` slots.
  - Kết quả verify:
    - 4 slots active.
    - duplicate active slots = 0.
    - audit events = 4.
    - resolver `can_receive = true` cho cả 4 người.

## 9. Các phần KHÔNG được tự ý thay đổi

- Không tạo worktree mới nếu user đã nói làm trên branch hiện tại.
- Không dùng `supabase db push`.
- Không mass-repair migration history cũ.
- Không reapply migration `20260716040851` nếu Cloud history đã marked applied.
- Không mở quyền `anon` cho Daily Log/workflow/assignment RPC.
- Không khôi phục manual verifier picker làm nguồn quyết định backend.
- Không để notification đi theo permission pool thay cho assignment.
- Không dùng frontend fallback để che lỗi schema/RPC.
- Không xóa legacy permission fields trong một migration lớn.
- Không rollout toàn ERP trong một lần.
- Không sửa/revert các thay đổi không thuộc task khi chưa hiểu nguồn gốc.
- Không coi `app_responsibility_slots` là quyền; nó chỉ là cấu hình trách nhiệm mặc định.
- Không coi permission là assignment; action workflow cần cả permission + scope + assignment + workflow state.

## 10. Prompt đề xuất để bắt đầu phiên Codex mới

```text


Mục tiêu tiếp theo:
2. Không tạo worktree mới.
3. Không chạy supabase db push.
4. Kiểm tra Daily Log pilot end-to-end:
   - Gửi CHT tự resolve từ responsibility slot.
   - CHT được assigned xử lý được.
   - User khác có project.daily_log.verify nhưng không assigned bị deny.
5. Cải thiện UI Daily Log để hiển thị tên người nhận thay cho "Tự động theo responsibility slot khi gửi".
6. Hoàn thiện Notification/Inbox Daily Log theo assignment-first.
7. Kiểm tra UI phân quyền mới/legacy:
   - user_permission_grants là nguồn quyền mới.
   - legacy permissions cần hiển thị rõ là LEGACY/derived.
   - bỏ tích quyền phải gọi RPC/flow an toàn, không sửa tay DB từ frontend.
8. Chạy test/lint/build trước khi báo hoàn thành.

Nhắc lại các điều cấm:
- Không dùng db push.
- Không mở anon.
- Không reapply migration 20260716040851 nếu không có lý do rõ.
- Không quay lại chọn người duyệt thủ công ở backend.
- Không gửi notification theo tất cả người có cùng permission.
```
