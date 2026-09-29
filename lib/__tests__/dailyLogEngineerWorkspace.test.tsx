import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogEngineerWorkspace } from '../../components/project/daily-log/DailyLogEngineerWorkspace';
import { engineerBundle } from './dailyLogEngineerSlip.test';

describe('engineer workspace date switch', () => {
  it('does not crash when the previous date left a legacy bundle without the author slips', () => {
    // Legacy (pre-cutover) bundles carry no myContributions; the new date's bundle is still loading.
    const { myContributions: _omit, ...legacy } = engineerBundle;
    const render = () => renderToStaticMarkup(<DailyLogEngineerWorkspace bundle={legacy as any} loading
      projectId="project-1" constructionSiteId={null} date="2026-09-29" onDateChange={() => {}} onClose={() => {}}
      onSubmitted={() => {}} onUploadPhoto={async () => ({ name: '', url: '' })} />);
    expect(render).not.toThrow();
    expect(render()).toContain('Đang tải danh sách phiếu');
  });
});
