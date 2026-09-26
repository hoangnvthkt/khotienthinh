import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260925090000_workflow_step_watcher_autotag.sql',
  ),
  'utf8',
);
const builderSource = readFileSync(
  resolve(process.cwd(), 'pages/wf/WorkflowBuilder.tsx'),
  'utf8',
);

describe('workflow step watcher autotag', () => {
  it('resolves both user and department step watcher targets', () => {
    expect(migration).toContain("coalesce(wn.config -> 'stepWatcherTargets', '[]'::jsonb)");
    expect(migration).toContain("coalesce(target ->> 'type', '') = 'user'");
    expect(migration).toContain("coalesce(targets.target ->> 'type', '') = 'department'");
    // Department pools resolve through employees, matching the project runtime.
    expect(migration).toContain('e.department_id::text = targets.target');
    expect(migration).toContain('e.org_unit_id::text = targets.target');
  });

  it('only tags active accounts', () => {
    expect(migration).toContain('u.is_active');
    expect(migration).toContain("u.account_status = 'ACTIVE'");
    expect(migration).toContain("coalesce(e.status, 'Đang làm việc') = 'Đang làm việc'");
  });

  it('fires on arrival at a node and never strips existing watchers', () => {
    expect(migration).toContain(
      'before insert or update of current_node_id on public.workflow_instances',
    );
    expect(migration).toContain(
      'old.current_node_id is not distinct from new.current_node_id',
    );
    // Merge, not replace: leaving a stage must not revoke visibility.
    expect(migration).toContain("select unnest(coalesce(new.watchers, '{}'::text[]))");
    expect(migration).toContain('union');
    expect(migration).not.toMatch(/set\s+watchers\s*=\s*v_step_watchers/);
  });

  it('keeps the helper functions out of client reach', () => {
    expect(migration).toContain(
      'revoke all on function app_private.workflow_resolve_step_watchers(uuid) from public',
    );
    expect(migration).toContain(
      'revoke all on function app_private.workflow_instance_autotag_step_watchers() from public',
    );
    expect(migration).toContain("set search_path = ''");
  });

  it('surfaces step watcher coverage in the builder config summary', () => {
    expect(builderSource).toContain('Người theo dõi riêng theo giai đoạn');
    expect(builderSource).toContain("step.config.stepWatcherTargets || []");
  });
});
