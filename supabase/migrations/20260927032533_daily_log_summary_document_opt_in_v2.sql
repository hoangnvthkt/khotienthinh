-- A new summary document may copy V1 normalized slips without changing them.
-- Old seven-argument callers keep the unchanged legacy producer. The opt-in
-- selects draft semantics only; all actor/Room/cutover/period checks still run.
do $migration$
declare body text; anchor text := '    and not exists(select 1 from app_private.daily_log_summary_decision_drafts_v2 where daily_log_id=p_daily_log_id) then';
begin
  body:=pg_get_functiondef('app_private.save_daily_log_summary_work_dispatch_v2(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  if (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 then
    raise exception 'SUMMARY_DOCUMENT_OPT_IN_ANCHOR_MISMATCH';
  end if;
  execute replace(body,anchor,
    '    and not exists(select 1 from jsonb_array_elements(coalesce(p_sources,''[]''::jsonb)) x where x->>''summaryDocumentVersion''=''2'')' || E'\n' || anchor);
end $migration$;
