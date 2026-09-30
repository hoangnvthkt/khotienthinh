import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3, FileText, Loader2, UserRound } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { requestRuntimeService, type RequestDetail, type RequestListItem } from '../../lib/requestRuntimeService';
import { isRichTextEmpty, richTextToPlain } from '../../lib/requestRichText';
import { RequestRichTextView } from './RequestRichTextView';
import { RequestStatusBadge } from './RequestTable';

const OPEN_DELAY_MS = 400;
const CARD_WIDTH = 400;
const CACHE_LIMIT = 50;

// Keyed by id + updatedAt so a changed request is fetched again.
const detailCache = new Map<string, RequestDetail>();
const cacheKey = (item: RequestListItem) => `${item.id}:${item.updatedAt}`;
const remember = (key: string, detail: RequestDetail) => {
  detailCache.set(key, detail);
  if (detailCache.size > CACHE_LIMIT) detailCache.delete(detailCache.keys().next().value as string);
};

const canHover = () => typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;

type Placement = 'below' | 'right';
interface OpenState { item: RequestListItem; rect: DOMRect; placement: Placement }

/**
 * Hover preview for request lists. Spread `bind(item)` on each row; render
 * `preview` once. Touch devices keep the plain tap-to-open behaviour.
 */
export const useRequestHoverPreview = (placement: Placement = 'below') => {
  const [open, setOpen] = useState<OpenState | null>(null);
  const timer = useRef<number | null>(null);
  const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  useEffect(() => clear, []);

  const bind = useCallback((item: RequestListItem) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      if (!canHover()) return;
      const target = event.currentTarget;
      clear();
      timer.current = window.setTimeout(() => setOpen({ item, rect: target.getBoundingClientRect(), placement }), OPEN_DELAY_MS);
    },
    onMouseLeave: () => { clear(); setOpen(null); },
    onMouseDown: () => { clear(); setOpen(null); },
  }), [placement]);

  const preview = open ? <RequestHoverCard key={open.item.id} {...open} /> : null;
  return { bind, preview };
};

// Fades the bottom edge only when the content is actually cut off.
const ClampedContent: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element) setOverflows(element.scrollHeight > element.clientHeight + 1);
  });
  return <div ref={ref} className="relative max-h-32 overflow-hidden">
    {children}
    {overflows && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-white dark:from-slate-900" />}
  </div>;
};

const RequestHoverCard: React.FC<OpenState> = ({ item, rect, placement }) => {
  const { users } = useApp();
  const key = cacheKey(item);
  const [detail, setDetail] = useState<RequestDetail | null>(() => detailCache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (detail) return;
    let active = true;
    requestRuntimeService.getDetail(item.id)
      .then(result => { remember(key, result); if (active) setDetail(result); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [detail, item.id, key]);

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - 16);
  const left = placement === 'right'
    ? Math.min(rect.right + 8, viewportWidth - width - 8)
    : Math.min(Math.max(8, rect.left + 24), viewportWidth - width - 8);
  const spaceBelow = viewportHeight - rect.bottom;
  const style: React.CSSProperties = placement === 'right'
    ? { left, top: Math.max(8, Math.min(rect.top, viewportHeight - 380)), width }
    : spaceBelow > 300
      ? { left, top: rect.bottom + 6, width }
      : { left, bottom: viewportHeight - rect.top + 6, width };

  const fieldValue = (field: RequestDetail['formSchema'][number]): string | null => {
    const value = detail?.formData[field.key];
    if (value === null || value === undefined || value === '') return null;
    if (Array.isArray(value)) return value.length ? `${value.length} dòng` : null;
    if (field.fieldType === 'user' && typeof value === 'string') return users.find(user => user.id === value)?.name ?? null;
    if (typeof value === 'string') return isRichTextEmpty(value) ? null : richTextToPlain(value).replace(/\s+/g, ' ');
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  };
  const fields = detail
    ? [...detail.formSchema].sort((a, b) => a.sortOrder - b.sortOrder)
      .map(field => ({ label: field.label, value: fieldValue(field) }))
      .filter((field): field is { label: string; value: string } => !!field.value)
      .slice(0, 4)
    : [];
  const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

  return createPortal(
    <div
      role="tooltip"
      style={style}
      className="pointer-events-none fixed z-[1200] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-2xl ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">{item.code}</span>
          <RequestStatusBadge status={item.status} />
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm font-bold leading-snug text-slate-900 dark:text-white">{item.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1"><FileText size={11} />{item.templateName}</span>
          <span className="inline-flex items-center gap-1"><UserRound size={11} />{item.creator.name}</span>
          <span className="inline-flex items-center gap-1"><Clock3 size={11} />{dateTime(item.createdAt)}</span>
        </p>
      </div>

      <div className="space-y-3 px-4 py-3">
        {!detail && !failed && <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" />Đang tải nội dung...</p>}
        {failed && <p className="text-xs text-slate-500">Không tải được nội dung. Bấm vào đề xuất để xem chi tiết.</p>}
        {detail && <>
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Nội dung &amp; Lý do</p>
            <ClampedContent>
              <RequestRichTextView value={detail.description} emptyText="Không có mô tả." className="text-xs leading-5 text-slate-700 dark:text-slate-200" />
            </ClampedContent>
          </div>
          {fields.length > 0 && <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
            {fields.map(field => <React.Fragment key={field.label}>
              <dt className="truncate text-slate-500">{field.label}</dt>
              <dd className="truncate font-medium text-slate-800 dark:text-slate-100">{field.value}</dd>
            </React.Fragment>)}
          </dl>}
        </>}
        {item.activeApprovers.length > 0 && <p className="text-xs text-slate-500">
          <span className="font-semibold text-amber-700 dark:text-amber-400">Đang chờ duyệt:</span> {item.activeApprovers.map(approver => approver.name).join(', ')}
        </p>}
      </div>
      <p className="border-t border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-950/40">Bấm để mở chi tiết</p>
    </div>,
    document.body,
  );
};

export default useRequestHoverPreview;
