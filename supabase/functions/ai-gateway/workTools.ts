// Vioo Work · Đợt 1 PR-3 (chủ SP 20/10/2026): công cụ Trợ lý cho giao việc. Đọc bằng JWT người hỏi — RPC Work tự kiểm quyền
// (người làm, người giao, trưởng đơn vị theo sơ đồ tổ chức, BLĐ xem toàn công ty; việc "hạn chế" chỉ người liên quan).
//   viec_giao           work_assignable_people_v1 (khớp tên) → work_tasks_overview_v1 (việc theo người / đơn vị / trạng thái)
//   tom_tat_viec        search_global_v1 (công việc) → work_task_brief_v1
//   chuan_bi_giao_viec  work_assignable_people_v1 → lệnh nháp work_task (thẻ form giao việc; người dùng bấm Giao)
// Tệp này không dùng API Deno để vitest kiểm thử được.
import type { ToolSpec } from './agent.ts';
import type { ToolContext } from './tools.ts';

const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});
const asArray = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const compact = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))) as Partial<T>;
type RpcError = { message?: string; code?: string } | null;
const denied = (e: RpcError) => Boolean(e && (e.code === '42501' || /DENIED|42501|NOT_FOUND/i.test(e.message || '')));
const OUT_OF_SCOPE = (what: string) => JSON.stringify({ loi: `Ngoài phạm vi người hỏi được xem: ${what} (máy chủ từ chối theo quyền). Nói rõ là ngoài quyền xem, không đoán, không nói là không tồn tại.` });
const failed = (e: RpcError, what: string) => (denied(e) ? OUT_OF_SCOPE(what) : JSON.stringify({ loi: `Chưa đọc được ${what}, thử lại sau.` }));

const LEVEL_LABEL: Record<string, string> = { A: 'A · Trọng điểm', B: 'B · Quan trọng', C: 'C · Thường' };
// Giống lib/work/workPresentation.ts · workStatusLabels (chữ trên màn Vioo Work).
const STATUS_LABEL: Record<string, string> = {
  draft: 'Bản nháp', pending_acknowledgement: 'Chờ nhận việc', clarification_requested: 'Cần làm rõ', not_started: 'Chưa bắt đầu', in_progress: 'Đang thực hiện',
  blocked: 'Đang bị chặn', awaiting_review: 'Chờ đánh giá', changes_requested: 'Cần chỉnh sửa', completed: 'Hoàn thành', cancelled: 'Đã hủy',
};
const ACTIVE = new Set(['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested']);
const vnDate = (iso: unknown) => { const s = str(iso, 40); if (!s) return null; const d = new Date(Date.parse(s) + 7 * 3_600_000); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 16).replace('T', ' '); };
const hoursSince = (iso: unknown, now: number) => { const t = Date.parse(String(iso || '')); return Number.isNaN(t) ? null : (now - t) / 3_600_000; };

/** Kịp hạn hay không — máy tính, AI chỉ nói lại (giống lib/work/workAi.ts · workDueAssessment). */
export const dueAssessment = (t: { status: string; deadlineAt: string | null; createdAt: string | null; progressPercent: number }, now = Date.now()) => {
  if (t.status === 'completed') return 'Đã hoàn thành';
  if (t.status === 'cancelled') return 'Đã hủy';
  const due = Date.parse(t.deadlineAt || '');
  if (Number.isNaN(due)) return 'Chưa có hạn';
  if (due < now) return `Đã quá hạn ${Math.max(1, Math.ceil((now - due) / 86_400_000))} ngày`;
  const start = Date.parse(t.createdAt || '');
  if (Number.isNaN(start) || due <= start) return 'Còn hạn';
  const elapsed = Math.round(((now - start) / (due - start)) * 100);
  return elapsed - t.progressPercent >= 25 ? `Có nguy cơ trễ: đã qua ${elapsed}% thời gian, tiến độ ${t.progressPercent}%` : `Đang kịp: đã qua ${elapsed}% thời gian, tiến độ ${t.progressPercent}%`;
};

