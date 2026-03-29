---
description: Checklist thêm Module mới vào hệ thống (phân quyền, sidebar, routing, quản trị)
---

# Checklist thêm Module / Sub-Module mới

Khi tạo bất kỳ trang master data mới nào, **BẮT BUỘC** thực hiện các bước sau:

## 1. Đăng ký sub-module trong UserModal.tsx

Mở `components/UserModal.tsx`, tìm `SUB_MODULE_MAP` và thêm entry:

```tsx
const SUB_MODULE_MAP = {
  // ...
  newModule: [
    { route: '/new-module/sub1', label: 'Tên sub-module' },
  ],
};
```

## 2. Gate CRUD trong trang mới

Trong mỗi trang `.tsx` mới, áp dụng pattern:

```tsx
import { usePermission } from '../../hooks/usePermission';

// Trong component:
const { canManage } = usePermission();
const canCRUD = canManage('/new-module/sub1'); // route khớp SUB_MODULE_MAP

// Wrap tất cả nút Thêm/Sửa/Xoá:
{canCRUD && <button>Thêm mới</button>}
{canCRUD && <button>Sửa</button>}
{canCRUD && <button>Xoá</button>}
```

## 3. Phân biệt Master Data vs Work Items

| Loại | Ai được CRUD | Ví dụ |
|------|-------------|-------|
| **Master Data** | Chỉ canManage = true | Hồ sơ NV, Tài sản, Danh mục... |
| **Work Items** | Người tạo (chưa duyệt) | Yêu cầu, Đề xuất, Chấm công... |
| **Settings** | Chỉ Admin (Role.ADMIN) | Cài đặt hệ thống, Kho, User... |

## 4. Quy tắc xoá

- Nhân viên chỉ xoá work items **do chính mình tạo** và **chưa được duyệt**
- Chỉ Admin hệ thống mới xoá được dữ liệu **đã duyệt**

## 5. Không cần sửa thêm

- ❌ Không sửa `types.ts` (adminSubModules đã là Record<string, string[]>)
- ❌ Không sửa `AppContext.tsx` (JSONB lưu dynamic)
- ❌ Không sửa `usePermission.ts` (logic chung)
- ❌ Không cần migration DB
