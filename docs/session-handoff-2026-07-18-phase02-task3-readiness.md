# Session Handoff — VIOO Phase 02 Task 3 Readiness Blocker

Ngày kết xuất: `2026-07-18T20:23:32+07:00`

Workspace: `/Users/admin/khotienthinh`

Nhánh làm việc: `refactor/module-du-an-v1`

HEAD: `3f5f08c8123af89ab9ed8740fc2c9d67ab822cce`

Local `main`: `450fa07f6ad515baef948a2133c678faafa0c191`

Remote refs đang có trong workspace:

- `origin/refactor/module-du-an-v1`:
  `b7948dee774d6cdd9ecdc797636c57b78a5b0102`;
- `origin/main`: `e30332a0a82d1a2df8609d930c250e125ee69b7b`.

Tài liệu này dùng để tiếp tục công việc trong một phiên chat mới. Nó ghi nhận
trạng thái, blocker và checkpoint kế tiếp; **không phải quyền mutation Cloud**.

## 1. Chỉ dẫn mở đầu cho phiên chat mới

Đọc đầy đủ theo thứ tự:

1. `docs/session-handoff-2026-07-18-phase02-task3-readiness.md`;
2. `docs/security/phase02-business-role-sod-live-apply-log.md`;
3. `docs/superpowers/plans/2026-07-18-vioo-phase02-closure-and-phase03-entry.md`;
4. `docs/superpowers/plans/2026-07-18-vioo-sensitive-direct-grant-revoke-all-regrant.md`;
5. `supabase/migrations/20260718092455_unified_permission_change_command.sql`;
6. `supabase/migrations/20260718123119_authorization_audit_readiness.sql`;
7. khi cần đối chiếu roadmap gốc:
   `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.

Sau khi đọc:

- xác nhận bằng read-only evidence: branch, HEAD, Git status, migration history,
  grant totals, readiness totals, Audit-capable actors, Role assignments và bốn
  rollout flags;
- báo ngắn gọn trạng thái thực tế và checkpoint tiếp theo;
- không thử Save lại 12 principals trước khi readiness blocker được đóng;
- không mutation Cloud nếu chưa có approval riêng cho đúng checkpoint;
- không in ID, email, Auth ID, token, URL database hoặc nội dung `.env`.

Phương thức làm việc anh ưu tiên: tiếng Việt, xưng `anh/em`, triển khai inline
theo checkpoint, nói rõ phần nào xong và anh vào đâu để tự kiểm tra. Không mở
rộng kiểm thử lan man, nhưng vẫn phải giữ các backend gate bắt buộc trước khi
đánh dấu một permission là hoạt động.

## 2. Định hướng nghiệp vụ đã được anh xác nhận

Phương án A vẫn là hướng đã duyệt:

- `View` là chìa khóa cổng của module/submodule. Không có View thì không thấy
  hoặc không được đi vào vùng nghiệp vụ tương ứng.
- Sau khi có View, các thao tác là các chìa khóa riêng: Create, Edit, Submit,
  Verify, Approve và các action đặc thù khác.
- Có Edit không tự sinh Approve; có Approve không tự sinh Submit; mỗi action
  phải được backend kiểm tra độc lập.
- Một người có thể có nhiều quyền ở module này nhưng chỉ View hoặc một vài action
  ở module khác. Admin quyết định theo người, module và scope.
- Anh sẽ tự kiểm tra thủ công bằng cách bỏ quyền legacy, cấp quyền nhỏ tương ứng
  và báo lại kết quả. Hệ thống cần cho thấy permission code được chia nhỏ rõ ràng
  và backend thực thi đúng.

Ý kiến của anh được dùng như góc nhìn nghiệp vụ, không tự động thay roadmap. Nếu
một góp ý xung đột với kiến trúc hoặc gate đã duyệt, phiên mới phải báo lại anh
trước khi đổi hướng.

## 3. Plan hiện tại nằm ở đâu

Luồng plan là:

```text
Roadmap gốc
2026-07-17-vioo-business-role-minimal-sod.md
        |
        v
Phase 02 closure plan
2026-07-18-vioo-phase02-closure-and-phase03-entry.md
        |
        v
