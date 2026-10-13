// Tab Trợ lý — bản tin sáng (chủ SP 13/10: gọn, một màn, không lặp màn khác). Trả lời 2 câu trong vài giây:
//   1. Làm trước: tối đa 3 việc theo hạn (quá hạn → hôm nay → gần nhất), lấy từ Việc của tôi (vcc_my_work_items_v1).
//   2. Đáng lo: tối đa 3 điều bất thường của dự án đang xem (vcc_my_center_v1) — chỉ những gì không phải việc trong cột trái.
// Câu đầu ("Anh có 11 việc chờ, 5 việc phải xong hôm nay") dựng từ số liệu, không cần AI. Toàn bộ dòng số liệu (facts) vẫn giữ
// để trả lời câu hỏi nhanh và để AI (khi có khóa) chỉ trả lời từ đó, trích khóa dòng → nút mở chứng từ / màn gốc.
import type { CenterToday } from './centerTodayService';
import type { DrillTarget } from './drill';
import { buildTodayWidgets, ddmm, moneyShort, type StatTone, type WidgetView } from './todayWidgets';
import { displayCode, dueInfo, sortWorkItems, type WorkItem, type WorkItemKind } from './workItemsService';

export interface BriefLine {
  key: string;
  label: string;
  text: string;
  hint?: string;
  tone: StatTone;
  target?: DrillTarget;
  /** Dòng là một việc trong Việc của tôi → mở hồ sơ như bấm ở cột việc. */
  item?: WorkItem;
  locked?: string;
}

export interface BriefTask {
  key: string;
  item: WorkItem;
  code: string;
  verb: string;
  title: string;
  due: string | null;
  /** Chỉ quá hạn mới đỏ; trong hôm nay cam; còn lại xám. */
  tone: 'overdue' | 'today' | 'normal';
}

export interface BriefWorry { key: string; text: string; tone: 'danger' | 'warn'; target: DrillTarget }

export interface BriefGroup { id: string; title: string; lines: BriefLine[] }

export interface Brief {
  headline: string;
  /** null = chưa đọc được Việc của tôi. */
  total: number | null;
  urgent: number;
  tasks: BriefTask[];
  /** "+ 2 việc khác hạn hôm nay" → mở cột Việc của tôi. */
  more: string | null;
  /** null = chưa có số liệu dự án (đang tải / lỗi). */
  worries: BriefWorry[] | null;
  /** Số liệu theo nhóm như Hôm nay — chỉ hiện khi người dùng hỏi nhanh. */
  groups: BriefGroup[];
  /** Mọi dòng số liệu + việc, có khóa: nguồn cho AI và cho nút mở chứng từ. */
  facts: BriefLine[];
}

const MAX = 3;
const VERB: Record<WorkItemKind, string> = { approve: 'Duyệt', do: 'Làm', confirm: 'Xác nhận', read: 'Đọc', wait: 'Chờ', watch: 'Theo dõi' };

export const pronounOf = (gender?: string | null) => (gender === 'Nam' ? 'Anh' : gender === 'Nữ' ? 'Chị' : 'Bạn');

const isUrgent = (item: WorkItem, now: Date) => dueInfo(item.dueAt, now)?.tone === 'hot';

const taskOf = (item: WorkItem, now: Date): BriefTask => {
  const due = dueInfo(item.dueAt, now);
  const overdue = !!item.dueAt && new Date(item.dueAt).getTime() < now.getTime();
  return {
    key: `item.${item.source}.${item.id}`, item, code: displayCode(item), verb: VERB[item.kind] || '', title: item.title,
    due: due?.label || null, tone: overdue ? 'overdue' : due?.tone === 'hot' ? 'today' : 'normal',
  };
};

const statLine = (view: WidgetView, stat: WidgetView['stats'][number]): BriefLine => ({
  key: `${view.id}.${stat.key}`, label: stat.label, text: stat.value, hint: stat.hint, tone: stat.tone || 'num', target: stat.target, locked: stat.locked,
});

const itemLine = (item: WorkItem, now: Date): BriefLine => {
  const t = taskOf(item, now);
  return { key: t.key, label: `${t.code}${t.due ? ` · ${t.due}` : ''}`, text: `${t.verb} · ${item.title}`, hint: [item.who, item.meta].filter(Boolean).join(' · ') || undefined,
    tone: t.tone === 'overdue' ? 'danger' : t.tone === 'today' ? 'warn' : 'num', item };
};

