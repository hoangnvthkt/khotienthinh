import { describe, expect, it } from 'vitest';
import {
  clearInventoryAuditCommandId,
  getOrCreateInventoryAuditCommand,
  getOrCreateInventoryAuditCommandId,
} from '../inventoryAuditCommand';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('inventory audit command identity', () => {
  it('reuses a command for retries within the same actor and warehouse', () => {
    const storage = new MemoryStorage();
    const first = getOrCreateInventoryAuditCommandId(' Warehouse-1 ', 'User-1', storage);
    const retry = getOrCreateInventoryAuditCommandId('warehouse-1', 'user-1', storage);

    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retry).toBe(first);
  });

  it('keeps auditedAt stable with the command so a lost-response retry has the same hash', () => {
    const storage = new MemoryStorage();
    const first = getOrCreateInventoryAuditCommand(
      'warehouse-time',
      'user-1',
      storage,
      () => '2026-07-15T01:00:00.000Z',
    );
    const retry = getOrCreateInventoryAuditCommand(
      'warehouse-time',
      'user-1',
      storage,
      () => '2026-07-15T02:00:00.000Z',
    );

    expect(retry).toEqual(first);
    expect(retry.auditedAt).toBe('2026-07-15T01:00:00.000Z');
  });

  it('isolates actors and warehouses and clears only the confirmed command', () => {
    const storage = new MemoryStorage();
    const first = getOrCreateInventoryAuditCommandId('warehouse-1', 'user-1', storage);
    expect(getOrCreateInventoryAuditCommandId('warehouse-2', 'user-1', storage)).not.toBe(first);
    expect(getOrCreateInventoryAuditCommandId('warehouse-1', 'user-2', storage)).not.toBe(first);

    clearInventoryAuditCommandId('warehouse-1', 'user-1', 'different-command', storage);
    expect(getOrCreateInventoryAuditCommandId('warehouse-1', 'user-1', storage)).toBe(first);

    clearInventoryAuditCommandId('warehouse-1', 'user-1', first, storage);
    expect(getOrCreateInventoryAuditCommandId('warehouse-1', 'user-1', storage)).not.toBe(first);
  });
});
