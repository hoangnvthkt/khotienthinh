import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const importTab = readFileSync(
  join(process.cwd(), 'components/project/material/MaterialRequestTab.tsx'),
  'utf8',
);
const importPreview = readFileSync(
  join(process.cwd(), 'components/project/material/MaterialRequestImportPreviewModal.tsx'),
  'utf8',
);

describe('material request Excel import UI wiring', () => {
  it('builds imported request items through the snapshot-preserving mapper', () => {
    expect(importTab).toContain('buildImportedMaterialRequestItem');
    expect(importTab).toContain('buildImportedMaterialRequestItem(row, crypto.randomUUID())');
  });

  it('shows the imported specification and matched catalog context in preview', () => {
    expect(importPreview).toContain('row.specification');
    expect(importPreview).toContain('Danh mục:');
    expect(importPreview).toContain('row.matchedInventoryItem.name');
  });
});
