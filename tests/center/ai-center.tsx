import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import AiCenter from '../../pages/AiCenter';
import type { AiActivity, AiDigest, AiAdminOverview, AiAdminService, AiGrant, AiPerson } from '../../lib/aiAdmin';
import { parseSkillCatalog, type AiSkillCatalogService, type SkillUsage } from '../../lib/aiSkillCatalog';
import { skillCatalog } from '../../supabase/functions/ai-gateway/catalog';
import type { ControlFinding, ControlRule, ControlService } from '../../lib/controlFindings';

// Trung tâm AI · fixture (không gọi Supabase). ?role=staff: người không phải Admin. ?empty=1: chưa cấp ai.
// Tab Skill: lời dặn / công cụ lấy từ catalog.ts thật; ?catalog=fail (cổng chưa cập nhật), ?usage=fail (lỗi đọc lượt dùng).
const params = new URLSearchParams(location.search);
const calls: Array<Record<string, unknown>> = [];
(window as unknown as { __aiAdminCalls: typeof calls }).__aiAdminCalls = calls;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const CLAUDE = 'c-claude'; const DEEPSEEK = 'c-deepseek';
const PEOPLE: AiPerson[] = [
  { id: 'u-admin', name: 'Admin Hoàng', email: 'admin@khoviet.vn', role: 'ADMIN', granted: true },
  { id: 'u-tam', name: 'Bùi Thị Tâm', email: 'tam@khoviet.vn', role: 'EMPLOYEE', granted: false },
  { id: 'u-chuan', name: 'Hà Đức Chuẩn', email: 'chuan@khoviet.vn', role: 'EMPLOYEE', granted: false },
  { id: 'u-son', name: 'Phạm Ngọc Sơn', email: 'son@khoviet.vn', role: 'EMPLOYEE', granted: true },
];
const state: AiAdminOverview = {
  templates: [
    { id: 't-std', name: 'Tiêu chuẩn', connectionId: CLAUDE, extraConnectionIds: [], monthlyCostCapUsd: 3, dailyQuestionCap: 30, skills: ['assistant_chat'], note: 'Cán bộ dùng Trợ lý hằng ngày', users: 1 },
    { id: 't-pro', name: 'Nâng cao', connectionId: CLAUDE, extraConnectionIds: [DEEPSEEK], monthlyCostCapUsd: 10, dailyQuestionCap: 80, skills: ['assistant_chat'], note: 'Quản lý, mua hàng', users: 1 },
  ],
  grants: [],
  skills: [
    { code: 'assistant_chat', name: 'Trợ lý · hội thoại', access: 'granted', enabled: true, dailyLimit: 80 },
    { code: 'po_quote_lines', name: 'Đọc báo giá thành dòng đơn', access: 'everyone', enabled: true, dailyLimit: 30 },
    { code: 'mr_photo_lines', name: 'Đọc ảnh phiếu đề xuất', access: 'everyone', enabled: true, dailyLimit: 20 },
    { code: 'po_review_brief', name: 'Tóm tắt đơn trước khi duyệt', access: 'everyone', enabled: true, dailyLimit: 60 },
    { code: 'text_summary', name: 'Tóm tắt văn bản', access: 'everyone', enabled: true, dailyLimit: 50 },
  ],
  connections: [
    { id: CLAUDE, name: 'RevidAPI', model: 'claude-sonnet-5-5', enabled: true, pricePerCall: 0.008, displayName: 'Claude Sonnet 5.5', blurb: 'Hiểu sâu, đọc ảnh / PDF scan — hợp báo giá, phân tích', icon: '🧠', vision: true },
    { id: DEEPSEEK, name: 'RevidAPI-deepseek', model: 'deepseek-v4.1-flash', enabled: true, pricePerCall: null, displayName: 'DeepSeek Flash', blurb: 'Nhanh, rẻ — câu hỏi thường, tra cứu nhanh', icon: '⚡', vision: false },
  ],
  settings: { monthlyCostCapUsd: 20, monthlyRunCap: 3000 },
  month: { runs: 214, costUsd: 3.42 },
};
const effective = (g: Omit<AiGrant, 'effective' | 'usage'>) => {
  const t = state.templates.find(x => x.id === g.templateId);
  const def = g.connectionId ?? t?.connectionId ?? null;
  return { enabled: g.enabled, templateName: t?.name ?? null, connectionId: def,
    models: [def, ...(g.extraConnectionIds ?? t?.extraConnectionIds ?? [])].filter((id, i, all): id is string => Boolean(id) && all.indexOf(id) === i),
    monthlyCostCapUsd: g.monthlyCostCapUsd ?? t?.monthlyCostCapUsd ?? null, dailyQuestionCap: g.dailyQuestionCap ?? t?.dailyQuestionCap ?? null, skills: g.skills ?? t?.skills ?? [] };
};
const grant = (person: AiPerson, values: Partial<AiGrant>, usage: AiGrant['usage']): AiGrant => {
  const base = { userId: person.id, name: person.name, email: person.email, role: person.role, active: true, updatedAt: '2026-10-18T03:00:00Z',
    enabled: true, templateId: null, connectionId: null, extraConnectionIds: null, monthlyCostCapUsd: null, dailyQuestionCap: null, skills: null, note: '', ...values };
  return { ...base, effective: effective(base), usage };
};
if (!params.get('empty')) {
  state.grants = [
    grant(PEOPLE[0], { templateId: 't-pro', note: 'Quản trị AI' }, { today: 12, monthRuns: 160, monthCostUsd: 2.86, lastAt: '2026-10-18T08:00:00Z' }),
    grant(PEOPLE[3], { templateId: 't-std', dailyQuestionCap: 40 }, { today: 28, monthRuns: 54, monthCostUsd: 0.56, lastAt: '2026-10-18T07:00:00Z' }),
  ];
}
const recount = () => { state.templates = state.templates.map(t => ({ ...t, users: state.grants.filter(g => g.templateId === t.id).length })); };
recount();

