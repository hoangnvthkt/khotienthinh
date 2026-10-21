import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Lock } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { Drawer, StateBox, inputCls, primaryBtn, secondaryBtn } from '../procurement/hub/hubUi';
import { ENT, NUM, moneyInput, parseMoney, viDate } from '../finance/financeUi';
import {
  inventoryValueAdjustmentService,
  previewAdjustment,
  valueAdjustmentErrorText,
  type UnpricedReceipts,
} from '../../lib/inventoryValueAdjustment';

// Bổ sung đơn giá cho dòng nhập giá 0 của một (kho, vật tư): Kế toán kho lập phiếu điều chỉnh giá trị;
// phiếu nhập NCC chưa ghi công nợ chuyển sang Tài chính để ghi luôn công nợ.

const qty = (value: number) => value.toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const vnd = (value: number) => `${Math.round(value).toLocaleString('vi-VN')} đ`;

export const UnpricedReceiptsDrawer: React.FC<{
  warehouseId: string;
  warehouseName: string;
  materialId: string;
  sku: string;
  name: string;
  onClose: () => void;
  onPosted: () => void;
}> = ({ warehouseId, warehouseName, materialId, sku, name, onClose, onPosted }) => {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<UnpricedReceipts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setData(null);
    setError(null);
    inventoryValueAdjustmentService.listUnpriced(warehouseId, materialId)
      .then(result => {
        setData(result);
        setPrices(Object.fromEntries(result.lines
          .filter(line => line.route === 'adjust' && line.suggestedPrice)
          .map(line => [line.ledgerEntryId, moneyInput(line.suggestedPrice)])));
      })
      .catch(err => setError(err?.message || 'Chưa tải được dòng nhập thiếu giá.'));
  }, [materialId, warehouseId]);

  useEffect(() => { load(); }, [load]);

  const parsed = useMemo(() => Object.fromEntries(Object.entries(prices).map(([id, text]) => {
    const value = parseMoney(text);
    return [id, Number.isFinite(value) && value > 0 ? value : undefined];
  })), [prices]);
  const adjustLines = data?.lines.filter(line => line.route === 'adjust') || [];
  const financeLines = data?.lines.filter(line => line.route === 'finance') || [];
  const preview = previewAdjustment(adjustLines, parsed);
  const canAdjust = data?.canAdjust === true;
  const blockedReason = !canAdjust
    ? 'Cần ô quyền Kế toán kho để bổ sung đơn giá'
    : preview.lines === 0 ? 'Nhập đơn giá ít nhất một dòng'
      : !reason.trim() ? 'Nhập lý do (ví dụ: theo hóa đơn số …)' : '';

  const submit = async () => {
    if (blockedReason || busy) return;
    setBusy(true);
    try {
      const result = await inventoryValueAdjustmentService.post(reason.trim(), adjustLines
        .filter(line => parsed[line.ledgerEntryId])
        .map(line => ({ ledgerEntryId: line.ledgerEntryId, unitPrice: parsed[line.ledgerEntryId] as number })));
      toast.success(`Đã ghi ${result.code}`, `Nhập +${vnd(result.totalIn)} · đã xuất +${vnd(result.totalOut)} · tồn +${vnd(result.totalStock)}`);
      onPosted();
      onClose();
    } catch (err) {
      toast.error('Chưa ghi được phiếu điều chỉnh', valueAdjustmentErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      label="Bổ sung đơn giá"
      onClose={onClose}
      header={(
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bổ sung đơn giá</div>
          <h2 className="mt-0.5 text-lg font-bold text-foreground"><span className="font-mono text-mint-700">{sku}</span> · {name}</h2>
          <div className="text-sm text-muted-foreground">{warehouseName}</div>
        </div>
      )}
      footer={adjustLines.length > 0 ? (
        <>
          <div className="mr-auto text-sm text-muted-foreground">
            {!canAdjust ? 'Chỉ xem' : preview.lines > 0
              ? <>Nhập <b className={NUM}>+{vnd(preview.valueIn)}</b> · đã xuất <b className="tabular-nums">+{vnd(preview.valueOut)}</b> · tồn <b className={NUM}>+{vnd(preview.valueStock)}</b></>
              : 'Chưa nhập đơn giá'}
          </div>
          <button type="button" onClick={onClose} className={secondaryBtn}>Đóng</button>
          <button type="button" onClick={() => void submit()} disabled={Boolean(blockedReason) || busy} title={blockedReason || undefined}
            className={`${primaryBtn} flex-1 md:flex-none`}>
            {!canAdjust && <Lock size={14} />} {busy ? 'Đang ghi…' : 'Ghi phiếu điều chỉnh'}
          </button>
        </>
      ) : undefined}
    >
      {error ? <StateBox kind="error" title="Chưa tải được dòng nhập thiếu giá" message={error} onRetry={load} />
        : !data ? <StateBox kind="loading" />
          : data.lines.length === 0 ? (
            <StateBox kind="empty" title="Không còn dòng nhập thiếu giá"
              message="Giá trị tồn bằng 0 có thể do phiếu xuất ghi giá cao hơn phiếu nhập. Xem Thẻ kho vật tư để kiểm tra." />
          ) : (
            <div className="space-y-4">
              {financeLines.length > 0 && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  <div className="font-semibold">{financeLines.length} phiếu nhập NCC chưa ghi công nợ</div>
                  <p className="mt-0.5 !whitespace-normal">Kế toán nhập giá ở Tài chính để ghi cả công nợ NCC và giá trị kho.</p>
                  <ul className="mt-2 space-y-1">
                    {financeLines.map(line => (
                      <li key={line.ledgerEntryId} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-xs font-bold">{line.documentCode}</span>
                        <span>{viDate(line.date)}</span>
                        <span className="tabular-nums">{qty(line.quantity)} {line.unit}</span>
                        {line.partner && <span className="truncate text-amber-800 dark:text-amber-200">{line.partner}</span>}
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => navigate('/finance?section=pending')} className={`${secondaryBtn} mt-3 bg-white dark:bg-transparent`}>
                    <ExternalLink size={14} /> Mở Tài chính → Phiếu nhập NCC
                  </button>
                </section>
              )}

              {adjustLines.length > 0 && (
                <section className="space-y-2">
                  {!canAdjust && (
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                      <Lock size={14} /> Chỉ người có ô quyền Kế toán kho được bổ sung đơn giá.
                    </div>
                  )}
                  {adjustLines.map(line => {
                    const price = parsed[line.ledgerEntryId];
                    const issued = line.quantity - line.remainingQty;
                    return (
                      <div key={line.ledgerEntryId} className="rounded-xl border border-border bg-card p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="min-w-0">
                            <span className="font-mono text-xs font-bold text-mint-700">{line.documentCode}</span>
                            <span className="ml-2 text-sm text-muted-foreground">{viDate(line.date)}</span>
                            {line.partner && <div className={`truncate text-sm ${ENT}`}>{line.partner}</div>}
                            {line.note && !line.partner && <div className="line-clamp-2 text-sm text-muted-foreground">{line.note}</div>}
                          </div>
                          <div className="ml-auto text-right text-sm">
                            <div className="font-semibold tabular-nums">{qty(line.quantity)} {line.unit}</div>
                            <div className="text-xs text-muted-foreground">còn tồn {qty(line.remainingQty)} · đã xuất {qty(issued)}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="text-sm text-muted-foreground" htmlFor={`price-${line.ledgerEntryId}`}>Đơn giá</label>
                          <input
                            id={`price-${line.ledgerEntryId}`}
                            inputMode="numeric"
                            disabled={!canAdjust}
                            value={prices[line.ledgerEntryId] || ''}
                            onChange={event => setPrices(prev => ({ ...prev, [line.ledgerEntryId]: event.target.value }))}
                            onBlur={() => price && setPrices(prev => ({ ...prev, [line.ledgerEntryId]: moneyInput(price) }))}
                            placeholder="0"
                            className={`${inputCls} w-36 text-right tabular-nums`}
                          />
                          <span className="text-sm text-muted-foreground">đ/{line.unit || 'đv'}</span>
                          {line.suggestedSource && (
                            <span className="text-xs text-muted-foreground">gợi ý theo {line.suggestedSource === 'document' ? 'giá trên phiếu' : 'giá danh mục'}</span>
                          )}
                          {price && <span className={`ml-auto text-sm ${NUM}`}>= {vnd(line.quantity * price)}</span>}
                        </div>
                      </div>
                    );
                  })}
                  <label className="block text-sm">
                    <span className="font-semibold text-foreground">Lý do</span>
                    <textarea
                      value={reason}
                      disabled={!canAdjust}
                      onChange={event => setReason(event.target.value)}
                      rows={2}
                      placeholder="Ví dụ: theo hóa đơn số 0001234 ngày 05/07/2026"
                      className={`${inputCls} mt-1 w-full`}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground !whitespace-normal">
                    Ghi phiếu điều chỉnh giá trị theo ngày hôm nay. Phiếu nhập cũ giữ nguyên.
                  </p>
                </section>
              )}
            </div>
          )}
    </Drawer>
  );
};
