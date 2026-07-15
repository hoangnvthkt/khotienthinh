# 10. Canonical issue register

## Quy ước

- P0: nguy cơ compromise/data exposure hoặc corruption diện rộng; containment ngay sau live verification tối thiểu.
- P1: high impact, cần đưa vào kế hoạch gần nhất trước mở rộng tính năng.
- P2: medium risk/debt có tác động đo được hoặc làm suy yếu control.
- P3: low urgency, chủ yếu hygiene/documentation.
- Status chỉ dùng Confirmed, Suspected, Needs runtime verification.
- Mọi thay đổi được đề xuất dưới đây là roadmap; audit không triển khai.

## Tổng hợp

| Severity | Số lượng |
|---|---:|
| P0 | 2 |
| P1 | 26 |
| P2 | 16 |
| P3 | 1 |
| Tổng | 45 |

## Architecture

### ARC-001 — Global context và god files

- **ID:** ARC-001
- **Phạm vi:** Architecture/frontend state.
- **Mô tả:** Auth, permission và nhiều domain state/mutation bị gom trong AppContext; nhiều page/service quá lớn.
- **File/function/table/policy/query:** <code>context/AppContext.tsx</code>; <code>SupplyChainTab.tsx</code>; <code>types.ts</code>; <code>GanttTab.tsx</code>; <code>RequestModal.tsx</code>.
- **Bằng chứng:** AppContext 3.641 LOC, khoảng 55 state slices và provider value ở <code>3600-3627</code>; 108 consumer files. SupplyChainTab 8.765 LOC, types 6.230, Gantt 4.545, RequestModal 4.201.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Render fan-out, blast radius lớn, khó review/test và thay đổi một module mà không ảnh hưởng module khác.
- **Đề xuất:** Tách Auth/ReferenceData/feature stores và feature folders tăng dần; selector-based subscriptions; không big-bang rewrite.
- **Rủi ro khi xử lý:** High vì di chuyển state có thể gây regression cross-module.
- **Công sức:** XL.
- **Kiểm chứng sau sửa:** React Profiler, dependency boundary tests và regression suite cho từng slice được tách.

### ARC-002 — UI/data/domain boundaries bị xuyên

- **ID:** ARC-002
- **Phạm vi:** Architecture/data access.
- **Mô tả:** UI, contexts và services đều gọi Supabase trực tiếp; business orchestration không có boundary thống nhất.
- **File/function/table/policy/query:** 129 files import Supabase; khoảng 41 UI files gọi <code>.from()</code>; ví dụ <code>SafetyTab.tsx:277-324</code>.
- **Bằng chứng:** Static scan tìm 681 from calls và 107 RPC calls; SafetyTab tự update/insert/delete child rows; <code>erpWorkflow.ts</code>/<code>safetyWorkflow.ts</code> còn import type từ component.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Error/auth/transaction behavior không đồng nhất; direct paths dễ bypass state machine.
- **Đề xuất:** Feature data-access layer, typed query/command interfaces, lint dependency boundaries; UI không gọi database trực tiếp cho business commands.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Boundary lint fail khi UI import Supabase; command contract/integration tests pass.

### ARC-003 — Repository contract và tài liệu khởi động bị stale

- **ID:** ARC-003
- **Phạm vi:** Architecture documentation/onboarding.
- **Mô tả:** README vẫn mô tả backend/database giả lập và roadmap MVP; không có env example hay reproducible Supabase config.
- **File/function/table/policy/query:** <code>README.md:15-37</code>; <code>package.json</code>; thiếu <code>.env.example</code> và <code>supabase/config.toml</code>.
- **Bằng chứng:** Repository thực tế có 234 migrations, Edge Functions, Auth/RLS/Storage/Realtime nhưng README nói backend/database giả lập.
- **Trạng thái:** Confirmed.
- **Severity:** P3.
- **Tác động kỹ thuật/nghiệp vụ:** Onboarding và vận hành sai, dễ chạy nhầm linked smoke/direct migration.
- **Đề xuất:** Cập nhật system/runbook/env contract, safe local startup và ownership; không ghi secret.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** S.
- **Kiểm chứng sau sửa:** Một developer mới dựng app/local DB theo docs mà không cần thông tin ngoài.

## Frontend

### FE-001 — Auth/profile bootstrap không fail closed

- **ID:** FE-001
- **Phạm vi:** Frontend authentication/authorization.
- **Mô tả:** AppProvider khởi tạo cached user hoặc MOCK_USERS[0] ADMIN; profile thiếu/inactive/error không clear identity và bootstrap vẫn kết thúc.
- **File/function/table/policy/query:** <code>AppContext.tsx:448-456,643-709</code>; <code>constants.ts:4-43</code>; <code>App.tsx:134-185</code>.
- **Bằng chứng:** ProtectedRoute xác minh Auth user nhưng không bắt active app profile; currentProfile null không reset user; mock credentials gồm admin/password 123 ở mock mode.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** UI/actions có thể chạy bằng profile cache/mock sai; kết hợp legacy/broad RLS làm tăng quyền thực tế.
- **Đề xuất:** Một AuthGate fail-closed chờ session + active profile + grants; production configured mode không fallback mock; clear/sign-out khi thiếu/inactive.
- **Rủi ro khi xử lý:** Medium vì user profile cũ/unlinked có thể bị chặn.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Auth user không profile, inactive profile, stale localStorage và missing env scenarios đều deny đúng.

### FE-002 — Data errors bị swallow hoặc biến thành empty state

