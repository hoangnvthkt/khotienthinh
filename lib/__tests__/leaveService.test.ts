import { describe, expect, it } from 'vitest';
import { currentLeaveStep, LeaveStep } from '../leaveService';

const steps: LeaveStep[] = [
  { order: 1, kind: 'manager', userId: 'm1', label: 'Quản lý trong sơ đồ tổ chức', status: 'approved' },
  { order: 2, kind: 'director', userId: 'd1', label: 'Tổng giám đốc', status: 'waiting' },
];

describe('leave approval steps', () => {
  it('points at the step waiting for a decision', () => {
    expect(currentLeaveStep({ status: 'pending', approvers: steps, currentStep: 2 })?.userId).toBe('d1');
  });

  it('has no waiting step once the request is closed', () => {
    expect(currentLeaveStep({ status: 'approved', approvers: steps, currentStep: 2 })).toBeNull();
    expect(currentLeaveStep({ status: 'cancelled', approvers: steps, currentStep: 1 })).toBeNull();
  });

  it('starts at step 1 for old requests without a step counter', () => {
    expect(currentLeaveStep({ status: 'pending', approvers: steps, currentStep: null })?.userId).toBe('m1');
  });
});
