import { describe, expect, it } from 'vitest';
import { getRouteChrome } from '../routeChrome';

describe('route chrome', () => {
  it('gives the Command Center its own header, bottom tabs and no floating launchers', () => {
    expect(getRouteChrome('/center')).toEqual({
      fullBleed: true,
      workScrollHost: false,
      hideMobileHeader: true,
      hideBottomNav: true,
      hideFab: true,
      hideDock: true,
      hideChatBubble: true,
    });
  });

  it.each(['/work', '/work/my', '/work/tasks/WK-1'])('keeps %s full-bleed as the Work scroll host', pathname => {
    expect(getRouteChrome(pathname)).toMatchObject({ fullBleed: true, workScrollHost: true, hideMobileHeader: false, hideBottomNav: false });
  });

  it.each(['/chat', '/rq', '/rq/123', '/wf'])('keeps %s full-bleed with the normal app chrome', pathname => {
    expect(getRouteChrome(pathname)).toMatchObject({ fullBleed: true, workScrollHost: false, hideMobileHeader: false, hideBottomNav: false, hideFab: false });
  });

  it.each(['/', '/da', '/wf/123', '/center/x', '/finance/project'])('leaves %s padded with every launcher', pathname => {
    expect(Object.values(getRouteChrome(pathname)).every(flag => flag === false)).toBe(true);
  });
});
