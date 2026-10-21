# Realtime (H2) — kiểm kê và đợt 1 (20/10/2026)

Việc H2 trong [audit bảo mật + hiệu năng 20/10](../audits/security-performance-scale-2026-10-20/README.md). Sau H1
(#267 Kho, #268 Quy trình, #269 Nhân sự) chi phí RLS mỗi lần kiểm đã giảm 50–100×, nên phần nhân theo số người nghe của
Realtime cũng giảm theo. Đợt 1 làm hai việc không đổi hành vi; việc lớn (Broadcast theo kho) để đợt 2.

## 1. Kiểm kê (Cloud, 20/10 ~10:50)

| Chỉ số | Giá trị |
|---|---|
| Bảng trong publication `supabase_realtime` | 67 |
| Bảng mã client thật sự đăng ký `postgres_changes` | 43 (grep `table: '…'` + `REALTIME_TABLES_BY_MODULE`) |
| Subscription đang mở | 121, trên 10 bảng: `users` 43, `app_settings` 19, `notifications` 16, `chat_v2_participants` 16, `org_units` 10, `warehouses`/`items`/`requests`/`warehouse_types` 4, `workflow_subject_comments` 1 |
| Thay đổi/giờ trên bảng publish nhưng **không ai nghe** | `user_permission_grants` 2.324, `employees` 1.077, `hrm_employee_compensation_assignments` 491 … ≈ 22 % tổng |
| Kết nối Realtime tới DB | 11 (replication + subscription manager) |

Cách Realtime `postgres_changes` làm việc: mọi thay đổi trên bảng trong publication được giải mã từ WAL; với mỗi subscription
trùng bảng/event/filter, Realtime chạy RLS **như người đó** để quyết định có gửi không. Chi phí = (số thay đổi) × (số người
nghe) × (chi phí policy). Mỗi tab trình duyệt là một kết nối WebSocket; gói Pro giới hạn 500 kết nối đồng thời.

Phát hiện phụ (chưa sửa ở đợt này):

- `hrm_attendance` nằm trong `REALTIME_TABLES_BY_MODULE.hrm` nhưng **không** có trong publication → màn Chấm công không
  nhận sự kiện realtime (đang dựa vào `syncMonth` mỗi 60 s). Thêm vào publication là quyết định chức năng (thêm fan-out).
- `managementDatasetService.INVALIDATION_TABLES` (`project_tasks`, `purchase_orders`, …) không có trong publication nên
  invalidation realtime của màn quản trị chưa bao giờ chạy; cache sống nhờ TTL.
- `auth.users` bị cập nhật ~4.100 lần/giờ (refresh token) — không liên quan publication (`public.users` chỉ 145).

## 2. Đợt 1 — thay đổi

### 2a. Rút publication (migration `20261021190000_realtime_publication_trim.sql`)

Bỏ 23 bảng không có client nào đăng ký: 5 bảng `ai_*`, `employees`, 14 bảng `hrm_*` (lương 3P, năng lực, chức danh, khối tổ
chức), `user_permission_grants`, `user_authorization_refresh_events`, `workflow_instance_comments`. Không mất sự kiện nào vì
không có subscription; Realtime bớt ≈ 22 % thay đổi phải giải mã/đối chiếu. Thêm lại bằng
`alter publication supabase_realtime add table public.<bảng>` khi có màn cần.

### 2b. Tab ẩn quá 5 phút thì tạm ngắt (`lib/realtimeService.ts`)

- `visibilitychange` → ẩn: hẹn 5 phút (`REALTIME_IDLE_SUSPEND_MS`) rồi `suspendForIdle()`: đóng kênh `realtime-all`,
  nhớ danh sách bảng. Hiện lại: `resumeIfSuspended()` nối lại đúng bảng và gọi `onResume`.
- `AppContext` nghe `onResume` → `loadModuleData(module, true, { silent: true })` cho các module đã tải: tải lại ngầm, giữ
  dữ liệu và trạng thái `loaded` đang hiện (không chớp spinner), bù các sự kiện bỏ lỡ lúc ngắt.
- `managementDatasetService` đã tự xoá cache khi mất rồi có lại kết nối (giữ nguyên).
- Chỉ kênh `realtime-all` của AppContext (9 bảng WMS, 2 bảng HRM, `app_settings`, `users`) được tạm ngắt; kênh thông báo
  (lọc theo `user_id`), chat, feedback giữ nguyên để tab nền vẫn nhận tin.
- Test: `lib/__tests__/realtimeServiceIdle.test.ts` (ngắt đúng 5 phút, nối lại đúng bảng, báo onResume, không ngắt nếu
  quay lại sớm, đổi bảng khi đang ngắt).

Ước tính ở 200 người: tỉ lệ tab ẩn > 5 phút thường 50–70 % → số subscription WMS/HRM mà Realtime phải đối chiếu giảm tương
ứng; số kết nối WebSocket không đổi (kênh thông báo còn mở) nhưng kênh nặng nhất đã đóng.

## 3. Đợt 2 — Broadcast theo kho (21/10, migration `20261025220000_realtime_wms_broadcast.sql`)

Ba bảng Kho ghi nhiều — `transactions`, `activities`, `items` — chuyển từ `postgres_changes` sang **Broadcast private**:

- **Trigger** `zz_wms_broadcast_*` (AFTER INSERT/UPDATE/DELETE) gửi dòng (`to_jsonb(new)`) vào các kênh phạm vi của dòng bằng
  `realtime.send(..., private => true)`. UPDATE làm một kênh mất quyền xem dòng → kênh đó chỉ nhận `{id}` kiểu DELETE (không lộ
  nội dung mới). Lỗi gửi không bao giờ làm hỏng lệnh ghi.
- **Kênh** (khớp từng nhánh của policy SELECT):

| Bảng | Kênh | Được vào khi |
|---|---|---|
| transactions | `wms:tx:anywh` · `wms:tx:nowh` · `wms:tx:wh:<kho>` · `wms:tx:own:<người>` · `wms:tx:assigned:<người>` | token `wms_action_scope_tokens(['wms.transaction.view'])` tương ứng `global:*`/`warehouse:*` · `global:*` · `warehouse:<kho>` · `own:*` (chính mình) · `assigned:*` (chính mình) |
| activities | `wms:act:all` · `wms:act:user:<người>` · `wms:act:wh:<kho>` · `wms:act:nowh` | `is_admin()` · chính mình · `activity_wms_scope()` all hoặc có kho · all hoặc any |
| items | `wms:items` | cùng biểu thức `items_phase4_select` ∨ `items_settings_select` |

- **Quyền** `app_private.wms_realtime_topic_allowed(topic)` dùng cho policy `wms_broadcast_receive` trên `realtime.messages`
  (Realtime kiểm **một lần lúc vào kênh**) và cho RPC `public.wms_realtime_topics_v1()` (client hỏi danh sách kênh được vào; bỏ
  kênh bị kênh rộng hơn bao trùm: Admin chỉ vào 4 kênh).
- **Client** `lib/realtimeService.ts`: `WMS_BROADCAST_TABLES` đi kênh private (`supabase.realtime.setAuth()` trước khi vào); các bảng
  khác giữ `realtime-all` postgres_changes. RPC lỗi hoặc kênh báo `CHANNEL_ERROR`/`TIMED_OUT` → tự quay về postgres_changes cho các
  bảng đó (kênh `realtime-wms-fallback`, một lần mỗi lượt kết nối), nên deploy client trước/sau migration đều an toàn. Ba bảng vẫn
  nằm trong publication để làm đường lui.
- **Kiểm tương đương (Cloud, rollback):** 88 người active × 3 bảng, so tập dòng RLS cho xem với tập dòng có ít nhất một kênh của
  dòng nằm trong danh sách kênh của người đó: **0 lệch** (transactions 391 dòng, activities 3.405, items theo quyền xem).

Chi phí ở 200 người: mỗi thay đổi = 1–5 dòng `realtime.messages` (thay vì 200 lần chạy RLS); quyền kiểm lúc vào kênh
(RPC ~0,2–1 s một lần mỗi phiên). `requests` (toàn bộ là phiếu nguồn dự án, quyền theo phòng dự án) và bảng danh mục ít ghi giữ
postgres_changes.

## 4. Kiểm tra sau khi áp

```sql
select count(*) from pg_publication_tables where pubname = 'supabase_realtime';   -- 44
select count(*) from pg_trigger where tgname like 'zz_wms_broadcast_%';                 -- 3 (đợt 2)
select topic, count(*) from realtime.messages where topic like 'wms:%' group by 1;   -- có dòng sau mỗi thay đổi Kho
select entity::text, count(*) from realtime.subscription group by 1 order by 2 desc;
```

Trong app: mở Kho, chuyển tab khác > 5 phút, quay lại → console `[Realtime] ⏸ Tab ẩn…` rồi `✅ Connected`; danh sách kho
vẫn hiện, không chớp spinner, dữ liệu mới (tạo ở tab khác lúc ẩn) xuất hiện sau khi quay lại.
