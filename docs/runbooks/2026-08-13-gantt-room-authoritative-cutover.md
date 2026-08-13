# Gantt Room Authoritative Cutover Runbook

## Trạng thái rollout

- Migration: `20260813070319_gantt_room_authoritative_cutover.sql`.
- Cloud rollback smoke: đạt ngày 2026-08-13 với migration và smoke chạy trong cùng một transaction, kết thúc bằng `ROLLBACK`.
- Cloud apply: **đã hoàn thành ngày 2026-08-13** bằng một transaction trực tiếp sau khi database owner duyệt phương án xử lý riêng migration Gantt.
- Chỉ version `20260813070319` được ghi nhận `applied` trong linked migration history. Các mismatch lịch sử cũ không thuộc cutover này được giữ nguyên, không repair và không dùng `--include-all`.
- Post-apply smoke đạt; local/remote đều có version `20260813070319`; Security và Performance Advisors không có finding mức error.
- Room `gantt` đang ở `pilot`, chỉ còn `view/edit/delete`, PBAC fallback tắt. Active grants sau backfill: `view=33`, `edit=22`, `delete=3`.
- Dữ liệu sau rollout: 577 tasks, 3 completion history rows, không còn task dùng `completion_request`; không có fixture smoke tồn dư.
- Promotion `pilot` → `enforced`: chỉ tạo migration riêng sau business acceptance.

Hash artifact đã apply:

- Migration SHA-256: `958631db8a4b4ecf565ef6fa11143b2dd854e949cdeb02695736d608841f6e14` (61,421 bytes).
- Smoke SHA-256: `75cedc181c06b12a99164bbb10935434697641ab1dbdf8bcc8f62bd71a4d5408` (30,304 bytes).

## Snapshot Cloud trước cutover

Snapshot đọc lại sau rollback smoke ngày 2026-08-13:

- Room actions: `view,edit,delete,submit,verify,approve`.
- Sáu binding đều `audit_only`, `pbac_fallback_enabled=true`.
- Active Room grants: 31, đều có source `manual_room`.
- Grant theo action: `view=23`, `edit=3`, `delete=1`, `submit=2`, `verify=1`, `approve=1`.
- Completion history: 3 rows.
- `project_tasks.row_version`: chưa tồn tại.
- Gantt public RPC và `app_private.project_gantt_command_requests`: chưa tồn tại.
- Completion table có restrictive active-actor gate và bốn permissive CRUD policies; `authenticated` có `SELECT/INSERT/UPDATE/DELETE`.

Cloud được xác minh không còn fixture `gantt-smoke-*`, `gantt-matrix-*`, RPC, ledger hoặc schema của migration sau smoke rollback.

## Chụp snapshot ngay trước lần push thật

Tạo thư mục artifact ngoài source control và lưu đầy đủ kết quả của các truy vấn sau. Không ghi connection string hoặc database password vào artifact.

```sql
select code, description, allowed_actions, required_actions, is_active, updated_at
from public.project_permission_rooms where code = 'gantt';

select *
from app_private.project_permission_room_action_bindings
where room_code = 'gantt'
order by action_code;

select member.*, action.*
from public.project_permission_room_members member
join public.project_permission_room_member_actions action
  on action.room_member_id = member.id
where member.room_code = 'gantt'
order by member.project_id, member.construction_site_id, member.id, action.action_code;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'project_tasks', 'project_baselines', 'project_delay_events',
    'project_schedule_revisions', 'project_schedule_revision_tasks',
    'task_contract_items', 'project_task_completion_requests'
  )
order by tablename, policyname;

select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and table_name in (
    'project_tasks', 'project_baselines', 'project_delay_events',
    'project_schedule_revisions', 'project_schedule_revision_tasks',
    'task_contract_items', 'project_task_completion_requests'
  )
order by table_name, grantee, privilege_type;

select n.nspname as schema_name, p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'app_private' and p.proname like '%project_gantt%')
   or (n.nspname = 'public' and p.proname like '%project_gantt%')
   or (n.nspname = 'app_private'
       and p.proname = 'project_actor_has_effective_room_action')
order by schema_name, p.proname, arguments;

select count(*) as completion_count
from public.project_task_completion_requests;

select count(*) as completion_mode_task_count
from public.project_tasks
where progress_mode = 'completion_request';
```