- **ID:** FE-002
- **Phạm vi:** Frontend resilience/error UX.
- **Mô tả:** Loader/service có nơi không catch, console-only hoặc trả empty/null mà UI hiểu là thành công/không có dữ liệu.
- **File/function/table/policy/query:** <code>hooks/useModuleData.ts:9-14</code>; <code>AppContext.tsx:627-640,1352-1357</code>; Contract/Documents tabs.
- **Bằng chứng:** FetchTable trả null sau error; module hook không catch; Documents list không có error state.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** 403/offline/500 bị hiểu là dữ liệu rỗng; support và recovery khó.
- **Đề xuất:** Chuẩn hóa typed result data/status/error/retry/correlation; không silent empty cho dữ liệu nghiệp vụ.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Fault matrix 403/500/timeout/offline cho mỗi critical screen hiển thị lỗi và retry đúng.

### FE-003 — Realtime route map và cleanup lifecycle không đầy đủ

- **ID:** FE-003
- **Phạm vi:** Frontend Realtime/data freshness.
- **Mô tả:** Declarative map chỉ phủ admin/wms/hrm; route DA/EX/TS có thể stale hoặc giữ channel cũ.
- **File/function/table/policy/query:** <code>AppContext.tsx:140-147,578-592,946-954</code>; <code>App.tsx:341-380</code>.
- **Bằng chứng:** Module table map thiếu DA/EX/TS và route transition không luôn reset active modules.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Dữ liệu tài chính/expense/timesheet stale; connection/event overhead không cần thiết.
- **Đề xuất:** Route/feature → scoped channel map, deterministic cleanup và cache-key update.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Inspect channels sau route loops và cross-session update latency per domain.

## Performance

### PERF-001 — Module-wide unbounded select star

- **ID:** PERF-001
- **Phạm vi:** Frontend/network/database performance.
- **Mô tả:** Một screen tải nhiều bảng/full rows/full columns, ít pagination và thiếu project/year/filter scope.
- **File/function/table/policy/query:** <code>BudgetDashboard.tsx:26-34</code>; <code>AppContext.tsx:1062-1263,1331-1348</code>; khoảng 493–495 select-star; 29 range calls.
- **Bằng chứng:** Expense warm EX + HRM + WMS, khoảng 35 tables; HRM/WMS loaders chủ yếu select star.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Latency, mobile memory và Supabase egress tăng theo lịch sử toàn công ty; không scale theo tenant.
- **Đề xuất:** Screen query projection, pagination, scoped cache keys và server aggregates.
- **Rủi ro khi xử lý:** Medium do hidden consumers có thể phụ thuộc full object.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** HAR rows/bytes/TTFB và UI regression trên production-like volume.

### PERF-002 — Feature/vendor chunks lớn

- **ID:** PERF-002
- **Phạm vi:** Frontend bundle/loading.
- **Mô tả:** Route splitting có nhưng several shared/feature chunks vẫn lớn; inactive subtabs/heavy libraries được kéo sớm.
- **File/function/table/policy/query:** <code>vite.config.ts:22-54</code>; App lazy routes; ProjectFinanceWorkspace static subtab imports.
- **Bằng chứng:** Fresh build: three 958,68 kB raw, index 593,81, ScannerModal 448,94, xlsx 429,53, charts 428,16; Vite warning trên 500 kB.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Cold route parse/CPU/data cost cao trên mobile.
- **Đề xuất:** Lazy subtab/action/modal/library và CI budgets theo route.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Bundle visualizer, cold Lighthouse và feature smoke after dynamic imports.

### PERF-003 — Coarse invalidation và search request storms

- **ID:** PERF-003
- **Phạm vi:** Network/cache.
- **Mô tả:** Single mutation force reload toàn HRM; search gọi query theo từng ký tự không debounce/cancel.
- **File/function/table/policy/query:** <code>Attendance.tsx:707-720</code>; <code>CheckIn.tsx:320-338</code>; Payment/Project/Safety search paths.
- **Bằng chứng:** HRM reload khoảng 21 tables; payment service chạy bốn full queries per search.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Burst egress/latency; stale response có thể ghi đè search mới.
- **Đề xuất:** Entity/cache-key invalidation, optimistic patch + background reconcile, debounce 250–400 ms và AbortController/sequence guard.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Slow-3G rapid typing and request-count comparison after mutation.

### PERF-004 — Safety KPI cap và signed-URL N+1

- **ID:** PERF-004
- **Phạm vi:** Safety correctness/performance.
- **Mô tả:** KPI tính từ capped lists như toàn bộ dữ liệu; attachment hydration tạo signed URL từng object.
- **File/function/table/policy/query:** <code>lib/safetyService.ts:53-75,217-282,333-376</code>.
- **Bằng chứng:** Limits 250/100 nhưng counts/score tính trên returned set; per-attachment URL requests.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Dashboard safety sai khi vượt cap, có thể ảnh hưởng compliance; request N+1.
- **Đề xuất:** Aggregate RPC/count không cap, paginated details và lazy/batch URLs cho visible items.
- **Rủi ro khi xử lý:** Medium vì công thức KPI cần owner xác nhận.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Seed >250 issues/>100 inspections, đối chiếu SQL truth và URL request count.

## Database and migration

### DB-001 — Migration history/schema drift

