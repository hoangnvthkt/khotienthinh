import { describe, expect, it } from 'vitest';
import {
  ageLabel, dateListLabel, nextReviewItem, otherProjects, parseReviewQueue, scopeQueue, takeoverErrorMessage, waitingLabel,
} from '../dailyLogReviewQueue';

// Hàng chờ thật của anh Sơn trên Cloud 17/10/2026 (SMB 01, 05–08/10) + 1 phiếu DA29 giả định để thử gộp dự án khác.
const raw = {
  mine: [
    { id: 'smb-0805', projectId: 'smb', constructionSiteId: 'site-smb', projectCode: 'SMB-2026', date: '2026-10-08', submittedAt: '2026-10-11T08:23:00Z', waitingHours: 147, senderName: 'Nguyễn Chấp Việt', assigneeName: 'Phạm Ngọc Sơn', permission: 'verify', summary: false },
    { id: 'smb-0110', projectId: 'smb', constructionSiteId: 'site-smb', projectCode: 'SMB-2026', date: '2026-10-01', submittedAt: '2026-10-03T07:31:00Z', waitingHours: 340, permission: 'approve', summary: true },
    { id: 'smb-0510', projectId: 'smb', constructionSiteId: 'site-smb', projectCode: 'SMB-2026', date: '2026-10-05', submittedAt: '2026-10-10T07:20:00Z', waitingHours: 172, permission: 'verify' },
    { id: 'da29-1310', projectId: 'da29', constructionSiteId: 'site-da29', projectCode: 'DA29', date: '2026-10-13', submittedAt: '2026-10-16T06:44:00Z', waitingHours: 29, permission: 'approve', summary: true },
    { id: '', date: '2026-10-09' },
  ],
  takeover: [],
  isBackup: false,
  takeoverDays: 2,
};

describe('hàng chờ duyệt nhật ký', () => {
  it('chuẩn hóa từ máy chủ: bỏ dòng hỏng, cũ trước, quyền duyệt / xác nhận', () => {
    const queue = parseReviewQueue(raw);
    expect(queue.mine.map(item => item.id)).toEqual(['smb-0110', 'smb-0510', 'smb-0805', 'da29-1310']);
    expect(queue.mine[0]).toMatchObject({ permission: 'approve', summary: true, waitingHours: 340, projectCode: 'SMB-2026' });
    expect(queue.mine[1]).toMatchObject({ permission: 'verify', summary: false });
    expect(parseReviewQueue(null)).toEqual({ mine: [], takeover: [], isBackup: false, takeoverDays: 2 });
  });

  it('theo dự án đang mở: duyệt lần lượt từ ngày cũ; dự án khác gộp thành chip', () => {
    const queue = parseReviewQueue(raw);
    const here = scopeQueue(queue.mine, 'smb', 'site-smb');
    expect(here.map(item => item.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-08']);
    expect(otherProjects(queue.mine, 'smb', 'site-smb')).toEqual([{ projectId: 'da29', siteId: 'site-da29', projectCode: 'DA29', count: 1, firstId: 'da29-1310' }]);
  });

  it('xong một phiếu thì mở ngày sau; xong ngày cuối thì quay về ngày đầu còn lại; hết hàng thì null', () => {
    const here = scopeQueue(parseReviewQueue(raw).mine, 'smb', 'site-smb');
    expect(nextReviewItem(here, 'smb-0110')?.id).toBe('smb-0510');
    expect(nextReviewItem(here, 'smb-0805')?.id).toBe('smb-0110');
    expect(nextReviewItem([here[0]], 'smb-0110')).toBeNull();
  });

  it('câu chữ ngắn: thời gian chờ và danh sách ngày như tin gộp của máy chủ', () => {
    expect(waitingLabel(147)).toBe('chờ 6 ngày');
    expect(waitingLabel(5)).toBe('chờ 5 giờ');
    expect(waitingLabel(0)).toBe('vừa gửi');
    expect(ageLabel(340)).toBe('14 ngày');
    expect(dateListLabel(['2026-10-08', '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07'])).toBe('01, 05–08/10');
    expect(dateListLabel(['2026-09-28', '2026-10-01', '2026-10-02'])).toBe('28/09, 01–02/10');
    expect(dateListLabel(['2026-10-13'])).toBe('13/10');
    expect(dateListLabel(['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-11', '2026-10-13'])).toBe('01–13/10 (7 ngày)');
  });

  it('lỗi duyệt thay nói rõ lý do theo mã máy chủ', () => {
    expect(takeoverErrorMessage({ message: 'DAILY_LOG_TAKEOVER_TOO_EARLY' })).toContain('chưa treo đủ lâu');
    expect(takeoverErrorMessage({ message: 'DAILY_LOG_APPROVER_REQUIRED' })).toContain('Room Nhật ký');
    expect(takeoverErrorMessage({ message: 'mạng lỗi' })).toBe('mạng lỗi');
  });
});
