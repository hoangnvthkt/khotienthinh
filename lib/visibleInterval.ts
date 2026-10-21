// Hẹn giờ chỉ chạy khi tab đang hiện (audit 20/10/2026, mục H6): tab nền không gọi Supabase; quay lại thì làm mới ngay.
// Ở 200 người, phần lớn tab đang ẩn — bỏ poll lúc ẩn cắt phần lớn lượt gọi định kỳ.

export interface VisibleIntervalEnvironment {
  isVisible(): boolean;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  onVisibilityChange(handler: () => void): () => void;
}

const browserEnvironment = (): VisibleIntervalEnvironment => ({
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: id => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
  onVisibilityChange: handler => {
    if (typeof document === 'undefined') return () => undefined;
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
});

/** Gọi `tick` mỗi `ms` khi tab hiện; tab vừa hiện lại thì gọi ngay một lần. Trả hàm dừng. */
export const startVisibleInterval = (
  tick: () => void,
  ms: number,
  environment: VisibleIntervalEnvironment = browserEnvironment(),
): (() => void) => {
  let wasHidden = !environment.isVisible();
  const id = environment.setInterval(() => {
    if (environment.isVisible()) tick();
  }, ms);
  const offVisibility = environment.onVisibilityChange(() => {
    const visible = environment.isVisible();
    if (visible && wasHidden) tick();
    wasHidden = !visible;
  });
  return () => {
    environment.clearInterval(id);
    offVisibility();
  };
};
