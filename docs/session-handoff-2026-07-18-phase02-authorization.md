# Session Handoff — VIOO Phase 02 Authorization Governance

Ngày kết xuất: `2026-07-18T11:42:37+07:00`

Workspace: `/Users/admin/khotienthinh`

Nhánh làm việc: `refactor/module-du-an-v1`

Implementation-plan baseline trước handoff: `640fdecc5c40027eb50f19c69b517d7ec373c6d9`

Draft PR hiện có: <https://github.com/hoangnvthkt/khotienthinh/pull/1>

Tài liệu này dùng để tiếp tục công việc trong một phiên chat mới. Nó mô tả
trạng thái và checkpoint, không tự cấp quyền mutation Cloud.

## 1. Chỉ dẫn mở đầu cho phiên chat mới

Đọc theo thứ tự:

1. `docs/session-handoff-2026-07-18-phase02-authorization.md`;
2. `docs/security/phase02-business-role-sod-live-apply-log.md`;
3. `docs/superpowers/specs/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant-design.md`;
4. `docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant.md`;
5. khi cần đối chiếu roadmap gốc:
   `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.

Sau khi đọc:

- kiểm tra `git status`, nhánh, HEAD và remote HEAD;
- chạy lại Cloud inventory chỉ bằng read-only query;
- báo ngắn gọn cho anh trạng thái thực tế và checkpoint kế tiếp;
- chờ anh duyệt implementation plan hoặc xác nhận bắt đầu Task 1;
- không mở maintenance, không sửa grant và không đổi rollout flag chỉ dựa trên
  tài liệu handoff này.

Phương thức làm việc anh ưu tiên: tiếng Việt, xưng `anh/em`, triển khai inline
theo từng checkpoint, cập nhật ngắn gọn, ưu tiên nghiệp vụ chính xác và tránh
mở rộng sang các chỉnh sửa rủi ro thấp/không cần thiết làm context phình to.

## 2. Trạng thái tổng quát

### Phase 1

- Phase 1 được anh xác nhận PASS sau khi kiểm thử kỹ.
- Phần thời gian quan sát còn lại đã được anh chấp nhận waive; không được ghi
  nhận sai thành evidence đã thu thập.

### Phase 2 đã hoàn tất

- Implementation backend/frontend của Business Role, effective permission
  source, Minimal SoD, governed commands, lifecycle integration, override
  evidence và governance UI đã hoàn tất.
- Bảy migration Phase 2 đã được apply lên Supabase Cloud trong một transaction
  được duyệt và repair đúng bảy version.
- Chín version liên quan hiện aligned local/remote:

```text
20260717084356
20260717084903
20260717085909
20260717090703
20260717092007
20260717092508
20260717093122
20260718012151
20260718031842
```

- Không dùng `db push`; không repair các version ngoài danh sách được duyệt.
- Auth profile sync guard forward-fix `20260718012151` đã apply và repair.
- Safe Auth metadata sync forward-fix `20260718031842` đã apply và repair.
- Edge Function `create-user` đã deploy version `20`, trạng thái `ACTIVE`, JWT
  verification vẫn bật.
- Canary zero-right `EMPLOYEE` đã được tạo qua UI, bị từ chối đúng `42501` khi
  gọi permission-admin RPC, sau đó được disable qua account lifecycle. Auth
  login mới bị từ chối với `user_banned`.
- Full verification gần nhất: 170 test files/993 tests PASS; TypeScript và build
  PASS; chỉ còn large-chunk advisory đã biết.
- Advisor baseline vẫn là 170 security và 97 performance warnings; không có
  warning mới do các object Phase 2.

Các spec/plan Auth forward-fix cũ là lịch sử phân tích, không phải việc còn mở.
Final implementation đã được anh duyệt thu hẹp: `create-user` hoàn thiện profile
qua caller Admin RLS và Auth trigger chỉ sync metadata hiển thị an toàn. Không có
`apply_created_user_profile_command` RPC và không được quay lại triển khai command
framework đó nếu không có yêu cầu mới.

### Phase 2 đang dừng ở đâu

- Task 13 Steps 1–4 của plan gốc đã hoàn tất: candidate/apply/smoke/repair.
- Auth negative-actor blocker đã đóng.
- Task 13 Step 5 còn mở duy nhất vì 467 active sensitive direct grants không có
  expiry.
- Task 13 Step 6 Vercel preview chưa bắt đầu.
- Task 13 Step 7 resolver canary và các cutoff sau đó chưa được phép chạy.
- Cả ba rollout flags vẫn `false`.

Checkbox Task 12/13 trong plan gốc không phải nguồn trạng thái duy nhất vì file
đó đang có thay đổi riêng chưa commit của anh. Apply log là nguồn evidence Cloud
ưu tiên hơn.

## 3. Cloud inventory mới nhất

Read-only inventory tại `2026-07-18T11:42+07:00`:

| Chỉ số | Giá trị |
|---|---:|
| Active sensitive direct grants | 467 |
| Principals bị ảnh hưởng | 23 |
| Sensitive permission codes | 26 |
| Sensitive rows có `expires_at is null` | 467 |
| Sensitive rows đã quá hạn | 0 |
| Active non-sensitive direct grants | 2177 |
| Non-sensitive rows đã quá hạn | 0 |
| Active Permission Admins | 1 |
| Permission Admins nằm trong source 467 | 1 |
| Durable rollout operators | 1 |

Rollout flags:

```text
business_role_resolver_enabled                    = false
legacy_governance_fallback_disabled               = false
system_admin_business_approval_bypass_disabled    = false
```

Scope distribution đã ghi trong apply log: 235 construction-site rows, 230
project rows và hai global rows. Không blind bulk-expire hoặc blind revoke dựa
trên aggregate này.

## 4. Quyết định remediation hiện hành

Có hai tài liệu implementation khác nhau, nhưng chỉ một phương án được chọn.

### Phương án cũ — giữ/thu hồi từng principal

- File:
  `docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-remediation.md`.
- Commit: `ec800fe`.
- Giữ làm phương án tham khảo/fallback.
- Không chạy song song với global two-phase.

### Phương án đã chọn — global revoke-all/regrant

- Design đã được anh duyệt:
  `docs/superpowers/specs/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant-design.md`.
- Design commit: `fa1999a`.
- Implementation plan TDD:
  `docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant.md`.
- Plan commit: `640fdec`.
- Implementation plan đã được viết và push, nhưng chưa được coi là quyền bắt
  đầu mutation. Phiên mới cần lấy xác nhận của anh trước khi thực thi.

Luồng đã duyệt:

```text
Approved private manifest: REGRANT hoặc DROP đủ 467 rows
        |
        v
