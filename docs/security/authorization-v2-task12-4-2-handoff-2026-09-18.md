# Handoff — Authorization V2 Task 12.4.2 / E36 / Task 13

**Thời điểm chốt:** 2026-09-18, Asia/Ho_Chi_Minh

**Nguồn sự thật Git trước commit handoff:** `main = origin/main = 919c2832c7770e05c2f336eeca3269799268fca0`

**Trạng thái chương trình:** Code Authorization V2 và các hotfix UI đã vào `main`; E36 đã `PASS` với Production evidence và final revoke của Hương; observation T0 chưa được xác lập; Task 13 vẫn bị chặn.

Tài liệu này thay thế handoff ngày `2026-09-17` làm điểm bắt đầu cho phiên chat mới. Handoff cũ và rollout log vẫn được giữ làm lịch sử bằng chứng.

## 1. Điểm bắt đầu bắt buộc

- Repository root: `/Users/admin/khotienthinh`
- Worktree Authorization được chỉ định: `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2`
- Branch: `feature/authorization-v2-task12-4-2`
- Cloud duy nhất được phép thao tác: Supabase main project `ftciqmqhmfvjtwoycswe`, dùng cấu hình `/Users/admin/khotienthinh/.env`.
- Không dùng Supabase local, Docker, Supabase Branch hoặc SQL mutation trực tiếp vào bảng authorization.
- Không tạo worktree hoặc sub-agent mới. Không mở Task 13 và không drop legacy schema khi các gate bên dưới chưa đạt.

Tại thời điểm handoff, root `main` sạch và đã push. Worktree Authorization cũng sạch nhưng branch của nó đứng tại `dde5151` và là ancestor của `main`; phải fast-forward từ `origin/main` trước khi tiếp tục:

```bash
cd /Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2
git status --short --branch
git fetch origin --prune
git merge --ff-only origin/main
git rev-parse HEAD
git rev-parse origin/main
```

Không dùng reset, checkout cưỡng bức hoặc stash để đồng bộ. Nếu fast-forward không còn thực hiện được, dừng và đọc divergence trước khi sửa file.

## 2. Trạng thái release, kiểm thử và Cloud

### Git và local

- `main` đã nhận toàn bộ 10 commit của nhánh Authorization V2 qua merge `572c328`.
- Hotfix navigation mới nhất gồm:
  - `9d6da3a`: ẩn icon Workflow khi chỉ còn compatibility shell.
  - `d3d32c1`: chọn route module theo canonical capability thực sự truy cập được.
  - `dde5151`: loại navigation item stale sau khi thu hồi quyền.
- Fix quyền thao tác Tài sản ở `d94392d`: quyền xem không còn tự làm hiện hoặc thực thi các action cấp phát, thu hồi, điều chuyển.
- Root `main` còn nhận nhóm responsive UI Dự án/Yêu cầu/Quy trình, Request attachment wrapper, tài liệu và các sửa lỗi khác; không làm thay đổi gate E36/Task 13.
- `http://localhost:3000` đang chạy từ root `main`; không có listener tại `3001` ở checkpoint cuối.

### Verification cuối trên `main`

- Vitest: `415/415` test files, `1974/1974` tests pass.
- TypeScript: pass.
- Production build: pass.
- Migration baseline: `91 active SQL`, `402 archived SQL`, pass.
- `git diff --check`: pass.
- Vitest đã loại `.worktrees/**` để không quét nhầm test của các branch cũ.

### Supabase Cloud

- Linked ref và ref suy từ `.env` đều là `ftciqmqhmfvjtwoycswe`.
- Cloud migration dry-run cuối trả:

```json
{
  "upToDate": true,
  "dryRun": true,
  "migrations": [],
  "seeds": [],
  "roles": []
}
```

- Vercel Production đã được xác minh `READY` trên SHA `bc48b4d197047c847244d51c25ce1a7b916c4b24`, chứa ba hotfix navigation và fix capability Tài sản. Phải xác minh lại nếu `main` đổi trước khi ghi persona evidence tiếp theo.

## 3. Những gì Authorization V2 đã giải quyết

### Nền tảng và quản trị

