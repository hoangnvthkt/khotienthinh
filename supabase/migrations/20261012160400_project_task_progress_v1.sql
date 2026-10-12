-- % tiến độ trên danh sách dự án (Trung tâm Điều hành Công trường) — đo 12/10/2026: % hiện ở 4,6–5,5 s vì client
-- phải tải ~863 dòng công việc (chờ module tài chính) rồi tự tính. Hàm này tính sẵn một dòng mỗi công trường.
--
-- Công thức giữ đúng calculateProjectProgress (lib/projectScheduleRules.ts):
--   * chỉ công việc lá (không là cha của công việc nào trong cùng công trường);
--   * số ngày = 1 nếu mốc; duration nếu > 0; ngược lại max(1, end_date − start_date);
--   * trọng số = chi phí/ngày × số ngày nếu > 0, ngược lại số ngày × max(1, số người);
--   * % = làm tròn(Σ clamp(progress, 0, 100) × trọng số / Σ trọng số).
-- SECURITY INVOKER: RLS project_tasks (quyền xem Gantt) quyết định công trường nào thấy, như đọc bảng trực tiếp.

create or replace function public.get_project_task_progress_v1()
returns table (construction_site_id text, progress_percent integer, leaf_task_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with tasks as (
    select task.id, task.parent_id, task.construction_site_id, task.progress, task.duration, task.is_milestone,
      task.start_date, task.end_date, task.estimated_cost_per_day, task.resource_count
    from public.project_tasks task
    where task.construction_site_id is not null
  ),
  leaves as (
    select tasks.* from tasks
    where not exists (
      select 1 from tasks child
      where child.construction_site_id = tasks.construction_site_id and child.parent_id = tasks.id
    )
  ),
  durations as (
    select leaves.*,
      case
        when coalesce(leaves.is_milestone, false) then 1
        when coalesce(leaves.duration, 0) > 0 then leaves.duration
        else greatest(1, coalesce(nullif(leaves.end_date, '')::date - nullif(leaves.start_date, '')::date, 1))
      end::numeric as days
    from leaves
  ),
  weights as (
    select durations.construction_site_id,
      greatest(0, least(100, coalesce(durations.progress, 0)))::numeric as pct,
      case
        when coalesce(durations.estimated_cost_per_day, 0) * durations.days > 0 then durations.estimated_cost_per_day * durations.days
        else durations.days * greatest(1, coalesce(nullif(durations.resource_count, 0), 1))
      end as weight
    from durations
  )
  select weights.construction_site_id,
    case when sum(weights.weight) > 0 then round(sum(weights.pct * weights.weight) / sum(weights.weight))::integer else 0 end,
    count(*)::integer
  from weights
  group by weights.construction_site_id;
$$;

revoke all on function public.get_project_task_progress_v1() from public, anon;
grant execute on function public.get_project_task_progress_v1() to authenticated, service_role;

notify pgrst, 'reload schema';