Maintenance freeze
        |
        v
Revoke toàn bộ source theo từng principal qua governed RPC
        |
        v
Global zero-source gate PASS
        |
        v
Chỉ regrant approved subset, đúng permission/scope, expiry chung 90 ngày
        |
        v
Exact final gate + evidence
        |
        v
Dừng trước resolver; xin approval riêng
```

Không được xen một regrant vào giữa revoke phase. Không được thay phương án khi
đang maintenance mà không đóng checkpoint và lập manifest mới.

## 5. Blocker Permission Admin phải xử lý trước maintenance

Cloud hiện chỉ có một active Permission Admin và principal này thuộc tập 467.

Backend behavior đã xác minh từ code:

- sensitive self-removal có thể được phép;
- sensitive self-regrant bị chặn với `Sensitive self-grant is not allowed`;
- legacy governance fallback vẫn đang bật tương thích vì flag
  `legacy_governance_fallback_disabled = false`.

Hệ quả:

- Nếu business owner quyết định `DROP` toàn bộ sensitive rows của Permission
  Admin duy nhất, plan có thể tiếp tục; principal này được revoke cuối cùng và
  phải kiểm tra lại `can_manage_permissions()` bằng session mới.
- Nếu có bất kỳ row `REGRANT` cho Permission Admin duy nhất, phải có một
  Permission Admin độc lập trước maintenance.
- Không được tự tạo operator thứ hai trong plan này. Đây là thay đổi phạm vi;
  cần một bootstrap design/approval riêng rồi chụp lại snapshot/manifest.
- Không lách blocker bằng direct SQL, tự đổi Business Role, tạm bật rollout
  flag hoặc dùng service-role thay actor xác thực.

## 6. Checkpoint bắt đầu của phiên mới

Điểm bắt đầu đúng là review/duyệt implementation plan, sau đó Task 1 của plan
global two-phase.

Task 1 chỉ gồm:

1. reconfirm exact baseline;
2. tạo private `mktemp -d` với mode `0700`;
3. export source JSON bằng read-only linked query;
4. tạo manifest mode `0600`;
5. business owner phân loại đủ 467 rows thành `REGRANT` hoặc `DROP`;
6. validate counts/duplicates/fingerprints và Permission Admin blocker;
7. ghi aggregate evidence;
8. dừng xin approval mở maintenance.

Không tính shared 90-day expiry tại thời điểm capture manifest. Cutoff phải được
tính đúng một lần từ lúc maintenance thực sự mở.

Task 2 tạo hai read-only Cloud gates và chứng minh RED trên inventory hiện tại.
Cloud mutation chỉ bắt đầu ở Task 3 sau một approval riêng.

## 7. Quy tắc triển khai bắt buộc

### Supabase Cloud

- Chỉ dùng Supabase Cloud đã linked; thông tin kết nối nằm trong `.env`.
- Không dùng Docker, Supabase local, `--local`, `supabase start`, `db reset`
  hoặc `db push`.
- CLI hiện tại: `2.95.6`; dùng `npx supabase`.
- Luôn đọc `--help` trước khi đoán flag.
- Với `db query --agent=no --output json`, output là JSON array, không phải
  envelope `{ rows: ... }`.
- Không in `.env`, database URL, access token, anon/service-role key, password,
  Auth ID hoặc session token vào chat/log.

### Authorization mutations

- Không `insert/update/delete` trực tiếp `public.user_permission_grants`.
- Mỗi principal dùng complete direct-grant draft.
- Preview qua `public.preview_direct_grant_replacement`.
- Save qua `public.replace_user_permission_grants_v2` từ authenticated UI.
- Giữ nguyên mọi non-sensitive grant, scope và expiry.
- Hard SoD deny luôn dừng principal.
- Warning chỉ accept khi có independent control owner, reason, compensating
  controls và future acceptance expiry.
- Mỗi save cần reason chuẩn đúng phase.
- Batches tối đa ba principals, xử lý tuần tự và dừng xin duyệt giữa batches.
- Không mở hai phiên permission editing song song cho cùng principal.

### Evidence và private manifest

- Manifest/raw export chỉ ở private temp directory, không vào Git/chat/apply
  log.
- Không ghi name, email, user ID, Auth ID hoặc raw permission keys vào evidence.
- Apply log chỉ ghi timestamp, count, audit delta và fingerprints.
- Non-sensitive fingerprint phải bất biến qua cả hai phase.
- Chỉ xóa private artifacts sau final gate PASS và xác nhận của anh; dùng exact
  validated path, không recursive delete.

### Git và migrations

- Không sửa migration đã apply; defect dùng forward-fix mới và focused TDD.
- Không repair version ngoài danh sách đã duyệt.
- File sau thuộc thay đổi riêng của anh và đang dirty:
  `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Không stage, overwrite, format hoặc revert file dirty đó.
