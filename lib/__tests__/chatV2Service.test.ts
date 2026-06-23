import { describe, expect, it } from 'vitest';
import { Role, User } from '../../types';
import {
  applyRealtimeMessageEvent,
  buildChatV2MessagePreview,
  getChatV2ConversationTitle,
  inferMessageKindFromAttachments,
  sanitizeChatFileName,
  summarizeReactions,
  isImageAttachment,
  ChatV2Conversation,
  ChatV2Message,
  ChatV2Reaction,
} from '../chatV2Service';

const users: User[] = [
  { id: 'u1', name: 'Nguyễn Văn A', email: 'a@example.com', role: Role.ADMIN },
  { id: 'u2', name: 'Trần Thị B', email: 'b@example.com', role: Role.EMPLOYEE },
  { id: 'u3', name: 'Lê Văn C', email: 'c@example.com', role: Role.EMPLOYEE },
];

const baseConversation: ChatV2Conversation = {
  id: 'c1',
  type: 'direct',
  metadata: {},
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z',
  participants: [
    {
      id: 'p1',
      conversationId: 'c1',
      userId: 'u1',
      role: 'owner',
      isMuted: false,
      isPinned: false,
      unreadCount: 0,
      joinedAt: '2026-06-23T00:00:00.000Z',
    },
    {
      id: 'p2',
      conversationId: 'c1',
      userId: 'u2',
      role: 'member',
      isMuted: false,
      isPinned: false,
      unreadCount: 0,
      joinedAt: '2026-06-23T00:00:00.000Z',
    },
  ],
  unreadCount: 0,
};

describe('chatV2Service helpers', () => {
  it('summarizes reactions without overwriting users reacting concurrently', () => {
    const reactions: ChatV2Reaction[] = [
      { id: 'r1', conversationId: 'c1', messageId: 'm1', userId: 'u1', emoji: '❤️', createdAt: '2026-06-23T00:00:00.000Z' },
      { id: 'r2', conversationId: 'c1', messageId: 'm1', userId: 'u2', emoji: '❤️', createdAt: '2026-06-23T00:00:01.000Z' },
      { id: 'r3', conversationId: 'c1', messageId: 'm1', userId: 'u3', emoji: '👍', createdAt: '2026-06-23T00:00:02.000Z' },
    ];

    expect(summarizeReactions(reactions, 'u2')).toEqual([
      { emoji: '❤️', count: 2, userIds: ['u1', 'u2'], reactedByMe: true },
      { emoji: '👍', count: 1, userIds: ['u3'], reactedByMe: false },
    ]);
  });

  it('builds direct and group conversation titles', () => {
    expect(getChatV2ConversationTitle(baseConversation, 'u1', users)).toBe('Trần Thị B');
    expect(getChatV2ConversationTitle({ ...baseConversation, type: 'group', name: 'Đội Sơn Miền Bắc' }, 'u1', users)).toBe('Đội Sơn Miền Bắc');
  });

  it('sanitizes storage file names and detects image attachments', () => {
    expect(sanitizeChatFileName('Ảnh nghiệm thu số 1.png')).toBe('Anh-nghiem-thu-so-1.png');
    expect(isImageAttachment({ mimeType: 'image/png', fileName: 'photo.png' })).toBe(true);
    expect(isImageAttachment({ mimeType: 'application/pdf', fileName: 'hop-dong.pdf' })).toBe(false);
  });

  it('builds structured message previews', () => {
    expect(buildChatV2MessagePreview('poll', '', { question: 'Chọn giờ họp' })).toBe('Bình chọn: Chọn giờ họp');
    expect(buildChatV2MessagePreview('checklist', '', { title: 'Giao hàng' })).toBe('Checklist: Giao hàng');
    expect(buildChatV2MessagePreview('quick_confirm', '', { title: 'Nhận bản vẽ' })).toBe('Xác nhận: Nhận bản vẽ');
    expect(buildChatV2MessagePreview('image', '', {})).toBe('Hình ảnh');
    expect(buildChatV2MessagePreview('file', '', {})).toBe('Tệp đính kèm');
    expect(buildChatV2MessagePreview('text', 'Nội dung rõ ràng', {})).toBe('Nội dung rõ ràng');
  });

  it('merges realtime message events without duplicates and removes deleted rows', () => {
    const message = (id: string, createdAt: string): ChatV2Message => ({
      id,
      conversationId: 'c1',
      senderId: 'u1',
      body: id,
      kind: 'text',
      metadata: {},
      payload: {},
      createdAt,
      updatedAt: createdAt,
      attachments: [],
      reactions: [],
      reactionSummary: [],
      pollVotes: [],
      checklistItems: [],
      quickConfirmResponses: [],
    });

    const first = message('m1', '2026-06-23T00:00:00.000Z');
    const second = message('m2', '2026-06-23T00:01:00.000Z');
    const merged = applyRealtimeMessageEvent([first], 'INSERT', second);
    expect(merged.map(item => item.id)).toEqual(['m1', 'm2']);
    expect(applyRealtimeMessageEvent(merged, 'INSERT', second).map(item => item.id)).toEqual(['m1', 'm2']);
    expect(applyRealtimeMessageEvent(merged, 'DELETE', null, 'm1').map(item => item.id)).toEqual(['m2']);
  });

  it('infers image-only attachments as image messages and mixed files as file messages', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const jpg = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    const pdf = new File(['x'], 'c.pdf', { type: 'application/pdf' });

    expect(inferMessageKindFromAttachments([])).toBe('text');
    expect(inferMessageKindFromAttachments([png, jpg])).toBe('image');
    expect(inferMessageKindFromAttachments([png, pdf])).toBe('file');
  });
});
