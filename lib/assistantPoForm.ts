// Trợ lý v2 · T2c — form đơn mua (PO chủ động) NGAY TRONG khung chat (chủ SP 18/10/2026): Trợ lý tách báo giá (NCC, dòng, đơn giá, VAT,
// ngày giao); người Mua hàng chọn mã (gợi ý bấm), NCC, lý do mua chủ động, người duyệt rồi Lưu nháp / Gửi duyệt tại chỗ.
// Khớp mã + quy đổi đơn vị dùng ĐÚNG hàm của màn Lập đơn chủ động (lib/procurementExcelImport: searchQueriesFor, pickCatalogMatch,
// toImportedLine); lưu / gửi gọi đúng lệnh của màn đó (save_procurement_proactive_po_v1, transition_procurement_hub_po_v1). AI không lưu gì.
import { supabase } from './supabase';
import { boqStatusOf, procurementInboxService, type ProcurementCatalogItem, type ProcurementVendor } from './procurementInboxService';
import { pickCatalogMatch, searchQueriesFor, toImportedLine, type PoImportRow } from './procurementExcelImport';
import { finishCommand, poView, type AssistantCommand, type PoReasonCode } from './assistantCommands';
import { parseNonNegativeLocaleNumber } from './localeNumberInput';
import { duplicateItemSpecProblems } from './materialLineDescription';
import { aiLearning, recall, type LearnedAlias } from './aiLearning';

export const PO_REASONS: Array<{ code: PoReasonCode; label: string }> = [
  { code: 'price_lock', label: 'Chốt giá tốt' }, { code: 'long_lead', label: 'Hàng đặt dài ngày' },
  { code: 'min_stock', label: 'Bù tồn tối thiểu' }, { code: 'other', label: 'Khác' },
];

export interface PoFormRow {
  key: string;
  /** Dòng báo giá Trợ lý tách (để chọn mã / quy đổi lại khi đổi mã). */
  source: PoImportRow;
  options: ProcurementCatalogItem[];
  item: ProcurementCatalogItem | null;
  /** 'suggested' = chỉ gần giống tên (≥ 50% từ trùng) — thẻ ghi "Gần giống · kiểm"; 'picked' = người dùng tự chọn. */
  confidence: 'sku' | 'name' | 'suggested' | 'picked' | 'memory' | null;
  altUnit: boolean;
  stockQty: string;
  purchaseQty: string;
  price: string;
  spec: string;
  warnings: string[];
}
export interface PoFormContext {
  warehouses: Array<{ id: string; name: string }>;
  approvers: Array<{ id: string; name: string }>;
  rows: PoFormRow[];
  /** T4a: NCC đã nhớ cho tên NCC trên báo giá (người mua đã chọn trước đây). */
  rememberedVendor?: { id: string; name: string } | null;
}
export interface PoFormSubmit {
  mode: 'draft' | 'send';
  warehouseId: string;
  vendor: { id: string; name: string };
  deliveryDate: string | null;
  vat: number;
  reasonCode: PoReasonCode;
  reason: string;
  overBoqReason: string;
  note: string;
  rows: PoFormRow[];
  approverId: string | null;
  approverName: string | null;
}
export interface PoFormActions {
  load: (command: AssistantCommand) => Promise<PoFormContext>;
  /** Tìm mã khác cho một dòng (danh mục + BOQ của dự án, như màn Lập đơn). */
  searchItems: (projectId: string, query: string) => Promise<ProcurementCatalogItem[]>;
  searchVendors: (query: string) => Promise<ProcurementVendor[]>;
  submit: (command: AssistantCommand, input: PoFormSubmit) => Promise<AssistantCommand>;
}

const qtyText = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 1000) / 1000).replace('.', ','));
export const parseNum = (s: string) => (s.trim() ? parseNonNegativeLocaleNumber(s) : null);
const factorOf = (item: ProcurementCatalogItem) => (item.purchaseFactor && item.purchaseFactor > 0 ? item.purchaseFactor : 1);

