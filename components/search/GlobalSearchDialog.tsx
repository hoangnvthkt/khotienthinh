import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Bot, ChevronDown, ChevronLeft, History, Loader2, LockKeyhole, Search, SearchX, Sparkles, X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../context/ThemeContext';
import { canAccessRoute, getRouteModuleKey } from '../../lib/routeAccess';
import { navigationModulesFor, useModuleNavigation } from '../Sidebar';
import { useCenterUi } from '../../lib/center/centerMode';
import { useCenterNavigate } from '../../lib/center/centerOpen';
import { useRouteTitle } from '../center/useRouteTitle';
import { buildActionEntries, buildPageEntries, featuredActions, quickActionDefs, type NavItemInput, type NavModuleInput } from '../../lib/search/searchCatalog';
import {
  displayWord, learnVocabulary, parseQuery, prepareEntry, rankLocal, scoreEntry, serverTerms, suggestCorrection, type ParsedQuery,
} from '../../lib/search/searchEngine';
import { GROUP_LABEL, GROUP_ORDER, KIND_META, recordToEntry } from '../../lib/search/recordPresentation';
import { HEAVY_KINDS, clearSearchCache, searchRecords } from '../../lib/search/globalSearchService';
import { forgetQueries, readHistory, rememberOpened, rememberQuery } from '../../lib/search/searchHistory';
import { RECORD_KINDS, type RecordKind, type SearchEntry, type SearchGroup, type SearchRelatedLink, type ServerRecord } from '../../lib/search/searchTypes';
import { ENT, GROUP_TILE, Highlighted, Kbd, NUM, StatusBadge, entryIcon } from './globalSearchUi';

// Hộp Tìm kiếm toàn hệ thống (tải lười từ components/CommandPalette.tsx khi mở lần đầu).
// Tìm chức năng + thao tác nhanh (theo quyền, ngay trên máy) và mọi hồ sơ người dùng được xem (máy chủ, RLS).

type Modal = NonNullable<SearchEntry['modal']>;

// ── Hộp tìm kiếm ──────────────────────────────────────────────────────────────────────────────

type ServerState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  records: ServerRecord[];
  failed: RecordKind[];
  pending: number;
  /** Lượt gọi hiện tại; fresh = records đã thuộc lượt này (trước đó vẫn hiện kết quả cũ cho đỡ nháy). */
  generation: number;
  fresh: boolean;
  /** Câu gõ của lượt gọi — kết quả của câu cũ chỉ được giữ khi vẫn khớp câu đang gõ. */
  text: string;
};

const IDLE: ServerState = { status: 'idle', records: [], failed: [], pending: 0, generation: 0, fresh: true, text: '' };

type Section = { id: string; title: string; entries: SearchEntry[]; more?: { group: SearchGroup; count: number } };

const GROUP_PREVIEW = 4;
const DEBOUNCE_MS = 220;

const useDebounced = <T,>(value: T, delay: number): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

const isExternal = (route: string) => /^(tel|mailto):/.test(route);

export interface GlobalSearchViewProps {
  initialQuery: string;
  userId: string | null;
  pathname: string;
  /** App người dùng được vào (thanh bên) và chức năng trong từng app — đã lọc theo quyền. */
  modules: NavModuleInput[];
  navItems: (moduleKey: string) => NavItemInput[];
  /** Mở được màn này không (canAccessRoute của người dùng). */
  canAccess: (route: string) => boolean;
  onNavigate: (route: string, state?: unknown) => void;
  onToggleTheme: () => void;
  onClose: () => void;
  onModal: (modal: Modal) => void;
  /** Tìm hồ sơ trên máy chủ — fixture thay bằng dữ liệu mẫu. */
  search?: typeof searchRecords;
}

/** Nối hộp tìm kiếm với app: người dùng, quyền, thanh bên, điều hướng, giao diện. */
export const GlobalSearchDialog: React.FC<{ initialQuery: string; onClose: () => void; onModal: (modal: Modal) => void }> = ({ initialQuery, onClose, onModal }) => {
  const { user } = useApp();
  const { toggleTheme } = useTheme();
  const { pathname } = useLocation();
  const navFor = useModuleNavigation();
  const modules = useMemo(() => navigationModulesFor(user).map(module => ({ key: module.key, label: module.label, route: module.route })), [user]);
  const navItems = useCallback((key: string) => navFor(key as Parameters<typeof navFor>[0]).map(item => ({ to: item.to, label: item.label, icon: item.icon })), [navFor]);
  const canAccess = useCallback((route: string) => canAccessRoute(user, route), [user]);
  // Giao diện Trung tâm: kết quả mở thành tab mới trong Trung tâm (chủ SP 10/10); giao diện cũ chuyển trang như trước.
  const centerActive = useCenterUi(user).active;
  const go = useCenterNavigate(centerActive);
  const titleOf = useRouteTitle();
  const onNavigate = useCallback((route: string, state?: unknown) => go(route, { state, title: titleOf(route) || undefined }), [go, titleOf]);
  return (
    <GlobalSearchView initialQuery={initialQuery} userId={user?.id || null} pathname={pathname} modules={modules} navItems={navItems}
      canAccess={canAccess} onNavigate={onNavigate} onToggleTheme={toggleTheme} onClose={onClose} onModal={onModal} />
  );
};

