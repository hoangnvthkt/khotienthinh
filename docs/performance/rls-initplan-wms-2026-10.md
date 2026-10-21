# RLS InitPlan module Kho (WMS) — đo trước / sau, 20/10/2026

Việc số 1 của audit `docs/audits/security-performance-scale-2026-10-20` (mục H1): policy SELECT của các bảng Kho gọi hàm quyền
**theo từng dòng** (`wms_has_action` ≈ 100 ms/lần vì gọi `has_permission` 5–7 lượt × ≈5 ms). Migration
`supabase/migrations/20261021120000_rls_initplan_wms.sql` tính tập phạm vi người dùng **một lần mỗi câu lệnh** (InitPlan) rồi so với
cột của dòng. Không đổi kết quả phân quyền.

Cách đo: Supabase Cloud `ftciqmqhmfvjtwoycswe` qua kết nối trong `.env`, transaction `begin … rollback` (migration áp thử trong
cùng transaction, **chưa áp thật**), `set_config('request.jwt.claims', …)` của từng người + `set local role authenticated`,
`explain (analyze, buffers)`. Lấy lần chạy thứ hai (ấm). Không ghi tên / email / UUID vào tài liệu.

## 1. Thời gian truy vấn (ms)

Bốn hồ sơ: **NV không quyền kho** (nhân viên thường, không ô quyền `wms.*`), **NV có quyền kho** (nhân viên có ô quyền kho, không
phải thủ kho — đúng người mẫu audit đã đo 674 ms), **Thủ kho một kho** (`wms.transaction.keeper` phạm vi một kho), **Admin**.

| Truy vấn | NV không quyền kho | NV có quyền kho | Thủ kho một kho | Admin |
|---|---:|---:|---:|---:|
| `select * from warehouses` (6 dòng) | 712 → **10,4** | 94 → **10,9** | 11,9 → **10,9** | 12,5 → **1,2** |
| `select * from warehouse_types` (4 dòng) | 212 → **9,4** | 42 → **10,3** | 12,1 → **10,1** | 12,7 → **12,4** |
| 50 phiếu kho mới nhất (`transactions`, 387 dòng) | 11.127 → **10,7** | 2.172 → **11,4** | 9.416 → **11,4** | 5.310 → **13,2** |
| 50 đề xuất mới nhất (`requests`, 107 dòng) | 93 → **5,4** | 139 → **6,6** | 130 → **6,5** | 94 → **4,9** |
| 50 dòng sổ kho mới nhất (`inventory_ledger_entries`, 920 dòng) | 31.446 → **19,5** | 5.743 → **12,1** | 6.115 → **11,8** | 11.131 → **13,5** |
| `select * from assets` (9 dòng) | 355 → **8,9** | 362 → **9,1** | 357 → **10,1** | 358 → **10,9** |

Mục tiêu đặt ra: `warehouses` < 20 ms, danh sách `transactions` / `requests` < 100 ms theo vai nhân viên thường — **đạt** ở cả bốn hồ sơ.

Vì sao người **không** có quyền kho lại chậm nhất trước đây: policy phải gọi hàm cho mọi dòng để loại từng dòng (387 phiếu × ≈29 ms,
920 dòng sổ × ≈34 ms); người có quyền toàn cục thoát sớm hơn ở nhánh đầu của `OR`. Sau sửa, chi phí gần như cố định ≈ 10 ms/câu
lệnh (một lần `resolve_effective_permission_sources` cho mọi mã quyền của người đó) bất kể số dòng.

Hai InitPlan trên `inventory_ledger_entries` (token `wms.inventory.view` + token thủ kho thuần) nên bảng này ≈ 12–20 ms; chấp nhận
để giữ đúng nghĩa nhánh thủ kho của `can_read_inventory_scope` khi mã `wms.inventory.view` bị tắt trong `permission_actions`.

`suppliers`, `categories`, `units`: policy SELECT là `true` (chốt `active_actor_gate` đã bọc `(select …)`), không cần sửa.

## 2. Hồi quy phân quyền — số dòng và tập dòng theo vai