Task 1  Audit View+Audit readiness              DONE
Task 2  Independent least-privilege owner       DONE
Task 3  Resume 12 warned principals             BLOCKED BY READINESS
Task 4  Exact sensitive-grant final gate        PENDING
Task 5  Vercel preview                           PENDING
Task 6  Granular Daily Log verification         PENDING
Task 7  Resolver and two separate cutoffs       PENDING
Task 8  Production/observation/Phase 02 close   PENDING
```

Đây vẫn là công việc thuộc **Phase 02 — Business Role and Minimal SoD**. Chưa
được bắt đầu Phase 03 module lifecycle/source-mode implementation.

## 4. Những phần đã hoàn tất

### Nền Phase 02

- Backend/frontend Business Role, effective permission sources, Minimal SoD,
  governed commands, override evidence và unified permission matrix đã được
  triển khai.
- Migration unified permission command `20260718092455` đã apply và repair đúng
  version trên Supabase Cloud. Migration này bất biến; defect phải dùng
  forward-fix mới.
- Ba compatibility/cutoff flags và `legacy_projection_enabled` vẫn `false`.
- Module/submodule visibility legacy vẫn còn trong compatibility path; chưa được
  hiểu là đã cut over hoàn toàn sang resolver mới.

### Sensitive direct-grant maintenance

- Source được duyệt: 467 sensitive rows, 23 principals, 26 permission codes.
- Quyết định manifest: 421 `REGRANT`, 46 `DROP`.
- Source fingerprint:
  `a3d0cf9514e487111c5ae27873c8f6cd`.
- Approved regrant fingerprint:
  `00a8f7f0f3a39721474a582592cf0b2e`.
- Shared expiry:
  `2026-10-16T12:10:00+07:00`.
- Revoke phase đã hoàn tất: 467 rows từng được thu hồi qua governed flow; 23
  revoke audit events được giữ lại.
- Regrant đã hoàn tất cho 10 principals: 103/421 sensitive rows active, đúng
  shared expiry và reason chuẩn.
- 46 rows được quyết định `DROP` vẫn inactive.
- 318 rows thuộc 12 principals còn chờ.

Private raw manifest cũ hiện không còn trong workspace hoặc temp directory đã
kiểm tra. Không tái tạo danh tính vào Git/chat. Nếu cần dựng lại runtime set,
chỉ dùng read-only Cloud criteria/reasons đã ghi trong apply log và bắt buộc khớp
đúng hai fingerprints cùng phép tính 467 = 421 + 46 trước mọi mutation.

### Closure Task 1

- Chỉ `system.authorization.view` và `system.authorization.audit` được promote
  từ `declared` lên `verified` sau focused test và rollback-only Cloud smoke.
- Migration `20260718123119_authorization_audit_readiness.sql` đã apply và repair
  đúng version.
- Post-apply smoke chứng minh Audit-only có thể đọc authorization audit/effective
  sources nhưng không mutate audit, Role hay Direct Grant.
- Commit chứa Task 1: `450fa07` —
  `feat(authz): verify audit permission readiness`.

### Closure Task 2

- Đã chọn một active non-Admin least-privilege control owner bằng read-only
  filtering; danh tính không được ghi vào tài liệu.
- Đã cấp temporary Direct
  `system.authorization.view + system.authorization.audit` qua governed command.
- Đã assign `AUDITOR` tại `global/*`, hết hạn đúng
  `2026-10-16T12:10:00+07:00`.
- Fresh-session evidence chứng minh chỉ có View+Audit; không có manage roles,
  manage grants, manage scopes, override hoặc business approval.
- Resolver vẫn `false`, nên Role đang staged; nguồn effective hiện tại của
  control owner vẫn là temporary Direct bridge.
- Commit chứa Task 2: `3f5f08c` —
  `docs(authz): record independent control owner`.

## 5. Read-only Cloud evidence mới nhất

Đối chiếu tại `2026-07-18T20:22:43+07:00`:

| Chỉ số | Giá trị |
| --- | ---: |
| Active Direct Grants | 2,282 |
| Active sensitive rows | 103 |
| Active sensitive principals | 10 |
| Active sensitive rows không có expiry | 0 |
| Active non-sensitive rows | 2,179 |
| Non-sensitive fingerprint | `632d0ce644dcec52126eabf7b44909ca` |
| Pending approved principals | 12 |
| Pending approved rows | 318 |
| Pending rows readiness `declared` | 291 |
| Pending rows readiness `verified/enforced` | 27 |
| Blocking permission codes ở readiness `declared` | 21 |
| Principals bị readiness block | 12/12 |
| Audit-capable active actors | 2 |
| Active Business Role assignments | 3 |
| Staged expiring `AUDITOR` assignment | 1 |
| Active Direct warning acceptances | 0 |
| Rollout flags đang `false` | 4/4 |
| Required migrations `20260718092455`, `20260718123119` applied | 2/2 |

Lưu ý kỹ thuật: `principal_role_assignments.status` dùng giá trị uppercase
`ACTIVE`. Một truy vấn chẩn đoán ban đầu dùng lowercase đã trả nhầm 0; truy vấn
đúng uppercase xác nhận 3 active assignments và một staged `AUDITOR`.

Không có Cloud mutation trong lần tạo handoff này.

## 6. Task 3 đang bị chặn vì sao

Rollback-only dry-run đã dừng ngay tại
`public.preview_user_permission_change` với lỗi:

```text
42501: Direct permission action is not enforced or verified
```

Backend gate gây dừng là:

```text
app_private.assert_unified_direct_grant_readiness(uuid, jsonb)
```

Gate từ migration `20260718092455` không cho proposed active Direct Grant nếu
permission action chưa có readiness `enforced` hoặc `verified`, trừ khi exact row
đó đã active từ trước.

Kết quả phân tích:

- 291/318 pending rows dùng 21 permission codes còn `declared`;
- chỉ 27/318 pending rows đang `verified`;
- **không có principal nào trong 12 principals có complete draft hoàn toàn
  grantable**;
- vì vậy không thể hoàn thành dù chỉ một principal của batch đầu;
- không được tách riêng 27 rows để Save vì sẽ làm sai approved exact manifest và
  tạo partial principal state.

Dry-run thất bại trước mutation. Read-only hậu kiểm vẫn là 103 active sensitive
rows, 10 regrant audit events và 0 warning acceptances. Không bypass bằng direct
SQL, service-role, chỉnh bảng grant trực tiếp hoặc bật rollout flag.

## 7. Checkpoint tiếp theo đúng

Checkpoint đúng **không phải cố chạy Task 3 lần nữa**. Cần một readiness
forward checkpoint nhỏ trước Task 3:

1. read-only enumerate đúng 21 blocking permission codes, không kèm principal;
2. với từng code, xác minh backend action/handler thực sự kiểm tra đúng permission,
   scope, ownership/state precondition và adjacent-action denial;
3. code nào chưa có enforcement evidence thì giữ `declared` và báo blocker;
4. viết focused static contract/test và rollback-only backend smoke;
5. tạo **forward migration mới** bằng Supabase CLI; không sửa migration đã apply;
6. migration chỉ promote exact codes có đủ evidence lên `verified` hoặc
   `enforced`, không blanket-promote permission catalog;
7. chạy local focused verification;
8. dừng xin approval riêng trước rollback-only migration + smoke trên Cloud;
9. nếu smoke pass, dừng xin approval riêng trước apply/repair exact migration;
10. post-apply read-only verify rồi mới quay lại Task 3 Step 1.

Checkpoint này không thay đổi hướng nghiệp vụ Phương án A. Nó là prerequisite
do backend safety gate của chính unified permission model yêu cầu. Không được
hạ/bỏ gate để làm batch pass.

## 8. Khi readiness blocker được đóng, tiếp tục Task 3 như thế nào

Preflight phải trở về đúng baseline:

- 467 source = 421 REGRANT + 46 DROP;
- 103 sensitive rows active trên 10 principals;
- 318 approved rows pending trên 12 principals;
- 0 sensitive null-expiry row;
- 0 active sensitive row ngoài approved manifest;
- non-sensitive count 2,179 và fingerprint Task 2 không đổi;
- 2 Audit-capable actors;
- 3 active Business Role assignments;
- 4 rollout flags `false`.

Mỗi warned principal phải dùng fresh backend warning và một acceptance có:

- exact `ruleCode`, `scopeType`, `scopeId`;
- independent control owner đã appoint ở Task 2;
- reason ít nhất 10 ký tự;
- compensating control cụ thể ít nhất 10 ký tự;
- expiry không muộn hơn `2026-10-16T12:10:00+07:00`.

Mỗi principal dùng complete current Direct Grant draft, append đúng approved
manifest rows, shared sensitive expiry và reason chuẩn:

```text
Task 13 Step 5: tái cấp quyền nhạy cảm đã được phê duyệt
```

Preview, Save một lần, identical retry phải no-op, rồi read-only verify. Batch
tối đa ba principals, chạy tuần tự, ghi aggregate evidence và dừng xin anh duyệt
giữa các batch.

Expected Task 3 final state:

- 421 active sensitive rows trên 22 regranted principals;
- 46 DROP rows inactive;
- 22 regrant audit events và 23 revoke audit events;
- 12 active warning acceptances;
- non-sensitive count/fingerprint Task 2 bất biến;
- bốn rollout flags vẫn `false`.

## 9. Các task sau Task 3

### Task 4 — Final sensitive-grant gate

- Chạy exact existing gate bằng runtime values đã duyệt.
- Xác nhận grant/audit arithmetic, advisor baselines và repository verification.
- Đóng maintenance và commit aggregate evidence.

### Task 5 — Vercel preview

- Freeze exact candidate SHA.
- Dừng xin approval trước push/deploy.
- Verify governance UI trên exact preview; checkbox không mutation trước Save.

### Task 6 — Granular Daily Log separation

- Rollback-only backend smoke trước.
- Sau approval riêng mới dùng disposable account để test View/Create/Edit/
  Submit/Verify/Approve theo từng dòng.
- Anh vào checklist UI để kiểm tra đúng việc, đúng người; cuối test phải restore
  exact permission draft.

### Task 7 — Resolver và hai cutoff độc lập

Thứ tự bắt buộc:

```text
(resolver, governance cutoff, approval cutoff)
(false, false, false)
        -> (true, false, false)
        -> (true, true, false)
        -> (true, true, true)
```

- Mỗi mũi tên là một approval/mutation checkpoint riêng.
- Sau resolver canary pass, remove temporary Direct View+Audit bridge; control
  owner phải còn effective Audit qua `AUDITOR` Role.
- Không gộp governance cutoff với System Admin business-approval cutoff.

### Task 8 — Production, observation và đóng Phase 02

- Promote đúng preview SHA sau approval.
- Verify production frontend/backend.
- Quan sát 24 giờ hoặc ghi explicit waiver của anh; không tự suy diễn elapsed
  evidence.
- Chỉ khi Phase 02 exit gate pass mới viết handoff Phase 03; chưa implement Phase
  03 trong closure plan này.

## 10. Các lưu ý không được bỏ qua

### Supabase Cloud

- Dùng Supabase Cloud linked; secrets nằm trong `.env` nhưng không được in ra.
- Không dùng Docker, Supabase local, `--local`, `supabase start`, `db reset` hoặc
  `db push`.
- CLI hiện ghi nhận `2.95.6`; đọc `npx supabase <command> --help` trước flag lạ.
- Migrations đã apply là immutable; sửa lỗi bằng forward migration.
- Không repair version ngoài version được anh duyệt chính xác.

### Authorization mutation

- Không insert/update/delete trực tiếp `public.user_permission_grants`, Business
  Role assignments, warning acceptances hoặc rollout settings.
- Chỉ dùng authenticated governed Preview/Apply RPC.
- Backend hard deny, readiness, SoD, expiry, stale-draft và audit là authoritative.
- Không broaden permission/flag để làm test pass.

### Privacy/evidence

- Không ghi name, email, user ID, Auth ID, token hoặc raw permission manifest vào
  docs/chat/log.
- Evidence chỉ gồm timestamp, counts, fingerprints, migration versions, commit
  SHAs và flag states.
- Runtime reconstruction có identity phải nằm trong private temp directory mode
  `0700`; files mode `0600`; không đưa vào Git.

### Git

- Worktree hiện chỉ có một thay đổi riêng chưa commit của anh:
  `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Không stage, sửa, format, overwrite hoặc revert file đó.
- Nhánh local đang ahead `origin/refactor/module-du-an-v1` 21 commits tại thời
  điểm handoff.
- Trước commit luôn kiểm tra `git diff --cached --name-only`; chỉ stage file thuộc
  checkpoint hiện tại.
- Không force-push và không tạo PR thứ hai nếu anh không yêu cầu.

## 11. Các vấn đề liên quan nhưng không kéo vào readiness checkpoint

- Daily Log `current_approver` là responsibility assignment/state precondition,
  không phải chỉ là checkbox `project.daily_log.approve`. UI gán/chuyển slot này
  vẫn để phase sau theo quyết định hiện tại.
- Unified permission matrix và project organization/PBAC là hai source assignment
  khác nhau dù có thể dùng chung permission semantics. Không ghi đè chéo nếu chưa
  có design riêng.
- Legacy `allowed_modules`, `admin_modules`, `allowed_sub_modules` và
  `admin_sub_modules` vẫn ảnh hưởng visibility trong compatibility posture. Chỉ
  resolver/cutoff plan mới thay đổi điều này.
- Security/performance advisor baselines lịch sử là `170/97`; phải kiểm tra lại ở
  Task 4, không coi số cũ là evidence mới.
- Vercel preview/production và 24-hour observation chưa bắt đầu cho candidate
  hiện tại.

## 12. Prompt đề nghị dùng khi mở phiên chat mới

```text
Đọc đầy đủ file
docs/session-handoff-2026-07-18-phase02-task3-readiness.md,
xác nhận lại Git và Supabase Cloud bằng read-only evidence, không in dữ liệu
nhận diện và chưa mutation Cloud. Tiếp tục đúng checkpoint readiness prerequisite
của Task 3: xác minh 21 blocking permission codes và lên focused forward plan.
Không cố Save 12 principals, không sửa migration đã apply và không stage file
roadmap đang dirty của anh.
```
