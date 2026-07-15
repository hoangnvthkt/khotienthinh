# 02. Current architecture

## Kết luận

Kiến trúc hiện tại là một modular SPA về mặt route nhưng chưa modular theo domain/data ownership. RLS/RPC đang là security boundary thực sự; frontend giữ quá nhiều server state và business orchestration trong global contexts/page components. Không tìm thấy circular dependency trong đồ thị import tĩnh, nhưng coupling tập trung rất cao.

## Repository map

| Khu vực | Vai trò | Nhận xét |
|---|---|---|
| <code>App.tsx</code> | Router, guards, provider composition, route/realtime warmup | 109 lazy route imports; route split tốt |
| <code>pages/</code> | Feature screens và project tabs | Nhiều page chứa cả UI, query và orchestration |
| <code>components/</code> | Shared/modal/widgets | Một số modal vượt 4.000 LOC |
| <code>context/</code> | Global auth/data/workflow/request/chat state | AppContext là god context |
| <code>lib/</code> | Services, policies, mapping, domain helpers | 129 file import Supabase trực tiếp; boundary không đồng nhất |
| <code>supabase/migrations/</code> | Schema, RLS, functions, triggers | 234 migrations; lịch sử drift |
| <code>supabase/functions/</code> | AI, user admin, password reset, web push | Service role chỉ ở Edge, nhưng authorization chưa đồng đều |
| <code>supabase/tests/</code> | SQL smoke scripts | Có giá trị nhưng chưa nằm trong CI |
| <code>lib/__tests__/</code> | Vitest unit/service tests | 360 tests pass |

## Runtime composition

~~~mermaid
flowchart TD
    ENTRY[index.tsx] --> APP[App.tsx]
    APP --> TP[Theme/Toast/Confirm]
    TP --> AP[AppProvider]
    AP --> WP[WorkflowProvider]
    WP --> RP[RequestProvider]
    RP --> CP[Chat/Celebration]
    CP --> ROUTER[HashRouter]
    ROUTER --> PR[ProtectedRoute]
    PR --> SG[SubModuleGuard]
    SG --> L[Layout]
    L --> P[Lazy pages/tabs]
    AP --> SB[Supabase singleton]
    P --> SB
    P --> SVC[lib services]
    SVC --> SB
~~~

## Quantitative structure

- 528 TS/TSX files, khoảng 233.554 LOC trong toàn repository; 516 application TS/TSX files được quét sâu, khoảng 229.420 LOC.
- Static graph: 2.063 relative/alias import edges, 0 cycle được tìm thấy. Kết quả không bao phủ dynamic non-literal imports hay runtime plugin edges.
- File lớn nhất: <code>SupplyChainTab.tsx</code> 8.765 LOC, <code>types.ts</code> 6.230, <code>GanttTab.tsx</code> 4.545, <code>RequestModal.tsx</code> 4.201, <code>costEstimateService.ts</code> 4.047, <code>AppContext.tsx</code> 3.641.
- AppContext chứa khoảng 55 state slices, provider value được dựng lại và có 108 consumer files.
- 129 files import Supabase trực tiếp; khoảng 41 UI files gọi database trực tiếp.

## Điểm mạnh đã xác nhận

- Route-level lazy loading phủ gần như toàn bộ page ở <code>App.tsx:25-129</code>.
- ProtectedRoute dùng cả <code>getSession</code> và <code>getUser</code>, đồng thời unsubscribe auth listener ở <code>App.tsx:145-180</code>.
- Supabase service-role key không xuất hiện trong frontend; chỉ dùng trong Edge Functions/migration.
- Daily Log transition mới khóa row, kiểm transition/actor/action và chặn direct workflow-field update tại <code>20260712141706_phase3_daily_log_namespace.sql:320-557</code>.
- WMS status RPC khóa transaction/item, kiểm warehouse action, tồn khả dụng và cập nhật stock + status trong một DB transaction tại <code>20260713005814_phase4_erp_permission_surface.sql:720-980</code>.
- Có retry có giới hạn cho GET/HEAD/OPTIONS ở <code>lib/supabase.ts:96-136</code>; mutation không bị retry mù.
- 360 Vitest tests pass và production build hoàn tất.

## Coupling và placement

### Global state

AppContext vừa quản lý auth/profile/permissions, vừa giữ WMS, HRM, assets, expense, project finance, mutations, module cache và realtime. Provider value tại <code>AppContext.tsx:3600-3627</code> không có selector boundary. Một update ở một domain có thể render consumer khác.

### Business logic

Business logic tồn tại ở ba nơi:

1. UI/page components, ví dụ SafetyTab cập nhật parent và child rows.
2. Services ở <code>lib/</code>, có nơi gọi nhiều PostgREST request tuần tự.
3. Postgres RPC/trigger, là nơi các transition quan trọng nên tập trung.

Việc không có rule cưỡng chế khiến cùng loại use case có lúc atomic ở RPC, có lúc best-effort ở client.

### Data strategy

Custom module cache dùng <code>loadedModulesRef</code>, không có cache key theo project/filter/page. Expense route còn warm cả EX, HRM và WMS. Có realtime singleton theo route nhưng map mới phủ admin/wms/hrm. Không có query cancellation/targeted invalidation thống nhất.

### Security boundary

UI guards là UX, không phải security boundary. Current intended security dựa vào RLS, SECURITY DEFINER RPC và Edge Functions. Audit phát hiện nhiều policy/grant cũ rộng hơn permission registry mới, do đó “có menu/action permission” không đồng nghĩa row-level enforcement đã hoàn tất.

## Static dependency view

~~~mermaid
flowchart LR
    UI[pages/components] --> CTX[global contexts]
    UI --> LIB[lib services/policies]
    UI -. direct calls .-> SUPA[Supabase client]
    CTX --> LIB
    CTX --> SUPA
    LIB --> SUPA
    SUPA --> API[PostgREST/RPC/Realtime/Storage]
    API --> PG[(Postgres)]
    UI --> EDGE[Edge Functions]
    EDGE --> PG
~~~

Đường nét đứt là boundary cần giảm dần: UI trực tiếp gọi database.

## Findings liên quan

- ARC-001: god context/god files.
- ARC-002: UI/data access/domain boundary bị xuyên.
- FE-001 và FE-002: auth bootstrap và error state.
- PERF-001 đến PERF-004: over-fetch, bundle, realtime, invalidation/search.
- DB-001 và DB-002: migration/schema reproducibility.

Record đầy đủ nằm trong <code>10-issue-register.md</code>.
