import { describe, expect, it } from 'vitest';
import { parseProjectV2Query, serializeProjectV2Query, updateProjectV2Query, createProjectV2RequestGate,
  filterLegacyProjectCohort, buildProjectV2ExclusionFilter } from '../projectV2/queryState';

describe('Project V2 query state', () => {
  it('parses URL owned filters and falls back for invalid values', () => {
    expect(parseProjectV2Query('?project=P-1&type=construction&status=approved&search=steel&period=2026-10&sort=oldest&page=2'))
      .toMatchObject({ projectId: 'P-1', planType: 'construction', status: 'approved',
        search: 'steel', period: '2026-10', sort: 'oldest', page: 2 });
    expect(parseProjectV2Query('?type=bad&status=unknown&period=tomorrow&sort=bad&page=-1'))
      .toMatchObject({ planType: 'month', status: 'all', period: '', sort: 'newest', page: 1 });
  });

  it('resets page when filters change and preserves deep-link state', () => {
    const current = parseProjectV2Query('?project=P-1&type=month&page=3');
    const next = updateProjectV2Query(current, { planType: 'material' });
    expect(next.page).toBe(1);
    expect(parseProjectV2Query(`?${serializeProjectV2Query(next)}`))
      .toMatchObject({ projectId: 'P-1', planType: 'material', page: 1 });
  });

  it('discards responses from an older project or filter generation', async () => {
    const gate = createProjectV2RequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('excludes active cohort projects only from the legacy picker', () => {
    const projects = [{ id: 'P-1' }, { id: 'P-2' }, { id: 'P-3' }];
    expect(filterLegacyProjectCohort(projects, [
      { projectId: 'P-1', lifecycle: 'active' },
      { projectId: 'P-2', lifecycle: 'archived' },
    ])).toEqual([{ id: 'P-2' }, { id: 'P-3' }]);
  });

  it('quotes project IDs in the server-side exclusion filter', () => {
    expect(buildProjectV2ExclusionFilter(['P-1', 'A,B'])).toBe('(\"P-1\",\"A,B\")');
  });
});
