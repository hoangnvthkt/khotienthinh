-- Run after 20261007110000_hrm_position_catalog_cleanup. Read-only checks; rolls back.
-- Dry-run on Cloud 02/10/2026 (before/after in one transaction): 121 → 99 positions, employee /
-- compensation / slot references unchanged, one leaked smoke project_staff row removed.
begin;

do $$
begin
  if exists (select 1 from public.hrm_positions group by lower(trim(name)) having count(*) > 1) then
    raise exception 'POSITION_CLEANUP_DUPLICATES_LEFT';
  end if;
  if exists (select 1 from public.hrm_positions where code in ('VT080','VT078','VT086','VT087','VT085','VT084','VT016','VT025','G3-BOQ')) then
    raise exception 'POSITION_CLEANUP_MERGED_LEFT';
  end if;
  if (select name from public.hrm_positions where code = 'VT015') <> 'Chỉ huy trưởng'
    or (select name from public.hrm_positions where code = 'VT024') <> 'Chỉ huy phó' then
    raise exception 'POSITION_CLEANUP_RENAME';
  end if;
  if (select count(*) from public.notification_site_command_positions command
      join public.hrm_positions position on position.id = command.position_id
      where position.code in ('VT015','VT024')) <> 2 then
    raise exception 'POSITION_CLEANUP_SITE_COMMAND';
  end if;
  -- Numeric positions left are exactly the ones still referenced.
  if exists (select 1 from public.hrm_positions position where position.name ~ '^[0-9]+$'
             and not exists (select 1 from public.hrm_employee_compensation_assignments where position_id = position.id)
             and not exists (select 1 from public.project_staff where position_id = position.id)) then
    raise exception 'POSITION_CLEANUP_UNUSED_NUMERIC_LEFT';
  end if;
end;
$$;

select 'hrm_position_catalog_cleanup_smoke passed' as result,
  (select count(*) from public.hrm_positions) as positions_after,
  (select string_agg(name, ', ' order by name) from public.hrm_positions where name ~ '^[0-9]+$') as numeric_kept;
rollback;
