-- Capture real, version-qualified slip metadata on V2 copy/explicit refresh only.
-- Existing snapshots and legacy producers are intentionally not backfilled.
do $migration$
declare
  v_definition text;
  v_anchor text := $anchor$'updatedAt', v_contribution.updated_at$anchor$;
  v_replacement text := $replacement$'updatedAt', v_contribution.updated_at,
        'content', v_contribution.content, 'issues', v_contribution.issues,
        'photos', v_contribution.photos, 'authorName', v_contribution.author_name,
        'date', v_contribution.date$replacement$;
begin
  v_definition := pg_get_functiondef('app_private.save_daily_log_summary_work_impl_v2(text,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor) <> 1 then
    raise exception 'SUMMARY_METADATA_SNAPSHOT_ANCHOR_MISMATCH';
  end if;
  execute replace(v_definition,v_anchor,v_replacement);
end;
$migration$;
