// Vioo Work · Đợt 1 PR-3 (chủ SP 20/10/2026): công cụ Trợ lý cho giao việc. Đọc bằng JWT người hỏi — RPC Work tự kiểm quyền
// (người làm, người giao, trưởng đơn vị theo sơ đồ tổ chức, BLĐ xem toàn công ty; việc "hạn chế" chỉ người liên quan).
//   viec_giao           work_assignable_people_v1 (khớp tên) → work_tasks_overview_v1 (việc theo người / đơn vị / trạng thái)
//   tom_tat_viec        search_global_v1 (công việc) → work_task_brief_v1
//   chuan_bi_giao_viec  work_assignable_people_v1 → lệnh nháp work_task (thẻ form giao việc; người dùng bấm Giao)
//   tre_han_theo_don_vi (Đợt 2 PR-7) work_company_board_v1 (BLĐ) → bị chặn thì work_board_access_v1 + work_team_board_v1 (đơn vị mình làm trưởng);
//                       có don_vi: work_tasks_overview_v1 (khớp đơn vị) → work_team_board_v1. Thẻ biểu đồ không đúng hạn / quá hạn / % đúng hạn theo kỳ.
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
  {
    name: 'tre_han_theo_don_vi',
    description: 'TRỄ HẠN / ĐÚNG HẠN theo kỳ trong Vioo Work và HIỆN THẺ BIỂU ĐỒ trong chat: không có don_vi = từng phòng / đơn vị toàn công ty (BLĐ; trưởng đơn vị thì tự xem đơn vị mình); có don_vi = từng người trong đơn vị đó. Mỗi dòng: số việc không đúng hạn trong kỳ, số việc đang quá hạn, % đúng hạn, so với kỳ trước. Dùng khi hỏi "phòng nào trễ nhiều nhất", "ai trễ hạn nhiều nhất", "tỷ lệ đúng hạn tuần trước / tháng này / quý này". Máy chủ kiểm quyền và báo nếu ngoài quyền.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      ky: { type: 'string', enum: ['tuan_nay', 'tuan_truoc', 'thang_nay', 'thang_truoc', 'quy_nay', 'quy_truoc'], description: 'Kỳ theo lời người dùng. Mặc định tuan_truoc.' },
      tu_ngay: { type: 'string', description: 'Chỉ khi người dùng nói khoảng ngày cụ thể: ngày đầu YYYY-MM-DD (khi có thì bỏ qua ky).' },
      den_ngay: { type: 'string', description: 'Ngày cuối YYYY-MM-DD đi cùng tu_ngay (bỏ trống = hôm nay).' },
      don_vi: { type: 'string', description: 'Mã hoặc tên phòng / đơn vị khi hỏi theo từng người trong một đơn vị (VD "QLDA"). Bỏ trống = so các đơn vị.' },
    } },
  },
];

