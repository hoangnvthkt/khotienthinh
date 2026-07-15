# 05. Database and Supabase audit

## Kết luận

Database chứa nhiều control tốt mới được bổ sung trong Phase 0–5, nhưng lịch sử migration không tái lập và các policy/function cũ nguy hiểm chưa được phủ hết. Hai vấn đề cần containment ngay là dynamic SQL SECURITY DEFINER và HR/payroll policy cho anon. Vì không có local DB/cloud access, mọi kết luận “current production” phải được đối chiếu bằng catalog query trước khi thay đổi.

## Inventory

| Chỉ số | Giá trị |
|---|---:|
| Migration files | 234 |
| Migration SQL LOC | 58.710 |
| Version 14-digit | 225 |
| Version 8-digit | 9 |
| Files trùng version 20260531 | 6 |
| Baseline tables 2026-05-21 | 147 |
| Baseline RLS enabled | 143/147 |
| Baseline functions | 154 |
| Baseline policies | 438 |
| Baseline indexes | 514 |
| Baseline triggers | 17 |

Snapshot ngày 2026-05-21 chỉ là historical evidence. Sau snapshot có hơn một tháng migrations và direct apply logs; không được dùng nó như live truth.

## Migration history và drift

<code>supabase/baseline/2026-05-21/README.md:27-33</code> ghi local-only 30, remote-only 140 và chỉ 17 versions match; <code>db push</code> được đánh dấu unsafe. Snapshot không phải restore-grade vì thiếu local Docker/pg_dump tương thích.

Sáu file có cùng version <code>20260531</code>; chín file dùng prefix 8-digit. Phase 0–2 live logs ghi apply bằng direct query, smoke pass nhưng migration history chưa reconcile và không có schema backup. Handoff mới hơn lại ghi một số migration được apply/repaired thủ công. Kết luận DB-001: source history không đủ để chứng minh cloud state hay clean rebuild.

~~~mermaid
flowchart LR
    M[Local migration files] -->|không canonical| H[Migration history]
    Q[Direct db query applies] --> C[(Cloud schema)]
    H -. mismatch .-> C
    B[May-21 baseline] -. stale snapshot .-> C
    C --> R[Không thể chứng minh replay/rollback]
~~~

## RLS và grants

