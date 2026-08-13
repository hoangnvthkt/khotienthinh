# Authoritative Room Tiến độ — Implementation Plan

**Goal:** Chuyển Room `gantt` sang ba quyền authoritative `view`, `edit`, `delete`; mọi thao tác ghi đi qua RPC giao dịch trên Supabase Cloud; loại bỏ luồng phiếu hoàn thành khỏi runtime nhưng giữ nguyên dữ liệu lịch sử.

**Constraints:** Thực hiện bằng agent chính; không dùng Supabase local, Docker hoặc service-role ở frontend. Mỗi task theo vòng test đỏ → code tối thiểu → test xanh → commit riêng. Không tự sửa WBS trùng hoặc grant mơ hồ.

## Contract đã khóa

- Room `gantt` chỉ có `view`, `edit`, `delete`; `edit` và `delete` độc lập nhưng đều cần `view`; không có required recipient.
- Quyền cấp dự án áp dụng mọi công trường; quyền cấp công trường chỉ áp dụng đúng công trường.
- System Admin là operational override, không được tự thêm vào Room.
- `ProjectTask` có thêm `updatedAt`, `rowVersion`; bỏ `completion_request` khỏi progress mode nhưng giữ gate metadata lịch sử.
- Command trả `ok`, `requestId`, `replayed`, dữ liệu authoritative và mã lỗi ổn định: `GANTT_PERMISSION_DENIED`, `GANTT_SCOPE_MISMATCH`, `GANTT_STALE_VERSION`, `GANTT_DELETE_BLOCKED`.

## Task 1 — Khóa contract Room ba quyền

- Sửa registry `gantt` chỉ còn `view/edit/delete`, prerequisite của `edit/delete` là `view`.
- Thêm `GanttEffectiveCapabilities { canView, canEdit, canDelete }`, fail closed khi action chưa tải.
- Test chứng minh không còn `submit/verify/approve` và edit/delete độc lập.
- Verify focused Vitest và lint.
- Commit: `test: define three-action gantt room contract`.

## Task 2 — Migration lõi và backfill

- Tạo migration bằng `npx --yes supabase@2.110.0 migration new gantt_room_authoritative_cutover`.
- Atomic migration cập nhật registry/bindings sang `pilot`, tắt PBAC fallback, xóa grants `submit/verify/approve` nhưng giữ PBAC audit cũ.
- Backfill `view/edit` từ Gantt PBAC và legacy staff permission; `delete` chỉ từ legacy `delete`; tự thêm `view` cho edit/delete; giữ `manual_room`, đánh dấu `pbac_backfill`.
- Thêm `updated_at`, `row_version`, trigger version và bảng idempotency trong `app_private`.
- Chuyển progress mode `completion_request` hiện hữu sang `manual`, cập nhật constraint, revoke toàn bộ quyền authenticated/anon trên bảng phiếu hoàn thành.
- Contract test kiểm tra bindings, grants, trigger, constraint, provenance và không có permissive policy.
- Commit: `feat: define authoritative gantt room database contract`.

## Task 3 — RPC lưu và xóa hạng mục

- `save_project_gantt_tasks(uuid,text,text,jsonb)` nhận batch cùng `expected_row_version`, khóa ID tăng dần, kiểm tra scope/WBS/hierarchy/cycle/dependency/date/progress/assignee/watchers/mode và không cho sửa gate metadata.
- Lưu task và BOQ links cùng transaction khi có `contract_item_ids`.
- `delete_project_gantt_task_tree(uuid,text,text,text,bigint)` tự tính descendants và kiểm tra toàn bộ trước khi xóa.
- Chặn xóa nếu có completion history, daily/weekly progress, nhật ký khối lượng, delay event hoặc nghiệm thu; dọn BOQ links/dependency refs thuần kỹ thuật atomically.
- Test replay, request ID reuse sai payload, stale version, batch rollback và cross-scope.
- Commit: `feat: add authoritative gantt task commands`.

## Task 4 — Command phụ trợ, RLS và catalog

- Thêm `replace_project_gantt_task_contract_items`, `create_project_gantt_baseline`, `transition_project_gantt_delay_event`, `apply_project_gantt_forecast`; tất cả yêu cầu `gantt.edit`.
- Forecast khóa task/event theo thứ tự cố định, kiểm tra version và ghi toàn bộ transaction.
- SELECT policy tasks/baselines/delay events/revisions/links dùng `gantt.view`; revoke direct mutation authenticated và toàn bộ quyền anon.
- `get_project_gantt_catalog(text,text,text)` chỉ cho các consumer `daily_log`, `weekly_progress`, `material_planning`, `quantity_acceptance`, `quality`, `payment`; projection không trả notes, watchers, chi phí hoặc completion.
- Report/Executive/Portfolio không thuộc allowlist catalog.
- Commit: `feat: secure gantt supporting commands and reads`.

