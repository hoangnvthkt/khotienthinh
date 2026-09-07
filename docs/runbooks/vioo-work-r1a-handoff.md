# Vioo Work R1A — handoff trước Task 5

> Cập nhật: 2026-09-07 (Asia/Ho_Chi_Minh)
> Task 0–4 đã hoàn thành; tiếp theo Task 5. R1A chưa bật cho người dùng.

## 1. Workspace và nguồn sự thật

Làm việc tại `/Users/admin/khotienthinh/.worktrees/vioo-work-r1a`, branch
`feature/vioo-work-r1a`. Không sửa checkout gốc, không dùng sub-agent.

- Base: `74d18a1`; đặc tả cherry-pick: `e251c9a`.
- Đọc `AGENTS.md` trước khi sửa.
- Đặc tả: `docs/superpowers/specs/2026-09-05-vioo-work-task-management-design.md`.
  Người dùng đã xác nhận bản ở checkout gốc là cơ sở cho Task 4–11; nội dung đã
  đối chiếu và trùng bản trong worktree. Không cần hỏi lại kế hoạch phiên trước.
- Bằng chứng: `docs/runbooks/vioo-work-r1a-rollout.md`.
- Kế hoạch Task 4 đã thực hiện:
  `docs/superpowers/plans/2026-09-07-vioo-work-r1a-task4.md`.
- Handoff cũ trước Task 3 được giữ trong lịch sử commit `2153407`.

Trước khi chỉnh sửa: `git status --short` và `git log -8 --oneline`. Thay đổi đang
có ngoài checkpoint này phải được kiểm tra như thay đổi của người dùng.

## 2. Checkpoint đã hoàn thành

| Task | Nội dung | Commit implementation |
| --- | --- | --- |
| 0 | Worktree, baseline, feature flag tắt | `2887eac` |
| 1 | Canonical permission registry và route boundary | `c47433a`, `791b363`, `de0c696` |
| 2 | Core schema, constraints, RLS | `7a7daf0` |
| 3 | Preview/create/list/detail/clone/groups và types | `806dedb` |
| 4A | Calendar intervals, policy priority/scope, assignment SLA | `92bea7b` |
| 4B | Lifecycle, review, transfer/co-assignee, capabilities | `d745072` |

Sáu migration Work sau đây đã apply lên Cloud; **không sửa nội dung**:

```text
20260907012229_work_r1a_permission_registry.sql
20260907015936_work_r1a_restore_permission_execution.sql
20260907021001_work_r1a_core_schema.sql
20260907023329_work_r1a_task_commands.sql
20260907024703_work_r1a_sla_engine.sql
20260907025138_work_r1a_lifecycle_commands.sql
```

Ledger local/Cloud khớp **14/14** migration; archive có 402 file.

## 3. Contract hiện tại

TypeScript: `lib/work/workTypes.ts`; độc lập với `ProjectTask`.

RPC đọc/tạo:

```text
preview_work_task_recipients(p_sources jsonb, p_scope jsonb)
create_work_task(p_input jsonb, p_idempotency_key uuid, p_recipient_fingerprint text)
list_work_tasks(p_view text, p_filters jsonb, p_cursor jsonb, p_limit integer)
get_work_task_detail(p_task_ref text)
get_work_task_clone_draft(p_task_id uuid)
list_work_task_groups(p_scope jsonb, p_cursor jsonb, p_limit integer)
```

Command vòng đời:

```text
command_work_task(
  p_task_id uuid,
  p_command text,
  p_payload jsonb,
  p_expected_lock_version bigint,
  p_idempotency_key uuid
)
```

Allowlist: `acknowledge`, `request_clarification`, `start`, `block`, `unblock`,
`submit`, `review`, `cancel`, `transfer`, `add_assignees`. Payload có discriminated
union `WorkLifecycleCommand` trong types. Các wrapper public là security-invoker;
entry private kiểm actor/capability và ghim `search_path=''`.

Lưu ý tích hợp:

- Actor chỉ lấy từ `current_app_user_id()`, không truyền actor từ client.
- Input camelCase; read projection giữ tên cột snake_case. Cursor `{sortAt,id}`;
  list cap 100. Comments/events/history không nằm trong detail.
- DB dùng `clarification_requested` cho trạng thái làm rõ; giữ nhất quán với
  TypeScript khi làm UI (đặc tả mô tả trạng thái này là `needs_clarification`).
- `department_id uuid`, `project_id text`; không gộp thành một UUID polymorphic.
- `work_groups` là nguồn người nhận; `work_task_groups` là bucket theo scope.
- Join legacy membership bằng `work_group_members.user_id = users.id::text`.
- Tài khoản disabled được trigger hiện có đồng bộ thành inactive. `auth_id` null
  không tự có nghĩa là không có app account: actor resolver còn email fallback.
- Create chống preview stale và retry/key conflict; version/event/outbox cùng
  transaction. Task thiếu calendar bị chặn; không tự seed lịch.
- Calendar `working_intervals=[]` dùng `workday_start/end`; array khác rỗng hỗ trợ
  ca có giờ nghỉ. Policy ưu tiên scope, rồi priority, chỉ lấy bản active/effective.
- `execution_sla_started_at = acknowledged_at`; due chỉ có khi cấu hình thời lượng.
  Snapshot lưu cấu hình và exception áp dụng. Deadline task không tự thay đổi.
- Transfer không xóa blocker chung; đóng assignment cũ và tạo SLA cho người mới.
  Self-only auto-complete chuyển creator-review khi thay đổi trách nhiệm và phải
  có reviewer hợp lệ.
- Completed/cancelled assignments có `ended_at`; giữ `acknowledged_at` để biết ai
  chưa từng nhận. Người từng được giao giữ quyền đọc qua canonical relation;
  mutation capabilities chỉ dựa trên assignment đang mở và trạng thái hợp lệ.
