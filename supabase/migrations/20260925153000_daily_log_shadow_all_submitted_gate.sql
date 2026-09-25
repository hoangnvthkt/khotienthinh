-- Every still-submitted normalized summary in the rollout scope must have
-- current, matching shadow evidence for this release before promotion.
alter function app_private.configure_daily_log_pilot_v1(text,text,text,date,text,uuid,text)
  rename to configure_daily_log_pilot_base_v1;
revoke all on function app_private.configure_daily_log_pilot_base_v1(text,text,text,date,text,uuid,text)
  from public,anon,authenticated,service_role;

create function app_private.configure_daily_log_pilot_v1(p_project_id text,p_construction_site_id text,
  p_mode text,p_cutover_date date,p_release_id text,p_owner_user_id uuid,p_reason text) returns jsonb
language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  result := app_private.configure_daily_log_pilot_base_v1(p_project_id,p_construction_site_id,
    p_mode,p_cutover_date,p_release_id,p_owner_user_id,p_reason);
  if p_mode='enforced' and exists(
    select 1 from public.daily_logs log
    where log.project_id=p_project_id
      and log.construction_site_id is not distinct from nullif(p_construction_site_id,'')
      and log.date::date>=p_cutover_date
      and log.summary_source_type='member_contributions'
      and log.status='submitted'
      and not exists(
        select 1 from app_private.daily_log_shadow_comparisons shadow
        where shadow.id=(
          select latest.id from app_private.daily_log_shadow_comparisons latest
          where latest.daily_log_id=log.id and latest.release_id=p_release_id
          order by latest.created_at desc,latest.id desc limit 1
        )
        and shadow.mismatch_count=0
        and shadow.log_version is not distinct from log.last_action_at
        and shadow.comparisons is not distinct from app_private.daily_log_shadow_rows_v1(log.id)
      )
  ) then
    raise exception using errcode='55000',message='PILOT_SHADOW_UNRESOLVED';
  end if;
  return result;
end;
$$;
revoke all on function app_private.configure_daily_log_pilot_v1(text,text,text,date,text,uuid,text)
  from public,anon,authenticated,service_role;
