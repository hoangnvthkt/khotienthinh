import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogRevisionActions } from '../../components/project/daily-log/DailyLogRevisionActions';

const render = (patch = {}) => renderToStaticMarkup(<StaticRouter location="/"><DailyLogRevisionActions
  revisionNo={1} status="verified" canCreate={true} periodLocked={false}
  reopenUrl="/da?projectId=p1&tab=weekly_progress" busy={false}
  onCreate={() => undefined} onOpenRevision={() => undefined} {...patch}
/></StaticRouter>);

describe('Daily Log revision actions', () => {
  it('offers the revision action and explains that official evidence remains active', () => {
    const html = render();
    expect(html).toContain('Tạo bản điều chỉnh');
    expect(html).toContain('vẫn có hiệu lực');
  });
  it('replaces editing with the reopen route for a locked period', () => {
    const html = render({ periodLocked: true });
    expect(html).not.toContain('Tạo bản điều chỉnh');
    expect(html).toContain('href="/da?projectId=p1&amp;tab=weekly_progress"');
    expect(html).toContain('Mở Chốt tiến độ');
  });
  it('links to an existing revision without creating another revision', () => {
    const html = render({ supersededByDailyLogId: 'revision-2' });
    expect(html).toContain('Mở bản điều chỉnh mới');
    expect(html).not.toContain('Tạo bản điều chỉnh');
  });
  it('does not offer revision creation without permission or on a draft', () => {
    expect(render({ canCreate: false })).not.toContain('Tạo bản điều chỉnh');
    expect(render({ status: 'draft' })).not.toContain('Tạo bản điều chỉnh');
  });
  it('shows the audit reason and disables repeat actions while creating', () => {
    const html = render({ revisionNo: 2, revisionReason: 'Sửa khối lượng theo biên bản', busy: true });
    expect(html).toContain('Phiên bản 2');
    expect(html).toContain('Sửa khối lượng theo biên bản');
    expect(html).toContain('disabled=""');
  });
});
