import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRequestRoute } from '../requestRoutes';

describe('request deep links', () => {
  it('builds the canonical request route', () => {
    expect(buildRequestRoute('uuid-1')).toBe('/rq/uuid-1');
  });

  it('registers the canonical request detail route', () => {
    expect(readFileSync('App.tsx', 'utf8')).toContain('path="rq/:requestId"');
  });

  it('uses the canonical route from home and global search results', () => {
    const home = readFileSync('pages/Home.tsx', 'utf8');
    const commandPalette = readFileSync('components/CommandPalette.tsx', 'utf8');

    expect(home).toContain("import { buildRequestRoute } from '../lib/requestRoutes';");
    expect(home).not.toContain('/rq?requestId=');
    expect(commandPalette).toContain("import { buildRequestRoute } from '../lib/requestRoutes';");
    expect(commandPalette).toContain('route: buildRequestRoute(rq.id)');
  });

  it('keeps the request dashboard on the runtime read model', () => {
    const dashboard = readFileSync('pages/request/RequestDashboard.tsx', 'utf8');

    expect(dashboard).toContain("import { useRequestList } from '../../hooks/useRequestList';");
    expect(dashboard).toContain('requestRuntimeService.getSummary()');
    expect(dashboard).not.toContain("../../context/RequestContext");
    expect(dashboard).not.toContain("from 'recharts'");
  });

  it('keeps the employee request cards on runtime lists', () => {
    const employeeDashboard = readFileSync('pages/EmployeeDashboard.tsx', 'utf8');

    expect(employeeDashboard).toContain("import { useRequestList } from '../hooks/useRequestList';");
    expect(employeeDashboard).toContain("useRequestList({ view: 'ASSIGNED_TO_ME' })");
    expect(employeeDashboard).toContain("useRequestList({ view: 'CREATED_BY_ME' })");
    expect(employeeDashboard).toContain('navigate(buildRequestRoute(req.id))');
    expect(employeeDashboard).not.toContain("../context/RequestContext");
  });

  it('does not mount the retired request context in the custom dashboard', () => {
    expect(readFileSync('pages/CustomDashboard.tsx', 'utf8')).not.toContain("../context/RequestContext");
  });
});
