import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// Đo 12/10/2026: % tiến độ trên danh sách dự án hiện ở 4,6–5,5 s (chờ 11 lần đọc giao dịch + tải ~863 công việc).
describe('% tiến độ danh sách dự án hiện cùng lúc với thẻ dự án', () => {
  const dashboard = read('pages/ProjectDashboard.tsx');
  const migration = read('supabase/migrations/20261012160400_project_task_progress_v1.sql');

  it('máy chủ tính sẵn % theo đúng công thức calculateProjectProgress, theo quyền người xem', () => {
    expect(migration).toContain('security invoker');
    expect(migration).toContain('child.construction_site_id = tasks.construction_site_id and child.parent_id = tasks.id');
    expect(migration).toContain('greatest(0, least(100, coalesce(durations.progress, 0)))');
    expect(migration).toContain('durations.days * greatest(1, coalesce(nullif(durations.resource_count, 0), 1))');
  });

  it('gọi ngay khi mở trang, không chờ module tài chính; máy chủ chưa có hàm thì về đường cũ', () => {
    expect(dashboard).toContain('taskService.getProgressBySite()');
    expect(dashboard).toContain('}, [activeView, progressRpcMissing]);');
    expect(dashboard).toContain("error?.code === 'PGRST202'");
    expect(dashboard).toContain('if (!progressRpcMissing) return;');
  });

  it('có % từ Gantt thì hiện ngay; chỉ % dự phòng mới chờ module tài chính', () => {
    expect(dashboard).toContain('const progressTaskStatus = (taskProgress: number | undefined): ProjectProgressLoadStatus => {');
    expect(dashboard).not.toContain("taskStatus: moduleLoadState.da === 'loading' || moduleLoadState.da === 'idle' ? 'loading' : taskProgressStatus,");
  });
});
