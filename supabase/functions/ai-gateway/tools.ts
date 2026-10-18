// Trợ lý v2 · T1: công cụ ĐỌC của Trợ lý (chủ SP 18/10/2026). Mỗi công cụ gọi lệnh máy chủ sẵn có bằng JWT người hỏi —
// RLS / kiểm quyền của module quyết định thấy gì; AI không bao giờ thấy nhiều hơn người hỏi. Không có công cụ ghi nghiệp vụ:
// công cụ chuan_bi_… (T2) chỉ ghi lệnh nháp + hiện thẻ, người dùng tự bấm gửi ở thẻ / form của module.
//   tim_ho_so          search_global_v1 (20 loại hồ sơ, như ô Tìm kiếm)
//   ton_kho            search_global_v1 (vật tư) → ai_stock_by_items_v1 (tồn theo kho người hỏi xem được)
//   chi_tiet_don_mua   get_procurement_order_v1 + get_procurement_po_payment_status_v1
//   chi_tiet_de_xuat   get_material_request_supply_v1 (đề xuất vật tư: đã đặt / đã nhận / còn thiếu)
//   viec_cua_toi       vcc_my_work_items_v1 (chờ tôi / tôi gửi / tôi theo dõi)
//   chuan_bi_don_nghi_phep   preview_my_leave_request → lệnh nháp leave_request (thẻ Gửi đơn)
//   chuan_bi_de_xuat_vat_tu  assistant_mr_projects_v1 → lệnh nháp material_request (thẻ mở form Đề xuất, Gõ nhanh điền sẵn)
// Kết quả gửi AI là JSON gọn (đã che SĐT / CCCD / STK ở cổng); mỗi hồ sơ có mã h1, h2… để AI dẫn nguồn.
// Tệp này không dùng API Deno để vitest kiểm thử được (lệnh máy chủ truyền vào qua `rpc`).
import type { SourceBook, ToolSpec } from './agent.ts';

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
/** runId + emit: công cụ CHUẨN BỊ (lệnh nháp) ghi dòng lệnh vào lượt AI và hiện thẻ cho người dùng (T2a).
 *  projectId: dự án đang xem ở Trung tâm — chỉ để xếp lên đầu khi hỏi lại; không tự ghép khi người dùng chưa nói dự án (chủ SP 18/10). */
export interface ToolContext { rpc: Rpc; book: SourceBook; runId?: string; emit?: (event: Record<string, unknown>) => void; projectId?: string | null }

export const KIND_LABEL: Record<string, string> = {
  project: 'Dự án', employee: 'Nhân viên', item: 'Vật tư', wms_tx: 'Phiếu kho', material_code: 'Đề xuất cấp mã', purchase_order: 'Đơn hàng',
  material_request: 'Đề xuất vật tư', rq: 'Phiếu yêu cầu', wf: 'Phiếu quy trình', partner: 'Đối tác', customer_contract: 'HĐ nhận thầu',
  subcontract: 'HĐ thầu phụ', supplier_contract: 'HĐ nhà cung cấp', payment_request: 'Đề nghị chi', asset: 'Tài sản', office_doc: 'Văn bản',
  vehicle_booking: 'Đặt xe', work_task: 'Công việc', feedback: 'Góp ý', leave: 'Đơn nghỉ phép',
};
const KINDS = Object.keys(KIND_LABEL);

export const TOOL_LABEL: Record<string, string> = {
  tim_ho_so: 'Tìm hồ sơ', ton_kho: 'Tồn kho', chi_tiet_don_mua: 'Chi tiết đơn mua', chi_tiet_de_xuat: 'Chi tiết đề xuất vật tư', viec_cua_toi: 'Việc của tôi',
  chuan_bi_don_nghi_phep: 'Chuẩn bị đơn nghỉ phép', chuan_bi_de_xuat_vat_tu: 'Chuẩn bị đề xuất vật tư',
};

