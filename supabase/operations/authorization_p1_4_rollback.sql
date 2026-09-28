-- Emergency rollback for P1.4 (WMS recipients RPC and audit_trail read policy).
-- Roll the frontend back first: it calls list_wms_action_recipients.
begin;
drop policy if exists audit_trail_read on public.audit_trail;
create policy audit_trail_read on public.audit_trail for select to authenticated using (true);
drop function if exists public.list_wms_action_recipients(text, text[]);
drop function if exists app_private.wms_user_has_action(uuid, text, text, text, boolean);
commit;
