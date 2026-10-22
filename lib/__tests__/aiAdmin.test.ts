import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: vi.fn() } } }));

import { aiAdminService, grantPayload, parseOverview, usd, usedPct } from '../aiAdmin';
import { aiErrorMessage, aiGateway, parseMyAccess } from '../aiGateway';

afterEach(() => { mocks.rpc.mockReset(); });

describe('Trung tâm AI · cấp AI theo người', () => {
  it('đọc tổng quan: số chuỗi → số, hiệu lực (riêng ?? mẫu), dùng hôm nay / tháng; dòng hỏng bỏ qua', () => {
    const o = parseOverview({
      templates: [{ id: 't1', name: 'Tiêu chuẩn', connectionId: 'c1', monthlyCostCapUsd: '3.00', dailyQuestionCap: 30, skills: ['assistant_chat'], users: '2' }, { name: 'hỏng' }],
      grants: [{ userId: 'u1', name: 'Sơn', email: 's@x', enabled: true, templateId: 't1', dailyQuestionCap: 40, skills: null,
        effective: { enabled: true, templateName: 'Tiêu chuẩn', connectionId: 'c1', monthlyCostCapUsd: '3.00', dailyQuestionCap: 40, skills: ['assistant_chat'] },
        usage: { today: 28, monthRuns: '54', monthCostUsd: '0.5600', lastAt: null } }],
      skills: [{ code: 'assistant_chat', name: 'Trợ lý', access: 'granted', enabled: true, dailyLimit: 80 }, { code: 'x', access: 'lạ' }],
      connections: [{ id: 'c1', name: 'RevidAPI', model: 'claude-sonnet-5-5', enabled: true, pricePerCall: '0.008000' }],
      settings: { monthlyCostCapUsd: '20.00', monthlyRunCap: 3000 }, month: { runs: 214, costUsd: '3.42' },
    });
    expect(o.templates).toEqual([{ id: 't1', name: 'Tiêu chuẩn', connectionId: 'c1', extraConnectionIds: [], monthlyCostCapUsd: 3, dailyQuestionCap: 30, skills: ['assistant_chat'], note: '', users: 2 }]);
    expect(o.grants[0]).toMatchObject({ dailyQuestionCap: 40, skills: null, monthlyCostCapUsd: null, effective: { monthlyCostCapUsd: 3, dailyQuestionCap: 40 }, usage: { monthRuns: 54, monthCostUsd: 0.56 } });
    expect(o.skills.map(s => s.access)).toEqual(['granted', 'everyone']);
    expect(o.connections[0].pricePerCall).toBe(0.008);
    expect(o.settings).toEqual({ monthlyCostCapUsd: 20, monthlyRunCap: 3000 });
    expect(usedPct(28, 40)).toBe(70);
    expect(usedPct(1, null)).toBeNull();
    expect(usd(3)).toBe('$3.00');
    expect(usd(10)).toBe('$10');
  });

  it('lưu cấp phát: null = theo mẫu (gửi chuỗi rỗng); lỗi máy chủ thành lời dễ hiểu', async () => {
    expect(grantPayload({ enabled: true, templateId: 't1', connectionId: null, extraConnectionIds: null, monthlyCostCapUsd: null, dailyQuestionCap: 20, skills: null, note: ' thử ' }))
      .toEqual({ enabled: true, templateId: 't1', connectionId: '', extraConnectionIds: null, monthlyCostCapUsd: '', dailyQuestionCap: 20, skills: null, note: 'thử' });
    mocks.rpc.mockResolvedValueOnce({ data: { saved: 2 }, error: null });
    await aiAdminService.saveGrants(['u1', 'u2'], { enabled: true, templateId: 't1', connectionId: 'c2', extraConnectionIds: ['c3'], monthlyCostCapUsd: 5, dailyQuestionCap: null, skills: ['assistant_chat'], note: '' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('ai_admin_grant_save_v1', { p_user_ids: ['u1', 'u2'],
      p: { enabled: true, templateId: 't1', connectionId: 'c2', extraConnectionIds: ['c3'], monthlyCostCapUsd: 5, dailyQuestionCap: '', skills: ['assistant_chat'], note: '' } });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'AI_TEMPLATE_IN_USE' } });
    await expect(aiAdminService.deleteTemplate('t1')).rejects.toThrow('Mẫu đang được dùng');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'AI_ADMIN_REQUIRED' } });
    await expect(aiAdminService.overview()).rejects.toThrow('Chỉ Quản trị AI');
  });

  it('quyền AI của tôi + lời báo khi chưa được cấp / hết trần theo người', async () => {
    expect(parseMyAccess({ assistant: false, usedToday: 3, admin: 'Admin Hoàng' })).toEqual({ assistant: false, dailyQuestionCap: null, monthlyCostCapUsd: null, usedToday: 3, monthCostUsd: 0, admin: 'Admin Hoàng', models: [] });
    expect(parseMyAccess({ models: [{ id: 'c1', name: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5', blurb: 'Hiểu sâu', icon: '🧠', vision: true, default: true }, { id: 'c2', model: 'deepseek', vision: false }, { name: 'hỏng' }] }).models)
      .toEqual([{ id: 'c1', name: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5', blurb: 'Hiểu sâu', icon: '🧠', vision: true, isDefault: true },
        { id: 'c2', name: 'deepseek', model: 'deepseek', blurb: '', icon: '', vision: false, isDefault: false }]);
    expect(parseMyAccess({}).assistant).toBe(true);
    mocks.rpc.mockResolvedValueOnce({ data: { assistant: true, dailyQuestionCap: 30, usedToday: 27, monthlyCostCapUsd: '3.00', monthCostUsd: '0.4' }, error: null });
    expect(await aiGateway.myAccess()).toMatchObject({ dailyQuestionCap: 30, usedToday: 27, monthlyCostCapUsd: 3, monthCostUsd: 0.4 });
    expect(aiErrorMessage({ code: 'AI_QUOTA', reason: 'user_day', dailyLimit: 30 })).toBe('Bạn đã dùng hết 30 câu AI hôm nay — mai dùng tiếp, hoặc nhờ Quản trị AI nâng trần.');
    expect(aiErrorMessage({ code: 'AI_QUOTA', reason: 'user_month' })).toBe('Bạn đã dùng hết trần AI tháng này — nhờ Quản trị AI nâng trần.');
    expect(aiErrorMessage({ code: 'AI_DENIED' })).toContain('nhờ Quản trị AI cấp ở Trung tâm AI');
  });
});

describe('B4 bản tin Admin tuần — đọc hàng máy chủ', () => {
  it('parseDigest: đọc tuần, việc, tín hiệu; thiếu trường → 0 / null; không có week_start → null; mondayOf đúng Thứ Hai', async () => {
    const { parseDigest, mondayOf } = await import('../aiAdmin');
    const d = parseDigest({ week_start: '2026-10-12', week_end: '2026-10-18', generated_at: '2026-10-19T00:00:05Z', sent_at: null, recipients: '0',
      picks: [{ key: 'ai_errors', score: 95, title: 'Kiểm cổng AI', detail: 'AI_TIMEOUT ×5', link: '/settings?tab=ai-gateway' }, { title: '' }],
      signals: { assistant: { runs: 61, errors: '5', errorCodes: [{ code: 'AI_TIMEOUT', n: 5 }], idle: ['A', null], jev: { auto: 27, autoAgree: 15 } }, feedback: { new: 0, oldestOpenDays: null }, stale: { leavePending3d: 4 } } })!;
    expect(d).toMatchObject({ weekStart: '2026-10-12', sentAt: null, recipients: 0, picks: [{ key: 'ai_errors', score: 95, link: '/settings?tab=ai-gateway' }],
      assistant: { runs: 61, errors: 5, errorCodes: [{ code: 'AI_TIMEOUT', n: 5 }], idle: ['A'], jev: { auto: 27, autoAgree: 15, n: 0 }, commands: { prepared: 0, done: 0 } },
      feedback: { new: 0, open: 0, oldestOpenDays: null }, stale: { leavePending3d: 4, wfRunningStale7d: 0 } });
    expect(d.picks).toHaveLength(1);
    expect(parseDigest({ picks: [] })).toBeNull();
    expect(mondayOf(new Date(2026, 9, 21))).toBe('2026-10-19');
    expect(mondayOf(new Date(2026, 9, 19))).toBe('2026-10-19');
    expect(mondayOf(new Date(2026, 9, 18))).toBe('2026-10-12');
  });
});
