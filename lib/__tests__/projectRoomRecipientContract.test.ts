import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Project Room recipient cutover', () => {
  it('requires Room context for Project recipient selection', () => {
    const source = readFileSync(join(process.cwd(), 'components/project/ProjectRoomSubmissionDialog.tsx'), 'utf8');

    expect(source).toContain('recipientRoomCode');
    expect(source).toContain('recipientAction');
    expect(source).toContain('projectPermissionRoomService.listRecipients');
    expect(source).not.toContain('recipientPermissionCodes');
  });

  it('uses the PO Room for its primary recipient picker', () => {
    const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

    expect(source).toContain('recipientRoomCode="material_po"');
    expect(source).toContain('recipientAction="approve"');
    expect(source).not.toContain("recipientPermissionCodes={['confirm']}");
  });

  it('uses the PO Room for hot-purchase approval as well', () => {
    const source = readFileSync(join(process.cwd(), 'pages/project/SupplyChainTab.tsx'), 'utf8');

    expect(source).toContain('title="Gửi duyệt mua nóng"');
    expect(source).toContain('recipientRoomCode="material_po"');
    expect(source).not.toContain("recipientPermissionCodes={['project.material_direct_purchase.edit']}");
  });

  it('limits the first Material Request workflow recipient picker to its Room', () => {
    const startDialog = readFileSync(join(process.cwd(), 'components/project/ProjectWorkflowStartDialog.tsx'), 'utf8');
    const requestModal = readFileSync(join(process.cwd(), 'components/RequestModal.tsx'), 'utf8');

    expect(startDialog).toContain('projectPermissionRoomService.listRecipients');
    expect(startDialog).toContain('recipientRoomCode');
    expect(startDialog).toContain('recipientAction');
    expect(startDialog).toContain('assigneeUserIds.every(userId => roomRecipientUserIds.includes(userId))');
    expect(requestModal).toContain('recipientRoomCode="material_request"');
    expect(requestModal).toContain('recipientAction="approve"');
  });

  it('keeps later Material Request workflow handoffs inside its Room', () => {
    const actionDialog = readFileSync(join(process.cwd(), 'components/project/ProjectWorkflowActionDialog.tsx'), 'utf8');
    const workflowPanel = readFileSync(join(process.cwd(), 'components/project/ProjectWorkflowPanel.tsx'), 'utf8');
    const materialTab = readFileSync(join(process.cwd(), 'pages/project/MaterialTab.tsx'), 'utf8');

    expect(actionDialog).toContain('projectPermissionRoomService');
    expect(actionDialog).toContain('.listRecipients(');
    expect(actionDialog).toContain('if (!needsAssignee || (!recipientRoomCode && !resolvedRecipientAction))');
    expect(actionDialog).toContain('recipientRoomCode');
    expect(workflowPanel).toContain('recipientRoomCode');
    expect(materialTab).toContain('recipientRoomCode="material_request"');
    expect(materialTab).toContain('ProjectRoomSubmissionDialog');
  });

  it('routes payment approval and payment confirmation to separate Room actions', () => {
    const source = readFileSync(join(process.cwd(), 'components/project/PaymentCertificatePanel.tsx'), 'utf8');

    expect(source).toContain('ProjectRoomSubmissionDialog');
    expect(source).toContain('recipientRoomCode="payment"');
    expect(source).toContain('recipientAction="approve"');
    expect(source).toContain('recipientAction="confirm"');
    expect(source).not.toContain("recipientPermissionCodes={['confirm']}");
  });

  it('routes quantity acceptance approval to its Room', () => {
    const source = readFileSync(join(process.cwd(), 'components/project/QuantityAcceptancePanel.tsx'), 'utf8');

    expect(source).toContain('ProjectRoomSubmissionDialog');
    expect(source).toContain('recipientRoomCode="quantity_acceptance"');
    expect(source).toContain('recipientAction="approve"');
  });

  it('routes quality forms and checklists to the Quality Room', () => {
    const source = readFileSync(join(process.cwd(), 'pages/project/QualityTab.tsx'), 'utf8');

    expect(source).toContain('ProjectRoomSubmissionDialog');
    expect(source).toContain('recipientRoomCode="quality"');
    expect(source).toContain('recipientAction="approve"');
    expect(source).not.toContain("recipientPermissionCodes={['approve']}");
  });

  it('routes BOQ review and BOQ variations to the BOQ reconciliation Room', () => {
    const reconciliation = readFileSync(join(process.cwd(), 'components/project/BoqReconciliationPanel.tsx'), 'utf8');
    const variation = readFileSync(join(process.cwd(), 'components/project/ContractVariationPanel.tsx'), 'utf8');

    expect(reconciliation).toContain('ProjectRoomSubmissionDialog');
    expect(reconciliation).toContain('recipientRoomCode="boq_reconciliation"');
    expect(reconciliation).toContain('recipientAction="verify"');
    expect(variation).toContain('ProjectRoomSubmissionDialog');
    expect(variation).toContain('recipientRoomCode="boq_reconciliation"');
    expect(variation).toContain('recipientAction="approve"');
  });
});
