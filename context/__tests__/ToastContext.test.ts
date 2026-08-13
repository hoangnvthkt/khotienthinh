import { describe, expect, it } from 'vitest';

import { appendToastUnlessDuplicate, type Toast } from '../ToastContext';

describe('ToastContext duplicate protection', () => {
  it('does not append the same visible toast more than once', () => {
    const current: Toast[] = [{
      id: 'toast-1',
      type: 'error',
      title: 'Không tải được kế hoạch thanh toán',
      message: 'Bạn không có quyền thực hiện thao tác này trong Room Tiến độ.',
    }];

    const next = appendToastUnlessDuplicate(current, {
      id: 'toast-2',
      type: 'error',
      title: 'Không tải được kế hoạch thanh toán',
      message: 'Bạn không có quyền thực hiện thao tác này trong Room Tiến độ.',
    });

    expect(next).toBe(current);
    expect(next).toHaveLength(1);
  });
});
