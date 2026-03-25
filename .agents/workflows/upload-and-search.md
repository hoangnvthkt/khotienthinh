---
description: Pattern chuẩn để triển khai Upload file lên Supabase Storage và Tìm kiếm tiếng Việt (có dấu + không dấu)
---

# Upload File & Tìm kiếm tiếng Việt — Pattern chuẩn

## 1. Upload File lên Supabase Storage

### ⚠️ Gotchas quan trọng

1. **Tên file tiếng Việt** — Supabase Storage **KHÔNG chấp nhận** ký tự Unicode (dấu tiếng Việt, khoảng trắng) trong storage path.
   - ❌ `employees/uuid_báo giá cam.docx` → `StorageApiError: Invalid key`
   - ✅ `employees/uuid.docx` — chỉ dùng UUID + extension
   - Lưu tên gốc tiếng Việt trong cột `file_name` của DB để hiển thị

2. **Explicit `id`** — Luôn truyền `id: crypto.randomUUID()` trong object insert, giống pattern `documentService.ts`.

3. **Error handling** — **KHÔNG** dùng `console.error` rồi `return null` im lặng. Phải `alert()` lỗi ra cho user thấy.

4. **Upload modal** — Khi modal mở mà chưa có file, **PHẢI** hiển thị dropzone/file picker. Dùng `condition ? fileList : dropzone`, **KHÔNG** dùng `condition && fileList` (sẽ ẩn hoàn toàn).

### Template code — Service upload function

```typescript
async upload(file: File, meta: { ... }): Promise<Doc | null> {
  // 1. Validate
  const v = this.validateFile(file);
  if (!v.valid) { alert(v.error); return null; }

  // 2. Sanitize path — CHỈ dùng UUID + extension
  const uuid = crypto.randomUUID();
  const ext = file.name.split('.').pop() || 'bin';
  const storagePath = `${folder}/${uuid}.${ext}`;

  // 3. Upload to storage
  const { error: uploadError } = await supabase.storage
    .from(BUCKET).upload(storagePath, file, { upsert: false });
  if (uploadError) {
    alert('Lỗi tải file: ' + uploadError.message);
    return null;
  }

  // 4. Insert metadata — explicit id
  const doc = {
    id: crypto.randomUUID(),
    file_name: file.name,          // tên gốc tiếng Việt
    file_type: file.type || 'application/octet-stream',
    file_size: file.size,
    storage_path: storagePath,     // path đã sanitize
    // ... other fields
  };

  const { data, error } = await supabase.from('table').insert(doc).select().single();
  if (error) {
    alert('Lỗi lưu dữ liệu: ' + error.message);
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return null;
  }
  return toCamel(data);
}
```

### Template code — Upload modal file picker

```tsx
{/* ĐÚNG: dùng ternary để luôn hiện file picker */}
{uploadFiles.length > 0 ? (
  <div>{/* file list + "Thêm file" button */}</div>
) : (
  <div onClick={() => fileInputRef.current?.click()}
    className="cursor-pointer border-2 border-dashed ...">
    <Upload size={28} />
    <p>Nhấn để chọn file hoặc kéo thả vào đây</p>
  </div>
)}
```

---

## 2. Tìm kiếm tiếng Việt (Full-Text Search)

### Yêu cầu

- Extension: `CREATE EXTENSION IF NOT EXISTS unaccent;`
- Tìm "báo giá" → ra "báo giá" (exact)
- Tìm "bao gia" → cũng ra "báo giá" (unaccent fallback)

### Template — RPC search function

```sql
CREATE OR REPLACE FUNCTION search_table(
  search_text TEXT DEFAULT '',
  type_filter TEXT DEFAULT NULL
)
RETURNS SETOF my_table
LANGUAGE plpgsql
AS $$
DECLARE
  plain TEXT;
BEGIN
  IF search_text IS NULL OR search_text = '' THEN
    RETURN QUERY SELECT * FROM my_table
    WHERE (type_filter IS NULL OR type = type_filter)
    ORDER BY created_at DESC LIMIT 200;
  ELSE
    plain := unaccent(lower(search_text));
    RETURN QUERY SELECT d.* FROM my_table d
    LEFT JOIN related_table r 
      ON d.related_id IS NOT NULL AND d.related_id::uuid = r.id
    WHERE 
      (type_filter IS NULL OR d.type = type_filter)
      AND (
        -- Exact Vietnamese (có dấu)
        d.title ILIKE '%' || search_text || '%'
        OR d.name ILIKE '%' || search_text || '%'
        -- Unaccented fallback (không dấu cũng tìm được)
        OR unaccent(lower(d.title)) LIKE '%' || plain || '%'
        OR unaccent(lower(d.name)) LIKE '%' || plain || '%'
        -- Full-text vector
        OR d.search_vector @@ plainto_tsquery('simple', search_text)
      )
    ORDER BY d.created_at DESC LIMIT 100;
  END IF;
END;
$$;
```

### ⚠️ Gotchas tìm kiếm

1. **Type cast khi JOIN** — Nếu cột FK là `text` nhưng PK bảng kia là `uuid`, phải cast: `d.employee_id::uuid = e.id`. Nếu không sẽ lỗi `operator does not exist: text = uuid`.

2. **NULL-safe JOIN** — Thêm `d.employee_id IS NOT NULL AND` trước cast để tránh lỗi cast NULL sang uuid.

3. **COALESCE** cho nullable columns — `COALESCE(d.sender, '')` trước khi ILIKE/unaccent.

4. **search_vector trigger** — Nên index cả bản gốc VÀ bản unaccent:
```sql
NEW.search_vector := 
  to_tsvector('simple', COALESCE(NEW.title, '')) ||
  to_tsvector('simple', COALESCE(unaccent(NEW.title), ''));
```

---

## 3. Dynamic Categories (CRUD danh mục)

### Nguyên tắc
**Tất cả trường dữ liệu phân loại phải CRUD được**, không hardcode.

### Template — Categories table
```sql
CREATE TABLE module_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module TEXT NOT NULL,        -- phân biệt theo module/tab
  key TEXT NOT NULL,           -- slug dùng trong code
  label TEXT NOT NULL,         -- hiển thị
  icon TEXT DEFAULT '📁',
  color TEXT DEFAULT 'bg-slate-50 text-slate-600 border-slate-200',
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ON module_categories(module, key);
```

### Service methods cần có
- `listCategories(module?)` — fetch active, order by sort_order
- `addCategory({ module, key, label, icon })`
- `updateCategory(id, { label, icon })`
- `deleteCategory(id)`
