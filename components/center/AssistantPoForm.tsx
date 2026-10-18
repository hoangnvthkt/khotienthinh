import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Save, Search, Send, X } from 'lucide-react';
import { poView, type AssistantCommand, type PoReasonCode } from '../../lib/assistantCommands';
import { PO_REASONS, applyItem, parseNum, poProblems, poTotals, purchaseQtyOf, type PoFormActions, type PoFormContext, type PoFormRow } from '../../lib/assistantPoForm';
import { boqStatusOf, type ProcurementCatalogItem, type ProcurementVendor } from '../../lib/procurementInboxService';

// Form đơn mua (PO chủ động) ngay trong khung chat (chủ SP 18/10/2026): Trợ lý tách báo giá → người Mua hàng chọn mã (gợi ý bấm), NCC
// (gợi ý bấm), lý do mua chủ động, người duyệt rồi Lưu nháp / Gửi duyệt tại chỗ — lưu bằng đúng lệnh của màn Lập đơn chủ động.

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
const num = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 3 });

const AssistantPoForm: React.FC<{
  command: AssistantCommand;
  actions: PoFormActions;
  you: string;
  onDone: (command: AssistantCommand) => void;
  onCancel: () => void;
  onOpenProcurement: () => void;
  busyCancel?: boolean;
}> = ({ command, actions, you, onDone, onCancel, onOpenProcurement, busyCancel = false }) => {
  const v = useMemo(() => poView(command), [command]);
  const [ctx, setCtx] = useState<PoFormContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<PoFormRow[]>([]);
  const [warehouseId, setWarehouseId] = useState(v.warehouseId || '');
  const [vendor, setVendor] = useState<{ id: string; name: string } | null>(v.vendorId ? { id: v.vendorId, name: v.vendorName || '' } : null);
  const [vendorQuery, setVendorQuery] = useState<string | null>(v.vendorId ? null : v.vendorQuery || '');
  const [vendorFound, setVendorFound] = useState<ProcurementVendor[]>(v.vendorOptions.map(o => ({ ...o, recentOrders: 0 })));
  const [deliveryDate, setDeliveryDate] = useState(v.deliveryDate || '');
  const [vat, setVat] = useState(String(v.vat ?? 10));
  const [reasonCode, setReasonCode] = useState<PoReasonCode | null>(v.reasonCode);
  const [reason, setReason] = useState(v.reason);
  const [overBoqReason, setOverBoqReason] = useState('');
  const [approverId, setApproverId] = useState<string | null>(null);
  const [searching, setSearching] = useState<{ key: string; query: string; found: ProcurementCatalogItem[] } | null>(null);
  const [busy, setBusy] = useState<null | 'send' | 'draft'>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(command.status === 'failed' ? command.error : null);

  useEffect(() => {
    let alive = true;
    actions.load(command).then(c => {
      if (!alive) return;
      setCtx(c); setRows(c.rows);
      setWarehouseId(w => w || c.warehouses[0]?.id || '');
      setApproverId(c.approvers.length === 1 ? c.approvers[0].id : null);
    }).catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'Chưa tải được danh mục / dự án để lập đơn.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.id]);

  // Tìm NCC khi gõ (trễ 250 ms).
  useEffect(() => {
    if (vendorQuery == null || vendorQuery.trim().length < 2) return;
    const t = window.setTimeout(() => { actions.searchVendors(vendorQuery.trim()).then(list => setVendorFound(list.slice(0, 6))).catch(() => setVendorFound([])); }, 250);
    return () => window.clearTimeout(t);
  }, [actions, vendorQuery]);
  // Tìm mã khác cho dòng đang mở ô tìm.
  useEffect(() => {
    if (!searching || searching.query.trim().length < 2) return;
    const { key, query } = searching;
    const t = window.setTimeout(() => {
      actions.searchItems(v.projectId, query.trim()).then(found => setSearching(s => (s && s.key === key && s.query === query ? { ...s, found: found.slice(0, 6) } : s))).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching?.key, searching?.query]);

  const update = (key: string, fn: (row: PoFormRow) => PoFormRow) => setRows(rs => rs.map(r => (r.key === key ? fn(r) : r)));
  const pick = (row: PoFormRow, item: ProcurementCatalogItem) => { update(row.key, r => applyItem(r, item)); setSearching(null); };
  const vatNum = parseNum(vat) ?? 0;
  const totals = useMemo(() => poTotals(rows, vatNum), [rows, vatNum]);
  const kept = rows.filter(r => r.item);

  const submit = async (mode: 'send' | 'draft') => {
    const found = poProblems({ warehouseId, vendor, reasonCode, reason, overBoqReason, vat, rows, approverId }, mode);
    setProblems(found);
    if (found.length || !ctx || !vendor || !reasonCode) return;
    setBusy(mode); setError(null);
    try {
      onDone(await actions.submit(command, {
        mode, warehouseId, vendor, deliveryDate: deliveryDate || null, vat: vatNum, reasonCode, reason, overBoqReason, note: v.note, rows,
        approverId, approverName: ctx.approvers.find(a => a.id === approverId)?.name || null,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa lưu được đơn.');
    } finally { setBusy(null); }
  };

  if (loadError) {
    return (
      <div className="vcc-mr">
        <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {loadError}</p>
        <div className="vcc-cmd-actions">
          <button type="button" className="vcc-btn" onClick={onOpenProcurement}>Mở Mua hàng</button>
          <button type="button" className="vcc-btn" onClick={onCancel} disabled={busyCancel}><X size={14} /> Bỏ</button>
        </div>
      </div>
    );
  }
  if (!ctx) return <p className="vcc-cmd-muted vcc-mr-loading" role="status"><Loader2 size={14} className="animate-spin" /> Đang khớp mã vật tư và tải dự án…</p>;

  const locked = busy !== null;
  return (
    <div className="vcc-mr" data-testid="po-form">
      <div className="vcc-mr-approvers">
        <span className="vcc-mr-label">Nhà cung cấp</span>
        {vendor ? (
          <div className="vcc-mr-chips" role="group" aria-label="Nhà cung cấp đã chọn">
            <span className="vcc-mr-picked"><CheckCircle2 size={12} aria-hidden="true" />{vendor.name}</span>
            <span className="vcc-mr-links"><button type="button" disabled={locked} onClick={() => { setVendor(null); setVendorQuery(v.vendorQuery || ''); }}>Đổi NCC</button></span>
          </div>
        ) : (
          <div className="vcc-mr-search">
            <label><Search size={13} aria-hidden="true" />
              <input value={vendorQuery || ''} onChange={e => setVendorQuery(e.target.value)} disabled={locked} aria-label="Tìm nhà cung cấp" placeholder="Gõ tên hoặc mã số thuế NCC" /></label>
            {vendorFound.length > 0 && <div className="vcc-mr-chips" role="group" aria-label="Chọn nhà cung cấp">
              {vendorFound.map(f => <button key={f.id} type="button" disabled={locked} onClick={() => { setVendor({ id: f.id, name: f.name }); setVendorQuery(null); }}>{f.name}{f.taxCode ? ` · ${f.taxCode}` : ''}</button>)}
            </div>}
          </div>
        )}
      </div>
      <div className="vcc-mr-fields">
        <label className="vcc-mr-field"><span>Kho nhận</span>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} disabled={locked} aria-label="Kho nhận">
            <option value="">— Chọn kho nhận —</option>
            {ctx.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <label className="vcc-mr-field"><span>Ngày giao</span>
          <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} disabled={locked} aria-label="Ngày giao" /></label>
      </div>
      <div className="vcc-mr-approvers">
        <span className="vcc-mr-label">Lý do mua chủ động</span>
        <div className="vcc-mr-chips" role="group" aria-label="Lý do mua chủ động">
          {PO_REASONS.map(r => <button key={r.code} type="button" aria-pressed={reasonCode === r.code} disabled={locked} onClick={() => setReasonCode(r.code)}>{reasonCode === r.code && <CheckCircle2 size={12} aria-hidden="true" />}{r.label}</button>)}
        </div>
        {(reasonCode === 'other' || reason) && <input value={reason} onChange={e => setReason(e.target.value)} disabled={locked} aria-label="Lý do cụ thể" placeholder="Ghi rõ lý do" />}
      </div>

      <ul className="vcc-mr-rows" aria-label="Dòng đơn mua">
        {rows.map(row => {
          const item = row.item;
          const stock = parseNum(row.stockQty);
          const boq = item && stock ? boqStatusOf(item, stock) : null;
          const options = [...row.options, ...(item && !row.options.some(o => o.id === item.id) ? [item] : [])];
          return (
            <li key={row.key} className="vcc-mr-row" data-state={item ? 'ok' : 'todo'}>
              <div className="vcc-mr-row-head">
                <span className="vcc-mr-pill" data-tone={item && row.confidence !== 'suggested' ? 'ok' : item || row.options.length ? 'warn' : 'muted'}>
                  {item && row.confidence !== 'suggested' && <CheckCircle2 size={11} aria-hidden="true" />}
                  {item ? (row.confidence === 'suggested' ? 'Gần giống · kiểm' : 'Đã khớp') : row.options.length ? 'Chọn mã' : 'Chưa có mã'}</span>
                <span className="vcc-mr-said">“{[row.source.name, row.source.spec].filter(Boolean).join(' ')}{row.source.qty != null ? ` · ${num(row.source.qty)} ${row.source.unit}` : ''}{row.source.price != null ? ` · ${vnd(row.source.price)}` : ''}”</span>
                {boq && boq !== 'within' && <span className="vcc-mr-pill" data-tone="warn">{boq === 'outside' ? 'Ngoài BOQ' : 'Vượt BOQ'}</span>}
                <button type="button" className="vcc-mr-x" aria-label={`Bỏ dòng ${row.source.name}`} disabled={locked} onClick={() => setRows(rs => rs.filter(r => r.key !== row.key))}><X size={13} /></button>
              </div>
              <div className="vcc-mr-row-main vcc-po-main">
                <select value={item?.id || ''} aria-label={`Mã vật tư cho ${row.source.name}`} disabled={locked}
                  onChange={e => { const it = options.find(o => o.id === e.target.value); if (it) pick(row, it); }}>
                  {!item && <option value="">{row.options.length ? 'Chọn mã…' : 'Chưa có mã'}</option>}
                  {options.map(o => <option key={o.id} value={o.id}>{o.name} · {o.unit}{o.sku ? ` · ${o.sku}` : ''}</option>)}
                </select>
                <label className="vcc-mr-qty">
                  <input value={row.stockQty} inputMode="decimal" aria-label={`Số lượng ${row.source.name}`} disabled={locked} placeholder="SL"
                    onChange={e => update(row.key, r => ({ ...r, stockQty: e.target.value }))} />
                  <span>{item?.unit || row.source.unit}</span>
                </label>
                <label className="vcc-mr-qty">
                  <input value={row.price} inputMode="decimal" aria-label={`Đơn giá ${row.source.name}`} disabled={locked} placeholder="Đơn giá"
                    onChange={e => update(row.key, r => ({ ...r, price: e.target.value }))} />
                  <span>/{row.altUnit && item?.purchaseUnit ? item.purchaseUnit : item?.unit || row.source.unit}</span>
                </label>
              </div>
              {row.altUnit && item && (
                <label className="vcc-mr-qty vcc-po-alt"><span className="vcc-mr-label">Mua theo {item.purchaseUnit}</span>
                  <input value={row.purchaseQty} inputMode="decimal" aria-label={`Số lượng mua ${row.source.name}`} disabled={locked}
                    placeholder={num(purchaseQtyOf(row, stock || 0))} onChange={e => update(row.key, r => ({ ...r, purchaseQty: e.target.value }))} />
                </label>
              )}
              {!item && row.options.length > 0 && (
                <div className="vcc-mr-chips" role="group" aria-label={`Gợi ý mã cho ${row.source.name}`}>
                  <span>Gợi ý:</span>
                  {row.options.slice(0, 3).map(o => <button key={o.id} type="button" disabled={locked} onClick={() => pick(row, o)}>{o.name} · {o.unit}</button>)}
                </div>
              )}
              {searching?.key === row.key && (
                <div className="vcc-mr-search">
                  <label><Search size={13} aria-hidden="true" />
                    <input autoFocus value={searching.query} onChange={e => setSearching({ key: row.key, query: e.target.value, found: searching.found })} aria-label={`Tìm mã cho ${row.source.name}`} placeholder="Gõ tên hoặc mã vật tư" /></label>
                  {searching.found.length > 0 && <div className="vcc-mr-chips" role="group" aria-label={`Kết quả tìm cho ${row.source.name}`}>
                    {searching.found.map(it => <button key={it.id} type="button" onClick={() => pick(row, it)}>{it.name} · {it.unit}</button>)}
                  </div>}
                </div>
              )}
              {row.warnings.map(w => <p key={w} className="vcc-mr-warn"><AlertTriangle size={12} aria-hidden="true" /> {w}</p>)}
              <p className="vcc-mr-links">
                {searching?.key !== row.key && <button type="button" disabled={locked} onClick={() => setSearching({ key: row.key, query: row.source.name, found: [] })}>Tìm mã khác</button>}
              </p>
            </li>
          );
        })}
      </ul>

      {totals.overBoq > 0 && (
        <label className="vcc-mr-field"><span>Lý do mua vượt / ngoài BOQ ({totals.overBoq} dòng)</span>
          <input value={overBoqReason} onChange={e => setOverBoqReason(e.target.value)} disabled={locked} aria-label="Lý do mua vượt BOQ" /></label>
      )}
      <div className="vcc-po-totals" aria-label="Tiền đơn">
        <span>Tạm tính <b>{vnd(totals.subtotal)}</b></span>
        <label>VAT <input value={vat} onChange={e => setVat(e.target.value)} inputMode="decimal" disabled={locked} aria-label="Thuế VAT %" />%</label>
        <span>Tổng <b>{vnd(totals.total)}</b></span>
        {totals.unpriced > 0 && <span className="vcc-mr-warn">{totals.unpriced} dòng chưa có giá</span>}
      </div>

      <div className="vcc-mr-approvers">
        <span className="vcc-mr-label">Người duyệt</span>
        <div className="vcc-mr-chips" role="group" aria-label="Chọn người duyệt">
          {ctx.approvers.map(a => <button key={a.id} type="button" aria-pressed={approverId === a.id} disabled={locked} onClick={() => setApproverId(id => (id === a.id ? null : a.id))}>
            {approverId === a.id && <CheckCircle2 size={12} aria-hidden="true" />}{a.name}</button>)}
          {!ctx.approvers.length && <span>Chưa có người duyệt đơn mua — vẫn lưu nháp được.</span>}
        </div>
      </div>

      {(problems.length > 0 || error) && (
        <ul className="vcc-mr-problems" role="alert">
          {problems.map(p => <li key={p}><AlertTriangle size={12} aria-hidden="true" /> {p}</li>)}
          {error && <li><AlertTriangle size={12} aria-hidden="true" /> {error}</li>}
        </ul>
      )}
      <div className="vcc-cmd-actions">
        <button type="button" className="vcc-btn" data-pri="true" onClick={() => void submit('send')} disabled={locked || !ctx.approvers.length}>
          {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {busy === 'send' ? 'Đang gửi…' : 'Gửi duyệt'}</button>
        <button type="button" className="vcc-btn" onClick={() => void submit('draft')} disabled={locked}>
          {busy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu nháp</button>
        <button type="button" className="vcc-btn" onClick={onCancel} disabled={locked || busyCancel}><X size={14} /> Bỏ</button>
      </div>
      <p className="vcc-cmd-note">{kept.length}/{rows.length} dòng đã có mã · chưa lưu gì tới khi {you} bấm.</p>
    </div>
  );
};

export default AssistantPoForm;
