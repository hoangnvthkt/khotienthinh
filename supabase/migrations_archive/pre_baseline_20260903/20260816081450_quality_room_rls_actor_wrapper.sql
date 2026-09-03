-- Follow-up for the already deployed pilot: RLS may only probe the current actor.
create or replace function app_private.quality_current_actor_has_action(
  p_project_id text,
  p_construction_site_id text,
  p_action_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.project_actor_has_effective_room_action(
    public.current_app_user_id(), p_project_id, p_construction_site_id,
    'quality', p_action_code
  );
$$;

revoke all on function app_private.quality_current_actor_has_action(text, text, text)
  from public, anon;
grant execute on function app_private.quality_current_actor_has_action(text, text, text)
  to authenticated;

drop policy if exists quality_checklists_room_select on public.quality_checklists;
create policy quality_checklists_room_select on public.quality_checklists
for select to authenticated using (
  app_private.quality_current_actor_has_action(
    project_id::text, construction_site_id::text, 'view'
  )
);

drop policy if exists quality_inspection_attempts_room_select on public.quality_inspection_attempts;
create policy quality_inspection_attempts_room_select on public.quality_inspection_attempts
for select to authenticated using (
  exists (
    select 1 from public.quality_checklists checklist
    where checklist.id = quality_inspection_attempts.checklist_id
      and app_private.quality_current_actor_has_action(
        checklist.project_id::text, checklist.construction_site_id::text, 'view'
      )
  )
);

notify pgrst, 'reload schema';
