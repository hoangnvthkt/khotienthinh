---
description: Pattern chuẩn để triển khai Dashboard tổng hợp cho bất kỳ module nào (KPI, biểu đồ, bảng xếp hạng, drill-down, bộ lọc thời gian)
---

# Workflow: Triển khai Dashboard Module

Pattern chuẩn đã áp dụng thành công cho **Dashboard Quy Trình** (`WorkflowDashboard.tsx`). Dùng lại cho bất kỳ module nào cần dashboard tổng hợp.

## Tham khảo mẫu

- **File mẫu hoàn chỉnh**: `pages/wf/WorkflowDashboard.tsx`
- **Thư viện biểu đồ**: `recharts` (đã cài sẵn trong project)
- **Icons**: `lucide-react`

## Các bước triển khai

### 1. Phân tích dữ liệu module

Xác định rõ:
- **Entities chính** cần thống kê (VD: instances, tasks, requests...)
- **Trạng thái** của entity (VD: RUNNING, COMPLETED, REJECTED, CANCELLED)
- **Chỉ số thời gian** (SLA, deadline, ngày tạo, ngày hoàn thành)
- **Người liên quan** (người tạo, người xử lý, người được giao)
- **Phân loại** (theo template, loại, nhóm...)

### 2. Tạo file Dashboard component

Tạo file mới tại `pages/<module>/<Module>Dashboard.tsx` với cấu trúc:

```tsx
// === IMPORTS ===
import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
// + lucide-react icons
// + context hooks (useApp, useModule...)

// === TYPES ===
interface DrillDownData {
  title: string;
  items: YourEntityType[];    // Thay bằng entity type thực tế
}

// === DATE FILTER (copy nguyên từ WorkflowDashboard) ===
type DatePreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all';

const getPresetRange = (preset: DatePreset): { from: string; to: string } => {
  const now = new Date();
  const toStr = (d: Date) => d.toISOString().slice(0, 10);
  const today = toStr(now);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'week': {
      const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1);
      return { from: toStr(d), to: today };
    }
    case 'month': return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, to: today };
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      return { from: `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`, to: today };
    }
    case 'year': return { from: `${now.getFullYear()}-01-01`, to: today };
    case 'all': return { from: '', to: '' };
  }
};

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Hôm nay', week: 'Tuần này', month: 'Tháng này',
  quarter: 'Quý này', year: 'Năm nay', all: 'Tất cả',
};
```

### 3. Component Structure (theo thứ tự trong JSX)

```
┌─────────────────────────────────────────────┐
│ Header: Tiêu đề + Mô tả                    │
├─────────────────────────────────────────────┤
│ Filter Bar: Presets + Date Inputs           │
├────┬────┬────┬────┬────┬────┬────┬─────────┤
│KPI1│KPI2│KPI3│KPI4│KPI5│KPI6│KPI7│  (7 col)│  ← Click = drill-down
├────────────────────┬────────────────────────┤
│  Pie Chart         │  Bar Chart             │  ← 2 col grid
├─────┬─────┬────────┴──────┬─────────────────┤
│Rank1│Rank2│ Rank3         │ Rank4           │  ← 4 col grid, click = drill-down
├─────────────────────────────────────────────┤
│ Table: Phân tích chi tiết (VD: bottleneck)  │  ← Nút "Xem" = drill-down
├─────────────────────────────────────────────┤
│ Drill-Down Modal (overlay khi click)        │
└─────────────────────────────────────────────┘
```

### 4. Các khối logic quan trọng (useMemo)

Mỗi khối phải dùng `filteredItems` (đã lọc theo thời gian), KHÔNG dùng raw data:

```tsx
// 1. filteredItems — lọc entity chính theo dateFrom/dateTo
const filteredItems = useMemo(() => {
  if (!dateFrom && !dateTo) return allItems;
  return allItems.filter(i => {
    const d = i.createdAt.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}, [allItems, dateFrom, dateTo]);

// 2. stats — KPI numbers (dùng filteredItems)
// 3. pieData — data cho Pie chart
// 4. barData — data cho Bar chart
// 5. rankings — bảng xếp hạng NV/đối tượng
// 6. analysisData — phân tích chi tiết (bottleneck, delay...)
```

### 5. KPI Card Pattern

```tsx
<button onClick={() => openDrillDown(label, list)}
  className="glass-panel rounded-2xl p-4 text-left hover:shadow-lg hover:scale-[1.02] transition-all group cursor-pointer">
  <div className="w-9 h-9 rounded-xl bg-gradient-to-br {color} flex items-center justify-center text-white shadow-sm mb-2">
    <Icon size={18} />
  </div>
  <p className="text-2xl font-black">{value}</p>
  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
  <p className="text-[9px] text-violet-400 font-bold mt-1 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5">
    Xem chi tiết <ChevronRight size={10} />
  </p>
</button>
```

### 6. Drill-Down Modal Pattern

```tsx
{drillDown && (
  <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
      {/* Header gradient */}
      <div className="px-6 py-4 bg-gradient-to-r from-violet-500 to-purple-500 rounded-t-3xl flex items-center justify-between">
        <span className="font-bold text-lg text-white">{drillDown.title} ({drillDown.items.length})</span>
        <button onClick={() => setDrillDown(null)}>X</button>
      </div>
      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto divide-y">
        {drillDown.items.map(item => (
          <div key={item.id} className="px-6 py-3">
            {/* Render item details: code, status badge, người tạo, ngày */}
          </div>
        ))}
      </div>
    </div>
  </div>
)}
```

### 7. Ranking Card Pattern

```tsx
<button onClick={() => openDrillDown(title, emp.itemList)}
  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl {bg} hover:shadow-md transition-all">
  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white {medal_color}">
    {rank}
  </span>
  <p className="text-xs font-bold truncate">{name}</p>
  <span className="text-sm font-black {color}">{count}</span>
  <ChevronRight size={12} />
</button>
```

### 8. Đăng ký route + sidebar

1. **`App.tsx`**: Thêm lazy import + `<Route path="xx/dashboard" element={<XxDashboard />} />`
2. **`Sidebar.tsx`**: Thêm `{ to: '/xx/dashboard', icon: LayoutDashboard, label: 'Dashboard XX' }` vào đầu mảng nav của module tương ứng trong `moduleNavMap`

### 9. Checklist kiểm tra

- [ ] KPI cards hiển thị đúng số liệu
- [ ] Click KPI → modal hiện đúng danh sách
- [ ] Pie chart + Bar chart render đúng
- [ ] Bảng xếp hạng hiển thị top 5, click → drill-down
- [ ] Bảng phân tích chi tiết (nếu có) hiển thị đúng
- [ ] Bộ lọc thời gian: 6 presets hoạt động, date input hoạt động
- [ ] Khi lọc → tất cả sections cập nhật realtime
- [ ] Badge hiển thị "X/Y phiếu" khi lọc
- [ ] Không có console error
- [ ] Responsive trên mobile/tablet

## Lưu ý quan trọng

1. **Luôn dùng `filteredItems`** thay vì raw data trong mọi useMemo
2. **Deduplicate trong drill-down**: `Array.from(new Map(list.map(i => [i.id, i])).values())`
3. **Gradient colors theo module**: Mỗi module dùng gradient riêng (violet cho QT, teal cho NS, emerald cho KHO...)
4. **Glass-panel**: Dùng class `glass-panel` cho container chính
5. **Recharts responsive**: Luôn wrap trong `<ResponsiveContainer width="100%" height={250}>`
