import { describe, expect, it } from 'vitest';
import {
  clearProjectOpeningBalanceCommandId,
  getOrCreateProjectOpeningBalanceCommandId,
} from '../projectOpeningBalanceCommand';

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

class ThrowingStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  getItem(): string | null {
    throw new DOMException('Storage is unavailable', 'SecurityError');
  }

  setItem(): void {
    throw new DOMException('Storage is unavailable', 'QuotaExceededError');
  }

  removeItem(): void {
    throw new DOMException('Storage is unavailable', 'SecurityError');
  }
}

describe('project opening-balance command identity', () => {
  it('reuses one command id for retries of the same normalized scope', () => {
    const storage = new MemoryStorage();
    const first = getOrCreateProjectOpeningBalanceCommandId(' Project-1_Site-1 ', 'user-1', storage);
    const retry = getOrCreateProjectOpeningBalanceCommandId('project-1_site-1', 'user-1', storage);

    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retry).toBe(first);
  });

  it('keeps independent commands per scope and clears only the confirmed command', () => {
    const storage = new MemoryStorage();
    const projectOne = getOrCreateProjectOpeningBalanceCommandId('project-1', 'user-1', storage);
    const projectTwo = getOrCreateProjectOpeningBalanceCommandId('project-2', 'user-1', storage);
    expect(projectTwo).not.toBe(projectOne);

    clearProjectOpeningBalanceCommandId('project-1', 'user-1', 'different-command', storage);
    expect(getOrCreateProjectOpeningBalanceCommandId('project-1', 'user-1', storage)).toBe(projectOne);

    clearProjectOpeningBalanceCommandId('project-1', 'user-1', projectOne, storage);
    expect(getOrCreateProjectOpeningBalanceCommandId('project-1', 'user-1', storage)).not.toBe(projectOne);
  });

  it('never reuses an idempotency command across actors in the same browser session', () => {
    const storage = new MemoryStorage();
    const firstActor = getOrCreateProjectOpeningBalanceCommandId('project-1', 'user-1', storage);
    const secondActor = getOrCreateProjectOpeningBalanceCommandId('project-1', 'user-2', storage);

    expect(secondActor).not.toBe(firstActor);
  });

  it('falls back to an in-memory command when sessionStorage operations are denied', () => {
    const storage = new ThrowingStorage();

    const first = getOrCreateProjectOpeningBalanceCommandId('project-denied', 'user-1', storage);
    const retry = getOrCreateProjectOpeningBalanceCommandId('project-denied', 'user-1', storage);
    expect(retry).toBe(first);
    expect(() => clearProjectOpeningBalanceCommandId(
      'project-denied',
      'user-1',
      first,
      storage,
    )).not.toThrow();
  });
});
