import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

import { matchWorkPerson, parseDueText, resolveDue, workBriefFacts, workDueAssessment, workPeopleLines, localIsoDate } from '../work/workAi';
import type { WorkAssignablePerson, WorkTaskBrief } from '../work/workBoardService';
import { parseCommand, workTaskView } from '../assistantCommands';
import { createWorkTaskCardActions } from '../assistantWorkTask';
import { SKILLS } from '../../supabase/functions/ai-gateway/skills';
import { SKILL_INFO } from '../../supabase/functions/ai-gateway/catalog';
import { WORK_SKILLS, workDayLabel } from '../../supabase/functions/ai-gateway/workSkills';
import { dueAssessment, matchPeople, personRows } from '../../supabase/functions/ai-gateway/workTools';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { chatSystem } from '../../supabase/functions/ai-gateway/chat';

const migration = readFileSync('supabase/migrations/20261022130000_work_dot1_ai.sql', 'utf8');
const person = (userId: string, name: string, unit: string | null, extra: Partial<WorkAssignablePerson> = {}): WorkAssignablePerson => ({
  userId, name, title: null, unit: unit ? { id: `u-${unit}`, code: unit, name: unit } : null, myTeam: false, sameUnit: false, isMe: false,
  canReceive: true, load: 0, aliases: [], ...extra,
});
const PEOPLE = [
  person('me', 'Phan Quốc Bảo', 'BLĐ', { isMe: true }),
  person('ha1', 'Đặng Thu Hà', 'KH'), person('ha2', 'Lý Thị Hà', 'TCKT'),
  person('do', 'Vương Thành Đô', 'QLDA', { aliases: ['Đô trưởng phòng'] }),
  person('huong', 'Trịnh Thị Hương', 'TCKT'), person('off', 'Lương Văn Tiến', 'QLDA', { canReceive: false }),
];

describe('Vioo Work PR-3 · khớp người trên máy', () => {
  it('tên gọi một người → chọn luôn; trùng tên → hỏi lại; "tôi" → chính mình', () => {
    expect(matchWorkPerson('anh Đô', null, PEOPLE)).toMatchObject({ kind: 'one', person: { userId: 'do' }, exact: false });
    expect(matchWorkPerson('Hà', null, PEOPLE)).toMatchObject({ kind: 'many' });
    expect((matchWorkPerson('Hà', null, PEOPLE) as { people: WorkAssignablePerson[] }).people.map(p => p.userId)).toEqual(['ha1', 'ha2']);
    expect(matchWorkPerson('Hà KH', null, PEOPLE)).toMatchObject({ kind: 'one', person: { userId: 'ha1' } });
    expect(matchWorkPerson('tôi', null, PEOPLE)).toMatchObject({ kind: 'one', person: { userId: 'me' }, exact: true });
    expect(matchWorkPerson('Trịnh Thị Hương', null, PEOPLE)).toMatchObject({ kind: 'one', person: { userId: 'huong' }, exact: true });
    expect(matchWorkPerson('Đô trưởng phòng', null, PEOPLE)).toMatchObject({ kind: 'one', person: { userId: 'do' }, exact: true });
  });

  it('họ tên AI chắc chỉ nhận khi khớp chữ trong câu; người chưa nhận việc được thì không chọn', () => {
    expect(matchWorkPerson('Hà', 'Lý Thị Hà', PEOPLE)).toMatchObject({ kind: 'one', person: { userId: 'ha2' } });
    expect(matchWorkPerson('Hà', 'Vương Thành Đô', PEOPLE)).toMatchObject({ kind: 'many' });
    expect(matchWorkPerson('Tiến', null, PEOPLE)).toEqual({ kind: 'none' });
    expect(matchWorkPerson('Tuấn', null, PEOPLE)).toEqual({ kind: 'none' });
  });

  it('danh sách gửi AI chỉ họ tên + đơn vị + cách gọi, bỏ người chưa nhận việc được', () => {
    const lines = workPeopleLines(PEOPLE);
    expect(lines).toContain('Tôi (người giao): Phan Quốc Bảo · BLĐ');
    expect(lines).toContain('Vương Thành Đô · QLDA (gọi: Đô trưởng phòng)');
    expect(lines).not.toContain('Tiến');
    expect(lines).not.toMatch(/ha1|u-KH/);
  });

  it('công cụ Trợ lý khớp người cùng quy tắc', () => {
    const rows = personRows({ canAssignOthers: true, people: PEOPLE }).people;
    expect(matchPeople('anh Đô', rows).map(p => p.userId)).toEqual(['do']);
    expect(matchPeople('Hà', rows).map(p => p.userId)).toEqual(['ha1', 'ha2']);
    expect(matchPeople('Hà KH', rows).map(p => p.userId)).toEqual(['ha1']);
    expect(matchPeople('tôi', rows).map(p => p.userId)).toEqual(['me']);
  });
});

