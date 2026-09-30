import { describe, expect, it } from 'vitest';
import { createEmptyRequestTemplateDraft, notificationEventsFromConfig, toSaveDraftInput } from '../requestTemplateEditorModel';

describe('request template auxiliary settings', () => {
  it('serializes watchers, print configuration and notification events without a File object', () => {
    const draft = {
      ...createEmptyRequestTemplateDraft(),
      fixedWatcherIds: ['watcher-1'],
      print: { browserPrintEnabled: true, docxStoragePath: 'request-template-versions/version-id/template.docx' },
      notificationEvents: ['ASSIGNED', 'APPROVED'] as ('ASSIGNED' | 'APPROVED')[],
    };

    const payload = toSaveDraftInput(draft);
    expect(payload.watcherUserIds).toEqual(['watcher-1']);
    expect(payload.printConfig).toEqual({ browserPrintEnabled: true, docxStoragePath: 'request-template-versions/version-id/template.docx' });
    expect(payload.notificationConfig).toEqual({
      SUBMITTED: false, ASSIGNED: true, REASSIGNED: false, REMINDER: false,
      RETURNED: false, APPROVED: true, REJECTED: false,
    });
    expect(payload).not.toHaveProperty('file');
  });

  it('treats events missing from older configs as enabled and explicit false as disabled', () => {
    expect(notificationEventsFromConfig({ SUBMITTED: true, APPROVED: true })).toEqual([
      'SUBMITTED', 'ASSIGNED', 'REASSIGNED', 'REMINDER', 'RETURNED', 'APPROVED', 'REJECTED',
    ]);
    expect(notificationEventsFromConfig({ REMINDER: false, REJECTED: false })).not.toContain('REMINDER');
    expect(createEmptyRequestTemplateDraft().notificationEvents).toContain('REMINDER');
  });
});
