import { describe, expect, it } from 'vitest';
import { saveAuthorizationAndRefresh } from '../permissions/authorizationSaveOutcome';

describe('authorization save outcome', () => {
  it('keeps the committed receipt when only snapshot refresh fails', async () => {
    let writes = 0;
    const result = await saveAuthorizationAndRefresh(
      async () => { writes++; return { userId: 'person-a', auditEventId: 'audit-1' }; },
      async () => { throw new Error('network unavailable'); },
    );
    expect(result.status).toBe('saved_refresh_pending');
    expect(result.receipt).toEqual({ userId: 'person-a', auditEventId: 'audit-1' });
    expect(writes).toBe(1);
  });

  it('does not refresh or report committed when the write is rejected', async () => {
    let reads = 0;
    await expect(saveAuthorizationAndRefresh(
      async () => { throw new Error('stale version'); },
      async () => { reads++; },
    )).rejects.toThrow('stale version');
    expect(reads).toBe(0);
  });

  it('refreshes the saved target before declaring refreshed', async () => {
    const events: string[] = [];
    const result = await saveAuthorizationAndRefresh(
      async () => { events.push('write'); return { userId: 'person-a' }; },
      async receipt => { events.push(`read:${receipt.userId}`); },
    );
    expect(events).toEqual(['write', 'read:person-a']);
    expect(result).toEqual({ status: 'saved_refreshed', receipt: { userId: 'person-a' } });
  });
});