- **ID:** DB-001
- **Phạm vi:** Supabase migrations/release integrity.
- **Mô tả:** Local/remote history diverged, direct applies/manual repairs và duplicate/noncanonical versions.
- **File/function/table/policy/query:** <code>supabase/baseline/2026-05-21/README.md:27-33</code>; Phase0–2 live logs; HANDOFF; six <code>20260531</code> files.
- **Bằng chứng:** Baseline records local-only 30, remote-only 140, match 17; direct query apply/history unreconciled; 9 eight-digit versions.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Không chứng minh được deployed policy, rebuild hay rollback; security fix có thể chỉ tồn tại ở source.
- **Đề xuất:** Freeze unsafe db push, capture restore-grade snapshot, canonical baseline/checksum map, clean replay/schema diff.
- **Rủi ro khi xử lý:** High; history repair sai có thể bỏ/chạy lại migration.
- **Công sức:** XL.
- **Kiểm chứng sau sửa:** Empty DB replay + linked migration checksum + schema diff zero.

### DB-002 — Local DB/restore baseline không reproducible

- **ID:** DB-002
- **Phạm vi:** Database testing/disaster recovery.
- **Mô tả:** Không có Supabase config/local stack contract và baseline không restore-grade.
- **File/function/table/policy/query:** Thiếu <code>supabase/config.toml</code>; baseline README; local CLI status/db lint/migration list.
- **Bằng chứng:** Docker daemon unavailable; all local DB commands fail connect; repo docs nói pg_dump mismatch/no restore-grade dump.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Không chạy SQL/RLS tests, migration rehearsal hay restore drill trước production.
- **Đề xuất:** Version local config, compatible toolchain, masked restore baseline và one-command reset/verify.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Fresh workstation reset, migrations, seed và SQL suite pass.

### DB-003 — SECURITY DEFINER search_path chưa hardened đồng nhất

- **ID:** DB-003
- **Phạm vi:** Postgres function security.
- **Mô tả:** Nhiều functions, nhất là AI tools, set search_path public thay vì empty + qualified names.
- **File/function/table/policy/query:** <code>20260531_ai_tool_rpc_functions.sql</code>; <code>20260603173000_ai_employee_search_tool.sql</code>; selected workflow RPCs.
- **Bằng chứng:** 13 AI tool functions are SECURITY DEFINER with <code>set search_path = public</code>.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Object shadowing risk nếu CREATE privilege/ownership bị nới; làm suy yếu defense in depth.
- **Đề xuất:** Live ACL check, set empty path and fully qualify every object in staged migration.
- **Rủi ro khi xử lý:** Medium vì missed qualification sẽ làm function fail.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Function tests, pg_proc search path audit và no unqualified relation references.

### DB-004 — Business code dùng exact count + 1

- **ID:** DB-004
- **Phạm vi:** Data integrity/concurrency.
- **Mô tả:** Quality/Safety code generation dựa trên exact row count rồi cộng một.
- **File/function/table/policy/query:** <code>qualityChecklistService.ts:133-140,355,423</code>; <code>safetyService.ts:139-146,385,534</code>.
- **Bằng chứng:** Hai concurrent creates có thể nhận cùng code; exact count cost tăng theo table.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Duplicate code hoặc random insert failure cho compliance records.
- **Đề xuất:** DB sequence/counter RPC + unique constraint + conflict retry.
- **Rủi ro khi xử lý:** Medium vì format/migration existing duplicates.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** 20 concurrent creates unique/monotonic theo business rule.

### DB-005 — Permission readiness/health có thể false-pass

- **ID:** DB-005
- **Phạm vi:** Authorization validation.
- **Mô tả:** Smoke/health coi domain enforced dựa vào text match và chỉ nhận diện exact true policies.
- **File/function/table/policy/query:** <code>supabase/tests/phase5_readiness_smoke.sql:11-90</code>; <code>20260713033241_phase5_legacy_permission_projection.sql:401-615</code>.
- **Bằng chứng:** Bất kỳ policy/function chứa domain string có thể pass; không audit combined policies, storage, views, grants hay non-public schemas.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Cutover báo ready trong khi bypass vẫn tồn tại.
- **Đề xuất:** Expected table × operation × persona × scope matrix; inspect pg_proc/grants/views/storage.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Inject a known broad policy in isolated DB and ensure readiness fails.

## Security

### SEC-001 — Authenticated arbitrary dynamic SQL under SECURITY DEFINER

- **ID:** SEC-001
- **Phạm vi:** Postgres/RPC/RLS bypass.
- **Mô tả:** Hai RPC nhận arbitrary SELECT/WITH text và dynamic EXECUTE as definer, được grant authenticated.
- **File/function/table/policy/query:** <code>20260428090000_harden_workflows_assets_wms.sql:840-868</code>; <code>20260428091000_restrict_rpc_execute.sql:42-59</code>; baseline <code>:36531-36549</code>; functions <code>execute_readonly_query</code>, <code>execute_ai_query</code>.
- **Bằng chứng:** Source grants authenticated, no later revoke; May-21 cloud snapshot captures SECURITY DEFINER dynamic EXECUTE. Readonly blacklist uses PostgreSQL-inappropriate <code>\b</code>.
- **Trạng thái:** Confirmed.
- **Severity:** P0.
- **Tác động kỹ thuật/nghiệp vụ:** Normal JWT có thể bypass all RLS để exfiltrate sensitive data; side-effect/DoS/integrity paths are plausible depending owner privileges.
- **Đề xuất:** Immediate live ACL verification then revoke from authenticated/anon/PUBLIC, preferably drop; review access logs and rotate reachable secrets if indicated.
- **Rủi ro khi xử lý:** Low technical, Medium operational nếu unknown client còn gọi.
- **Công sức:** S.
- **Kiểm chứng sau sửa:** Ordinary JWT RPC returns 403; pg_proc proacl has no public/anon/authenticated; destructive payload tests only on clone.

