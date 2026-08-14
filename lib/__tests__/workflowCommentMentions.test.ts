import { describe, expect, it } from 'vitest';
import {
  findWorkflowMentionTrigger,
  insertWorkflowCommentMention,
  normalizeWorkflowCommentMentions,
  reconcileWorkflowCommentMentions,
} from '../workflowCommentMentions';

describe('workflow comment mentions', () => {
  it('detects an active @ token at the caret', () => {
    expect(findWorkflowMentionTrigger('Nhờ @Anh', 8)).toEqual({ start: 4, end: 8, query: 'Anh' });
    expect(findWorkflowMentionTrigger('Email a@b.vn', 12)).toBeNull();
  });

  it('inserts the selected employee and returns the next caret', () => {
    const result = insertWorkflowCommentMention({
      body: 'Nhờ @An kiểm tra',
      trigger: { start: 4, end: 7, query: 'An' },
      mention: { userId: 'u-2', displayName: 'Nguyễn Văn An' },
    });
    expect(result).toEqual({ body: 'Nhờ @Nguyễn Văn An kiểm tra', caret: 19 });
  });

  it('deduplicates mentions and removes a mention when its tag was deleted', () => {
    const mentions = normalizeWorkflowCommentMentions([
      { userId: 'u-2', displayName: 'Nguyễn Văn An' },
      { userId: 'u-2', displayName: 'Tên trùng' },
      { userId: '', displayName: 'Không hợp lệ' },
    ]);
    expect(mentions).toEqual([{ userId: 'u-2', displayName: 'Nguyễn Văn An' }]);
    expect(reconcileWorkflowCommentMentions('Đã xóa thẻ', mentions)).toEqual([]);
  });
});
