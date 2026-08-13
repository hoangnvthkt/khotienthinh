import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'pages', 'project', 'GanttTab.tsx'), 'utf8');

describe('Gantt authoritative Room workspace contract', () => {
  it('loads effective Room actions and fails closed before loading schedule data', () => {
    expect(source).toContain('projectPermissionRoomService.listMyActions');
    expect(source).toContain('getGanttEffectiveCapabilities');
    expect(source).toContain('if (!ganttCapabilities.canView)');
    expect(source).toContain('Bạn không có quyền xem Room Tiến độ');
    expect(source).not.toContain('hasProjectPbac');
    expect(source).not.toContain('checkProjectPermission');
    expect(source).not.toContain('ProjectPermissionCode');
  });

  it('uses edit and delete independently for mutation controls', () => {
    expect(source).toContain('ganttCapabilities.canEdit');
    expect(source).toContain('ganttCapabilities.canDelete');
    expect(source).toContain("ensureGanttCapability('edit'");
    expect(source).toContain("ensureGanttCapability('delete'");
  });

  it('routes schedule mutations through authoritative commands', () => {
    for (const command of [
      'projectGanttCommandService.saveTasks',
      'projectGanttCommandService.deleteTaskTree',
      'projectGanttCommandService.createBaseline',
      'projectGanttCommandService.transitionDelayEvent',
      'projectGanttCommandService.applyForecast',
    ]) expect(source).toContain(command);

    for (const directWrite of [
      'taskService.upsert(',
      'taskService.upsertMany(',
      'taskService.remove(',
      'baselineService.create(',
      'taskContractItemService.replaceForTask(',
      'delayEventService.markStatus(',
      'scheduleRevisionService.createAndApply(',
      'addProjectFinance(',
      'updateProjectFinance(',
      'notificationService.notifyProjectUsers(',
    ]) expect(source).not.toContain(directWrite);
  });
});
