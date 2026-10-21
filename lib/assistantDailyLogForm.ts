// Trợ lý v2 · T2d — nhật ký từ báo cáo Zalo NGAY TRONG khung chat (chủ SP 18/10/2026): thẻ đọc báo cáo bằng ĐÚNG bộ của màn Nhật ký
// (readReportDrafts / createReportDrafts + defaultReportImportHooks: skill daily_log_from_report, cửa sổ kế hoạch, trí nhớ cách gọi, tổ
// đội gần đây, RPC phiếu kỹ sư). Người dùng sửa hạng mục, bấm Tạo phiếu nháp; mở phiếu để điền KL / % rồi gửi như thường.
import type { ProjectTask } from '../types';
import { finishCommand, type AssistantCommand } from './assistantCommands';
import { taskService } from './projectService';
import { defaultReportImportHooks, type ReportImportHooks } from '../components/project/daily-log/DailyLogReportImport';

export interface DailyLogFormActions {
  /** Hạng mục kế hoạch của dự án (như màn Nhật ký nạp). */
  tasks: (projectId: string, siteId: string | null) => Promise<ProjectTask[]>;
  hooks: ReportImportHooks;
  /** Ghi biên nhận (các phiếu đã tạo) vào lệnh. */
  finish: (command: AssistantCommand, result: Record<string, unknown>) => Promise<AssistantCommand>;
}

export const defaultDailyLogFormActions: DailyLogFormActions = {
  tasks: (projectId, siteId) => taskService.list(projectId, siteId),
  hooks: defaultReportImportHooks,
  finish: async (command, result) => (await finishCommand(command.id, 'done', result).catch(() => null)) || { ...command, status: 'done', result },
};