### SEC-002 — HR/payroll PII exposed to anon and anonymous writes

- **ID:** SEC-002
- **Phạm vi:** HRM/RLS/privacy.
- **Mô tả:** May-21 cloud baseline shows public true SELECT for HR PII and anon full-write on several HR/payroll tables; no complete later hardening found.
- **File/function/table/policy/query:** baseline policies/grants for <code>employees</code>, <code>hrm_labor_contracts</code>, <code>hrm_documents</code>, <code>hrm_leave_logs</code>, <code>kpi_scores</code>, <code>salary_grades</code>, <code>salary_3p_settings</code>.
- **Bằng chứng:** employees_select/contracts_select true for PUBLIC; hrm_documents ALL true; leave_logs anon/authenticated CRUD true; anon table grants. June changes only employee writes/attendance.
- **Trạng thái:** Confirmed.
- **Severity:** P0.
- **Tác động kỹ thuật/nghiệp vụ:** Privacy breach, salary/leave/document exposure and anonymous integrity tampering.
- **Đề xuất:** Urgent live catalog/safe anon verification; revoke anon HR, self/manager/HR policies by column/scope, append-only audit, incident log review.
- **Rủi ro khi xử lý:** High vì current HR workflows có thể dựa vào broad reads.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Persona × table × operation × sensitive-column matrix; anon all denied.

### SEC-003 — Contract surfaces globally readable/mutable

- **ID:** SEC-003
- **Phạm vi:** Contract/finance authorization.
- **Mô tả:** Contract headers, resources, appendices, cost/catalog/norm tables retain true policies for authenticated.
- **File/function/table/policy/query:** <code>20260428090000...:90-108</code>; <code>20260518044750...:263-287</code>; <code>20260518082904...:24-33</code>; <code>20260518072838...:83-114</code>.
- **Bằng chứng:** SELECT true headers and ALL true write surfaces; Phase4 seeds contract actions but no table enforcement.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Employee thường có thể read/tamper BOQ, unit rates, norms and appendices across contracts.
- **Đề xuất:** Contract view/manage permissions + company/project/contract scope, audit and optimistic versioning.
- **Rủi ro khi xử lý:** High.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Ordinary JWT mutation denied; cross-project reads denied; authorized workflows pass.

### SEC-004 — AI service-role confused deputy

- **ID:** SEC-004
- **Phạm vi:** AI/Edge authorization/data exposure.
- **Mô tả:** AI-only permission can invoke unlisted domain tools that run service-role RPC without actor/scope.
- **File/function/table/policy/query:** <code>ai-assistant/index.ts:91-97,416-437,507-540,636-664,774-790,1923-2158</code>; AI tool SQL; employee search SQL.
- **Bằng chứng:** TOOL_ACCESS covers only four cost tools and defaults allow; RPC returns HR PII, finance, WMS, project and attendance.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** AI user can exfiltrate cross-domain/cross-project data bypassing caller RLS.
- **Đề xuất:** Deny-by-default tool registry, permission + resource scope per tool; bind auth.uid or run under user JWT; kb.view for knowledge.
- **Rủi ro khi xử lý:** Medium; current AI answers may narrow.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Negative role/project/warehouse/department matrix and direct ID tests.

### SEC-005 — Auth trigger trusts user metadata for role/permissions

- **ID:** SEC-005
- **Phạm vi:** Supabase Auth/profile provisioning.
- **Mô tả:** Baseline sync function accepts ADMIN and permission arrays from raw_user_meta_data.
- **File/function/table/policy/query:** <code>sync_auth_user_profile()</code> in baseline <code>cloud_public_schema_inventory.pretty.json:37348-37350</code>; Auth trigger/signup settings.
- **Bằng chứng:** Function is SECURITY DEFINER and writes role/permission arrays; no later redefinition found. Trigger binding/public signup are unavailable.
- **Trạng thái:** Needs runtime verification.
- **Severity:** P1; escalates to P0 if public signup and trigger are active.
- **Tác động kỹ thuật/nghiệp vụ:** Crafted signup metadata could create ADMIN/profile grants.
- **Đề xuất:** Default EMPLOYEE only; never source authorization from user_metadata; audited admin grant command.
- **Rủi ro khi xử lý:** Medium for existing provisioning integration.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Inspect trigger/signup; isolated crafted signup remains employee with no grants.

### SEC-006 — Inactive admin sessions retain privileged Edge actions

- **ID:** SEC-006
- **Phạm vi:** Edge user administration/session revocation.
- **Mô tả:** create-user/reset-password check role but not app profile is_active.
- **File/function/table/policy/query:** <code>create-user/index.ts:27-99</code>; <code>reset-password/index.ts:27-101</code>; comparison <code>send-web-push/index.ts:58-73</code>.
- **Bằng chứng:** User select excludes is_active; valid inactive ADMIN JWT reaches service-role create/reset.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Offboarded/compromised admin can create privileged users or reset other accounts until JWT revoked/expires.
- **Đề xuất:** Active check, session revocation on deactivate and recent-auth step for sensitive actions.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** S.
- **Kiểm chứng sau sửa:** Deactivated/revoked admin JWT receives 401/403; active admin still works.

### SEC-007 — AI special actions accept body actor identity

