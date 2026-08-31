import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getRequestWorkspaceMode } from '../requestWorkspace';

describe('request workspace', () => {
  it('uses the Base × Vioo workspace building blocks instead of legacy direct data access', () => {
    const page = readFileSync('pages/request/RequestList.tsx', 'utf8');
    expect(page).toContain('RequestContextNav');
    expect(page).toContain('RequestTable');
    expect(page).toContain('RequestMasterList');
    expect(page).not.toContain("from 'pizzip'");
    expect(page).not.toContain("from 'docxtemplater'");
    expect(page).not.toContain("from '../../lib/supabase'");
  });

  it('chooses list, table and detail modes at the responsive breakpoints', () => {
    expect(getRequestWorkspaceMode(767, false)).toBe('MOBILE_LIST');
    expect(getRequestWorkspaceMode(767, true)).toBe('MOBILE_DETAIL');
    expect(getRequestWorkspaceMode(768, false)).toBe('DESKTOP_TABLE');
    expect(getRequestWorkspaceMode(1279, true)).toBe('DESKTOP_MASTER_DETAIL');
    expect(getRequestWorkspaceMode(1280, false)).toBe('DESKTOP_TABLE');
  });

  it('shows the stored avatars for request creators and active approvers', () => {
    const table = readFileSync('components/request/RequestTable.tsx', 'utf8');

    expect(table).toContain('user.avatarUrl');
    expect(table).toContain('<RequestUserIdentity user={item.creator} />');
    expect(table).toContain('<RequestUserAvatar user={approver} className="h-6 w-6" />');
  });
});
