-- Keep activity history when an app user profile is deleted.
-- The rows already store user_name/user_avatar snapshots, so user_id can be nulled safely.

alter table public.activities
  alter column user_id drop not null;

alter table public.activities
  drop constraint if exists activities_user_id_fkey;

alter table public.activities
  add constraint activities_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete set null;

notify pgrst, 'reload schema';
