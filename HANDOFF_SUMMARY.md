# HANDOFF_SUMMARY

## 1. Mục tiêu ban đầu

Đóng Closure Task 3 của **Phase 02 - Business Role and Minimal SoD** theo
manifest sensitive Direct Grant đã duyệt, không tạo partial Save cho 12
principals còn bị readiness chặn. Nhánh hiện tại là Task 3 Readiness Tranche B:
retire hai quyền Material Request và khôi phục provenance bị lệnh B1 ghi đè.

## 2. Việc đã hoàn thành

- B0 xác nhận hai quyền Material Request cần retire và phát hiện 8 active key.
- B1 đã dùng UI governed để thu hồi đủ 8 key; Cloud hiện có 0 active retired
  key, 95 active sensitive grants và 2274 active Direct Grants.
- UI removal-only đã được đưa vào root qua commit `dd6544f`.
- Read-only evidence phát hiện B1 đã ghi đè provenance của 363 active grants;
  69 là sensitive. Cả 363 đều phục hồi được từ audit snapshot ngay trước B1.
- Spec Remediation C đã được viết và commit ở worktree Tranche B:
  `9180141 docs(authz): define provenance remediation`.

## 3. File đã thay đổi

Root branch `refactor/module-du-an-v1`:

- `components/permissions/PrincipalDirectGrantPanel.tsx` - surface chỉ thu hồi
  hai quyền retired.
- `lib/__tests__/authorizationAdminUiContract.test.ts` - UI contract cho
  removal-only surface.
- `HANDOFF_SUMMARY.md` - handoff này.

Worktree `/Users/admin/khotienthinh/.worktrees/material-request-readiness-tranche-b`
(chưa nhập lại root):

- `docs/superpowers/specs/2026-07-19-material-request-provenance-remediation-design.md`.
- Các commit B0/B1 liên quan gồm gate/test/spec/plan và UI commit `2fccab0`;
  UI tương đương đã có trên root bằng `dd6544f`.

## 4. Quyết định kỹ thuật quan trọng

