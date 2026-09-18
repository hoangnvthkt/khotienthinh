import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync('App.tsx', 'utf8');
const routes = readFileSync('constants/routes.ts', 'utf8');
const access = readFileSync('lib/routeAccess.ts', 'utf8');
const home = readFileSync('pages/Home.tsx', 'utf8');
const context = readFileSync('context/WorkflowContext.tsx', 'utf8');
const instances = readFileSync('pages/wf/WorkflowInstances.tsx', 'utf8');
const detail = readFileSync('pages/wf/WorkflowInstanceDetail.tsx', 'utf8');

describe('Workflow canonical route contract', () => {
  it('registers the UUID detail route and keeps legacy paths as redirects', () => {
    expect(app).toContain('wf/:instanceId');
    expect(app).toContain('wf/instances/:id');
    expect(instances).toContain('buildWorkflowRoute');
    expect(instances).toContain('replace: true');
  });

  it('loads a direct instance outside the bounded list cache', () => {
    expect(context).toContain('loadInstanceById');
    expect(context).toContain(".eq('id', instanceId)");
    expect(detail).toContain('loadInstanceById');
  });

  it('uses the canonical route for navigation and permission matching', () => {
    expect(routes).toContain("'/wf/:instanceId'");
    expect(access).toContain("'/wf/:instanceId'");
    expect(home).toContain('buildWorkflowRoute');
  });
});
