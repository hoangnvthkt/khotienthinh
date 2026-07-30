import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('full-bleed route scrolling', () => {
  it('keeps a scrollable, height-constrained main region for request and workflow routes', () => {
    const layout = readFileSync('components/Layout.tsx', 'utf8');

    expect(layout).toContain('isFullBleedRoute ? "flex-1 min-h-0 overflow-auto relative"');
    expect(layout).not.toContain('isFullBleedRoute ? "flex-1 overflow-hidden relative"');
  });
});