const service: AiAdminService = {
  overview: async () => { await sleep(80); if (params.get('role') === 'staff') throw new Error('Chỉ Quản trị AI (Admin) làm được việc này.'); return JSON.parse(JSON.stringify(state)); },
  people: async search => { await sleep(40); const q = search.toLowerCase(); return PEOPLE.filter(p => !q || `${p.name} ${p.email}`.toLowerCase().includes(q))
    .map(p => ({ ...p, granted: state.grants.some(g => g.userId === p.id) })); },
  saveGrants: async (userIds, values) => {
    calls.push({ saveGrants: userIds, values });
    await sleep(60);
    for (const id of userIds) {
      const person = PEOPLE.find(p => p.id === id)!;
      const old = state.grants.find(g => g.userId === id);
      const next = grant(person, { ...values }, old?.usage || { today: 0, monthRuns: 0, monthCostUsd: 0, lastAt: null });
      state.grants = [...state.grants.filter(g => g.userId !== id), next].sort((a, b) => a.name.localeCompare(b.name));
    }
    recount();
  },
  saveTemplate: async t => {
    calls.push({ saveTemplate: t });
    if (t.id) state.templates = state.templates.map(x => (x.id === t.id ? { ...x, ...t, id: x.id } : x));
    else state.templates = [...state.templates, { ...t, id: `t-${Date.now()}`, users: 0 }];
    state.grants = state.grants.map(g => ({ ...g, effective: effective(g) }));
  },
  deleteTemplate: async id => { calls.push({ deleteTemplate: id }); state.templates = state.templates.filter(t => t.id !== id); },
  activity: async days => { calls.push({ activity: days }); await sleep(60); if (params.get('activity') === 'fail') throw new Error('Mất kết nối'); return { ...ACTIVITY, days }; },
  // B4: bản tin tuần — tuần trước đã gửi 3 Admin; dựng thử tuần này trả bản chưa gửi; gửi → recipients 3.
  digests: async () => { await sleep(50); return digestState.map(d => JSON.parse(JSON.stringify(d))); },
  runDigest: async (weekStart, send) => {
    calls.push({ digest: send ? 'send' : 'preview', weekStart });
    await sleep(60);
    const start = weekStart || '2026-10-19';
    const existing = digestState.find(d => d.weekStart === start);
    const base: AiDigest = existing ? { ...existing } : { ...DIGEST_PREV, weekStart: start, weekEnd: '2026-10-21', generatedAt: '2026-10-21T09:30:00Z', sentAt: null, recipients: 0,
      picks: [{ key: 'feedback_new', score: 93, title: 'Xử lý 2 góp ý / phiếu sự cố mới (1 khẩn đang mở)', detail: '1 từ Trợ lý · tổng 34 phiếu đang mở, cũ nhất 120 ngày.', link: '/feedback' }],
      feedback: { ...DIGEST_PREV.feedback, new: 2, fromAssistant: 1, urgentOpen: 1 } };
    const next: AiDigest = send && !base.sentAt ? { ...base, sentAt: '2026-10-21T09:31:00Z', recipients: 3 } : base;
    digestState = [next, ...digestState.filter(d => d.weekStart !== start)].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    return JSON.parse(JSON.stringify(next));
  },
  saveModel: async m => { calls.push({ saveModel: m }); state.connections = state.connections.map(c => (c.id === m.id ? { ...c, ...m } : c)); },
  setSkillAccess: async (code, access) => { calls.push({ setSkillAccess: code, access }); state.skills = state.skills.map(s => (s.code === code ? { ...s, access } : s)); },
};

