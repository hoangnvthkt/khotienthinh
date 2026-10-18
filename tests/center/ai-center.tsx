import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '../../index.css';
import { ToastProvider } from '../../context/ToastContext';
import { ConfirmProvider } from '../../context/ConfirmContext';
import AiCenter from '../../pages/AiCenter';
import type { AiAdminOverview, AiAdminService, AiGrant, AiPerson } from '../../lib/aiAdmin';

// Trung tâm AI · fixture (không gọi Supabase). ?role=staff: người không phải Admin. ?empty=1: chưa cấp ai.
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
  saveModel: async m => { calls.push({ saveModel: m }); state.connections = state.connections.map(c => (c.id === m.id ? { ...c, ...m } : c)); },
  setSkillAccess: async (code, access) => { calls.push({ setSkillAccess: code, access }); state.skills = state.skills.map(s => (s.code === code ? { ...s, access } : s)); },
};

const Where: React.FC = () => { const l = useLocation(); return <p data-testid="route" className="sr-only">{l.pathname}</p>; };
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/ai']}>
    <ToastProvider><ConfirmProvider>
      <Routes><Route path="/ai" element={<AiCenter service={service} />} /><Route path="*" element={<Where />} /></Routes>
    </ConfirmProvider></ToastProvider>
  </MemoryRouter>,
);
