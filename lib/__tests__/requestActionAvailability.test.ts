import { describe, expect, it } from 'vitest';
import { getRequestActions } from '../requestActionAvailability';

describe('request action availability', () => {
  it('shows approval actions only for an active approver', () => {
    expect(getRequestActions({ status: 'PENDING', canApprove: true, isCreator: false })).toEqual(['APPROVE', 'REJECT', 'RETURN']);
  });

  it('allows the creator to resubmit a returned request or cancel it', () => {
    expect(getRequestActions({ status: 'RETURNED', canApprove: false, isCreator: true })).toEqual(['RESUBMIT', 'CANCEL']);
  });

  it('shows reassignment when the server permits it', () => {
    expect(getRequestActions({ status: 'PENDING', canApprove: false, canReassign: true, isCreator: false })).toEqual(['REASSIGN']);
  });

  it('has no action for terminal requests', () => {
    expect(getRequestActions({ status: 'APPROVED', canApprove: true, canCancel: true, isCreator: true })).toEqual([]);
  });
});
