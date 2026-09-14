import type { RequestMentionCandidatePage, RequestTextDocument } from './requestRuntimeService';

type Mention = RequestMentionCandidatePage['items'][number];

export const buildRequestCommentDocument = (text: string, mentions: Mention[]): RequestTextDocument => {
  const nodes: RequestTextDocument['content'][number]['content'] = [];
  let rest = text;
  const tokens = mentions
    .map(mention => ({ mention, token: `@${mention.name}` }))
    .sort((left, right) => right.token.length - left.token.length);
  while (rest) {
    const next = tokens.reduce<{ mention: Mention; token: string; index: number } | null>((nearest, item) => {
      const index = rest.indexOf(item.token);
      if (index < 0 || (nearest && nearest.index <= index)) return nearest;
      return { ...item, index };
    }, null);
    if (!next) {
      nodes.push({ type: 'text', text: rest });
      break;
    }
    const { mention, token, index } = next;
    if (index) nodes.push({ type: 'text', text: rest.slice(0, index) });
    nodes.push({ type: 'mention', userId: mention.userId, label: mention.name });
    rest = rest.slice(index + token.length);
  }
  return { version: 1, type: 'doc', content: [{ type: 'paragraph', content: nodes }] };
};