// ── Khớp tên người theo danh sách người giao được (bỏ dấu, bỏ "anh / chị…", tên gọi = chữ cuối của họ tên, biệt danh đã học) ──
const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const HONORIFIC = new Set(['anh', 'chi', 'em', 'a', 'c', 'e', 'bac', 'chu', 'co', 'ong', 'ba', 'sep', 'mr', 'ms', 'mrs', 'dc', 'thay', 'giao', 'cho', 'nho']);
export interface WorkPersonRow { userId: string; name: string; unit: string | null; isMe: boolean; canReceive: boolean; aliases: string[] }
export const personRows = (raw: unknown): { canAssignOthers: boolean; people: WorkPersonRow[] } => {
  const o = asObject(raw);
  return { canAssignOthers: o.canAssignOthers === true, people: asArray(o.people).map(asObject).filter(p => typeof p.userId === 'string').map(p => ({
    userId: String(p.userId), name: String(p.name || ''), unit: str(asObject(p.unit).code, 40) || str(asObject(p.unit).name, 80), isMe: p.isMe === true,
    canReceive: p.canReceive !== false, aliases: asArray(p.aliases).map(a => String(a)) })) };
};
export const matchPeople = (phrase: string, people: WorkPersonRow[]): WorkPersonRow[] => {
  const q = fold(phrase);
  if (!q) return [];
  if (/^(toi|minh|em|tu lam|chinh toi|ban than)$/.test(q)) return people.filter(p => p.isMe);
  const exact = people.filter(p => fold(p.name) === q || p.aliases.some(a => fold(a) === q));
  if (exact.length) return exact;
  const words = q.split(/[^a-z0-9]+/).filter(w => w && !HONORIFIC.has(w));
  if (!words.length) return [];
  return people.filter(p => {
    const name = fold(p.name).split(' ');
    const given = name[name.length - 1];
    const unit = fold(p.unit);
    // "Hà" / "Thành Đô" → các chữ đều trong họ tên và có tên gọi; "Hà KH" → tên gọi + mã đơn vị; biệt danh đã học.
    return (words.includes(given) && words.every(w => name.includes(w)))
      || (words[0] === given && words.length > 1 && words.slice(1).every(w => unit.includes(w)))
      || p.aliases.some(a => fold(a) === q || fold(a).split(' ').includes(q));
  });
};
const personLabel = (p: WorkPersonRow) => `${p.name}${p.unit ? ` · ${p.unit}` : ''}`;

