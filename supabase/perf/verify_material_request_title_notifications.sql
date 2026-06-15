select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requests'
      and column_name = 'title'
      and is_nullable = 'NO'
  ) as request_title_ready,
  (
    select count(*)
    from public.notifications
    where category = 'inventory'
      and not is_dismissed
  ) as active_inventory_notifications;
