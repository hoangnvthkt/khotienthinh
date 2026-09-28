import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DailyLogDocumentHeader, type DailyLogDocumentHeaderProps } from '../../components/project/daily-log/DailyLogDocumentHeader';

const props: DailyLogDocumentHeaderProps = {
  title: 'Phiếu thi công ngày', date: '2026-09-25', authorName: 'Nguyễn Văn An', areaName: 'Khu móng trục A-D',
  statusLabel: 'Nháp', mode: 'author', onClose: () => {},
  primaryAction: { label: 'Gửi tổng hợp', disabled: false, onClick: () => {} },
  secondaryAction: { label: 'Lưu nháp', disabled: false, onClick: () => {} },
};

describe('DailyLogDocumentHeader', () => {
  it('header_has_one_primary_action_and_status', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props} />);
    expect(html).toContain('Phiếu thi công ngày');
    expect(html).toContain('25/09/2026');
    expect(html).toContain('Nguyễn Văn An');
    expect(html).toContain('Khu móng trục A-D');
    expect(html).toContain('Nháp');
    expect((html.match(/>Gửi tổng hợp</g) || [])).toHaveLength(1);
    expect((html.match(/>Lưu nháp</g) || [])).toHaveLength(1);
    expect(html).not.toContain('2026-09-25');
  });

  it('shows a disabled action reason visibly, not only in a tooltip', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props} primaryAction={{
      ...props.primaryAction!, disabled: true, disabledReason: 'Chọn bên cung cấp cho nhân công trước khi gửi.',
    }} />);
    expect(html).toContain('Chọn bên cung cấp cho nhân công trước khi gửi.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Gửi tổng hợp/);
    expect(html).toContain('aria-describedby=');
  });

  it('blocks repeat actions while one save or send is busy', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props} busyAction="primary" />);
    expect((html.match(/<button[^>]*disabled=""/g) || [])).toHaveLength(3);
    expect(html).toContain('aria-busy="true"');
  });

  it('does not synthesize an unavailable primary action for a reader', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props} mode="review" primaryAction={undefined} secondaryAction={undefined} />);
    expect(html).not.toContain('Gửi tổng hợp');
    expect(html).not.toContain('Lưu nháp');
    expect(html).toContain('Đóng');
  });

  it('verified mode cannot expose mutation actions even if a caller passes them', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props} mode="verified" statusLabel="Đã xác nhận" />);
    expect(html).toContain('Đã xác nhận');
    expect(html).not.toContain('Gửi tổng hợp');
    expect(html).not.toContain('Lưu nháp');
    expect(html).toContain('Đóng');
  });

  it('keeps missing author and area explicit instead of inventing ownership', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props} authorName="" areaName="" />);
    expect(html).toContain('Chưa xác định người lập');
    expect(html).toContain('Chưa xác định khu vực');
  });

  it('renders long names and reasons as ordinary readable content', () => {
    const html = renderToStaticMarkup(<DailyLogDocumentHeader {...props}
      authorName="Kỹ sư Nguyễn Văn An — phụ trách hạng mục bê tông móng phía đông"
      primaryAction={{ ...props.primaryAction!, disabled: true, disabledReason: 'Phiếu khu vực A thiếu thời gian sử dụng máy trộn; bổ sung trước khi gửi tổng hợp.' }} />);
    expect(html).toContain('hạng mục bê tông móng phía đông');
    expect(html).toContain('bổ sung trước khi gửi tổng hợp.');
  });
});