export const GlobalSearchView: React.FC<GlobalSearchViewProps> = ({
  initialQuery, userId, pathname, modules, navItems, canAccess, onNavigate, onToggleTheme, onClose, onModal, search = searchRecords,
}) => {

  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<'all' | SearchGroup>('all');
  const [selected, setSelected] = useState(0);
  const [pickFor, setPickFor] = useState<SearchEntry | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState(() => readHistory(userId));
  const [server, setServer] = useState<ServerState>(IDLE);
  const [retry, setRetry] = useState(0);
  const generationRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    clearSearchCache();
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.clearTimeout(timer); document.body.style.overflow = previousOverflow; };
  }, []);

  const canOpen = useCallback((route: string) => route === '*' || isExternal(route) || canAccess(route), [canAccess]);

  // Chức năng + thao tác theo quyền (tính một lần khi mở).
  const { pages, actions, actionDefs } = useMemo(() => {
    const pageEntries = buildPageEntries(modules, navItems, canOpen);
    const defs = quickActionDefs(new Date());
    const actionEntries = buildActionEntries(defs, canOpen);
    learnVocabulary([...pageEntries, ...actionEntries].map(entry => entry.title));
    return { pages: pageEntries, actions: actionEntries, actionDefs: defs };
  }, [modules, navItems, canOpen]);

  const recentEntries = useMemo<SearchEntry[]>(() => history.opened
    .filter(entry => !entry.route || canOpen(entry.route.split('?')[0]))
    .map(entry => ({ ...entry, subtitle: null, status: null })), [history.opened, canOpen]);

  const localIndex = useMemo(() => [...actions, ...pages, ...recentEntries.filter(entry => entry.kind !== 'action' && entry.kind !== 'page')]
    .map(prepareEntry), [actions, pages, recentEntries]);

  const allowedKinds = useMemo(() => RECORD_KINDS.filter(kind => KIND_META[kind].gates.some(canOpen)), [canOpen]);
  const canAskAi = useMemo(() => canOpen('/ai'), [canOpen]);

  const parsed = useMemo<ParsedQuery | null>(() => (query.trim() ? parseQuery(query) : null), [query]);
  const debouncedQuery = useDebounced(query, DEBOUNCE_MS);
  // Xóa hết chữ (hoặc vừa vào bước chọn dự án) thì không chờ: tránh tìm lại câu cũ rồi báo rỗng.
  const searchQuery = query.trim() ? debouncedQuery : '';

  // ── Gọi máy chủ: hồ sơ (bình thường) hoặc danh sách dự án (bước chọn dự án). ──
  useEffect(() => {
    const text = searchQuery.trim();
    const picking = Boolean(pickFor);
    if (!picking && !text) { setServer(IDLE); return; }
    const terms = text ? serverTerms(parseQuery(text)) : [];
    let kinds: RecordKind[];
    if (picking) kinds = allowedKinds.includes('project') ? ['project'] : [];
    else kinds = scope === 'all' || scope === 'action' || scope === 'page' ? [...allowedKinds] : allowedKinds.filter(kind => KIND_META[kind].group === scope);
    if (!kinds.length || (!picking && !terms.length)) { setServer({ ...IDLE, status: 'ready' }); return; }

    const controller = new AbortController();
    const generation = ++generationRef.current;
    // Nguồn nhanh và nguồn nặng đi hai lượt song song. Đang lọc một nhóm thì lấy nhiều hơn cho nhóm đó,
    // vẫn giữ lượt chung (đã nhớ) để các chip nhóm khác không mất số đếm.
    const split = (list: RecordKind[], limit: number) => [
      { kinds: list.filter(kind => !HEAVY_KINDS.includes(kind)), limit },
      { kinds: list.filter(kind => HEAVY_KINDS.includes(kind)), limit },
    ];
    const batches = (picking ? [{ kinds, limit: 20 }]
      : scope === 'all' || scope === 'action' || scope === 'page' ? split(kinds, 6)
        : [...split(allowedKinds, 6), ...split(kinds, 20)]).filter(batch => batch.kinds.length);
    setServer(current => ({
      status: 'loading', records: current.status === 'idle' ? [] : current.records, failed: [], pending: batches.length, generation, fresh: false,
      text: current.text,
    }));
    const settle = (records: ServerRecord[], failed: RecordKind[]) => setServer(current => {
      if (current.generation !== generation) return current;
      const keep = current.fresh ? current.records : [];
      const pending = current.pending - 1;
      const allFailed = [...new Set([...current.failed, ...failed])];
      const merged = [...keep, ...records];
      const status = pending > 0 ? 'loading' : merged.length || allFailed.length < kinds.length ? 'ready' : 'error';
      return { status, records: merged, failed: allFailed, pending, generation, fresh: true, text };
    });
    batches.forEach(({ kinds: batch, limit }) => {
      search(terms, batch, limit, controller.signal)
        .then(result => { if (!controller.signal.aborted) settle(result.records, result.failed); })
        .catch(error => { if (!controller.signal.aborted && error?.name !== 'AbortError') settle([], batch); });
    });
    return () => controller.abort();
  }, [searchQuery, scope, pickFor, allowedKinds, retry, search]);

  // Học thêm từ trong tên hồ sơ (tên người, tên dự án, NCC) để gợi ý sửa lỗi gõ sát dữ liệu thật.
  useEffect(() => { learnVocabulary(server.records.map(record => record.title || '')); }, [server.records]);

  const usage = useCallback((key: string) => history.usage[key] || 0, [history.usage]);

  // ── Ghép kết quả: cục bộ (chức năng, thao tác, gần đây) + hồ sơ máy chủ, xếp bằng cùng một thước đo. ──
  const ranked = useMemo<Array<{ entry: SearchEntry; score: number }>>(() => {
    if (!parsed || pickFor) return [];
    const currentModule = getRouteModuleKey(pathname);
    const byKey = new Map<string, { entry: SearchEntry; score: number }>();
    rankLocal(localIndex, parsed, 60).forEach(({ entry, score }) => {
      const sameModule = entry.route && currentModule && getRouteModuleKey(entry.route) === currentModule ? 3 : 0;
      byKey.set(entry.key, { entry, score: score + sameModule + Math.min(usage(entry.key) * 2, 10) });
    });
    const sameQuery = server.text === query.trim();
    server.records.forEach(record => {
      const entry = recordToEntry(record);
      const local = scoreEntry(prepareEntry(entry), parsed);
      // Đang gõ câu mới, máy chủ chưa trả: chỉ giữ hồ sơ cũ còn khớp câu mới (không hiện hồ sơ lạc đề).
      if (!sameQuery && !local.matchedAll) return;
      const score = Math.max(local.score, 12) + record.rank / 20 + Math.min(usage(entry.key) * 2, 10);
      const existing = byKey.get(entry.key);
      byKey.set(entry.key, { entry, score: Math.max(score, existing?.score || 0) });
    });
    return [...byKey.values()].sort((a, b) => b.score - a.score);
  }, [parsed, pickFor, localIndex, server.records, server.text, query, usage, pathname]);

  const groupCounts = useMemo(() => {
    const counts = new Map<SearchGroup, number>();
    ranked.forEach(({ entry }) => counts.set(entry.group, (counts.get(entry.group) || 0) + 1));
    return counts;
  }, [ranked]);

  // Bỏ phạm vi đang chọn khi nhóm đó hết kết quả.
  useEffect(() => {
    if (scope !== 'all' && server.status !== 'loading' && !groupCounts.get(scope)) setScope('all');
  }, [scope, groupCounts, server.status]);

  const askAiEntry = useMemo<SearchEntry | null>(() => (parsed && canAskAi && !pickFor ? {
    key: 'action:ask-ai', kind: 'action', group: 'action', title: `Hỏi Trợ lý AI: “${query.trim()}”`,
    subtitle: 'Hỏi bằng câu tự nhiên, trợ lý trả lời theo dữ liệu bạn được xem', context: 'Trợ lý AI', command: 'ask-ai',
  } : null), [parsed, canAskAi, pickFor, query]);

  const sections = useMemo<Section[]>(() => {
    if (pickFor) {
      // Lọc ngay theo chữ đang gõ — Enter trước khi máy chủ trả vẫn chọn đúng dự án.
      const typed = query.trim() && server.text !== query.trim() ? parseQuery(query) : null;
      const projects = server.records.filter(record => record.kind === 'project').map(recordToEntry)
        .filter(entry => !typed || scoreEntry(prepareEntry(entry), typed).matchedAll);
      return [{ id: 'pick', title: 'Chọn dự án', entries: projects }];
    }
    if (!parsed) {
      const result: Section[] = [];
      const featured = featuredActions(actions, actionDefs, usage, 8);
      if (featured.length) result.push({ id: 'featured', title: 'Thao tác nhanh', entries: featured });
      if (recentEntries.length) result.push({ id: 'recent', title: 'Mở gần đây', entries: recentEntries.slice(0, 6) });
      return result;
    }
    const scoped = scope === 'all' ? ranked : ranked.filter(({ entry }) => entry.group === scope);
    const result: Section[] = [];
    let rest = scoped;
    if (scope === 'all' && scoped.length > 3 && scoped[0].score >= 24 && scoped[0].score - (scoped[1]?.score || 0) >= 4) {
      result.push({ id: 'top', title: 'Phù hợp nhất', entries: [scoped[0].entry] });
      rest = scoped.slice(1);
    }
    GROUP_ORDER.forEach(group => {
      const items = rest.filter(({ entry }) => entry.group === group).map(({ entry }) => entry);
      if (!items.length) return;
      const limit = scope === 'all' ? GROUP_PREVIEW : items.length;
      result.push({
        id: group, title: GROUP_LABEL[group], entries: items.slice(0, limit),
        more: items.length > limit ? { group, count: groupCounts.get(group) || items.length } : undefined,
      });
    });
    if (askAiEntry && scope === 'all' && ranked.length) result.push({ id: 'ai', title: 'Chưa thấy điều bạn cần?', entries: [askAiEntry] });
    return result;
  }, [pickFor, server.records, server.text, query, parsed, actions, actionDefs, usage, recentEntries, scope, ranked, groupCounts, askAiEntry]);

  const flat = useMemo(() => sections.flatMap(section => section.entries), [sections]);
  const current = flat[Math.min(selected, flat.length - 1)] || null;

  useEffect(() => { setSelected(0); setExpanded(null); }, [query, scope, pickFor]);
  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // ── Mở một dòng ──
  const close = onClose;
  const go = useCallback((route: string, state?: unknown) => {
    if (isExternal(route)) { window.location.href = route; return; }
    close();
    onNavigate(route, state);
  }, [close, onNavigate]);

  const remember = useCallback((entry: SearchEntry) => {
    if (query.trim()) rememberQuery(userId, query);
    setHistory(rememberOpened(userId, entry));
  }, [query, userId]);

  const openEntry = useCallback((entry: SearchEntry) => {
    if (pickFor) {
      const tab = pickFor.needsProject;
      remember(pickFor);
      const params = new URLSearchParams({ projectId: entry.key.split(':').slice(1).join(':'), ...(tab ? { tab: tab.tab, ...(tab.extra || {}) } : {}) });
      go(`/da?${params.toString()}`);
      return;
    }
    if (entry.needsProject) {
      setPickFor(entry);
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    remember(entry);
    if (entry.command === 'toggle-theme') { onToggleTheme(); close(); return; }
    if (entry.command === 'ask-ai') { go(`/ai?q=${encodeURIComponent(query.trim())}`); return; }
    if (entry.modal) { onModal(entry.modal); return; }
    if (!entry.route) return;
    // Không mở được màn chính (vd. có Danh mục vật tư nhưng không có Tồn kho) → màn liên quan đầu tiên mở được.
    if (canOpen(entry.route.split('?')[0])) { go(entry.route, entry.routeState); return; }
    const fallback = (entry.related || []).find(link => !isExternal(link.route) && canOpen(link.route.split('?')[0]));
    go(fallback ? fallback.route : entry.route, fallback ? fallback.state : entry.routeState);
  }, [pickFor, remember, go, onToggleTheme, close, query, onModal, canOpen]);

  const openRelated = useCallback((entry: SearchEntry, link: SearchRelatedLink) => {
    remember(entry);
    go(link.route, link.state);
  }, [remember, go]);

  const chips = useMemo(() => {
    if (!parsed || pickFor) return [] as Array<{ id: 'all' | SearchGroup; label: string; count: number }>;
    const groups = GROUP_ORDER.filter(group => groupCounts.get(group));
    return [{ id: 'all' as const, label: 'Tất cả', count: ranked.length }, ...groups.map(group => ({ id: group, label: GROUP_LABEL[group], count: groupCounts.get(group) || 0 }))];
  }, [parsed, pickFor, groupCounts, ranked.length]);

  const backFromPick = () => { setPickFor(null); setQuery(''); inputRef.current?.focus(); };
  const escapeRef = useRef<() => void>(() => undefined);
  escapeRef.current = () => (pickFor ? backFromPick() : close());
  useEffect(() => {
    // Esc khi con trỏ không ở ô gõ (vừa bấm chip, cuộn danh sách…). Ô gõ tự xử lý Esc của nó.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) escapeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, Math.max(flat.length - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (current && !event.nativeEvent.isComposing) openEntry(current); }
    else if (event.key === 'Escape') { event.preventDefault(); if (pickFor) backFromPick(); else close(); }
    else if (event.key === 'Backspace' && !query && pickFor) { event.preventDefault(); backFromPick(); }
    else if (event.key === 'Tab' && chips.length > 1) {
      event.preventDefault();
      const index = chips.findIndex(chip => chip.id === scope);
      const next = (index + (event.shiftKey ? -1 : 1) + chips.length) % chips.length;
      setScope(chips[next].id);
    }
  };

  // Còn đang chờ gõ xong (debounce) cũng tính là đang tìm — không báo "Không thấy" trước khi kịp hỏi máy chủ.
  const loading = server.status === 'loading' || (Boolean(query.trim()) && query.trim() !== debouncedQuery.trim());
  const correction = parsed ? suggestCorrection(parsed) : null;
  const understood = parsed ? describeUnderstanding(parsed) : null;
  const failedLabels = [...new Set(server.failed.map(kind => KIND_META[kind].label))];
  const nothing = Boolean(parsed) && !loading && flat.filter(entry => entry.key !== 'action:ask-ai').length === 0;

  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[200] flex items-stretch justify-center sm:items-start sm:px-4 sm:pt-[8vh]" role="dialog" aria-modal="true" aria-label="Tìm kiếm toàn hệ thống">
      <button type="button" aria-label="Đóng tìm kiếm" tabIndex={-1} onClick={close} className="absolute inset-0 cursor-default bg-slate-950/40" />
      {/* <section>, không phải <div>: luật chung index.css ".fixed.inset-0 > div" (modal điện thoại 90vh) không áp vào. */}
      <section className="global-search-panel relative flex h-full w-full flex-col overflow-hidden bg-card sm:h-auto sm:max-h-[80vh] sm:max-w-4xl sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl">
        {/* Ô gõ */}
        <div className="flex items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top,0px)] sm:px-4">
          {pickFor ? (
            <button type="button" onClick={backFromPick} aria-label="Quay lại" title="Quay lại (Esc)" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
              <ChevronLeft size={20} />
            </button>
          ) : (
            <Search size={20} className="ml-1 shrink-0 text-teal-700 dark:text-teal-300" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1 py-3">
            {pickFor && <p className="truncate text-[11px] font-semibold text-teal-700 dark:text-teal-300">{pickFor.title} · chọn dự án</p>}
            <input
              ref={inputRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={pickFor ? 'Gõ tên hoặc mã dự án…' : 'Tìm chức năng, thao tác, mã phiếu, người, vật tư… (không dấu cũng được)'}
              aria-label="Nội dung tìm kiếm"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              className="w-full bg-transparent text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          {loading && <Loader2 size={18} className="shrink-0 animate-spin text-teal-600" aria-label="Đang tìm" />}
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Xóa nội dung tìm" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
              <X size={16} />
            </button>
          )}
          <button type="button" onClick={close} className="shrink-0 rounded-lg px-2 py-1.5 text-sm font-semibold text-teal-700 hover:bg-muted sm:hidden dark:text-teal-300">Đóng</button>
          <span className="hidden sm:inline-flex"><Kbd>Esc</Kbd></span>
        </div>

        {/* Hiểu câu gõ + chip nhóm */}
        {(understood || chips.length > 1) && (
          <div className="space-y-2 border-b border-border px-3 py-2 sm:px-4">
            {understood && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles size={13} className="shrink-0 text-mint-600" aria-hidden="true" />
                <span className="truncate">{understood}</span>
              </p>
            )}
            {chips.length > 1 && (
              <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" role="tablist" aria-label="Lọc theo nhóm">
                {chips.map(chip => (
                  <button key={chip.id} type="button" role="tab" aria-selected={scope === chip.id} onClick={() => { setScope(chip.id); inputRef.current?.focus(); }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${scope === chip.id
                      ? 'border-teal-700 bg-teal-700 text-white'
                      : 'border-border bg-card text-foreground hover:border-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30'}`}>
                    {chip.label}
                    <span className={`tabular-nums ${scope === chip.id ? 'text-teal-100' : 'text-muted-foreground'}`}>{chip.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Nội dung */}
        <div className="flex min-h-0 flex-1">
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] sm:px-3">
            {server.status === 'error' && (
              <Notice tone="error" onRetry={() => setRetry(value => value + 1)}>
                Chưa tìm được trong hồ sơ (mất mạng hoặc máy chủ bận). Chức năng và thao tác vẫn tìm được bên dưới.
              </Notice>
            )}
            {server.status !== 'error' && failedLabels.length > 0 && (
              <Notice tone="warn" onRetry={() => setRetry(value => value + 1)}>Chưa tìm được: {failedLabels.join(', ')}.</Notice>
            )}

            {!parsed && !pickFor && (
              <EmptyStart
                queries={history.queries}
                onQuery={text => { setQuery(text); inputRef.current?.focus(); }}
                onForget={() => setHistory(forgetQueries(userId))}
              />
            )}

            {sections.map(section => (
              <section key={section.id} className="mb-2" aria-label={section.title}>
                <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {section.id === 'recent' && <History size={12} aria-hidden="true" />}
                    {section.title}
                  </h3>
                  {section.more && (
                    <button type="button" onClick={() => setScope(section.more!.group)} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">
                      Xem cả {section.more.count}
                    </button>
                  )}
                </div>
                {section.id === 'featured' ? (
                  <div className="grid grid-cols-2 gap-1.5 px-1 sm:grid-cols-4">
                    {section.entries.map(entry => {
                      flatIndex += 1;
                      const index = flatIndex;
                      const Icon = entryIcon(entry);
                      return (
                        <button key={entry.key} type="button" data-selected={index === selected} onMouseMove={() => setSelected(index)} onClick={() => openEntry(entry)}
                          className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm font-semibold transition-colors ${index === selected
                            ? 'border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100'
                            : 'border-border bg-card text-foreground hover:bg-muted'}`}>
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-teal-700 text-white"><Icon size={15} /></span>
                          <span className="line-clamp-2 leading-tight">{entry.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : section.entries.length === 0 && section.id === 'pick' ? (
                  <PickEmpty loading={loading} query={query} canProject={allowedKinds.includes('project')} />
                ) : (
                  section.entries.map(entry => {
                    flatIndex += 1;
                    const index = flatIndex;
                    return (
                      <ResultRow
                        key={`${section.id}:${entry.key}`}
                        entry={entry}
                        query={pickFor ? null : parsed}
                        selected={index === selected}
                        expanded={expanded === entry.key}
                        canOpen={canOpen}
                        onHover={() => setSelected(index)}
                        onOpen={() => openEntry(entry)}
                        onToggle={() => setExpanded(value => (value === entry.key ? null : entry.key))}
                        onRelated={link => openRelated(entry, link)}
                      />
                    );
                  })
                )}
              </section>
            ))}

            {loading && parsed && !pickFor && server.records.length === 0 && <SkeletonRows />}

            {nothing && !pickFor && (
              <div className="px-4 py-10 text-center">
                <SearchX size={28} className="mx-auto text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 font-semibold text-foreground">Không thấy kết quả cho “{query.trim()}”</p>
                {correction && (
                  <button type="button" onClick={() => setQuery(correction)} className="mt-2 text-sm font-semibold text-teal-700 hover:underline dark:text-teal-300">
                    Có phải bạn muốn tìm “{correction}”?
                  </button>
                )}
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  Thử gõ ít chữ hơn, gõ mã phiếu (vd. PO-2026…), tên người hoặc số điện thoại. Chỉ hiện hồ sơ bạn được xem.
                </p>
                {canAskAi && (
                  <button type="button" onClick={() => askAiEntry && openEntry(askAiEntry)} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted">
                    <Bot size={15} /> Hỏi Trợ lý AI
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Xem trước (máy tính) */}
          {parsed && current && !pickFor && current.key !== 'action:ask-ai' && (
            <Preview entry={current} query={parsed} canOpen={canOpen} onOpen={() => openEntry(current)} onRelated={link => openRelated(current, link)} />
          )}
        </div>

        {/* Chân */}
        <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> chọn</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> mở</span>
          {chips.length > 1 && <span className="flex items-center gap-1"><Kbd>Tab</Kbd> đổi nhóm</span>}
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> {pickFor ? 'quay lại' : 'đóng'}</span>
          <span className="ml-auto flex items-center gap-1"><LockKeyhole size={12} aria-hidden="true" /> Chỉ hiện dữ liệu bạn có quyền xem</span>
        </div>
      </section>
      <style>{`
        @keyframes globalSearchIn { from { opacity: 0; transform: translateY(-6px) scale(0.985); } to { opacity: 1; transform: none; } }
        .global-search-panel { animation: globalSearchIn 140ms ease-out; }
        @media (prefers-reduced-motion: reduce) { .global-search-panel { animation: none; } }
      `}</style>
    </div>
  );
};

/** "Hiểu là: nhập kho · Ưu tiên: Đơn hàng" — cho người dùng thấy máy đã hiểu câu gõ thế nào. */
const describeUnderstanding = (query: ParsedQuery): string | null => {
  const parts: string[] = [];
  if (query.keyboardFixes.length) {
    const words = query.groups.map(group => {
      const fix = group.alts.find(alt => alt.source === 'keyboard');
      return fix ? displayWord(fix.text) : group.text;
    });
    parts.push(`Hiểu là “${words.join(' ')}” (gõ khi chưa bật bộ gõ)`);
  }
  const typos = query.groups.flatMap(group => group.alts.filter(alt => alt.source === 'typo'));
  if (typos.length) parts.push(`Tìm cả “${typos.map(alt => displayWord(alt.text)).join(' ')}” (có thể gõ nhầm)`);
  const hinted = query.kindHints.filter((kind): kind is RecordKind => kind !== 'page' && kind !== 'action').slice(0, 2);
  if (hinted.length) parts.push(`Ưu tiên ${hinted.map(kind => KIND_META[kind].label.toLowerCase()).join(', ')}`);
  return parts.length ? parts.join(' · ') : null;
};

// ── Dòng kết quả ──────────────────────────────────────────────────────────────────────────────

const ResultRow: React.FC<{
  entry: SearchEntry;
  query: ParsedQuery | null;
  selected: boolean;
  expanded: boolean;
  canOpen: (route: string) => boolean;
  onHover: () => void;
  onOpen: () => void;
  onToggle: () => void;
  onRelated: (link: SearchRelatedLink) => void;
}> = ({ entry, query, selected, expanded, canOpen, onHover, onOpen, onToggle, onRelated }) => {
  const Icon = entryIcon(entry);
  const related = (entry.related || []).filter(link => canOpen(link.route.split('?')[0]));
  return (
    <div data-selected={selected} className={`rounded-xl transition-colors ${selected ? 'bg-teal-50 ring-1 ring-teal-200 dark:bg-teal-950/40 dark:ring-teal-800' : ''}`}>
      <div className="flex items-center">
        <button type="button" onMouseMove={onHover} onClick={onOpen} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${GROUP_TILE[entry.group]}`}><Icon size={17} /></span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              {entry.code && <span className="hidden shrink-0 font-mono text-xs font-semibold text-teal-700 sm:inline dark:text-teal-300"><Highlighted text={entry.code} query={query} /></span>}
              <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground sm:truncate"><Highlighted text={entry.title} query={query} /></span>
            </span>
            {(entry.code || entry.subtitle || entry.context) && (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {entry.code && <span className="font-mono font-semibold text-teal-700 sm:hidden dark:text-teal-300"><Highlighted text={entry.code} query={query} />{entry.subtitle || entry.context ? ' · ' : ''}</span>}
                {entry.subtitle ? <Highlighted text={entry.subtitle} query={query} /> : null}
                {entry.subtitle && entry.context ? ' · ' : ''}
                {entry.context}
              </span>
            )}
          </span>
          <StatusBadge entry={entry} />
          {selected && <ArrowRight size={15} className="hidden shrink-0 text-teal-600 sm:block" aria-hidden="true" />}
        </button>
        {related.length > 0 && (
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={`Thao tác liên quan: ${entry.title}`} title="Thao tác liên quan"
            className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden">
            <ChevronDown size={16} className={expanded ? 'rotate-180' : ''} />
          </button>
        )}
      </div>
      {expanded && related.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2 pl-14 lg:hidden">
          {related.map(link => (
            <button key={link.label} type="button" onClick={() => onRelated(link)} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
              {link.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Xem trước (máy tính ≥ 1024px) ─────────────────────────────────────────────────────────────

const Preview: React.FC<{
  entry: SearchEntry;
  query: ParsedQuery;
  canOpen: (route: string) => boolean;
  onOpen: () => void;
  onRelated: (link: SearchRelatedLink) => void;
}> = ({ entry, query, canOpen, onOpen, onRelated }) => {
  const Icon = entryIcon(entry);
  const related = (entry.related || []).filter(link => canOpen(link.route.split('?')[0]));
  const openLabel = entry.kind === 'action' ? (entry.modal ? 'Làm ngay' : entry.needsProject ? 'Chọn dự án' : entry.command ? 'Thực hiện' : 'Mở')
    : entry.needsProject ? 'Chọn dự án' : 'Mở';
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-border bg-muted/30 lg:flex" aria-label="Xem trước">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${GROUP_TILE[entry.group]}`}><Icon size={20} /></span>
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{entry.context || GROUP_LABEL[entry.group]}</p>
        {entry.code && <p className="mt-1 font-mono text-sm font-semibold text-teal-700 dark:text-teal-300">{entry.code}</p>}
        <h3 className="mt-1 text-base font-bold leading-snug text-foreground"><Highlighted text={entry.title} query={query} /></h3>
        {entry.subtitle && <p className="mt-1 text-sm text-muted-foreground">{entry.subtitle}</p>}
        {entry.status && <div className="mt-2"><StatusBadge entry={entry} /></div>}
        {entry.facts && entry.facts.length > 0 && (
          <dl className="mt-4 space-y-2 text-sm">
            {entry.facts.map(fact => (
              <div key={fact.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className={`min-w-0 truncate text-right ${fact.tone === 'num' ? NUM : fact.tone === 'ent' ? ENT : 'font-medium text-foreground'}`}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {related.length > 0 && (
          <div className="mt-5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Liên quan</p>
            <div className="mt-2 space-y-1">
              {related.map(link => (
                <button key={link.label} type="button" onClick={() => onRelated(link)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-semibold text-foreground hover:border-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/30">
                  <span className="truncate">{link.label}</span>
                  <ArrowRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-t border-border p-3">
        <button type="button" onClick={onOpen} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-leaf-600 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-700">
          {openLabel} <Kbd>↵</Kbd>
        </button>
      </div>
    </aside>
  );
};

// ── Trạng thái ────────────────────────────────────────────────────────────────────────────────

const Notice: React.FC<{ tone: 'error' | 'warn'; onRetry: () => void; children: React.ReactNode }> = ({ tone, onRetry, children }) => (
  <div role={tone === 'error' ? 'alert' : 'status'} className={`mx-1 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span className="flex-1">{children}</span>
    <button type="button" onClick={onRetry} className="shrink-0 font-semibold underline">Thử lại</button>
  </div>
);

const SkeletonRows: React.FC = () => (
  <div className="space-y-1 px-2 py-1" aria-label="Đang tìm trong hồ sơ">
    <p className="pb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Đang tìm trong hồ sơ…</p>
    {[0, 1, 2].map(index => (
      <div key={index} className="flex items-center gap-3 py-2">
        <span className="h-9 w-9 shrink-0 rounded-xl bg-muted" />
        <span className="flex-1 space-y-1.5">
          <span className="block h-3 w-2/3 rounded bg-muted" />
          <span className="block h-2.5 w-1/3 rounded bg-muted" />
        </span>
      </div>
    ))}
  </div>
);

const EmptyStart: React.FC<{ queries: string[]; onQuery: (text: string) => void; onForget: () => void }> = ({ queries, onQuery, onForget }) => (
  <div className="px-2 pb-1 pt-1">
    {queries.length > 0 && (
      <div className="mb-1">
        <div className="flex items-center justify-between px-0 pb-1 pt-1">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Tìm gần đây</h3>
          <button type="button" onClick={onForget} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Xóa</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {queries.map(text => (
            <button key={text} type="button" onClick={() => onQuery(text)} className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
              <Search size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" /> <span className="truncate">{text}</span>
            </button>
          ))}
        </div>
      </div>
    )}
    <p className="px-0 pt-2 text-xs text-muted-foreground">
      Mẹo: gõ không dấu hoặc viết tắt (<b>po</b>, <b>ncc</b>, <b>đntt</b>, <b>pnk</b>), mã phiếu, tên người, số điện thoại — quên bật bộ gõ cũng hiểu.
    </p>
  </div>
);

const PickEmpty: React.FC<{ loading: boolean; query: string; canProject: boolean }> = ({ loading, query, canProject }) => (
  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
    {!canProject ? 'Bạn chưa được vào dự án nào.' : loading ? (
      <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin text-teal-600" /> Đang tải dự án…</span>
    ) : query.trim() ? `Không thấy dự án “${query.trim()}” trong các dự án bạn được xem.` : 'Chưa có dự án nào bạn được xem.'}
  </div>
);

export default GlobalSearchDialog;
