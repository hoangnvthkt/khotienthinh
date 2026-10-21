import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Lỗi "vượt ngân sách 199" ở DA29 (12/10/2026): BOQ chia theo đầu mục (362 dòng / 80 mã), phiếu gom theo mã
// (130 dòng phiếu đều không gắn dòng BOQ) → số đề xuất của một mã bị cộng vào MỌI dòng BOQ cùng mã.
const materialTab = readFileSync(join(process.cwd(), 'pages/project/MaterialTab.tsx'), 'utf8');

describe('Vượt ngân sách theo mã vật tư, không theo từng dòng BOQ', () => {
  it('dòng phiếu không gắn dòng BOQ chỉ tính một lần, vào dòng neo của mã', () => {
    expect(materialTab).toContain('&& boqAnchorLineIdByGroup.get(boqGroupKeyOf(b)) === b.id;');
  });

  it('phiếu nháp không tính là đã đề xuất', () => {
    expect(materialTab).toContain('if (r.status !== RequestStatus.DRAFT) totalRequested += (ri.requestQty || 0);');
    expect(materialTab).toContain('if (request.status !== RequestStatus.DRAFT) requestedQty += Number(line.requestQty || 0);');
  });

  it('nhãn Vượt ở BOQ và "Cần chú ý" đánh giá theo cả mã', () => {
    expect(materialTab).toContain('isOverBudget: budgetQty > 0 && requestedQty > budgetQty');
    expect(materialTab).toContain('const isOver = materialStats.isOverBudget;');
    expect(materialTab).toContain('() => aggregateMaterialWasteRows(rawBoqLines)');
    expect(materialTab).toContain('const overBudgetItems = useMemo(() => aggregatedWasteBoqItems');
  });
});