Cùng transaction: đếm và băm (`md5` của danh sách khóa chính sắp xếp) **trước** khi áp migration và **sau** khi áp, cho từng hồ sơ.

| Bảng | NV không quyền kho | NV có quyền kho | Thủ kho một kho | Admin | Tập dòng trước = sau |
|---|---:|---:|---:|---:|:---:|
| `warehouses` | 0 | 6 | 6 | 6 | ✅ |
| `warehouse_types` | 0 | 4 | 4 | 4 | ✅ |
| `suppliers` | 1 | 1 | 1 | 1 | ✅ (không đổi policy) |
| `categories` | 37 | 37 | 37 | 37 | ✅ (không đổi policy) |
| `units` | 42 | 42 | 42 | 42 | ✅ (không đổi policy) |
| `transactions` | 0 | 387 | 106 | 387 | ✅ |
| `requests` | 0 | 58 | 43 | 107 | ✅ |
| `inventory_ledger_entries` | 0 | 920 | 920 | 920 | ✅ |
| `assets` | 0 | 0 | 0 | 0 | ✅ |

### 2a. Kiểm A — hàm quyền gốc so với token (mọi người × mọi mã × mọi phạm vi)

`has_permission(người, mã, loại phạm vi, id)` so với `permission_scope_tokens_for(người, [mã])` cho **88 người active × 52 mã**
(`wms.*`, `asset.*`, `settings.warehouses.*`, `system.settings.manage`, `system.wms.manage`) **× 15 phạm vi** (toàn cục; `own` /
`assigned` của chính mình; 6 kho thật + `*` + chuỗi rỗng + kho không tồn tại; phòng ban `*` / không tồn tại / có trong grant).

| Số ca | Đúng theo hàm cũ | Đúng theo token | Lệch |
|---:|---:|---:|---:|
| 68.640 | 2.763 | 2.763 | **0** |

Token tính một lần cho mỗi (người, mã) (4.576 lần, 48 s); so với 68.640 lần `has_permission` (12,9 phút) — minh họa luôn chi phí 5 ms/lần của hàm cũ.

### 2b. Kiểm B — tập dòng theo policy cũ / mới cho toàn bộ người dùng

Với **88 người active**, trong một transaction: lấy tập khóa chính nhìn thấy theo policy **cũ**, áp migration, lấy lại theo policy
**mới**, so từng người từng bảng. `warehouses`, `warehouse_types`, `requests`, `assets` lấy toàn bảng; `transactions` và
`inventory_ledger_entries` lấy mẫu cố định 40 dòng (20 mới nhất + 20 ngẫu nhiên) vì policy cũ mất ≈0,1 s/dòng/người.

| Bảng | Dòng kiểm (88 người) | Thấy theo policy cũ | Thấy theo policy mới | Lệch |
|---|---:|---:|---:|---:|
| `warehouses` (toàn bảng) | 528 | 228 | 228 | **0** |
| `warehouse_types` (toàn bảng) | 352 | 152 | 152 | **0** |
| `transactions` (mẫu 40) | 3.520 | 1.484 | 1.484 | **0** |
| `requests` (toàn bảng) | 9.416 | 2.929 | 2.929 | **0** |
| `inventory_ledger_entries` (mẫu 40) | 3.432 | 1.470 | 1.470 | **0** |
| `assets` (toàn bảng) | 792 | 99 | 99 | **0** |

Chạy như `postgres` (bỏ RLS, gọi thẳng biểu thức cũ và mới trên từng dòng; các hàm đều `SECURITY DEFINER` nên kết quả không
phụ thuộc vai gọi), `set_config('request.jwt.claims', …)` cho từng người. Thời gian 9,3 phút, gần hết là chi phí hàm cũ.

Lưu ý khi đo: **không** áp thử `alter policy` trong transaction kéo dài trên Cloud — `alter policy` giữ khóa ACCESS EXCLUSIVE tới khi
rollback, người dùng (lock_timeout 8 s) sẽ lỗi. Lúc 07:28–07:30 ngày 20/10 một phiên kiểm thử đã giữ khóa 6 bảng Kho ≈2 phút
trước khi được ngắt; các kiểm chứng A/B sau đó chỉ tạo hàm mới, không khóa bảng.

