import { describe, expect, it, vi } from 'vitest';
import { startVisibleInterval, type VisibleIntervalEnvironment } from '../visibleInterval';

const fakeEnvironment = () => {
  let visible = true;
  let intervalHandler: (() => void) | null = null;
  let visibilityHandler: (() => void) | null = null;
  const env: VisibleIntervalEnvironment & { fire(): void; setVisible(v: boolean): void; cleared: boolean; unbound: boolean } = {
    isVisible: () => visible,
    setInterval: handler => { intervalHandler = handler; return 1; },
    clearInterval: () => { env.cleared = true; },
    onVisibilityChange: handler => { visibilityHandler = handler; return () => { env.unbound = true; }; },
    fire: () => intervalHandler?.(),
    setVisible: v => { visible = v; visibilityHandler?.(); },
    cleared: false,
    unbound: false,
  };
  return env;
};

describe('startVisibleInterval', () => {
  it('chỉ gọi khi tab hiện, gọi ngay khi tab hiện lại, dừng sạch', () => {
    const env = fakeEnvironment();
    const tick = vi.fn();
    const stop = startVisibleInterval(tick, 60_000, env);

    env.fire();
    expect(tick).toHaveBeenCalledTimes(1);

    env.setVisible(false);
    env.fire();
    env.fire();
    expect(tick).toHaveBeenCalledTimes(1);

    env.setVisible(true);
    expect(tick).toHaveBeenCalledTimes(2);

    env.setVisible(true);
    expect(tick).toHaveBeenCalledTimes(2);

    stop();
    expect(env.cleared).toBe(true);
    expect(env.unbound).toBe(true);
  });
});