describe('Vioo Work PR-3 · đổi chữ hạn thành ngày', () => {
  const now = new Date(2026, 9, 20, 10, 30); // thứ 3 20/10
  const at = (text: string) => { const d = parseDueText(text, now); return d && `${localIsoDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  it.each([
    ['thứ 6', '2026-10-23 17:00'], ['trước T6', '2026-10-23 17:00'], ['thứ 6 tuần sau', '2026-10-30 17:00'], ['thứ 2', '2026-10-26 17:00'],
    ['cuối tuần', '2026-10-24 17:00'], ['tuần sau', '2026-10-31 17:00'], ['đầu tuần sau', '2026-10-26 17:00'], ['mai', '2026-10-21 17:00'],
    ['9h sáng mai', '2026-10-21 09:00'], ['2h chiều mai', '2026-10-21 14:00'], ['ngày kia', '2026-10-22 17:00'], ['trong một tuần', '2026-10-27 17:00'],
    ['3 ngày nữa', '2026-10-23 17:00'], ['trước 25/10 lúc 9h', '2026-10-25 09:00'], ['5/1', '2027-01-05 17:00'], ['hôm nay', '2026-10-20 17:00'],
    ['cuối tháng', '2026-10-31 17:00'], ['chủ nhật', '2026-10-25 17:00'],
  ])('%s → %s', (text, want) => expect(at(text)).toBe(want));
  it('không hiểu thì không đoán', () => {
    expect(parseDueText('khi nào rảnh', now)).toBeNull();
    expect(parseDueText(null, now)).toBeNull();
  });
  it('thứ 3 đã qua 17:00 → thứ 3 tuần sau', () => expect(localIsoDate(parseDueText('thứ 3', new Date(2026, 9, 20, 18))!)).toBe('2026-10-27'));
  it('chữ hạn của câu thắng ngày AI tính; lệch ngày thì đưa cả hai để chọn', () => {
    const r = resolveDue({ dueText: 'thứ 6', dueDate: '2026-10-30', dueTime: null }, now);
    expect(localIsoDate(r.at!)).toBe('2026-10-23');
    expect(localIsoDate(r.alt!)).toBe('2026-10-30');
    expect(resolveDue({ dueText: null, dueDate: '2026-10-28', dueTime: '09:30' }, now).at!.getHours()).toBe(9);
    expect(resolveDue({ dueText: null, dueDate: '2026-10-01', dueTime: null }, now).at).toBeNull();
  });
});

describe('Vioo Work PR-3 · số liệu tóm tắt do máy tính', () => {
  it('kịp hạn: quá hạn / nguy cơ trễ / đang kịp', () => {
    const now = new Date('2026-10-20T03:00:00Z');
    const base = { status: 'in_progress', createdAt: '2026-10-10T03:00:00Z', deadlineAt: '2026-10-30T03:00:00Z' };
    expect(workDueAssessment({ ...base, progressPercent: 10 }, now)).toBe('Có nguy cơ trễ: đã qua 50% thời gian, tiến độ 10%');
    expect(workDueAssessment({ ...base, progressPercent: 40 }, now)).toBe('Đang kịp: đã qua 50% thời gian, tiến độ 40%');
    expect(workDueAssessment({ ...base, deadlineAt: '2026-10-17T03:00:00Z', progressPercent: 40 }, now)).toBe('Đã quá hạn 3 ngày');
    expect(workDueAssessment({ ...base, status: 'completed', progressPercent: 100 }, now)).toBe('Đã hoàn thành');
    expect(dueAssessment({ ...base, progressPercent: 10 }, now.getTime())).toBe(workDueAssessment({ ...base, progressPercent: 10 }, now));
  });
  it('dòng số liệu có đánh giá hạn, người làm chưa nhận, vướng gần nhất', () => {
    const brief = {
      task: { id: 't', code: 'VW-2026-000214', title: 'Rà soát hồ sơ thanh toán đợt 3', status: 'blocked', level: 'A', privacy: 'standard', deadlineAt: '2026-10-17T10:00:00Z',
        plannedStartAt: null, progressPercent: 40, labels: [], description: '', createdAt: '2026-10-10T03:00:00Z', completedAt: null, lastProgressAt: '2026-10-18T03:00:00Z',
        createdBy: { id: 'me', name: 'Phan Quốc Bảo' }, reviewer: null },
      origin: { origin: 'directive', claimStatus: 'not_needed', decidedAt: null, giver: { id: 'tgd', name: 'Tổng giám đốc' }, meeting: { id: 'm', title: 'Giao ban tuần 43', heldOn: '2026-10-19' } },
      assignees: [{ userId: 'do', name: 'Vương Thành Đô', state: 'active', acknowledgedAt: null, completedAt: null }],
      checklist: { done: 1, total: 4 }, children: { open: 0, total: 0 },
      updates: [{ at: '2026-10-18T03:00:00Z', author: 'Vương Thành Đô', done: 'Đối chiếu xong 2/3 hồ sơ', blocked: 'Chờ CĐT ký biên bản', progressBefore: 20, progressAfter: 40, files: 0, ai: false }],
      events: [],
    } as unknown as WorkTaskBrief;
    const facts = workBriefFacts(brief, new Date('2026-10-20T03:00:00Z'));
    expect(facts).toContain('Mức: A · Trọng điểm');
    expect(facts).toContain('Trạng thái: Đang bị chặn · tiến độ 40%');
    expect(facts).toContain('Đánh giá hạn: Đã quá hạn 3 ngày');
    expect(facts).toContain('Người làm: Vương Thành Đô (chưa nhận việc)');
    expect(facts).toContain('Nguồn: Chỉ đạo · Giao ban tuần 43 · Tổng giám đốc');
    expect(facts).toContain('Vướng: Chờ CĐT ký biên bản');
    expect(facts).toContain('Checklist: 1/4 mục xong');
  });
});

describe('Vioo Work PR-3 · 5 skill trong cổng AI', () => {
  it('đã đăng ký + có dòng "Xem bên trong"; lời dặn cấm bịa người / ngày', () => {
    for (const def of WORK_SKILLS) {
      expect(SKILLS[def.code]).toBe(def);
      expect(SKILL_INFO[def.code]?.where).toMatch(/Vioo Work/);
      expect(def.noThinking).toBe(true);
    }
    expect(SKILLS.work_task_draft.system).toMatch(/Không bịa người, ngày, số/);
    expect(SKILLS.work_meeting_tasks.images).toBeTypeOf('function');
    expect(SKILLS.work_meeting_tasks.textUsesFast).toBe(true);
    expect(SKILLS.work_task_draft.images).toBeUndefined();
  });

  it('đầu vào: kiểm độ dài, ngày máy người dùng lệch quá 2 ngày thì dùng ngày máy chủ', () => {
    expect(() => SKILLS.work_task_draft.parseInput({ text: 'ab' })).toThrow('AI_BAD_INPUT');
    expect(() => SKILLS.work_meeting_tasks.parseInput({ text: 'ngắn' })).toThrow('AI_BAD_INPUT');
    expect(() => SKILLS.work_update_draft.parseInput({ notes: 'xong', task: '' })).toThrow('AI_BAD_INPUT');
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    expect(SKILLS.work_task_draft.parseInput({ text: 'Hà rà soát HĐ', today: '2020-01-01' }).today).toBe(today);
    expect(SKILLS.work_task_draft.user({ text: 'Hà rà soát HĐ', today: '2026-10-20', people: 'Đặng Thu Hà · KH' }))
      .toContain('Hôm nay: Thứ 3 20/10/2026 (2026-10-20)');
    expect(workDayLabel('2026-10-25')).toBe('Chủ nhật 25/10/2026 (2026-10-25)');
  });

  it('chuẩn hóa kết quả: bỏ ngày / giờ / mức sai, cắt danh sách, % ngoài 0–100 thành null', () => {
    const d = SKILLS.work_task_draft.parseOutput({ title: 'Rà soát HĐ cốp pha', assignee: 'Hà', assigneeName: 'null', dueText: 'thứ 6', dueDate: '23/10/2026',
      dueTime: '25:00', level: 'D', description: '', checklist: ['a', '', 'b'], tags: ['SMB'], evidence: { photo: true }, warnings: [] });
    expect(d).toMatchObject({ assignee: 'Hà', assigneeName: null, dueDate: null, dueTime: null, level: null, checklist: ['a', 'b'], evidence: { photo: true, file: false } });
    const m = SKILLS.work_meeting_tasks.parseOutput({ meetingTitle: 'Giao ban', heldOn: '2026-10-19', chairman: 'TGĐ', warnings: [],
      tasks: [{ title: 'Chốt dòng tiền', assignee: 'chị Hương', level: 'A', dueDate: '2026-10-24' }, { title: '' }] });
    expect((m.tasks as unknown[]).length).toBe(1);
    expect(SKILLS.work_update_draft.parseOutput({ done: 'x', doing: '', next: '', blocked: '', percent: 140, warnings: [] }).percent).toBeNull();
    expect(SKILLS.work_update_draft.parseOutput({ done: 'x', doing: '', next: '', blocked: '', percent: '60%', warnings: [] }).percent).toBe(60);
  });
});

describe('Vioo Work PR-3 · công cụ Trợ lý (lệnh máy chủ giả)', () => {
  const rpcOf = (table: Record<string, (args: Record<string, unknown>) => unknown>) => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      const hit = table[fn];
      if (!hit) return { data: null, error: { message: 'unknown', code: 'X' } };
      const data = hit(args);
      return data instanceof Error ? { data: null, error: { message: data.message, code: '42501' } } : { data, error: null };
    }) as Rpc;
    return { rpc, calls };
  };
  const people = () => ({ canAssignOthers: true, people: PEOPLE });

  it('viec_giao: khớp người rồi đọc việc theo quyền; trùng tên thì trả danh sách để hỏi lại', async () => {
    const { rpc, calls } = rpcOf({ work_assignable_people_v1: people, work_tasks_overview_v1: () => ({ unit: null, total: 1, overdue: 1, stale: 0,
      items: [{ id: 't1', code: 'VW-2026-000214', title: 'Rà soát hồ sơ thanh toán', status: 'in_progress', level: 'A', deadlineAt: '2026-10-17T10:00:00Z',
        progressPercent: 40, lastProgressAt: new Date(Date.now() - 50 * 3_600_000).toISOString(), overdue: true, assignees: [{ name: 'Vương Thành Đô' }], createdByName: 'Hoàng' }] }) });
    const book = new SourceBook();
    const out = JSON.parse(await runTool('viec_giao', { nguoi: 'anh Đô', trang_thai: 'qua_han' }, { rpc, book }, new Map()));
    expect(calls[1]).toEqual(['work_tasks_overview_v1', { p_assignee_user_id: 'do', p_unit_query: null, p_state: 'overdue', p_due_before: null, p_limit: 30 }]);
    expect(out).toMatchObject({ nguoi: 'Vương Thành Đô · QLDA', tong: 1, qua_han: 1, viec: [{ ref: 'h1', ma: 'VW-2026-000214', muc: 'A · Trọng điểm', trang_thai: 'Đang thực hiện', tien_do: '40%', cap_nhat: '2 ngày trước' }] });
    const many = JSON.parse(await runTool('viec_giao', { nguoi: 'Hà' }, { rpc, book }, new Map()));
    expect(many.trung_ten).toEqual(['Đặng Thu Hà · KH', 'Lý Thị Hà · TCKT']);
  });

  it('viec_giao: máy chủ chặn theo quyền → nói rõ ngoài phạm vi', async () => {
    const { rpc } = rpcOf({ work_assignable_people_v1: people, work_tasks_overview_v1: () => new Error('WORK_TASK_NOT_FOUND') });
    const out = JSON.parse(await runTool('viec_giao', { don_vi: 'QLDA' }, { rpc, book: new SourceBook() }, new Map()));
    expect(out.loi).toMatch(/Ngoài phạm vi người hỏi được xem/);
  });

  it('tom_tat_viec: "214" → mã năm nay; trả đánh giá hạn máy tính', async () => {
    const { rpc, calls } = rpcOf({
      search_global_v1: () => ({ records: [{ kind: 'work_task', id: 't1', code: 'VW-2026-000214', title: 'Rà soát' }] }),
      work_task_brief_v1: () => ({ task: { id: 't1', code: 'VW-2026-000214', title: 'Rà soát', status: 'in_progress', level: 'B', progressPercent: 30,
        deadlineAt: new Date(Date.now() - 20 * 3_600_000).toISOString(), createdAt: '2026-10-01T00:00:00Z', createdBy: { name: 'Hoàng' } },
        assignees: [{ name: 'Đô', acknowledgedAt: '2026-10-02T00:00:00Z' }], checklist: { done: 1, total: 2 }, children: { open: 0, total: 0 }, updates: [], origin: null }),
    });
    const out = JSON.parse(await runTool('tom_tat_viec', { ma: '214' }, { rpc, book: new SourceBook() }, new Map()));
    const year = new Date(Date.now() + 7 * 3_600_000).getUTCFullYear();
    expect(JSON.stringify(calls[0][1].p_terms)).toContain(`vw-${year}-000214`);
    expect(out).toMatchObject({ ma: 'VW-2026-000214', tien_do: '30%', danh_gia_han: 'Đã quá hạn 1 ngày', nguoi_lam: ['Đô'], checklist: '1/2 mục xong' });
  });

  it('chuan_bi_giao_viec: đủ người → thẻ nháp work_task (không giao); không có quyền giao người khác → báo rõ', async () => {
    const emitted: Array<Record<string, unknown>> = [];
    const { rpc, calls } = rpcOf({ work_assignable_people_v1: people, assistant_command_create_v1: args => ({ id: 'cmd1', kind: args.p_kind, status: 'prepared', payload: args.p_payload }) });
    const ctx = { rpc, book: new SourceBook(), runId: 'run1', emit: (e: Record<string, unknown>) => emitted.push(e) };
    const out = JSON.parse(await runTool('chuan_bi_giao_viec', { viec: 'Rà soát hồ sơ thanh toán đợt 3 SMB', nguoi: 'anh Đô', han: '2099-10-23', muc: 'A', checklist: ['Đối chiếu', ''] }, ctx, new Map()));
    const created = calls.find(c => c[0] === 'assistant_command_create_v1')![1];
    expect(created).toMatchObject({ p_kind: 'work_task', p_payload: { assigneeUserId: 'do', deadlineDate: '2099-10-23', deadlineTime: '17:00', level: 'A', checklist: ['Đối chiếu'], runId: 'run1' } });
    expect(out).toMatchObject({ da_hien_the: true, nguoi_lam: 'Vương Thành Đô · QLDA' });
    expect(emitted[0]).toMatchObject({ type: 'command' });
    const self = rpcOf({ work_assignable_people_v1: () => ({ canAssignOthers: false, people: PEOPLE }) });
    const denied = JSON.parse(await runTool('chuan_bi_giao_viec', { viec: 'Rà soát', nguoi: 'anh Đô' }, { ...ctx, rpc: self.rpc }, new Map()));
    expect(denied.loi).toMatch(/chưa có quyền giao việc cho người khác/);
    const past = JSON.parse(await runTool('chuan_bi_giao_viec', { viec: 'Rà soát', han: '2020-01-01' }, ctx, new Map()));
    expect(past.loi).toMatch(/Hạn chưa đúng/);
  });

  it('lời dặn Trợ lý: gọi công cụ Vioo Work, không nói là đã giao', () => {
    const system = chatSystem('Anh', [], true, 'Thứ 3 20/10/2026');
    expect(system).toContain('chuan_bi_giao_viec');
    expect(system).toContain('không nói là đã giao');
    expect(system).toContain('giao việc (Vioo Work)');
  });
});

describe('Vioo Work PR-3 · thẻ Giao việc', () => {
  const RAW = { id: 'c9', kind: 'work_task', status: 'prepared', title: 'Giao việc: Rà soát', createdAt: '2026-10-20T02:00:00Z',
    payload: { title: 'Rà soát', assigneeUserId: 'do', assigneeName: 'Vương Thành Đô', deadlineDate: '2099-10-23', deadlineTime: '09:30', level: 'A', checklist: ['a', 1], runId: 'run1' } };
  it('đọc thẻ work_task', () => {
    const c = parseCommand(RAW)!;
    expect(c.kind).toBe('work_task');
    expect(workTaskView(c)).toMatchObject({ assigneeUserId: 'do', deadlineDate: '2099-10-23', deadlineTime: '09:30', level: 'A', checklist: ['a'], runId: 'run1' });
  });

  it('Giao: xem trước → tạo; mạng lỗi bấm lại dùng cùng khóa; xong ghi biên nhận + gắn lượt AI', async () => {
    const keys: string[] = [];
    let fail = true;
    const service = {
      preview: vi.fn(async () => ({ validCount: 1, fingerprint: 'fp' })),
      create: vi.fn(async (_input: unknown, key: string) => { keys.push(key); if (fail) { fail = false; throw new Error('Failed to fetch'); } return { taskId: 't9', taskCode: 'VW-2026-000301' }; }),
    };
    const board = { assignablePeople: vi.fn(), linkAi: vi.fn(async () => ({})) };
    const finish = vi.fn(async (id: string, status: string, result: Record<string, unknown>) => ({ ...parseCommand(RAW)!, id, status, result } as never));
    const actions = createWorkTaskCardActions(service as never, board as never, finish as never);
    const form = { title: 'Rà soát', assigneeId: 'do', assigneeName: 'Vương Thành Đô', deadline: new Date(2099, 9, 23, 9, 30), level: 'A' as const, description: '', checklist: ['a'] };
    await expect(actions.give(parseCommand(RAW)!, form)).rejects.toThrow();
    const done = await actions.give(parseCommand(RAW)!, form);
    expect(keys[0]).toBe(keys[1]);
    expect(service.preview).toHaveBeenCalledTimes(1);
    expect(board.linkAi).toHaveBeenCalledWith('t9', 'run1', 'assistant');
    expect(done.status).toBe('done');
    expect(finish.mock.calls[0][2]).toMatchObject({ code: 'VW-2026-000301', route: '/work/tasks/VW-2026-000301', assigneeName: 'Vương Thành Đô' });
  });
});

describe('Vioo Work PR-3 · hợp đồng migration', () => {
  it('5 skill bật, chỉ người Vioo Work, chung 20 lượt / ngày', () => {
    expect(migration).toContain("insert into public.ai_quota_groups (code, name, daily_limit) values ('work', 'Vioo Work', 20);");
    expect(migration).toContain("update public.ai_skills set enabled = true, required_permission = 'work.module.access', quota_group = 'work', daily_limit = 20");
    expect(migration).toMatch(/if s\.required_permission is not null and not app_private\.has_permission\(a, s\.required_permission, 'global', '\*'\) then/);
    expect(migration).toContain("'AI_GROUP_DAILY_LIMIT'");
  });
  it('thẻ work_task + việc theo quyền xem + học cách gọi chỉ từ việc đã giao', () => {
    expect(migration).toContain("'memory_note', 'work_task'");
    expect(migration).toContain('and app_private.work_task_actor_can_view(t.id)');
    expect(migration).toMatch(/where t\.id = p_task_id and t\.created_by = v_actor;/);
    expect(migration).toMatch(/grant execute on function public\.work_tasks_overview_v1\(uuid, text, text, date, integer\) to authenticated;/);
  });
});