Chụp thêm hash/size của file migration, output `migration list --linked`, output dry-run và kết quả Security/Performance Advisors.

## Preflight bắt buộc

```bash
npm run lint
npm test -- --run
npm run build
npx --yes supabase@2.110.0 migration list --linked
npx --yes supabase@2.110.0 db push --linked --dry-run
```

Chạy migration cùng smoke trong transaction rollback bằng connection đã cấu hình trong `.env`:

```bash
set -a
source .env
set +a
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$(cat supabase/.temp/pooler-url)" \
  --set=ON_ERROR_STOP=1 --single-transaction \
  --file=supabase/migrations/20260813070319_gantt_room_authoritative_cutover.sql \
  --file=supabase/tests/gantt_room_authoritative_cutover_smoke.sql
```

Điều kiện dừng:

- Có WBS trùng hoặc grant PBAC mơ hồ.
- Bất kỳ test/lint/build/smoke nào đỏ.
- Dry-run còn yêu cầu `--include-all` hoặc lịch sử local/remote chưa được database owner xác nhận đã đồng bộ.
- Completion count thay đổi ngoài thay đổi nghiệp vụ đã được xác nhận.
- Có Security/Performance Advisor finding mới mức error/high.

## Apply và kiểm tra sau apply

Quy trình đã thực hiện ngày 2026-08-13 sau khi database owner duyệt apply riêng migration Gantt do lịch sử linked cũ không đồng bộ:

1. Chụp snapshot đầy đủ.
2. Apply file migration bằng `psql --single-transaction --set=ON_ERROR_STOP=1` trên Cloud connection đã cấu hình.
3. Ghi nhận riêng version `20260813070319` bằng `migration repair --linked --status applied`; không sửa version nào khác.
4. Chạy smoke lại trong `BEGIN/ROLLBACK`.
5. Chạy `migration list --linked` và xác nhận `20260813070319` có cả local/remote.
6. Chạy Security và Performance Advisors; so sánh snapshot trước/sau.
7. Kiểm tra completion count không đổi, ba binding vẫn ở `pilot`, PBAC fallback tắt.
8. Kiểm thử nghiệp vụ viewer/editor/deleter trên một project/site được chỉ định.

## Rollback

Nếu có sự cố sau push:

1. Dừng rollout frontend và triển khai lại frontend ở commit trước cutover.
2. Revoke `EXECUTE` của sáu public command RPC và catalog khỏi `authenticated` để dừng ghi mới trong lúc đánh giá.
3. Tạo **migration forward rollback riêng**, không sửa migration đã apply và không drop dữ liệu lịch sử.
4. Migration rollback phải khôi phục chính xác từ snapshot:
   - Room registry, sáu binding và PBAC fallback cũ.
   - Toàn bộ Room grants, bao gồm `submit/verify/approve`, cùng `grant_source` cũ.
   - Policies và table grants cũ của Gantt/completion.
   - Định nghĩa canonical của shared authorization helper trước cutover nếu cần.
5. Có thể giữ `updated_at`, `row_version`, ledger và RPC schema ở trạng thái bị revoke để tránh destructive rollback; không xóa completion rows, audit rows hoặc task data.
6. Chạy regression cũ, so sánh lại grant/policy/function/completion snapshots và xác nhận không có command đang dở.

Script `supabase/tests/gantt_room_pre_cutover_recovery.sql` chỉ dùng cho sự cố pre-cutover ngày 2026-08-13 đã xử lý; không dùng nó như rollback migration tổng quát.

## Promotion

Sau business acceptance, tạo migration mới tên `gantt_room_enforcement`, chỉ đổi ba binding `view/edit/delete` từ `pilot` sang `enforced`, rồi lặp lại preflight, rollback smoke, apply và advisors. Không sửa migration cutover đã apply.
