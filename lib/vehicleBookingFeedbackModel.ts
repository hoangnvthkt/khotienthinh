export const VEHICLE_FEEDBACK_POSITIVE_TAGS = [
  { code: 'CLEAN_VEHICLE', label: 'Xe sạch sẽ' },
  { code: 'COURTEOUS_DRIVER', label: 'Tài xế nhiệt tình' },
  { code: 'ON_TIME', label: 'Đúng giờ' },
  { code: 'SAFE_DRIVING', label: 'Lái xe an toàn' },
] as const;

export const VEHICLE_FEEDBACK_ISSUE_CATEGORIES = [
  { code: 'SAFETY', label: 'An toàn / tốc độ' },
  { code: 'DRIVER_CONDUCT', label: 'Thái độ tài xế' },
  { code: 'VEHICLE_CONDITION', label: 'Tình trạng xe' },
  { code: 'SERVICE_DELAY', label: 'Chậm phục vụ' },
  { code: 'COST', label: 'Chi phí' },
  { code: 'OTHER', label: 'Khác' },
] as const;

type PositiveTag = typeof VEHICLE_FEEDBACK_POSITIVE_TAGS[number]['code'];
type IssueCategory = typeof VEHICLE_FEEDBACK_ISSUE_CATEGORIES[number]['code'];

export interface VehicleFeedbackFormValue {
  bookingId: string;
  rating: number;
  hasIssue: boolean;
  positiveTags: string[];
  issueCategory: string | null;
  comment: string;
}

export type VehicleFeedbackPayloadResult =
  | { ok: false; message: string }
  | {
    ok: true;
    value: {
      booking_id: string;
      is_issue: boolean;
      rating: number;
      positive_tags: PositiveTag[];
      issue_category?: IssueCategory;
      comment?: string;
    };
  };

export function buildVehicleFeedbackPayload(
  input: VehicleFeedbackFormValue,
): VehicleFeedbackPayloadResult {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, message: 'Vui lòng chọn mức đánh giá từ 1 đến 5 sao.' };
  }

  const allowedTags = new Set<string>(VEHICLE_FEEDBACK_POSITIVE_TAGS.map(tag => tag.code));
  if (input.positiveTags.some(tag => !allowedTags.has(tag))) {
    return { ok: false, message: 'Nhãn đánh giá không hợp lệ.' };
  }

  const hasIssue = input.hasIssue || input.rating <= 3;
  if (!hasIssue) {
    return {
      ok: true,
      value: {
        booking_id: input.bookingId,
        is_issue: false,
        rating: input.rating,
        positive_tags: [...new Set(input.positiveTags)] as PositiveTag[],
      },
    };
  }

  const comment = input.comment.trim();
  if (!comment) {
    return {
      ok: false,
      message: input.rating <= 3
        ? 'Vui lòng mô tả phản ánh cho đánh giá từ 3 sao trở xuống.'
        : 'Vui lòng mô tả vấn đề cần phản ánh.',
    };
  }
  if (comment.length > 4000) {
    return { ok: false, message: 'Nội dung phản ánh không được vượt quá 4.000 ký tự.' };
  }

  const categories = new Set<string>(VEHICLE_FEEDBACK_ISSUE_CATEGORIES.map(category => category.code));
  if (!input.issueCategory || !categories.has(input.issueCategory)) {
    return { ok: false, message: 'Vui lòng chọn nhóm vấn đề.' };
  }

  return {
    ok: true,
    value: {
      booking_id: input.bookingId,
      is_issue: true,
      rating: input.rating,
      positive_tags: [...new Set(input.positiveTags)] as PositiveTag[],
      issue_category: input.issueCategory as IssueCategory,
      comment,
    },
  };
}
