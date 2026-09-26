-- Returned-save and actor/command boundaries, all rollback-only on test Cloud.
begin;
create temporary table ux_save_source(id uuid);
grant select,insert on ux_save_source to authenticated;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
insert into ux_save_source select (public.create_daily_log_source_v2('76200000-0000-4000-8000-000000000001',
  'DL-WBS-PILOT-20260925',null,'2099-03-04','UX-RETURN-SAVE','Returned save')->>'contributionId')::uuid;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from public.users
  where role='ADMIN' and auth_id is not null order by created_at limit 1),'role','authenticated')::text,true);
update public.daily_log_contributions set status='returned' where id=(select id from ux_save_source);
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare payload jsonb; receipt jsonb; begin
  if public.is_admin() then raise exception 'admin is not a valid save-boundary test persona'; end if;
  payload:=jsonb_build_object('contributionId',(select id from ux_save_source),'expectedRowVersion',1,
    'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','Corrected content','issues','',
    'photos','[]'::jsonb,'items','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb);
  receipt:=public.save_daily_log_source_document_v2(payload);
  if receipt->>'rowVersion' is distinct from '2' or not exists(select 1 from public.daily_log_contributions
    where id=(select id from ux_save_source) and status='returned' and content='Corrected content') then
    raise exception 'returned save lost status or metadata'; end if;
  begin
    update public.daily_log_contributions set source_draft_payload='{}'::jsonb where id=(select id from ux_save_source);
    raise exception 'direct draft payload bypass accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SAVE_COMMAND_REQUIRED' then raise; end if; end;
  begin
    insert into public.daily_log_contributions(project_id,date,author_user_id,content,source_draft_payload)
      values('DL-WBS-PILOT-20260925','2099-03-05',public.current_app_user_id()::text,'Direct draft bypass','{}'::jsonb);
    raise exception 'direct draft payload insert accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SAVE_COMMAND_REQUIRED' then raise; end if; end;
  begin
    update public.daily_log_contributions set content='Direct returned bypass',row_version=3 where id=(select id from ux_save_source);
    raise exception 'direct returned save bypass accepted';
  exception when raise_exception then
    if sqlerrm='direct returned save bypass accepted' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims','{"sub":"9d5a2f91-a8cb-4319-9188-3cad28fe4b48","role":"authenticated"}',true);
do $$ begin
  begin
    perform public.save_daily_log_source_document_v2(jsonb_build_object('contributionId',(select id from ux_save_source),'expectedRowVersion',2,
      'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','Foreign author','issues','',
      'photos','[]'::jsonb,'items','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb));
    raise exception 'foreign author save accepted';
  exception when insufficient_privilege then if sqlerrm<>'DAILY_LOG_SOURCE_SAVE_DENIED' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select auth_id from public.users
  where role='ADMIN' and auth_id is not null order by created_at limit 1),'role','authenticated')::text,true);
insert into public.daily_logs(id,project_id,date,created_by,status,summary_source_type) values
  ('__DL_UX_VERIFIED_BOUNDARY','DL-WBS-PILOT-20260925','2099-03-04','Fixture reviewer','verified','member_contributions');
insert into public.daily_log_summary_sources(daily_log_id,contribution_id,review_status)
  select '__DL_UX_VERIFIED_BOUNDARY',id,'accepted' from ux_save_source;
select set_config('request.jwt.claims','{"sub":"f30d5711-1a9d-47b2-a536-9424cc66b822","role":"authenticated"}',true);
set local role authenticated;
do $$ declare bundle jsonb; begin
  bundle:=public.get_daily_log_document_bundle_v2('DL-WBS-PILOT-20260925',null,'2099-03-04',null,(select id from ux_save_source));
  if bundle->'permissions'->>'canEditSource' is distinct from 'false' or bundle->'permissions'->>'canSubmitSource' is distinct from 'false' then
    raise exception 'verified-effective source still offers mutation actions'; end if;
  begin
    perform public.save_daily_log_source_document_v2(jsonb_build_object('contributionId',(select id from ux_save_source),'expectedRowVersion',2,
      'workAreaCode','UX-RETURN-SAVE','workAreaName','Returned save','content','Do not change verified source','issues','',
      'photos','[]'::jsonb,'items','[]'::jsonb,'labor','[]'::jsonb,'machines','[]'::jsonb));
    raise exception 'verified-effective source changed';
  exception when insufficient_privilege then if sqlerrm<>'VERIFIED_SOURCE_IMMUTABLE' then raise; end if; end;
end $$;
reset role;
select 'daily_log_source_save_boundary_smoke PASS' result;
rollback;
