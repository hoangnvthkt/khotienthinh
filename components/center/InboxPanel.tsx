import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { INBOX_GROUPS, inboxGroupOf, type InboxGroupKey } from '../../lib/center/centerRegistry';
import { SOURCE_LABEL, displayCode, dueInfo, sortWorkItems, type InboxTab, type WorkItem, type WorkItemsPage } from '../../lib/center/workItemsService';
import { loadWorkItemsShared } from '../../lib/center/workItemsStore';

export type LoadWorkItems = (tab: InboxTab, options?: { force?: boolean }) => Promise<WorkItemsPage>;

type TabState =
  | { status: 'idle' }
  | { status: 'loading'; page?: WorkItemsPage }
  | { status: 'ready'; page: WorkItemsPage }
  | { status: 'error'; message: string; page?: WorkItemsPage };

const TABS: ReadonlyArray<{ id: InboxTab; label: string }> = [
  { id: 'mine', label: 'Chờ tôi' },
  { id: 'sent', label: 'Tôi gửi' },
  { id: 'watch', label: 'Theo dõi' },
];

/** Nhóm ghim (Dự án, Công việc) đang trống ở tab này. */
const GROUP_EMPTY: Record<InboxTab, string> = {
  mine: 'Không có việc nào chờ bạn ở đây.',
  sent: 'Không có hồ sơ bạn gửi đang chờ ở đây.',
  watch: 'Không có hồ sơ bạn theo dõi ở đây.',
};

const EMPTY_COPY: Record<InboxTab, { title: string; message: string }> = {
  mine: { title: 'Không còn việc chờ bạn', message: 'Việc mới sẽ hiện ở đây khi có người gửi tới bạn.' },
  sent: { title: 'Bạn chưa gửi hồ sơ nào đang chờ', message: 'Hồ sơ bạn lập mà người khác đang duyệt sẽ hiện ở đây.' },
  watch: { title: 'Chưa theo dõi hồ sơ nào', message: 'Yêu cầu, văn bản, công việc bạn được thêm vào theo dõi sẽ hiện ở đây.' },
};

const FOCUS_REFRESH_MS = 60_000;

export const workItemKey = (item: Pick<WorkItem, 'source' | 'id'>) => `${item.source}:${item.id}`;

