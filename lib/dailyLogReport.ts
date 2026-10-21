// Nhật ký · Dán báo cáo Zalo / chụp sổ → phiếu kỹ sư nháp (PR-2, chủ SP 16–17/10/2026).
// Tệp này không gọi mạng: dựng dữ liệu gửi skill daily_log_from_report, kiểm lại kết quả AI (chỉ nhận mã có thật),
// áp trí nhớ cách gọi, rồi chuyển thành bản nháp theo (ngày × mũi) để tạo phiếu bằng RPC sẵn có.
import type { DailyLogLaborInput, DailyLogResourceProvider, DailyLogSourceItemV2, ProjectTask } from '../types';
import type { DailyLogDocumentBundle, SaveDailyLogSourceDocumentInput } from './dailyLogWbsService';
import { composeSlipNotes, normalizeBulletText } from './dailyLogItemNotes';
import { defaultForecast } from './dailyLogSlipRules';

export const fold = (value?: string | null): string => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Một hạng mục lá gửi AI: mã | khối › nhóm › việc | kế hoạch | %. */
export interface ReportTaskRow {
  id: string;
  code: string;
  path: string;
  start: string | null;
  end: string | null;
  progress: number;
}

/** Hạng mục lá (không có con), đường dẫn = khối nhà + 2 cấp gần nhất + tên việc. */
export const leafTaskRows = (tasks: readonly ProjectTask[]): ReportTaskRow[] => {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const parents = new Set(tasks.map(task => task.parentId).filter(Boolean) as string[]);
  return tasks.filter(task => !parents.has(task.id) && task.wbsCode).map(task => {
    const ancestors: string[] = [];
    let parent = task.parentId ? byId.get(task.parentId) : undefined;
    while (parent && ancestors.length < 12) { ancestors.unshift(parent.name); parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    // Khối nhà (gốc) + 2 cấp gần nhất: "NHÀ XƯỞNG › Phân đoạn 2 (Trục 6-15) › Gia công…" — AI phân biệt cùng tên ở các khối / phân đoạn.
    const kept = ancestors.length > 3 ? [ancestors[0], ...ancestors.slice(-2)] : ancestors;
    return { id: task.id, code: String(task.wbsCode), path: [...kept, task.name].join(' › '), start: task.startDate?.slice(0, 10) || null,
      end: task.endDate?.slice(0, 10) || null, progress: Math.round(Number(task.progress) || 0) };
  });
};

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const ddmm = (date: string | null) => (date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : '?');

/**
 * Hạng mục đưa cho AI: đang làm / sắp làm quanh các ngày báo cáo (±windowDays) và chưa xong; thêm hạng mục mới xong 14 ngày gần
 * để AI cảnh báo "đã 100% mà vẫn làm". Quá dài thì bỏ dần hạng mục xa ngày báo cáo nhất.
 */
export const reportTaskWindow = (rows: readonly ReportTaskRow[], dates: readonly string[], windowDays = 30, maxChars = 18000): ReportTaskRow[] => {
  const days = [...dates].filter(Boolean).sort();
  if (!days.length) return [];
  const from = addDays(days[0], -windowDays); const to = addDays(days[days.length - 1], windowDays);
  const recentDone = addDays(days[0], -14);
  const picked = rows.filter(row => {
    if (row.progress >= 100) return Boolean(row.end && row.end >= recentDone && row.end <= to);
    if (!row.start && !row.end) return true;
    const start = row.start || row.end!; const end = row.end || row.start!;
    return start <= to && (end >= from || row.progress > 0 || start <= days[days.length - 1]);
  });
  const distance = (row: ReportTaskRow) => {
    const start = row.start || row.end || days[0]; const end = row.end || row.start || days[0];
    if (end < days[0]) return Date.parse(days[0]) - Date.parse(end);
    if (start > days[days.length - 1]) return Date.parse(start) - Date.parse(days[days.length - 1]);
    return 0;
  };
  const sorted = [...picked].sort((a, b) => distance(a) - distance(b) || a.code.localeCompare(b.code, 'vi', { numeric: true }));
  const out: ReportTaskRow[] = []; let size = 0;
  for (const row of sorted) {
    const line = formatTaskRow(row);
    if (size + line.length + 1 > maxChars) break;
    out.push(row); size += line.length + 1;
  }
  return out.sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
};

export const formatTaskRow = (row: ReportTaskRow): string => `${row.code} | ${row.path} | ${ddmm(row.start)}→${ddmm(row.end)} | ${row.progress}%`;

/** Ngày nhắc tới trong chữ báo cáo ("15/10", "16/10/2026") — để cửa sổ kế hoạch phủ đủ khi dán nhiều ngày. */
export const datesInText = (text: string, reportDate: string): string[] => {
  const year = Number(reportDate.slice(0, 4));
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<!\d)(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?(?!\d)/g)) {
    const day = Number(match[1]); const month = Number(match[2]);
    const y = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : year;
    if (day < 1 || day > 31 || month < 1 || month > 12 || y < 2020 || y > 2100) continue;
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!Number.isNaN(Date.parse(iso)) && iso <= reportDate && iso >= addDays(reportDate, -45)) found.add(iso);
  }
  return [...found].sort();
};

