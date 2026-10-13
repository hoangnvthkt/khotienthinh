// Tab Trợ lý — bản tin hôm nay dựng từ đúng số liệu Hôm nay (vcc_my_center_v1) và Việc của tôi (vcc_my_work_items_v1),
// nên con số luôn khớp hai màn kia (điều kiện "xong" của lộ trình A1). Không cần AI: AI (khi có khóa) chỉ kể lại hoặc trả lời
// câu hỏi tự do dựa trên chính các dòng này — mỗi dòng có khóa để câu trả lời dẫn về đúng chứng từ / màn hình.
import type { CenterToday } from './centerTodayService';
import type { DrillTarget } from './drill';
import { buildTodayWidgets, type Stat, type StatTone, type WidgetView } from './todayWidgets';
import { displayCode, dueInfo, sortWorkItems, type WorkItem } from './workItemsService';

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

export interface BriefSection {
  id: string;
  title: string;
  lines: BriefLine[];
  route?: string;
  routeLabel?: string;
}

export interface Brief {
  sections: BriefSection[];
  /** Số dòng cần chú ý (trễ, chờ duyệt, chưa chấm công…). */
  attention: number;
}

const INBOX: DrillTarget = { kind: 'inbox', title: 'Việc của tôi' };
const MAX_ITEMS = 5;

const statLine = (view: WidgetView, stat: Stat): BriefLine => ({
  key: `${view.id}.${stat.key}`, label: stat.label, text: stat.value, hint: stat.hint, tone: stat.tone || 'num', target: stat.target, locked: stat.locked,
});

const itemLine = (item: WorkItem, now: Date): BriefLine => {
  const due = dueInfo(item.dueAt, now);
  return {
    key: `item.${item.source}.${item.id}`, label: `${displayCode(item)}${due ? ` · ${due.label}` : ''}`, text: item.title,
    hint: [item.who, item.meta].filter(Boolean).join(' · ') || undefined,
    tone: due?.tone === 'hot' ? 'danger' : due?.tone === 'soon' ? 'warn' : 'num', item,
  };
};

/**
 * Bản tin: "Cần chú ý" (số đỏ / cam + việc quá hạn, hôm nay) → "Việc chờ bạn" → từng nhóm như Hôm nay (dự án, nhân sự, công việc,
 * hành chính, mua hàng & kho, tài chính). items = null: chưa đọc được Việc của tôi (vẫn có bản tin, báo rõ).
 */
export const buildBrief = (today: CenterToday, items: WorkItem[] | null, now: Date, mineCount: number | null): Brief => {
  const views = buildTodayWidgets(today, { now, mineCount });
  const sorted = items ? sortWorkItems(items) : [];
  const hot = sorted.filter(item => dueInfo(item.dueAt, now)?.tone === 'hot');

  const attention: BriefLine[] = [
    ...views.flatMap(view => view.stats.filter(stat => stat.tone === 'danger').map(stat => statLine(view, stat))),
    ...hot.slice(0, MAX_ITEMS).map(item => itemLine(item, now)),
    ...views.flatMap(view => view.stats.filter(stat => stat.tone === 'warn').map(stat => statLine(view, stat))),
  ];

  const total = items ? items.length : mineCount;
  const soon = sorted.filter(item => dueInfo(item.dueAt, now)?.tone === 'soon').length;
  const mine: BriefLine[] = [
    items === null && mineCount === null
      ? { key: 'mine.total', label: 'Việc chờ bạn', text: 'Chưa đọc được Việc của tôi', tone: 'muted', target: INBOX }
      : { key: 'mine.total', label: 'Việc chờ bạn', tone: (total || 0) > 0 ? (hot.length ? 'danger' : 'num') : 'muted', target: INBOX,
          text: (total || 0) > 0
            ? `${total} việc${hot.length ? ` · ${hot.length} quá hạn hoặc hôm nay` : ''}${soon ? ` · ${soon} trong 3 ngày tới` : ''}`
            : 'Không có việc chờ bạn' },
    ...sorted.filter(item => !hot.includes(item)).slice(0, Math.max(0, MAX_ITEMS - Math.min(hot.length, MAX_ITEMS))).map(item => itemLine(item, now)),
  ];

  const sections: BriefSection[] = [
    { id: 'attention', title: 'Cần chú ý', lines: attention.length ? attention : [{ key: 'attention.none', label: 'Hôm nay', text: 'Không có gì gấp', tone: 'muted' }] },
    { id: 'mine', title: 'Việc chờ bạn', lines: mine },
    ...views.map(view => ({
      id: view.id, title: view.title, route: view.route, routeLabel: view.routeLabel,
      lines: view.empty && !view.stats.length
        ? [{ key: `${view.id}.empty`, label: view.title, text: view.empty.text, tone: 'muted' as StatTone, target: view.empty.target }]
        : view.stats.map(stat => statLine(view, stat)),
    })),
  ];
  return { sections, attention: attention.length };
};

/** Câu hỏi nhanh: trả lời ngay từ bản tin, không cần AI. */
export const QUICK_QUESTIONS: ReadonlyArray<{ id: string; text: string; sections: string[] }> = [
  { id: 'attention', text: 'Hôm nay cần chú ý gì?', sections: ['attention'] },
  { id: 'mine', text: 'Việc nào đang chờ tôi?', sections: ['mine'] },
  { id: 'project', text: 'Dự án đang thế nào?', sections: ['project'] },
  { id: 'supply', text: 'Vật tư, đơn hàng ra sao?', sections: ['supply'] },
  { id: 'hrm', text: 'Chấm công, phép của tôi?', sections: ['hrm'] },
  { id: 'finance', text: 'Tiền của dự án thế nào?', sections: ['finance'] },
];

export const availableQuickQuestions = (brief: Brief) =>
  QUICK_QUESTIONS.filter(question => question.sections.some(id => brief.sections.some(section => section.id === id)));

export const answerQuick = (brief: Brief, questionId: string): BriefSection[] => {
  const question = QUICK_QUESTIONS.find(item => item.id === questionId);
  if (!question) return [];
  return brief.sections.filter(section => question.sections.includes(section.id));
};

/** Các dòng số liệu dạng chữ cho AI: mỗi dòng "khóa | nhóm · nhãn: giá trị" — AI chỉ được trả lời từ đây và trích khóa. */
export const briefFacts = (brief: Brief): string => brief.sections
  .flatMap(section => section.lines.map(line => `${line.key} | ${section.title} · ${line.label}: ${line.text}${line.hint ? ` (${line.hint})` : ''}${line.locked ? ' [chưa có quyền xem]' : ''}`))
  .join('\n');

/** Tìm lại dòng theo khóa AI trích dẫn (bỏ khóa lạ). */
export const linesByKeys = (brief: Brief, keys: readonly string[]): BriefLine[] => {
  const all = new Map(brief.sections.flatMap(section => section.lines.map(line => [line.key, line] as const)));
  return keys.map(key => all.get(key)).filter((line): line is BriefLine => Boolean(line));
};

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export const briefDateLabel = (now: Date) => `${WEEKDAYS[now.getDay()]} ${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
