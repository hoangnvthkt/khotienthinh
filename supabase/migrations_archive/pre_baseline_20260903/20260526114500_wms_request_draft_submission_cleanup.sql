alter table if exists public.requests
  add column if not exists ever_submitted boolean not null default false,
  add column if not exists last_action_by text,
  add column if not exists last_action_at timestamptz;

create index if not exists idx_requests_ever_submitted_status
  on public.requests (ever_submitted, status);

create index if not exists idx_requests_last_action
  on public.requests (last_action_at desc);

do $$
begin
  if to_regclass('public.requests') is not null then
    update public.requests
    set ever_submitted = true
    where coalesce(status::text, 'DRAFT') <> 'DRAFT';
  end if;
end $$;
