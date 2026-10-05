// Điều động công trường (H2): who works at which attendance site, from when to when.
// One record per person per site; the server applies approved records on their start date.

export type SiteAssignmentKind = 'primary' | 'concurrent' | 'temporary';
export type SiteAssignmentStatus = 'pending' | 'awaiting_office' | 'approved' | 'rejected' | 'cancelled';
export type SiteAssignmentStage = 'pending' | 'awaiting_office' | 'upcoming' | 'active' | 'closed';

export interface SiteAssignment {
  id: string;
  code: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  jobTitle: string | null;
  siteId: string;
  siteName: string;
  projectCode: string | null;
  kind: SiteAssignmentKind;
  startDate: string;
  endDate: string | null;
  status: SiteAssignmentStatus;
  reason: string;
  /** "baseline" = recorded from the situation before H2, not a real move. */
  source: 'request' | 'baseline';
  /** Primary site the person leaves (ends the day before startDate; for temporary, resumes after). */
  fromSiteName: string | null;
  createdByName: string | null;
  createdAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  endedEarlyReason: string | null;
  sourceRequestId?: string | null;
  officeDocumentId?: string | null;
  canApprove?: boolean;
}

export interface SiteSummary {
  id: string;
  name: string;
  projectCode: string | null;
  projectName: string | null;
  approverName: string | null;
  hasCoordinates: boolean;
}

/** One person HR still has to confirm before H2 starts: where they really work. */
export interface SiteReviewRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  jobTitle: string | null;
  /** Sites this person appears on today (project team list or profile). */
  sites: Array<{ siteId: string; siteName: string; role: string | null; since: string | null }>;
  suggestedSiteId: string | null;
  /** Why the suggestion: profile site, single site-type role, or office role. */
  suggestionNote: string;
  office: boolean;
}

export interface SiteAssignmentPreview {
  problems: string[];
  warnings: string[];
  effects: string[];
}

export const KIND_LABEL: Record<SiteAssignmentKind, string> = {
  primary: 'Chính',
  concurrent: 'Kiêm nhiệm',
  temporary: 'Tạm thời',
};

export const KIND_HINT: Record<SiteAssignmentKind, string> = {
  primary: 'Làm hẳn ở công trường này; nơi chính cũ kết thúc ngày hôm trước.',
  concurrent: 'Làm thêm ở công trường này; nơi chính giữ nguyên (chấm công, duyệt phép theo nơi chính).',
  temporary: 'Đi tăng cường có thời hạn; trong thời gian này là nơi chính, hết hạn tự về nơi cũ.',
};

export const STAGE_LABEL: Record<SiteAssignmentStage, string> = {
  pending: 'Chờ duyệt',
  awaiting_office: 'Chờ phát hành Office',
  upcoming: 'Sắp hiệu lực',
  active: 'Đang làm',
  closed: 'Đã kết thúc',
};

export const stageOf = (row: Pick<SiteAssignment, 'status' | 'startDate' | 'endDate'>, today: string): SiteAssignmentStage => {
  if (row.status === 'pending') return 'pending';
  if (row.status === 'awaiting_office') return 'awaiting_office';
  if (row.status !== 'approved') return 'closed';
  if (row.endDate && row.endDate < today) return 'closed';
  return row.startDate > today ? 'upcoming' : 'active';
};

export const closedLabel = (row: Pick<SiteAssignment, 'status' | 'endedEarlyReason'>): string =>
  row.status === 'rejected' ? 'Từ chối' : row.status === 'cancelled' ? 'Đã hủy' : row.endedEarlyReason ? 'Kết thúc sớm' : 'Hết hạn';

export const dateVi = (value: string | null | undefined) => value ? value.slice(0, 10).split('-').reverse().join('/') : '';

export const periodLabel = (row: Pick<SiteAssignment, 'startDate' | 'endDate'>) =>
  `${dateVi(row.startDate)} → ${row.endDate ? dateVi(row.endDate) : 'không thời hạn'}`;

/** Whole days between two YYYY-MM-DD dates (b − a). */
export const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Day before a YYYY-MM-DD date. */
export const dayBefore = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};
