import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VehicleBookingNotificationContent from '../../components/VehicleBookingNotificationContent';
import { getVehicleBookingNotificationView } from '../vehicleBookingNotificationPresentation';
import type { AppNotification } from '../notificationService';

const notification: AppNotification = {
  id: 'notification-1',
  type: 'info',
  category: 'vehicle_booking',
  title: 'Đã xếp phương án chuyến xe',
  message: 'legacy message',
  isRead: false,
  isDismissed: false,
  severity: 'info',
  metadata: {
    booking_code: 'CAR-260812-0003',
    requester_name: 'Nguyễn Văn Hoàng',
    purpose: 'Đi đàm phán hợp đồng dài cần rút gọn bằng giao diện',
    driver_name: 'Nguyễn Văn Hoàng',
    pickup_location: 'Văn phòng Hưng Yên',
    destination: 'Trụ sở Vioo ERP',
  },
  createdAt: '2026-08-12T09:33:00.000Z',
};

describe('vehicle booking notification presentation', () => {
  it('normalizes structured Booking metadata', () => {
    expect(getVehicleBookingNotificationView(notification)).toEqual({
      bookingCode: 'CAR-260812-0003',
      requesterName: 'Nguyễn Văn Hoàng',
      purpose: 'Đi đàm phán hợp đồng dài cần rút gọn bằng giao diện',
      driverName: 'Nguyễn Văn Hoàng',
      pickupLocation: 'Văn phòng Hưng Yên',
      destination: 'Trụ sở Vioo ERP',
    });
  });

  it('renders five labeled fields and a one-line purpose', () => {
    const html = renderToStaticMarkup(
      <VehicleBookingNotificationContent notification={notification} />,
    );

    expect(html).toContain('CAR-260812-0003');
    expect(html).toContain('Người đặt');
    expect(html).toContain('Nội dung');
    expect(html).toContain('Tài xế');
    expect(html).toContain('Điểm đi');
    expect(html).toContain('Điểm đến');
    expect(html).toContain('truncate');
  });

  it('returns no structured view for non-Booking notifications', () => {
    expect(getVehicleBookingNotificationView({
      ...notification,
      category: 'system',
      metadata: {},
    })).toBeNull();
  });

  it('keeps the plain message for non-Booking notifications', () => {
    const html = renderToStaticMarkup(
      <VehicleBookingNotificationContent notification={{
        ...notification,
        category: 'system',
        message: 'Bảo trì lúc 22:00',
        metadata: {},
      }} />,
    );

    expect(html).toContain('Bảo trì lúc 22:00');
  });

  it('falls back to the legacy message when Booking metadata is incomplete', () => {
    const html = renderToStaticMarkup(
      <VehicleBookingNotificationContent notification={{
        ...notification,
        message: 'Thông tin chuyến xe đang được cập nhật',
        metadata: { booking_code: 'CAR-260812-0003' },
      }} />,
    );

    expect(html).toContain('Thông tin chuyến xe đang được cập nhật');
    expect(html).not.toContain('Chưa có thông tin');
  });
});