export const TOOLS: ToolSpec[] = [
  {
    name: 'tim_ho_so',
    description: 'Tìm hồ sơ theo chữ (mã, tên, nội dung) trong phạm vi người hỏi được xem: dự án, đơn hàng PO, đề xuất vật tư, phiếu kho, vật tư, đối tác/NCC, hợp đồng, phiếu yêu cầu, phiếu quy trình, đề nghị chi, văn bản, công việc, nhân viên, tài sản, đặt xe, nghỉ phép. Trả tối đa 8 hồ sơ, mỗi hồ sơ có mã nguồn hN.',
    parameters: { type: 'object', additionalProperties: false, required: ['tu_khoa'], properties: {
      tu_khoa: { type: 'string', description: 'Chữ cần tìm, ngắn: mã chứng từ (PO-646, MR-2026-2688), tên vật tư, tên NCC, tên dự án…' },
      loai: { type: 'array', items: { type: 'string', enum: KINDS }, description: 'Chỉ tìm các loại này (bỏ trống = mọi loại).' },
    } },
  },
  {
    name: 'ton_kho',
    description: 'Tồn kho hiện tại của vật tư theo từng kho người hỏi được xem (số lượng, đơn vị). Tìm vật tư theo tên hoặc mã.',
    parameters: { type: 'object', additionalProperties: false, required: ['vat_tu'], properties: {
      vat_tu: { type: 'string', description: 'Tên hoặc mã vật tư, VD "thép D16", "xi măng PCB40".' },
    } },
  },
  {
    name: 'chi_tiet_don_mua',
    description: 'Chi tiết một đơn hàng PO: NCC, dự án, kho nhận, trạng thái, ngày hẹn giao, các dòng hàng (đặt / đã nhận / còn phải giao, đơn giá), tổng tiền, tình hình thanh toán.',
    parameters: { type: 'object', additionalProperties: false, required: ['ma'], properties: {
      ma: { type: 'string', description: 'Số PO (VD PO-646) hoặc mã nguồn hN của đơn hàng đã tìm.' },
    } },
  },
  {
    name: 'chi_tiet_de_xuat',
    description: 'Chi tiết cung ứng của một đề xuất vật tư dự án: từng dòng cần bao nhiêu, đã đặt mua / điều chuyển bao nhiêu, đã nhận bao nhiêu, PO nào.',
    parameters: { type: 'object', additionalProperties: false, required: ['ma'], properties: {
      ma: { type: 'string', description: 'Mã đề xuất (VD MR-2026-2688) hoặc mã nguồn hN của đề xuất đã tìm.' },
    } },
  },
  {
    name: 'viec_cua_toi',
    description: 'Danh sách việc của người hỏi: "cho_toi" (việc chờ tôi xử lý), "toi_gui" (hồ sơ tôi gửi đang chờ người khác), "theo_doi" (hồ sơ tôi theo dõi).',
    parameters: { type: 'object', additionalProperties: false, required: ['nhom'], properties: {
      nhom: { type: 'string', enum: ['cho_toi', 'toi_gui', 'theo_doi'] },
      tu_khoa: { type: 'string', description: 'Lọc theo chữ trong mã / tiêu đề (không bắt buộc).' },
    } },
  },
  // T2a — lệnh nháp: chỉ CHUẨN BỊ và hiện thẻ; người dùng tự bấm Gửi đơn (màn hình gọi lệnh gửi của module).
  {
    name: 'chuan_bi_don_nghi_phep',
    description: 'CHUẨN BỊ đơn nghỉ phép nháp cho chính người hỏi (không gửi): kiểm tra số ngày, người duyệt, phép còn, vấn đề; rồi hiện thẻ để người dùng xem và tự bấm Gửi đơn. Dùng khi người dùng muốn xin nghỉ; chưa rõ loại thì gọi với loai bỏ trống để lấy danh sách loại thật (đưa thành gợi ý bấm), thiếu ngày / lý do thì công cụ báo để hỏi lại.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      loai: { type: 'string', description: 'Loại nghỉ theo lời người dùng, VD "phép năm", "nghỉ ốm", "việc riêng không lương".' },
      tu_ngay: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD.' },
      den_ngay: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD (bỏ trống = nghỉ trong một ngày).' },
      buoi_bat_dau: { type: 'string', enum: ['ca_ngay', 'sang', 'chieu'], description: 'Ngày đầu nghỉ cả ngày / buổi sáng / buổi chiều.' },
      buoi_ket_thuc: { type: 'string', enum: ['ca_ngay', 'sang', 'chieu'], description: 'Ngày cuối nghỉ cả ngày / buổi sáng / buổi chiều.' },
      ly_do: { type: 'string', description: 'Lý do nghỉ (ít nhất 3 ký tự), theo lời người dùng.' },
    } },
  },
  // T2b — đề xuất vật tư: tách câu thành dòng + chọn dự án; thẻ mở form Đề xuất thật (Gõ nhanh điền sẵn), người dùng khớp mã và tự gửi.
  {
    name: 'chuan_bi_de_xuat_vat_tu',
    description: 'CHUẨN BỊ phiếu đề xuất vật tư nháp cho dự án (không gửi): tách lời người dùng thành từng dòng vật tư rồi hiện thẻ; người dùng bấm "Mở form đề xuất" để khớp mã, kiểm và tự gửi. Dùng khi người dùng muốn đề xuất / xin / cần vật tư cho công trường và đã nói ít nhất một vật tư.',
    parameters: { type: 'object', additionalProperties: false, required: ['dong'], properties: {
      du_an: { type: 'string', description: 'Mã hoặc tên dự án theo lời người dùng; chưa nói thì bỏ trống — công cụ trả danh sách dự án để hỏi lại.' },
      ten_de_xuat: { type: 'string', description: 'Tên phiếu ngắn, VD "Vật tư đổ bê tông sàn tầng 4" (bỏ trống thì lấy theo mục đích).' },
      muc_dich: { type: 'string', description: 'Dùng cho việc gì / hạng mục nào, theo lời người dùng.' },
      ngay_can: { type: 'string', description: 'Ngày cần vật tư YYYY-MM-DD (nếu người dùng nói).' },
      dong: { type: 'array', minItems: 1, maxItems: 30, description: 'Mỗi vật tư một dòng, giữ nguyên cách gọi của người dùng.', items: {
        type: 'object', additionalProperties: false, required: ['ten'], properties: {
          ten: { type: 'string', description: 'Tên vật tư, VD "xi măng PCB40", "thép D16".' },
          quy_cach: { type: 'string', description: 'Quy cách / kích thước nếu có, VD "dày 0.45mm", "D110 C1".' },
          so_luong: { type: 'number', description: 'Số lượng (bỏ trống nếu người dùng chưa nói).' },
          don_vi: { type: 'string', description: 'Đơn vị theo lời người dùng: bao, tấn, cây, m, m3, cái…' },
          ghi_chu: { type: 'string', description: 'Ghi chú riêng của dòng (dùng cho khu nào, tổ nào…).' },
        } } },
    } },
  },
];

