import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Project Room recipient cutover', () => {
  it('requires Room context for Project recipient selection', () => {
    const source = readFileSync(join(process.cwd(), 'components/project/ProjectRoomSubmissionDialog.tsx'), 'utf8');

    expect(source).toContain('recipientRoomCode');
    expect(source).toContain('recipientAction');
    expect(source).toContain('projectPermissionRoomService.listRecipients');
    expect(source).not.toContain('recipientPermissionCodes');
  });

  it('uses the PO Room for its primary recipient picker', () => {
    const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

    expect(source).toContain('recipientRoomCode="material_po"');
    expect(source).toContain('recipientAction="approve"');
    expect(source).not.toContain("recipientPermissionCodes={['confirm']}");
  });
});
