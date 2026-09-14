import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), upload: vi.fn(), invoke: vi.fn() }));

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
    functions: { invoke: mocks.invoke },
  },
}));

import { requestRuntimeService } from '../requestRuntimeService';

describe('request collaboration service contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates request content with optimistic concurrency and idempotency', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        requestId: 'rq-1', requestCode: 'RQ-1', status: 'PENDING',
        workflowInstanceId: 'wf-1', workflowSubjectId: 'subject-1',
        currentBlockKeys: ['manager'], updatedAt: '2026-09-14T05:00:00Z',
        contentRevision: 2,
      },
      error: null,
    });

    const result = await (requestRuntimeService as any).updateContent({
      requestId: 'rq-1',
      title: 'Mua bàn phím',
      description: 'Bổ sung cho cán bộ IT',
      formData: { quantity: 2 },
      expectedUpdatedAt: '2026-09-14T04:00:00Z',
      idempotencyKey: 'edit-key-1',
    });

    expect(result.contentRevision).toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith('update_request_content', {
      p_request_id: 'rq-1',
      p_title: 'Mua bàn phím',
      p_description: 'Bổ sung cho cán bộ IT',
      p_form_data: { quantity: 2 },
      p_expected_updated_at: '2026-09-14T04:00:00Z',
      p_idempotency_key: 'edit-key-1',
    });
  });

  it('lists a cursor page of comments and resolves mention candidates on the server', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { items: [], nextCursor: null, total: 0 }, error: null })
      .mockResolvedValueOnce({ data: { items: [{ userId: 'u-2', name: 'Nguyễn Văn An' }], nextCursor: null }, error: null });

    const comments = await (requestRuntimeService as any).listComments('rq-1', undefined, 30);
    const mentions = await (requestRuntimeService as any).listMentionCandidates('rq-1', 'an', undefined, 10);

    expect(comments).toEqual({ items: [], total: 0 });
    expect(mentions.items[0]).toEqual({ userId: 'u-2', name: 'Nguyễn Văn An' });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'list_request_comments', {
      p_request_id: 'rq-1', p_cursor: null, p_limit: 30,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'list_request_mention_candidates', {
      p_request_id: 'rq-1', p_search: 'an', p_cursor: null, p_limit: 10,
    });
  });

  it('sends structured mention content and attachment ids through one comment command', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: 'comment-1', lockVersion: 1 }, error: null });
    const content = {
      version: 1 as const,
      type: 'doc' as const,
      content: [{ type: 'paragraph' as const, content: [
        { type: 'mention' as const, userId: 'u-2', label: 'Nguyễn Văn An' },
        { type: 'text' as const, text: ' kiểm tra giúp anh' },
      ] }],
    };

    await (requestRuntimeService as any).comment('create', {
      requestId: 'rq-1', content, attachmentIds: ['attachment-1'],
    }, 'comment-key-1');

    expect(mocks.rpc).toHaveBeenCalledWith('command_request_comment', {
      p_command: 'create',
      p_payload: { requestId: 'rq-1', content, attachmentIds: ['attachment-1'] },
      p_idempotency_key: 'comment-key-1',
    });
  });

  it('reserves attachments through the dedicated typed command', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        attachmentId: 'attachment-1',
        storagePath: 'request/rq-1/attachment-1/original',
        expiresAt: '2026-09-14T05:15:00Z',
        status: 'pending',
      },
      error: null,
    });

    const reservation = await requestRuntimeService.reserveAttachment({
      requestId: 'rq-1', fileName: 'bao-gia.pdf', mimeType: 'application/pdf',
      sizeBytes: 1024, kind: 'discussion_file',
    }, 'attachment-key-1');

    expect(reservation.storagePath).toContain('attachment-1');
    expect(mocks.rpc).toHaveBeenCalledWith('command_request_comment', {
      p_command: 'reserve_attachment',
      p_payload: {
        requestId: 'rq-1', fileName: 'bao-gia.pdf', mimeType: 'application/pdf',
        sizeBytes: 1024, kind: 'discussion_file',
      },
      p_idempotency_key: 'attachment-key-1',
    });
  });
});