## Task 5 — Frontend command service

- Tạo `projectGanttCommandService`, tập trung snake/camel mapping và sinh `requestId` cho mỗi thao tác người dùng.
- API: `saveTasks`, `deleteTaskTree`, `replaceTaskContractItems`, `createBaseline`, `transitionDelayEvent`, `applyForecast`, `loadCatalog`.
- Parse lỗi DB sang tiếng Việt; giữ draft khi lỗi; chỉ reload khi stale version.
- Xóa direct-write methods cũ sau khi chuyển hết caller.
- Test payload/result, cache invalidation chỉ sau thành công và replay không mutation UI lần hai.
- Commit: `feat: add gantt command client`.

## Task 6 — Loại bỏ phiếu hoàn thành khỏi runtime

- Xóa service/type/component completion không còn consumer.
- Hoàn thành khi `progress >= 100`; không pending gate, gate blocking hoặc completion-derived progress.
- Giữ derivation từ Weekly Progress, Daily Log, nghiệm thu và child rollup.
- Cập nhật Gantt, Weekly Progress, Report, Dashboard metrics, Executive schedule và schedule projection.
- Test runtime không query completion table, không notification/deep-link/action queue hoặc nhãn gate.
- Commit: `refactor: retire task completion workflow runtime`.

## Task 7 — Cut over giao diện Gantt

- `GanttTab` tải quyền bằng `projectPermissionRoomService.listMyActions`.
- Không có view: không tải schedule, hiện no-access/retry. View-only: khóa/ẩn mutation.
- Edit bật create/edit/duplicate/import/drag/sandbox/baseline/delay/forecast/link; delete bật xóa độc lập.
- Thay loop REST mutation bằng command batch; dùng row version authoritative.
- Xóa state/handler/modal/badge/statistics completion/gate.
- Contract test cho capability, fail-closed loading và lỗi tiếng Việt.
- Commit: `feat: cut gantt workspace over to room commands`.

## Task 8 — Room phụ thuộc dùng catalog tối thiểu

- Daily Log, Weekly Progress, Material Planning, Quality, Quantity Acceptance và Payment dùng `loadCatalog`; adapter hard-code consumer Room.
- Gantt/Report tiếp tục direct RLS read; Dashboard/Portfolio chỉ thấy task theo `gantt.view`.
- Regression weekly/daily/acceptance/parent rollup xác nhận private routines cập nhật task và tăng `row_version`.
- Commit: `refactor: use scoped gantt catalog in dependent rooms`.

## Task 9 — Cloud smoke, rollout và promotion

- Thêm `supabase/tests/gantt_room_authoritative_cutover_smoke.sql`, chạy `begin/rollback` với matrix viewer/editor/deleter, edit-only, delete-only, PBAC-only, module-only, owner/assignee-only, inactive, wrong scope, empty Room và System Admin.
- Kiểm tra direct writes bị từ chối, catalog projection, idempotency, stale version, rollback và completion rows không đổi.
- Trước apply: lint, focused Vitest, full test, build, migration list linked, Cloud transaction migration+smoke rollback, `db push --linked --dry-run`.
- Chỉ push khi toàn bộ xanh; sau đó chạy lại smoke, migration list và advisors security/performance.
- Snapshot policies/grants/functions/Room sources/completion counts vào runbook rollback.
- Sau business acceptance, migration riêng `gantt_room_enforcement` đổi bindings từ `pilot` sang `enforced`; không sửa migration đã apply.

## Tiêu chí nghiệm thu

- Không có `view` thì không phát sinh query schedule.
- Mọi đường ghi Gantt chỉ đi qua sáu RPC authoritative; direct authenticated/anon writes bị từ chối.
- Edit/delete độc lập và đều cần view; cross-scope/stale rollback toàn bộ.
- Completion rows còn nguyên trong DB, không accessible từ product client và không ảnh hưởng progress.
- Weekly Progress, Daily Log, Nghiệm thu tiếp tục cập nhật qua trusted private routines.
- Cloud smoke, full tests, build và advisors không có finding mới mức error/high.
