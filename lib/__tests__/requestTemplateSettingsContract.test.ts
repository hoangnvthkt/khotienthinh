import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request template settings navigation', () => {
  const source = readFileSync('components/request/template/RequestTemplateSettingsNav.tsx', 'utf8');

  it('contains exactly the Phase 1 configuration sections', () => {
    for (const section of ['GENERAL', 'FORM', 'APPROVAL', 'WATCHERS', 'PRINT', 'NOTIFICATIONS']) {
      expect(source).toContain(section);
    }
    for (const excluded of ['WEBHOOK', 'SIGNATURE', 'CONDITIONS']) {
      expect(source).not.toContain(excluded);
    }
  });
});
