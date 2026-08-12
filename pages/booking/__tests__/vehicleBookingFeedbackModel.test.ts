import { describe, expect, it } from 'vitest';
import {
  buildVehicleFeedbackPayload,
  VEHICLE_FEEDBACK_POSITIVE_TAGS,
} from '../../../lib/vehicleBookingFeedbackModel';

const bookingId = '11111111-1111-4111-8111-111111111111';

describe('vehicle booking feedback model', () => {
  it('requires a private issue description for ratings up to three stars', () => {
    expect(buildVehicleFeedbackPayload({
      bookingId,
      rating: 2,
      hasIssue: false,
      positiveTags: [],
      issueCategory: null,
      comment: '',
    })).toEqual({
      ok: false,
      message: 'Vui lòng mô tả phản ánh cho đánh giá từ 3 sao trở xuống.',
    });
  });

  it('builds stable positive tag codes for normal feedback', () => {
    expect(buildVehicleFeedbackPayload({
      bookingId,
      rating: 5,
      hasIssue: false,
      positiveTags: ['ON_TIME', 'SAFE_DRIVING'],
      issueCategory: null,
      comment: '',
    })).toEqual({
      ok: true,
      value: {
        booking_id: bookingId,
        is_issue: false,
        rating: 5,
        positive_tags: ['ON_TIME', 'SAFE_DRIVING'],
      },
    });
  });

  it('builds an issue payload and keeps the rating', () => {
    expect(buildVehicleFeedbackPayload({
      bookingId,
      rating: 4,
      hasIssue: true,
      positiveTags: ['CLEAN_VEHICLE'],
      issueCategory: 'DRIVER_CONDUCT',
      comment: 'Tài xế có thái độ chưa phù hợp.',
    })).toMatchObject({
      ok: true,
      value: {
        is_issue: true,
        rating: 4,
        issue_category: 'DRIVER_CONDUCT',
        comment: 'Tài xế có thái độ chưa phù hợp.',
      },
    });
  });

  it('rejects unsupported tags and overlong comments', () => {
    expect(VEHICLE_FEEDBACK_POSITIVE_TAGS.map(tag => tag.code)).toEqual([
      'CLEAN_VEHICLE', 'COURTEOUS_DRIVER', 'ON_TIME', 'SAFE_DRIVING',
    ]);
    expect(buildVehicleFeedbackPayload({
      bookingId,
      rating: 5,
      hasIssue: false,
      positiveTags: ['FREE_TEXT'],
      issueCategory: null,
      comment: '',
    }).ok).toBe(false);
    expect(buildVehicleFeedbackPayload({
      bookingId,
      rating: 2,
      hasIssue: true,
      positiveTags: [],
      issueCategory: 'SAFETY',
      comment: 'x'.repeat(4001),
    }).ok).toBe(false);
  });
});
