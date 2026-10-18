import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Brain, CheckCircle2, Loader2, Package, Search, Send, Save, X } from 'lucide-react';
import { mrView, type AssistantCommand } from '../../lib/assistantCommands';
import { chooseItem, formProblems, parseQty, searchCatalog, toFormRows, type MrCatalogItem, type MrFormActions, type MrFormContext, type MrFormRow } from '../../lib/assistantMrForm';
import { qtyInUnit, sameUnit } from '../../lib/materialRequestText';

// Form đề xuất vật tư ngay trong khung chat (chủ SP duyệt 18/10/2026): Trợ lý đã tách dòng + chọn dự án → người dùng chọn mã
// (gợi ý bấm), sửa số lượng, kho nhận, ngày cần, chọn người duyệt rồi bấm Gửi duyệt / Lưu nháp tại chỗ. Lưu đi đúng đường của form
// Đề xuất (actions.submit). Dòng theo BOQ, đính kèm… thì "Mở form đầy đủ".

const qtyShow = (q: number | null) => (q == null ? '' : q.toLocaleString('vi-VN', { maximumFractionDigits: 3 }));
const pill = (row: MrFormRow) => (row.itemId ? (row.remembered ? 'Đã nhớ' : 'Đã khớp') : row.candidates.length ? 'Chọn mã' : 'Chưa có mã');

/** T4b: nhãn nhỏ cạnh ô đã chọn sẵn theo lần gửi trước. */
export const Remembered: React.FC = () => <span className="vcc-mr-pill vcc-mem-pill" data-tone="ok" title="Lần trước bạn chọn — đổi được"><Brain size={11} aria-hidden="true" />Đã nhớ</span>;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));