// ───────────────────────────── Kết quả AI → bản nháp ─────────────────────────────

export interface ReportWork { text: string; taskCodes: string[]; location: string | null; quantity: number | null; unit: string | null; percent: number | null; confidence: 'high' | 'low'; reason: string | null }
export interface ReportSection { area: string | null; crews: Array<{ name: string; canonical: string | null; people: number | null }>; works: ReportWork[] }
export interface ReportDay { date: string | null; sections: ReportSection[]; weather: string | null; issues: string[]; nextDayPlan: string | null }
export interface ReportRead { days: ReportDay[]; warnings: string[] }

/** Trí nhớ chung (ai_memory_aliases): cách gọi người dùng đã xác nhận ở dự án này. */
export interface MemoryAlias { kind: 'task' | 'crew' | 'area'; alias: string; aliasNorm: string; targetId: string | null; targetLabel: string; hits: number }

export interface ReportArea { code: string; name: string }

export interface DraftWork {
  key: string;
  text: string;
  location: string | null;
  percent: number | null;
  /** Hạng mục đang chọn (id project_tasks); rỗng = việc phát sinh, chờ QS. */
  taskIds: string[];
  /** memory: lấy từ cách gọi đã xác nhận; low: AI không chắc. */
  source: 'ai' | 'low' | 'memory';
  reason: string | null;
}
export interface DraftCrew { key: string; raw: string; label: string; people: number | null; fromMemory: boolean }
export interface DraftSlip {
  key: string;
  date: string;
  areaCode: string;
  areaName: string;
  /** Tên khu vực AI đọc được (để học cách gọi mũi khi khác tên mũi). */
  areaRaw: string | null;
  works: DraftWork[];
  crews: DraftCrew[];
  issues: string[];
  weather: string | null;
  nextDayPlan: string | null;
}