/** Chọn mã cho dòng: quy đổi SL / đơn giá theo đúng cách màn Lập đơn nhập báo giá (toImportedLine). */
export const applyItem = (row: PoFormRow, item: ProcurementCatalogItem): PoFormRow => {
  const imported = toImportedLine(row.source, item);
  return {
    ...row, item, confidence: 'picked', altUnit: imported.altUnit,
    stockQty: qtyText(imported.stockQty || null), purchaseQty: imported.altUnit ? qtyText(imported.purchaseQty) : '',
    price: imported.price == null ? '' : qtyText(imported.price), spec: row.spec || imported.spec, warnings: imported.warnings,
  };
};

export const toSourceRow = (line: { name: string; spec: string | null; qty: number | null; unit: string | null; price: number | null }, index: number): PoImportRow => ({
  index: index + 1, sku: '', name: line.name, spec: line.spec || '', unit: line.unit || '', qty: line.qty, price: line.price, note: null,
});

/** Tìm ứng viên cho một dòng như màn Lập đơn: thử lần lượt các câu tìm (server đòi đủ mọi từ) tới khi có kết quả. */
export const findCandidates = async (search: (q: string) => Promise<ProcurementCatalogItem[]>, row: PoImportRow): Promise<ProcurementCatalogItem[]> => {
  const pool: ProcurementCatalogItem[] = [];
  for (const query of searchQueriesFor(row)) {
    const found = await search(query).catch(() => []);
    found.forEach(item => { if (!pool.some(p => p.id === item.id)) pool.push(item); });
    if (pool.length >= 6) break;
  }
  return pool;
};

export const buildRows = async (lines: Parameters<typeof toSourceRow>[0][], search: (q: string) => Promise<ProcurementCatalogItem[]>, memory: readonly LearnedAlias[] = []): Promise<PoFormRow[]> =>
  Promise.all(lines.map(async (line, i) => {
    const source = toSourceRow(line, i);
    // Trí nhớ trước: tên hàng trên báo giá người mua đã gắn mã lần trước → lấy lại mã đó (kèm BOQ của dự án qua ô tìm).
    const known = recall(memory, 'item', [line.name, line.spec].filter(Boolean).join(' '), line.name);
    if (known) {
      const found = (await search(known.targetLabel).catch(() => [] as ProcurementCatalogItem[])).find(item => item.id === known.targetId);
      if (found) {
        const base: PoFormRow = { key: `${i}:${line.name}`, source, options: [found], item: null, confidence: null, altUnit: false,
          stockQty: qtyText(line.qty), purchaseQty: '', price: qtyText(line.price), spec: source.spec, warnings: [] };
        return { ...applyItem(base, found), confidence: 'memory' as const };
      }
    }
    const candidates = await findCandidates(search, source);
    const match = pickCatalogMatch(source, candidates);
    const base: PoFormRow = { key: `${i}:${line.name}`, source, options: match.options, item: null, confidence: null, altUnit: false,
      stockQty: qtyText(line.qty), purchaseQty: '', price: qtyText(line.price), spec: source.spec, warnings: [] };
    // Trùng tên / gần giống ≥ 50% thì chọn sẵn (như màn Lập đơn); còn lại để người dùng bấm gợi ý.
    return match.item ? { ...applyItem(base, match.item), confidence: match.confidence } : base;
  }));

/** SL mua (đơn vị mua) của dòng — như purchaseQtyOf của màn Lập đơn. */
export const purchaseQtyOf = (row: PoFormRow, stock: number) => {
  if (!row.altUnit || !row.item) return stock;
  const typed = parseNum(row.purchaseQty);
  return typed == null ? Math.round(stock / factorOf(row.item) * 1000) / 1000 : typed;
};

