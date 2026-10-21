// Vioo Work · Đợt 1 PR-3 (chủ SP 20/10/2026): 5 skill soạn nháp cho giao việc. AI chỉ soạn; người giao / người làm tự bấm Giao, Gửi.
// Tên người và hạn: AI chép đúng chữ trong câu (kèm họ tên trong danh sách nếu chắc, ngày nếu tính được); máy khớp người và đổi chữ hạn
// thành ngày (lib/work/workAi.ts), không chắc thì hỏi bằng nút bấm. Số liệu của tóm tắt do máy tính sẵn (dòng "Đánh giá hạn").
// Tệp này không dùng API Deno để vitest kiểm thử được.
import { clampText, wrapData } from './guard.ts';
import { parseImageParts } from './images.ts';
import type { SkillDef } from './skills.ts';

const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});
const strOrNull = (v: unknown, max: number) => { const t = clampText(v, max).trim(); return t && t.toLowerCase() !== 'null' ? t : null; };
const text = (v: unknown, max: number) => strOrNull(v, max) ?? '';
const list = (v: unknown, max: number, len = 200) => (Array.isArray(v) ? v : []).map(x => text(x, len)).filter(Boolean).slice(0, max);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v: unknown) => { const d = strOrNull(v, 10); return d && ISO_DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) ? d : null; };
const timeOrNull = (v: unknown) => { const t = strOrNull(v, 5); return t && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : null; };
const levelOrNull = (v: unknown) => (v === 'A' || v === 'B' || v === 'C' ? v : null);
const evidenceOf = (v: unknown) => { const o = asObject(v); return { photo: o.photo === true, file: o.file === true }; };

