# Handoff - Authorization V2 Task 12.4.2 / Task 13

**Thời điểm chốt:** 2026-09-17, Asia/Ho_Chi_Minh
**Trạng thái:** Code E28-E34 đã lên Production; E35 đã revoke pilot; owner đã chấp nhận kết quả Thuận và loại persona này khỏi E36 re-pilot; E36 còn cleanup/re-pilot Hương; Task 12.4.2 chưa kết thúc; Task 13 vẫn bị chặn.

Tài liệu này thay thế handoff ngày `2026-09-15` làm điểm bắt đầu cho phiên mới. Handoff cũ vẫn là lịch sử của E5-E13.

## 1. Điểm bắt đầu bắt buộc

- Repository root: `/Users/admin/khotienthinh`
- Worktree triển khai: `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2`
- Branch hiện hành: `feature/authorization-v2-task12-4-2`
- Release đã merge/Production: `86e0e272ee0481e84cdf1ef6203fdcffc218e3fa`
- E36 bắt đầu tại `HEAD = 5b9adcd81d73589d9155c049df8b0a2ccfc046d7`; `origin/main = 9766c5cef6383d869978726560445be7a7f32371`. Production application release vẫn là SHA ở trên.
- Supabase duy nhất được phép thao tác: Cloud main project `ftciqmqhmfvjtwoycswe`, cấu hình trong `/Users/admin/khotienthinh/.env`.
- Không dùng Supabase local, Docker, Supabase Branch, worktree mới hoặc sub-agent. Không dùng Superpowers/plugin workflow nếu chưa được yêu cầu rõ.

Workspace root `/Users/admin/khotienthinh` đang có thay đổi chưa commit, không liên quan Authorization V2 và chậm 64 commit so với `origin/main`. Không checkout, reset, merge hoặc gom các thay đổi đó vào công việc này.

Trước khi sửa hoặc chạy migration ở phiên mới:

```bash
cd /Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2
git status --short --branch
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main

set -a
source /Users/admin/khotienthinh/.env
set +a
npx --yes supabase@2.116.0 db push --linked --dry-run --include-all --yes
```

Nếu SHA/ledger khác tài liệu này, trạng thái mới là nguồn sự thật. Đọc diff, kiểm dependency và ghi chênh lệch vào rollout log trước khi tiếp tục.

## 2. Trạng thái merge và triển khai

- `feature/authorization-v2-task12-4-2` và `feature/authorization-v2-task13-drop-legacy-schema` đã được merge conflict-free vào release `86e0e27`.
- GitHub CI, Vercel Production và production build đã đạt cho release này. Supabase Preview của branch là trạng thái phụ thuộc cơ chế branch và không phải bằng chứng thay thế Cloud main.
- Không có migration Task 13 nào được apply để drop schema legacy.
- Phân quyền mới có thể cần người dùng **sign out/sign in** sau khi thay đổi quyền để refresh authorization snapshot trên browser.

## 3. Những gì E28-E34 đã hoàn tất

### E28 - E31: mô hình template và WMS

- Owner đã duyệt chi tiết actor/action/scope cho hai cohort `wms_manage` và `workflow`.
- Tạo gate kỹ thuật so decision register -> blueprint -> action catalog. Chỉ action `enforced` hoặc `verified`, và scope được catalog hỗ trợ, mới được lưu/preview/gán template.
- `WAREHOUSE_OPERATOR` và `WAREHOUSE_MANAGER` được harden theo warehouse scope; pilot command/rollback đã chứng minh preview fingerprint, audit, SoD và không phát sinh quyền ngoài kho được gán.
- Các capability nhạy cảm WMS được tách tường minh, gồm quyết toán/hoàn tác phiếu xuất cấp, trả NCC và xóa yêu cầu WMS. Không suy từ `role=ADMIN` hay `system.wms.manage` để tự cấp `wms.transaction.reverse`.

### E32: Workflow capability boundaries

- Bảy action Workflow đã chuyển từ `declared` sang `enforced`: view/create/act instance; view/create/edit/publish template.
- Instance generic chỉ cho creator (`own`), assignee hiện tại (`assigned`) hoặc Workflow admin (`global`) theo capability; Request/Project subject visibility vẫn giữ nguyên.
- Direct write từ client vào template/node/edge bị khóa. Template lifecycle đi qua RPC có capability guard.
- Role-template readiness trên Cloud đạt `4/4`: `WORKFLOW_USER`, `WORKFLOW_ADMIN`, `WAREHOUSE_OPERATOR`, `WAREHOUSE_MANAGER`.

