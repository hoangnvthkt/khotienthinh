// Phiếu sự cố từ Trợ lý (B2, chủ SP 21/10/2026): Trợ lý chỉ CHUẨN BỊ thẻ (assistant_commands kind issue_report); người dùng sửa rồi bấm
// Gửi Admin → tạo góp ý ở module Góp ý sẵn có (feedback_items + ảnh đính kèm feedback-attachments) bằng phiên người dùng, Admin nhận
// thông báo như góp ý thường, rồi ghi biên nhận vào lệnh. AI không gửi gì. Ảnh = ảnh người dùng đã gửi kèm câu hỏi (còn trong tab).
import type { ImageAttachment } from './assistantFiles';
import { finishCommand, issueView, type AssistantCommand } from './assistantCommands';
import { clientErrorsText, recentClientErrors } from './clientErrorLog';
import { lastScreen } from './assistantScreen';
import { FEEDBACK_MODULES, FEEDBACK_PRIORITIES, FEEDBACK_TYPES, captureFeedbackContext, feedbackService, getCurrentFeedbackActorUserId, type FeedbackModule, type FeedbackPriority, type FeedbackType } from './feedbackService';
import { feedbackNotificationService } from './feedbackNotificationService';
import { supabase } from './supabase';
import { fetchAllSupabaseRows } from './supabaseCompleteRead';
import { getSupabaseOrderColumns } from './supabaseProjections';
import type { User } from '../types';

export interface IssueEdits { title: string; description: string; type: FeedbackType; priority: FeedbackPriority; module: FeedbackModule }
export interface IssueActions {
  /** Người dùng bấm Gửi Admin: tạo góp ý + ảnh + thông báo, trả lệnh đã ghi biên nhận. */
  send: (command: AssistantCommand, edits: IssueEdits, images: ImageAttachment[]) => Promise<AssistantCommand>;
}

export const feedbackRoute = (feedbackId: string) => `/feedback?feedbackId=${feedbackId}`;

const asType = (v: string): FeedbackType => ((FEEDBACK_TYPES as readonly string[]).includes(v) ? v as FeedbackType : 'bug');
const asPriority = (v: string): FeedbackPriority => ((FEEDBACK_PRIORITIES as readonly string[]).includes(v) ? v as FeedbackPriority : 'medium');
const asModule = (v: string): FeedbackModule => ((FEEDBACK_MODULES as readonly string[]).includes(v) ? v as FeedbackModule : 'other');

/** Ảnh base64 trong chat → File để đi đúng đường tải ảnh của Góp ý. */
export const imageToFile = (image: ImageAttachment, index: number): File => {
  const bin = atob(image.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = image.mime === 'image/png' ? 'png' : image.mime === 'image/webp' ? 'webp' : 'jpg';
  return new File([bytes], `su-co-${index + 1}.${ext}`, { type: image.mime });
};

/** Mô tả gửi Admin = lời người dùng + khối ngữ cảnh kỹ thuật (màn hình đang mở, bản app, lỗi gần nhất trên máy). */
export const issueDescription = (v: { description: string; screen: string | null }, ctx: { route: string; version: string; lastScreen?: string | null }, errorsText: string, now: Date) => {
  const lines = [v.description.trim(), '', '—', `Gửi từ Trợ lý AI lúc ${now.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`,
    `Màn hình liên quan: ${v.screen || 'chưa rõ'} · đang mở: ${ctx.route || '/'}${ctx.lastScreen ? ` · màn vừa làm: ${ctx.lastScreen}` : ''} · bản: ${ctx.version}`];
  if (errorsText) lines.push('Lỗi gần nhất trên máy người báo:', errorsText);
  return lines.join('\n');
};

/** Admin đang hoạt động (role ADMIN) — người nhận thông báo như góp ý thường. Lỗi đọc danh sách thì bỏ qua thông báo, phiếu vẫn đã tạo. */
const activeAdmins = async (): Promise<User[]> => {
  const { data, error } = await fetchAllSupabaseRows(supabase.from('users').select('id, name, role, is_active').eq('role', 'ADMIN'),
    { label: 'lib/assistantIssue.ts:activeAdmins', maxRows: 200, orderBy: getSupabaseOrderColumns('users') });
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ id: string; name: string | null; is_active: boolean | null }>).filter(u => u.is_active !== false)
    .map(u => ({ id: String(u.id), name: String(u.name || ''), role: 'ADMIN', isActive: true }) as unknown as User);
};

export const defaultIssueActions: IssueActions = {
  send: async (command, edits, images) => {
    const v = issueView(command);
    const title = edits.title.trim(); const description = edits.description.trim();
    if (title.length < 5) throw new Error('Tiêu đề cần ít nhất 5 ký tự.');
    if (description.length < 10) throw new Error('Mô tả cần ít nhất 10 ký tự.');
    const actorId = await getCurrentFeedbackActorUserId(null);
    const now = new Date();
    const recent = lastScreen();
    const ctx = { ...captureFeedbackContext(), lastScreen: recent ? `${recent.title ? `${recent.title} ` : ''}${recent.path}` : null };
    const errors = recentClientErrors(now);
    let item;
    try {
      item = await feedbackService.createItem({
        title, description: issueDescription({ description, screen: v.screen }, ctx, clientErrorsText(errors), now),
        type: asType(edits.type), module: asModule(edits.module), impactLevel: asPriority(edits.priority), priority: asPriority(edits.priority),
        visibility: 'private', createdBy: actorId, relatedRoute: ctx.route, deviceInfo: ctx.deviceInfo, appVersion: ctx.version,
        metadata: { source: 'assistant', commandId: command.id, screen: v.screen, lastScreen: ctx.lastScreen, modelType: v.modelType, modelPriority: v.modelPriority, jev: v.jev, recentErrors: errors },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Chưa gửi được phiếu.';
      await finishCommand(command.id, 'failed', {}, message).catch(() => null);
      throw e;
    }
    let photos = 0;
    for (const [i, image] of images.slice(0, 4).entries()) {
      try { await feedbackService.uploadAttachment({ feedbackId: item.id, uploadedBy: actorId, file: imageToFile(image, i) }); photos += 1; } catch (e) { console.warn('issue photo upload failed', e); }
    }
    try { await feedbackNotificationService.notifyCreated({ item, users: await activeAdmins(), actorId }); } catch (e) { console.warn('issue notify failed', e); }
    const done = await finishCommand(command.id, 'done', { feedbackId: item.id, title, type: item.type, priority: edits.priority, photos, route: feedbackRoute(item.id) });
    return done || { ...command, status: 'done', result: { feedbackId: item.id, title, photos, route: feedbackRoute(item.id) }, confirmedAt: now.toISOString() };
  },
};
