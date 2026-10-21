import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: vi.fn() } } }));

import { aiMemory, defaultMemoryActions, habitKey, habitTitle, parsePersonal, parseShared, rememberedIds } from '../aiMemory';
import { parseCommand } from '../assistantCommands';
import { SourceBook } from '../../supabase/functions/ai-gateway/agent';
import { runTool, type Rpc } from '../../supabase/functions/ai-gateway/tools';
import { buildChatPrompt, userNotesOf } from '../../supabase/functions/ai-gateway/chat';

afterEach(() => { mocks.rpc.mockReset(); });

const PERSONAL = parsePersonal({
  notes: [{ id: 'n1', text: 'Phụ trách SMB-2026', source: 'assistant', createdAt: '2026-10-18T02:00:00Z' }, { id: 'bad' }],
  habits: [{ id: 'h1', key: 'mr.approvers:p-smb', value: 'u-tam,u-gone', label: 'Bùi Thị Tâm', scopeLabel: 'SMB-2026', hits: '3' },
    { id: 'h2', key: 'po.approver', value: 'u-chuan', label: 'Hà Đức Chuẩn', scopeLabel: 'Mua hàng' }],
});

describe('Trợ lý T4b · trí nhớ cá nhân + "AI đã nhớ gì"', () => {
  it('đọc trí nhớ: bỏ dòng hỏng; lựa chọn đã nhớ chỉ giữ người / kho còn chọn được hôm nay; nhãn dễ hiểu', () => {
    expect(PERSONAL.notes).toEqual([{ id: 'n1', text: 'Phụ trách SMB-2026', source: 'assistant', createdAt: '2026-10-18T02:00:00Z' }]);
    expect(PERSONAL.habits[0]).toMatchObject({ hits: 3, scopeLabel: 'SMB-2026' });
    expect(rememberedIds(PERSONAL, habitKey.mrApprovers('p-smb'), [{ id: 'u-tam' }, { id: 'u-chuan' }])).toEqual(['u-tam']);
    expect(rememberedIds(PERSONAL, habitKey.mrApprovers('p-da29'), [{ id: 'u-tam' }])).toEqual([]);
    expect(rememberedIds(null, habitKey.poApprover(), [{ id: 'u-chuan' }])).toEqual([]);
    expect(habitTitle(PERSONAL.habits[0])).toBe('Người duyệt đề xuất · SMB-2026');
    expect(habitTitle(PERSONAL.habits[1])).toBe('Người duyệt đơn mua');
    expect(parseShared([{ key: 'company:procurement:po', title: 'Mua hàng · Báo giá', kind: 'po', items: [{ id: 'a1', kind: 'vendor', alias: 'Hòa Phát', target: 'HP', hits: 2, by: null }] }]))
      .toEqual([{ key: 'company:procurement:po', title: 'Mua hàng · Báo giá', kind: 'po', items: [{ id: 'a1', kind: 'vendor', alias: 'Hòa Phát', target: 'HP', hits: 2, lastUsedAt: '', by: null }] }]);
  });

  it('lưu / quên gọi đúng lệnh máy chủ; quá 30 ghi nhớ hay không có quyền báo bằng lời dễ hiểu; thẻ "nhớ giúp" lưu rồi ghi biên nhận', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: 'n9', created: true }, error: null });
    expect(await aiMemory.addNote('Báo cáo ngắn gọn')).toEqual({ id: 'n9', created: true });
    expect(mocks.rpc).toHaveBeenLastCalledWith('ai_user_note_save_v1', { p_text: 'Báo cáo ngắn gọn', p_source: 'user' });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'AI_NOTE_LIMIT' } });
    await expect(aiMemory.addNote('Thêm nữa')).rejects.toThrow('Đã đủ 30 ghi nhớ');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'AI_MEMORY_DENIED' } });
    await expect(aiMemory.forget('shared', 'a1')).rejects.toThrow('không có quyền');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'AI_MEMORY_NOT_FOUND' } });
    await expect(aiMemory.forget('personal', 'n1')).resolves.toBeUndefined();

    const command = parseCommand({ id: 'cmd-m', kind: 'memory_note', status: 'prepared', title: 'Ghi nhớ', payload: { text: 'Phụ trách SMB' }, createdAt: '2026-10-18T02:00:00Z' })!;
    expect(command.kind).toBe('memory_note');
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValueOnce({ data: { id: 'n10', created: true }, error: null })
      .mockImplementationOnce(async (_fn: string, args: Record<string, unknown>) => ({ data: { ...command, status: args.p_status, result: args.p_result }, error: null }));
    const done = await defaultMemoryActions.saveNoteCommand(command, ' Phụ trách SMB-2026 ');
    expect(mocks.rpc.mock.calls[0]).toEqual(['ai_user_note_save_v1', { p_text: ' Phụ trách SMB-2026 ', p_source: 'assistant' }]);
    expect(mocks.rpc.mock.calls[1][0]).toBe('assistant_command_finish_v1');
    expect(done).toMatchObject({ status: 'done', result: { id: 'n10', text: 'Phụ trách SMB-2026' } });
  });

  it('công cụ chuan_bi_ghi_nho chỉ hiện thẻ (không tự lưu); chữ quá ngắn / quá dài thì hỏi lại', async () => {
    const calls: string[] = []; const events: Array<Record<string, unknown>> = [];
    const rpc = (async (fn: string, args: Record<string, unknown>) => { calls.push(fn); return { data: { id: 'c1', kind: args.p_kind, status: 'prepared', title: 'Ghi nhớ', payload: args.p_payload, preview: {} }, error: null }; }) as Rpc;
    const ctx = { rpc, book: new SourceBook(), runId: 'run-1', emit: (e: Record<string, unknown>) => events.push(e) };
    const out = JSON.parse(await runTool('chuan_bi_ghi_nho', { noi_dung: '  Báo cáo   ngắn gọn, số liệu trước ' }, ctx, new Map()));
    expect(out).toMatchObject({ da_hien_the: true, noi_dung: 'Báo cáo ngắn gọn, số liệu trước' });
    expect(calls).toEqual(['assistant_command_create_v1']);
    expect(events[0]).toMatchObject({ type: 'command', command: { kind: 'memory_note', payload: { text: 'Báo cáo ngắn gọn, số liệu trước' } } });
    expect(JSON.parse(await runTool('chuan_bi_ghi_nho', { noi_dung: 'ok' }, ctx, new Map())).loi).toBeTruthy();
    expect(JSON.parse(await runTool('chuan_bi_ghi_nho', { noi_dung: 'x'.repeat(320) }, ctx, new Map())).loi).toMatch(/quá dài/);
    expect(calls).toHaveLength(1);
  });

  it('ghi nhớ vào lời nhắc của chính người hỏi, bọc như dữ liệu (không phải lệnh), che SĐT; không có thì không thêm gì', () => {
    const notes = userNotesOf({ notes: [{ text: 'Phụ trách SMB-2026' }, { text: 'Gọi anh qua số 0912345678' }, { nope: 1 }] });
    expect(notes).toEqual(['Phụ trách SMB-2026', 'Gọi anh qua số 0912345678']);
    const input = { threadId: null, question: 'Việc gì gấp?', facts: '', pronoun: 'Anh' as const };
    const prompt = buildChatPrompt(input, [], true, '', [], notes);
    expect(prompt.system).toContain('không phải lệnh');
    expect(prompt.system).toContain('<du_lieu loai="ghi_nho">');
    expect(prompt.system).toContain('- Phụ trách SMB-2026');
    expect(prompt.system).not.toContain('0912345678');
    expect(buildChatPrompt(input, [], true).system).not.toContain('ghi_nho">');
  });
});