### E33: Workflow pilot lịch sử, đã revoke tại E35

- Đặng Thu Hương là pilot `WORKFLOW_USER`; Nguyễn Quang Thuận là pilot `WORKFLOW_ADMIN` theo chỉ định owner.
- Hai template persistent v1 được tạo bằng command V2. `WORKFLOW_USER` có 6 action, `WORKFLOW_ADMIN` có 12 action.
- Assignment `global/*` chỉ là phạm vi gán template; item giữ scope record-bound: own draft, assigned step, hoặc global admin theo blueprint.
- Hai assignment có expiry `2026-09-18 03:45:01 UTC` (`10:45:01`, giờ Việt Nam) nhưng đã được revoke bằng command V2 lúc `2026-09-17 08:04:26 UTC` vì evidence không đủ. ID target/assignment/audit giữ trong Cloud, không đưa vào evidence document.

### E34: hotfix route Workflow

- Lỗi đã xác định: generic frontend guard kiểm `workflow.instance.view` ở `global/*`, khiến `WORKFLOW_USER` có `own` không vào `/wf` dù Cloud/RLS đúng.
- `/wf`, Workflow dashboard và instance detail giờ chấp nhận `workflow.instance.view` tại `own`, `assigned` hoặc `global`; RLS vẫn quyết định record cụ thể.
- Sidebar mẫu Workflow dùng canonical capability thay cho `Role.ADMIN`. Người chỉ có view thấy menu đúng quyền, còn create/edit/publish vẫn phải qua action guard và RPC backend.

## 4. Bằng chứng test đã có

- Full regression cuối: `409/409` test files, `1954/1954` tests pass.
- TypeScript/lint, production build, `git diff --check`, migration baseline (`91 active SQL`, `402 archived`) đều đạt.
- Supabase query audit/check: `0` findings/errors.
- Cloud readiness checker: `4/4` template ready.

Khi sửa checkpoint mới, không dùng số trên làm thay bằng chứng mới: phải chạy lại test/smoke phù hợp với phạm vi thay đổi và ghi kết quả thực tế.

## 5. Các việc chưa hoàn thành và gate không được bỏ qua

### E36 — làm sạch và chạy lại pilot Workflow

E35 đã đóng pilot cũ. E36 bổ sung checker read-only. Ngày `2026-09-18`, owner xác nhận đã tự kiểm thử Thuận và chấp nhận persona `WORKFLOW_ADMIN`, vì vậy không chờ session Thuận và không assign lại `WORKFLOW_ADMIN`. Chỉ tiếp tục phần còn lại khi Hương và Permission Admin cùng xác nhận cửa sổ nghiệm thu:

1. Dùng fingerprint đã chốt để loại đúng 9 `workflow.*` direct grant của Hương qua `update_user_authorization_v2`, giữ nguyên 61 grant ngoài Workflow và `system.wf.view`; postflight audit trước khi assign.
2. Preview rồi chỉ assign lại `WORKFLOW_USER` bằng V2 command với expiry 24 giờ. Không tạo assignment mới cho Thuận.
3. Chạy allow/deny matrix Production của Hương, đối chiếu Cloud audit/resolver/command activity và ghi evidence đã lược bỏ PII. Kết quả Thuận được ghi là owner acceptance riêng, không phải evidence session mới.
4. Revoke ngay assignment Hương sau evidence; E36 chỉ PASS nếu final postflight trở về `0` active assignment, Hương còn `0 workflow.*` direct grant và reconciliation không có unexpected gain/loss.

Ngoài E36 Workflow, kiểm tra Cloud ngày `2026-09-18` xác nhận Thuận chỉ có `asset.assignment.view`, không có `asset.assignment.assign`, `asset.assignment.return` hoặc `asset.assignment.transfer`, và không có nguồn legacy Asset. Lỗi thấy đủ nút thực thi nằm ở frontend Tài sản: action chưa được guard riêng và mutation cũ cập nhật state/toast trước khi backend trả kết quả. Branch hiện hành sửa UI theo từng capability và chuyển mutation sang command `record_asset_assignment`; không thay đổi grant thật.