Supabase yêu cầu RLS cho exposed tables và nhấn mạnh service keys không được đưa vào browser; views/functions cũng phải được xem xét vì có thể bypass RLS. Xem [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) và [Data API security guide](https://supabase.com/docs/guides/api/securing-your-api).

### Critical historical/current-intended evidence

- SEC-001: authenticated được EXECUTE hai dynamic SQL functions SECURITY DEFINER.
- SEC-002: May-21 cloud snapshot cho thấy employees/labor contracts/leave globally readable và một số HR/payroll tables anon full-write; không thấy later policy replacement đầy đủ.
- SEC-003: contract headers/cost/resources/catalogs/appendices vẫn có true policies cho authenticated.
- SEC-008: project SELECT còn đường legacy <code>can_access_module('DA')</code>, không bắt membership.
- SEC-009: workflow/check-in/contract storage policies thiếu resource scope.

Phase permission migrations seed action codes nhưng registry không tự enforce lên table. Mỗi table/RPC/storage path vẫn phải có policy/guard cụ thể.

## SECURITY DEFINER và function surface

### Arbitrary query executors

<code>execute_readonly_query(text)</code> và <code>execute_ai_query(text)</code> dùng dynamic EXECUTE dưới SECURITY DEFINER. Migration <code>20260428090000...:840-868</code> và <code>20260428091000...:42-59</code> grant authenticated; không có later revoke. Baseline định nghĩa tại <code>cloud_public_schema_inventory.pretty.json:36531-36549</code>.

Blacklist không tạo security boundary. Function readonly còn dùng <code>\b</code> như word boundary, trong khi PostgreSQL ARE dùng <code>\y</code>/<code>\m</code>/<code>\M</code>; việc gọi side-effect functions, đọc object ngoài RLS hoặc gây DoS vẫn khả thi. Chỉ kiểm payload write trên clone cô lập.

### Search path

AI tool RPCs và một số workflow functions dùng <code>SET search_path = public</code> thay vì empty path + fully-qualified objects. Đây là DB-003. Exploitability phụ thuộc CREATE privileges/live ownership, nhưng hardening chuẩn nên không dựa vào mutable lookup path.

### Permission projection

<code>app_private.sync_legacy_permission_projection(uuid)</code> là SECURITY DEFINER, nhận arbitrary target và grant EXECUTE cho authenticated. Nếu <code>app_private</code> nằm trong exposed schemas, đây là privilege mutation path. Live API schema config vắng trong repo nên SEC-012 ở trạng thái Needs runtime verification.

## Constraints, indexes và race

### Đã quan sát

- Các WMS transition mới dùng row locks trên transaction/item.
- PO/global number migrations có counter/upsert thay vì count.
- Safety/Quality vẫn sinh mã bằng exact count + 1 ở client, tạo race DB-004.
- Một số workflow/document writes dùng unique keys/on conflict để idempotent.

### Baseline FK index gaps

Snapshot May-21 cho thấy candidate FKs thiếu leading index ở employee dimension fields, contract variation item, customer contract template, transaction approver/supplier, purchase request BOQ line và một số payment/project staff fields. Đây chỉ là candidate: cần live join <code>pg_constraint</code> với <code>pg_index</code>, row count và workload trước khi tạo index. Dùng concurrent index và đo write overhead.

### Chưa thể audit

Không có EXPLAIN ANALYZE, pg_stat_statements, index usage, bloat, locks, dead tuples, connection pool, row volume hay query latency. Không kết luận “thiếu/thừa index” chỉ từ tên file.

## Transaction và atomicity

| Use case | Current boundary | Kết luận |
|---|---|---|
| WMS stock + transaction status | Một RPC, row locks | Atomic nhưng latest RPC cast quantity sang integer |
| WMS complete + fulfillment/PO/MR | RPC thứ hai sau commit | Không atomic |
| Daily Log parent + 4 detail tables | Parent upsert, 4 delete/insert pairs | Không atomic |
| Supplier delivery statement + WMS drafts | Record RPC rồi client loop inserts/links | Không atomic |
| Safety parent/checklist | Client update/delete/insert | Không atomic |
| Payment certificate + recovery/BOQ/cash | Nhiều request tuần tự | Không atomic |
| Contract variation approval + BOQ | RPC | Atomic về data, nhưng auth/state precondition thiếu |

Chi tiết ở <code>08-workflow-data-integrity-audit.md</code>.

## WMS decimal regression

Latest <code>process_transaction_status</code> khai báo <code>v_qty integer</code> và cast numeric quantity sang integer tại <code>20260713005814_phase4_erp_permission_surface.sql:737,849,948</code>. Migration <code>20260602085356_allow_decimal_wms_stock_rpc.sql</code> trước đó đã dùng numeric. Vật tư theo kg, m³ hoặc mét có thể bị truncate khi kiểm và cập nhật stock. Đây là WF-001/P1.

## Storage

- workflow-attachments: authenticated CRUD toàn bucket trong <code>20260428111500...:3-32</code>.
- checkin-photos: public bucket, authenticated insert/update/delete chỉ theo bucket tại <code>20260622014021...:1-37</code>.
- contract-files: authenticated SELECT toàn bucket tại <code>20260710023735...:1-45</code>.
- project-files: service có call path nhưng không tìm thấy migration tạo bucket/table/policy tương ứng; fresh replay không chứng minh được.

Target policy phải bind path → parent row → tenant/project/user/action, không chỉ <code>bucket_id</code>.

## Findings

| ID | Vấn đề | Severity | Status |
|---|---|---:|---|
| DB-001 | Migration history/schema drift | P1 | Confirmed |
| DB-002 | Không có local reproducible DB/restore-grade baseline | P1 | Confirmed |
| DB-003 | SECURITY DEFINER search_path chưa hardened đồng nhất | P2 | Confirmed |
| DB-004 | Sinh business code bằng count + 1 | P1 | Confirmed |
| DB-005 | Readiness/health test có thể false-pass | P2 | Confirmed |
| SEC-001 | Dynamic SQL executors bypass RLS | P0 | Confirmed |
| SEC-002 | HR/payroll anon exposure/write | P0 | Confirmed historical/intended; live check urgent |
| SEC-003 | Contract data globally readable/mutable | P1 | Confirmed |
| SEC-008 | Legacy/project scope rộng | P1 | Confirmed |
| SEC-009 | Storage cross-scope | P1 | Confirmed |
| SEC-012 | Permission projection caller auth | P1 | Needs runtime verification |

Field-complete records nằm ở <code>10-issue-register.md</code>.

## Live verification checklist ưu tiên

1. Export read-only <code>pg_proc</code> owner/proacl/definition cho hai query executors; revoke/drop plan chỉ sau backup/catalog evidence.
2. Export <code>pg_policies</code>, grants và columns cho HR, contract, users, project, WMS, quality, safety, documents.
3. Export storage buckets/object policies và exposed schemas.
4. <code>supabase migration list --linked</code> read-only, checksum map và schema diff so với canonical baseline.
5. Clone production schema/data-masked; replay clean migrations và chạy all SQL smoke/negative persona tests.
6. pg_stat_statements/top locks/FK-index query/row counts trước mọi performance change.
