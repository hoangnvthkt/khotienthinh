export const HRM_PERSONNEL_SECTION_KEYS = [
  'overview',
  'personal_contact',
  'work_organization',
  'attendance_leave',
  'contracts_employment',
  'legal_insurance',
  'compensation_tax_bank',
  'qualifications_documents',
] as const;

export type HrmPersonnelSectionKey = typeof HRM_PERSONNEL_SECTION_KEYS[number];
export type HrmPersonnelDetailSectionKey = Exclude<HrmPersonnelSectionKey, 'overview'>;
export type HrmPersonnelAccessLevel = 'NONE' | 'DIRECTORY' | 'SELF' | 'MANAGER' | 'HR' | 'HR_MANAGE';

export interface HrmPersonnelOverview {
  employeeId: string;
  employeeCode: string | null;
  fullName: string;
  title: string | null;
  status: string | null;
  avatarUrl: string | null;
  accessLevel: HrmPersonnelAccessLevel;
  visibleSections: HrmPersonnelSectionKey[];
  maskedFields: string[];
  canEditSections: HrmPersonnelSectionKey[];
  summary: Record<string, unknown>;
}

export type HrmPersonnelSectionPayload = Record<string, unknown> & { employeeId: string };

