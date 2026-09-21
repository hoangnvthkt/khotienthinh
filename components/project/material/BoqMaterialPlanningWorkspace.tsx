import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Clock3, Eye, RefreshCcw, Search } from 'lucide-react';
import { buildBoqPlanPreview } from '../../../lib/materialPlanning/boqMaterialSelectors';
import {
  boqMaterialReadService,
  createBoqPlanningRequestGate,
} from '../../../lib/materialPlanning/boqMaterialReadService';
import { formatDecimal6, parseQuantity6 } from '../../../lib/procurement/decimal';
import type {
  BoqMaterialBudgetLine,
  BoqMaterialPlanPreview,
  BoqMaterialTreeNode,
  BoqMaterialTreePage,
} from '../../../types/materialPlanning';
import { BoqMaterialPlanPreviewPanel } from './BoqMaterialPlanPreview';
import { BoqMaterialTree, type BoqMaterialDraftFields } from './BoqMaterialTree';

interface BoqMaterialPlanningWorkspaceProps {
  projectId: string | null;
  constructionSiteId: string | null;
  defaultDestination?: string;
}

type ReadState = 'idle' | 'loading' | 'ready' | 'empty' | 'denied' | 'error';
const parentKey = (parentId: string | null) => parentId ?? '__root__';

const defaultQuantity = (line: BoqMaterialBudgetLine): string => {
  if (line.balance.uncovered == null) return '';
  if (line.suggestedQty30d == null) return line.balance.uncovered;
  const uncovered = parseQuantity6(line.balance.uncovered);
  const suggestion = parseQuantity6(line.suggestedQty30d);
  return formatDecimal6(uncovered < suggestion ? uncovered : suggestion);
};

const flattenLines = (
  roots: BoqMaterialTreeNode[],
  childrenByParent: Record<string, BoqMaterialTreeNode[]>,
): BoqMaterialBudgetLine[] => {
  const lines: BoqMaterialBudgetLine[] = [];
  const seen = new Set<string>();
  const visit = (nodes: BoqMaterialTreeNode[]) => nodes.forEach(node => {
    node.materials.forEach(line => {
      if (!seen.has(line.id)) {
        seen.add(line.id);
        lines.push(line);
      }
    });
    visit(childrenByParent[node.id] || []);
  });
  visit(roots);
  return lines;
};

const mergeUnallocatedNode = (
  current: BoqMaterialTreeNode,
  loaded: BoqMaterialTreeNode,
  append: boolean,
): BoqMaterialTreeNode => {
  const materials = append
    ? [...current.materials, ...loaded.materials.filter(line => !current.materials.some(row => row.id === line.id))]
    : loaded.materials;
  const unitCounts = new Map<string, number>();
  materials.forEach(line => unitCounts.set(line.unit, (unitCounts.get(line.unit) || 0) + 1));
  return {
    ...loaded,
    childCount: current.childCount,
    materials,
    quantityGroups: [...unitCounts].map(([unit, lineCount]) => ({ unit, lineCount })),
  };
};

const errorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown; message?: unknown }).code
    || (error as { message?: unknown }).message || '');
};

