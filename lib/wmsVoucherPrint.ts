import { TransactionStatus, TransactionType, type InventoryItem, type Transaction, type TransactionItem, type User, type Warehouse } from '../types';
import { fetchTxSpecAllocations, lineSpecAllocations, specAllocationText, type TxLedgerAllocation } from './wmsSpecStockService';

// In / PDF phiếu kho — dùng chung cho màn Kho và Phiếu kho. Số phiếu lấy từ sổ kho (NK/XK…); phiếu chưa ghi sổ in "Chưa ghi sổ".

export const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export const wmsVoucherTitle = (tx: Pick<Transaction, 'type' | 'status'>) => {
  if (tx.status === TransactionStatus.CANCELLED) return 'Phiếu từ chối';
  switch (tx.type) {
    case TransactionType.IMPORT: return 'Phiếu nhập kho';
    case TransactionType.EXPORT: return 'Phiếu xuất kho';
    case TransactionType.TRANSFER: return 'Phiếu chuyển kho';
    case TransactionType.LIQUIDATION: return 'Phiếu xuất hủy';
    default: return 'Phiếu kho';
  }
};

export interface WmsVoucherContext {
  items: Array<Pick<InventoryItem, 'id' | 'name' | 'sku' | 'unit'>>;
  users: Array<Pick<User, 'id' | 'name'>>;
  warehouses: Array<Pick<Warehouse, 'id' | 'name'>>;
  /** Nhà cung cấp / đối tác (đã tra sẵn). */
  supplyName?: string | null;
}

const qty = (n: number) => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const dateVi = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('vi-VN') : '-';

/** Số phiếu theo sổ kho (chuyển kho có cả XK và NK). */
export const ledgerCodes = (ledger: TxLedgerAllocation[]) => [...new Set(ledger.map(e => e.code).filter(Boolean) as string[])];