/** Điều bất thường của dự án đang xem: đỏ trước (trễ tiến độ, PO quá hẹn, CĐT nợ quá hạn), rồi cam. Không lặp việc ở cột trái. */
const buildWorries = (today: CenterToday, views: WidgetView[]): BriefWorry[] => {
  const targets = new Map<string, DrillTarget>(views.flatMap(view => view.stats.filter(stat => !stat.locked).map(stat => [`${view.id}.${stat.key}`, stat.target] as const)));
  const out: BriefWorry[] = [];
  const add = (key: string, text: string, tone: BriefWorry['tone']) => { const target = targets.get(key); if (target) out.push({ key, text, tone, target }); };
  const p = today.project;
  const w = today.widgets;
  const pw = p ? w.project : null;
  if (p && pw) {
    const pr = pw.progress;
    const deadline = ddmm(pr.endDate || p.endDate);
    if (pr.state === 'ready' && (pr.overdue || 0) > 0) add('project.progress', `Tiến độ ${p.code}: ${pr.overdue} việc trễ${deadline ? ` · hạn HĐ ${deadline}` : ''}`, 'danger');
    const next = pw.supply.nextPo;
    if (pw.supply.state === 'ready' && next?.expectedDate && next.expectedDate.slice(0, 10) < today.today) add('project.supply', `${next.poNumber} quá ngày hẹn giao ${ddmm(next.expectedDate)}`, 'danger');
  }
  if (w.finance && w.finance.receivableOverdue > 0) add('finance.received', `Chủ đầu tư còn nợ quá hạn ${moneyShort(w.finance.receivableOverdue)}`, 'danger');
  if (p && pw) {
    const c = pw.construction;
    if (c.state === 'ready' && (c.fronts || 0) > 0 && (c.slips || 0) < (c.fronts || 0)) add('project.construction', `Thi công hôm nay: ${(c.fronts || 0) - (c.slips || 0)}/${c.fronts} mũi chưa gửi phiếu`, 'warn');
  }
  const rq = w.supply?.requests;
  if (rq?.state === 'ready' && (rq.pending || 0) > 0) add('supply.requests', `${rq.pending} đề xuất vật tư đang chờ ${rq.waitingStep || 'duyệt'}`, 'warn');
  if (w.finance && w.finance.payableOverdue > 0) add('finance.cost', `Nợ nhà cung cấp quá hạn ${moneyShort(w.finance.payableOverdue)}`, 'warn');
  const team = w.hrm.team;
  if (team?.state === 'ready' && (team.total || 0) > 0 && (team.present || 0) < (team.total || 0)) add('hrm.team', `Đội công trường: ${(team.total || 0) - (team.present || 0)}/${team.total} người chưa chấm công`, 'warn');
  return out.slice(0, MAX);
};

/**
 * today = null: số liệu dự án chưa có (đang tải / lỗi) → worries null, không có nhóm hỏi nhanh.
 * items = null: chưa đọc được Việc của tôi → total null.
 */
export const buildBrief = (today: CenterToday | null, items: WorkItem[] | null, now: Date, gender?: string | null): Brief => {
  const views = today ? buildTodayWidgets(today, { now, mineCount: items ? items.length : null }) : [];
  const sorted = items ? sortWorkItems(items) : [];
  const urgent = sorted.filter(item => isUrgent(item, now)).length;
  const tasks = sorted.slice(0, MAX).map(item => taskOf(item, now));
  const urgentLeft = urgent - tasks.filter(task => isUrgent(task.item, now)).length;
  const restLeft = sorted.length - tasks.length;
  const P = pronounOf(gender);
  const total = items ? items.length : null;
  const headline = total === null ? 'Chưa đọc được việc của bạn'
    : total === 0 ? `${P} không có việc chờ`
      : urgent > 0 ? `${P} có ${total} việc chờ, ${urgent} việc phải xong hôm nay`
        : `${P} có ${total} việc chờ, không có việc gấp`;
  const groups: BriefGroup[] = views.map(view => ({
    id: view.id, title: view.title,
    lines: view.empty && !view.stats.length
      ? [{ key: `${view.id}.empty`, label: view.title, text: view.empty.text, tone: 'muted', target: view.empty.target }]
      : view.stats.map(stat => statLine(view, stat)),
  }));
  return {
    headline, total, urgent, tasks,
    more: urgentLeft > 0 ? `+ ${urgentLeft} việc khác hạn hôm nay` : restLeft > 0 ? `+ ${restLeft} việc khác` : null,
    worries: today ? buildWorries(today, views) : null,
    groups,
    facts: [...groups.flatMap(group => group.lines), ...sorted.slice(0, 20).map(item => itemLine(item, now))],
  };
};

/** Câu hỏi nhanh: trả lời ngay bằng số liệu của nhóm đó, không cần AI (Làm trước / Đáng lo đã ở trên nên không hỏi lại). */
export const QUICK_QUESTIONS: ReadonlyArray<{ id: string; text: string; group: string }> = [
  { id: 'project', text: 'Dự án đang thế nào?', group: 'project' },
  { id: 'supply', text: 'Vật tư, đơn hàng ra sao?', group: 'supply' },
  { id: 'finance', text: 'Tiền của dự án?', group: 'finance' },
  { id: 'hrm', text: 'Công, phép của tôi?', group: 'hrm' },
];

export const availableQuickQuestions = (brief: Brief) => QUICK_QUESTIONS.filter(question => brief.groups.some(group => group.id === question.group));

export const answerQuick = (brief: Brief, questionId: string): BriefLine[] => {
  const question = QUICK_QUESTIONS.find(item => item.id === questionId);
  return brief.groups.find(group => group.id === question?.group)?.lines || [];
};

/** Dòng số liệu cho AI: "khóa | nhãn: giá trị" — AI chỉ được trả lời từ đây và trích khóa. */
export const briefFacts = (brief: Brief): string => brief.facts
  .map(line => `${line.key} | ${line.label}: ${line.text}${line.hint ? ` (${line.hint})` : ''}${line.locked ? ' [chưa có quyền xem]' : ''}`)
  .join('\n');

/** Tìm lại dòng theo khóa AI trích dẫn (bỏ khóa lạ). */
export const linesByKeys = (brief: Brief, keys: readonly string[]): BriefLine[] => {
  const all = new Map(brief.facts.map(line => [line.key, line] as const));
  return keys.map(key => all.get(key)).filter((line): line is BriefLine => Boolean(line));
};

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export const briefDateLabel = (now: Date) => `${WEEKDAYS[now.getDay()]} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
