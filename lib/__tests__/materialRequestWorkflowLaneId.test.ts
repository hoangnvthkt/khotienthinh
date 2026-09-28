import { describe, expect, it } from 'vitest';
import { getMaterialRequestWorkflowLaneId } from '../materialRequestService';

describe('getMaterialRequestWorkflowLaneId', () => {
  it('merges the same step from the global template and a project clone into one lane', () => {
    expect(getMaterialRequestWorkflowLaneId('Phòng QLDA duyệt'))
      .toBe(getMaterialRequestWorkflowLaneId('  phòng QLDA   Duyệt '));
  });

  it('keeps different steps apart', () => {
    expect(getMaterialRequestWorkflowLaneId('BCH CT Duyệt'))
      .not.toBe(getMaterialRequestWorkflowLaneId('Phòng QLDA duyệt'));
  });
});
