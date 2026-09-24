export const canSubmitProjectV2Comment = (body: string, formDirty: boolean): boolean =>
  !formDirty && body.trim().length > 0;

const eventLabels: Record<string, string> = {
  saved: 'Đã lưu bản nháp', submitted: 'Đã gửi duyệt', returned: 'Đã trả lại',
  approved: 'Đã phê duyệt', revised: 'Đã tạo bản điều chỉnh',
  revision_created: 'Đã tạo bản điều chỉnh', cancelled: 'Đã hủy',
  commented: 'Đã trao đổi', comment_added: 'Đã trao đổi',
  draft_deleted: 'Đã xóa bản nháp',
};

export const projectV2ActivityLabel = (eventType: string): string =>
  eventLabels[eventType] ?? 'Hoạt động kế hoạch';
