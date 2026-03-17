---
description: Pattern chuẩn để import dữ liệu từ file Excel vào hệ thống KhoTienThinh
---

# Excel Import Pattern

Khi cần thêm chức năng nhập dữ liệu hàng loạt từ file Excel, áp dụng pattern sau:

## 1. Dependencies
```tsx
import * as XLSX from 'xlsx'; // đã có sẵn trong package.json
import { Upload, Download, FileSpreadsheet, CheckCircle2, Loader2, XCircle } from 'lucide-react';
```

## 2. State
```tsx
const [showImportModal, setShowImportModal] = useState(false);
const [importRows, setImportRows] = useState<Array<Record<string, any>>>([]);
const [importErrors, setImportErrors] = useState<Record<number, string>>({});
const [importing, setImporting] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);
```

## 3. Template Download
- Tạo file mẫu `.xlsx` với headers đúng format
- Có 1 dòng dữ liệu mẫu
- Set column widths

## 4. File Upload Handler
- Đọc file bằng `FileReader.readAsArrayBuffer`
- Parse bằng `XLSX.read(data, { type: 'array' })`
- `XLSX.utils.sheet_to_json(ws, { defval: '' })` → mảng objects
- Validate từng dòng: required fields, data types, foreign key references
- Ghi lỗi vào `importErrors[rowIndex]`

## 5. Bulk Import Handler
- Filter chỉ dòng hợp lệ (không có trong `importErrors`)
- Gọi `addXxx()` cho từng dòng
- Toast thành công + đóng modal

## 6. UI Components
- **Nút "Tải mẫu"** (xanh lá) + **"Nhập Excel"** (xanh dương)
- **Hidden `<input type="file">`** triggered bởi nút
- **Preview modal** full-width với bảng xem trước
- Dòng lỗi highlight đỏ, dòng OK hiện ✅
- Footer hiện số lượng hợp lệ/lỗi + nút "Nhập X tài sản"

## Tham khảo
- `AssetCatalog.tsx` — mẫu triển khai đầy đủ