let keySeq = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(keySeq += 1)}`;

const memoryTargets = (memory: readonly MemoryAlias[], kind: MemoryAlias['kind'], text: string) => {
  const norm = fold(text);
  const hits = memory.filter(m => m.kind === kind && m.aliasNorm === norm);
  if (!hits.length) return [];
  const top = Math.max(...hits.map(m => m.hits));
  return hits.filter(m => m.hits === top);
};

const matchArea = (raw: string | null, areas: readonly ReportArea[], memory: readonly MemoryAlias[]): ReportArea => {
  const name = raw?.trim() || '';
  const remembered = name ? memoryTargets(memory, 'area', name)[0] : undefined;
  if (remembered?.targetId) return { code: remembered.targetId, name: remembered.targetLabel };
  const key = fold(name);
  if (key) {
    const exact = areas.find(a => fold(a.name) === key || fold(a.code) === key);
    if (exact) return exact;
    const loose = areas.find(a => fold(a.name).includes(key) || key.includes(fold(a.name)));
    if (loose) return loose;
  }
  if (!name) return areas[0] || { code: 'CHUNG', name: 'Chung' };
  return { code: name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'MUI', name };
};

/** Kết quả AI → bản nháp theo (ngày × mũi): chỉ giữ mã có thật, áp cách gọi đã xác nhận, gộp khu vực trùng. */
export const buildDrafts = (read: ReportRead, ctx: {
  reportDate: string; rows: readonly ReportTaskRow[]; areas: readonly ReportArea[]; memory: readonly MemoryAlias[];
}): DraftSlip[] => {
  const byCode = new Map(ctx.rows.map(row => [row.code, row]));
  const byId = new Map(ctx.rows.map(row => [row.id, row]));
  const slips = new Map<string, DraftSlip>();
  read.days.forEach(day => {
    const date = day.date && /^\d{4}-\d{2}-\d{2}$/.test(day.date) && day.date <= ctx.reportDate ? day.date : ctx.reportDate;
    day.sections.forEach(section => {
      const area = matchArea(section.area, ctx.areas, ctx.memory);
      const id = `${date}|${area.code}`;
      const slip = slips.get(id) || { key: nextKey('slip'), date, areaCode: area.code, areaName: area.name, areaRaw: section.area,
        works: [], crews: [], issues: [], weather: day.weather, nextDayPlan: day.nextDayPlan };
      section.works.forEach(work => {
        const remembered = memoryTargets(ctx.memory, 'task', work.text).map(m => m.targetId).filter((tid): tid is string => Boolean(tid && byId.has(tid)));
        const aiIds = work.taskCodes.map(code => byCode.get(code)?.id).filter((tid): tid is string => Boolean(tid));
        const taskIds = remembered.length ? remembered : Array.from(new Set(aiIds));
        slip.works.push({ key: nextKey('work'), text: work.text, location: work.location, percent: work.percent, taskIds,
          source: remembered.length ? 'memory' : work.confidence === 'low' || (work.taskCodes.length > 0 && !aiIds.length) ? 'low' : 'ai',
          reason: remembered.length ? null : work.taskCodes.length > 0 && !aiIds.length ? 'Mã AI đưa không có trong kế hoạch.' : work.reason });
      });
      section.crews.forEach(crew => {
        if (slip.crews.some(c => fold(c.raw) === fold(crew.name))) return;
        const remembered = memoryTargets(ctx.memory, 'crew', crew.name)[0];
        slip.crews.push({ key: nextKey('crew'), raw: crew.name, label: remembered?.targetLabel || crew.canonical || crew.name,
          people: crew.people, fromMemory: Boolean(remembered) });
      });
      if (!slips.has(id)) slips.set(id, slip);
    });
    // Sự cố / thời tiết / kế hoạch mai thuộc cả ngày: ghi vào phiếu đầu tiên của ngày.
    const first = Array.from(slips.values()).find(s => s.date === date);
    if (first) { first.issues = Array.from(new Set([...first.issues, ...day.issues])); first.weather = first.weather || day.weather; first.nextDayPlan = first.nextDayPlan || day.nextDayPlan; }
  });
  return Array.from(slips.values()).sort((a, b) => a.date.localeCompare(b.date) || a.areaName.localeCompare(b.areaName, 'vi'));
};

/** Gợi ý cho AI: cách gọi đã xác nhận nhiều lần nhất (hạng mục → mã, tổ → tên chuẩn, khu vực → mũi). */
export const memoryHints = (memory: readonly MemoryAlias[], rows: readonly ReportTaskRow[], limit = 40): string => {
  const codeOf = new Map(rows.map(row => [row.id, row.code]));
  return memory.filter(m => m.kind !== 'task' || (m.targetId && codeOf.has(m.targetId))).slice(0, limit)
    .map(m => `${m.alias} → ${m.kind === 'task' ? codeOf.get(m.targetId!) : m.targetLabel}`).join('\n');
};

/** Cặp cách gọi để học khi người dùng tạo phiếu nháp (đã xem và xác nhận). */
export const learnPairs = (slips: readonly DraftSlip[], rows: readonly ReportTaskRow[]) => {
  const byId = new Map(rows.map(row => [row.id, row]));
  const pairs: Array<{ kind: MemoryAlias['kind']; alias: string; targetId: string | null; targetLabel: string }> = [];
  slips.forEach(slip => {
    if (slip.areaRaw && fold(slip.areaRaw) !== fold(slip.areaName)) pairs.push({ kind: 'area', alias: slip.areaRaw, targetId: slip.areaCode, targetLabel: slip.areaName });
    slip.works.forEach(work => work.taskIds.forEach(taskId => {
      const row = byId.get(taskId);
      if (row) pairs.push({ kind: 'task', alias: work.text, targetId: taskId, targetLabel: `${row.code} ${row.path.split(' › ').pop()}` });
    }));
    slip.crews.forEach(crew => { if (fold(crew.raw) !== fold(crew.label)) pairs.push({ kind: 'crew', alias: crew.raw, targetId: null, targetLabel: crew.label }); });
  });
  return pairs.slice(0, 80);
};

/**
 * Bản nháp → dữ liệu lưu phiếu kỹ sư (save_daily_log_source_document_v2), dùng đúng mốc khối lượng của phiếu vừa tạo.
 * KL / % chỉ điền khi báo cáo ghi số (chủ SP 17/10, câu 2). Nhân công gắn vào việc đầu của phiếu; tổ chưa ghi số người,
 * việc ngoài kế hoạch ("chờ QS") và kế hoạch ngày mai ghi vào phần nội dung để người lập xem lại.
 */
export const slipSaveInput = (slip: DraftSlip, doc: DailyLogDocumentBundle, contribution: { id: string; rowVersion: number },
  newKey: () => string = () => crypto.randomUUID()): SaveDailyLogSourceDocumentInput => {
  const tasks = new Map(doc.tasks.map(task => [task.id, task]));
  const byTask = new Map<string, { clientKey: string; notes: string[]; percent: number | null }>();
  slip.works.forEach(work => work.taskIds.forEach(taskId => {
    if (!tasks.has(taskId)) return;
    const entry = byTask.get(taskId) || { clientKey: newKey(), notes: [], percent: null };
    entry.notes.push(work.location && !fold(work.text).includes(fold(work.location)) ? `${work.text} (${work.location})` : work.text);
    if (work.percent != null) entry.percent = Math.max(entry.percent ?? 0, work.percent);
    byTask.set(taskId, entry);
  }));
  const items: DailyLogSourceItemV2[] = Array.from(byTask.entries()).map(([taskId, entry], index) => ({
    clientKey: entry.clientKey, taskId,
    workBoqItemId: doc.workBoqItems.find(work => work.sourceTaskId === taskId)?.id ?? null,
    entryMode: 'percent', enteredValue: entry.percent ?? '',
    baselineFingerprint: doc.quantityBaselines?.[taskId]?.fingerprint || '',
    forecastFinishDate: defaultForecast(tasks.get(taskId)?.endDate, slip.date), forecastChangeReason: null,
    note: normalizeBulletText(entry.notes.join('\n')), issues: index === 0 ? normalizeBulletText(slip.issues.join('\n')) || null : null, attachments: [],
  }));
  const firstKey = items[0]?.clientKey;
  const providerOf = (label: string): DailyLogResourceProvider => {
    const partner = doc.resourceProviders.find(p => p.isActive !== false && fold(p.name) === fold(label));
    return partner ? { entryMode: 'catalog', partnerId: partner.id, providerCodeSnapshot: partner.code || null, providerNameSnapshot: partner.name }
      : { entryMode: 'manual', manualProviderType: 'free_crew', manualProviderName: label };
  };
  const counted = firstKey ? slip.crews.filter(crew => Number(crew.people) > 0) : [];
  const labor: DailyLogLaborInput[] = counted.map(crew => ({ workItemClientKey: firstKey!, laborType: crew.label, peopleCount: Number(crew.people),
    hoursPerPerson: 8, provider: providerOf(crew.label) }));
  const uncounted = slip.crews.filter(crew => !counted.includes(crew));
  const unmatched = slip.works.filter(work => !work.taskIds.some(taskId => tasks.has(taskId)));
  const derived = composeSlipNotes(items.map(item => ({ wbsCode: tasks.get(item.taskId)?.wbsCode, taskName: tasks.get(item.taskId)?.name, note: item.note, issues: item.issues })));
  const extra = [
    unmatched.length ? `Việc ngoài kế hoạch — chờ QS:\n${unmatched.map(work => `  - ${work.text}`).join('\n')}` : '',
    uncounted.length ? `Nhân công chưa ghi số người: ${uncounted.map(crew => crew.label).join(', ')}` : '',
    slip.nextDayPlan ? `Kế hoạch ngày mai:\n${normalizeBulletText(slip.nextDayPlan).split('\n').map(line => `  ${line}`).join('\n')}` : '',
    slip.weather ? `Thời tiết: ${slip.weather}` : '',
  ].filter(Boolean);
  return {
    contributionId: contribution.id, expectedRowVersion: contribution.rowVersion, workAreaCode: slip.areaCode, workAreaName: slip.areaName,
    content: [derived.content, ...extra].filter(Boolean).join('\n'),
    issues: derived.issues || (items.length ? '' : normalizeBulletText(slip.issues.join('\n'))),
    photos: [], items, labor, machines: [],
  };
};