- Editor module-first dùng catalog canonical; direct grants hiển thị nguồn, scope và expiry.
- Lưu hồ sơ/quyền, đổi loại tài khoản, preview/assign/revoke business role đều đi qua V2 command có optimistic concurrency, audit và kiểm SoD.
- Template blueprint/readiness chỉ cho phép action đã `enforced` hoặc `verified`; không suy quyền nhạy cảm từ nhãn role hoặc compatibility shell.
- Transition manifest builder, preview và reconciliation đã có guard kỹ thuật, nhưng chưa có quyền chạy cho cohort còn `owner_pending`.

### WMS

- Đã tách capability đọc/ghi và các action nhạy cảm: tạo/gửi/xử lý/hủy phiếu, nhận hàng theo stage, quyết toán/hoàn tác, trả nhà cung cấp và xóa yêu cầu.
- `WAREHOUSE_OPERATOR` và `WAREHOUSE_MANAGER` đã được harden theo scope kho, có pilot/rollback và reconciliation.
- Không suy `wms.transaction.reverse` từ `role=ADMIN` hoặc `system.wms.manage`.

### Workflow

- Capability instance/template đã được nối tới route, UI action, RPC và RLS phù hợp.
- Record boundary giữ `own`, `assigned` hoặc `global`; global assignment của template không làm rộng scope item.
- Draft lifecycle và mutation command đã được harden; direct table mutation bị chặn.
- Hai template persistent hiện hành được giữ nguyên:
  - `WORKFLOW_USER`: 6 items.
  - `WORKFLOW_ADMIN`: 12 items.
- Route `/wf` chấp nhận quyền record-bound hợp lệ; Sidebar/Dock/BottomNav chỉ hiện module khi còn route canonical thực sự truy cập được.

### Tài sản

- `asset.assignment.view` chỉ cho phép xem.
- Các nút và submit cấp phát, thu hồi, điều chuyển kiểm riêng `assign`, `return`, `transfer` theo scope.
- UI chỉ cập nhật state/toast sau khi RPC `record_asset_assignment` thành công; quyền xem không còn tạo cảm giác thao tác đã thành công giả.

## 4. Trạng thái E36 — PASS; Task 13 vẫn bị chặn

### Thuận / `WORKFLOW_ADMIN`

- Owner xác nhận đã tự kiểm thử và chấp nhận persona Thuận.
- Thuận được bypass khỏi E36 re-pilot; không tạo assignment mới cho `WORKFLOW_ADMIN`.
- Đây là owner acceptance riêng, không phải permanent assignment và không mở observation T0 hoặc Task 13.

### Hương / `WORKFLOW_USER`

Bằng chứng Cloud đã ghi trong rollout log lúc `2026-09-18 02:58:56 UTC`:

- Tài khoản active nhưng không có session active/refresh trong hai giờ gần nhất.
- `70` direct grants active: `61` ngoài Workflow và `9 workflow.*`.
- Fingerprint 61 grant ngoài Workflow: `ebb0b31ff1a5397d49f6c82a9aa6be3fa25c35d252b40b4d6e1ab30aedf9abdc`.
- Có compatibility shell `system.wf.view`.
- Assignment `WORKFLOW_USER` cũ ở trạng thái `REVOKED`; active assignment count bằng `0`.
- Không có Workflow command/instance/log mới trong cửa sổ evidence.
- Transition ledger: `0 batch / 0 item`.

Sau checkpoint trên, owner có thao tác cấp/thu hồi quyền xem Workflow của Hương và phát hiện icon Sidebar vẫn hiện dù route đã deny. Frontend đã được sửa và merge vào `main`, nhưng chưa có checker Cloud hậu kiểm được ghi lại sau thao tác của owner. Vì vậy:

- Không được mặc định rằng chín direct `workflow.*` vẫn còn.
- Cũng không được mặc định rằng chúng đã về `0`.
- Phải chạy lại checker read-only trước mọi mutation và lấy trạng thái Cloud mới làm nguồn sự thật.
- Nếu Cloud đã về `0`, không gửi lại lệnh revoke.

Hậu kiểm mới lúc `2026-09-18 05:00:30 UTC` đã đóng phần bất định trên:

- Hương còn `0 workflow.*` direct grant; không gửi lại command revoke.
- `61` grant ngoài Workflow giữ đúng fingerprint `ebb0b31ff1a5397d49f6c82a9aa6be3fa25c35d252b40b4d6e1ab30aedf9abdc` và `system.wf.view` vẫn còn.
- Chín Workflow grant cũ đã được revoke lúc `03:15:05 UTC` qua audit V2; templates 6/12, active assignment `0`, ledger `0/0` và không có Workflow activity mới.
- Permission Admin có session active. Hương có `last_sign_in_at=04:19:51 UTC` nhưng `0` active session và `0` refresh trong hai giờ gần nhất tại thời điểm hậu kiểm, nên maintenance gate vẫn đóng. Chưa preview/assign `WORKFLOW_USER` và chưa mutation Cloud trong checkpoint này.

