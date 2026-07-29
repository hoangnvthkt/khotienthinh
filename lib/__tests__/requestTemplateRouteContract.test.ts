import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request template routes', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const permissions = readFileSync('lib/permissions/erpPermissionRegistry.ts', 'utf8');

  it('registers the template administration routes', () => {
    expect(app).toContain('path="rq/templates"');
    expect(app).toContain('path="rq/templates/new"');
    expect(app).toContain('path="rq/templates/:templateId"');
  });

  it('assigns the template permission to the new route', () => {
    expect(permissions).toContain("['/rq/templates']");
    expect(permissions).toContain("'request.template'");
  });
});
