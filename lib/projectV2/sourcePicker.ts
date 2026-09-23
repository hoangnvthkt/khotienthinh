import { parseQuantity6 } from '../procurement/decimal';

export interface ProjectV2SourceCandidate {
  sourcePlanId: string;
  sourceRevision: number;
  sourcePlanHash: string;
  sourceLineId: string;
  sourceQuantity: string | null;
  availableQuantity: string | null;
  sourceUnit: string | null;
  workspaceId: string;
  sourceStatus: string;
  unavailableReason: string | null;
  code: string;
  title: string;
}

export function filterCandidates<T extends ProjectV2SourceCandidate>(
  rows: T[], workspaceId: string, search: string,
): T[] {
  const needle = search.trim().toLocaleLowerCase('vi');
  return rows.filter(row => row.workspaceId === workspaceId && (!needle ||
    `${row.code} ${row.title}`.toLocaleLowerCase('vi').includes(needle)));
}

export function candidateUnavailableReason(row: ProjectV2SourceCandidate, workspaceId: string): string | null {
  if (row.workspaceId !== workspaceId) return 'Nguồn không thuộc dự án này';
  if (row.sourceStatus !== 'approved') return 'Nguồn chưa được duyệt';
  if (row.unavailableReason) return row.unavailableReason;
  if (row.availableQuantity === null) return 'Chưa xác định khối lượng khả dụng';
  try {
    if (parseQuantity6(row.availableQuantity) <= 0n) return 'Đã phân bổ hết';
  } catch { return 'Khối lượng nguồn không hợp lệ'; }
  return null;
}

export function selectDisplayed<T extends ProjectV2SourceCandidate>(
  selectedIds: string[], displayed: T[], workspaceId: string,
): string[] {
  const selected = new Set(selectedIds);
  for (const row of displayed) if (!candidateUnavailableReason(row, workspaceId)) selected.add(row.sourceLineId);
  return [...selected];
}

export function validateSelectedSources<T extends ProjectV2SourceCandidate>(
  rows: T[], selectedIds: string[], workspaceId: string,
  requested: Record<string, { revision: number; hash: string; quantity: string }> = {},
): { sourceLineId: string; reason: string }[] {
  const issues: { sourceLineId: string; reason: string }[] = [];
  for (const id of selectedIds) {
    const row = rows.find(item => item.sourceLineId === id);
    if (!row) { issues.push({ sourceLineId: id, reason: 'Nguồn không còn khả dụng' }); continue; }
    const reason = candidateUnavailableReason(row, workspaceId);
    if (reason) issues.push({ sourceLineId: id, reason });
    const request = requested[id];
    if (!request) continue;
    if (request.revision !== row.sourceRevision || request.hash !== row.sourcePlanHash)
      issues.push({ sourceLineId: id, reason: 'Nguồn đã đổi phiên bản' });
    if (row.availableQuantity !== null) {
      try {
        if (parseQuantity6(request.quantity) > parseQuantity6(row.availableQuantity))
          issues.push({ sourceLineId: id, reason: `Khối lượng vượt khả dụng (${row.availableQuantity})` });
      } catch { issues.push({ sourceLineId: id, reason: 'Khối lượng không hợp lệ' }); }
    }
  }
  return issues;
}
