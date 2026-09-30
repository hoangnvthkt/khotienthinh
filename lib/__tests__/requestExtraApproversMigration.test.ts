import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase/migrations');
const file = readdirSync(dir).find(name => name.endsWith('_request_extra_approvers_and_submit_watchers.sql'));
const sql = file ? readFileSync(join(dir, file), 'utf8') : '';
const fn = (name: string) => {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, 'i'));
  if (start < 0) return '';
  const rest = sql.slice(start);
  const end = rest.search(/\n(end;?\s*\$\$;|end;?\s*\$function\$;|end \$\$;|\$function\$;)/);
  return rest.slice(0, end + 20);
};

describe('request extra approvers migration', () => {
  it('keeps the six-argument submit call working through a defaulted p_options', () => {
    expect(sql).toContain('drop function if exists public.submit_request(uuid, text, text, jsonb, jsonb, text);');
    expect(sql).toMatch(/public\.submit_request\([\s\S]*?p_options jsonb default '\{\}'::jsonb/);
    expect(sql).toContain('grant execute on function public.submit_request(uuid, text, text, jsonb, jsonb, text, jsonb) to authenticated;');
  });

  it('runs the extra step before the template flow and only when requested', () => {
    const submit = fn('app_private\\.submit_request');
    expect(submit).toContain('if cardinality(v_extra_ids) > 0\n       or (v_version.flow_mode');
    expect(submit).toContain("perform app_private.activate_request_extra_block(v_request.id, v_assignment_round_id, v_actor);");
    expect(submit).toContain('REQUEST_APPROVER_SELF_NOT_ALLOWED');
    expect(submit).toContain("'watcherIds'");
  });

  it('starts the template flow once the extra step is complete (all or any one)', () => {
    const act = fn('app_private\\.act_on_request');
    expect(act).toContain("if v_block_key = '__extra' then");
    expect(act).toContain("{extraBlock,completionPolicy}', 'ALL') = 'ANY_ONE'");
    expect(act).toContain('perform app_private.activate_request_template_start(p_request_id, v_assignment_round, v_actor);');
  });

  it('restarts from the extra step on resubmit and content edit', () => {
    expect(fn('app_private\\.activate_request_block')).toContain("if p_block_key = '__extra' then");
    const edit = fn('app_private\\.update_request_content');
    expect(edit).toContain("perform app_private.activate_request_block(v_request.id,'__extra',v_round,v_actor);");
    expect(edit).toContain("then '__extra' else (select block_key");
  });

  it('shows the extra step first and keeps its snapshot current on reassignment', () => {
    expect(fn('app_private\\.request_detail_payload')).toContain("app_private.request_extra_block_payload(r.id)||coalesce(base.payload->'approvalBlocks','[]')");
    expect(fn('app_private\\.reassign_request_assignment')).toContain("'{extraBlock,resolvedUserIds}'");
  });
});