// ── tiện ích ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const asObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {});
const asArray = (raw: unknown): unknown[] => (Array.isArray(raw) ? raw : []);
const str = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : null);
const num = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
const round = (v: unknown, digits = 3) => { const n = num(v); return n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits; };
const day = (v: unknown) => { const s = str(v, 40); return s ? s.slice(0, 10) : null; };
/** Bỏ khóa null / rỗng cho gọn token. */
const compact = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))) as Partial<T>;

/** "Thép D16 – PCB40" → [["thep"],["d16"],["pcb40"]]: bỏ dấu, chỉ chữ + số + . / -, tối đa 6 cụm (như ô Tìm kiếm). */
export const searchTerms = (text: string): string[][] =>
  String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
    .replace(/[^a-z0-9./-]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).map(t => [t.slice(0, 60)]);

const denied = (error: { message?: string; code?: string } | null) => Boolean(error && (error.code === '42501' || /DENIED|NOT_FOUND|42501/i.test(error.message || '')));
const toolError = (error: { message?: string; code?: string } | null, what: string) =>
  JSON.stringify(denied(error) ? { loi: `Không thấy ${what} trong phạm vi người hỏi được xem.` } : { loi: `Chưa đọc được ${what}, thử lại sau.` });

const searchRecords = async (ctx: ToolContext, text: string, kinds: string[] | null, limit: number) => {
  const terms = searchTerms(text);
  if (!terms.length) return { records: [] as Record<string, unknown>[], error: null, empty: true };
  const r = await ctx.rpc('search_global_v1', { p_terms: terms, p_kinds: kinds, p_limit: limit });
  if (r.error) return { records: [], error: r.error, empty: false };
  const records = asArray(asObject(r.data).records).map(asObject).filter(x => typeof x.id === 'string' && typeof x.kind === 'string');
  return { records, error: null, empty: false };
};

