-- Convert legacy WMS keeper rows to the application role value.
-- Must run after WAREHOUSE_KEEPER has been committed to public.user_role.

update public.users
set role = 'WAREHOUSE_KEEPER'::public.user_role
where role::text = 'KEEPER';

notify pgrst, 'reload schema';
