import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

describe('weekly progress protected writes', () => {
  it('does not auto-upsert weekly snapshots from the dashboard', () => {
    const source = read('components/project/FastConsDashboard.tsx');
    expect(source).not.toMatch(/from\(['"]weekly_progress_snapshots['"]\)[\s\S]{0,240}\.upsert\(/);
  });
});