/** Hồ sơ gửi màn hình (mở được): bỏ thông tin liên hệ cá nhân trong extra. */
const recordForScreen = (rec: Record<string, unknown>) => {
  const extra = asObject(rec.extra);
  const { phone: _p, email: _e, ...safeExtra } = extra;
  return compact({ kind: rec.kind, id: rec.id, code: str(rec.code), title: str(rec.title, 300), subtitle: str(rec.subtitle, 300), status: str(rec.status, 40),
    date: str(rec.date, 40), projectId: str(rec.projectId), siteId: str(rec.siteId), extra: safeExtra, rank: num(rec.rank) ?? 0 });
};

/** Tìm đúng một hồ sơ theo mã hN đã cấp hoặc theo mã chứng từ. */
const resolveOne = async (ctx: ToolContext, ma: string, kind: string, refBook: Map<string, Record<string, unknown>>) => {
  const fromRef = /^h\d{1,3}$/i.test(ma) ? refBook.get(ma.toLowerCase()) : undefined;
  if (fromRef && fromRef.kind === kind) return { record: fromRef, error: null };
  const found = await searchRecords(ctx, ma, [kind], 5);
  if (found.error) return { record: null, error: found.error };
  const folded = ma.toLowerCase().replace(/[^a-z0-9]/g, '');
  const exact = found.records.find(r => String(r.code || '').toLowerCase().replace(/[^a-z0-9]/g, '') === folded);
  return { record: exact || found.records[0] || null, error: null };
};

// ── T2a: lệnh nháp ─────────────────────────────────────────────────────────────────────────────────────────────────────
const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
const SESSION: Record<string, 'full' | 'morning' | 'afternoon'> = { ca_ngay: 'full', sang: 'morning', chieu: 'afternoon' };
const SESSION_LABEL: Record<string, string> = { full: 'cả ngày', morning: 'buổi sáng', afternoon: 'buổi chiều' };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Từ chung trong câu xin nghỉ, không dùng để phân biệt loại ("xin nghỉ", "đơn nghỉ"). */
const GENERIC_WORDS = new Set(['nghi', 'xin', 'don', 'loai']);
const words = (v: unknown) => fold(v).split(/[^a-z0-9]+/).filter(Boolean);
/**
 * "phép năm" / "ốm" / "đi muộn" → loại nghỉ đang dùng: trùng mã, hoặc mọi từ (bỏ dấu, bỏ từ chung) đều có trong tên loại.
 * Khớp nhiều loại hoặc không loại nào → null (Trợ lý hỏi lại kèm danh sách).
 */
export const matchLeaveType = (text: string, types: Array<Record<string, unknown>>) => {
  const q = fold(text);
  if (!q) return null;
  const byCode = types.filter(t => fold(t.code) === q || fold(t.name) === q);
  if (byCode.length === 1) return byCode[0];
  const wanted = words(q).filter(w => !GENERIC_WORDS.has(w));
  if (!wanted.length) return null;
  const hits = types.filter(t => { const name = new Set(words(t.name)); return wanted.every(w => name.has(w)); });
  return hits.length === 1 ? hits[0] : null;
};

const PROJECT_GENERIC = new Set(['du', 'an', 'cong', 'trinh', 'ct', 'da']);
/** Dự án theo lời người dùng: trùng mã / tên thì lấy luôn; không thì mọi từ (bỏ "dự án", "công trình") phải có trong mã + tên. */
export const matchProjects = <T extends Record<string, unknown>>(text: string, projects: T[]): T[] => {
  const q = fold(text);
  if (!q) return [];
  const exact = projects.filter(p => fold(p.code) === q || fold(p.name) === q);
  if (exact.length) return exact;
  const wanted = words(q).filter(w => !PROJECT_GENERIC.has(w));
  if (!wanted.length) return [];
  return projects.filter(p => {
    const code = fold(p.code);
    const have = new Set(words(`${code} ${fold(p.name)}`));
    return wanted.every(w => have.has(w) || code.includes(w));
  });
};
const projectLabel = (p: Record<string, unknown>) => [str(p.code, 40), str(p.name, 80)].filter(Boolean).join(' · ');
/** Ngày hôm nay giờ Việt Nam (YYYY-MM-DD). */
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

