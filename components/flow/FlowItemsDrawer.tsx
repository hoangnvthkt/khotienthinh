import React, { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import type { FlowItem, FlowItemsFilter, FlowRemindOutcome, LoadFlowItems, RemindFlow } from '../../lib/center/centerFlowService';
import { FLOW_UNASSIGNED } from '../../lib/center/centerFlowService';
import { daysSince, ddmm, fmtInt, sourceLabel } from '../../lib/center/flowModel';
import { displayCode, type WorkItem } from '../../lib/center/workItemsService';

// Ngăn danh sách phiếu đang chờ (bấm xuống từ người / phòng / nguồn / tình trạng): bấm dòng mở phiếu thành tab của Center,
// nút Nhắc gửi thông báo + push tới người đang giữ (máy chủ chống nhắc dồn 24 giờ, không tự nhắc mình).

export interface FlowItemsView { title: string; subtitle?: string; filter: FlowItemsFilter }
type PageState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; total: number; items: FlowItem[] };
const PAGE = 50;

const ItemRow: React.FC<{ item: FlowItem; now: Date; onOpen: (item: WorkItem) => void }> = ({ item, now, onOpen }) => {
  const wait = daysSince(item.since, now);
  return (
    <button type="button" className="vfl-item" data-tone={item.dead ? 'dead' : item.stuck ? 'stuck' : item.overdue ? 'overdue' : undefined} onClick={() => onOpen(item)}>
      <span className="vfl-item-code">{displayCode(item)}</span>
      <span className="vfl-item-main">
        <span className="vfl-item-title">{item.title}</span>
        <span className="vfl-item-meta">
          {sourceLabel(item.source)}{item.kindName && item.kindName !== sourceLabel(item.source) ? ` · ${item.kindName}` : ''}
          {item.projectCode ? ` · ${item.projectCode}` : ''}
          {item.sender?.name ? ` · ${item.sender.name} gửi` : ''}
        </span>
      </span>
      <span className="vfl-item-holder">
        {item.holder ? <span className="vcc-who">{item.holder.name || 'Người dùng'}</span>
          : item.holderRole ? <span className="vfl-pill">Chờ {item.holderRole}</span>
          : <span className="vfl-pill" data-tone="bad">Chưa giao người</span>}
      </span>
      <span className="vfl-item-age" data-tone={item.dead ? 'bad' : item.stuck ? 'bad' : item.overdue ? 'warn' : undefined}>
        {wait === 0 ? 'hôm nay' : `${fmtInt(wait)} ngày`}
        <small>từ {ddmm(item.since)}{item.overdue ? ' · quá hạn' : ''}{item.slaDefault && item.overdue ? ' (SLA mặc định)' : ''}</small>
      </span>
    </button>
  );
};