- **ID:** SEC-007
- **Phạm vi:** AI Edge authentication.
- **Mô tả:** Special actions resolve actor from request body userId if JWT actor resolution fails.
- **File/function/table/policy/query:** <code>ai-assistant/index.ts:451-477,599-633,1888-1914</code>.
- **Bằng chứng:** source body actor is populated from users table then role/modules trusted; no requireJwtActor in these branches.
- **Trạng thái:** Needs runtime verification.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** If Edge gateway permits request, caller can impersonate privileged user, consume AI and misattribute audit.
- **Đề xuất:** JWT actor mandatory for every action; remove body identity authority.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** S.
- **Kiểm chứng sau sửa:** No-JWT/anon/invalid JWT with admin userId all denied; inspect deployed verify_jwt.

### SEC-008 — Legacy fallback and project scoping remain broad

- **ID:** SEC-008
- **Phạm vi:** Permission migration/project RLS.
- **Mô tả:** Legacy fallback defaults enabled; frontend always falls back; project SELECT accepts DA module access without membership.
- **File/function/table/policy/query:** <code>permissionService.ts:34-37,151-223</code>; <code>AppContext.tsx:88-107</code>; Phase5 <code>:18-267</code>; Phase0 can_access_module; Phase3 project policies <code>:1020-1048</code>.
- **Bằng chứng:** allowedModules undefined can view; grant errors become []; DA legacy branch remains outside cutoff.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Cross-project visibility and UI/backend split-brain during cutover.
- **Đề xuất:** Membership/scoped grants first; deny null; every legacy helper honors explicit cutoff; client consumes rollout/error state.
- **Rủi ro khi xử lý:** High because legitimate legacy users may lose access.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Role × project/site matrix before/after flag with negative direct REST tests.

### SEC-009 — Storage policies allow cross-scope access or mutable evidence

- **ID:** SEC-009
- **Phạm vi:** Supabase Storage.
- **Mô tả:** Several bucket policies check only authenticated/bucket, not parent resource/user/project.
- **File/function/table/policy/query:** workflow attachments <code>20260428111500...:3-32</code>; check-in photos <code>20260622014021...:1-37</code>; contract files <code>20260710023735...:1-45</code>.
- **Bằng chứng:** Authenticated CRUD entire workflow bucket; public-read checkin bucket and authenticated overwrite/delete; all authenticated contract-file read.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Cross-workflow/employee/contract disclosure and tampering with attendance evidence.
- **Đề xuất:** Resource-keyed object paths, parent-row policy joins, immutable check-in evidence, retention/audit.
- **Rủi ro khi xử lý:** Medium; existing object names may require migration.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Cross-user/resource read/upload/overwrite/delete persona tests.

### SEC-010 — Vulnerable production dependencies on user-controlled paths

- **ID:** SEC-010
- **Phạm vi:** Supply chain/input processing/routing.
- **Mô tả:** Production audit reports xlsx, React Router, xmldom and transitive vulnerabilities; xlsx parses uploads directly.
- **File/function/table/policy/query:** <code>package.json:16-35</code>; XLSX.read callsites in Gantt/Material/Project/Attendance/Workflow/Assets/services; notification navigation; document templating.
- **Bằng chứng:** npm audit omit-dev: 1 critical, 7 high, 1 moderate. Xlsx 0.18.5 has no patched npm version in advisories; router 6.22.3 has fixed upgrade path.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Malicious spreadsheet/XML/redirect can cause ReDoS, prototype/XML injection, redirect/XSS or availability issues.
- **Đề xuất:** Contain file size/type/magic/zip bombs, isolate parsing, evaluate maintained replacement; targeted router/XML upgrades with compatibility tests.
- **Rủi ro khi xử lý:** Medium due export/import/template behavior.
- **Công sức:** M/L.
- **Kiểm chứng sau sửa:** Malicious corpus, CPU/memory limits, redirect tests and full import/export/template regression.

### SEC-011 — users directory and username-to-email oracle

- **ID:** SEC-011
- **Phạm vi:** User privacy/auth enumeration.
- **Mô tả:** All authenticated can select full users rows; anon RPC maps username to email.
- **File/function/table/policy/query:** <code>20260516135817_harden_user_crud_auth.sql:106-152</code>; AppContext all-users select <code>681-692</code>.
- **Bằng chứng:** users_select USING true; columns include email/phone/auth_id/role/warehouse/permission arrays; lookup_login_email granted anon.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** PII/authorization map disclosure and account enumeration.
- **Đề xuất:** Safe directory view with minimal columns/on-demand pagination; self/admin sensitive fields; opaque login lookup.
- **Rủi ro khi xử lý:** Medium due directory/UI dependencies.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Employee cannot query auth_id/permission arrays/phone unless authorized; login errors remain non-enumerating.

### SEC-012 — Permission projection function lacks caller authorization

- **ID:** SEC-012
- **Phạm vi:** Postgres permission administration.
- **Mô tả:** SECURITY DEFINER projection accepts arbitrary target UUID and is granted authenticated.
- **File/function/table/policy/query:** <code>20260713033241_phase5_legacy_permission_projection.sql:50-176</code>; <code>app_private.sync_legacy_permission_projection</code>.
- **Bằng chứng:** No can_manage_permissions check; exploitation through API depends whether app_private is exposed.
- **Trạng thái:** Needs runtime verification.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** If exposed/callable, employee can mutate another user's legacy permission projection.
- **Đề xuất:** Revoke authenticated; private internal call only or enforce permission/admin actor.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** S.
- **Kiểm chứng sau sửa:** Inspect exposed schemas/proacl; employee RPC denied, authorized projection path works.