export const WORK_TOOLS: ToolSpec[] = [
  {
    name: 'viec_giao',
    description: 'Danh sách việc trong Vioo Work theo người làm / đơn vị / trạng thái mà người hỏi được xem (việc của mình, việc mình giao, việc trong đơn vị mình làm trưởng, BLĐ xem toàn công ty). Dùng khi hỏi "việc của Hà", "phòng QLDA đang làm gì", "việc nào quá hạn / lâu chưa cập nhật / chờ duyệt", "việc tuần này". Trả mã, tên, mức A/B/C, trạng thái, % tiến độ, hạn, lần cập nhật gần nhất; mỗi việc có mã nguồn hN.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      nguoi: { type: 'string', description: 'Tên người làm theo lời người dùng (VD "Hà", "anh Đô", "tôi"). Bỏ trống = không lọc theo người.' },
      don_vi: { type: 'string', description: 'Mã hoặc tên phòng / đơn vị (VD "QLDA", "Tài chính kế toán"). Bỏ trống = không lọc.' },
      trang_thai: { type: 'string', enum: ['dang_lam', 'qua_han', 'lau_chua_cap_nhat', 'cho_duyet', 'xong_gan_day', 'tat_ca'], description: 'Mặc định dang_lam (mọi việc chưa xong).' },
      han_den: { type: 'string', description: 'Chỉ việc có hạn đến hết ngày này YYYY-MM-DD (VD "tuần này" → thứ 7 tuần này).' },
    } },
  },
  {
    name: 'tom_tat_viec',
    description: 'Chi tiết một việc Vioo Work để tóm tắt: trạng thái, % tiến độ, hạn và đánh giá kịp hạn (máy tính sẵn), người giao, người làm (đã nhận chưa), checklist, việc con, các cập nhật Đã / Đang / Sẽ / Vướng gần nhất, nguồn (chỉ đạo / giao miệng).',
    parameters: { type: 'object', additionalProperties: false, required: ['ma'], properties: {
      ma: { type: 'string', description: 'Mã việc (VD VW-2026-000214 hoặc 214), mã nguồn hN của việc đã thấy, hoặc vài chữ trong tên việc.' },
    } },
  },
  {
    name: 'chuan_bi_giao_viec',
    description: 'CHUẨN BỊ một việc giao nháp trong Vioo Work (không giao): tên việc, người làm, hạn, mức A/B/C, yêu cầu, checklist; rồi hiện thẻ form trong chat để người dùng kiểm và tự bấm Giao. Dùng khi người dùng muốn giao việc / nhờ ai làm gì / tự ghi việc cho mình. Người làm trùng tên thì công cụ trả danh sách để hỏi lại bằng gợi ý bấm.',
    parameters: { type: 'object', additionalProperties: false, required: ['viec'], properties: {
      viec: { type: 'string', description: 'Tên việc ngắn, bắt đầu bằng động từ, không chứa tên người và hạn. VD "Rà soát hồ sơ thanh toán đợt 3 SMB".' },
      nguoi: { type: 'string', description: 'Người làm theo lời người dùng ("Hà", "anh Đô", "tôi"). Bỏ trống khi chưa nói.' },
      han: { type: 'string', description: 'Ngày hạn YYYY-MM-DD tính từ hôm nay ("thứ 6" = thứ 6 gần nhất; "tuần sau" = tuần kế tiếp). Bỏ trống khi chưa nói.' },
      gio: { type: 'string', description: 'Giờ hạn HH:MM nếu người dùng nói (mặc định 17:00).' },
      muc: { type: 'string', enum: ['A', 'B', 'C'], description: 'A = gấp / trọng điểm, B = quan trọng, C = thường. Bỏ trống khi chưa nói.' },
      yeu_cau: { type: 'string', description: 'Yêu cầu / kết quả cần có theo lời người dùng.' },
      checklist: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Các bước con nếu người dùng liệt kê.' },
    } },
  },
];

export const WORK_TOOL_LABEL: Record<string, string> = { viec_giao: 'Việc giao', tom_tat_viec: 'Tóm tắt việc', chuan_bi_giao_viec: 'Chuẩn bị giao việc' };
export const WORK_TOOL_INFO: Record<string, { kind: 'tra_cuu' | 'bieu_do' | 'chuan_bi'; rpcs: string[]; permission: string; result: string; commandKind?: string }> = {
  viec_giao: { kind: 'tra_cuu', rpcs: ['work_assignable_people_v1', 'work_tasks_overview_v1'], permission: 'Việc mình làm / mình giao / theo dõi, việc trong đơn vị mình làm trưởng (sơ đồ tổ chức), BLĐ toàn công ty; việc hạn chế chỉ người liên quan', result: 'Danh sách việc + nút mở việc' },
  tom_tat_viec: { kind: 'tra_cuu', rpcs: ['search_global_v1', 'work_task_brief_v1'], permission: 'Như quyền xem việc ở Vioo Work', result: 'Tóm tắt 2–3 câu + nút mở việc' },
  chuan_bi_giao_viec: { kind: 'chuan_bi', rpcs: ['work_assignable_people_v1', 'assistant_command_create_v1'], permission: 'Vào Vioo Work; giao cho người khác cần quyền giao việc', result: 'Form giao việc trong chat → Giao', commandKind: 'work_task' },
};

