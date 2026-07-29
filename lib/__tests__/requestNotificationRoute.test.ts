import { describe, expect, it } from 'vitest';
import { resolveNotificationPath } from '../notificationRoutes';

describe('request notification routes', () => {
  it('routes request approval notifications to the canonical detail URL', () => {
    expect(resolveNotificationPath({
      sourceType: 'request_instance', sourceId: 'rq-uuid', metadata: { requestInstanceId: 'rq-uuid' },
    } as any)).toBe('/rq/rq-uuid');
  });
});