### Điều kiện E36 PASS — đã đạt

1. Đã đạt: Production `bc48b4d` chứa ba hotfix navigation và fix Tài sản.
2. Đã đạt: Hương đăng nhập lại, 2 session active/refresh trong cửa sổ nghiệm thu; Permission Admin có session active.
3. Đã đạt: checker xác nhận `0` direct Workflow grant, 61 grant ngoài Workflow giữ nguyên, compatibility shell và audit đúng kỳ vọng.
4. Đã đạt trước pilot: không còn direct `workflow.*`; không gửi lại `update_user_authorization_v2`.
5. Đã đạt: preview/assign một `WORKFLOW_USER`, `global/*`, expiry 24 giờ qua `assign_business_role_v2`; không assign Thuận.
6. Đã đạt: Production allow/deny matrix trên đúng release; `/wf` và `/wf/templates` allow, `/wf/templates/new` deny/redirect Home.
7. Đã đạt: reconciliation đủ `6/6` ROLE sources, `0` direct `workflow.*`, không unexpected gain/loss và không source ngoài baseline.
8. Đã đạt: revoke assignment Hương ngay sau evidence qua `revoke_business_role_assignment`.
9. Đã đạt: final postflight có `0` active assignment, assignment mới ở `REVOKED`, template 6/12 còn nguyên, transition ledger `0/0`, và 13 cohort `owner_pending` không đổi.

Nếu có unexpected allow/deny, stale session, mismatch fingerprint hoặc persona không hoàn tất: revoke ngay assignment active, deactivate pilot template nghiệp vụ nếu đã tạo, ghi E36 `FAILED/INCOMPLETE`, không mở cohort tiếp theo và không đặt observation T0.

## 5. Quy trình E36 đã thực hiện (tham chiếu)

### Bước 1 — preflight không mutation

```bash
cd /Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2
git status --short --branch
git fetch origin --prune
git merge --ff-only origin/main

set -a
source /Users/admin/khotienthinh/.env
set +a

printf 'linked_ref=' && tr -d '\n' < supabase/.temp/project-ref && printf '\n'
npx --yes supabase@2.117.0 db push --linked --dry-run --include-all --skip-vault --yes
npm run check:supabase-migrations
```

Xác minh Production release SHA riêng. Nếu release chưa chứa `dde5151`/merge `572c328`, không dùng Production để kết luận Sidebar hoặc Tài sản đã được sửa.

### Bước 2 — đọc artefact bắt buộc

1. `docs/security/authorization-v2-task12-4-2-rollout-log.md`
2. `docs/security/authorization-v2-task12-4-2-role-template-decision-pack.md`
3. `docs/security/authorization-v2-task12-4-2-e23-non-wms-cohort-audit.md`
4. `docs/security/authorization-v2-task12-4-2-legacy-runtime-dependencies.md`
5. `docs/security/authorization-v2-task13-runbook.md`
6. `scripts/authorization-v2/task12-4-2-owner-decisions.json`
7. `scripts/authorization-v2/task12-4-2-role-template-blueprints.json`
8. `supabase/tests/authorization_v2_task13_readiness.sql`
9. `scripts/authorization-v2/check-task12-4-2-e36-workflow-pilot.mjs`

### Bước 3 — chạy checker Hương-only

Không hard-code hoặc commit ID người dùng. Lấy ID qua biến môi trường riêng của operator:

```bash
export E36_WORKFLOW_USER_ID='<HUONG_USER_UUID>'
unset E36_WORKFLOW_ADMIN_ID
export E36_WINDOW_START='<UTC_ISO_TIMESTAMP_BEFORE_CURRENT_CHECKPOINT>'

node scripts/authorization-v2/check-task12-4-2-e36-workflow-pilot.mjs \
  ftciqmqhmfvjtwoycswe
```

Checker chỉ read-only và redacted. Không đưa UUID, email, token hoặc dữ liệu nghiệp vụ vào Git/rollout log.

### Bước 4 — chỉ mutation khi maintenance gate mở