const STATE: Record<string, string> = { dang_lam: 'open', qua_han: 'overdue', lau_chua_cap_nhat: 'stale', cho_duyet: 'review', xong_gan_day: 'done_recent', tat_ca: 'all' };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function loadPeople(ctx: ToolContext) {
  const r = await ctx.rpc('work_assignable_people_v1', { p_query: null, p_limit: 200 });
  return r.error ? { error: r.error, ...personRows(null) } : { error: null, ...personRows(r.data) };
}
/** Người theo lời người dùng: đúng một người → userId; nhiều → danh sách để hỏi lại; không thấy → lời báo. */
async function resolvePerson(ctx: ToolContext, phrase: string) {
  const loaded = await loadPeople(ctx);
  if (loaded.error) return { error: failed(loaded.error, 'danh sách người trong Vioo Work') };
  const hits = matchPeople(phrase, loaded.people);
  if (hits.length === 1) return { person: hits[0], canAssignOthers: loaded.canAssignOthers };
  if (hits.length > 1) return { error: JSON.stringify({ trung_ten: hits.slice(0, 6).map(personLabel),
    ghi_chu: `Có ${hits.length} người khớp "${phrase}". Hỏi lại một câu kèm mỗi người một gợi ý bấm đúng như danh sách (họ tên · đơn vị).` }) };
  return { error: JSON.stringify({ loi: `Không thấy "${phrase}" trong danh sách người dùng Vioo Work người hỏi giao / xem được. Nhờ người dùng nói họ tên đầy đủ.` }) };
}

const taskRef = (ctx: ToolContext, t: Record<string, unknown>) => ctx.book.record({ kind: 'work_task', id: t.id, code: t.code, title: t.title,
  subtitle: asArray(t.assignees).map(a => String(asObject(a).name || '')).filter(Boolean).join(', '), status: t.status, date: t.deadlineAt, extra: {} });

async function listTasks(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  let assignee: WorkPersonRow | null = null;
  const nguoi = str(args.nguoi, 80);
  if (nguoi) {
    const found = await resolvePerson(ctx, nguoi);
    if ('error' in found && found.error) return found.error;
    assignee = (found as { person: WorkPersonRow }).person;
  }
  const due = str(args.han_den, 10);
  if (due && !ISO_DAY.test(due)) return JSON.stringify({ loi: 'han_den phải là YYYY-MM-DD.' });
  const r = await ctx.rpc('work_tasks_overview_v1', { p_assignee_user_id: assignee?.userId ?? null, p_unit_query: str(args.don_vi, 80),
    p_state: STATE[String(args.trang_thai || 'dang_lam')] || 'open', p_due_before: due, p_limit: 30 });
  if (r.error) return failed(r.error, 'việc trong Vioo Work');
  const d = asObject(r.data);
  if (d.code === 'UNIT_AMBIGUOUS') return JSON.stringify({ trung_don_vi: asArray(d.units).map(asObject).map(u => `${u.code || ''} · ${u.name || ''}`.trim()),
    ghi_chu: 'Có nhiều đơn vị khớp. Hỏi lại một câu kèm gợi ý bấm đúng mã · tên đơn vị.' });
  if (d.code === 'UNIT_NOT_FOUND') return JSON.stringify({ loi: `Không thấy đơn vị "${args.don_vi}".` });
  const now = Date.now();
  const items = asArray(d.items).map(asObject);
  return JSON.stringify(compact({
    nguoi: assignee ? personLabel(assignee) : null, don_vi: str(asObject(d.unit).name), tong: num(d.total), qua_han: num(d.overdue), lau_chua_cap_nhat: num(d.stale),
    viec: items.slice(0, 20).map(t => {
      const hours = hoursSince(t.lastProgressAt, now);
      return compact({ ref: taskRef(ctx, t), ma: str(t.code), viec: str(t.title, 160), muc: LEVEL_LABEL[String(t.level)] || null,
        trang_thai: STATUS_LABEL[String(t.status)] || str(t.status), tien_do: num(t.progressPercent) != null ? `${t.progressPercent}%` : null,
        han: vnDate(t.deadlineAt), qua_han: t.overdue === true ? true : null,
        cap_nhat: hours == null ? 'chưa cập nhật' : hours < 24 ? `${Math.max(1, Math.round(hours))} giờ trước` : `${Math.floor(hours / 24)} ngày trước`,
        nguoi_lam: asArray(t.assignees).map(a => String(asObject(a).name || '')).filter(Boolean), nguoi_giao: str(t.createdByName), han_che: t.restricted === true ? true : null });
    }),
    con: items.length > 20 ? items.length - 20 : null,
    ghi_chu: items.length ? null : 'Không có việc nào khớp trong phạm vi người hỏi được xem. Không khẳng định là người đó không có việc.',
  }));
}

