-- Allow weekly WBS progress to exceed 100% for over-completion tracking.

do $$
declare
  c record;
begin
  if to_regclass('public.project_weekly_task_progress') is not null then
    for c in
      select pc.conname
      from pg_constraint pc
      where pc.conrelid = 'public.project_weekly_task_progress'::regclass
        and pc.contype = 'c'
        and exists (
          select 1
          from unnest(pc.conkey) as key(attnum)
          join pg_attribute a
            on a.attrelid = pc.conrelid
           and a.attnum = key.attnum
          where a.attname = 'progress_percent'
        )
    loop
      execute format('alter table public.project_weekly_task_progress drop constraint %I', c.conname);
    end loop;

    alter table public.project_weekly_task_progress
      add constraint project_weekly_task_progress_progress_percent_nonnegative
      check (progress_percent >= 0);
  end if;

  if to_regclass('public.project_tasks') is not null then
    for c in
      select pc.conname
      from pg_constraint pc
      where pc.conrelid = 'public.project_tasks'::regclass
        and pc.contype = 'c'
        and exists (
          select 1
          from unnest(pc.conkey) as key(attnum)
          join pg_attribute a
            on a.attrelid = pc.conrelid
           and a.attnum = key.attnum
          where a.attname = 'progress'
        )
    loop
      execute format('alter table public.project_tasks drop constraint %I', c.conname);
    end loop;

    alter table public.project_tasks
      add constraint project_tasks_progress_nonnegative
      check (progress >= 0);
  end if;
end;
$$;

notify pgrst, 'reload schema';
