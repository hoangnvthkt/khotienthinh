import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRequestRoute } from '../requestRoutes';

describe('request deep links', () => {
  it('builds the canonical request route', () => {
    expect(buildRequestRoute('uuid-1')).toBe('/rq/uuid-1');
  });

  it('registers the canonical request detail route', () => {
    expect(readFileSync('App.tsx', 'utf8')).toContain('path="rq/:requestId"');
  });
});