- Clone lấy trách nhiệm hiện tại sau transfer/add, bỏ assignee checklist không
  còn trong draft recipients; provenance ban đầu vẫn nằm trong snapshot gốc.
- Retry trả response gốc, có thể cũ hơn state hiện tại: client cần invalidate/
  refetch sau command, không coi response retry là toàn bộ state mới nhất.

## 4. Việc tiếp theo — Task 5

Theo mục 11–12 và 20 của đặc tả: checklist CRUD, discussion/reply/edit audit,
mention, history, pin và notification preference.

Các điểm cần triển khai/kiểm chứng:

1. Checklist dùng quyền creator/accepted assignee/scoped manager phù hợp trạng
   thái; kiểm assignee hợp lệ, version conflict, không làm mất lịch sử hoàn thành.
2. Comment/reply luôn cùng task; edit có policy và bằng chứng before/after. Watcher
   được bình luận nhưng không nhận quyền thay đổi trạng thái task.
3. Mention picker chỉ trả người có quyền xem; mention không tạo assignment,
   participant hoặc grant. Notification mention cần event/outbox riêng.
4. Comments/history tải bằng cursor riêng, có hard limit; không mở rộng detail
   để nhồi toàn bộ thảo luận/lịch sử.
5. Đồng bộ `audit_view` giữa history RPC, capabilities và RLS events/versions.
   Chính sách events hiện kế thừa Task 2 (can-view-task); versions còn kiểm quan
   hệ assignment active. Phải hoàn thiện boundary audit cho historical assignees
   trước pilot; Task 4 không tuyên bố đã hoàn thành history API này.
6. Pin/mute là theo actor + task, không tác động người khác. Mute chỉ chặn thông
   báo thường, không chặn các thông báo bắt buộc ở Task 6.
7. SQL smoke role authenticated: creator/assignee/watcher/reviewer/manager/
   unrelated/inactive; cross-task reply/mention, edit/conflict, restricted leak,
   cursor ties và idempotent retry. Chạy regression Task 3–4 và core/helper.

## 5. Roadmap còn lại và điều kiện pilot

- Task 6: outbox worker, delivery dedupe/retry, deep link, Realtime invalidation.
- Task 7: private Storage, two-phase upload, compression và Edge Function.
- Task 8: module shell/list/create drawer và services/hooks feature-local.
- Task 9: responsive detail, capability actions và screenshot QA.
- Task 10: scoped bucket/calendar/SLA settings, named pilot enablement.
- Task 11: HTTP/JWT acceptance personas, EXPLAIN, deployment, quan sát đủ 48 giờ.

**Hiện tại:** `VITE_ENABLE_VIOO_WORK=false`; chưa có route/menu Work, worker,
Storage processor hoặc Realtime publication. Không bật pilot trước khi đầy đủ
commands/collaboration/notifications/Storage/UI smoke.

Người dùng đang được hỏi lịch công ty (ngày, ca/giờ nghỉ, ngày nghỉ đặc biệt),
người dùng pilot cụ thể và môi trường bật Work. Chưa có câu trả lời cho các thông
tin này; không tự suy ra cấu hình hoặc cấp grant. Việc phát triển Task 5–9 bằng
fixture rollback không phụ thuộc câu trả lời này.

R1B/R2/R3 chỉ là roadmap, không triển khai trong nhánh R1A.

## 6. Quy trình Cloud và verification

Chỉ Supabase Cloud project `ftciqmqhmfvjtwoycswe`, cấu hình `.env` ở checkout gốc.
Không Docker/local Supabase và không `db push --include-all`.

Mỗi feature: failing behavioral test → xác nhận fail → implementation → targeted
smoke → lint; build khi có UI. Mỗi migration: tạo file bằng CLI → Cloud rollback
smoke → commit explicit paths → linked dry-run chỉ migration dự kiến → apply →
postflight → ghi bằng chứng. Thêm migration mới vào `supabase/baseline/current.json`.

```bash
set -a
source /Users/admin/khotienthinh/.env
set +a
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration supabase/migrations/<CLI-generated-file>.sql \
  --smoke supabase/tests/<smoke>.sql
```

Postflight dùng `--migration /dev/null` để không chạy lại DDL đã apply.

Smokes hiện có:

```text
supabase/tests/work_r1a_permission_execute_smoke.sql
supabase/tests/work_r1a_core_schema_smoke.sql
supabase/tests/work_r1a_task_commands_smoke.sql
supabase/tests/work_r1a_sla_engine_smoke.sql
supabase/tests/work_r1a_lifecycle_commands_smoke.sql
```

Chạy riêng các smoke tạo default calendar: không gộp Task 3/SLA/lifecycle thành
một outer transaction vì mỗi bộ tự tạo calendar mặc định. Mỗi fixture rollback.

Verification gần nhất:

- Full frontend regression: 349 files / 1.654 tests / 0 failures.
- Lint và build đạt; build còn chunk-size warning cũ.
- Commands, SLA, lifecycle, core RLS và authenticated helper postflight đều đạt.
- Query audit: 0 findings/errors. Migration checker: 14 active / 402 archived.
- Cloud security advisor mức `error`: không issue; không tuyên bố sạch warn/info.
- Persisted Work counts sau postflight: tasks/calendars/policies/direct Work
  grants/outbox đều **0**. Chưa có task nghiệp vụ hoặc pilot grant.
- Code concurrency: 2 Cloud transactions đồng thời cấp 16 mã khác nhau, không tạo
  task. Counter tăng và để lại 16 mã không sử dụng; không rewind counter. Script
  `scripts/smoke-work-code-concurrency.mjs` mỗi lần chạy sẽ cấp thêm 16 mã.