async function prepareMaterialRequest(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  const lines = asArray(args.dong).map(asObject).map(l => {
    const qty = num(l.so_luong);
    return compact({ name: str(l.ten, 160), spec: str(l.quy_cach, 80), qty: qty != null && qty > 0 ? qty : null, unit: str(l.don_vi, 20), note: str(l.ghi_chu, 160) });
  }).filter(l => l.name).slice(0, 30);
  if (!lines.length) return JSON.stringify({ loi: 'Chưa có vật tư nào. Hỏi lại người dùng cần vật tư gì, bao nhiêu.' });
  const neededDate = str(args.ngay_can, 10);
  if (neededDate && (!ISO_DAY.test(neededDate) || neededDate < vnToday())) return JSON.stringify({ loi: 'Ngày cần chưa đúng (YYYY-MM-DD, không trước hôm nay). Hỏi lại người dùng.' });

  const list = await ctx.rpc('assistant_mr_projects_v1', {});
  if (list.error) return toolError(list.error, 'dự án');
  const projects = asArray(list.data).map(asObject).filter(p => str(p.id));
  if (!projects.length) return JSON.stringify({ loi: 'Người hỏi chưa được lập đề xuất vật tư ở dự án nào — nói rõ và gợi ý nhờ quản lý dự án cấp quyền.' });
  // Chủ SP 18/10: chưa nói dự án thì HỎI LẠI bằng gợi ý bấm (dự án đang xem đứng đầu), không tự ghép vào dự án đang xem.
  // Chỉ được lập đề xuất ở đúng một dự án thì dùng luôn (thẻ ghi rõ dự án).
  const asked = str(args.du_an, 80);
  const hits = asked ? matchProjects(asked, projects) : [];
  const project = hits.length === 1 ? hits[0] : !asked && projects.length === 1 ? projects[0] : null;
  if (!project) {
    const pool = hits.length > 1 ? hits : projects;
    const current = pool.find(p => p.id === ctx.projectId);
    const options = [...(current ? [current] : []), ...pool.filter(p => p !== current)].slice(0, 6);
    return JSON.stringify(compact({ loi: asked && !hits.length ? `Không thấy dự án "${asked}" trong các dự án người hỏi được lập đề xuất.` : 'Người dùng chưa nói đề xuất cho dự án nào.',
      can_hoi: 'Hỏi lại một câu: đề xuất cho dự án nào; mỗi dự án dưới đây là một gợi ý bấm, ghi đúng như danh sách. Chưa chuẩn bị gì.',
      cac_du_an: options.map(projectLabel), du_an_dang_xem: current ? projectLabel(current) : null }));
  }
  const purpose = str(args.muc_dich, 200);
  const first = String(lines[0].name);
  const raw = (str(args.ten_de_xuat, 120) || purpose || `Vật tư ${first}${lines.length > 1 ? ` và ${lines.length - 1} vật tư khác` : ''}`).slice(0, 120);
  const title = raw.charAt(0).toUpperCase() + raw.slice(1);
  const code = str(project.code, 40) || str(project.name, 40) || 'dự án';
  const payload = compact({ projectId: str(project.id, 80), projectCode: str(project.code, 40), projectName: str(project.name, 160), siteId: str(project.siteId, 80),
    title, purpose, neededDate, lines });
  const missingQty = lines.filter(l => l.qty == null).length;
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'material_request', p_title: `Đề xuất vật tư ${code}`,
    p_payload: payload, p_preview: compact({ lineCount: lines.length, missingQty: missingQty || null }) });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  return JSON.stringify(compact({
    da_hien_the: true, du_an: projectLabel(project), ten_de_xuat: title, so_dong: lines.length, dong_chua_co_so_luong: missingQty || null, ngay_can: neededDate,
    ghi_chu: 'Thẻ đề xuất nháp đã hiện. Người dùng bấm "Mở form đề xuất" để khớp mã vật tư, kiểm số lượng rồi tự gửi. Không nói là đã gửi hay đã tạo phiếu.',
  }));
}

