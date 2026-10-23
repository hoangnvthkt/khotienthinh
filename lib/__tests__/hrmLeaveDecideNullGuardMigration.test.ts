import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261029120000_hrm_leave_decide_null_guard.sql', 'utf8');
const normalized = sql.replace(/\s+/g, ' ');

const functionBody = (name: string) => {
  const start = normalized.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return normalized.slice(start, normalized.indexOf('$function$;', start));
};

const hrCheck =
  "v_is_hr boolean := coalesce(app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'), false);";

describe('Leave decision null guard migration', () => {
  it('does not let anyone through an HR step that names no approver', () => {
    const decide = functionBody('public.decide_leave_request');
    expect(decide).toContain(hrCheck);
    expect(decide).toContain(
      "v_is_assigned := coalesce((v_step ->> 'userId') = v_user::text, false) or coalesce(v_step ->> 'kind' = 'hr' and v_is_hr, false);",
    );
    expect(decide).not.toContain("v_is_assigned := (v_step ->> 'userId') = v_user::text or");
    expect(decide).toContain(
      "if not v_is_assigned and not v_is_hr then raise exception using errcode = '42501', message = 'Bạn không phải người duyệt bước này.';",
    );
    // The rest of the live body is kept: self-approval block and the reason rule.
    expect(decide).toContain("if v_employee.user_id = v_user then raise exception using errcode = '42501'");
    expect(decide).toContain("if (not v_is_assigned or p_decision = 'reject') and length(trim(coalesce(p_comment, ''))) < 3 then");
  });

  it('only lets the requester or HR cancel a pending request, also when the profile has no account', () => {
    const cancel = functionBody('public.cancel_leave_request');
    expect(cancel).toContain(hrCheck);
    expect(cancel).toContain('if v_owner is distinct from v_user and not v_is_hr then raise exception');
    expect(cancel).not.toContain('if v_owner <> v_user and not v_is_hr');
    expect(cancel).toContain("if not v_is_hr then raise exception using errcode = '42501', message = 'Đơn đã duyệt chỉ HR được hủy.");
  });

  it('closes the same hole in the legacy request step RPC', () => {
    const step = functionBody('public.process_request_step');
    expect(step).toContain(
      "if (v_step->>'userId') is distinct from p_user_id::text and not public.is_module_admin('RQ') then raise exception 'user is not the current approver';",
    );
    expect(step).not.toContain("if v_step->>'userId' <> p_user_id::text");
    expect(step).toContain("if p_user_id is distinct from v_current_user and not public.is_module_admin('RQ') then");
  });

  it('keeps signatures and grants as they are', () => {
    expect(normalized).toContain(
      'CREATE OR REPLACE FUNCTION public.decide_leave_request(p_request_id uuid, p_decision text, p_comment text DEFAULT NULL::text)',
    );
    expect(normalized).toContain('CREATE OR REPLACE FUNCTION public.cancel_leave_request(p_request_id uuid, p_reason text)');
    expect(normalized).toContain(
      "CREATE OR REPLACE FUNCTION public.process_request_step(p_request_id uuid, p_user_id uuid, p_action text, p_comment text DEFAULT ''::text)",
    );
    expect(normalized).not.toMatch(/\b(grant|revoke|drop function)\b/i);
    expect(normalized).not.toContain("'40001'");
  });
});
