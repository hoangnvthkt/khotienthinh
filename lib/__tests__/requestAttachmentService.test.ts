import { describe, expect, it } from 'vitest';
import { validateRequestAttachment } from '../requestAttachmentService';

const file = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });

describe('request attachment draft validation', () => {
  it('classifies supported images and documents', () => {
    expect(validateRequestAttachment(file('photo.webp', 'image/webp', 1024))).toBe('discussion_image');
    expect(validateRequestAttachment(file('bang-ke.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1024))).toBe('discussion_file');
  });

  it('applies the smaller image limit and rejects active browser formats', () => {
    expect(() => validateRequestAttachment(file('huge.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1))).toThrow(/5 MiB/);
    expect(() => validateRequestAttachment(file('vector.svg', 'image/svg+xml', 1024))).toThrow();
    expect(() => validateRequestAttachment(file('page.html', 'text/html', 1024))).toThrow();
  });
});
