create or replace function public.normalize_daily_log_volume_defaults()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.attachments := coalesce(new.attachments, '[]'::jsonb);
  return new;
end;
$$;

drop trigger if exists trg_normalize_daily_log_volume_defaults on public.daily_log_volumes;
create trigger trg_normalize_daily_log_volume_defaults
before insert or update on public.daily_log_volumes
for each row
execute function public.normalize_daily_log_volume_defaults();

update public.daily_log_volumes
set attachments = '[]'::jsonb
where attachments is null;

notify pgrst, 'reload schema';