const WEEKDAYS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
/** Ngày VN hôm nay (YYYY-MM-DD). */
const vnToday = (now = new Date()) => new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
/** Màn hình gửi ngày của máy người dùng; lệch quá 2 ngày so với máy chủ thì dùng ngày máy chủ. */
const todayOf = (raw: unknown) => {
  const server = vnToday();
  const d = isoOrNull(raw);
  return d && Math.abs(Date.parse(`${d}T00:00:00Z`) - Date.parse(`${server}T00:00:00Z`)) <= 2 * 86_400_000 ? d : server;
};
/** "Thứ 3 20/10/2026 (2026-10-20)". */
export const workDayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} (${iso})`;
};
const peopleOf = (raw: unknown) => clampText(raw, 8000).trim();
const DUE_RULE = 'dueText: đúng chữ chỉ hạn trong câu ("thứ 6", "trước 25/10", "cuối tuần", "mai", "9h sáng mai"), không có thì null. dueDate: ngày hạn YYYY-MM-DD tính từ hôm nay (tuần bắt đầu thứ 2; "thứ 6" = thứ 6 gần nhất từ hôm nay; "thứ 6 tuần sau" = thứ 6 của tuần kế tiếp; "cuối tuần" = thứ 7), không có hạn thì null. dueTime: giờ HH:MM nếu câu ghi giờ, không thì null.';
const LEVEL_RULE = 'level: "A" khi câu nói gấp / khẩn / trọng điểm / ưu tiên số 1 / lãnh đạo chỉ đạo; "B" khi nói quan trọng; "C" khi nói thường / không gấp / khi nào rảnh; không nói thì null.';
const PERSON_RULE = 'assignee: đúng chữ chỉ người làm trong câu (VD "Hà", "anh Đô", "Hà KH"); không nói ai làm thì null; "tôi / mình / em tự làm" thì "tôi". assigneeName: họ tên đúng như trong danh sách người giao được khi chắc chắn chỉ một người khớp, không chắc hoặc không có trong danh sách thì null — không đoán.';

const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'assignee', 'assigneeName', 'dueText', 'dueDate', 'dueTime', 'level', 'description', 'checklist', 'tags', 'evidence', 'warnings'],
  properties: {
    title: { type: 'string' }, assignee: { type: ['string', 'null'] }, assigneeName: { type: ['string', 'null'] }, dueText: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] }, dueTime: { type: ['string', 'null'] }, level: { type: ['string', 'null'], enum: ['A', 'B', 'C', null] },
    description: { type: 'string' }, checklist: { type: 'array', items: { type: 'string' } }, tags: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'object', additionalProperties: false, required: ['photo', 'file'], properties: { photo: { type: 'boolean' }, file: { type: 'boolean' } } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

/** Người làm + hạn chung cho việc AI soạn (một việc hoặc từng việc trong biên bản). */
const draftCore = (o: Record<string, unknown>) => ({
  title: text(o.title, 160), assignee: strOrNull(o.assignee, 80), assigneeName: strOrNull(o.assigneeName, 120),
  dueText: strOrNull(o.dueText, 80), dueDate: isoOrNull(o.dueDate), dueTime: timeOrNull(o.dueTime), level: levelOrNull(o.level),
});

const workTaskDraft: SkillDef = {
  code: 'work_task_draft',
  maxInputChars: 10000,
  maxOutputTokens: 900,
  noThinking: true,
  parseInput: raw => {
    const o = asObject(raw);
    const said = clampText(o.text, 2000).trim();
    if (said.length < 3) throw new Error('AI_BAD_INPUT');
    return { text: said, today: todayOf(o.today), people: peopleOf(o.people) };
  },
  system: [
    'Soạn MỘT việc giao từ câu nói / tin nhắn của người giao (tiếng Việt, có thể không dấu, viết tắt) trong công ty xây dựng.',
    'title: tên việc ngắn, bắt đầu bằng động từ, không chứa tên người làm, không chứa hạn, mức quan trọng, tối đa 120 ký tự.',
    PERSON_RULE, DUE_RULE, LEVEL_RULE,
    'description: yêu cầu / kết quả cần có / đầu vào lấy từ câu, không thêm ý mới; không có thì "". checklist: các bước con khi câu liệt kê, không thì [].',
    'tags: tên dự án / công trình / chủ đề nêu trong câu (VD "SMB", "XinHai"), tối đa 4. evidence: photo / file = true khi câu đòi ảnh / tệp / biên bản / bảng tính.',
    'warnings: tối đa 3 câu ngắn khi câu có điều chưa rõ (người, hạn). Không bịa người, ngày, số.',
  ].join(' '),
  user: input => [
    `Hôm nay: ${workDayLabel(input.today)}`,
    input.people ? wrapData('nguoi_giao_duoc', input.people) : '',
    wrapData('cau_giao_viec', input.text),
    'Trả JSON: {"title": "<tên việc>", "assignee": null, "assigneeName": null, "dueText": null, "dueDate": null, "dueTime": null, "level": null, "description": "", "checklist": [], "tags": [], "evidence": {"photo": false, "file": false}, "warnings": []}',
  ].filter(Boolean).join('\n'),
  schema: DRAFT_SCHEMA,
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    return { ...draftCore(o), description: text(o.description, 3000), checklist: list(o.checklist, 20), tags: list(o.tags, 6, 40),
      evidence: evidenceOf(o.evidence), warnings: list(o.warnings, 3) };
  },
  summary: (input, output) => `giao việc từ ${input.text.length} ký tự → ${output.assignee ? 'có' : 'không'} người, ${output.dueText || output.dueDate ? 'có' : 'không'} hạn, mức ${output.level || '—'}`,
};

const MEETING_TASK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'assignee', 'assigneeName', 'dueText', 'dueDate', 'dueTime', 'level', 'note', 'quote'],
  properties: {
    title: { type: 'string' }, assignee: { type: ['string', 'null'] }, assigneeName: { type: ['string', 'null'] }, dueText: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] }, dueTime: { type: ['string', 'null'] }, level: { type: ['string', 'null'], enum: ['A', 'B', 'C', null] },
    note: { type: ['string', 'null'] }, quote: { type: ['string', 'null'] },
  },
};
const meetingInput = (raw: unknown) => {
  const o = asObject(raw);
  const minutes = clampText(o.text, 12000).trim();
  const images = parseImageParts(o.images ?? null, 4);
  if (!images.length && minutes.length < 10) throw new Error('AI_BAD_INPUT');
  return { minutes, images, today: todayOf(o.today), people: peopleOf(o.people) };
};
const workMeetingTasks: SkillDef = {
  code: 'work_meeting_tasks',
  maxInputChars: 20000,
  maxOutputTokens: 4000,
  noThinking: true,
  textUsesFast: true,
  parseInput: raw => { const m = meetingInput(raw); return { text: m.minutes, pages: String(m.images.length), today: m.today, people: m.people }; },
  images: raw => meetingInput(raw).images,
  system: [
    'Tách biên bản họp / tin nhắn chỉ đạo / ảnh sổ họp (tiếng Việt, có thể viết tay, viết tắt) thành danh sách việc được giao.',
    'Chỉ lấy ý có người phải làm một việc (giao, yêu cầu, chỉ đạo, "… phụ trách", "… làm", "đề nghị … hoàn thành"); bỏ thông tin, ý kiến, kết luận chung không có việc cụ thể.',
    'Một ý giao cùng việc cho nhiều người: tách mỗi người một việc. Giữ thứ tự, tối đa 30 việc.',
    'Mỗi việc: title (tên việc ngắn, bắt đầu bằng động từ, không chứa tên người, hạn), ' + PERSON_RULE + ' ' + DUE_RULE.replace('tính từ hôm nay', 'tính từ ngày họp (không ghi thì hôm nay)') + ' ' + LEVEL_RULE,
    'note: chi tiết thêm của việc trong biên bản (đầu vào, tiêu chí), không có thì null. quote: câu gốc của việc, tối đa 200 ký tự.',
    'meetingTitle: tên cuộc họp nếu có ("Giao ban tuần 43", "Họp BLĐ 20/10"), không thì null. heldOn: ngày họp YYYY-MM-DD nếu ghi, không thì null. chairman: người chủ trì / chỉ đạo nếu ghi, không thì null.',
    'warnings: tối đa 5 câu ngắn về chữ mờ, người / hạn không rõ. Không bịa người, ngày, số.',
  ].join(' '),
  user: input => [
    `Hôm nay: ${workDayLabel(input.today)}`,
    input.people ? wrapData('nguoi_giao_duoc', input.people) : '',
    input.text ? wrapData('bien_ban', input.text) : '',
    Number(input.pages) ? `Ảnh: ${input.pages} trang biên bản / sổ họp.` : '',
    'Trả JSON: {"meetingTitle": null, "heldOn": null, "chairman": null, "tasks": [{"title": "<việc>", "assignee": null, "assigneeName": null, "dueText": null, "dueDate": null, "dueTime": null, "level": null, "note": null, "quote": null}], "warnings": []}',
  ].filter(Boolean).join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['meetingTitle', 'heldOn', 'chairman', 'tasks', 'warnings'],
    properties: { meetingTitle: { type: ['string', 'null'] }, heldOn: { type: ['string', 'null'] }, chairman: { type: ['string', 'null'] },
      tasks: { type: 'array', items: MEETING_TASK_SCHEMA }, warnings: { type: 'array', items: { type: 'string' } } },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const tasks = (Array.isArray(o.tasks) ? o.tasks : []).slice(0, 30).map(asObject)
      .map(t => ({ ...draftCore(t), note: strOrNull(t.note, 1000), quote: strOrNull(t.quote, 240) })).filter(t => t.title);
    return { meetingTitle: strOrNull(o.meetingTitle, 200), heldOn: isoOrNull(o.heldOn), chairman: strOrNull(o.chairman, 120), tasks, warnings: list(o.warnings, 5, 240) };
  },
  summary: (input, output) => `biên bản ${input.pages} ảnh + ${input.text.length} ký tự → ${(output.tasks as unknown[]).length} việc`,
};

const workUpdateDraft: SkillDef = {
  code: 'work_update_draft',
  maxInputChars: 7000,
  maxOutputTokens: 700,
  noThinking: true,
  parseInput: raw => {
    const o = asObject(raw);
    const notes = clampText(o.notes, 3000).trim();
    const task = clampText(o.task, 3000).trim();
    if (notes.length < 3 || task.length < 5) throw new Error('AI_BAD_INPUT');
    return { notes, task };
  },
  system: [
    'Sắp xếp ghi chú tiến độ của người làm một việc thành 4 phần. done: đã xong từ lần cập nhật trước; doing: đang làm; next: bước tiếp theo, kèm ngày nếu có; blocked: vướng mắc / cần ai hỗ trợ, không vướng thì "".',
    'Giữ ý, số, tên của người viết; câu ngắn, bỏ từ thừa; mỗi phần tối đa 3 ý nối bằng "; ". Không thêm việc người viết không nói; phần không có thì "".',
    'percent: % hoàn thành CHỈ khi ghi chú nói rõ ("xong 80%", "được một nửa" = 50, "xong hết" = 100), không thì null — không đoán từ số ý, không lấy % hiện tại.',
    'warnings: tối đa 2 câu ngắn, VD khi % ghi chú nhỏ hơn % hiện tại.',
  ].join(' '),
  user: input => `${wrapData('viec', input.task)}\n${wrapData('ghi_chu', input.notes)}\nTrả JSON: {"done": "", "doing": "", "next": "", "blocked": "", "percent": null, "warnings": []}`,
  schema: {
    type: 'object', additionalProperties: false, required: ['done', 'doing', 'next', 'blocked', 'percent', 'warnings'],
    properties: { done: { type: 'string' }, doing: { type: 'string' }, next: { type: 'string' }, blocked: { type: 'string' },
      percent: { type: ['integer', 'null'] }, warnings: { type: 'array', items: { type: 'string' } } },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const p = typeof o.percent === 'number' ? o.percent : typeof o.percent === 'string' ? Number(o.percent.replace('%', '')) : NaN;
    return { done: text(o.done, 2000), doing: text(o.doing, 2000), next: text(o.next, 2000), blocked: text(o.blocked, 2000),
      percent: Number.isFinite(p) && p >= 0 && p <= 100 ? Math.round(p) : null, warnings: list(o.warnings, 2) };
  },
  summary: (input, output) => `cập nhật từ ${input.notes.length} ký tự → ${['done', 'doing', 'next', 'blocked'].filter(k => output[k]).length} phần, % ${output.percent ?? '—'}`,
};

const workTaskWriter: SkillDef = {
  code: 'work_task_writer',
  maxInputChars: 3000,
  maxOutputTokens: 900,
  noThinking: true,
  parseInput: raw => {
    const o = asObject(raw);
    const title = clampText(o.title, 300).trim();
    if (title.length < 2) throw new Error('AI_BAD_INPUT');
    return { title, notes: clampText(o.notes, 2000).trim(), level: levelOrNull(o.level) || '' };
  },
  system: [
    'Viết phần yêu cầu cho một việc giao trong công ty xây dựng từ tên việc và ghi chú có sẵn.',
    'description: 2–4 câu ngắn: mục tiêu, kết quả cần nộp, tiêu chí đạt. Chỉ dùng dữ kiện trong tên việc / ghi chú; không bịa số, tên người, ngày, số hiệu hồ sơ — chỗ người giao cần điền thì để trong ngoặc vuông, VD "[số hợp đồng]".',
    'checklist: 3–6 bước làm ngắn theo thứ tự, mỗi bước bắt đầu bằng động từ. evidence: photo = true khi kết quả ở hiện trường; file = true khi kết quả là hồ sơ, bảng tính, biên bản, bản vẽ.',
    'Không chào hỏi, không giải thích.',
  ].join(' '),
  user: input => `${wrapData('ten_viec', input.title)}${input.notes ? `\n${wrapData('ghi_chu', input.notes)}` : ''}${input.level ? `\nMức: ${input.level}` : ''}\nTrả JSON: {"description": "", "checklist": [], "evidence": {"photo": false, "file": false}}`,
  schema: {
    type: 'object', additionalProperties: false, required: ['description', 'checklist', 'evidence'],
    properties: { description: { type: 'string' }, checklist: { type: 'array', items: { type: 'string' } },
      evidence: { type: 'object', additionalProperties: false, required: ['photo', 'file'], properties: { photo: { type: 'boolean' }, file: { type: 'boolean' } } } },
  },
  parseOutput: raw => { const o = asObject(Array.isArray(raw) ? raw[0] : raw); return { description: text(o.description, 3000), checklist: list(o.checklist, 8), evidence: evidenceOf(o.evidence) }; },
  summary: (input, output) => `viết yêu cầu cho tên ${input.title.length} ký tự → ${String(output.description || '').length} ký tự, ${(output.checklist as unknown[]).length} bước`,
};

const workTaskBrief: SkillDef = {
  code: 'work_task_brief',
  maxInputChars: 6000,
  maxOutputTokens: 300,
  noThinking: true,
  parseInput: raw => {
    const facts = clampText(asObject(raw).facts, 6000).trim();
    if (facts.length < 10) throw new Error('AI_BAD_INPUT');
    return { facts };
  },
  system: [
    'Tóm tắt một việc cho người giao / lãnh đạo trong 2–3 câu từ các dòng số liệu: đang ở đâu (trạng thái, % tiến độ), vướng gì, có kịp hạn không.',
    'Ý "kịp hạn" dựa đúng dòng "Đánh giá hạn" máy đã tính, không tự tính lại. Chỉ dùng thông tin trong các dòng, không thêm số, không khuyên chung chung; có vướng thì nêu cần ai làm gì nếu dòng có ghi.',
  ].join(' '),
  user: input => `${wrapData('viec', input.facts)}\nTrả JSON: {"brief": "<2–3 câu>"}`,
  schema: { type: 'object', additionalProperties: false, required: ['brief'], properties: { brief: { type: 'string' } } },
  parseOutput: raw => ({ brief: text(asObject(Array.isArray(raw) ? raw[0] : raw).brief, 800) }),
  summary: (input, output) => `tóm tắt việc từ ${input.facts.split('\n').length} dòng → ${String(output.brief || '').length} ký tự`,
};

// Đợt 2 PR-6: chốt kỳ — nháp Đánh giá + Giải pháp từng mục tiêu và nhận xét kỳ. Số liệu, trạng thái mục tiêu do máy tính sẵn (lib/work/workGoals.ts
// periodReviewFacts); AI chỉ diễn đạt. parseOutput không có đầu vào (SkillDef) nên chỉ chuẩn hóa id; màn hình lọc goal theo id đã gửi.
const GOAL_ID_MAX = 64;
const oneLine = (v: unknown, max: number) => clampText(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);
const periodGoals = (raw: unknown) => {
  const seen = new Set<string>();
  const out: Array<{ id: string; title: string }> = [];
  for (const g of (Array.isArray(raw) ? raw : []).map(asObject)) {
    const id = typeof g.id === 'string' ? g.id.trim() : '';
    const title = oneLine(g.title, 200);
    if (!id || id.length > GOAL_ID_MAX || /[\s[\]]/.test(id) || !title || seen.has(id)) continue;
    seen.add(id); out.push({ id, title });
    if (out.length >= 30) break;
  }
  return out;
};
const workPeriodReview: SkillDef = {
  code: 'work_period_review',
  maxInputChars: 12000,
  maxOutputTokens: 5000,
  noThinking: true,
  textUsesFast: true,
  parseInput: raw => {
    const o = asObject(raw);
    const facts = clampText(o.facts, 12000).trim();
    if (facts.length < 10) throw new Error('AI_BAD_INPUT');
    return { facts, goals: periodGoals(o.goals).map(g => `[${g.id}] ${g.title}`).join('\n') };
  },
  system: [
    'Soạn nháp phần Đánh giá + Giải pháp khi trưởng đơn vị / Ban lãnh đạo chốt kỳ giao việc trong công ty xây dựng, từ các dòng số liệu máy đã tính. Người chốt sẽ sửa rồi tự bấm Chốt.',
    'Chỉ dùng số, tên người, tên việc, ngày có trong dữ liệu; không bịa số, không tự tính tỷ lệ mới, không khuyên chung chung ("cần cố gắng", "tăng cường phối hợp").',
    'Trạng thái mỗi mục tiêu đã có ở "trạng thái máy tính" (Đạt / Chưa đạt / Có rủi ro / Đúng tiến độ / Chưa có số): dùng đúng trạng thái đó, không tự tính lại.',
    'overall.assessment: 2–4 câu nêu tỷ lệ đúng hạn (so kỳ trước nếu có), số việc quá hạn, chỉ đạo BLĐ nếu có, bao nhiêu mục tiêu đạt / chưa đạt. overall.solution: 1–2 câu cụ thể khi kỳ có việc quá hạn / trễ hoặc mục tiêu chưa đạt, không thì null.',
    'goals: mỗi mục tiêu trong danh sách một phần tử, id chép đúng chuỗi trong ngoặc vuông, không thêm mục tiêu khác. assessment: 1–3 câu: chỉ tiêu, thực tế, % đạt, việc xong / trễ theo dòng của mục tiêu.',
    'solution: null khi Đạt hoặc Đúng tiến độ; Chưa có số thì null và assessment nói rõ chưa nhập thực tế. Chưa đạt / Có rủi ro: 1–2 câu cụ thể ai làm gì, đến khi nào, dựa đúng việc trễ / vướng / người phụ trách trong dữ liệu; dữ liệu không có người thì ghi "người phụ trách"; hạn dùng ngày có trong dữ liệu hoặc mốc tương đối ("trong tuần tới", "trước kỳ chốt sau"), không tự đặt ngày mới.',
  ].join(' '),
  user: input => [
    wrapData('so_lieu_ky', input.facts),
    input.goals ? wrapData('muc_tieu', input.goals) : 'Mục tiêu: không có — trả goals [].',
    'Trả JSON: {"overall": {"assessment": "<2–4 câu>", "solution": null}, "goals": [{"id": "<id trong ngoặc vuông>", "assessment": "<1–3 câu>", "solution": null}]}',
  ].join('\n'),
  schema: {
    type: 'object', additionalProperties: false, required: ['overall', 'goals'],
    properties: {
      overall: { type: 'object', additionalProperties: false, required: ['assessment', 'solution'], properties: { assessment: { type: 'string' }, solution: { type: ['string', 'null'] } } },
      goals: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'assessment', 'solution'],
        properties: { id: { type: 'string' }, assessment: { type: 'string' }, solution: { type: ['string', 'null'] } } } },
    },
  },
  parseOutput: raw => {
    const o = asObject(Array.isArray(raw) ? raw[0] : raw);
    const overall = asObject(o.overall);
    const seen = new Set<string>();
    const goals: Array<{ id: string; assessment: string; solution: string | null }> = [];
    for (const g of (Array.isArray(o.goals) ? o.goals : []).map(asObject)) {
      const id = typeof g.id === 'string' ? g.id.trim().replace(/^\[(.*)\]$/, '$1').trim() : '';
      if (!id || id.length > GOAL_ID_MAX || seen.has(id)) continue;
      const item = { id, assessment: text(g.assessment, 600), solution: strOrNull(g.solution, 400) };
      if (!item.assessment && !item.solution) continue;
      seen.add(id); goals.push(item);
      if (goals.length >= 30) break;
    }
    return { overall: { assessment: text(overall.assessment, 600), solution: strOrNull(overall.solution, 400) }, goals };
  },
  summary: (input, output) => `đánh giá kỳ từ ${input.facts.split('\n').length} dòng, ${input.goals ? input.goals.split('\n').length : 0} mục tiêu → ${(output.goals as unknown[]).length} nháp`,
};

export const WORK_SKILLS: SkillDef[] = [workTaskDraft, workMeetingTasks, workUpdateDraft, workTaskWriter, workTaskBrief, workPeriodReview];