- Trước commit luôn xem `git diff --cached --name-only`.
- Push vào nhánh/PR hiện có; không tạo PR thứ hai nếu anh không yêu cầu.

## 8. Những vấn đề nghiệp vụ đã trao đổi nhưng chưa thuộc checkpoint này

### Daily Log `current_approver`

- Lỗi `Chưa cấu hình người chịu trách nhiệm current_approver` không được giải
  quyết chỉ bằng checkbox `project.daily_log.approve`.
- Đây là responsibility assignment/slot riêng trong
  `20260716040851_daily_log_responsibility_assignment_pilot.sql`.
- Công trường hiện có một slot trỏ tới một user khác; UI gán/chuyển
  `current_approver` được để lại Phase 4 theo quyết định của anh.
- Không kéo phần này vào remediation 467 grants.

### Module/submodule visibility vẫn theo legacy

- Việc hiển thị/quản trị module hiện vẫn chịu ảnh hưởng của
  `allowed_modules`, `admin_modules`, `allowed_sub_modules` và
  `admin_sub_modules` vì compatibility flags chưa cut over.
- Ma trận mới đã có backend/UI và governed direct grants, nhưng chưa phải bằng
  chứng rằng toàn bộ legacy module visibility đã bị loại bỏ.
- Resolver/cutoff phải đi theo Task 13 Steps 7–12 và các phase ownership đã định;
  không sửa lan man trong Task 13 Step 5.

### Hai nơi “phân quyền dự án”

- Ma trận mới tại Cài đặt người dùng và phân quyền trong tổ chức của một dự án
  không được coi là cùng một bản ghi.