async function prepareLeave(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.runId || !ctx.emit) return JSON.stringify({ loi: 'Chưa chuẩn bị được lệnh ở đây.' });
  const typesRes = await ctx.rpc('assistant_leave_types_v1', {});
  if (typesRes.error) return toolError(typesRes.error, 'loại nghỉ phép');
  const types = asArray(typesRes.data).map(asObject);
  const type = matchLeaveType(str(args.loai, 80) || '', types);
  if (!type) return JSON.stringify({ loi: 'Chưa rõ loại nghỉ.', can_hoi: 'Hỏi lại người dùng chọn một loại; mỗi loại dưới đây là một gợi ý bấm.',
    cac_loai: types.filter(t => t.unit !== 'minute').map(t => str(t.name)).filter(Boolean) });
  if (type.unit === 'minute') return JSON.stringify({ loi: `${str(type.name)} tính theo phút — người dùng mở màn Nghỉ phép để điền.` });
  const start = str(args.tu_ngay, 10);
  const end = str(args.den_ngay, 10) || start;
  if (!start || !end || !ISO_DAY.test(start) || !ISO_DAY.test(end) || end < start) return JSON.stringify({ loi: 'Ngày chưa đúng (YYYY-MM-DD, ngày kết thúc không trước ngày bắt đầu). Hỏi lại người dùng.' });
  const reason = str(args.ly_do, 300);
  if (!reason || reason.length < 3) return JSON.stringify({ loi: 'Thiếu lý do nghỉ. Hỏi lại người dùng.' });
  const startSession = SESSION[String(args.buoi_bat_dau)] || 'full';
  const endSession = SESSION[String(args.buoi_ket_thuc)] || (start === end ? startSession : 'full');
  const pv = await ctx.rpc('preview_my_leave_request', { p_type: type.code, p_start: start, p_end: end, p_start_session: startSession, p_end_session: endSession, p_minutes: null, p_subtype: null });
  if (pv.error) return JSON.stringify({ loi: pv.error.message || 'Chưa kiểm tra được đơn nghỉ.' });
  const d = asObject(pv.data);
  const steps = asArray(d.steps).map(asObject).map(st => compact({ buoc: str(st.label, 60), nguoi: str(st.name, 80) }));
  const problems = asArray(d.problems).map(p => str(p, 200)).filter((p): p is string => Boolean(p));
  const days = num(d.days);
  const payload = { type: type.code, typeName: str(type.name), start, end, startSession, endSession, reason, requiresAttachment: type.requiresAttachment === true };
  const preview = compact({ days, annualRemaining: num(d.annualRemaining), steps: steps.map(st => ({ label: st.buoc, name: st.nguoi })), problems });
  const when = start === end ? `${start.slice(8, 10)}/${start.slice(5, 7)}` : `${start.slice(8, 10)}/${start.slice(5, 7)}–${end.slice(8, 10)}/${end.slice(5, 7)}`;
  const created = await ctx.rpc('assistant_command_create_v1', { p_run_id: ctx.runId, p_kind: 'leave_request', p_title: `Đơn ${String(type.name).toLowerCase()} ${when}`, p_payload: payload, p_preview: preview });
  if (created.error) return JSON.stringify({ loi: /TOO_MANY/.test(created.error.message || '') ? 'Đã chuẩn bị đủ lệnh cho câu này.' : 'Chưa chuẩn bị được lệnh, thử lại sau.' });
  ctx.emit({ type: 'command', command: created.data });
  return JSON.stringify(compact({
    da_hien_the: true, loai: str(type.name), tu: start, den: end, buoi_dau: SESSION_LABEL[startSession], buoi_cuoi: SESSION_LABEL[endSession], so_ngay: days,
    nguoi_duyet: steps, phep_nam_con: num(d.annualRemaining), van_de: problems,
    can_dinh_kem: type.requiresAttachment === true ? 'Loại này cần giấy tờ: người dùng mở màn Nghỉ phép để đính kèm.' : null,
    ghi_chu: 'Thẻ đơn nháp đã hiện cho người dùng; họ tự xem và bấm Gửi đơn. Không nói là đã gửi hay đã tạo.',
  }));
}

