import type { ProcurementInboxDetail, ProcurementInboxDocument, ProcurementInboxLine, ProcurementLineAssignee } from './procurementInboxService';

// Giao việc theo dòng (chủ SP duyệt 08/10/2026): công trường gom nhu cầu vào một phiếu, phòng Mua chia
// từng dòng cho người mua. Dòng chưa giao riêng thuộc người điều phối (người xử lý của phiếu).

export interface LineOwner { userId: string | null; name: string | null; /** Giao riêng cho dòng, không phải theo điều phối. */ explicit: boolean }

type Coordinator = Pick<ProcurementInboxDetail, 'assignment'>;

export const lineOwner = (line: Pick<ProcurementInboxLine, 'assigneeUserId' | 'assigneeName'>, doc: Coordinator): LineOwner =>
  line.assigneeUserId
    ? { userId: line.assigneeUserId, name: line.assigneeName || null, explicit: true }
    : { userId: doc.assignment?.assigneeUserId || null, name: doc.assignment?.assigneeName || null, explicit: false };

export const lineKey = (doc: Pick<ProcurementInboxDetail, 'sourceType' | 'sourceId'>, lineId: string) => `${doc.sourceType}:${doc.sourceId}:${lineId}`;

/** Người mua của các dòng còn thiếu, đếm theo người (người chưa có tên xếp cuối). */
export const openLineOwners = (doc: ProcurementInboxDetail) => {
  const map = new Map<string, { userId: string | null; name: string | null; count: number }>();
  doc.lines.filter(l => l.remainingQty > 0).forEach(l => {
    const owner = lineOwner(l, doc);
    const key = owner.userId || '';
    const cur = map.get(key) || { userId: owner.userId, name: owner.name, count: 0 };
    cur.count += 1; map.set(key, cur);
  });
  return Array.from(map.values()).sort((a, b) => Number(!a.userId) - Number(!b.userId) || b.count - a.count);
};

/**
 * Dòng đưa vào đơn khi lập đơn:
 *  - đã tick dòng (picked) → đúng các dòng đó;
 *  - phiếu chưa chia theo dòng → mọi dòng (như trước);
 *  - phiếu đã chia → dòng của mình và dòng chưa có người mua; dòng người khác mua thì bỏ qua (tránh đặt trùng).
 */
export const splitLinesForOrder = (docs: ProcurementInboxDetail[], currentUserId: string, picked?: ReadonlySet<string>) => {
  const include = new Set<string>();
  const skipped = new Map<string, { name: string | null; count: number }>();
  docs.forEach(doc => {
    const split = doc.lines.some(l => l.assigneeUserId);
    doc.lines.forEach(line => {
      const key = lineKey(doc, line.lineId);
      if (picked) { if (picked.has(key)) include.add(key); return; }
      const owner = lineOwner(line, doc);
      if (split && owner.userId && owner.userId !== currentUserId) {
        if (line.remainingQty > 0) {
          const cur = skipped.get(owner.userId) || { name: owner.name, count: 0 };
          cur.count += 1; skipped.set(owner.userId, cur);
        }
        return;
      }
      include.add(key);
    });
  });
  return { include, skipped: Array.from(skipped.values()) };
};

/** Tóm tắt người mua của phiếu trên danh sách. null = phiếu không chia theo dòng (hiện người điều phối như cũ). */
export const docBuyers = (doc: Pick<ProcurementInboxDocument, 'lineAssignees' | 'unassignedOpenLines' | 'progress'>) => {
  const open = doc.progress === 'new' || doc.progress === 'partial';
  const people = (doc.lineAssignees || []).filter((p: ProcurementLineAssignee) => (open ? p.openLines > 0 : p.lines > 0));
  const unassigned = open ? doc.unassignedOpenLines || 0 : 0;
  // Không ai mua, hoặc một người mua hết: hiện như cũ ("Chưa giao" / tên người xử lý).
  if (people.length === 0 || (people.length === 1 && unassigned === 0)) return null;
  return { people: people.map(p => ({ ...p, count: open ? p.openLines : p.lines })), unassigned };
};

/** Tên gọi ngắn để hiện gọn nhiều người trên một dòng ("Nguyễn Thị Mơ" → "Mơ"). */
export const givenName = (name: string | null) => (name || '').trim().split(/\s+/).pop() || '—';