### SEC-013 — Stored XSS in print popups

- **ID:** SEC-013
- **Phạm vi:** Frontend XSS.
- **Mô tả:** Stored material/item/batch/note values are interpolated into same-origin document.write without escaping.
- **File/function/table/policy/query:** <code>RequestModal.tsx:2155-2206,2221-2227</code>; <code>InventoryDetailModal.tsx:253-260</code>.
- **Bằng chứng:** Direct HTML template interpolation; popup opened about:blank without noopener; no escapeHtml in these paths.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Malicious stored value executes when another user prints, potentially accessing opener/session context.
- **Đề xuất:** Build DOM with textContent or escape every value; isolate popup/noopener and add CSP where feasible.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** S.
- **Kiểm chứng sau sửa:** Stored img/svg/script/event-handler payloads render as text and cannot access opener.

## Workflow and data integrity

### WF-001 — WMS truncates decimal quantities

- **ID:** WF-001
- **Phạm vi:** WMS stock integrity.
- **Mô tả:** Latest transaction-status RPC casts numeric quantities to integer during availability check and stock mutation.
- **File/function/table/policy/query:** <code>20260713005814_phase4_erp_permission_surface.sql:737,849,948</code>; <code>process_transaction_status</code>; earlier decimal migration <code>20260602085356</code>.
- **Bằng chứng:** <code>v_qty integer</code> and explicit numeric-to-integer casts replaced prior numeric implementation.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** 0.25/1.75 kg, m³, m quantities can be truncated in source/target stock and reservations, corrupting inventory.
- **Đề xuất:** Numeric end-to-end with unit precision policy; regression migration and ledger reconciliation.
- **Rủi ro khi xử lý:** Medium because existing stock may already contain drift.
- **Công sức:** S for code, M for reconciliation.
- **Kiểm chứng sau sửa:** Decimal import/export/transfer/adjustment preserves exact source, target, balance and ledger values.

### WF-002 — Stock commit and fulfillment/PO/MR sync are not atomic

- **ID:** WF-002
- **Phạm vi:** WMS/material fulfillment.
- **Mô tả:** Stock/status commits in one RPC; client then invokes separate receipt synchronization.
- **File/function/table/policy/query:** <code>process_transaction_status</code> <code>:943-972</code>; <code>AppContext.tsx:2093-2097</code>; <code>20260703153147_sync_po_delivery_and_mr_receipt_status.sql:235-454</code>.
- **Bằng chứng:** RPC success precedes network call that updates batch, PO, schedule and MR.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Stock can be complete while PO/MR/batch remains stale after network/permission/function failure.
- **Đề xuất:** One orchestration transaction or durable idempotent outbox/reconciliation worker.
- **Rủi ro khi xử lý:** High due multi-domain ownership and double-apply risk.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Failure injection at every step; retry converges without double stock/receipt.

### WF-003 — Material Request/PO transitions have direct bypasses or incomplete state matrix

- **ID:** WF-003
- **Phạm vi:** MR and PO workflow.
- **Mô tả:** Legacy request updates bypass RPC; RPCs often authorize by target state but do not fully validate from-state/handler.
- **File/function/table/policy/query:** <code>AppContext.tsx:2733-2748</code>; <code>20260712145251_phase3_material_namespace.sql:294-402,649-673,808-922</code>; latest PO guard.
- **Bằng chứng:** requests lacks equivalent direct-status guard; approve/return/confirm accepts target/patch broadly; PO transition writes target without full from→to matrix. Receipt sync may conflict with guard context.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Valid handler can skip/reverse steps or leave status/workflow_step inconsistent; receipts can partially finish.
- **Đề xuất:** One guarded RPC per aggregate, explicit transition table, assigned-handler check and optimistic version.
- **Rủi ro khi xử lý:** High because multiple legacy callsites.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Exhaustive from→to/persona negative tests and direct PostgREST update denial.

### WF-004 — Supplier delivery/site purchase to WMS can partially commit

- **ID:** WF-004
- **Phạm vi:** Procurement/delivery/WMS integration.
- **Mô tả:** Business record or WMS transaction is created before separate draft/link updates; multi-warehouse loop commits one at a time.
- **File/function/table/policy/query:** <code>supplierDeliveryStatementService.ts:317-459</code>; <code>SupplyChainTab.tsx:1418-1435</code>; <code>siteDirectPurchaseService.ts:321-379</code>.
- **Bằng chứng:** Code explicitly throws partial error after statement recorded but WMS draft failed; each warehouse insert then delivery-line update; direct purchase insert then link.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Recorded delivery/purchase can lack WMS provenance or only some warehouses; manual reconciliation required.
- **Đề xuất:** Transactional command or deterministic idempotency key + retry/reconciliation queue.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Fail each warehouse/link step; aggregate rolls back or retry creates exactly one complete result.

### WF-005 — Daily Log parent/detail replacement can lose partial data

- **ID:** WF-005
- **Phạm vi:** Daily Log integrity.
- **Mô tả:** Parent upsert precedes four parallel delete-then-insert child replacements.
- **File/function/table/policy/query:** <code>projectService.ts:325-357</code>; <code>dailyLogDetailService.ts:50-101</code>; daily_log_volumes/materials/labor/machines.
- **Bằng chứng:** Each child table deletes existing rows before insert, with no shared DB transaction; read failure returns empty details.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** A Daily Log can show new header but missing/mixed quantities, labor, materials or machines.
- **Đề xuất:** RPC transaction replaces parent/all details with version/idempotency; avoid delete-first without rollback.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Inject failure per child table and assert full rollback/version unchanged.

