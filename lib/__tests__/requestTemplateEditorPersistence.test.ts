import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('request template editor persistence', () => {
  const source = readFileSync('pages/request/RequestTemplateEditor.tsx', 'utf8');

  it('saves draft changes without a stale optimistic concurrency token', () => {
    expect(source).toContain('requestTemplateService.saveDraft(toSaveDraftInput(draft))');
    expect(source).not.toContain('requestTemplateService.saveDraft(toSaveDraftInput(draft, updatedAt ?? undefined))');
  });

  it('refreshes the template token by saving before publishing', () => {
    expect(source).toContain('const saved = await requestTemplateService.saveDraft(toSaveDraftInput(draft));');
    expect(source).toContain('const expectedUpdatedAt = saved.updatedAt;');
  });
});
