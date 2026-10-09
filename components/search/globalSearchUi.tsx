import React from 'react';
import {
  ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Bot, CalendarCheck, CalendarClock, CalendarOff, CalendarRange, Car, CheckSquare,
  ClipboardCheck, ClipboardList, Coins, DollarSign, FileSignature, FilePen, FileText, GitBranch, Handshake, HardHat, Hash, Inbox,
  Landmark, LayoutGrid, ListChecks, MapPin, MessageSquarePlus, NotebookPen, Package, ShoppingCart, SunMoon, User, Wallet, Zap,
} from 'lucide-react';
import type { SearchEntry, SearchGroup, SearchKind, StatusTone } from '../../lib/search/searchTypes';
import { highlightRanges, type ParsedQuery } from '../../lib/search/searchEngine';

type IconType = React.ComponentType<{ size?: number; className?: string }>;

// Cùng quy ước màu FastCons như components/finance/financeUi.tsx (ENT tên/mã, NUM số liệu). Không import file đó để
// hộp tìm kiếm (nằm trong khung chung) không kéo dịch vụ Tài chính vào gói tải đầu.
export const ENT = 'font-semibold text-mint-700 dark:text-mint-300';
export const NUM = 'font-semibold tabular-nums text-leaf-700 dark:text-leaf-300';

const KIND_ICON: Partial<Record<SearchKind, IconType>> = {
  project: HardHat, employee: User, item: Package, wms_tx: ArrowLeftRight, material_code: Hash, purchase_order: ShoppingCart,
  material_request: ClipboardList, rq: Inbox, wf: GitBranch, partner: Handshake, customer_contract: FileSignature,
  subcontract: FileSignature, supplier_contract: FileSignature, payment_request: Wallet, asset: Landmark, office_doc: FileText,
  vehicle_booking: Car, work_task: CheckSquare, feedback: MessageSquarePlus, leave: CalendarOff, page: LayoutGrid, action: Zap,
};

const ACTION_ICON: Record<string, IconType> = {
  'action:checkin': MapPin, 'action:leave': CalendarOff, 'action:request': Inbox, 'action:material-request': ClipboardList,
  'action:daily-log': NotebookPen, 'action:po': ShoppingCart, 'action:payment': Wallet, 'action:booking': Car,
  'action:makeup': CalendarClock, 'action:timesheet': CalendarCheck, 'action:payslip': DollarSign, 'action:workflow': GitBranch,
  'action:task': ListChecks, 'action:compose': FilePen, 'action:hot': Zap, 'action:import': ArrowDownToLine,
  'action:export': ArrowUpFromLine, 'action:transfer': ArrowLeftRight, 'action:count': ClipboardCheck, 'action:new-code': Hash,
  'action:work-plan': CalendarRange, 'action:site-fund': Coins, 'action:feedback': MessageSquarePlus, 'action:theme': SunMoon,
  'action:ask-ai': Bot,
};

export const entryIcon = (entry: Pick<SearchEntry, 'key' | 'kind' | 'icon'>): IconType =>
  entry.icon || ACTION_ICON[entry.key] || KIND_ICON[entry.kind] || LayoutGrid;

/** Màu ô biểu tượng theo nhóm — nhạt, theo ý nghĩa; thao tác nhanh nổi bật nền xanh đậm. */
export const GROUP_TILE: Record<SearchGroup, string> = {
  action: 'bg-teal-700 text-white',
  page: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  project: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300',
  people: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300',
  hr: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300',
  material: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
  purchase: 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
  request: 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300',
  contract: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  finance: 'bg-leaf-50 text-leaf-700 dark:bg-leaf-900/40 dark:text-leaf-300',
  asset: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300',
  office: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  work: 'bg-mint-50 text-mint-700 dark:bg-mint-900/40 dark:text-mint-300',
};

const TONE_BADGE: Record<StatusTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  active: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
  done: 'border-leaf-200 bg-leaf-50 text-leaf-800 dark:border-leaf-900 dark:bg-leaf-900/40 dark:text-leaf-200',
  warn: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200',
};

export const StatusBadge: React.FC<{ entry: SearchEntry }> = ({ entry }) => {
  if (!entry.status || entry.kind === 'page' || entry.kind === 'action') return null;
  const tone = entry.statusTone || 'neutral';
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_BADGE[tone]}`}>{entry.status}</span>;
};

/** Chữ có tô các đoạn khớp với câu gõ (kể cả gõ không dấu, viết tắt). */
export const Highlighted: React.FC<{ text: string; query: ParsedQuery | null }> = ({ text, query }) => {
  if (!query || !text) return <>{text}</>;
  const ranges = highlightRanges(text, query);
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={index} className="rounded-sm bg-mint-100 px-0.5 text-inherit dark:bg-mint-900/60">{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
};

export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex min-w-[20px] items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted-foreground">{children}</kbd>
);
