alter table public.site_direct_purchases
  add column if not exists submitted_to_user_id text,
  add column if not exists submitted_to_name text,
  add column if not exists submitted_to_permission text,
  add column if not exists submission_note text,
  add column if not exists ever_submitted boolean not null default false,
  add column if not exists last_action_by text,
  add column if not exists last_action_at timestamptz;

create index if not exists idx_site_direct_purchases_submission_target
  on public.site_direct_purchases(submitted_to_user_id, status, purchase_date desc);

create index if not exists idx_site_direct_purchases_last_action
  on public.site_direct_purchases(last_action_by, last_action_at desc);
