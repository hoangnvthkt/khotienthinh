-- Room PO is authoritative for project-level access. Administrators must be
-- able to revoke every PO action (or configure recipients in multiple saves)
-- without an old workflow-recipient requirement making the Room impossible
-- to save. Recipient availability is validated by the PO workflow when a PO
-- is submitted or assigned, not while the Room itself is being configured.
update public.project_permission_rooms
set required_actions = '{}'::text[],
    updated_at = now()
where code = 'material_po';

do $$
begin
  if not exists (
    select 1
    from public.project_permission_rooms room
    where room.code = 'material_po'
      and room.required_actions = '{}'::text[]
  ) then
    raise exception 'material_po must allow an empty Room configuration';
  end if;
end;
$$;