async function taskBrief(args: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>): Promise<string> {
  const ma = str(args.ma, 80);
  if (!ma) return JSON.stringify({ loi: 'Thiếu mã việc.' });
  let id: string | null = null;
  if (/^h\d{1,3}$/i.test(ma)) {
    const src = ctx.book.find(ma);
    if (src?.type === 'record' && src.record.kind === 'work_task') id = String(src.record.id);
    const hit = refBook.get(ma.toLowerCase());
    if (!id && hit?.kind === 'work_task') id = String(hit.id);
  }
  if (!id) {
    // "214" / "VW 214" → mã năm nay; mã đủ (VW-2025-000010) giữ nguyên; còn lại tìm theo chữ trong tên việc.
    const short = ma.match(/^(?:vw[-\s]?)?(\d{1,6})$/i)?.[1];
    const term = short ? `VW-${vnToday().slice(0, 4)}-${short.padStart(6, '0')}` : ma;
    const terms = fold(term).replace(/[^a-z0-9./-]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).map(t => [t.slice(0, 60)]);
    const r = await ctx.rpc('search_global_v1', { p_terms: terms, p_kinds: ['work_task'], p_limit: 5 });
    if (r.error) return failed(r.error, 'việc');
    const records = asArray(asObject(r.data).records).map(asObject);
    const exact = records.find(x => fold(x.code).replace(/[^a-z0-9]/g, '') === fold(term).replace(/[^a-z0-9]/g, '')) || records[0];
    if (!exact) return JSON.stringify({ loi: `Không thấy việc "${ma}" trong phạm vi người hỏi được xem.` });
    id = String(exact.id);
  }
  const b = await ctx.rpc('work_task_brief_v1', { p_task_id: id });
  if (b.error) return failed(b.error, 'việc');
  const d = asObject(b.data); const t = asObject(d.task);
  const status = String(t.status || '');
  const progress = num(t.progressPercent) ?? 0;
  const origin = asObject(d.origin);
  return JSON.stringify(compact({
    ref: taskRef(ctx, { ...t, assignees: d.assignees }), ma: str(t.code), viec: str(t.title, 200), muc: LEVEL_LABEL[String(t.level)] || null,
    trang_thai: STATUS_LABEL[status] || status, tien_do: `${progress}%`, han: vnDate(t.deadlineAt),
    danh_gia_han: ACTIVE.has(status) || status === 'completed' ? dueAssessment({ status, deadlineAt: str(t.deadlineAt, 40), createdAt: str(t.createdAt, 40), progressPercent: progress }) : null,
    nguoi_giao: str(asObject(t.createdBy).name), nguoi_duyet: str(asObject(t.reviewer).name),
    nguoi_lam: asArray(d.assignees).map(asObject).map(a => `${a.name}${a.acknowledgedAt ? '' : ' (chưa nhận việc)'}`),
    checklist: num(asObject(d.checklist).total) ? `${asObject(d.checklist).done}/${asObject(d.checklist).total} mục xong` : null,
    viec_con: num(asObject(d.children).total) ? `${asObject(d.children).open} chưa xong / ${asObject(d.children).total}` : null,
    nguon: origin.origin === 'directive' ? `Chỉ đạo${str(asObject(origin.meeting).title) ? ` · ${str(asObject(origin.meeting).title)}` : ''}`
      : origin.origin === 'oral_claim' ? `Giao trực tiếp · ${origin.claimStatus === 'confirmed' ? 'đã xác nhận' : origin.claimStatus === 'rejected' ? 'người giao không nhận' : 'chờ người giao xác nhận'}` : null,
    cap_nhat_gan_day: asArray(d.updates).slice(0, 3).map(asObject).map(u => compact({ luc: vnDate(u.at), nguoi: str(u.author), da: str(u.done, 300), dang: str(u.doing, 300),
      se: str(u.next, 300), vuong: str(u.blocked, 300), tien_do: `${u.progressBefore}% → ${u.progressAfter}%` })),
    ghi_chu: 'Tóm tắt 2–3 câu: đang ở đâu, vướng gì, kịp hạn theo đúng danh_gia_han. Dẫn [[hN]] để mở việc.',
  }));
}