export const buildWmsVoucherHtml = (tx: Transaction, ctx: WmsVoucherContext, ledger: TxLedgerAllocation[], mode: 'print' | 'pdf' = 'print') => {
  const isImport = tx.type === TransactionType.IMPORT;
  const posted = tx.status === TransactionStatus.COMPLETED;
  const lineSpecs = posted ? lineSpecAllocations(isImport, tx.items, ledger) : [];
  const codes = ledgerCodes(ledger);
  const code = codes.length ? codes.join(' · ') : posted ? '-' : 'Chưa ghi sổ';
  const title = wmsVoucherTitle(tx);
  const whName = (id?: string) => ctx.warehouses.find(w => w.id === id)?.name || '-';
  const userName = (id?: string | null) => (id && ctx.users.find(u => u.id === id)?.name) || '';
  const flow = isImport ? `Nhập vào: ${whName(tx.targetWarehouseId)}`
    : tx.type === TransactionType.TRANSFER ? `${whName(tx.sourceWarehouseId)} → ${whName(tx.targetWarehouseId)}`
    : `Xuất từ: ${whName(tx.sourceWarehouseId)}`;
  const recipient = tx.items.find(l => l.recipientNameSnapshot)?.recipientNameSnapshot;
  // Nhận theo đợt giao: in cả số theo đợt giao để thấy lệch (thiếu / dư).
  const showOrdered = isImport && tx.items.some(l => l.orderedQty != null && Math.abs(Number(l.orderedQty) - Number(l.quantity || 0)) > 1e-9);
  const specText = (line: TransactionItem, i: number) => {
    const parts = lineSpecs[i];
    const text = parts && !isImport ? specAllocationText(parts, n => qty(n)) : line.specification || '';
    return text ? `<div class="spec">Quy cách: ${escapeHtml(text)}</div>` : '';
  };
  const total = tx.items.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.price || 0), 0);
  const rows = tx.items.map((line, i) => {
    const product = ctx.items.find(item => item.id === line.itemId);
    const amount = Number(line.quantity || 0) * Number(line.price || 0);
    const diff = Number(line.quantity || 0) - Number(line.orderedQty ?? line.quantity ?? 0);
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><strong>${escapeHtml(line.itemNameSnapshot || product?.name || 'Vật tư')}</strong>${specText(line, i)}<div class="muted">${escapeHtml(product?.sku || line.itemId)}</div>
        ${line.varianceReason ? `<div class="muted">Lý do lệch: ${escapeHtml(line.varianceReason)}</div>` : ''}</td>
      <td>${escapeHtml(product?.unit || '')}</td>
      ${showOrdered ? `<td class="r">${qty(Number(line.orderedQty ?? 0))}</td>` : ''}
      <td class="r"><strong>${qty(Number(line.quantity || 0))}</strong>${showOrdered && Math.abs(diff) > 1e-9 ? `<div class="${diff < 0 ? 'short' : 'over'}">${diff < 0 ? 'thiếu' : 'dư'} ${qty(Math.abs(diff))}</div>` : ''}</td>
      <td class="r">${line.price ? Number(line.price).toLocaleString('vi-VN') : ''}</td>
      <td class="r">${amount ? Math.round(amount).toLocaleString('vi-VN') : ''}</td>
    </tr>`;
  }).join('');
  const signers = isImport ? ['Người giao hàng', 'Thủ kho', 'Kế toán']
    : tx.type === TransactionType.TRANSFER ? ['Thủ kho kho gửi', 'Người vận chuyển', 'Thủ kho kho nhận']
    : tx.type === TransactionType.LIQUIDATION ? ['Thủ kho', 'Người duyệt', 'Kế toán']
    : ['Người nhận', 'Thủ kho', 'Người lập'];
  const docTitle = `${mode === 'pdf' ? 'PDF_' : ''}${title}_${codes[0] || tx.id}`.replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const status = tx.status === TransactionStatus.CANCELLED ? ['Từ chối', '#dc2626'] : posted ? ['Đã ghi sổ', '#059669'] : ['Chưa ghi sổ', '#d97706'];

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(docTitle)}</title><style>
    * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #0f172a; margin: 32px; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: .04em; } .code { font-size: 17px; font-weight: 800; margin-top: 6px; }
    .status { text-align: right; font-size: 12px; text-transform: uppercase; font-weight: 800; color: ${status[1]}; }
    .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin: 14px 0 18px; font-size: 13px; }
    .meta div { border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; } .label { color: #64748b; font-size: 10px; text-transform: uppercase; font-weight: 800; display: block; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; } th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; color: #475569; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 9px; vertical-align: top; } .r { text-align: right; } .c { text-align: center; }
    .muted { color: #64748b; font-size: 11px; margin-top: 2px; } .spec { font-size: 12px; margin-top: 2px; } .short { color: #b45309; font-size: 11px; } .over { color: #0f766e; font-size: 11px; }
    tfoot td { font-weight: 800; } .note { margin-top: 14px; border-left: 4px solid #94a3b8; background: #f8fafc; padding: 10px 12px; font-size: 13px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 40px; text-align: center; font-size: 12px; font-weight: 800; }
    .signatures span { display: block; margin-top: 64px; font-weight: 400; color: #64748b; } @media print { body { margin: 14mm; } }
  </style></head><body>
    <div class="header"><div><h1>${escapeHtml(title)}</h1><div class="code">Số: ${escapeHtml(code)}</div></div><div class="status">${status[0]}</div></div>
    <div class="meta">
      <div><span class="label">Ngày chứng từ</span>${escapeHtml(dateVi(tx.date))}</div>
      <div><span class="label">Kho</span>${escapeHtml(flow)}</div>
      ${ctx.supplyName ? `<div><span class="label">Nhà cung cấp</span>${escapeHtml(ctx.supplyName)}</div>` : ''}
      ${recipient ? `<div><span class="label">Người nhận</span>${escapeHtml(recipient)}</div>` : ''}
      <div><span class="label">Người lập</span>${escapeHtml(userName(tx.requesterId) || 'Hệ thống')}</div>
      <div><span class="label">Người duyệt / ghi sổ</span>${escapeHtml(userName(tx.approverId) || '-')}</div>
    </div>
    <table><thead><tr><th>STT</th><th>Vật tư</th><th>ĐVT</th>${showOrdered ? '<th class="r">Theo đợt giao</th>' : ''}<th class="r">${isImport ? 'Thực nhận' : 'Số lượng'}</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr></thead>
      <tbody>${rows}</tbody>${total ? `<tfoot><tr><td colspan="${showOrdered ? 6 : 5}" class="r">Cộng</td><td class="r">${Math.round(total).toLocaleString('vi-VN')}</td></tr></tfoot>` : ''}</table>
    ${tx.note ? `<div class="note"><strong>Ghi chú:</strong> ${escapeHtml(tx.note)}</div>` : ''}
    ${tx.approvalNote ? `<div class="note"><strong>Ghi chú duyệt:</strong> ${escapeHtml(tx.approvalNote)}</div>` : ''}
    <div class="signatures">${signers.map(s => `<div>${escapeHtml(s)}<span>Ký, ghi rõ họ tên</span></div>`).join('')}</div>
    <script>setTimeout(function(){ window.print(); }, 250);</script>
  </body></html>`;
};

/** Mở cửa sổ ngay khi bấm (trình duyệt chặn cửa sổ mở sau khi chờ mạng), rồi đọc số phiếu + quy cách thực từ sổ kho. */
export const printWmsVoucher = async (tx: Transaction, ctx: WmsVoucherContext, mode: 'print' | 'pdf' = 'print'): Promise<boolean> => {
  const win = window.open('', '_blank', 'width=980,height=720');
  if (!win) return false;
  win.document.write('<p style="font-family:Arial;padding:24px;color:#64748b">Đang chuẩn bị phiếu…</p>');
  const ledger = tx.status === TransactionStatus.COMPLETED ? await fetchTxSpecAllocations(tx.id).catch(() => []) : [];
  win.document.open();
  win.document.write(buildWmsVoucherHtml(tx, ctx, ledger, mode));
  win.document.close();
  return true;
};
