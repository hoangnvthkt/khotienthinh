update public.notifications
set is_dismissed = true
where category = 'inventory'
  and (
    source_type = 'inventory'
    or source_id like 'inventory_low_%'
    or lower(title) like '%tồn kho thấp%'
    or lower(title) like '%hết hàng%'
  );
