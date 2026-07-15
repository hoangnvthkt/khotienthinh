# 04. Frontend audit

## Kết luận

Frontend có route-level code splitting tốt và một số guard/error boundary cơ bản, nhưng server state, auth profile, permission và nhiều domain data bị gom vào global contexts. Vấn đề ưu tiên không phải đổi framework; cần tách dần auth/data boundary, query scope và transaction command.

## Architecture và state

AppContext tại <code>context/AppContext.tsx:448-3627</code> chứa auth/profile/permission cùng hàng chục state slice WMS/HRM/asset/finance. Provider value dựng mới ở <code>3600-3627</code>; 108 files dùng <code>useApp</code>. WorkflowContext và RequestContext cũng giữ data/business orchestration. Đây là coupling/rerender risk ARC-001.

Không có query cache chuẩn hóa theo key. <code>loadedModulesRef</code> là cache theo module/session, không theo project/filter/page. Mutation có nơi force reload toàn module; lỗi fetch có nơi thành empty state.

## Routing và lazy loading

- 109 page/layout imports dùng React.lazy ở <code>App.tsx:25-129</code>.
- ProtectedRoute xác minh Supabase session và user.
- SubModuleGuard chỉ là client UX; backend RLS/RPC phải quyết định quyền.
- Một số subtab nặng vẫn static import trong workspace; xem PERF-002.

## Auth initialization

~~~mermaid
flowchart TD
    A[AppProvider init] --> B{localStorage vioo_user?}
    B -->|yes| C[cached profile]
    B -->|no| D[MOCK_USERS first ADMIN]
    E[ProtectedRoute] --> F[getSession + getUser]
    F -->|valid| G[render protected tree]
    A --> H[fetch users profile]
    H -->|found| I[replace user + grants]
    H -->|missing/error/inactive| J[old cached/mock identity remains]
~~~

<code>AppContext.tsx:448-456,643-709</code> không fail closed khi profile thiếu/inactive; <code>App.tsx:134-185</code> chỉ xác minh Auth identity. Đây là FE-001. RLS có thể chặn dữ liệu, nhưng UI/action identity vẫn sai và kết hợp với legacy policies làm tăng rủi ro.

## Query/network

Lexical scan:

- 493–495 <code>select('*')</code> patterns.
- 681 <code>.from()</code>, 107 <code>.rpc()</code>.
- Chỉ 29 <code>.range()</code>, 97 <code>.limit()</code>, 14 exact count.
- 129 files import Supabase trực tiếp.

BudgetDashboard gọi EX + HRM + WMS loaders ở <code>pages/expense/BudgetDashboard.tsx:26-34</code>. Module loaders tại <code>AppContext.tsx:1062-1263,1331-1348</code> tải nhiều bảng đầy đủ. Đây là PERF-001.

Payment, project và safety searches gọi lại query theo từng ký tự, không debounce/cancel/sequence guard; xem <code>PaymentWorkbenchTab.tsx:364-385,658</code>, <code>paymentScheduleWorkbenchService.ts:161-210</code>, <code>ProjectDashboard.tsx:558-602</code> và <code>SafetyIssueList.tsx:57-84</code>.

## Error/loading/retry

- Supabase fetch wrapper chỉ retry read methods, là lựa chọn an toàn.
- <code>hooks/useModuleData.ts:9-14</code> không catch promise; service errors có thể thành unhandled rejection.
- Contract/Documents list có nơi console-only hoặc trả empty; người dùng không phân biệt “không có dữ liệu” và 403/offline.
- Documents upload/delete bỏ qua một số kết quả lỗi rồi toast success; xem WF-006.

Đích cần một result contract thống nhất: data, status, error, retry, correlation ID; không silent empty cho dữ liệu nghiệp vụ.

## Realtime

<code>REALTIME_TABLES_BY_MODULE</code> tại <code>AppContext.tsx:140-147</code> chỉ có admin/wms/hrm. Route warmup tại <code>App.tsx:341-380</code> không khai báo đầy đủ DA/EX/TS, nên có thể vừa stale vừa giữ subscription cũ. Cleanup ở service tồn tại nhưng map lifecycle thiếu. Đây là FE-003.

## Rendering

Không có React Profiler runtime, nên chưa định lượng commit. Static evidence cho thấy global provider value và wide consumers gây fan-out. Tách theo feature store/query cache có selector là hướng tăng dần; không cần big-bang rewrite.

## Responsive/mobile

PWA, BottomNav, responsive classes và scanner flows hiện diện. Tuy nhiên chưa chạy device/browser test. Bundle xlsx/three/charts/scanner lớn, module-wide fetch và signed URL N+1 là rủi ro rõ nhất cho mobile. Cần đo LCP/INP/memory trên Android cấu hình thấp và iOS standalone.

## Bundle build 2026-07-14

Fresh production build vào thư mục tạm thành công. Các chunk lớn:

| Chunk | Raw | Gzip |
|---|---:|---:|
| three | 958,68 kB | 270,44 kB |
| index | 593,81 kB | 158,54 kB |
| ScannerModal | 448,94 kB | 114,82 kB |
| xlsx | 429,53 kB | 143,08 kB |
| charts | 428,16 kB | 114,80 kB |
| Settings | 381,40 kB | 85,92 kB |
| SupplyChainTab | 364,10 kB | 85,05 kB |

Vite phát cảnh báo chunks vượt 500 kB. Route splitting tốt nhưng action-level/subtab-level splitting và bundle budgets còn thiếu.

## Findings

| ID | Tóm tắt | Severity | Status |
|---|---|---:|---|
| FE-001 | Auth/profile bootstrap không fail closed | P1 | Confirmed |
| FE-002 | Lỗi data load bị swallow/empty hoặc unhandled | P2 | Confirmed |
| FE-003 | Realtime route map/lifecycle không đầy đủ | P2 | Confirmed |
| ARC-001 | Global context và god files | P2 | Confirmed |
| ARC-002 | UI gọi database trực tiếp, domain boundary mờ | P2 | Confirmed |
| PERF-001 | Module-wide select star, thiếu scope/pagination | P1 | Confirmed |
| PERF-002 | Feature/vendor chunks lớn | P2 | Confirmed |
| PERF-003 | Coarse invalidation và search query storm | P2 | Confirmed |
| PERF-004 | Safety KPI cap và signed URL N+1 | P1 | Confirmed |

Field-complete records, remediation risk và verification nằm ở <code>10-issue-register.md</code>.

## Runtime verification cần bổ sung

1. React Profiler theo event attendance, realtime và route switch.
2. Network HAR cho Home, Expense, HRM, Project, Safety với dataset production-like.
3. Lighthouse/Web Vitals cold/warm trên Android/iOS.
4. Realtime channel inventory sau 20 route transitions.
5. Slow 3G search race test và offline/403/500 UX matrix.
6. Bundle visualizer + coverage để xác nhận dead-code candidates trước khi xóa.