export interface PoTotals { subtotal: number; vatAmount: number; total: number; invalid: number; unpriced: number; overBoq: number }
export const poTotals = (rows: PoFormRow[], vat: number): PoTotals => {
  let subtotal = 0; let invalid = 0; let unpriced = 0; let overBoq = 0;
  const prior = new Map<string, number>();
  rows.filter(r => r.item).forEach(r => {
    const item = r.item!;
    const stock = parseNum(r.stockQty);
    const price = parseNum(r.price);
    if (stock == null || !(stock > 0)) { invalid += 1; return; }
    const qty = purchaseQtyOf(r, stock);
    if (!(qty > 0)) invalid += 1;
    if (price == null || price === 0) unpriced += 1; else subtotal += qty * price;
    const before = prior.get(item.id) || 0;
    prior.set(item.id, before + stock);
    if (boqStatusOf({ ...item, orderedQty: item.orderedQty + before }, stock) !== 'within') overBoq += 1;
  });
  const vatAmount = subtotal * (vat || 0) / 100;
  return { subtotal, vatAmount, total: subtotal + vatAmount, invalid, unpriced, overBoq };
};

/** Lỗi chặn lưu — theo đúng kiểm tra của màn Lập đơn chủ động (máy chủ còn kiểm lại). */
export const poProblems = (f: { warehouseId: string; vendor: { id: string } | null; reasonCode: PoReasonCode | null; reason: string; overBoqReason: string; vat: string; rows: PoFormRow[]; approverId: string | null }, mode: 'draft' | 'send'): string[] => {
  const out: string[] = [];
  const kept = f.rows.filter(r => r.item);
  if (!f.warehouseId) out.push('Chọn kho nhận.');
  if (!f.vendor) out.push('Chọn nhà cung cấp.');
  if (!f.reasonCode) out.push('Chọn lý do mua chủ động.');
  if (f.reasonCode === 'other' && !f.reason.trim()) out.push('Chọn "Khác" thì ghi rõ lý do.');
  if (!kept.length) out.push('Chọn mã cho ít nhất một dòng.');
  const vat = parseNum(f.vat);
  const totals = poTotals(kept, vat ?? 0);
  if (totals.invalid) out.push('Còn dòng chưa có số lượng hợp lệ.');
  const dup = duplicateItemSpecProblems(kept.map(r => ({ key: r.key, itemId: r.item!.id, specification: r.spec })));
  if (dup.size) out.push('Có vật tư nhiều dòng — ghi quy cách khác nhau.');
  if (totals.overBoq && !f.overBoqReason.trim()) out.push('Có vật tư vượt hoặc ngoài BOQ — ghi lý do mua vượt.');
  if (vat == null || vat < 0 || vat > 100) out.push('Thuế VAT phải từ 0 đến 100%.');
  if (mode === 'send' && !f.approverId) out.push('Chọn người duyệt.');
  return out;
};

