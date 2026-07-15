# 07. Performance audit

## Kết luận

Static evidence cho thấy performance risk chủ yếu nằm ở data volume scaling, not micro-optimization: module-wide reads, select star, coarse invalidation, search storms, global render fan-out và large chunks. Database tuning cụ thể chưa thể kết luận nếu thiếu live plans/statistics.

## Frontend bundle

Fresh Vite build 2026-07-14 thành công, 3.593 modules transformed và cảnh báo chunk trên 500 kB.

| Asset/chunk | Raw | Gzip | Nhận xét |
|---|---:|---:|---|
| three | 958,68 kB | 270,44 kB | Chỉ nên tải route/action 3D |
| index | 593,81 kB | 158,54 kB | Provider/shared code còn lớn |
| ScannerModal | 448,94 kB | 114,82 kB | Lazy khi mở scanner |
| xlsx | 429,53 kB | 143,08 kB | Lazy khi import/export; security risk |
| charts | 428,16 kB | 114,80 kB | Lazy theo dashboard |
| Settings | 381,40 kB | 85,92 kB | Admin-only route |
| SupplyChainTab | 364,10 kB | 85,05 kB | Feature tab vẫn lớn |
| MaterialTab | 280,27 kB | 72,86 kB | Feature split candidate |

Route lazy loading đã tốt; next step là subtab/action-level imports và CI bundle budget, không phải đổi bundler.

## Network/query

### Over-fetch

- 493–495 lexical select-star patterns.
- Chỉ 29 range calls.
- Expense route loads EX + HRM + WMS, khoảng 35 tables.
- Current user bootstrap tải all users select star sau profile.
- Safety list hydrates signed URL per attachment.

PERF-001/P1 cần projection, scope và pagination theo screen; không tối ưu bằng cache một full-company dataset.

### Invalidation

Attendance approve/reject và check-in force reload toàn HRM, khoảng 21 tables. Search ở Payment/Project/Safety không debounce/cancel, tạo network bursts và stale response race. PERF-003/P2.

### Realtime

Route-to-table map thiếu DA/EX/TS, trong khi prior channels có thể được giữ. Cần declarative subscriptions theo feature/scope và metrics về channel count/event rate.

## Rendering

AppContext có khoảng 55 state slices và 108 consumers, provider value không selector-based. Đây là static rerender fan-out risk; chưa có React Profiler nên không đưa ra commit count giả định. Verification phải đo update một record và route không liên quan.

## Correctness under scale

<code>safetyService.ts:217-282</code> giới hạn issues 250 và các tập khác 100 rồi dùng kết quả để tính KPI như tổng thể. Khi vượt cap, score/count có thể sai chứ không chỉ chậm. Signed URL hydration ở <code>:53-75,333-376</code> là N+1. PERF-004/P1.

WMS decimal cast là correctness bug, không phải performance optimization; không được “fix” bằng numeric-to-integer simplification.

## Database

### Có thể kết luận tĩnh

- WMS/item/transaction paths dùng JSONB array expansion và reservation sums trong transition RPC; row locks đúng về integrity nhưng cost tăng theo pending rows.
- Baseline có candidate FKs thiếu index.
- AI dashboard/tool RPC aggregate toàn tables và chạy service role.
- Exact count + 1 vừa đắt vừa race ở quality/safety.

### Không thể kết luận

Không có row counts, pg_stat_statements, EXPLAIN ANALYZE, buffer hit, index scans, bloat, lock wait, pool saturation, Realtime bandwidth. Vì vậy không đề xuất index cụ thể ngoài candidate-to-measure.

## Profiling plan

| Layer | Dữ liệu cần | Acceptance đầu tiên |
|---|---|---|
| Browser | LCP, INP, CLS, JS heap, route chunk, render commits | p75 theo device/network đã thống nhất |
| Network | request count/bytes/TTFB/cache hit per screen/action | Không full-module reload cho single mutation |
| PostgREST | rows returned, query latency, error rate | Page-size/scope contract rõ |
| Postgres | pg_stat_statements, plans, locks, indexes | Top queries có owner và budget |
| Realtime | active channels, events/sec, reconnects | Route transition cleanup deterministic |
| Storage | signed URL calls, object bytes, errors | Lazy/batch only visible items |

Threshold số phải được thiết lập từ baseline runtime; audit không tự đặt SLA kinh doanh.

## Findings

| ID | Vấn đề | Severity | Status |
|---|---|---:|---|
| PERF-001 | Unbounded/module-wide select star | P1 | Confirmed |
| PERF-002 | Large feature/vendor chunks | P2 | Confirmed |
| PERF-003 | Coarse invalidation/search storms | P2 | Confirmed |
| PERF-004 | Safety KPI cap + signed URL N+1 | P1 | Confirmed |
| ARC-001 | Global render fan-out | P2 | Confirmed |
| DB-004 | Exact count + 1 code generation | P1 | Confirmed |

Field-complete records nằm trong <code>10-issue-register.md</code>.
