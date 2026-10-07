import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, RefreshCw } from 'lucide-react';
import { StateBox } from '../procurement/hub/hubUi';
import { CENTER_MODULE_KEYS, CENTER_MODULES, type CenterModuleKey } from '../../lib/center/centerRegistry';
import { dueInfo, sortWorkItems, type InboxTab, type WorkItem, type WorkItemsPage } from '../../lib/center/workItemsService';
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

const EMPTY_COPY: Record<InboxTab, { title: string; message: string }> = {
  mine: { title: 'Không còn việc chờ bạn', message: 'Việc mới sẽ hiện ở đây khi có người gửi tới bạn.' },
  sent: { title: 'Bạn chưa gửi hồ sơ nào đang chờ', message: 'Hồ sơ bạn lập mà người khác đang duyệt sẽ hiện ở đây.' },
  watch: { title: 'Chưa theo dõi hồ sơ nào', message: 'Yêu cầu, văn bản, công việc bạn được thêm vào theo dõi sẽ hiện ở đây.' },
};

const FOCUS_REFRESH_MS = 60_000;

export const workItemKey = (item: Pick<WorkItem, 'source' | 'id'>) => `${item.source}:${item.id}`;

// Cột "Việc của tôi": 3 tab, nhóm theo module (gập/mở), dòng việc mở hồ sơ. Tab "Chờ tôi" tải ngay,
// hai tab kia tải khi bấm; làm mới khi quay lại cửa sổ (tối đa 1 lần/phút) hoặc bấm nút.
const InboxPanel: React.FC<{
  hidden: boolean;
  load?: LoadWorkItems;
  now?: Date;
  activeItemKey: string | null;
  onOpen: (item: WorkItem) => void;
  onMineCount?: (count: number | null) => void;
  resizer?: React.ReactNode;
  /** Tăng để tải lại tab đang xem (sau khi gửi form từ Center). */
  refreshToken?: number;
}> = ({ hidden, load = loadWorkItemsShared, now = new Date(), activeItemKey, onOpen, onMineCount, resizer, refreshToken = 0 }) => {
  const [tab, setTab] = useState<InboxTab>('mine');
  const [states, setStates] = useState<Record<InboxTab, TabState>>({ mine: { status: 'idle' }, sent: { status: 'idle' }, watch: { status: 'idle' } });
  // Mặc định mọi nhóm thu gọn (chủ SP 07/10): thấy ngay có việc ở module nào, bấm nhóm để mở.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const requestSeq = useRef<Record<InboxTab, number>>({ mine: 0, sent: 0, watch: 0 });
  const lastFocusRefresh = useRef(0);
  const tabRef = useRef(tab);
  tabRef.current = tab;

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
  useEffect(() => { if (refreshToken > 0) loadTab(tabRef.current, true); }, [refreshToken, loadTab]);
  useEffect(() => { if (states[tab].status === 'idle') loadTab(tab); }, [tab, states, loadTab]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const at = Date.now();
      if (at - lastFocusRefresh.current < FOCUS_REFRESH_MS) return;
      lastFocusRefresh.current = at;
      loadTab(tabRef.current, true);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loadTab]);

  const mineState = states.mine;
  const mineCount = 'page' in mineState && mineState.page ? mineState.page.total : null;
  useEffect(() => { onMineCount?.(mineCount); }, [mineCount, onMineCount]);

  const state = states[tab];
  const page = 'page' in state ? state.page : undefined;
  const groups = useMemo(() => {
    const byModule = new Map<CenterModuleKey, WorkItem[]>();
    (page?.items || []).forEach(item => byModule.set(item.module, [...(byModule.get(item.module) || []), item]));
    return CENTER_MODULE_KEYS.filter(key => byModule.has(key)).map(key => ({ key, items: sortWorkItems(byModule.get(key)!) }));
  }, [page]);

  const groupKey = (module: CenterModuleKey) => `${tab}:${module}`;
  const anyOpen = groups.some(group => opened.has(groupKey(group.key)));
  const toggleGroup = (module: CenterModuleKey) => setOpened(current => {
    const next = new Set(current);
    const key = groupKey(module);
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
            <button key={item.id} type="button" role="tab" className="vcc-tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
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
            <section key={group.key} className={`vcc-mod-${group.key}`}>
              <button type="button" className="vcc-ghead" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                <span className="vcc-chev"><ChevronDown size={12} /></span>
                <span className="vcc-modname">{CENTER_MODULES[group.key].label}</span>
                {urgent > 0 && <span className="vcc-gurgent" title="Quá hạn hoặc hết hạn trong hôm nay">{urgent} gấp</span>}
                <span className="vcc-gcount"> {group.items.length}</span>
              </button>
              {open && group.items.map(item => {
                const key = workItemKey(item);
                const due = dueInfo(item.dueAt, now);
                return (
                  <button key={key} type="button" className="vcc-row" aria-current={activeItemKey === key} onClick={() => onOpen(item)}>
                    <div className="vcc-row-top">
                      <span className="vcc-ent">{item.code}</span>
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
              })}
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
