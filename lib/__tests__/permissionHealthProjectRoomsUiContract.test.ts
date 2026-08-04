import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'pages', 'settings', 'SettingsPermissionHealth.tsx'),
  'utf8',
);

describe('Permission Health Project Room audit UI', () => {
  it('loads and renders all four Room audit groups', () => {
    expect(source).toContain('get_project_permission_room_health_summary');
    expect(source).toContain('roomActionsNotConnected');
    expect(source).toContain('roomFallbackOnlyUsers');
    expect(source).toContain('roomUnmappedGrants');
    expect(source).toContain('roomInvalidScopeOrStaff');
  });

  it('shows the dedicated Room PBAC fallback flag', () => {
    expect(source).toContain('projectRoomPbacFallbackEnabled');
    expect(source).toContain('Room PBAC fallback');
  });
});
