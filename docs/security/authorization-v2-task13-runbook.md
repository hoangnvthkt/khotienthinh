# Authorization V2 — Task 13 drop-legacy runbook

## Phạm vi và môi trường

- Git branch: `feature/authorization-v2-task13-drop-legacy-schema`.
- Worktree: `.worktrees/authorization-v2-task13-drop-legacy-schema`.
- Branch base: `origin/main` tại `f3f68c1` khi khởi tạo ngày `2026-09-14`.
- Database duy nhất được phép thao tác: Supabase Cloud **main**, project ref `ftciqmqhmfvjtwoycswe`.
- Không dùng Supabase Branch, Supabase local hoặc Docker.
- Migration drop không được apply khi observation gate chưa được ghi nhận đạt.

## Trạng thái chuẩn bị ngày 2026-09-14

Readiness query `supabase/tests/authorization_v2_task13_readiness.sql` trên Cloud main cho thấy:

- Bốn cột legacy vẫn còn trên `public.users`.
- Các flag đã fail-closed: fallback thường và governance đều tắt, projection tắt, legacy writes bị khóa.
- Effective resolver trả `0` nguồn `LEGACY`; `0` disposition cần review thủ công.
- Snapshot Phase 5 có `57` dòng, checksum sai `0`; toàn bộ `56` user active hiện tại được cover, còn `1` snapshot thuộc user không còn active.
- Smoke Phase 5 cũ vẫn fail vì yêu cầu số snapshot phải bằng đúng số user active (`57 != 56`). Task 13 phải chụp backup mới và định nghĩa coverage theo user ID, không suy từ equality count.
- Có `22` routine và `1` trigger còn tham chiếu bốn cột legacy; không có view hoặc policy tham chiếu trực tiếp.
- Runtime frontend vẫn còn các consumer cần dọn trong Task 13: `App.tsx`, `types.ts`, `context/authState.ts`, `lib/supabaseProjections.ts` và UI legacy read-only.
- Tám bảng authorization trọng yếu đang bật RLS.

Cloud migration ledger chưa đạt điều kiện apply: remote có sáu version `20260912*` nhưng checkout `origin/main` chưa chứa các file tương ứng. Phải đưa đúng migration đã apply vào `main` và xác nhận local/remote ledger khớp trước khi tạo/apply migration Task 13.

## Observation gate bắt buộc

Ghi rõ một mốc `T0` duy nhất trong rollout log sau khi đồng thời đạt:

1. Frontend chứa toàn bộ Task 12.3, 12.4, 12.4.1 và correction menu Request template đã được deploy.
2. Persona production đã xác nhận: System Admin; HR/HR Manage; employee linked/unlinked; employee own-attendance/payroll; Project Room member; user quản lý mẫu Request.
3. Không có rollback incident và không có deny anomaly tăng bất thường.
4. Reconciliation Cloud vẫn đạt: `0` effective `LEGACY`, `0` manual review, mọi active user có snapshot checksum hợp lệ và canonical source hợp lệ.

Chỉ thực hiện drop khi thời điểm apply `>= T0 + 7 ngày`. Nếu `T0` sớm nhất là ngày `2026-09-14`, ngày đủ điều kiện sớm nhất là `2026-09-21`; thời điểm thực tế phải lấy theo timestamp deploy/persona được ghi nhận, không lấy ngày commit.

## Thứ tự thực thi sau khi gate đạt

### 1. Đồng bộ và đóng băng đầu vào

- Fetch `origin/main`, rebase/fast-forward branch Task 13 lên đúng release SHA đã quan sát.
- Xác nhận worktree sạch và migration ledger local/remote khớp tuyệt đối.
- Ghi release SHA, Cloud project ref, thời điểm `T0`, người xác nhận persona và bằng chứng deny-anomaly vào rollout log.

### 2. Backup và restore rehearsal

- Tạo snapshot Task 13 bất biến trước khi drop, gồm user ID, đủ bốn giá trị legacy, `captured_at`, release SHA, cutover ID và SHA-256 checksum.
- Xác nhận coverage bằng phép đối chiếu user ID: không thiếu user thuộc phạm vi backup; snapshot thừa do account đã inactive phải được phân loại rõ, không được coi là checksum lỗi.
- Chạy restore query trong rollback transaction và đối chiếu lại checksum/payload từng user.
- Xuất bằng chứng chỉ gồm count/checksum status; không ghi PII vào Git hoặc log.

### 3. Dependency-first migration

- Redefine các routine còn dùng cho nghiệp vụ sang canonical-only trước khi drop cột.
- Drop các routine/RPC/trigger chỉ phục vụ legacy; không dùng `DROP ... CASCADE`.
- Redefine account lifecycle, auth profile sync, principal listing, request management và effective resolver để không còn đọc/ghi/return legacy fields.
- Sau khi dependency query trả rỗng mới drop bốn cột `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules`.

### 4. Runtime cleanup

- Xóa bốn field khỏi `User` và `mapUserProfileRow`.
- Xóa bốn cột khỏi projection `users`.
- Thay redirect legacy trong `SubModuleGuard` bằng redirect suy từ canonical Project Room/capability.
- Xóa `LegacyPermissionReadOnly` khỏi authorization editor sau khi không còn rollback UI requirement.
- Chuyển các regression test legacy sang final-absence contract; giữ fixture lịch sử chỉ khi test migration archive cần nó.

### 5. Final smoke và apply

- Final smoke phải chứng minh: bốn cột và legacy-only object không còn; effective `LEGACY = 0`; fallback/projection không thể bật lại; unknown route/action deny; authorization tables vẫn RLS; RPC/private-function ACL đúng contract.
- Phạm vi “no PUBLIC private execute” phải được chốt theo contract thực tế trước migration. Readiness hiện thấy nhiều routine `app_private` có default EXECUTE nhưng schema private không expose; không được revoke hàng loạt nếu routine đang được RLS/trigger gọi.
- Chạy full tests, TypeScript, production build, migration baseline, query audit, DB lint và security advisor.
- Chạy migration + final smoke trong một Cloud rollback transaction trước.
- Dry-run phải chỉ liệt kê đúng migration Task 13; sau đó mới apply Cloud main và chạy postflight.

## Dừng/rollback

- Dừng ngay nếu project ref sai, ledger lệch, dependency còn, checksum/coverage sai, persona chưa đủ hoặc observation chưa đủ 7 ngày.
- Sau khi drop, rollback là reviewed **forward migration** tái tạo schema và restore từ snapshot; không sửa migration đã apply.
- Không xóa snapshot/evidence trong cùng Task 13. Việc retention hoặc purge là quyết định vận hành riêng.
