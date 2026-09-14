import { describe, expect, it } from 'vitest';
import { buildRequestCommentDocument } from '../requestDiscussionModel';

describe('request discussion document builder', () => {
  it('preserves visual order and repeated mentions', () => {
    const document = buildRequestCommentDocument(
      '@Nguyễn Văn An trao đổi với @Trần Minh rồi nhắc lại @Nguyễn Văn An',
      [
        { userId: 'an-id', name: 'Nguyễn Văn An' },
        { userId: 'minh-id', name: 'Trần Minh' },
      ],
    );

    expect(document.content[0].content).toEqual([
      { type: 'mention', userId: 'an-id', label: 'Nguyễn Văn An' },
      { type: 'text', text: ' trao đổi với ' },
      { type: 'mention', userId: 'minh-id', label: 'Trần Minh' },
      { type: 'text', text: ' rồi nhắc lại ' },
      { type: 'mention', userId: 'an-id', label: 'Nguyễn Văn An' },
    ]);
  });

  it('keeps unknown @tokens as plain text', () => {
    expect(buildRequestCommentDocument('@nguoi-khong-hop-le', []).content[0].content)
      .toEqual([{ type: 'text', text: '@nguoi-khong-hop-le' }]);
  });
});