async function prepareTask(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  const title = (str(args.viec, 300) || '').replace(/\s+/g, ' ');
  if (title.length < 3) return JSON.stringify({ loi: 'Chưa rõ việc cần giao. Hỏi lại người dùng một câu.' });
  const han = str(args.han, 10);
  if (han && (!ISO_DAY.test(han) || han < vnToday())) return JSON.stringify({ loi: 'Hạn chưa đúng (YYYY-MM-DD, không trước hôm nay). Hỏi lại người dùng.' });
  const gio = str(args.gio, 5);
  const time = gio && /^([01]\d|2[0-3]):[0-5]\d$/.test(gio) ? gio : '17:00';
  const level = args.muc === 'A' || args.muc === 'B' || args.muc === 'C' ? args.muc : null;
  let person: WorkPersonRow | null = null; let canAssignOthers = false;
  const nguoi = str(args.nguoi, 80);
  if (nguoi) {
    const found = await resolvePerson(ctx, nguoi);
    if ('error' in found && found.error) return found.error;
    person = (found as { person: WorkPersonRow }).person; canAssignOthers = (found as { canAssignOthers: boolean }).canAssignOthers;
    if (!person.isMe && !canAssignOthers) return JSON.stringify({ loi: 'Người hỏi chưa có quyền giao việc cho người khác ở Vioo Work — chỉ tự ghi việc cho mình được. Nói rõ vậy.' });
    if (!person.isMe && !person.canReceive) return JSON.stringify({ loi: `${person.name} chưa nhận được việc ở Vioo Work (chưa có quyền). Nói rõ vậy.` });
  }
  const checklist = asArray(args.checklist).map(x => str(x, 200)).filter((x): x is string => Boolean(x)).slice(0, 20);
  const payload = compact({ title: title.slice(0, 200), assigneeUserId: person?.userId ?? null, assigneeName: person ? (person.isMe ? 'Tôi' : person.name) : null,
    assigneeUnit: person?.unit ?? null, assigneeIsMe: person?.isMe === true ? true : null, deadlineDate: han, deadlineTime: han ? time : null, level,
    description: str(args.yeu_cau, 2000), checklist, runId: ctx.runId });
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'work_task', p_title: `Giao việc: ${title}`.slice(0, 160), p_payload: payload, p_preview: {} });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  const missing = [!person && 'người làm', !han && 'hạn', !level && 'mức A/B/C'].filter(Boolean);
  return JSON.stringify(compact({ da_hien_the: true, nguoi_lam: person ? personLabel(person) : null, han: han ? `${han} ${time}` : null, muc: level ? LEVEL_LABEL[level] : null,
    con_thieu: missing.length ? missing.join(', ') : null,
    ghi_chu: 'Thẻ giao việc nháp đã hiện trong chat: người dùng kiểm người làm, hạn, mức rồi tự bấm Giao. Nói 1–2 câu, nêu phần còn thiếu để chọn trên thẻ. Không nói là đã giao.' }));
}

export async function runWorkTool(name: string, args: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>): Promise<string | null> {
  if (name === 'viec_giao') return listTasks(args, ctx);
  if (name === 'tom_tat_viec') return taskBrief(args, ctx, refBook);
  if (name === 'chuan_bi_giao_viec') return prepareTask(args, ctx);
  return null;
}
