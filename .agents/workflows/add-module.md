---
description: Checklist thêm Module mới vào hệ thống (phân quyền, sidebar, routing, quản trị)
---

# Thêm Module Mới

Khi tạo một module mới (ví dụ: RQ, TS, DA...), thực hiện theo các bước sau:

## 1. Sidebar — `components/Sidebar.tsx`

Thêm entry vào `MODULE_CONFIG`:
```ts
{ key: 'XX' as const, icon: IconName, label: 'XX - Tên module', shortLabel: 'XX',
  gradient: 'from-color-500 to-color-600', shadow: 'shadow-color-500/30',
  color: 'text-color-600 dark:text-color-400', bg: 'bg-color-50 dark:bg-color-900/30',
  border: 'border-color-200 dark:border-color-700', route: '/xx' },
```

Thêm URL detection trong `detectAppFromUrl()`:
```ts
if (p.startsWith('/xx')) return 'XX';
```

Thêm nav items vào `moduleNavMap`:
```ts
XX: [
  { to: '/xx', icon: IconName, label: 'Trang chính' },
  { to: '/xx/settings', icon: Settings, label: 'Cài đặt', roles: [Role.ADMIN] },
],
```

## 2. Phân quyền Module — `components/UserModal.tsx`

Thêm vào `ALL_MODULES`:
```ts
{ key: 'XX', label: 'XX - Tên module', icon: IconName,
  color: 'text-color-600 bg-color-50 border-color-200 dark:bg-color-900/30 dark:border-color-700' },
```

> [!IMPORTANT]
> Sidebar tự động lọc module theo `user.allowedModules`. UserModal là nơi duy nhất cần cập nhật để phân quyền hoạt động.

## 3. Routing — `App.tsx`

Import các page component và thêm routes:
```tsx
import XxPage from './pages/xx/XxPage';
// ...
<Route path="xx" element={<XxPage />} />
```

Nếu module có Context Provider, wrap trong `App` component:
```tsx
<XxProvider>
  ...
</XxProvider>
```

## 4. Quản trị ứng dụng

Admin cấp quyền module cho user qua: **Cài đặt → Sửa user → Phân quyền Module** (checkbox).
Admin chỉ định "Quản trị viên ứng dụng" qua: **Sửa user → Quản trị ứng dụng** (checkbox).
