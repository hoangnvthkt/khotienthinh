import { afterEach, describe, expect, it, vi } from 'vitest';
import { readUiMode, writeUiMode } from '../centerMode';

// Giao diện mặc định là giao diện hiện tại; chỉ "center" khi chính người đó bật, lưu riêng theo tài khoản.
describe('Command Center UI mode', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubWindow = (initial: Record<string, string> = {}, failing = false) => {
    const store = new Map(Object.entries(initial));
    const events: string[] = [];
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => { if (failing) throw new Error('blocked'); return store.get(key) ?? null; },
        setItem: (key: string, value: string) => { if (failing) throw new Error('blocked'); store.set(key, value); },
      },
      dispatchEvent: (event: Event) => { events.push(event.type); return true; },
    });
    vi.stubGlobal('CustomEvent', class { type: string; constructor(type: string) { this.type = type; } });
    return { store, events };
  };

  it('defaults to the current interface', () => {
    stubWindow();
    expect(readUiMode('u1')).toBe('classic');
    expect(readUiMode(undefined)).toBe('classic');
  });

  it('stores the choice per account and notifies the app', () => {
    const { store, events } = stubWindow();
    writeUiMode('u1', 'center');
    expect(readUiMode('u1')).toBe('center');
    expect(readUiMode('u2')).toBe('classic');
    expect(store.get('vioo_ui_mode:u1')).toBe('center');
    expect(events).toEqual(['vioo-ui-mode']);
  });

  it('falls back to the current interface when storage is blocked', () => {
    stubWindow({ 'vioo_ui_mode:u1': 'center' }, true);
    expect(readUiMode('u1')).toBe('classic');
    expect(() => writeUiMode('u1', 'center')).not.toThrow();
  });
});
