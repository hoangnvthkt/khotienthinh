import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PrivateEvidencePreviewModal from '../PrivateEvidencePreviewModal';

describe('PrivateEvidencePreviewModal', () => {
  it('renders readable labels and signed private image URLs without exposing storage paths', () => {
    const html = renderToStaticMarkup(
      <PrivateEvidencePreviewModal
        title="Bằng lái Nguyễn Văn Hoàng"
        items={[
          { label: 'Mặt trước', url: 'https://storage.example/signed/front.jpg?token=front' },
          { label: 'Mặt sau', url: 'https://storage.example/signed/back.jpg?token=back' },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Bằng lái Nguyễn Văn Hoàng');
    expect(html).toContain('Mặt trước');
    expect(html).toContain('Mặt sau');
    expect(html).toContain('https://storage.example/signed/front.jpg?token=front');
    expect(html).not.toContain('licenses/user-id/front.jpg');
  });

  it('shows an actionable empty state when a signed URL cannot be created', () => {
    const html = renderToStaticMarkup(
      <PrivateEvidencePreviewModal
        title="Ảnh đăng kiểm"
        items={[]}
        error="Không thể tải ảnh. Vui lòng thử lại."
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Không thể tải ảnh. Vui lòng thử lại.');
  });

  it('shows progress while private image URLs are being signed', () => {
    const html = renderToStaticMarkup(
      <PrivateEvidencePreviewModal
        title="Ảnh đăng kiểm"
        items={[]}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Đang tải ảnh bảo mật');
  });
});
