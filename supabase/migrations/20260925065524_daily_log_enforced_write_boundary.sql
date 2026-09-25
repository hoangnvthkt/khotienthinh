-- Serialize legacy writes with operator rollout changes. Publication continues
-- to use the private atomic rollup helper; clients cannot call that helper.
create function app_private.lock_daily_log_rollout_v1(p_project_id text,p_site_id text)
returns app_private.daily_log_wbs_rollout_scopes
language plpgsql security definer set search_path='' as $$
declare r app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_project_id||':'||coalesce(nullif(p_site_id,''),''),0));
  select * into r from app_private.daily_log_wbs_rollout_scopes scope
  where (scope.project_id is null or scope.project_id=p_project_id)
    and (scope.construction_site_id is null or scope.construction_site_id=nullif(p_site_id,''))
  order by (scope.project_id is not null) desc,(scope.construction_site_id is not null) desc,scope.updated_at desc
  limit 1 for share;
  return r;
end;
$$;
revoke all on function app_private.lock_daily_log_rollout_v1(text,text) from public,anon,authenticated;

alter function app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb)
rename to save_project_progress_period_legacy_v1;
revoke all on function app_private.save_project_progress_period_legacy_v1(text,text,text,date,jsonb,jsonb) from public,anon,authenticated;
create function app_private.save_project_progress_period_impl(p_project_id text,p_construction_site_id text,
  p_period_type text,p_period_start date,p_rows jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  perform app_private.assert_project_progress_action(public.current_app_user_id(),p_project_id,nullif(p_construction_site_id,''),'edit');
  if p_period_type='daily' then
    r := app_private.lock_daily_log_rollout_v1(p_project_id,p_construction_site_id);
    if r.mode='enforced' and p_period_start>=r.cutover_date then
      raise exception using errcode='42501',message='DAILY_LOG_PROGRESS_REQUIRES_PUBLICATION';
    end if;
  end if;
  return app_private.save_project_progress_period_legacy_v1(p_project_id,p_construction_site_id,p_period_type,p_period_start,p_rows,p_snapshot);
end;
$$;
revoke all on function app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb) from public,anon;
grant execute on function app_private.save_project_progress_period_impl(text,text,text,date,jsonb,jsonb) to authenticated;

alter function app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb)
rename to close_project_progress_period_legacy_v1;
revoke all on function app_private.close_project_progress_period_legacy_v1(text,text,text,date,jsonb,jsonb) from public,anon,authenticated;
create function app_private.close_project_progress_period_impl(p_project_id text,p_construction_site_id text,
  p_period_type text,p_period_start date,p_rows jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  perform app_private.assert_project_progress_action(public.current_app_user_id(),p_project_id,nullif(p_construction_site_id,''),'confirm');
  if p_period_type='daily' and p_rows is not null then
    r := app_private.lock_daily_log_rollout_v1(p_project_id,p_construction_site_id);
    if r.mode='enforced' and p_period_start>=r.cutover_date then
      raise exception using errcode='42501',message='DAILY_LOG_PROGRESS_REQUIRES_PUBLICATION';
    end if;
  end if;
  return app_private.close_project_progress_period_legacy_v1(p_project_id,p_construction_site_id,p_period_type,p_period_start,p_rows,p_snapshot);
end;
$$;
revoke all on function app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb) from public,anon;
grant execute on function app_private.close_project_progress_period_impl(text,text,text,date,jsonb,jsonb) to authenticated;

alter function public.save_daily_progress_exception_v1(uuid,timestamptz,numeric,numeric,numeric,text,text)
rename to save_daily_progress_exception_base_v1;
alter function public.save_daily_progress_exception_base_v1(uuid,timestamptz,numeric,numeric,numeric,text,text) set schema app_private;
revoke all on function app_private.save_daily_progress_exception_base_v1(uuid,timestamptz,numeric,numeric,numeric,text,text) from public,anon,authenticated;
create function app_private.save_daily_progress_exception_enforced_v1(p_progress_row_id uuid,p_expected_updated_at timestamptz,
  p_progress_percent numeric,p_quantity_done numeric,p_daily_quantity_done numeric,p_note text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare row_data public.project_daily_task_progress%rowtype;
  rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  select * into row_data from public.project_daily_task_progress where id=p_progress_row_id;
  if not found then raise exception using errcode='P0002',message='DAILY_PROGRESS_ROW_NOT_FOUND'; end if;
  if public.current_app_user_id() is null
    or not app_private.current_actor_has_effective_room_action(row_data.project_id,row_data.construction_site_id,'weekly_progress','edit')
    or not app_private.current_actor_has_effective_room_action(row_data.project_id,row_data.construction_site_id,'daily_log','publish_progress') then
    raise exception using errcode='42501',message='DAILY_PROGRESS_EXCEPTION_DUAL_PERMISSION_REQUIRED';
  end if;
  rollout := app_private.lock_daily_log_rollout_v1(row_data.project_id,row_data.construction_site_id);
  if rollout.id is null or rollout.mode<>'enforced' or row_data.progress_date<rollout.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_PROGRESS_NOT_AUTHORITATIVE';
  end if;
  return app_private.save_daily_progress_exception_base_v1(p_progress_row_id,p_expected_updated_at,p_progress_percent,
    p_quantity_done,p_daily_quantity_done,p_note,p_reason);
end;
$$;
revoke all on function app_private.save_daily_progress_exception_enforced_v1(uuid,timestamptz,numeric,numeric,numeric,text,text) from public,anon;
grant execute on function app_private.save_daily_progress_exception_enforced_v1(uuid,timestamptz,numeric,numeric,numeric,text,text) to authenticated;
create function public.save_daily_progress_exception_v1(p_progress_row_id uuid,p_expected_updated_at timestamptz,
  p_progress_percent numeric,p_quantity_done numeric,p_daily_quantity_done numeric,p_note text,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$
  select app_private.save_daily_progress_exception_enforced_v1(p_progress_row_id,p_expected_updated_at,p_progress_percent,
    p_quantity_done,p_daily_quantity_done,p_note,p_reason);
$$;
revoke all on function public.save_daily_progress_exception_v1(uuid,timestamptz,numeric,numeric,numeric,text,text) from public,anon;
grant execute on function public.save_daily_progress_exception_v1(uuid,timestamptz,numeric,numeric,numeric,text,text) to authenticated;