export const BoqMaterialPlanningWorkspace: React.FC<BoqMaterialPlanningWorkspaceProps> = ({
  projectId,
  constructionSiteId,
  defaultDestination = '',
}) => {
  const gate = useRef(createBoqPlanningRequestGate());
  const snapshot = useRef<{ asOf: string; metricVersion: string } | null>(null);
  const cursors = useRef<Record<string, string | null>>({});
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<ReadState>('idle');
  const [rootPage, setRootPage] = useState<BoqMaterialTreePage | null>(null);
  const [childrenByParent, setChildrenByParent] = useState<Record<string, BoqMaterialTreeNode[]>>({});
  const [nextCursorByParent, setNextCursorByParent] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadingParents, setLoadingParents] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, BoqMaterialDraftFields>>({});
  const [preview, setPreview] = useState<BoqMaterialPlanPreview | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [versionNotice, setVersionNotice] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);

  const loadPage = useCallback(async (parentId: string | null, append = false) => {
    if (!projectId) return;
    const token = gate.current.next();
    const key = parentKey(parentId);
    if (!append && parentId === null) setState('loading');
    if (parentId !== null || append) {
      setLoadingParents(current => new Set(current).add(key));
    }
    try {
      const currentSnapshot = append || parentId !== null ? snapshot.current : null;
      const page = await boqMaterialReadService.listPage({
        projectId,
        constructionSiteId,
        parentId,
        search: search || null,
        limit: 30,
        cursor: append ? cursors.current[key] ?? null : null,
        asOf: currentSnapshot?.asOf ?? null,
        expectedMetricVersion: currentSnapshot?.metricVersion ?? null,
      });
      if (!gate.current.isCurrent(token)) return;
      if (!snapshot.current || (!append && parentId === null)) {
        snapshot.current = { asOf: page.asOf, metricVersion: page.metricVersion };
      }
      cursors.current = { ...cursors.current, [key]: page.nextCursor };
      setNextCursorByParent(cursors.current);

      if (parentId === null) {
        setRootPage(current => append && current ? {
          ...page,
          nodes: [...current.nodes, ...page.nodes.filter(node => !current.nodes.some(row => row.id === node.id))],
        } : page);
        setState(page.totals.materialLineCount === 0 ? 'empty' : 'ready');
      } else if (parentId === '__unallocated__') {
        const loaded = page.nodes[0];
        if (loaded) {
          setRootPage(current => current ? {
            ...current,
            nodes: current.nodes.map(node => node.id === parentId
              ? mergeUnallocatedNode(node, loaded, append)
              : node),
          } : current);
        }
      } else {
        setChildrenByParent(current => ({
          ...current,
          [parentId]: append
            ? [...(current[parentId] || []), ...page.nodes.filter(node => !(current[parentId] || []).some(row => row.id === node.id))]
            : page.nodes,
        }));
      }
    } catch (error) {
      if (!gate.current.isCurrent(token)) return;
      const code = errorCode(error);
      if (code.includes('BOQ_PLANNING_PAGE_VERSION_MISMATCH')) {
        snapshot.current = null;
        setRootPage(null);
        setChildrenByParent({});
        cursors.current = {};
        setNextCursorByParent({});
        setExpanded(new Set());
        setVersionNotice(true);
        setRetryGeneration(value => value + 1);
      } else {
        setState(code.includes('42501') || code.includes('READ_DENIED') ? 'denied' : 'error');
      }
    } finally {
      setLoadingParents(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [constructionSiteId, projectId, search]);

  useEffect(() => {
    gate.current.invalidate();
    snapshot.current = null;
    setRootPage(null);
    setChildrenByParent({});
    cursors.current = {};
    setNextCursorByParent({});
    setExpanded(new Set());
    setPreview(null);
    setValidationError(null);
    if (!projectId) {
      setState('idle');
      return undefined;
    }
    void loadPage(null);
    return () => gate.current.invalidate();
  }, [constructionSiteId, loadPage, projectId, retryGeneration, search]);

  useEffect(() => {
    setSelected(new Set());
    setDrafts({});
  }, [constructionSiteId, projectId]);

  useEffect(() => setVersionNotice(false), [constructionSiteId, projectId, search]);

  const allLines = useMemo(
    () => flattenLines(rootPage?.nodes || [], childrenByParent),
    [childrenByParent, rootPage?.nodes],
  );
  const linesById = useMemo(() => new Map(allLines.map(line => [line.id, line])), [allLines]);

  const toggleNode = useCallback((node: BoqMaterialTreeNode) => {
    const opening = !expanded.has(node.id);
    setExpanded(current => {
      const next = new Set(current);
      if (opening) next.add(node.id); else next.delete(node.id);
      return next;
    });
    if (opening && node.childCount > 0
        && (node.synthetic === 'unallocated' ? node.materials.length === 0 : !childrenByParent[node.id])) {
      void loadPage(node.id);
    }
  }, [childrenByParent, expanded, loadPage]);

  const toggleLine = useCallback((line: BoqMaterialBudgetLine, checked: boolean) => {
    if (!line.balance.selectable) return;
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(line.id); else next.delete(line.id);
      return next;
    });
    if (checked) {
      setDrafts(current => current[line.id] ? current : {
        ...current,
        [line.id]: {
          quantity: defaultQuantity(line),
          neededDate: '',
          destination: defaultDestination,
        },
      });
    }
    setValidationError(null);
  }, [defaultDestination]);

  const updateDraft = useCallback((lineId: string, patch: Partial<BoqMaterialDraftFields>) => {
    setDrafts(current => ({
      ...current,
      [lineId]: { ...(current[lineId] || { quantity: '', neededDate: '', destination: '' }), ...patch },
    }));
    setValidationError(null);
  }, []);

  const openPreview = () => {
    try {
      const draftLines = [...selected].map(id => {
        const line = linesById.get(id);
        const draft = drafts[id];
        if (!line || !draft) throw new Error('BOQ_PREVIEW_SOURCE_UNKNOWN');
        return { line, draftQty: draft.quantity, neededDate: draft.neededDate, destination: draft.destination };
      });
      setPreview(buildBoqPlanPreview({ lines: draftLines }));
      setValidationError(null);
    } catch {
      setValidationError('Kiểm tra số lượng, ngày cần, nơi nhận và các cảnh báo nguồn trước khi xem preview.');
    }
  };

  const isStale = rootPage ? Date.now() - Date.parse(rootPage.asOf) > 5 * 60 * 1000 : false;

  if (!projectId) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">Chưa xác định dự án để đọc cân đối BOQ.</div>;
  }

  return (
    <section className="space-y-4" aria-label="Lập kế hoạch vật tư từ BOQ">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">Cân đối BOQ theo công tác</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">B ngân sách · I cấp ròng · O đang mở · C đóng · số còn có thể đưa vào preview.</p>
          </div>
          <form
            className="flex w-full gap-2 lg:max-w-sm"
            onSubmit={event => { event.preventDefault(); setSearch(query.trim()); }}
          >
            <label className="relative flex-1">
              <span className="sr-only">Tìm vật tư hoặc công tác</span>
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm WBS, công tác, SKU…" className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-400" />
            </label>
            <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white">Tìm</button>
          </form>
        </div>
        {rootPage && (
          <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[10px] font-bold ${isStale || versionNotice ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-500'}`}>
            <Clock3 size={13} /> Số liệu tại {new Date(rootPage.asOf).toLocaleString('vi-VN')}
            {isStale && ' · Có thể đã cũ, hãy làm mới trước khi preview'}
            {versionNotice && ' · Nguồn đã đổi, danh sách vừa được tải lại'}
          </div>
        )}
      </div>

      {state === 'loading' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm font-bold text-slate-500">Đang tải cân đối BOQ…</div>
      )}
      {state === 'denied' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
          <AlertCircle className="mx-auto text-amber-600" />
          <div className="mt-2 text-sm font-black text-amber-900">Bạn chưa có quyền xem cân đối BOQ</div>
          <p className="mt-1 text-xs text-amber-700">Cần quyền Xem trong Room Kế hoạch vật tư của đúng phạm vi.</p>
        </div>
      )}
      {state === 'error' && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center">
          <div className="text-sm font-black text-rose-900">Không thể tải cân đối BOQ</div>
          <button type="button" onClick={() => setRetryGeneration(value => value + 1)} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-rose-700 px-4 py-2 text-xs font-black text-white"><RefreshCcw size={13} /> Thử lại</button>
        </div>
      )}
      {state === 'empty' && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm font-black text-slate-500">Không có dòng BOQ phù hợp</div>
      )}
      {rootPage && state === 'ready' && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-100 p-3 text-xs"><strong>{rootPage.totals.workNodeCount}</strong><span className="ml-1 text-slate-500">công tác</span></div>
            <div className="rounded-xl bg-slate-100 p-3 text-xs"><strong>{rootPage.totals.materialLineCount}</strong><span className="ml-1 text-slate-500">dòng vật tư</span></div>
            <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800"><strong>{rootPage.totals.selectableLineCount}</strong><span className="ml-1">có thể chọn</span></div>
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><strong>{rootPage.totals.unallocatedEffectCount}</strong><span className="ml-1">effect chưa phân bổ</span></div>
          </div>
          <BoqMaterialTree
            nodes={rootPage.nodes}
            childrenByParent={childrenByParent}
            expanded={expanded}
            loadingParents={loadingParents}
            selected={selected}
            drafts={drafts}
            canViewPrice={rootPage.capabilities.canViewPrice}
            onToggleNode={toggleNode}
            onToggleLine={toggleLine}
            onDraftChange={updateDraft}
            onLoadMore={(parentId) => void loadPage(parentId, true)}
            nextCursorByParent={nextCursorByParent}
          />
          <div className="sticky bottom-3 flex flex-col items-stretch justify-between gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center">
            <div className="text-xs font-bold text-slate-600">Đã chọn {selected.size} dòng BOQ</div>
            <button type="button" disabled={selected.size === 0} onClick={openPreview} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"><Eye size={14} /> Xem preview</button>
          </div>
          {validationError && <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{validationError}</div>}
          {preview && <BoqMaterialPlanPreviewPanel preview={preview} onClose={() => setPreview(null)} />}
        </>
      )}
    </section>
  );
};
