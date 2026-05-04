# Quick Wins: Calendar View + Task Watchers

Triển khai 2 tính năng thiếu so với FastCons, cải thiện trải nghiệm quản lý tiến độ thi công.

---

## 1. Quick Win 1 — Calendar View cho Nhật Ký Thi Công

Thêm chế độ xem **Lịch tháng** cho DailyLogTab. Mỗi ô ngày hiển thị dot indicator + emoji thời tiết. Click vào ô → mở nhật ký chi tiết hoặc tạo mới.

### Thay đổi trên DailyLogTab.tsx

1. **State mới:** `viewMode: 'list' | 'calendar'` — toggle giữa danh sách (hiện tại) và lịch.
2. **Toggle buttons** trong thanh header (cạnh nút "Ghi nhật ký"): icon `LayoutList` (list) và `Calendar` (calendar).
3. **Calendar grid component** (inline, không tách file riêng):
   - Header: `CN T2 T3 T4 T5 T6 T7`
   - 6 hàng × 7 cột, mỗi ô = 1 ngày trong tháng đang chọn.
   - Nếu ngày có nhật ký → hiển thị:
     - Dot indicator (emerald = verified, amber = submitted, slate = draft, red = rejected)
     - Emoji thời tiết nhỏ
     - Số nhân công (nếu có)
   - Click ô có log → mở `openEdit(log)`
   - Click ô trống → mở form tạo mới với `fDate = ngày đó`
   - Ngày hôm nay: viền highlight
   - Ngày ngoài tháng: mờ
4. **Điều hướng tháng** (nút ← →) thay cho select dropdown khi ở calendar mode.
5. Giữ nguyên hoàn toàn logic danh sách hiện tại khi `viewMode === 'list'`.

**Thiết kế visual:**
- Calendar grid dùng `grid grid-cols-7`.
- Ô ngày: `min-h-[80px]`, border nhẹ, hover effect.
- Dot indicator: `w-2 h-2 rounded-full` màu theo status.
- Style nhất quán với design system hiện tại (rounded-2xl, shadow-sm, slate palette).

---

## 2. Quick Win 2 — Task Watchers (Người theo dõi)

Cho phép gán nhiều người theo dõi cho mỗi công việc trong Gantt. Khi task thay đổi trạng thái (progress, gate), tự động gửi notification cho watchers.

### Thay đổi SQL (Migration)
```sql
ALTER TABLE public.project_tasks
  ADD COLUMN IF NOT EXISTS watchers text[] DEFAULT '{}';
```
> **Lưu ý:** Dùng `text[]` (PostgreSQL array) thay vì bảng join riêng vì số lượng watchers per task nhỏ (< 10) và không cần query ngược "task nào tôi đang theo dõi".

### Thay đổi types.ts
Thêm field vào `ProjectTask`:
```typescript
// Quick Win: Watchers
watchers?: string[];  // User IDs theo dõi công việc
```

### Thay đổi GanttTab.tsx
1. **Form modal:** Thêm multi-select "Người theo dõi" dưới field "Phụ trách":
   - Load danh sách project staff từ `projectStaffService`.
   - Hiển thị dạng chip/tag, click để thêm/xóa.
   - Form state: `fWatchers: string[]`.
2. **Table view:** Không cần hiện cột riêng (quá rộng). Thay vào đó, nếu task có watchers > 0, hiển thị icon 👁 nhỏ bên cạnh tên assignee.
3. **Notification auto-send:** Khi `updateProgress()` hoặc `handleGateApproval()` thay đổi trạng thái, gửi notification cho tất cả `task.watchers` (trừ user hiện tại).

### Thay đổi projectService.ts
`watchers` sẽ map tự động qua `toSnake`/`toCamel`. Không cần thay đổi gì — PostgreSQL `text[]` serialize/deserialize qua Supabase client tự nhiên.

---

## 3. Thứ Tự Triển Khai

| Bước | Nội dung | Ước tính |
|------|---------|----------|
| 1 | Migration: thêm `watchers text[]` | 1 phút |
| 2 | `types.ts`: thêm `watchers?: string[]` | 1 phút |
| 3 | `DailyLogTab.tsx`: Calendar View | 15 phút |
| 4 | `GanttTab.tsx`: Watchers UI + notification | 10 phút |
| 5 | Verify: `tsc` + `build` | 2 phút |
