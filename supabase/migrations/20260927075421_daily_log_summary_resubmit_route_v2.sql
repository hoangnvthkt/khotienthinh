-- User-approved Task7 correction. Keep the legacy submit and every global
-- workflow trigger verbatim; only documents saved through the V2 draft path
-- use this checked producer. Public signatures and role separation unchanged.
do $migration$
declare
  body text;
  route_anchor text := '  update public.daily_logs set submitted_to_permission = ''approve'' where id = p_daily_log_id;';
  dispatch_anchor text := '  begin' || E'\n' || '    return app_private.submit_daily_log_summary_legacy_v1(p_daily_log_id,p_expected_updated_at,p_approver_user_id,p_submission_note);';
begin
  body:=pg_get_functiondef('app_private.submit_daily_log_summary_legacy_v1(text,timestamptz,uuid,text)'::regprocedure);
  if (length(body)-length(replace(body,route_anchor,'')))/length(route_anchor)<>1
    or position('FUNCTION app_private.submit_daily_log_summary_legacy_v1(' in body)=0 then
    raise exception 'SUMMARY_RESUBMIT_PRODUCER_ANCHOR_MISMATCH';
  end if;
  body:=replace(body,'FUNCTION app_private.submit_daily_log_summary_legacy_v1(',
    'FUNCTION app_private.submit_daily_log_summary_checked_v2(');
  execute replace(body,route_anchor,
    '  if v_log.submitted_to_permission is distinct from ''approve'' then' || E'\n' || route_anchor || E'\n' || '  end if;');

  body:=pg_get_functiondef('app_private.submit_daily_log_summary_draft_v2(text,timestamptz,uuid,text)'::regprocedure);
  if (length(body)-length(replace(body,dispatch_anchor,'')))/length(dispatch_anchor)<>1 then
    raise exception 'SUMMARY_RESUBMIT_DISPATCH_ANCHOR_MISMATCH';
  end if;
  -- The first, non-V2 fallback remains the unchanged legacy producer. This
  -- branch already checks submit authority and locks rollout→log→cards→sources.
  execute replace(body,dispatch_anchor,replace(dispatch_anchor,
    'app_private.submit_daily_log_summary_legacy_v1','app_private.submit_daily_log_summary_checked_v2'));
end $migration$;
revoke all on function app_private.submit_daily_log_summary_checked_v2(text,timestamptz,uuid,text)
  from public,anon,authenticated,service_role;