- Chúng có thể dùng chung permission code/resolver semantics, nhưng khác source
  assignment và scope: direct/user governance so với project organization/PBAC.
- Không đồng bộ hoặc ghi đè chéo hai nguồn nếu chưa có design riêng.

## 9. Sau khi remediation 467 grants hoàn tất

Thứ tự tiếp theo:

1. final remediation gate PASS, evidence commit/push;
2. dừng và xin approval riêng;
3. hoàn tất Task 13 Step 6 Vercel preview trên exact verified commit;
4. Task 13 Step 7 chỉ enable additive Business Role resolver canary, giữ hai
   cutoff còn lại `false`;
5. verify source explanation, scope/expiry và adjacent-action denial;
6. rollback-only impact inventory trước governance/business approval cutoff;
7. checkpoint riêng trước khi disable legacy governance fallback và System
   Admin business-approval bypass;
8. production promotion trên exact preview commit;
9. 24-hour observation hoặc waiver minh thị của anh;
10. final verification và rollout evidence.

Ownership các phase sau:

- Phase 4: Daily Log responsibilities/current approver.
- Phase 5: Payment, Project Core, Quality và maker/checker/executor hardening.
- Phase 6: Workflow, Request và các ERP modules còn lại.
- Phase 7: loại bỏ generic legacy helpers/fallback sau khi consumers đã cut over.

## 10. Các file/code boundary quan trọng

```text
docs/security/phase02-business-role-sod-live-apply-log.md
docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
docs/superpowers/specs/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant-design.md
docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant.md
docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-remediation.md

components/permissions/PrincipalDirectGrantPanel.tsx
lib/permissions/permissionAdminService.ts
lib/permissions/authorizationGovernanceService.ts

supabase/migrations/20260717084356_authorization_business_role_foundation.sql
supabase/migrations/20260717084903_authorization_effective_permission_resolver.sql
supabase/migrations/20260717085909_authorization_minimal_sod_registry.sql
supabase/migrations/20260717090703_authorization_governance_commands.sql
supabase/migrations/20260717092007_authorization_account_lifecycle_integration.sql
supabase/migrations/20260717092508_authorization_override_evidence.sql
supabase/migrations/20260717093122_authorization_backend_checkpoint_hardening.sql
supabase/migrations/20260718012151_auth_profile_sync_guard_forward_fix.sql
supabase/migrations/20260718031842_auth_profile_safe_metadata_sync.sql

supabase/functions/create-user/index.ts
supabase/migrations/20260716040851_daily_log_responsibility_assignment_pilot.sql
```

## 11. Commit landmarks

```text
903b297  docs(authz): align business role rollout roadmap
f350b74  fix(auth): restore trusted profile sync guard
845dec7  fix(auth): write created profile through admin RLS
ad63d38  fix(auth): restrict profile sync to safe metadata
802e6aa  docs(auth): record minimal profile fix rollback gate
72f9f34  docs(auth): record cloud canary completion
ec800fe  docs(authz): plan sensitive grant remediation
fa1999a  docs(authz): design revoke-all sensitive grant reset
640fdec  docs(authz): plan global sensitive grant reset
```

## 12. Read-only re-entry commands

Các lệnh đầu phiên mới:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/refactor/module-du-an-v1
npx supabase --version
npx supabase migration list --linked | rg \
  '20260717084356|20260717084903|20260717085909|20260717090703|20260717092007|20260717092508|20260717093122|20260718012151|20260718031842'
```

Sau đó chạy lại aggregate inventory trong Task 1 của global plan. Nếu không còn
đúng `467/23/26`, ba flags `false`, 2177 non-sensitive rows với zero past-expiry
và Permission Admin posture đã ghi ở trên, dừng để phân tích drift; không dùng
snapshot cũ để mutation.

## 13. Điều kiện để tuyên bố handoff tiếp tục đúng luồng

Phiên mới chỉ được coi là đã bắt đúng luồng khi:

- đọc đủ handoff, apply log, approved design và implementation plan;
- xác nhận đúng nhánh/HEAD/dirty-file boundary;
- reconfirm Cloud bằng read-only evidence;
- không coi design approval là mutation approval;
- không chạy đồng thời hai remediation plans;
- trình bày rõ Permission Admin self-regrant blocker;
- bắt đầu từ Task 1 manifest và dừng đúng approval checkpoint.
