# 03. Module coverage matrix

## Cách đọc

- Deep: trace UI → service/context → table/RPC/policy và tests liên quan.
- Medium: inventory đầy đủ, trace các path nhạy cảm/chính; chưa exhaust mọi CRUD.
- Runtime pending: static evidence có, chưa xác nhận deployed schema/data/telemetry.

| Module/flow | UI/service đã trace | DB/security đã trace | Tests quan sát | Coverage | Kết luận chính |
|---|---|---|---|---|---|
| Auth + permission initialization | App ProtectedRoute, AppContext bootstrap, permissionService | users, grants, legacy functions, Edge admin functions | permission/route/phase tests | Deep, runtime pending | Fail-open client/legacy; inactive admin và metadata bootstrap cần hardening |
| Project membership/access | ProjectDashboard, projectMaster/Staff/Permission services | Phase 2/3 PBAC, projects/project_staff policies | project permission tests + SQL smoke | Deep, runtime pending | DA legacy module fallback vẫn mở rộng project reads |
| Daily Log member → KTT → CHT | DailyLogTab, projectService, dailyLogDetailService | transition_daily_log_status, guard trigger, Phase 3 RLS | daily log unit + SQL smoke | Deep | Transition tốt; parent/detail save không atomic |
| MR → PO → delivery → WMS | Material/SupplyChain tabs, fulfillment, PO, supplier delivery services | requests/PO/batches/transactions, status/sync RPCs | nhiều MR/PO/WMS tests + SQL smoke | Deep, runtime pending | Nhiều post-commit sync boundary tạo partial failure |
| Internal warehouse transfer | AppContext transaction actions, stock guards | process_transaction_status/apply_stock_change, WMS permissions | WMS permission/PO/fulfillment tests | Deep | Core stock move atomic; downstream fulfillment sync tách transaction |
| Notifications + Web Push | notificationService/routes, NotificationCenter, webPushService | notifications trigger, pg_net, send-web-push, deliveries | notification unit tests | Deep, runtime pending | Có delivery log, nhưng thiếu idempotency uniqueness/observed retries |
| Legacy → new permission | permissionService/AppContext | Phase 0–5 flags, projection, health functions | phase 0–5 unit/SQL scripts | Deep, runtime pending | Cutover chưa hoàn tất; health test có thể false-pass |
| Payment/Expense | PaymentWorkbench, BudgetDashboard, finance services | project finance/transactions, expense/budget Phase 3/4 | finance/cash/payment tests | Medium | Search/over-fetch; business transition matrix cần owner xác nhận |
| Contracts/Tender/Cost | HD routes, contract/cost/tender services | contract headers/items/catalogs/storage, Phase4 registry | contract/cost tests | Deep for auth/data boundary | Policy cũ cho authenticated mutate/read quá rộng |
| Quality | QualityTab/checklist service/workflow | quality tables, Phase3 permission surface | quality workflow tests + SQL smoke | Medium | count+1 code race; deployed policy state cần verify |
| Safety | SafetyTab, safetyService/passport | safety tables/storage/functions | safety tests + SQL smoke | Deep for write/KPI | Multi-step write không atomic; KPI cap có thể sai |
| Documents/Storage/KB | DocumentsTab/documentService, DataStorage, KnowledgeBase | project/HR docs, buckets, RAG paths | document trace/attachment tests | Deep for project docs | UI báo success sai khi partial failure; storage scope quá rộng ở vài bucket |
| HRM/Payroll | employee/attendance/leave/payroll pages | baseline policies, employee writes, attendance RPC | một số attendance/service tests | Deep for security; medium workflow | Historical baseline cho thấy PII anon/global; current runtime phải kiểm ngay |
| Procurement | CompanyProcurement, PO services | PO numbering/policies/workflow | procurement SQL smoke + PO tests | Medium–Deep | Numbering RPC tốt hơn; delivery/WMS boundary còn partial |
| Assets | TS routes/AppContext asset services | asset tables/transfer RPC | asset recovery tests | Medium | Không thấy P0/P1 riêng; runtime RLS/volume chưa kiểm |
| Workflow/RQ | contexts, workflow pages/services | process_workflow_instance, assignment tables/RLS | workflow SQL smoke, limited unit | Medium | Function surface lớn; attachment policy cần scope |
| Chat | Chat/ChatV2 contexts/services | member policies, structured chat migrations | chat unit + SQL smoke | Medium | Có membership policies; runtime realtime/load chưa profile |
| AI/RAG/Analytics | AiAssistant/Tender services, Edge AI | service-role tools, RAG RPC, memory tables | không có Edge integration/negative auth tests | Deep for security | Confused deputy/cross-domain exposure P1 |
| PWA/release | service worker, PWA scripts | N/A | service-worker asset test, qa:pwa script | Medium | Build works; no CI/browser E2E/release gate |

## Coverage định lượng

| Hạng mục | Coverage thực tế |
|---|---|
| Repository/instructions/config | 100% inventory |
| TS/TSX | 528/528 static graph; 516 app files lexical scan; deep trace các path trọng yếu |
| Migration | 234/234 inventoried và pattern-scanned; semantic deep trace các migration liên quan auth, permission, project, HR, contract, WMS, workflow, storage, AI |
| Edge Functions | 4/4 function directories và shared AI catalog reviewed |
| Unit tests | 66 test files được chạy; 360/360 pass |
| SQL smoke tests | 26 files inventoried; 0 executed do thiếu local DB |
| Build/type/lint | build pass, script lint pass; script typecheck không tồn tại |
| Dependency audit | production và full audit chạy tại 2026-07-14 |
| Browser/UI | 0% runtime; không chạy browser/E2E |
| Local DB | 0% runtime; Docker daemon không khả dụng |
| Cloud/production | 0% direct access; chỉ dùng snapshot/logs trong repo |

## Chưa thể kết luận

- Migrations nào đang thực sự applied trên cloud và checksum/schema drift hiện tại.
- Current policy/grant/function owner/exposed schema/storage ACL.
- Edge verify_jwt, public signup, JWT expiry/revocation và deployed secrets.
- Row counts, hot tables, cache hit, slow queries, locks, index usage, bloat.
- Web Vitals, React render counts, mobile memory/CPU, request bytes thực tế.
- Backup restore success, RPO/RTO, staging parity và rollback drill.
- Tính đúng nghiệp vụ cuối cùng của trạng thái Payment, Expense, Contract, Quality, Safety và Documents khi có ngoại lệ.

## Owner cần xác nhận

1. Ai được xem lương, hợp đồng lao động, leave/KPI và employee directory ở mức cột nào?
2. Contract catalogs/BOQ/định mức có global hay phải scope theo công ty/project/contract?
3. DA module access có đồng nghĩa xem mọi dự án, hay bắt buộc membership?
4. KTT/CHT có được thay thế/delegate, và quyền return sau verified thuộc ai?
5. Khi WMS hoàn tất nhưng PO/MR sync lỗi, nguồn sự thật và SLA reconciliation là gì?
6. Safety score có được phép tính trên sample cap hay phải là toàn bộ dữ liệu?
7. File check-in, HR, contract, workflow phải giữ/xóa theo retention nào?
8. Các trạng thái Payment/Expense/Contract nào là bất biến sau duyệt và ai được reopen?