### WF-006 — Payment status and accounting side effects are split

- **ID:** WF-006
- **Phạm vi:** Payment/finance integrity.
- **Mô tả:** Certificate/schedule status is updated before recovery, BOQ lock and cash transaction operations; state matrix is incomplete.
- **File/function/table/policy/query:** <code>paymentCertificateService.ts:385-573</code>; <code>projectService.ts:1350-1413</code>.
- **Bằng chứng:** Direct status update at 449-478 then later side effects 514-573; paid schedule upsert can precede transaction creation.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** “Approved/paid” record may lack accounting posting/recovery/lock; financial reports and audit trail diverge.
- **Đề xuất:** Transactional payment posting RPC with from/to matrix, idempotency, ledger entries and explicit reversal.
- **Rủi ro khi xử lý:** High; financial migration/reconciliation.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Failure injection, double-submit and reversal tests reconcile certificate, schedule, cash and BOQ.

### WF-007 — Contract variation can be approved without submitted/approve authority

- **ID:** WF-007
- **Phạm vi:** Contract variation/BOQ workflow.
- **Mô tả:** Approval RPC applies BOQ from nonterminal state without requiring submitted or namespaced approve permission/current handler.
- **File/function/table/policy/query:** <code>20260518044750_contract_boq_workspace.sql:136-235</code>; <code>approve_contract_variation</code>; project document update predicates.
- **Bằng chứng:** Function only excludes approved/cancelled; edit-capable caller can plausibly invoke approve from draft.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Unauthorized/unreviewed variation can alter contract BOQ and financial basis.
- **Đề xuất:** Require submitted from-state, locked row, session actor, scoped approve grant/current handler.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Edit-only user and draft state both denied; authorized submitted approval applies once.

### WF-008 — Quality frontend permission and backend state/actor rules diverge

- **ID:** WF-008
- **Phạm vi:** Quality workflow/authorization.
- **Mô tả:** UI uses project-scoped action, while observed table write policies use DA/SETTINGS module admin; service direct-updates statuses without full matrix.
- **File/function/table/policy/query:** <code>QualityTab.tsx:805-920</code>; <code>qualityChecklistService.ts:496-631</code>; Phase0 quality policies <code>:179-214</code>.
- **Bằng chứng:** Legitimate project approver can be denied by RLS, while module admin direct API can target status with limited preconditions.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Workflow stuck or unauthorized state jumps; quality evidence unreliable.
- **Đề xuất:** Project-scoped namespaced transition RPC and aligned table policies.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Project approver submit/return/approve matrix and cross-project negative tests.

### WF-009 — Safety writes/transitions are non-atomic and too broad

- **ID:** WF-009
- **Phạm vi:** Safety workflow/data integrity.
- **Mô tả:** Parent/checklist changes are client multi-step; assignee/legacy manage predicate can set arbitrary target status.
- **File/function/table/policy/query:** <code>SafetyTab.tsx:277-324</code>; <code>safetyService.ts:379-468,695-752</code>; <code>20260614154216_project_safety_mvp.sql:52-75</code>.
- **Bằng chứng:** Update/delete/insert sequences have no transaction; setIssueStatus lacks explicit current-state/action matrix.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Checklist loss and new→closed bypass can invalidate safety/compliance records.
- **Đề xuất:** Transactional safety aggregate RPC, distinct close/verify/reopen actions, reason and immutable audit.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Failure injection and assignee/verifier transition matrix, including reopen/reject reasons.

### WF-010 — Documents can report false success and are not reproducible

- **ID:** WF-010
- **Phạm vi:** Documents/Storage integrity.
- **Mô tả:** Upload/delete metadata and object operations are split; errors are ignored/null but UI may toast success; project-files migration was not found.
- **File/function/table/policy/query:** <code>documentService.ts:24-199</code>; <code>DocumentsTab.tsx:55-164</code>; project_documents/project-files.
- **Bằng chứng:** Upload returns null on failure; UI ignores each result; delete ignores Storage and DB errors; MIME allowlist not applied.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Missing/orphan compliance files and misleading user confirmation; fresh environment cannot prove module setup.
- **Đề xuất:** Typed per-file result, server validation, metadata tombstone/cleanup queue or command, migration for table/bucket/RLS.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Fail storage/metadata at each stage, fresh DB reset and cross-project file tests.

### WF-011 — Notification delivery lacks idempotency and durable retry

- **ID:** WF-011
- **Phạm vi:** Notifications/Web Push reliability.
- **Mô tả:** Fire-and-forget trigger and Edge delivery have no deterministic event/attempt uniqueness, retry worker or dead-letter.
- **File/function/table/policy/query:** <code>notificationService.ts:247-322</code>; <code>20260622141309_web_push_delivery_v1.sql:44-73</code>; <code>20260627150423...:30-79</code>; <code>send-web-push/index.ts:87-390</code>.
- **Bằng chứng:** No unique notification/subscription/channel key; trigger silently skips missing Vault secret; Edge sends before checking prior delivery.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Partial recipients, duplicate pushes and permanent failed notifications.
- **Đề xuất:** Transactional outbox, deterministic event key, unique attempts, exponential retry and dead-letter/alert.
- **Rủi ro khi xử lý:** Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Replay same insert/request sends at most once per subscription; transient failure retries then resolves/dead-letters.

### WF-012 — Daily Log normalized and legacy source models drift

