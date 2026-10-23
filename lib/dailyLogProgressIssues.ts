/** Lệch lũy kế làm Duyệt & công bố bị chặn (get_daily_log_progress_issues_v1), kèm câu chữ chỉ đúng chỗ. */

export interface DailyLogProgressIssueSource {
  summarySourceId: string;
  contributionId?: string | null;
  authorName?: string | null;
  areaName?: string | null;
  percent?: number | null;
}

export type DailyLogProgressIssue =
  | (DailyLogProgressIssueSource & {
    kind: 'baseline_changed';
    taskId: string; wbsCode?: string | null; taskName?: string | null;
    slipPercent?: number | null; slipBaselinePercent?: number | null;
    cause: 'earlier_day' | 'later_day' | 'plan_changed';
    causeDate?: string | null; causePercent?: number | null;
  })
  | {
    kind: 'below_approved' | 'above_later';
    taskId: string; wbsCode?: string | null; taskName?: string | null;
    officialPercent?: number | null; approvedDate?: string | null; approvedPercent?: number | null;
    sources: DailyLogProgressIssueSource[];
  };

export interface DailyLogProgressIssueView {
  key: string;
  task: string;
  problem: string;
  fix: string;
  sources: DailyLogProgressIssueSource[];
  /** Lý do điền sẵn khi trả phiếu cho kỹ sư. */
  returnReason: string;
}

const percentFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '—' : `${percentFormat.format(Number(value))}%`;
export const shortDailyLogDate = (value: string | null | undefined) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return match ? `${match[3]}/${match[2]}` : 'ngày khác';
};

export const describeDailyLogProgressIssue = (issue: DailyLogProgressIssue): DailyLogProgressIssueView => {
  const task = [issue.wbsCode, issue.taskName].filter(Boolean).join(' ') || 'Hạng mục chưa rõ tên';
  if (issue.kind === 'baseline_changed') {
    const when = shortDailyLogDate(issue.causeDate);
    const problem = issue.cause === 'earlier_day'
      ? `Lập phiếu khi lũy kế trước là ${pct(issue.slipBaselinePercent)}; sau đó ngày ${when} được duyệt ${pct(issue.causePercent)}.`
      : issue.cause === 'later_day'
        ? `Ngày ${when} (${pct(issue.causePercent)}) được duyệt sau khi lập phiếu này.`
        : 'Kế hoạch hoặc khối lượng của hạng mục đã sửa sau khi lập phiếu.';
    return {
      key: `${issue.kind}:${issue.summarySourceId}:${issue.taskId}`, task, problem,
      fix: 'Kỹ sư mở phiếu, lưu lại để tính lũy kế theo mốc mới rồi gửi lại.',
      sources: [issue],
      returnReason: `${task}: ${problem} Mở phiếu, lưu lại để cập nhật lũy kế rồi gửi lại.`,
    };
  }
  const when = shortDailyLogDate(issue.approvedDate);
  const problem = issue.kind === 'below_approved'
    ? `Bản này ghi ${pct(issue.officialPercent)}, thấp hơn ${pct(issue.approvedPercent)} đã ghi nhận ngày ${when}. Lũy kế không được giảm.`
    : `Bản này ghi ${pct(issue.officialPercent)}, cao hơn ${pct(issue.approvedPercent)} đã duyệt ngày ${when} (ngày sau).`;
  return {
    key: `${issue.kind}:${issue.taskId}`, task, problem,
    fix: issue.kind === 'below_approved'
      ? `Sửa lũy kế từ ${pct(issue.approvedPercent)} trở lên. Nếu mốc ${pct(issue.approvedPercent)} ghi sai, điều chỉnh tiến độ (có duyệt) trước.`
      : `Sửa lũy kế không quá ${pct(issue.approvedPercent)}, hoặc điều chỉnh tiến độ ngày ${when} trước.`,
    sources: issue.sources,
    returnReason: `${task}: ${problem} Sửa lại % lũy kế rồi gửi lại.`,
  };
};