- Tải lại target, `updated_at`, direct grants và preview ngay trước command.
- Nếu UI báo “saved, refresh pending”, không gửi command lần hai; đọc Cloud audit rồi refresh.
- Mọi grant/revoke/assignment đi qua V2 command có audit. Không dùng legacy shell script, SQL trực tiếp hoặc `replace_user_permission_grants`.
- Giữ `system.wf.view` theo kế hoạch E36; Sidebar mới không coi shell này là đủ để hiện module.

### Bước 5 — đóng checkpoint

- Chạy targeted tests, full Vitest, TypeScript, production build, migration baseline, `git diff --check` và Cloud dry-run.
- Cập nhật rollout log và handoff bằng evidence đã lược PII.
- Commit/push branch; không tự mở Task 13 hoặc drop legacy schema.

## 6. 13 cohort owner-pending

Vẫn còn đúng 13 cohort chưa được owner chốt actor/action/scope: AI, Analytics Dashboard, Audit Trail, Chat, Project DA, Employee/HR, Expense, Contract, Knowledge/Storage, Procurement/Tender, Request, Settings và Asset.

Với từng cohort, thứ tự bắt buộc là:

1. Owner chốt actor, action và data scope.
2. Cập nhật decision register/blueprint.
3. Chứng minh runtime action đã enforced.
4. Readiness, preview, SoD và audit đạt.
5. Persona allow/deny và reconciliation đạt.
6. Chỉ sau đó mới tạo manifest executable và cân nhắc revoke compatibility shell.

Không tạo manifest hoặc revoke legacy shell cho cohort còn `owner_pending`. Không diễn giải fix UI Tài sản thành owner approval cho cohort Asset.

## 7. Task 13 vẫn bị chặn

Không drop bốn cột `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules`; không xóa legacy helper/trigger/snapshot.

Task 13 chỉ được mở khi đồng thời đạt:

- Tất cả cohort trong phạm vi revoke đã hết `owner_pending`/`manual_review`, manifest được duyệt, apply và reconciliation đạt.
- Production persona quan trọng được xác nhận trên đúng release, gồm E36 Hương.
- Một mốc observation `T0` duy nhất được ghi sau checkpoint cuối cùng; sau đó đủ ít nhất 7 ngày liên tục không rollback incident, deny anomaly hoặc reconciliation mismatch.
- Cloud ledger khớp Git.
- Backup snapshot bất biến đủ coverage theo user ID; checksum đạt; restore rehearsal trong rollback transaction đạt.
- Dependency query legacy trả rỗng sau khi runtime/helper/RPC/trigger đã chuyển canonical-only.
- Không dùng `DROP ... CASCADE`; rollback sau drop phải là reviewed forward migration.

Hiện chưa có observation T0 hợp lệ. Không suy T0 từ ngày commit, ngày merge hoặc pilot cũ đã revoke.

## 8. Kết quả E36 đã đạt; chặng tiếp theo

- E36 đã `PASS` với Production evidence đầy đủ của Hương và final revoke sạch.
- Hương có `0` direct `workflow.*`; 61 grant ngoài Workflow không đổi theo key/scope/expiry; compatibility shell được giữ đúng quyết định hiện tại.
- `WORKFLOW_USER`/`WORKFLOW_ADMIN` template vẫn có 6/12 items; active Workflow pilot assignment bằng `0` sau nghiệm thu.
- Navigation Production đã phản ánh canonical quyền sau sign-in/refresh: `/wf` và `/wf/templates` mở được, còn tạo template bị deny/redirect Home.
- Không phát sinh quyền Tài sản từ `asset.assignment.view` sang assign/return/transfer.
- 13 cohort owner-pending, transition ledger và Task 13 không bị thay đổi ngoài quyết định được duyệt.

## 9. Prompt dùng ngay cho phiên chat mới

> Tiếp tục Authorization V2 theo `docs/security/authorization-v2-task12-4-2-handoff-2026-09-18.md`. Dùng worktree `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2`, không tạo worktree/sub-agent, không dùng Supabase local/Docker. E36 đã `PASS` và assignment Hương đã `REVOKED`; nếu cần chỉ chạy checker Cloud read-only để xác nhận final state, không assign lại `WORKFLOW_USER` và không gửi lại cleanup command. Giữ `system.wf.view`, không tạo manifest/revoke legacy shell cho 13 cohort `owner_pending`, không đặt observation T0 và không triển khai Task 13/drop legacy schema trước khi toàn bộ gate đạt.
