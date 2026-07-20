-- Align public.users.role with the application Role enum.
-- Older databases only had KEEPER, while the app and WMS policies use WAREHOUSE_KEEPER.

alter type public.user_role add value if not exists 'WAREHOUSE_KEEPER' after 'ADMIN';

notify pgrst, 'reload schema';