export const FlowItemsDrawer: React.FC<{
  view: FlowItemsView;
  now: Date;
  loadItems: LoadFlowItems;
  remind?: RemindFlow;
  onOpenItem: (item: WorkItem) => void;
  onClose: () => void;
}> = ({ view, now, loadItems, remind, onOpenItem, onClose }) => {
  const [page, setPage] = useState<PageState>({ status: 'loading' });
  const [more, setMore] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FlowRemindOutcome | { access: false; reason: string } | null>(null);
  const filterKey = JSON.stringify(view.filter);
  useEffect(() => {
    let alive = true;
    setPage({ status: 'loading' }); setResult(null); setConfirm(false);
    loadItems(view.filter, PAGE, 0)
      .then(res => { if (!alive) return; setPage(res.access ? { status: 'ready', total: res.total, items: res.items } : { status: 'error', message: 'Bạn không có phạm vi xem danh sách này.' }); })
      .catch(error => { if (alive) setPage({ status: 'error', message: error instanceof Error ? error.message : 'Chưa tải được danh sách.' }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, loadItems]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const loadMore = () => {
    if (page.status !== 'ready') return;
    setMore(true);
    loadItems(view.filter, PAGE, page.items.length)
      .then(res => { if (res.access) setPage(current => (current.status === 'ready' ? { status: 'ready', total: res.total, items: [...current.items, ...res.items] } : current)); })
      .catch(() => undefined)
      .finally(() => setMore(false));
  };
  const holders = page.status === 'ready' ? new Set(page.items.filter(item => item.holder).map(item => item.holder!.userId)) : new Set<string>();
  const send = () => {
    if (!remind) return;
    setSending(true);
    remind(view.filter, note)
      .then(res => setResult(res))
      .catch(error => setResult({ access: false, reason: error instanceof Error ? error.message : 'Chưa gửi được.' }))
      .finally(() => { setSending(false); setConfirm(false); });
  };
  const resultText = result === null ? null : result.access === true
    ? `Đã nhắc ${fmtInt(result.sent)} người${result.skipped ? ` · ${fmtInt(result.skipped)} người bỏ qua (đã nhắc trong 24 giờ hoặc là chính bạn)` : ''}.`
    : `Chưa gửi được: ${result.reason}`;

  return (
    <div className="vdb-drawer" role="dialog" aria-modal="true" aria-label={view.title}>
      <button type="button" className="vdb-drawer-bg" aria-label="Đóng" onClick={onClose} />
      <aside className="vdb-drawer-panel vfl-items">
        <header className="vdb-drawer-head">
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-bold">{view.title}</h3>
            <p className="m-0 mt-0.5 text-xs vdb-muted">
              {page.status === 'ready' ? `${fmtInt(page.total)} phiếu` : view.subtitle || ''}{view.subtitle && page.status === 'ready' ? ` · ${view.subtitle}` : ''} · bấm một phiếu để mở.
            </p>
          </div>
          <button type="button" className="vdb-menu" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
        </header>
        <div className="vdb-drawer-body">
          {page.status === 'loading' && <p className="m-0 px-2 py-8 text-center text-sm vdb-muted" role="status">Đang tải…</p>}
          {page.status === 'error' && <p className="m-0 px-2 py-8 text-center text-sm" role="alert">{page.message}</p>}
          {page.status === 'ready' && page.items.length === 0 && <p className="m-0 px-2 py-8 text-center text-sm vdb-muted">Không có phiếu nào đang chờ.</p>}
          {page.status === 'ready' && page.items.length > 0 && (
            <div className="vfl-item-list" role="list">
              {page.items.map(item => <ItemRow key={`${item.source}:${item.id}`} item={item} now={now} onOpen={onOpenItem} />)}
            </div>
          )}
          {page.status === 'ready' && page.items.length < page.total && (
            <button type="button" className="vdb-btn mt-2" onClick={loadMore} disabled={more}>{more ? 'Đang tải…' : `Tải thêm (${fmtInt(page.total - page.items.length)} phiếu nữa)`}</button>
          )}
        </div>
        {remind && page.status === 'ready' && holders.size > 0 && (
          <footer className="vdb-drawer-foot vfl-items-foot">
            {resultText && <p className="m-0 text-xs" role="status" data-tone={result?.access ? 'ok' : 'bad'}>{resultText}</p>}
            {!confirm && !resultText && (
              <button type="button" className="vdb-pri" onClick={() => setConfirm(true)} title="Gửi thông báo trong app và trên điện thoại tới người đang giữ việc; mỗi người tối đa một lần mỗi 24 giờ">
                <BellRing size={14} /> Nhắc {fmtInt(holders.size)} người
              </button>
            )}
            {confirm && (
              <div className="vfl-remind">
                <input className="vdb-select" value={note} onChange={event => setNote(event.target.value)} maxLength={300} placeholder="Ghi chú thêm (không bắt buộc)" aria-label="Ghi chú nhắc" />
                <div className="flex gap-2">
                  <button type="button" className="vdb-pri" onClick={send} disabled={sending} aria-busy={sending}>{sending ? 'Đang gửi…' : `Gửi nhắc tới ${fmtInt(holders.size)} người`}</button>
                  <button type="button" className="vdb-btn" onClick={() => setConfirm(false)} disabled={sending}>Hủy</button>
                </div>
              </div>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
};

export default FlowItemsDrawer;
export const holderOf = (item: FlowItem): string => item.holder?.name || (item.holderRole ? `Chờ ${item.holderRole}` : 'Chưa giao người');
export const isGapHolder = (item: FlowItem): boolean => !!item.holder && item.holder.unitId === FLOW_UNASSIGNED;