// Hoạt động 14 ngày của nhóm thí điểm (số giả lập); ?activity=fail → lỗi tải.
const PILOT = ['Dương Xuân Thịnh', 'Nguyễn Thị Mơ', 'Hà Đức Chuẩn', 'Đặng Thị Thu Hà', 'Nguyễn Thị Hương', 'Bùi Thị Tâm', 'Nguyễn Văn Năm', 'Đoàn Văn Dương', 'Bùi Quang Chung', 'Nguyễn Thị Giang'];
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DIGEST_PREV: AiDigest = {
  weekStart: '2026-10-12', weekEnd: '2026-10-18', generatedAt: '2026-10-19T00:00:05Z', sentAt: '2026-10-19T00:00:06Z', recipients: 3,
  picks: [
    { key: 'ai_errors', score: 95, title: 'Kiểm cổng AI: 5 lượt lỗi trong tuần', detail: 'AI_TIMEOUT ×5 — xem kết nối / model ở Cài đặt → Kết nối, thử lại bộ kiểm.', link: '/settings?tab=ai-gateway' },
    { key: 'approvals_stale', score: 84, title: 'Nhắc duyệt việc treo', detail: '4 đơn phép chờ > 3 ngày · 37 phiếu quy trình > 7 ngày không động · 2 phiếu yêu cầu chờ > 3 ngày.', link: '/wf' },
    { key: 'ai_idle', score: 80, title: '10/16 người được cấp chưa hỏi Trợ lý tuần này', detail: 'Lê Thị Mơ, Nguyễn Văn Chuẩn — nhắc thử một câu hoặc thu hồi cấp để tiết kiệm.', link: '/ai' },
  ],
  assistant: { runs: 61, askers: 6, questions: 48, errors: 5, errorCodes: [{ code: 'AI_TIMEOUT', n: 5 }], dislikes: 0, refusals: 3, slow: 4, costUsd: 1.42, granted: 16, idleCount: 10, idle: ['Lê Thị Mơ', 'Nguyễn Văn Chuẩn'],
    commands: { prepared: 9, done: 6, cancelled: 1, expired: 2 }, jev: { n: 40, auto: 27, autoAgree: 15 } },
  feedback: { new: 0, fromAssistant: 0, open: 33, oldestOpenDays: 118, urgentOpen: 0 },
  stale: { leavePending3d: 4, wfRunningStale7d: 37, captureUnreceived3d: 1, poDraft7d: 9, requestDraft7d: 9, dailyLogDraft3d: 50, requestPending3d: 2 },
};
let digestState: AiDigest[] = [DIGEST_PREV];
const ACTIVITY: AiActivity = {
  days: 14, granted: 16,
  totals: { questions: 186, askers: 9, runs: 241, costUsd: 4.12, likes: 31, dislikes: 6, errors: 2, blocked: 3, withFiles: 22 },
  daily: [[13, 4, 2], [12, 9, 4], [11, 15, 6], [10, 11, 5], [9, 0, 0], [8, 0, 0], [7, 18, 7], [6, 21, 8], [5, 17, 7], [4, 24, 9], [3, 19, 8], [2, 0, 0], [1, 22, 8], [0, 26, 9]]
    .map(([o, q, p]) => ({ day: day(o), questions: q, people: p })),
  topics: [{ topic: 'lookup', questions: 74 }, { topic: 'chat', questions: 41 }, { topic: 'purchase_order', questions: 23 }, { topic: 'material_request', questions: 19 },
    { topic: 'daily_log', questions: 14 }, { topic: 'leave_request', questions: 9 }, { topic: 'memory_note', questions: 4 }, { topic: 'refused', questions: 2 }],
  commands: [{ kind: 'purchase_order', prepared: 21, done: 14, cancelled: 4, failed: 1, open: 1, expired: 1 }, { kind: 'material_request', prepared: 17, done: 12, cancelled: 3, failed: 0, open: 1, expired: 1 },
    { kind: 'daily_log', prepared: 13, done: 11, cancelled: 1, failed: 0, open: 0, expired: 1 }, { kind: 'leave_request', prepared: 8, done: 7, cancelled: 1, failed: 0, open: 0, expired: 0 }],
  people: PILOT.map((name, i) => ({ userId: `p-${i}`, name, granted: true, template: i < 5 ? 'Nâng cao' : 'Tiêu chuẩn', questions: i === 7 ? 0 : 42 - i * 4, runs: i === 7 ? 0 : 50 - i * 4,
    costUsd: i === 7 ? 0 : Math.round((0.9 - i * 0.08) * 100) / 100, likes: i === 7 ? 0 : 5 - Math.floor(i / 2), dislikes: i === 3 ? 3 : i === 1 ? 1 : 0, blocked: i === 6 ? 2 : 0,
    lastAt: i === 7 ? null : new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), commands: i === 7 ? 0 : 9 - i, done: i === 7 ? 0 : Math.max(0, 7 - i) })),
  models: [{ model: 'claude-sonnet-5-5', runs: 201, costUsd: 3.98 }, { model: 'deepseek-v4.1-flash', runs: 40, costUsd: 0.14 }],
  dislikes: [{ at: new Date().toISOString(), name: 'Đặng Thị Thu Hà', skill: 'assistant_chat', reason: 'wrong_data', note: 'Báo giá Hòa Phát đọc sai đơn giá dòng 3' },
    { at: new Date(Date.now() - 86_400_000).toISOString(), name: 'Nguyễn Thị Mơ', skill: 'assistant_chat', reason: 'incomplete', note: null }],
};

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const usageRow = (code: string, name: string, description: string, tier: string, mode: string, runs: number, people: number, extra: Partial<SkillUsage['skills'][number]> = {}) =>
  ({ code, name, description, tier, mode, modelClass: 'fast', enabled: true, access: 'everyone' as const, dailyLimit: 50, runs, people, ok: runs, errors: 0, blocked: 0,
    costUsd: Math.round(runs * 0.008 * 1000) / 1000, likes: Math.floor(runs / 6), dislikes: 0, lastAt: runs ? ago(2) : null, ...extra });
