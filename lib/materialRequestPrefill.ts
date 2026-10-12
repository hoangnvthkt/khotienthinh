// Gợi ý khi lập Đề xuất vật tư (chủ SP 11–13/10/2026): vật tư công trường hay đề xuất + quy cách lần trước.
// Đo 90 ngày: 32% dòng là vật tư công trường đã từng đề xuất. Dùng danh sách phiếu đã tải ở màn — không cần AI, không gọi máy chủ.
import { RequestStatus, type MaterialRequest } from '../types';
import { shortDate } from './uiPrefill';

export interface SiteItemHistory {
  itemId: string;
  /** Số phiếu có mã này trong 90 ngày. */
  count: number;
  lastDate: string;
  lastCode: string;
  /** Quy cách của lần đề xuất gần nhất có ghi quy cách. */
  lastSpec: string;
  lastSpecCode: string;
  lastSpecDate: string;
}

const WINDOW_DAYS = 90;
const SKIP = new Set<string>([RequestStatus.DRAFT, RequestStatus.REJECTED]);
const day = (value?: string | null) => String(value || '').slice(0, 10);

/** Lịch sử mã vật tư của công trường (cùng dự án, không có dự án thì cùng công trường), mới nhất trước. */
export const buildSiteItemHistory = (requests: MaterialRequest[], scope: {
  projectId?: string | null; constructionSiteId?: string | null; excludeRequestId?: string | null; today?: string;
}): Map<string, SiteItemHistory> => {
  const map = new Map<string, SiteItemHistory>();
  if (!scope.projectId && !scope.constructionSiteId) return map;
  const today = scope.today || new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 864e5).toISOString().slice(0, 10);
  requests
    .filter(req => req.id !== scope.excludeRequestId && !SKIP.has(req.status))
    .filter(req => scope.projectId ? req.projectId === scope.projectId : req.constructionSiteId === scope.constructionSiteId)
    .filter(req => day(req.createdDate) >= from)
    .sort((a, b) => day(b.createdDate).localeCompare(day(a.createdDate)))
    .forEach(req => {
      const seen = new Set<string>();
      (req.items || []).forEach(line => {
        if (!line.itemId) return;
        const spec = String(line.specification || '').trim();
        const entry = map.get(line.itemId);
        if (!entry) {
          map.set(line.itemId, { itemId: line.itemId, count: 1, lastDate: day(req.createdDate), lastCode: req.code,
            lastSpec: spec, lastSpecCode: spec ? req.code : '', lastSpecDate: spec ? day(req.createdDate) : '' });
        } else {
          if (!seen.has(line.itemId)) entry.count += 1;
          if (!entry.lastSpec && spec) { entry.lastSpec = spec; entry.lastSpecCode = req.code; entry.lastSpecDate = day(req.createdDate); }
        }
        seen.add(line.itemId);
      });
    });
  return map;
};

/** Mã hay đề xuất: nhiều phiếu trước, cùng số thì gần đây trước. */
export const frequentSiteItems = (history: Map<string, SiteItemHistory>, limit = 8) =>
  Array.from(history.values()).sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate)).slice(0, limit);

/** Chữ mờ cho ô quy cách: quy cách lần trước của mã ở công trường này. */
export const siteSpecGhost = (entry: SiteItemHistory | undefined) => entry?.lastSpec
  ? { text: entry.lastSpec, value: entry.lastSpec, title: `Theo ${entry.lastSpecCode} (${shortDate(entry.lastSpecDate)})` }
  : null;