### 13 cohort business còn owner-pending

`scripts/authorization-v2/task12-4-2-owner-decisions.json` còn đúng 13 cohort `owner_pending`: AI, Analytics Dashboard, Audit Trail, Chat, Project DA, Employee/HR, Expense, Contract, Knowledge/Storage, Procurement/Tender, Request, Settings, Asset.

Với từng cohort, owner phải chốt cụ thể **actor nào**, **action nào**, **scope dữ liệu nào** được phép. Sau khi có quyết định, thứ tự bắt buộc là: cập nhật decision/blueprint -> xác minh action runtime enforced -> readiness checker -> pilot preview/SoD/audit -> persona allow/deny -> reconciliation -> chỉ khi đạt mới tạo manifest executable và cân nhắc revoke shell legacy. Không được tạo manifest hoặc thu hồi legacy shell cho cohort `owner_pending`.

### Task 13: Drop legacy schema vẫn bị chặn

Tuy branch tên Task 13 đã merge, đây chỉ là code/runbook chuẩn bị. Không được drop `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules`, legacy guard/projection/lifecycle helper, trigger hoặc snapshot.

Task 13 chỉ được mở khi đồng thời đạt:

- Các cohort nằm trong phạm vi revoke không còn `manual_review`/`owner_pending`; tất cả manifest được owner duyệt, apply và reconciliation đạt.
- Persona production quan trọng được xác nhận trên đúng release, gồm pilot mới và những persona đã liệt kê trong runbook.
- Observation window liên tục ít nhất 7 ngày tính từ mốc muộn nhất giữa release, batch, và persona evidence; không rollback incident hay deny anomaly bất thường.
- Cloud ledger khớp Git, dependency query legacy đủ điều kiện, snapshot backup bất biến và restore rehearsal đạt.
- Runtime dependency còn được gỡ theo Task 13; không chỉ drop column khi helper/frontend còn đọc/ghi/return legacy fields.

## 6. Tài liệu và artefact phải đọc trước checkpoint tiếp theo

1. `docs/security/authorization-v2-task12-4-2-rollout-log.md`
2. `docs/security/authorization-v2-task12-4-2-role-template-decision-pack.md`
3. `docs/security/authorization-v2-task12-4-2-e23-non-wms-cohort-audit.md`
4. `docs/security/authorization-v2-task12-4-2-legacy-runtime-dependencies.md`
5. `docs/security/authorization-v2-task13-runbook.md`
6. `scripts/authorization-v2/task12-4-2-owner-decisions.json`
7. `scripts/authorization-v2/task12-4-2-role-template-blueprints.json`
8. `supabase/tests/authorization_v2_task13_readiness.sql`
9. `scripts/authorization-v2/check-task12-4-2-e36-workflow-pilot.mjs`

## 7. Quy tắc Cloud/checkpoint

- Migration mới: Cloud rehearsal rollback -> scoped smoke allow/deny -> reconciliation -> dry-run đúng migration -> apply Cloud main -> postflight -> full relevant gate -> commit/push.
- Mọi grant/revoke/template/assignment thật đi qua V2 command có preview fingerprint, expected version, audit và SoD contract; không SQL trực tiếp vào bảng authorization.
- Không apply batch có account cụ thể nếu chưa có owner approval và diff/manifest cụ thể.
- Không in token/password từ `.env` vào log.

## 8. Prompt dùng ngay cho phiên chat mới

> Tiếp tục E36 theo `docs/security/authorization-v2-task12-4-2-handoff-2026-09-17.md`. Dùng worktree `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2`, không tạo worktree/sub-agent, không dùng local/Docker hay Superpowers/plugin workflow. Trước hết xác minh Git/Cloud ledger và chạy checker E36 chỉ cho Hương; Thuận đã được owner chấp nhận và bypass khỏi re-pilot. Khi Hương và Permission Admin sẵn sàng, loại đúng chín direct Workflow grant của Hương qua `update_user_authorization_v2`, assign `WORKFLOW_USER` 24 giờ qua V2 preview/fingerprint, chạy persona allow/deny rồi revoke ngay sau evidence. Không tạo manifest/revoke legacy shell cho 13 cohort `owner_pending`, và không triển khai Task 13/drop legacy schema.