const USAGE: SkillUsage = {
  days: 7,
  skills: [
    usageRow('assistant_chat', 'Trợ lý · hội thoại', 'Tab Trợ lý: hội thoại nhiều lượt, tự tra cứu bằng công cụ, chuẩn bị nháp.', 'base', 'draft', 142, 11,
      { access: 'granted', errors: 2, blocked: 3, likes: 21, dislikes: 4, costUsd: 1.136 }),
    usageRow('po_quote_lines', 'Đọc báo giá thành dòng đơn', 'Mua hàng: đọc ảnh / chữ báo giá thành dòng đơn.', 'ops', 'read', 18, 3),
    usageRow('mr_photo_lines', 'Đọc ảnh phiếu đề xuất', 'Đề xuất vật tư: đọc ảnh phiếu viết tay.', 'base', 'read', 6, 2),
    usageRow('po_review_brief', 'Tóm tắt đơn trước khi duyệt', 'Mua hàng: một câu cho người duyệt đơn.', 'ops', 'read', 31, 4),
    usageRow('text_summary', 'Tóm tắt văn bản', 'Tóm tắt đoạn văn bản người dùng đưa vào.', 'base', 'read', 0, 0),
  ],
  tools: [{ tool: 'tim_ho_so', runs: 48, people: 9, lastAt: ago(1) }, { tool: 'chuan_bi_don_mua', runs: 21, people: 4, lastAt: ago(3) }, { tool: 'ton_kho', runs: 17, people: 6, lastAt: ago(5) },
    { tool: 'chuan_bi_de_xuat_vat_tu', runs: 15, people: 5, lastAt: ago(6) }, { tool: 'bien_dong_nhan_su', runs: 4, people: 2, lastAt: ago(0.5) }],
  commands: [{ kind: 'purchase_order', prepared: 21, done: 14 }, { kind: 'material_request', prepared: 15, done: 11 }],
};
const skillService: AiSkillCatalogService = {
  usage: async days => { calls.push({ skillUsage: days }); await sleep(70); if (params.get('usage') === 'fail') throw new Error('Mất kết nối'); return { ...USAGE, days }; },
  catalog: async () => { calls.push({ skillCatalog: true }); await sleep(120); if (params.get('catalog') === 'fail') throw new Error('Chưa đọc được lời dặn từ cổng AI — cổng chưa cập nhật hoặc mất kết nối.');
    return parseSkillCatalog(JSON.parse(JSON.stringify(skillCatalog('Chủ nhật 19/10/2026, 09:41')))); },
};

