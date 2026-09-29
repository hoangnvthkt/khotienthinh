-- Never impersonate PostgreSQL serialization failures for business conflicts:
-- PostgREST14 can retry40001 indefinitely. Preserve every other error unchanged.
create or replace function public.save_daily_log_source_document_v2(p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  return app_private.save_daily_log_source_document_impl_v2(p_input);
exception when serialization_failure then
  if sqlerrm in ('ROW_VERSION_CONFLICT','SOURCE_CHANGED') then
    raise sqlstate 'PT409' using message=sqlerrm;
  end if;
  raise;
end $$;
revoke all on function public.save_daily_log_source_document_v2(jsonb) from public,anon;
grant execute on function public.save_daily_log_source_document_v2(jsonb) to authenticated;
notify pgrst, 'reload schema';