// ── các công cụ ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function runTool(name: string, rawArgs: Record<string, unknown>, ctx: ToolContext, refBook: Map<string, Record<string, unknown>>): Promise<string> {
  const args = asObject(rawArgs);
  const remember = (rec: Record<string, unknown>) => { const ref = ctx.book.record(recordForScreen(rec)); refBook.set(ref, rec); return ref; };

  if (name === 'tim_ho_so') {
    const text = str(args.tu_khoa, 100);
    if (!text) return JSON.stringify({ loi: 'Thiếu chữ cần tìm.' });
    const kinds = asArray(args.loai).filter((k): k is string => typeof k === 'string' && KINDS.includes(k));
    const found = await searchRecords(ctx, text, kinds.length ? kinds : null, 8);
    if (found.error) return toolError(found.error, 'hồ sơ');
    const rows = found.records.slice(0, 8).map(rec => compact({ ref: remember(rec), loai: KIND_LABEL[String(rec.kind)] || rec.kind, ma: str(rec.code),
      ten: str(rec.title, 160), mo_ta: str(rec.subtitle, 160), trang_thai: str(rec.status, 40), ngay: day(rec.date) }));
    return JSON.stringify(rows.length ? { ket_qua: rows } : { ket_qua: [], ghi_chu: 'Không thấy hồ sơ nào khớp trong phạm vi người hỏi được xem.' });
  }

  if (name === 'ton_kho') {
    const text = str(args.vat_tu, 100);
    if (!text) return JSON.stringify({ loi: 'Thiếu tên vật tư.' });
    const found = await searchRecords(ctx, text, ['item'], 6);
    if (found.error) return toolError(found.error, 'danh mục vật tư');
    if (!found.records.length) return JSON.stringify({ ket_qua: [], ghi_chu: 'Không thấy vật tư khớp trong danh mục người hỏi được xem.' });
    const items = found.records.slice(0, 6);
    const stock = await ctx.rpc('ai_stock_by_items_v1', { p_item_ids: items.map(i => i.id) });
    if (stock.error) return toolError(stock.error, 'tồn kho');
    const rows = asArray(stock.data).map(asObject);
    return JSON.stringify({ ket_qua: items.map(item => {
      const byWarehouse = rows.filter(r => r.itemId === item.id).map(r => compact({ kho: str(r.warehouseName), ton: round(r.qty), don_vi: str(r.unit) }));
      return compact({ ref: remember(item), ma: str(item.code), ten: str(item.title, 160), don_vi: str(asObject(item.extra).unit),
        tong_ton: round(byWarehouse.reduce((s, w) => s + (num(w.ton) || 0), 0)), theo_kho: byWarehouse,
        ghi_chu: byWarehouse.length ? undefined : 'Không còn tồn ở kho nào người hỏi được xem.' });
    }) });
  }

  if (name === 'chi_tiet_don_mua') {
    const ma = str(args.ma, 60);
    if (!ma) return JSON.stringify({ loi: 'Thiếu số PO.' });
    const hit = await resolveOne(ctx, ma, 'purchase_order', refBook);
    if (hit.error) return toolError(hit.error, 'đơn hàng');
    if (!hit.record) return JSON.stringify({ loi: `Không thấy đơn hàng ${ma} trong phạm vi người hỏi được xem.` });
    const po = await ctx.rpc('get_procurement_order_v1', { p_po_id: hit.record.id });
    if (po.error) return toolError(po.error, 'đơn hàng');
    const d = asObject(po.data);
    const pay = await ctx.rpc('get_procurement_po_payment_status_v1', { p_po_ids: [hit.record.id] });
    const payment = pay.error ? null : asObject(asObject(pay.data)[String(hit.record.id)]);
    const lines = asArray(d.lines).map(asObject);
    return JSON.stringify(compact({
      ref: remember(hit.record), so_po: str(d.poNumber), trang_thai: str(d.status, 40), giai_doan: str(d.stage, 40), ncc: str(d.vendorName),
      du_an: str(d.projectCode), kho_nhan: str(d.warehouseName), ngay_dat: day(d.orderDate), hen_giao: day(d.expectedDeliveryDate),
      tong_tien: num(d.totalAmount), tong_duyet: num(d.approvedTotalAmount), vat: num(d.vatRate), nguoi_lap: str(d.createdByName), cho_duyet: str(d.submittedToName),
      so_dot_giao: asArray(d.deliveries).length || null,
      dong: lines.slice(0, 30).map(l => compact({ ten: str(l.name, 160), ma: str(l.sku), don_vi: str(l.unit), dat: round(l.qty), da_nhan: round(l.receivedQty),
        con_phai_giao: round(l.remainingToDeliver), don_gia: num(l.unitPrice) })),
      con_dong: lines.length > 30 ? lines.length - 30 : null,
      thanh_toan: payment && Object.keys(payment).length ? compact({ tinh_trang: str(payment.status, 20), da_ghi_nhan: num(payment.recognized), da_tra: num(payment.paid),
        con_no: num(payment.outstanding), dang_de_nghi_chi: num(payment.inRequest), han_tiep: day(payment.nextDue), qua_han: payment.overdue === true ? true : null,
        tam_ung: num(payment.advance) }) : null,
    }));
  }

  if (name === 'chi_tiet_de_xuat') {
    const ma = str(args.ma, 60);
    if (!ma) return JSON.stringify({ loi: 'Thiếu mã đề xuất.' });
    const hit = await resolveOne(ctx, ma, 'material_request', refBook);
    if (hit.error) return toolError(hit.error, 'đề xuất vật tư');
    if (!hit.record) return JSON.stringify({ loi: `Không thấy đề xuất ${ma} trong phạm vi người hỏi được xem.` });
    const mr = await ctx.rpc('get_material_request_supply_v1', { p_request_id: hit.record.id });
    if (mr.error) return toolError(mr.error, 'đề xuất vật tư');
    const d = asObject(mr.data);
    const lines = asArray(d.lines).map(asObject);
    return JSON.stringify(compact({
      ref: remember(hit.record), ma: str(hit.record.code), ten: str(hit.record.title, 160), trang_thai: str(d.status, 40), giai_doan: str(d.phase, 40),
      dong: lines.slice(0, 30).map(l => compact({ ten: str(l.itemName, 160), ma: str(l.sku), don_vi: str(l.unit), can: round(l.needQty), da_dat: round(l.sourcedQty),
        da_nhan: round(l.receivedQty), da_dong: round(l.closedQty), tinh_trang: str(l.state, 20),
        po: asArray(l.orders).map(asObject).map(o => str(o.poNumber)).filter(Boolean) })),
      con_dong: lines.length > 30 ? lines.length - 30 : null,
    }));
  }

  if (name === 'viec_cua_toi') {
    const tab = args.nhom === 'toi_gui' ? 'sent' : args.nhom === 'theo_doi' ? 'watch' : 'mine';
    const r = await ctx.rpc('vcc_my_work_items_v1', { p_tab: tab });
    if (r.error) return toolError(r.error, 'việc của bạn');
    const filter = str(args.tu_khoa, 60)?.toLowerCase();
    const all = asArray(asObject(r.data).items).map(asObject).filter(i => typeof i.id === 'string');
    const items = filter ? all.filter(i => `${i.code} ${i.title}`.toLowerCase().includes(filter)) : all;
    return JSON.stringify(compact({ tong: items.length, viec: items.slice(0, 15).map(i => compact({ ref: ctx.book.work(i), ma: str(i.code), viec: str(i.title, 160),
      loai_viec: str(i.kind, 20), nguoi: str(i.who), ghi_chu: str(i.meta, 120), han: str(i.dueAt, 40), trang_thai: str(i.status, 40) })),
      con: items.length > 15 ? items.length - 15 : null }));
  }

  if (name === 'chuan_bi_don_nghi_phep') return prepareLeave(args, ctx);
  if (name === 'chuan_bi_de_xuat_vat_tu') return prepareMaterialRequest(args, ctx);

  return JSON.stringify({ loi: `Không có công cụ ${name}.` });
}