const AssistantMrForm: React.FC<{
  command: AssistantCommand;
  actions: MrFormActions;
  you: string;
  onDone: (command: AssistantCommand) => void;
  onCancel: () => void;
  onOpenFull: () => void;
  busyCancel?: boolean;
}> = ({ command, actions, you, onDone, onCancel, onOpenFull, busyCancel = false }) => {
  const v = useMemo(() => mrView(command), [command]);
  const [ctx, setCtx] = useState<MrFormContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(v.title);
  const [purpose, setPurpose] = useState(v.purpose);
  const [warehouseId, setWarehouseId] = useState('');
  const [neededDate, setNeededDate] = useState(v.neededDate || '');
  const [rows, setRows] = useState<MrFormRow[]>([]);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [searching, setSearching] = useState<{ key: string; query: string } | null>(null);
  const [showSpec, setShowSpec] = useState<Set<string>>(new Set());
  const [showReason, setShowReason] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | 'send' | 'draft'>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(command.status === 'failed' ? command.error : null);

  useEffect(() => {
    let alive = true;
    actions.load(command).then(c => {
      if (!alive) return;
      setCtx(c);
      setWarehouseId(c.rememberedWarehouseId || c.defaultWarehouseId || '');
      setApproverIds(c.rememberedApproverIds?.length ? c.rememberedApproverIds : c.approvers.length === 1 ? [c.approvers[0].id] : []);
      const next = toFormRows(v.lines, c.catalog, c.memory);
      setRows(next);
      setShowSpec(new Set(next.filter(r => r.spec).map(r => r.key)));
      setShowReason(new Set(next.filter(r => r.reason).map(r => r.key)));
    }).catch(e => { if (alive) setLoadError(e instanceof Error ? e.message : 'Chưa tải được danh mục vật tư của dự án.'); });
    return () => { alive = false; };
    // Tải một lần cho mỗi thẻ.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.id]);

  const catalog = ctx?.catalog || [];
  const byId = useMemo(() => new Map(catalog.map(i => [i.id, i])), [catalog]);
  const update = (key: string, fn: (row: MrFormRow) => MrFormRow) => setRows(rs => rs.map(r => (r.key === key ? fn(r) : r)));
  const pick = (row: MrFormRow, item: MrCatalogItem) => { update(row.key, r => chooseItem(r, item)); setSearching(null); };
  const kept = rows.filter(r => r.itemId);

  const submit = async (mode: 'send' | 'draft') => {
    const found = formProblems({ title, warehouseId, rows, purpose, approverIds }, catalog, mode);
    setProblems(found);
    if (found.length || !ctx) return;
    setBusy(mode); setError(null);
    try {
      const done = await actions.submit(command, {
        mode, title: title.trim(), warehouseId, neededDate: neededDate || null,
        lines: kept.map(r => ({ item: byId.get(r.itemId!)!, qty: parseQty(r.qty), spec: r.spec.trim(), reason: (r.reason || purpose).trim(),
          said: [r.line.name, r.line.spec].filter(Boolean).join(' ') })),
        approverIds, approverNames: ctx.approvers.filter(a => approverIds.includes(a.id)).map(a => a.name),
        warehouseName: ctx.warehouses.find(w => w.id === warehouseId)?.name,
      });
      onDone(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa gửi được đề xuất.');
    } finally { setBusy(null); }
  };

  if (loadError) {
    return (
      <div className="vcc-mr">
        <p className="vcc-cmd-warn" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {loadError}</p>
        <div className="vcc-cmd-actions">
          <button type="button" className="vcc-btn" data-pri="true" onClick={onOpenFull}><ArrowUpRight size={14} /> Mở form đầy đủ</button>
          <button type="button" className="vcc-btn" onClick={onCancel} disabled={busyCancel}><X size={14} /> Bỏ</button>
        </div>
      </div>
    );
  }
  if (!ctx) return <p className="vcc-cmd-muted vcc-mr-loading" role="status"><Loader2 size={14} className="animate-spin" /> Đang tải danh mục vật tư của dự án…</p>;

  const locked = busy !== null;
  return (
    <div className="vcc-mr" data-testid="mr-form">
      <div className="vcc-mr-fields">
        <label className="vcc-mr-field vcc-mr-wide"><span>Tên đề xuất</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} disabled={locked} aria-label="Tên đề xuất" /></label>
        <label className="vcc-mr-field vcc-mr-wide"><span>Dùng cho</span>
          <input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={200} disabled={locked} aria-label="Dùng cho" placeholder="Lý do chung cho các dòng" /></label>
        <label className="vcc-mr-field"><span>Kho nhận{ctx.rememberedWarehouseId && warehouseId === ctx.rememberedWarehouseId && <Remembered />}</span>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} disabled={locked} aria-label="Kho nhận">
            <option value="">— Chọn kho nhận —</option>
            {ctx.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <label className="vcc-mr-field"><span>Cần ngày</span>
          <input type="date" value={neededDate} onChange={e => setNeededDate(e.target.value)} disabled={locked} aria-label="Cần ngày" /></label>
      </div>

      <ul className="vcc-mr-rows" aria-label="Dòng vật tư">
        {rows.map(row => {
          const item = row.itemId ? byId.get(row.itemId) : undefined;
          const status = pill(row);
          const unitClash = item && row.line.unit && !sameUnit(row.line.unit, item.unit);
          const options = [...row.candidates.map(c => c.item), ...(item && !row.candidates.some(c => c.item.id === item.id) ? [item] : [])];
          const found = searching?.key === row.key ? searchCatalog(searching.query, catalog) : [];
          return (
            <li key={row.key} className="vcc-mr-row" data-state={item ? 'ok' : 'todo'}>
              <div className="vcc-mr-row-head">
                <span className="vcc-mr-pill" data-tone={status === 'Đã khớp' || status === 'Đã nhớ' ? 'ok' : status === 'Chọn mã' ? 'warn' : 'muted'}
                  title={status === 'Đã nhớ' ? 'Lần trước bạn đã chọn mã này cho cách gọi này' : undefined}>
                  {status === 'Đã khớp' && <CheckCircle2 size={11} aria-hidden="true" />}{status === 'Đã nhớ' && <Brain size={11} aria-hidden="true" />}{status}</span>
                <span className="vcc-mr-said">“{[row.line.name, row.line.spec].filter(Boolean).join(' ')}{row.line.qty != null ? ` · ${qtyShow(row.line.qty)} ${row.line.unit || ''}` : ''}”</span>
                <button type="button" className="vcc-mr-x" aria-label={`Bỏ dòng ${row.line.name}`} disabled={locked}
                  onClick={() => setRows(rs => rs.filter(r => r.key !== row.key))}><X size={13} /></button>
              </div>
              <div className="vcc-mr-row-main">
                <select value={row.itemId || ''} aria-label={`Mã vật tư cho ${row.line.name}`} disabled={locked}
                  onChange={e => { const it = byId.get(e.target.value); if (it) pick(row, it); }}>
                  {!item && <option value="">{row.candidates.length ? 'Chọn mã…' : 'Chưa có mã'}</option>}
                  {options.map(o => <option key={o.id} value={o.id}>{o.name} · {o.unit}{o.sku ? ` · ${o.sku}` : ''}</option>)}
                </select>
                <label className="vcc-mr-qty">
                  <input value={row.qty} inputMode="decimal" aria-label={`Số lượng ${row.line.name}`} disabled={locked}
                    placeholder={unitClash ? `SL ${item?.unit}` : 'SL'} data-warn={unitClash && !row.qty ? 'true' : undefined}
                    onChange={e => update(row.key, r => ({ ...r, qty: e.target.value }))} />
                  <span>{item?.unit || row.line.unit || ''}</span>
                </label>
              </div>
              {!item && row.candidates.length > 0 && (
                <div className="vcc-mr-chips" role="group" aria-label={`Gợi ý mã cho ${row.line.name}`}>
                  <span>Gợi ý:</span>
                  {row.candidates.slice(0, 3).map(c => <button key={c.item.id} type="button" disabled={locked} onClick={() => pick(row, c.item)}>{c.item.name} · {c.item.unit}</button>)}
                </div>
              )}
              {searching?.key === row.key ? (
                <div className="vcc-mr-search">
                  <label><Search size={13} aria-hidden="true" />
                    <input autoFocus value={searching.query} onChange={e => setSearching({ key: row.key, query: e.target.value })} aria-label={`Tìm mã cho ${row.line.name}`} placeholder="Gõ tên hoặc mã vật tư" /></label>
                  {found.length > 0 && <div className="vcc-mr-chips" role="group" aria-label={`Kết quả tìm cho ${row.line.name}`}>
                    {found.map(it => <button key={it.id} type="button" onClick={() => pick(row, it)}>{it.name} · {it.unit}</button>)}
                  </div>}
                  {searching.query.trim().length >= 2 && !found.length && <p className="vcc-cmd-muted">Không thấy mã khớp — mở form đầy đủ để đề xuất mã mới.</p>}
                </div>
              ) : null}
              {unitClash && (() => {
                const fromText = qtyInUnit({ note: row.line.note, raw: row.line.name, spec: row.line.spec }, item?.unit);
                return <p className="vcc-mr-warn"><AlertTriangle size={12} aria-hidden="true" />
                  {fromText != null ? `Câu ghi ${qtyShow(row.line.qty)} ${row.line.unit} và ${qtyShow(fromText)} ${item?.unit} — mã tính theo ${item?.unit}, đã lấy ${qtyShow(fromText)}.`
                    : `Câu ghi ${qtyShow(row.line.qty)} ${row.line.unit} — mã tính theo ${item?.unit}, nhập lại số lượng.`}</p>;
              })()}
              {(showSpec.has(row.key) || showReason.has(row.key)) && (
                <div className="vcc-mr-extra">
                  {showSpec.has(row.key) && <input value={row.spec} onChange={e => update(row.key, r => ({ ...r, spec: e.target.value }))} disabled={locked} aria-label={`Quy cách ${row.line.name}`} placeholder="Quy cách" />}
                  {showReason.has(row.key) && <input value={row.reason} onChange={e => update(row.key, r => ({ ...r, reason: e.target.value }))} disabled={locked} aria-label={`Lý do ${row.line.name}`} placeholder={purpose || 'Lý do'} />}
                </div>
              )}
              <p className="vcc-mr-links">
                {searching?.key !== row.key && <button type="button" onClick={() => setSearching({ key: row.key, query: row.line.name })} disabled={locked}>Tìm mã khác</button>}
                {!showSpec.has(row.key) && <button type="button" onClick={() => setShowSpec(s => new Set(s).add(row.key))} disabled={locked}>+ Quy cách</button>}
                {!showReason.has(row.key) && <button type="button" onClick={() => setShowReason(s => new Set(s).add(row.key))} disabled={locked}>+ Lý do riêng</button>}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="vcc-mr-approvers">
        <span className="vcc-mr-label">Người duyệt{Boolean(ctx.rememberedApproverIds?.length) && sameSet(approverIds, ctx.rememberedApproverIds!) && <Remembered />}</span>
        {ctx.sendBlocked ? <p className="vcc-mr-warn"><AlertTriangle size={12} aria-hidden="true" /> {ctx.sendBlocked} Vẫn lưu nháp được.</p> : (
          <div className="vcc-mr-chips" role="group" aria-label="Chọn người duyệt">
            {ctx.approvers.map(a => {
              const on = approverIds.includes(a.id);
              return <button key={a.id} type="button" aria-pressed={on} disabled={locked}
                onClick={() => setApproverIds(ids => (on ? ids.filter(id => id !== a.id) : [...ids, a.id]))}>{on && <CheckCircle2 size={12} aria-hidden="true" />}{a.name}</button>;
            })}
          </div>
        )}
      </div>

      {(problems.length > 0 || error) && (
        <ul className="vcc-mr-problems" role="alert">
          {problems.map(p => <li key={p}><AlertTriangle size={12} aria-hidden="true" /> {p}</li>)}
          {error && <li><AlertTriangle size={12} aria-hidden="true" /> {error}</li>}
        </ul>
      )}
      <div className="vcc-cmd-actions">
        <button type="button" className="vcc-btn" data-pri="true" onClick={() => void submit('send')} disabled={locked || Boolean(ctx.sendBlocked)}>
          {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {busy === 'send' ? 'Đang gửi…' : 'Gửi duyệt'}</button>
        <button type="button" className="vcc-btn" onClick={() => void submit('draft')} disabled={locked}>
          {busy === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Lưu nháp</button>
        <button type="button" className="vcc-btn" onClick={onOpenFull} disabled={locked}><ArrowUpRight size={14} /> Form đầy đủ</button>
        <button type="button" className="vcc-btn" onClick={onCancel} disabled={locked || busyCancel}><X size={14} /> Bỏ</button>
      </div>
      <p className="vcc-cmd-note"><Package size={11} aria-hidden="true" /> {kept.length}/{rows.length} dòng đã có mã · chưa gửi gì tới khi {you} bấm.</p>
    </div>
  );
};

export default AssistantMrForm;
