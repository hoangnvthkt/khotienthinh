-- Rollback for authorization_p3_project_room_templates. Room memberships
-- already assigned through templates stay (they are ordinary Room members);
-- only the templates and their RPCs go. Roll the frontend back too.
begin;
drop function if exists public.apply_project_room_template(text, text, uuid, text, text, boolean, jsonb);
drop function if exists public.get_project_staff_room_actions(text, text, uuid);
drop function if exists public.save_project_room_template(text, text, text, jsonb, uuid[], boolean);
drop function if exists app_private.normalize_room_template_actions(jsonb);
drop table if exists public.project_room_templates;
commit;
