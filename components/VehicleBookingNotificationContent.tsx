import React from 'react';
import type { AppNotification } from '../lib/notificationService';
import { getVehicleBookingNotificationView } from '../lib/vehicleBookingNotificationPresentation';

type Props = {
  notification: Pick<
    AppNotification,
    'category' | 'sourceType' | 'entityType' | 'metadata' | 'message'
  >;
};

const VehicleBookingNotificationContent: React.FC<Props> = ({ notification }) => {
  const view = getVehicleBookingNotificationView(notification);

  if (!view) {
    return <p className="text-sm text-gray-600 dark:text-gray-300">{notification.message}</p>;
  }

  return (
    <div className="min-w-0 space-y-1 text-sm text-gray-600 dark:text-gray-300">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500">{view.bookingCode}</p>
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
        <span className="font-medium text-gray-500 dark:text-gray-400">Người đặt:</span>
        <span>{view.requesterName}</span>
        <span className="font-medium text-gray-500 dark:text-gray-400">Nội dung:</span>
        <span className="min-w-0 truncate" title={view.purpose}>{view.purpose}</span>
        <span className="font-medium text-gray-500 dark:text-gray-400">Tài xế:</span>
        <span>{view.driverName}</span>
        <span className="font-medium text-gray-500 dark:text-gray-400">Điểm đi:</span>
        <span className="min-w-0 break-words">{view.pickupLocation}</span>
        <span className="font-medium text-gray-500 dark:text-gray-400">Điểm đến:</span>
        <span className="min-w-0 break-words">{view.destination}</span>
      </div>
    </div>
  );
};

export default VehicleBookingNotificationContent;
