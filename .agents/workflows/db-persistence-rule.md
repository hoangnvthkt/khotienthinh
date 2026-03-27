---
description: Quy tắc bắt buộc - Tất cả dữ liệu phải được lưu vào Database (Supabase)
---

# Quy tắc: Dữ liệu phải được lưu vào Database

> **QUAN TRỌNG**: Tất cả dữ liệu được tạo ra trong ứng dụng PHẢI được lưu vào Supabase database. Không dùng localStorage, state-only, hoặc mock data cho production features.

## Checklist khi tạo tính năng mới

1. **Tạo bảng DB** (nếu cần): Sử dụng `apply_migration` hoặc SQL trực tiếp trên Supabase Dashboard
2. **Mapper**: Tạo hàm map `snake_case` (DB) ↔ `camelCase` (TypeScript)
3. **CRUD Operations**: Tất cả create/update/delete phải gọi `supabase.from('table').insert/update/delete`
4. **Load on mount**: Dữ liệu phải được fetch từ DB khi app khởi động (trong `AppContext` hoặc module context)
5. **Verify persistence**: Sau khi save, refresh (F5) phải giữ nguyên dữ liệu

## Lưu ý khi thêm column mới vào bảng có sẵn

1. Chạy `ALTER TABLE ... ADD COLUMN` trên Supabase
2. Cập nhật mapper (`mapXxxFromDB`) để đọc column mới
3. Cập nhật hàm `create` và `update` để ghi column mới
4. **VERIFY**: Kiểm tra column thực sự tồn tại bằng cách query thử

## Anti-patterns (KHÔNG làm)

- ❌ Chỉ lưu vào React state mà không persist xuống DB
- ❌ Dùng localStorage cho dữ liệu quan trọng
- ❌ Giả định column DB đã tồn tại mà không verify
- ❌ Bỏ qua error handling khi gọi Supabase API