// Tab Kiểm soát (K0–K1): số liệu giả (không phải dữ liệu thật). ?control=empty: chưa có lệch; ?control=fail: lỗi tải;
// ?control=mine: người xử lý (không phải Admin) — chỉ thấy lệch luật đã bật, không có dữ liệu cũ / Chạy lại / bật luật.
const rule = (code: string, module: string, title: string, severity: ControlRule['severity'], fixHint: string, ownerHint: string): ControlRule => ({
  code, module, title, severity, principle: `Nguyên tắc của luật ${title.toLowerCase()}.`, fixHint, ownerHint, mode: 'shadow', sinceDate: '2026-10-01',
  open: 0, openLegacy: 0, accepted: 0, resolved7d: 0, amountOpen: null });
const CONTROL_MINE = params.get('control') === 'mine';
const CONTROL_RULES: ControlRule[] = [
  rule('statement_price_no_reason', 'Công nợ', 'Giá đối soát khác giá phiếu giao, không lý do', 'P0', 'Mở bảng đối soát: ghi lý do và chốt giá nếu đúng, hoặc đưa về giá phiếu giao.', 'Kế toán công nợ'),
  rule('batch_wms_status', 'Kho', 'Đợt giao và phiếu nhập kho lệch trạng thái', 'P0', 'Mở Kho → Đối chiếu nhận hàng để chốt đợt theo phiếu kho.', 'Kho + Mua hàng'),
  rule('batch_vat_differs', 'Công nợ', 'VAT đợt nhận khác VAT đơn', 'P1', 'Kế toán đối chiếu hóa đơn, điều chỉnh công nợ phần VAT thiếu.', 'Kế toán công nợ'),
  rule('mr_ended_po_open', 'Đề xuất', 'Đề xuất đã kết thúc nhưng đơn mua còn mở', 'P1', 'Kết thúc thiếu đơn mua còn mở, hoặc mở lại đề xuất.', 'Mua hàng'),
  rule('po_total_mismatch', 'Mua hàng', 'Tổng tiền đơn khác tổng các dòng', 'P1', 'Đối chiếu dòng và tổng; điều chỉnh bằng chứng từ có lý do.', 'Mua hàng'),
];
const finding = (id: string, ruleCode: string, title: string, o: Partial<ControlFinding>): ControlFinding => {
  const r = CONTROL_RULES.find(x => x.code === ruleCode)!;
  return { id, rule: ruleCode, ruleTitle: r.title, module: r.module, severity: r.severity, ownerHint: r.ownerHint, objectType: 'purchase_order', objectId: id, objectCode: null,
    projectId: 'p-1', projectName: 'DA-MAU', title, detail: {}, amount: null, happenedOn: '2026-10-15', link: '/procurement?po=' + id, legacy: false, status: 'open',
    firstSeenAt: '2026-10-23T02:00:00Z', lastSeenAt: '2026-10-23T03:00:00Z', resolvedAt: null, acceptedAt: null, acceptedReason: null, acceptedBy: null,
    assignees: ['Kế toán A', 'Kế toán B'], canAccept: !CONTROL_MINE, escalated: false, ...o };
};
let controlState: ControlFinding[] = params.get('control') === 'empty' ? [] : [
  finding('f1', 'statement_price_no_reason', 'PO-901 · Bê tông M300: giá đối soát 1.250.000 đ, giá phiếu giao 1.100.000 đ, chưa ghi lý do', { objectCode: 'PO-901', amount: 1_500_000 }),
  finding('f2', 'batch_wms_status', 'PO-902 đợt 1: kho đã nhập xong nhưng đợt giao vẫn "receiving"', { objectCode: 'PO-902 · đợt 1', amount: 0, legacy: true, happenedOn: '2026-09-30' }),
  finding('f3', 'batch_vat_differs', 'PO-903 đợt 2: VAT đợt 0%, VAT đơn 8% → công nợ chênh 2.400.000 đ', { objectCode: 'PO-903 · đợt 2', amount: 2_400_000 }),
  finding('f4', 'batch_vat_differs', 'PO-904 đợt 1: VAT đợt 0%, VAT đơn 10% → công nợ chênh 1.200.000 đ', { objectCode: 'PO-904 · đợt 1', amount: 1_200_000 }),
  finding('f5', 'mr_ended_po_open', 'MR-2026-0901 đã kết thúc nhưng PO-905 còn mở (sent)', { objectCode: 'MR-2026-0901', objectType: 'material_request', assignees: ['Người mua C'], escalated: true }),
  finding('f6', 'po_total_mismatch', 'PO-906: tổng đơn 90.000.000 đ, tổng các dòng 95.000.000 đ', { objectCode: 'PO-906', amount: -5_000_000, legacy: true, happenedOn: '2026-08-12' }),
];
// Hai luật đã bật "Báo người xử lý".
CONTROL_RULES.forEach(r => { if (r.code === 'statement_price_no_reason' || r.code === 'mr_ended_po_open') r.mode = 'live'; });
const visible = (f: ControlFinding) => !CONTROL_MINE || (!f.legacy && CONTROL_RULES.find(r => r.code === f.rule)?.mode === 'live');
const controlRules = () => CONTROL_RULES.filter(r => !CONTROL_MINE || r.mode === 'live').map(r => {
  const mine = controlState.filter(f => f.rule === r.code && visible(f));
  return { ...r, open: mine.filter(f => f.status === 'open' && !f.legacy).length, openLegacy: mine.filter(f => f.status === 'open' && f.legacy).length,
    accepted: mine.filter(f => f.status === 'accepted').length, resolved7d: mine.filter(f => f.status === 'resolved').length,
    amountOpen: mine.filter(f => f.status === 'open').reduce((s, f) => s + Math.abs(f.amount ?? 0), 0) || null };
});
const controlService: ControlService = {
  overview: async () => { await sleep(60); if (params.get('control') === 'fail') throw new Error('Mất kết nối');
    return { isAdmin: !CONTROL_MINE, rules: controlRules(), lastRun: { id: 7, startedAt: '2026-10-23T03:00:00Z', finishedAt: '2026-10-23T03:00:02Z', trigger: 'cron', rules: 18, opened: 0, resolved: 0, openTotal: controlState.length, errors: [] } }; },
  findings: async (ruleCode, status, legacy) => { calls.push({ controlFindings: { ruleCode, status, legacy } }); await sleep(50);
    return controlState.filter(f => visible(f) && (!ruleCode || f.rule === ruleCode) && (status === 'all' || f.status === status) && (legacy == null || f.legacy === legacy)).map(f => ({ ...f })); },
  accept: async (id, reason) => { calls.push({ controlAccept: { id, reason } }); await sleep(40);
    controlState = controlState.map(f => (f.id === id ? { ...f, status: 'accepted', acceptedReason: reason, acceptedBy: 'Admin Hoàng', acceptedAt: '2026-10-23T03:05:00Z' } : f)); },
  reopen: async id => { calls.push({ controlReopen: id }); await sleep(40); controlState = controlState.map(f => (f.id === id ? { ...f, status: 'open', acceptedReason: null, acceptedBy: null, acceptedAt: null } : f)); },
  setMode: async (code, mode) => { calls.push({ controlMode: { code, mode } }); await sleep(40); const r = CONTROL_RULES.find(x => x.code === code); if (r) r.mode = mode; },
  runNow: async () => { calls.push({ controlRun: true }); await sleep(120); return { rules: 18, opened: 0, resolved: 0, errors: [] }; },
};

const Where: React.FC = () => { const l = useLocation(); return <p data-testid="route" className="sr-only">{l.pathname}</p>; };
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[params.get('tab') ? `/ai?tab=${params.get('tab')}` : '/ai']}>
    <ToastProvider><ConfirmProvider>
      <Routes><Route path="/ai" element={<AiCenter service={service} skillService={skillService} controlService={controlService} />} /><Route path="*" element={<Where />} /></Routes>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);
