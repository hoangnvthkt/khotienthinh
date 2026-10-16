// Đọc phiếu giao NCC (Kho Đợt 1). Lời nhắc + lược đồ dùng chung cho mọi nhà cung cấp AI.
// Rút từ đợt 0 (46 trang scan SMB 01–11/10/2026): phiếu in, viết tay, giấy than, bê tông theo xe, biên bản nhiều xe cùng số.

export const DOC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['docType', 'supplierName', 'supplierTaxCode', 'supplierAddress', 'docNo', 'docDate', 'docTime', 'truckNo', 'lines', 'warnings'],
  properties: {
    docType: { type: 'string', enum: ['phieu_giao', 'bien_ban_giao_nhan', 'phieu_xuat_ncc', 'phieu_be_tong', 'hoa_don_ban_le', 'phieu_nhap_noi_bo', 'khac'] },
    supplierName: { type: ['string', 'null'] },
    supplierTaxCode: { type: ['string', 'null'] },
    supplierAddress: { type: ['string', 'null'] },
    docNo: { type: ['string', 'null'] },
    docDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    docTime: { type: ['string', 'null'], description: 'HH:MM' },
    truckNo: { type: ['string', 'null'] },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'unit', 'qty', 'note', 'confidence'],
        properties: {
          name: { type: 'string' },
          unit: { type: ['string', 'null'] },
          qty: { type: ['number', 'null'] },
          note: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const DOC_PROMPT = `Bạn đọc ảnh chứng từ giao hàng tại kho công trường của Công ty Tiến Thịnh (bên NHẬN hàng). Trả JSON đúng lược đồ.

Quy tắc:
- supplierName: bên GIAO hàng (tên công ty / cửa hàng in ở đầu phiếu hoặc mục "Bên giao", "Đơn vị giao hàng", dấu đỏ). Không lấy Tiến Thịnh.
- supplierTaxCode: mã số thuế bên GIAO nếu in trên phiếu (chỉ chữ số và dấu gạch), không có thì null. supplierAddress: địa chỉ bên GIAO nếu có.
- docNo: số phiếu / số biên bản / số docket của NCC đúng như in. docDate YYYY-MM-DD (ngày Việt Nam dd/mm/yyyy). docTime giờ giao nếu có.
- truckNo: biển số xe (VD 29CD-00280, 15H 21307), viết hoa.
- lines: mỗi dòng hàng THỰC GIAO. name giữ nguyên tên + quy cách như trên phiếu. unit là đơn vị trên phiếu.
- qty là SỐ (number). Chú ý định dạng: phiếu Việt thường dùng dấu chấm phân cách nghìn và dấu phẩy thập phân (1.332,42); một số NCC in dấu chấm thập phân (530.103 m² với 74 tấm × 0,45 × 15,919); kiểu Mỹ 1,442.00. Kiểm chéo bằng số tấm × kích thước, cộng dòng = tổng khi có.
- Phiếu bê tông: một dòng "Bê tông <mác>" với qty = Thể tích (m³) của xe này, KHÔNG lấy tích lũy; ghi số chì, giờ xong vào note.
- Biên bản nhiều nhóm: lấy dòng chi tiết có số lượng, không lấy dòng tổng nhóm.
- Dòng bị gạch bỏ: bỏ qua. Dấu tay ghi thiếu ("có 1 cái", "không có (0)"): qty = số thực nhận, note ghi số trên phiếu in.
- Chữ không chắc: vẫn ghi giá trị đoán được, confidence "low", và thêm một câu vào warnings. Không bịa: không đọc được thì qty null.
- warnings: tổng ghi tay không khớp cộng dòng, số viết đè, ngày giao khác ngày ghi, tiền viết tắt theo nghìn đồng…`;

export interface DocLine { name: string; unit: string | null; qty: number | null; note: string | null; confidence: 'high' | 'low' }
export interface DocRead { docType: string; supplierName: string | null; supplierTaxCode: string | null; supplierAddress: string | null; docNo: string | null; docDate: string | null; docTime: string | null; truckNo: string | null; lines: DocLine[]; warnings: string[] }

/** Chuẩn hóa kết quả AI trước khi lưu: cắt chuỗi, bỏ dòng rỗng, ngày hợp lệ. */
export const normalizeRead = (raw: unknown): DocRead => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 200) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const date = str(r.docDate, 10);
  const lines = Array.isArray(r.lines) ? r.lines : [];
  return {
    docType: str(r.docType, 40) || 'khac',
    supplierName: str(r.supplierName),
    supplierTaxCode: str(r.supplierTaxCode, 20)?.replace(/[^0-9-]/g, '') || null,
    supplierAddress: str(r.supplierAddress, 300),
    docNo: str(r.docNo, 60),
    docDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : null,
    docTime: str(r.docTime, 5),
    truckNo: str(r.truckNo, 20)?.toUpperCase() ?? null,
    lines: lines.slice(0, 80).flatMap(l => {
      const x = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const name = str(x.name, 300);
      if (!name) return [];
      const qty = typeof x.qty === 'number' && Number.isFinite(x.qty) && x.qty >= 0 ? x.qty : null;
      return [{ name, unit: str(x.unit, 20), qty, note: str(x.note, 300), confidence: x.confidence === 'high' && qty != null ? 'high' : 'low' } as DocLine];
    }),
    warnings: (Array.isArray(r.warnings) ? r.warnings : []).map(w => str(w, 300)).filter((w): w is string => !!w).slice(0, 20),
  };
};
