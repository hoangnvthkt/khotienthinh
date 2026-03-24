---
description: Pattern chuẩn để triển khai chữ ký số (Digital Signature) cho bất kỳ module nào — vẽ canvas, lưu Supabase Storage, nhúng vào Word
---

# Triển khai Chữ ký số (Digital Signature)

## Tổng quan
Cho phép user vẽ chữ ký tay trên canvas → lưu PNG (nền trong suốt) lên Supabase Storage → nhúng vào file Word khi xuất qua docxtemplater image module.

---

## 1. Database

```sql
CREATE TABLE IF NOT EXISTS public.user_signatures (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE,
    image_path TEXT NOT NULL,       -- path trong Supabase Storage
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.user_signatures ENABLE ROW LEVEL SECURITY;
-- Policies: SELECT/INSERT/UPDATE/DELETE cho authenticated
```

**Storage**: Bucket `workflow-templates`, path `signatures/{userId}.png`
**RLS Storage**: Cần policies INSERT/SELECT/DELETE/UPDATE cho cả `authenticated` và `anon` roles.

---

## 2. Packages cần cài

```bash
npm install signature_pad open-docxtemplater-image-module
```

- `signature_pad` (~30KB) — thư viện JS thuần, vẽ chữ ký mượt trên canvas
- `open-docxtemplater-image-module` — module miễn phí nhúng ảnh vào docx

---

## 3. Type & Context

### types.ts
```typescript
export interface User {
  // ... existing fields
  signatureUrl?: string; // URL ảnh chữ ký số
}
```

### AppContext.tsx — Thêm 2 hàm CRUD

```typescript
// Save: convert dataURL → blob → upload Storage → upsert DB → update local state
const saveSignature = async (userId: string, dataUrl: string): Promise<boolean> => {
  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) await supabase.auth.refreshSession();
  
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const path = `signatures/${userId}.png`;
  
  const { error } = await supabase.storage.from('workflow-templates')
    .upload(path, blob, { contentType: 'image/png', upsert: true });
  if (error) return false;
  
  await supabase.from('user_signatures')
    .upsert({ user_id: userId, image_path: path }, { onConflict: 'user_id' });
  
  // Update local state with cache-busting URL
  const { data: urlData } = supabase.storage.from('workflow-templates').getPublicUrl(path);
  const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
  setUsers(prev => prev.map(u => u.id === userId ? { ...u, signatureUrl: publicUrl } : u));
  return true;
};

// Delete: remove Storage → delete DB → clear local state
const deleteSignature = async (userId: string): Promise<boolean> => {
  await supabase.storage.from('workflow-templates').remove([`signatures/${userId}.png`]);
  await supabase.from('user_signatures').delete().eq('user_id', userId);
  setUsers(prev => prev.map(u => u.id === userId ? { ...u, signatureUrl: undefined } : u));
  return true;
};
```

### Fetch signatures khi init
```typescript
// Sau khi fetch users, join signatures
const { data: sigData } = await supabase.from('user_signatures').select('*');
if (sigData) {
  const sigMap = new Map();
  for (const sig of sigData) {
    const { data } = supabase.storage.from('workflow-templates').getPublicUrl(sig.image_path);
    sigMap.set(sig.user_id, data.publicUrl);
  }
  mappedUsers.forEach(u => { if (sigMap.has(u.id)) u.signatureUrl = sigMap.get(u.id); });
}
```

---

## 4. Component — SignaturePad.tsx

File: `components/SignaturePad.tsx`

**Cấu trúc:**
- Modal overlay (fixed inset-0)
- Header: icon + title + close button
- Body: 2 modes
  - **View mode**: hiện ảnh chữ ký hiện tại + nút "Vẽ lại" / "Xóa"
  - **Draw mode**: canvas + nút "Lưu chữ ký" / "Xóa nét"

**Key implementation:**
```typescript
import SignaturePadLib from 'signature_pad';

// Init canvas
const pad = new SignaturePadLib(canvas, {
  backgroundColor: 'rgba(255,255,255,0)', // nền trong suốt
  penColor: '#1e293b',
  minWidth: 1.5, maxWidth: 3,
});

// Export
const dataUrl = pad.toDataURL('image/png');
```

**Props:**
```typescript
interface SignaturePadProps {
  currentSignatureUrl?: string;
  onSave: (dataUrl: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}
```

---

## 5. UI — Settings > Tài khoản

Thêm section "Chữ ký số" trong tab Tài khoản:
- Nếu đã có chữ ký → hiện preview (img) + nút "Thay đổi"
- Nếu chưa có → nút "Tạo chữ ký số" (border dashed)

---

## 6. Tích hợp Word Export

### Import image module
```typescript
// Dynamic import (lazy load)
let ImageModule: any = null;
try { ImageModule = (await import('open-docxtemplater-image-module')).default; } catch {}
```

### Collect signature images
```typescript
const imageMap: Record<string, ArrayBuffer> = {};
// Lấy chữ ký của mỗi approver đã duyệt
for (const log of instanceLogs) {
  const actor = users.find(u => u.id === log.actedBy);
  if (!actor?.signatureUrl) continue;
  const res = await fetch(actor.signatureUrl);
  if (res.ok) imageMap[`signature_${safeLabel}`] = await res.arrayBuffer();
}
```

### Attach module vào docxtemplater
```typescript
const modules: any[] = [];
if (ImageModule && Object.keys(imageMap).length > 0) {
  modules.push(new ImageModule({
    centered: false,
    getImage: (tag: string) => imageMap[tag] || new ArrayBuffer(0),
    getSize: () => [150, 60], // width x height in pixels
  }));
}

const doc = new Docxtemplater(zip, {
  paragraphLoop: true, linebreaks: true,
  delimiters: { start: '${', end: '}' },
  modules,
});

// Map signature keys
Object.keys(imageMap).forEach(key => { data[key] = key; });
```

### Placeholders trong file Word template
```
Người tạo: ${creator_name}          Chữ ký: {%signature_creator}
Người duyệt: ${approver_giam_doc}   Chữ ký: {%signature_giam_doc}
Ngày duyệt: ${approved_date_giam_doc}
```

> **Lưu ý**: Placeholder `{%...}` cho hình ảnh, `${...}` cho text.

---

## 7. Files tham chiếu

| File | Vai trò |
|------|---------|
| `components/SignaturePad.tsx` | Component vẽ chữ ký |
| `context/AppContext.tsx` | CRUD + fetch signatures |
| `pages/Settings.tsx` | UI section trong tab Tài khoản |
| `pages/wf/WorkflowInstances.tsx` | Word export QT |
| `pages/request/RequestList.tsx` | Word export RQ |
| `types.ts` | `signatureUrl` field |
