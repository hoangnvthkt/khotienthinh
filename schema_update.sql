
-- Cập nhật bảng users để hỗ trợ đăng nhập
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;

-- Tạo index cho username để tìm kiếm nhanh khi đăng nhập
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Cập nhật dữ liệu mẫu cho các user hiện tại nếu cần (Ví dụ)
-- UPDATE users SET username = SPLIT_PART(email, '@', 1) WHERE username IS NULL;
-- UPDATE users SET password = '123' WHERE password IS NULL;
