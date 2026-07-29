import { describe, expect, it } from 'vitest';
import { createEmptyRequestTemplateDraft, toSaveDraftInput } from '../requestTemplateEditorModel';

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
    expect(payload.notificationConfig).toEqual({ ASSIGNED: true, APPROVED: true });
    expect(payload).not.toHaveProperty('file');
  });
});