export const WORK_TOOL_LABEL: Record<string, string> = { viec_giao: 'Việc giao', tom_tat_viec: 'Tóm tắt việc', chuan_bi_giao_viec: 'Chuẩn bị giao việc', tre_han_theo_don_vi: 'Trễ hạn theo đơn vị' };
export const WORK_TOOL_INFO: Record<string, { kind: 'tra_cuu' | 'bieu_do' | 'chuan_bi'; rpcs: string[]; permission: string; result: string; commandKind?: string }> = {
  viec_giao: { kind: 'tra_cuu', rpcs: ['work_assignable_people_v1', 'work_tasks_overview_v1'], permission: 'Việc mình làm / mình giao / theo dõi, việc trong đơn vị mình làm trưởng (sơ đồ tổ chức), BLĐ toàn công ty; việc hạn chế chỉ người liên quan', result: 'Danh sách việc + nút mở việc' },
  tom_tat_viec: { kind: 'tra_cuu', rpcs: ['search_global_v1', 'work_task_brief_v1'], permission: 'Như quyền xem việc ở Vioo Work', result: 'Tóm tắt 2–3 câu + nút mở việc' },
  chuan_bi_giao_viec: { kind: 'chuan_bi', rpcs: ['work_assignable_people_v1', 'assistant_command_create_v1'], permission: 'Vào Vioo Work; giao cho người khác cần quyền giao việc', result: 'Form giao việc trong chat → Giao', commandKind: 'work_task' },
  tre_han_theo_don_vi: { kind: 'bieu_do', rpcs: ['work_company_board_v1', 'work_board_access_v1', 'work_team_board_v1', 'work_tasks_overview_v1'],
    permission: 'Toàn công ty: BLĐ (xem toàn công ty); từng người một đơn vị: trưởng đơn vị đó (sơ đồ tổ chức) hoặc BLĐ; nhân viên: ngoài phạm vi', result: 'Thẻ biểu đồ: ô số đúng hạn / không đúng hạn / quá hạn, cột chồng theo đơn vị hoặc người, % đúng hạn, nút mở bảng' },
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

// ── tre_han_theo_don_vi (Đợt 2 PR-7): kỳ theo giờ VN, cùng quy ước lib/work/workPeriod.ts (kỳ đang chạy chỉ tính đến hôm nay; kỳ trước = tuần /
//    tháng / quý liền trước, khoảng ngày tùy chọn thì cùng số ngày liền trước). Số do bảng Phòng tôi / Toàn công ty tính; AI chỉ nói lại.
export type LateKy = 'tuan_nay' | 'tuan_truoc' | 'thang_nay' | 'thang_truoc' | 'quy_nay' | 'quy_truoc';
const LATE_KY: LateKy[] = ['tuan_nay', 'tuan_truoc', 'thang_nay', 'thang_truoc', 'quy_nay', 'quy_truoc'];
const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * DAY).toISOString().slice(0, 10);
const spanDays = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY);
const isDay = (d: string | null): d is string => Boolean(d && ISO_DAY.test(d) && !Number.isNaN(dayMs(d)) && new Date(dayMs(d)).toISOString().startsWith(d));
const mondayOf = (d: string) => addDays(d, -((new Date(dayMs(d)).getUTCDay() + 6) % 7));
const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const monthEnd = (d: string) => addDays(monthStart(addDays(monthStart(d), 32)), -1);
const quarterStart = (d: string) => `${d.slice(0, 5)}${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
const quarterEnd = (d: string) => addDays(quarterStart(addDays(quarterStart(d), 100)), -1);
const quarterOf = (d: string) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const isoWeekOf = (day: string) => {
  const d = new Date(dayMs(day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
};

/** Kỳ gửi máy chủ: from / to (đã cắt đến hôm nay) + kỳ trước; nhãn như màn Vioo Work ("Tuần 42 · 12–18/10", "Tháng 10/2026", "Quý 4/2026"). */
export interface LatePeriod { from: string; to: string; fullTo: string; prevFrom: string; prevTo: string; label: string; prevLabel: string; running: boolean }
export function latePeriod(args: Record<string, unknown>, today: string): LatePeriod | { loi: string } {
  const tu = str(args.tu_ngay, 10); const den = str(args.den_ngay, 10);
  const done = (from: string, fullTo: string, prevFrom: string, prevTo: string, label: string, prevLabel: string): LatePeriod =>
    ({ from, to: fullTo > today ? today : fullTo, fullTo, prevFrom, prevTo, label, prevLabel, running: fullTo > today });
  if (tu || den) {
    if (!isDay(tu) || (den != null && !isDay(den))) return { loi: 'tu_ngay / den_ngay phải là YYYY-MM-DD (có tu_ngay). Hỏi lại người dùng khoảng ngày.' };
    const end = den ?? (tu > today ? tu : today);
    let a = end < tu ? end : tu; let b = end < tu ? tu : end;
    if (a > today) return { loi: 'Khoảng ngày ở tương lai — chưa có số. Nói rõ với người dùng.' };
    if (b > today) b = today;
    if (spanDays(a, b) > 400) a = addDays(b, -400);
    const len = spanDays(a, b);
    const label = a === b ? ddmm(a) : `${ddmm(a)} – ${ddmm(b)}${a.slice(0, 4) !== b.slice(0, 4) ? `/${b.slice(0, 4)}` : ''}`;
    return done(a, b, addDays(a, -len - 1), addDays(a, -1), label, 'kỳ trước');
  }
  const ky = LATE_KY.includes(args.ky as LateKy) ? args.ky as LateKy : 'tuan_truoc';
  if (ky === 'tuan_nay' || ky === 'tuan_truoc') {
    const from = ky === 'tuan_nay' ? mondayOf(today) : addDays(mondayOf(today), -7);
    const to = addDays(from, 6); const pf = addDays(from, -7);
    return done(from, to, pf, addDays(from, -1), `Tuần ${isoWeekOf(from)} · ${from.slice(8, 10)}–${ddmm(to)}`, `tuần ${isoWeekOf(pf)}`);
  }
  if (ky === 'thang_nay' || ky === 'thang_truoc') {
    const from = ky === 'thang_nay' ? monthStart(today) : monthStart(addDays(monthStart(today), -1));
    const pt = addDays(from, -1); const pf = monthStart(pt);
    return done(from, monthEnd(from), pf, pt, `Tháng ${Number(from.slice(5, 7))}/${from.slice(0, 4)}`, `tháng ${Number(pf.slice(5, 7))}`);
  }
  const from = ky === 'quy_nay' ? quarterStart(today) : quarterStart(addDays(quarterStart(today), -1));
  const pt = addDays(from, -1); const pf = quarterStart(pt);
  return done(from, quarterEnd(from), pf, pt, `Quý ${quarterOf(from)}/${from.slice(0, 4)}`, `quý ${quarterOf(pf)}`);
}

interface LateRow { id: string; name: string; due: number; ontime: number; late: number; overdue: number; rate: number | null; prevDue: number | null; prevOntime: number | null }
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : null);
const lateRows = (items: unknown[], kind: 'unit' | 'person'): LateRow[] => items.map(asObject).map(x => {
  const due = num(x.due) ?? 0; const ontime = Math.min(num(x.ontime) ?? 0, due);
  const name = (kind === 'unit' ? str(x.code, 40) || str(x.name, 40) : str(x.name, 40)) || 'Chưa đặt tên';
  return { id: String((kind === 'unit' ? x.id : x.userId) ?? ''), name, due, ontime, late: due - ontime, overdue: num(x.overdue) ?? 0,
    rate: pct(ontime, due), prevDue: num(x.prevDue), prevOntime: num(x.prevOntime) };
});
const badness = (r: LateRow) => r.late + r.overdue;

/** Số bảng Phòng tôi / Toàn công ty → thẻ biểu đồ dùng chung (lib/assistantChart.ts) + số gọn cho model. Chưa có việc đến hạn thì % là null, không ghi 0. */
export const lateChart = (raw: unknown, scope: { unit: { id: string; code: string | null; name: string } | null; own?: boolean }, p: LatePeriod, today: string) => {
  const d = asObject(raw);
  const byPerson = scope.unit != null;
  const what = byPerson ? 'người' : 'đơn vị';
  const rows = lateRows(asArray(byPerson ? d.members : d.units), byPerson ? 'person' : 'unit');
  const sum = (f: (r: LateRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const due = sum(r => r.due); const ontime = sum(r => r.ontime); const overdue = sum(r => r.overdue);
  const withPrev = rows.filter(r => r.prevDue != null);
  const prevDue = withPrev.reduce((s, r) => s + (r.prevDue ?? 0), 0);
  const prevRate = withPrev.length ? pct(withPrev.reduce((s, r) => s + Math.min(r.prevOntime ?? 0, r.prevDue ?? 0), 0), prevDue) : null;
  const rate = pct(ontime, due);
  const drawable = rows.filter(r => r.due > 0 || r.overdue > 0)
    .sort((a, b) => badness(b) - badness(a) || b.overdue - a.overdue || b.due - a.due || a.name.localeCompare(b.name, 'vi'));
  const shown = drawable.slice(0, 12);
  const worst = shown[0] && badness(shown[0]) > 0 ? shown[0] : null;
  const scopeName = scope.unit ? scope.unit.name : 'Toàn công ty';
  const forModel = compact({
    pham_vi: scopeName, theo: byPerson ? 'từng người trong đơn vị' : 'từng đơn vị', ky: p.label, khoang: `${p.from} → ${p.to}${p.running ? ' (kỳ đang chạy, tính đến hôm nay)' : ''}`,
    viec_den_han: due, dung_han: rate == null ? 'chưa có việc đến hạn' : `${rate}%`,
    ky_truoc: prevRate == null ? `${p.prevLabel}: chưa có việc đến hạn` : `${p.prevLabel}: ${prevRate}%`,
    khong_dung_han: due - ontime, dang_qua_han: overdue,
    tre_nhieu_nhat: worst ? `${worst.name}: ${worst.late} không đúng hạn, ${worst.overdue} đang quá hạn` : `không có ${what} nào trễ`,
    xep_hang: shown.slice(0, 5).map(r => compact({ ten: r.name, den_han: r.due, khong_dung_han: r.late, dang_qua_han: r.overdue, dung_han: r.rate == null ? 'chưa có việc đến hạn' : `${r.rate}%` })),
    chua_co_viec_den_han: rows.length - drawable.length || null,
  });
  if (!shown.length) return { chart: null, forModel };
  const hidden = rows.length - drawable.length;
  const notes = [
    ...(p.running ? [`Kỳ đang chạy: số tính đến ${ddmm(today)}.`] : []),
    ...(hidden > 0 ? [`${hidden} ${what} chưa có việc đến hạn, không có việc quá hạn — không vẽ.`] : []),
    ...(drawable.length > shown.length ? [`Còn ${drawable.length - shown.length} ${what} ít trễ hơn không vẽ — mở bảng để xem đủ.`] : []),
    'Đang quá hạn = việc đang mở đã quá hạn tính đến hôm nay (kể cả hạn trước kỳ); một việc có thể ở cả hai cột.',
  ].slice(0, 4);
  const diff = rate != null && prevRate != null ? rate - prevRate : null;
  const labels = shown.map(r => r.name);
  const range = `from=${p.from}&to=${p.fullTo}`;
  const chart = {
    v: 1,
    title: byPerson ? `Trễ hạn theo người · ${scope.unit!.code || scope.unit!.name} · ${p.label}` : `Trễ hạn theo đơn vị · ${p.label}`,
    stats: [
      { label: 'Đúng hạn %', value: rate, hint: rate == null ? 'chưa có việc đến hạn' : prevRate == null ? `${p.prevLabel}: chưa có việc đến hạn`
        : `${p.prevLabel}: ${prevRate}% (${diff! > 0 ? '+' : diff! < 0 ? '−' : '±'}${Math.abs(diff!)} điểm)` },
      { label: 'Không đúng hạn', value: due - ontime, hint: `trên ${due} việc đến hạn` },
      { label: 'Đang quá hạn', value: overdue, hint: 'việc đang mở, tính đến hôm nay' },
      { label: 'Trễ nhiều nhất', value: worst ? badness(worst) : 0, hint: worst ? worst.name : `không có ${what} nào trễ` },
    ],
    labels: labels.map(l => l.slice(0, 16)),
    panels: [
      { title: 'Không đúng hạn và đang quá hạn', kind: 'stacked', unit: 'việc', labels,
        series: [{ label: 'Không đúng hạn trong kỳ', values: shown.map(r => r.late) }, { label: 'Đang quá hạn', values: shown.map(r => r.overdue) }] },
      { title: 'Tỷ lệ đúng hạn', kind: 'bar', unit: '%', labels, series: [{ label: 'Đúng hạn', values: shown.map(r => r.rate) }] },
    ],
    notes,
    source: `Vioo Work · ${p.label}${scope.unit ? ` · ${scope.unit.name}` : ''}`,
    link: scope.unit ? { route: `/work/my?space=team&unit=${encodeURIComponent(scope.unit.id)}&${range}`, label: scope.own ? 'Phòng tôi' : (scope.unit.code || scope.unit.name).slice(0, 40) }
      : { route: `/work/my?space=company&${range}`, label: 'Toàn công ty' },
  };
  return { chart, forModel };
};

const unitOf = (raw: unknown) => { const u = asObject(raw); return typeof u.id === 'string' ? { id: u.id, code: str(u.code, 40), name: str(u.name, 120) || str(u.code, 40) || 'Đơn vị' } : null; };

async function lateByUnit(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const today = vnToday();
  const p = latePeriod(args, today);
  if ('loi' in p) return JSON.stringify(p);
  const period = { p_from: p.from, p_to: p.to, p_prev_from: p.prevFrom, p_prev_to: p.prevTo };
  let raw: unknown; let unit: ReturnType<typeof unitOf> = null; let own = false; let otherUnits: string[] = [];
  const donVi = str(args.don_vi, 80);
  if (donVi) {
    const found = await ctx.rpc('work_tasks_overview_v1', { p_assignee_user_id: null, p_unit_query: donVi, p_state: 'open', p_due_before: null, p_limit: 1 });
    if (found.error) return failed(found.error, 'Vioo Work');
    const f = asObject(found.data);
    if (f.code === 'UNIT_AMBIGUOUS') return JSON.stringify({ trung_don_vi: asArray(f.units).map(asObject).map(u => `${u.code || ''} · ${u.name || ''}`.trim()),
      ghi_chu: 'Có nhiều đơn vị khớp. Hỏi lại một câu kèm gợi ý bấm đúng mã · tên đơn vị.' });
    unit = unitOf(f.unit);
    if (f.code === 'UNIT_NOT_FOUND' || !unit) return JSON.stringify({ loi: `Không thấy đơn vị "${donVi}".` });
    const r = await ctx.rpc('work_team_board_v1', { p_org_unit_id: unit.id, p_week_start: null, ...period });
    if (r.error) return denied(r.error) ? OUT_OF_SCOPE(`số đúng hạn từng người của ${unit.name} (chỉ trưởng đơn vị đó hoặc BLĐ)`) : failed(r.error, 'bảng đơn vị');
    raw = r.data;
  } else {
    const company = await ctx.rpc('work_company_board_v1', { p_week_start: null, ...period });
    if (!company.error) raw = company.data;
    else if (!denied(company.error)) return failed(company.error, 'bảng toàn công ty');
    else {
      // Không phải BLĐ: trưởng đơn vị thì xem từng người đơn vị mình làm trưởng (sơ đồ tổ chức); nhân viên thì ngoài phạm vi.
      const access = await ctx.rpc('work_board_access_v1', {});
      if (access.error) return failed(access.error, 'Vioo Work');
      const mine = asArray(asObject(access.data).myUnits).map(unitOf).filter((u): u is NonNullable<typeof u> => u != null);
      if (!mine.length) return OUT_OF_SCOPE('số trễ hạn theo đơn vị (toàn công ty chỉ BLĐ xem; từng người trong đơn vị chỉ trưởng đơn vị xem)');
      unit = mine[0]; own = true; otherUnits = mine.slice(1).map(u => u.code || u.name);
      const r = await ctx.rpc('work_team_board_v1', { p_org_unit_id: unit.id, p_week_start: null, ...period });
      if (r.error) return failed(r.error, 'bảng đơn vị');
      raw = r.data;
    }
  }
  const built = lateChart(raw, { unit, own }, p, today);
  const ref = built.chart ? ctx.book.chart(built.chart) : null;
  if (ref) ctx.emit?.({ type: 'chart', chart: { ref, type: 'chart', chart: built.chart } });
  return JSON.stringify(compact({ ...built.forModel, da_hien_bieu_do: Boolean(ref),
    pham_vi_xem: own ? `Người hỏi không xem được toàn công ty — đây là đơn vị người hỏi làm trưởng${otherUnits.length ? `; còn ${otherUnits.join(', ')} (hỏi theo don_vi)` : ''}. Nói rõ vậy.` : null,
    ghi_chu: ref
      ? `Thẻ biểu đồ (không đúng hạn + đang quá hạn theo ${unit ? 'người' : 'đơn vị'}, % đúng hạn) đã hiện ngay trong chat. Trả lời 2–3 câu: ai / đơn vị nào trễ nhiều nhất (tre_nhieu_nhat), tỷ lệ đúng hạn so với kỳ trước. Dùng đúng số công cụ trả, không tự cộng, không liệt kê lại từng dòng, không vẽ bảng.`
      : 'Kỳ này chưa có việc nào đến hạn và không có việc đang quá hạn trong phạm vi người hỏi xem — chưa vẽ biểu đồ. Nói rõ vậy, không ghi 0%.' }));
}

export async function runWorkTool(name: string, args: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>): Promise<string | null> {
  if (name === 'viec_giao') return listTasks(args, ctx);
  if (name === 'tom_tat_viec') return taskBrief(args, ctx, refBook);
  if (name === 'chuan_bi_giao_viec') return prepareTask(args, ctx);
  if (name === 'tre_han_theo_don_vi') return lateByUnit(args, ctx);
  return null;
}