- Architecture source: `docs/superpowers/specs/2026-07-16-vioo-authorization-governance-migration-design.md`.
- Master roadmap: `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Remediation C dùng **forward migration**, không sửa migration đã apply.
- Future full-draft replace phải giữ `granted_by`, `granted_at`, `grant_reason`
  cho grant vẫn active; grant mới/reactivate mới nhận metadata của command mới.
- Repair chỉ qua RPC governed, server tự suy ra provenance từ audit, browser
  không gửi provenance/grant tuple; repair chỉ cập nhật ba field provenance.
- Cloud sequence: C0 read-only recovery evidence -> C1 apply forward migration
  -> C2 ba repair Save qua UI -> C3 rollback-only reconstruction gate.
- Proposed C2 reason, chưa được chốt để apply Cloud:
  `Task 13 Step 5: khôi phục provenance sau thu hồi Material Request`.

## 5. Lỗi / vấn đề còn tồn tại

- B1 đã làm drift provenance: 363 active grants mang B1 retirement reason;
  manifest B0 hiện không tái dựng đúng baseline cho tới khi Remediation C xong.
- Remediation C mới có spec, chưa có implementation plan, migration, RPC, UI
  repair, test mới hoặc Cloud mutation.
- Worktree mới tạo từ root
  `material-request-provenance-remediation` có 2 baseline test fail vì root
  thiếu các commit readiness lịch sử: `permissionReadiness.test.ts` và
  `phase02Task3PermissionReadinessMigration.test.ts`. Dùng worktree Tranche B
  làm nền cho Remediation C, không coi hai fail này là lý do để nới test/gate.
- 12 principals / 318 manifest rows vẫn blocked bởi 21 declared permission
  codes; không được Save từng phần.

## 6. Rủi ro cần chú ý

- Mọi Cloud evidence chỉ aggregate-only: không in identity, email, UUID, raw
  grant, audit payload, token, database URL hoặc private manifest.
- C0 phải vẫn chứng minh: B1 audit 3, repair audit 0, affected 363, sensitive
  affected 69, recoverable 363, retired active 0, Direct Grants 2274,
  non-sensitive fingerprint không đổi, durable operator 1, flags enabled 0.
- C2 chỉ được chạy sau khi user chốt exact reason; dừng ngay khi hard deny,
  warning hoặc invariant drift.
- UI port 3000 từng được user đăng nhập; chỉ dùng authenticated governed UI cho
  repair, không direct-SQL mutate grant.

## 7. Việc cần làm tiếp theo

1. Đọc spec Remediation C và xin user duyệt **written spec**.
2. Dùng `writing-plans` để tạo plan C chi tiết, rồi xin xác nhận execution.
3. TDD: viết test đỏ cho forward replace provenance, repair RPC/security,
   frontend fresh-preview, manifest source filter và rollback-only postcheck.
4. Tạo migration bằng `supabase migration new`, thực hiện code tối thiểu,
   chạy focused tests, `npm test`, `npx tsc --noEmit`, `git diff --check`.
5. Xin duyệt Cloud Gate C0; chỉ sau PASS mới xin C1 để apply migration.
6. Sau C1 PASS, xin user chốt exact C2 reason và duyệt C2; chạy ba UI Save
   bounded, mỗi Save có fresh Preview và retry no-op proof.
7. Chạy C3 rollback-only; chỉ PASS mới quay lại Task 3 readiness chính.

## 8. Lệnh đã chạy và kết quả

- `npm test` trong worktree remediation mới từ root: 599 pass / 2 fail baseline
  như mục 5; `npx tsc --noEmit` chưa chạy vì command chain dừng tại test fail.
- Trước đó B1 UI branch: focused UI test, full test suite, TypeScript và
  `git diff --check` đã pass trước commit `2fccab0`.
- `git -C .../material-request-readiness-tranche-b status --short`: sạch sau
  commit spec `9180141`.
- Read-only Cloud B1 final/postcheck: retired active 0, sensitive 95, Direct
  Grants 2274, B1 audit 3, retry no-op, non-sensitive fingerprint không đổi,
  durable operator 1, flags enabled 0.
- Read-only recovery query: 363/363 affected active grants recoverable; không
  có Cloud mutation trong các query evidence.

## 9. Các phần KHÔNG được tự ý thay đổi

- Không sửa, stage, revert roadmap dirty:
  `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
- Không sửa applied migrations, đặc biệt
  `supabase/migrations/20260718092455_unified_permission_change_command.sql`
  và `supabase/migrations/20260718123119_authorization_audit_readiness.sql`.
- Không `supabase db push`, không local Supabase/Docker, không `--local`, không
  direct SQL mutate grants, không service-role bypass, không bật rollout flags.
- Không restore hai quyền retired, không sửa catalog/readiness/resolver/Phase 03
  trong Remediation C, không rewrite audit B1.
- Không Save 12 principals, không tách 318 rows thành partial principal draft,
  không in dữ liệu nhận diện hay manifest private.
- Không bỏ qua hard deny/warning, không đổi fingerprint/gate để ép PASS.

## 10. Prompt đề xuất để bắt đầu phiên Codex mới

```text
Đọc đầy đủ HANDOFF_SUMMARY.md trước, sau đó đọc các file bắt buộc trong mục 3
và architecture source/master roadmap được nêu ở mục 4. Làm việc bằng tiếng
Việt, xưng anh/em. Xác nhận Git và Supabase Cloud bằng aggregate-only read-only
evidence, không in identity/raw grants/tokens/URLs và không Cloud mutation.

Tiếp tục đúng Closure Task 3, Phase 02, tại Remediation C. Chỉ dùng worktree
/Users/admin/khotienthinh/.worktrees/material-request-readiness-tranche-b làm
nền vì nó chứa đầy đủ B0/B1 và spec commit 9180141. Trước code hãy chờ/ghi nhận
user duyệt written spec, dùng writing-plans tạo plan C, rồi TDD. Tuyệt đối không
sửa roadmap dirty, applied migrations, hoặc Save 12 principals; không direct
SQL mutate grant, không supabase db push/local Docker. Dừng fail-closed ở mọi
hard deny, warning hoặc invariant drift. Sau mỗi checkpoint, báo ngắn gọn đã
làm gì, evidence aggregate và bước kế tiếp.
```
