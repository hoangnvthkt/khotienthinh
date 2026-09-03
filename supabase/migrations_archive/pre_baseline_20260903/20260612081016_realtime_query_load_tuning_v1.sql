-- Temporary load tuning for Supabase instability.
-- Focus: query patterns found in pg_stat_statements:
--   - project_id/construction_site_id + sort + pagination
--   - recent activity feed
--   - notification visible/unread lookups
--
-- Keep this migration data-only/index-only. Do not remove tables from
-- supabase_realtime here; the client now reduces active subscriptions.

create index if not exists idx_project_tasks_project_sort_order_id
  on public.project_tasks(project_id, sort_order, id)
  where project_id is not null;

create index if not exists idx_project_tasks_site_sort_order_id
  on public.project_tasks(construction_site_id, sort_order, id)
  where construction_site_id is not null;

create index if not exists idx_project_work_boq_items_project_sort_order_id
  on public.project_work_boq_items(project_id, sort_order, id)
  where project_id is not null;

create index if not exists idx_project_work_boq_items_site_sort_order_id
  on public.project_work_boq_items(construction_site_id, sort_order, id)
  where construction_site_id is not null;

create index if not exists idx_material_budget_items_project_category_id
  on public.material_budget_items(project_id, category, id)
  where project_id is not null;

create index if not exists idx_material_budget_items_site_category_id
  on public.material_budget_items(construction_site_id, category, id)
  where construction_site_id is not null;

create index if not exists idx_activities_timestamp_desc_id
  on public.activities("timestamp" desc, id);

create index if not exists idx_notifications_user_visible_created_id
  on public.notifications(user_id, is_dismissed, created_at desc, id)
  where user_id is not null;

create index if not exists idx_notifications_user_unread_visible_created_id
  on public.notifications(user_id, created_at desc, id)
  where user_id is not null
    and is_read = false
    and is_dismissed = false;

create index if not exists idx_notifications_global_visible_created_id
  on public.notifications(created_at desc, id)
  where user_id is null
    and is_dismissed = false;

create index if not exists idx_notifications_global_unread_visible_created_id
  on public.notifications(created_at desc, id)
  where user_id is null
    and is_read = false
    and is_dismissed = false;