## 3. Vì sao giữ đúng nghĩa (tóm tắt, chi tiết trong đầu migration)

- `has_permission(u, mã, T, I)` = tồn tại nguồn quyền của `(u, mã)` sao cho `scope_covers(nguồn, T, I)`. Lấy toàn bộ nguồn một lần
  (`resolve_effective_permission_sources(u, null, null, null)`) rồi lọc bằng `scope_covers` cho **cùng tập** — với `role_sources`,
  điều kiện "assignment phủ ∧ item phủ" tương đương "phạm vi giao của hai cái phủ" nhờ mệnh đề `where` sẵn có (global / cùng loại /
  `*` / bằng nhau); `direct_sources` và `super_admin_sources` lọc đúng bằng `scope_covers` trên phạm vi xuất ra.
- Token `'<loại>:<id>'` với `''` chuẩn hoá thành `*` đúng như `scope_covers` (`coalesce(nullif(id, ''), '*')`); phía dòng:
  `'warehouse:' || cột` (cột `''` → không khớp token cụ thể, khớp `warehouse:*` khi cột không null — y như cũ).
- `wms_has_action` = canonical ∨ module admin WMS (trừ `wms.transaction.reverse`) ∨ thủ kho (mọi kho / kho nguồn / kho đích; trừ
  việc trong `wms_keeper_excluded_action`). Hợp token của nhiều mã = `OR` các `wms_has_action` cùng tham số dòng.
- `is_module_admin` tìm người theo `auth.uid()`; `auth_id` có unique index nên đó chính là người của `current_app_user_id()`
  (`me.auth_matches`); phần `role = 'ADMIN'` nằm trong `(select is_admin())` của policy `warehouses`.
- `requests` nguồn dự án: khóa `(dự án, công trường)` theo mẫu `rls_scope_key` (migration Dự án 20261012094700); cặp chưa có trong
  bảng rơi về biểu thức cũ theo dòng.
- `warehouses_settings_select` / `warehouse_types_settings_select` gộp vào policy phase4 cùng bảng (hai policy PERMISSIVE vốn `OR`):
  `settings_has_action('warehouses', false)` = `system.settings.manage` ∨ `settings.warehouses.manage` ∨ `settings.warehouses.view`
  toàn cục → `p_global_codes`.

## 4. Lệnh đo lại

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', auth_id, 'role','authenticated','email', email)::text, true)
from public.users where is_active and role <> 'ADMIN' and auth_id is not null limit 1;
set local role authenticated;
explain (analyze, buffers) select * from public.warehouses;
explain (analyze, buffers) select * from public.transactions order by created_at desc limit 50;
explain (analyze, buffers) select * from public.requests order by created_at desc limit 50;
rollback;
```

Sau khi áp migration lên Cloud, nên reset `pg_stat_statements` và xem lại trung bình của `warehouses` (936 ms), `assets` (1,29 s),
`warehouse_types` (493 ms) sau 1 tuần.

## 5. Tiếp theo (ngoài PR này)

- PR-2 Quy trình (WF): `workflow_instance_actor_can_select(id)` ≈ 8 ms/dòng, 2,27 s cho 50 phiếu — cùng mẫu tập cho phép tính một lần.
- `resolve_effective_permission_sources` là hàm SQL `SECURITY DEFINER` nên không inline và **lập kế hoạch lại mỗi lần gọi** (≈5 ms
  cho 0 dòng); chuyển sang plpgsql `return query` hoặc đệm quyền theo phiên (H1 bước 3) sẽ hạ sàn 10 ms/câu lệnh xuống ≈1 ms cho
  mọi module.
- Policy INSERT/UPDATE/DELETE của Kho vẫn gọi hàm theo dòng; chúng chỉ chạy trên dòng ghi (ít) nên để sau.