// Cột "Việc của tôi": 3 tab, nhóm theo INBOX_GROUPS (gập/mở), dòng việc mở hồ sơ. "Chờ tôi" tải ngay và tự làm mới
// khi quay lại cửa sổ (tối đa 1 lần/phút) hoặc sau khi gửi form; "Tôi gửi" / "Theo dõi" không tải ngầm — chỉ tải
// (mới) mỗi lần người dùng bấm vào tab hoặc bấm làm mới (chủ SP 07/10).
const InboxPanel: React.FC<{
  hidden: boolean;
  load?: LoadWorkItems;
  now?: Date;
  activeItemKey: string | null;
  onOpen: (item: WorkItem) => void;
  onMineCount?: (count: number | null) => void;
  /** Việc Chờ tôi đã tải (để chấm hạn trên lịch). */
  /** Lọc theo hạn (ô Lịch ở Hôm nay); việc không có hạn bị ẩn khi đang lọc. */
  resizer?: React.ReactNode;
  /** Tăng để tải lại "Chờ tôi" (sau khi gửi form từ Center). */
  refreshToken?: number;
}> = ({ hidden, load = loadWorkItemsShared, now: nowProp, activeItemKey, onOpen, onMineCount, resizer, refreshToken = 0 }) => {
  const [mountedAt] = useState(() => new Date());
  const now = nowProp ?? mountedAt;
  const [tab, setTab] = useState<InboxTab>('mine');
  const [states, setStates] = useState<Record<InboxTab, TabState>>({ mine: { status: 'idle' }, sent: { status: 'idle' }, watch: { status: 'idle' } });
  // Mặc định mọi nhóm thu gọn (chủ SP 07/10): thấy ngay có việc ở nhóm nào, bấm nhóm để mở.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const requestSeq = useRef<Record<InboxTab, number>>({ mine: 0, sent: 0, watch: 0 });
  const lastFocusRefresh = useRef(0);

  const loadTab = useCallback((target: InboxTab, force = false) => {
    const seq = ++requestSeq.current[target];
    setStates(current => ({ ...current, [target]: { status: 'loading', page: 'page' in current[target] ? current[target].page : undefined } }));
    load(target, { force }).then(page => {
      if (requestSeq.current[target] !== seq) return;
      setStates(current => ({ ...current, [target]: { status: 'ready', page } }));
    }).catch(error => {
      if (requestSeq.current[target] !== seq) return;
      console.warn('Center work items failed:', error);
      setStates(current => ({ ...current, [target]: { status: 'error', message: 'Chưa tải được việc. Kiểm tra mạng rồi thử lại.', page: 'page' in current[target] ? current[target].page : undefined } }));
    });
  }, [load]);

  useEffect(() => { loadTab('mine'); }, [loadTab]);
  useEffect(() => { if (refreshToken > 0) loadTab('mine', true); }, [refreshToken, loadTab]);
  // Bấm tab: "Chờ tôi" dùng bản chung (≤ 60 giây), hai tab kia luôn tải mới.
  const selectTab = (target: InboxTab) => {
    setTab(target);
    loadTab(target, target !== 'mine');
  };

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const at = Date.now();
      if (at - lastFocusRefresh.current < FOCUS_REFRESH_MS) return;
      lastFocusRefresh.current = at;
      loadTab('mine', true);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loadTab]);

  const mineState = states.mine;
  const mineCount = 'page' in mineState && mineState.page ? mineState.page.total : null;
  useEffect(() => { onMineCount?.(mineCount); }, [mineCount, onMineCount]);
  const minePage = 'page' in mineState ? mineState.page : undefined;

  const state = states[tab];
  const page = 'page' in state ? state.page : undefined;
  // Nhóm ghim luôn có mặt khi tab có việc.
  const groups = useMemo(() => {
    if (!page || page.items.length === 0) return [];
    const byGroup = new Map<InboxGroupKey, WorkItem[]>();
    page.items
      .forEach(item => {
        const key = inboxGroupOf(item.module);
        byGroup.set(key, [...(byGroup.get(key) || []), item]);
      });
    return INBOX_GROUPS.filter(group => byGroup.has(group.key) || group.pinned)
      .map(group => ({ ...group, items: sortWorkItems(byGroup.get(group.key) || []) }));
  }, [page]);

  const groupKey = (key: InboxGroupKey) => `${tab}:${key}`;
  const anyOpen = groups.some(group => opened.has(groupKey(group.key)));
  const toggleGroup = (group: InboxGroupKey) => setOpened(current => {
    const next = new Set(current);
    const key = groupKey(group);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const foldAll = () => setOpened(current => {
    const next = new Set(current);
    groups.forEach(group => { if (anyOpen) next.delete(groupKey(group.key)); else next.add(groupKey(group.key)); });
    return next;
  });

  const countOf = (id: InboxTab) => {
    const s = states[id];
    return 'page' in s && s.page ? s.page.total : null;
  };

  return (
    <aside className="vcc-inbox" data-hidden={hidden} aria-label="Việc của tôi">
      <div className="vcc-tabs" role="tablist" aria-label="Nhóm việc">
        {TABS.map(item => {
          const count = countOf(item.id);
          return (
            <button key={item.id} type="button" role="tab" className="vcc-tab" aria-selected={tab === item.id} onClick={() => selectTab(item.id)}>
              {item.label}{count !== null && <span className="vcc-tabcount"> {count}</span>}
            </button>
          );
        })}
        <div className="vcc-tabtools">
          <button type="button" className="vcc-tabtool" onClick={() => loadTab(tab, true)} disabled={state.status === 'loading'} aria-label="Làm mới" title="Làm mới">
            <RefreshCw size={13} className={state.status === 'loading' ? 'animate-spin' : undefined} />
          </button>
          {groups.length > 1 && (
            <button type="button" className="vcc-tabtool" onClick={foldAll} title={anyOpen ? 'Thu gọn tất cả nhóm' : 'Mở tất cả nhóm'}>
              {anyOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />} {anyOpen ? 'Gọn' : 'Mở'}
            </button>
          )}
        </div>
      </div>
      <div className="vcc-scroll" role="tabpanel">
        {state.status === 'error' && !page && (
          <div className="p-3"><StateBox kind="error" message={state.message} onRetry={() => loadTab(tab)} /></div>
        )}
        {state.status === 'loading' && !page && (
          <div className="p-3"><StateBox kind="loading" title="Đang gom việc từ các module…" /></div>
        )}
        {page && page.items.length === 0 && (
          <div className="p-3"><StateBox kind="empty" title={EMPTY_COPY[tab].title} message={EMPTY_COPY[tab].message} /></div>
        )}
        {state.status === 'error' && page && <div className="vcc-note" role="alert">{state.message}</div>}
        {groups.map(group => {
          const open = opened.has(groupKey(group.key));
          const urgent = group.items.filter(item => dueInfo(item.dueAt, now)?.tone === 'hot').length;
          return (
            <section key={group.key} className={`vcc-group vcc-mod-${group.key}`} data-open={open || undefined} data-empty={group.items.length === 0 || undefined}>
              <button type="button" className="vcc-ghead" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                <span className="vcc-chev"><ChevronDown size={12} /></span>
                <span className="vcc-modname">{group.label}</span>
                {urgent > 0 && <span className="vcc-gurgent" title="Quá hạn hoặc hết hạn trong hôm nay">{urgent} gấp</span>}
                <span className="vcc-gcount"> {group.items.length}</span>
              </button>
              {open && group.items.length === 0 && (
                <div className="vcc-gempty">
                  {GROUP_EMPTY[tab]}
                  {group.covers && <span className="vcc-gempty-covers">Gồm {group.covers.charAt(0).toLowerCase()}{group.covers.slice(1)}</span>}
                </div>
              )}
              {open && group.items.length > 0 && <div className="vcc-grows">{group.items.map(item => {
                const key = workItemKey(item);
                const due = dueInfo(item.dueAt, now);
                // Nhóm gom nhiều loại hồ sơ (Dự án, Công việc): ghi loại cạnh mã cho dễ nhận.
                const kindLabel = group.modules.length > 1 || group.pinned ? SOURCE_LABEL[item.source] : undefined;
                return (
                  <button key={key} type="button" className="vcc-row" aria-current={activeItemKey === key} onClick={() => onOpen(item)}>
                    <div className="vcc-row-top">
                      <span className="vcc-ent">{displayCode(item)}</span>
                      {kindLabel && <span className="vcc-src">{kindLabel}</span>}
                      {due && <span className="vcc-due" data-tone={due.tone}>{due.label}</span>}
                    </div>
                    <div className="vcc-row-title">{item.title}</div>
                    {(item.who || item.meta) && (
                      <div className="vcc-row-meta">
                        {item.who && <span className="vcc-who">{item.who}</span>}
                        {item.who && item.meta && ' · '}
                        {item.meta}
                      </div>
                    )}
                  </button>
                );
              })}</div>}
            </section>
          );
        })}
        {page && page.truncatedSources.length > 0 && (
          <div className="vcc-note">Một số nguồn chỉ hiện 200 việc gần nhất. Vào module để xem hết.</div>
        )}
      </div>
      <div className="vcc-foot">Lấy từ phân công thật của từng module. Thông báo không tính là việc.</div>
      {resizer}
    </aside>
  );
};

export default InboxPanel;
