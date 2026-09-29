import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('resource evidence pilot preflight', () => {
  it('rejects active grants outside the exact project and site scope', () => {
    const sql = readFileSync('supabase/operations/resource_usage_evidence_pilot.sql', 'utf8');
    expect(sql).toMatch(/member\.project_id\s*<>\s*v_project\s+or\s+member\.construction_site_id\s+is\s+distinct\s+from\s+v_site/i);
  });
});
