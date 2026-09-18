import { describe, expect, it } from 'vitest';
import { resolveNotificationPath } from '../notificationRoutes';

describe('generic Workflow notification routes', () => {
  it('resolves a generic Workflow notification to the canonical detail path', () => {
    expect(resolveNotificationPath({
      sourceType: 'workflow',
      metadata: { instanceId: 'wf-uuid', nodeId: 'node-uuid', commentId: 'comment-uuid' },
    } as any)).toBe('/wf/wf-uuid?node=node-uuid&comment=comment-uuid');
  });
});