// ── Bản thật: lệnh máy chủ của màn Lập đơn chủ động ──────────────────────────────────────────────────────────────────
export const createPoFormActions = (): PoFormActions => {
  // Đơn đã lưu cho từng lệnh: gửi lỗi giữa chừng rồi bấm lại thì sửa đúng đơn đó (không lập đơn trùng).
  const saved = new Map<string, { id: string; rowVersion: number; poNumber: string }>();
  return {
    async load(command) {
      const v = poView(command);
      const memory = await aiLearning.get('purchase_order', null).catch(() => [] as LearnedAlias[]);
      const [options, approvers, rows] = await Promise.all([
        procurementInboxService.proactiveOptions(),
        supabase.rpc('assistant_po_approvers_v1').then(({ data, error }) => { if (error) throw error; return (Array.isArray(data) ? data : []) as Array<{ id: string; name: string }>; }),
        buildRows(v.lines, q => procurementInboxService.searchItems(v.projectId, q), memory),
      ]);
      const project = options.projects.find(p => p.id === v.projectId);
      const vendor = !v.vendorId && v.vendorQuery ? recall(memory, 'vendor', v.vendorQuery) : null;
      return { warehouses: project?.warehouses || [], approvers, rows, rememberedVendor: vendor ? { id: vendor.targetId, name: vendor.targetLabel } : null };
    },
    searchItems: (projectId, query) => procurementInboxService.searchItems(projectId, query),
    searchVendors: query => procurementInboxService.vendors(query),
    async submit(command, input) {
      const v = poView(command);
      const kept = input.rows.filter(r => r.item);
      const totals = poTotals(kept, input.vat);
      let prior = saved.get(command.id) || null;
      if (!prior && command.status === 'failed' && typeof command.result.id === 'string') {
        const order = await procurementInboxService.getOrder(command.result.id).catch(() => null);
        if (order) prior = { id: order.id, rowVersion: order.rowVersion, poNumber: order.poNumber };
      }
      let result: { purchaseOrderId: string; poNumber: string; rowVersion: number };
      try {
        result = await procurementInboxService.saveProactiveOrder({
          purchaseOrderId: prior?.id, expectedRowVersion: prior?.rowVersion, purpose: 'project', projectId: v.projectId, targetWarehouseId: input.warehouseId,
          vendorId: input.vendor.id, purchaseMode: 'single', expectedDeliveryDate: input.deliveryDate || null, vatRate: input.vat, note: input.note.trim(),
          reasonCode: input.reasonCode, reason: input.reason.trim() || undefined, overBoqReason: totals.overBoq ? input.overBoqReason.trim() : undefined,
          items: kept.map(r => {
            const stock = parseNum(r.stockQty) || 0;
            return { itemId: r.item!.id, stockQty: stock, unitPrice: parseNum(r.price) || 0, specification: r.spec.trim() || undefined,
              ...(r.altUnit ? { purchaseUnit: r.item!.purchaseUnit || undefined, purchaseQty: purchaseQtyOf(r, stock) } : {}) };
          }),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Chưa lưu được đơn.';
        await finishCommand(command.id, 'failed', prior ? { code: prior.poNumber, id: prior.id } : {}, message).catch(() => null);
        throw e instanceof Error ? e : new Error(message);
      }
      saved.set(command.id, { id: result.purchaseOrderId, rowVersion: result.rowVersion, poNumber: result.poNumber });
      let budget: { pending: boolean; names: string[] } = { pending: false, names: [] };
      if (input.mode === 'send') {
        try {
          const t = await procurementInboxService.transitionOrder({ purchaseOrderId: result.purchaseOrderId, expectedRowVersion: result.rowVersion, action: 'submit', approverUserId: input.approverId || undefined });
          saved.set(command.id, { id: result.purchaseOrderId, rowVersion: t.rowVersion, poNumber: result.poNumber });
          budget = { pending: Boolean(t.budgetPending), names: t.budgetApproverNames || [] };
        } catch (e) {
          // Đơn đã lưu nháp, chưa gửi được: ghi lại để bấm Gửi lại sửa đúng đơn này.
          const message = e instanceof Error ? e.message : 'Chưa gửi duyệt được.';
          await finishCommand(command.id, 'failed', { code: result.poNumber, id: result.purchaseOrderId }, `Đã lưu nháp ${result.poNumber}, chưa gửi duyệt: ${message}`).catch(() => null);
          throw new Error(`Đã lưu nháp ${result.poNumber}, chưa gửi duyệt được: ${message}`);
        }
      }
      saved.delete(command.id);
      // Người mua đã xác nhận bằng hành động → dạy AI: tên hàng trên báo giá → mã, tên NCC trên báo giá → NCC (không chặn biên nhận).
      void aiLearning.learn('purchase_order', null, [
        ...kept.map(r => ({ kind: 'item' as const, alias: [r.source.name, r.source.spec].filter(Boolean).join(' '), targetId: r.item!.id, targetLabel: r.item!.name })),
        ...(v.vendorQuery ? [{ kind: 'vendor' as const, alias: v.vendorQuery, targetId: input.vendor.id, targetLabel: input.vendor.name }] : []),
      ]);
      const receipt = { code: result.poNumber, id: result.purchaseOrderId, submitted: input.mode === 'send', approvers: input.approverName ? [input.approverName] : [],
        total: Math.round(totals.total), budgetPending: budget.pending || undefined, budgetApprovers: budget.names.length ? budget.names : undefined };
      return (await finishCommand(command.id, 'done', receipt).catch(() => null)) || { ...command, status: 'done', result: receipt };
    },
  };
};
