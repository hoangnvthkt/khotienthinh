---
description: Pattern chuẩn để import dữ liệu từ file Excel vào hệ thống KhoTienThinh
---

# Excel Import Pattern

Pattern đã được kiểm chứng và hoạt động tốt. Áp dụng cho mọi tính năng cần import Excel.

> **QUAN TRỌNG:** Nhiều file Excel VN (Đề nghị duyệt giá, Báo cáo, Bảng kê...) có header phức tạp (tên công ty, tiêu đề...) trước bảng dữ liệu thật. LUÔN dùng Smart Header Detection bên dưới.

## 0. Smart Header Detection (BẮT BUỘC)

Đọc raw 2D array → quét 30 dòng đầu tìm dòng header thật → parse dữ liệu từ đó:

```tsx
const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const headerKeywords = ['thành tiền', 'đơn giá', 'số tiền', 'số lượng', 'tên hàng', 'stt', 'hạng mục', 'mô tả', 'nội dung'];
let headerRowIdx = -1, headerCols: string[] = [];
for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
    const cellTexts = rawRows[r]?.map((c: any) => String(c || '').toLowerCase().trim()) || [];
    if (cellTexts.filter((t: string) => headerKeywords.some(kw => t.includes(kw))).length >= 2) {
        headerRowIdx = r;
        headerCols = rawRows[r].map((c: any) => String(c || '').trim());
        break;
    }
}
let rows: any[];
if (headerRowIdx >= 0) {
    rows = [];
    for (let r = headerRowIdx + 1; r < rawRows.length; r++) {
        const obj: any = {};
        headerCols.forEach((col, i) => { if (col) obj[col] = rawRows[r]?.[i] ?? ''; });
        if (Object.values(obj).some(v => v)) rows.push(obj);
    }
} else {
    rows = XLSX.utils.sheet_to_json(ws); // fallback
}
```

## 1. File Input (Hidden + Label trigger)

Dùng `<label htmlFor>` thay vì `ref.click()` để trigger file dialog — ổn định hơn trên mọi trình duyệt:

```tsx
<label htmlFor="import-file-input"
  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-green-600 bg-green-50 border border-green-200 hover:bg-green-100 cursor-pointer">
  <Upload size={14} /> Import Excel
</label>
<input id="import-file-input" type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
  onChange={handleImportExcel} />
```

## 2. Handler Function

```tsx
const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Validate context (e.g. selected project, selected site)
    if (!requiredContext) { alert('Vui lòng chọn ... trước khi import'); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const data = new Uint8Array(ev.target?.result as ArrayBuffer);
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows: any[] = XLSX.utils.sheet_to_json(ws);
            console.log('[Import] Sheet:', wb.SheetNames[0], 'Rows:', rows.length);
            if (rows.length > 0) console.log('[Import] Columns:', Object.keys(rows[0]));

            if (rows.length === 0) { alert('File rỗng hoặc không có dữ liệu'); return; }

            // Parse rows using fuzzy column finder
            const items = rows.map((row, i) => {
                const val1 = findCol(row, ['tên cột 1', 'ten cot 1', 'column1']);
                const val2 = findCol(row, ['tên cột 2', 'ten cot 2', 'column2']);
                // ... map to your data structure
                return { id: crypto.randomUUID(), ...mappedData };
            }).filter(item => /* validation */);

            if (items.length > 0) {
                addItems(items); // batch add
                alert(`✅ Import thành công ${items.length}/${rows.length} dòng từ "${file.name}"`);
            } else {
                const cols = rows.length > 0 ? Object.keys(rows[0]).join(', ') : 'N/A';
                alert(`❌ Không tìm thấy dữ liệu hợp lệ.\n\nCột trong file: ${cols}\n\nCần: ...`);
            }
        } catch (err: any) {
            console.error('[Import] Error:', err);
            alert(`Lỗi đọc file: ${err.message}`);
        }
    };
    reader.readAsArrayBuffer(file); // KHÔNG dùng readAsBinaryString
    e.target.value = '';
};
```

## 3. Fuzzy Column Finder (QUAN TRỌNG)

Tìm cột theo tên fuzzy — hỗ trợ cả tiếng Việt có dấu/không dấu, tên tiếng Anh, và partial match:

```tsx
const findCol = (row: any, patterns: string[]) => {
    const keys = Object.keys(row);
    // Exact match first
    for (const p of patterns) {
        const exact = keys.find(k => k.toLowerCase().trim() === p);
        if (exact) return row[exact];
    }
    // Partial match
    for (const p of patterns) {
        const partial = keys.find(k =>
            k.toLowerCase().trim().includes(p) || p.includes(k.toLowerCase().trim())
        );
        if (partial) return row[partial];
    }
    return undefined;
};
```

## 4. Utility Parsers

### Parse số tiền (VND format)
```tsx
const parseAmount = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const cleaned = String(val).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    return Number(cleaned) || 0;
};
```

### Parse ngày (Excel serial + DD/MM/YYYY)
```tsx
const parseDate = (val: any): string => {
    if (!val) return new Date().toISOString().slice(0, 10);
    if (typeof val === 'number') {
        const d = new Date((val - 25569) * 86400 * 1000);
        return d.toISOString().slice(0, 10);
    }
    const s = String(val).trim();
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    return s || new Date().toISOString().slice(0, 10);
};
```

## 5. Key Rules

- **LUÔN dùng `readAsArrayBuffer`** + `XLSX.read(data, { type: 'array' })` — KHÔNG dùng `readAsBinaryString`
- **LUÔN dùng fuzzy column finder** — user có thể đặt tên cột khác nhau
- **LUÔN phát hiện dòng tổng** — Nếu file có dòng "Tổng số", "Total", "Tổng cộng", "Sum" → CHỈ import dòng tổng (tránh tính trùng). Nếu không có → import tất cả dòng chi tiết
- **LUÔN có alert kết quả** — cho user biết thành công bao nhiêu dòng hoặc lý do thất bại (kèm tên cột trong file)
- **LUÔN có try-catch** — bắt lỗi đọc file và hiển thị message
- **LUÔN có console.log** — log sheet name, row count, column names, và mỗi row parse để debug
- **LUÔN reset `e.target.value = ''`** — cho phép import lại cùng file
- **Hỗ trợ Vietnamese**: cả có dấu và không dấu, viết tắt phổ biến

## 6. Total Row Detection Pattern

```tsx
const totalKeywords = ['tổng số', 'tong so', 'tổng cộng', 'tong cong', 'tổng số tiền', 'total', 'tổng', 'cộng', 'sum', 'grand total', 'subtotal'];

const isTotalRow = (row: any): boolean => {
    for (const val of Object.values(row)) {
        if (typeof val === 'string') {
            const lower = val.toLowerCase().trim();
            if (totalKeywords.some(kw => lower === kw || lower.startsWith(kw + ' ') || lower.startsWith(kw + ':') || lower.endsWith(' ' + kw))) return true;
        }
    }
    return false;
};

// Usage:
const allParsed = rows.map(row => ({ tx: parseRow(row), isTotal: isTotalRow(row) })).filter(p => p.tx.amount > 0);
const totalRows = allParsed.filter(p => p.isTotal);
const detailRows = allParsed.filter(p => !p.isTotal);
const txs = totalRows.length > 0 ? totalRows.map(p => p.tx) : detailRows.map(p => p.tx);
```