- **ID:** WF-012
- **Phạm vi:** Daily Log parent/child reconciliation.
- **Mô tả:** Normalized contribution/summary-source services exist but active UI uses legacy daily_logs and JSON metadata/snapshots.
- **File/function/table/policy/query:** <code>projectService.ts:401-551</code>; <code>DailyLogTab.tsx:1336-1419</code>; daily_log_summary_sources/contribution tables.
- **Bằng chứng:** New service callsites are absent in active flow; selected source IDs/snapshots remain metadata-based.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Edit/return/resubmit can reconcile differently between two models and hide new member detail.
- **Đề xuất:** Choose canonical model, backfill/reconciliation report, phased cutover and remove fallback after observation.
- **Rủi ro khi xử lý:** High.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Deterministic source edit/return/resubmit/inclusion tests across a full KTT→CHT cycle.

## Testing, DevOps and observability

### OPS-001 — No automated CI/release quality gate

- **ID:** OPS-001
- **Phạm vi:** CI/CD.
- **Mô tả:** No CI config; npm scripts omit typecheck and linked smoke commands are unsafe for PR automation.
- **File/function/table/policy/query:** <code>package.json:6-14</code>; absent <code>.github/workflows</code>; absent Supabase config.
- **Bằng chứng:** No pipeline files; lint is tsc; smoke scripts use linked database.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Security/RLS/workflow/migration regressions can reach production despite unit tests passing.
- **Đề xuất:** CI install-lockfile, typecheck, ESLint, unit, build, ephemeral Supabase replay/lint/SQL tests, Playwright and staged promotion.
- **Rủi ro khi xử lý:** Low/Medium; initial pipeline may expose existing failures.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Deliberate type/test/RLS/migration/E2E failures each block PR/promotion.

### OPS-002 — RLS/RPC/Edge/E2E/failure tests are not automated

- **ID:** OPS-002
- **Phạm vi:** Test strategy.
- **Mô tả:** Unit tests mock backend; SQL scripts are not executed; no browser/Edge/concurrency/failure suite.
- **File/function/table/policy/query:** 66 Vitest files; <code>supabase/tests</code>; Playwright dependency without config/specs.
- **Bằng chứng:** 360 unit tests pass but 0 SQL smoke/E2E ran in audit; no local DB.
- **Trạng thái:** Confirmed.
- **Severity:** P1.
- **Tác động kỹ thuật/nghiệp vụ:** Tests do not prove actual RLS, transition, rollback, migration or cross-project security.
- **Đề xuất:** Persona negative integration tests, state matrices, failure/concurrency tests and critical browser flows on ephemeral DB.
- **Rủi ro khi xử lý:** Low.
- **Công sức:** L.
- **Kiểm chứng sau sửa:** Coverage matrix maps each P0/P1 control to an executable CI test.

### OPS-003 — Typecheck/lint/TypeScript quality contract is weak

- **ID:** OPS-003
- **Phạm vi:** Static quality.
- **Mô tả:** Required typecheck script is missing; lint is only tsc; tsconfig is non-strict and allows JS/skipLibCheck.
- **File/function/table/policy/query:** <code>package.json:6-14</code>; <code>tsconfig.json:1-42</code>.
- **Bằng chứng:** <code>npm run typecheck</code> fails missing script; lint passes as tsc; no ESLint/noUnused/strict.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Dead imports, unsafe types and boundary violations are not gated.
- **Đề xuất:** Explicit typecheck, ESLint/security/boundary rules and staged strictness by feature.
- **Rủi ro khi xử lý:** Medium due large existing warning backlog.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** CI commands distinct; staged strict projects pass and rules catch seeded violations.

### OPS-004 — Observability/health/audit failure handling is insufficient

- **ID:** OPS-004
- **Phạm vi:** Production operations/auditability.
- **Mô tả:** Errors/performance mostly console/localStorage; no centralized telemetry/correlation/SLO/health; audit insert can fail silently.
- **File/function/table/policy/query:** <code>lib/apiError.ts:18-20</code>; <code>lib/performanceTrace.ts:25-99</code>; <code>auditService.ts:396-419</code>.
- **Bằng chứng:** No external error sink or metrics config found; audit service does not consistently inspect returned error.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Partial failures/security events are hard to detect, attribute and reconcile.
- **Đề xuất:** Release-tagged telemetry, correlation IDs, RPC/workflow metrics, DB health and immutable critical audit.
- **Rủi ro khi xử lý:** Medium due privacy/log volume.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Forced browser/RPC/audit/push failures produce searchable event, metric and alert.

### OPS-005 — Staging/versioning/rollback/release flow is not codified

- **ID:** OPS-005
- **Phạm vi:** Release management/disaster recovery.
- **Mô tả:** No version/changelog/staging/UAT/rollback runbook; package remains 0.0.0 and migration changes were directly applied.
- **File/function/table/policy/query:** <code>package.json:4</code>; README; live-apply logs; absent CI/release config.
- **Bằng chứng:** No documented promotion or restore drill; handoff records manual history repair.
- **Trạng thái:** Confirmed.
- **Severity:** P2.
- **Tác động kỹ thuật/nghiệp vụ:** Slow incident recovery, uncertain code/schema pairing and high change risk.
- **Đề xuất:** Immutable release manifest commit+schema+flags, staging/UAT promotion, expand/contract and restore/rollback drills.
- **Rủi ro khi xử lý:** Low/Medium.
- **Công sức:** M.
- **Kiểm chứng sau sửa:** Rehearse one migration release and rollback/restore with measured RTO/RPO.
