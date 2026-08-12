import type { AppNotification } from './notificationService';

export interface VehicleBookingNotificationView {
  bookingCode: string;
  requesterName: string;
  purpose: string;
  driverName: string;
  pickupLocation: string;
  destination: string;
}

type NotificationIdentity = Pick<
  AppNotification,
  'category' | 'sourceType' | 'entityType' | 'metadata'
>;

const getText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function getVehicleBookingNotificationView(
  notification: NotificationIdentity,
): VehicleBookingNotificationView | null {
  const isBooking = notification.category === 'vehicle_booking'
    || notification.sourceType === 'vehicle_booking'
    || notification.entityType === 'vehicle_booking';

  if (!isBooking) return null;

  const metadata = notification.metadata || {};
  const bookingCode = getText(metadata.booking_code ?? metadata.bookingCode);
  const requesterName = getText(metadata.requester_name);
  const purpose = getText(metadata.purpose);
  const driverName = getText(metadata.driver_name);
  const pickupLocation = getText(metadata.pickup_location);
  const destination = getText(metadata.destination);

  if (!bookingCode || !requesterName || !purpose || !driverName || !pickupLocation || !destination) {
    return null;
  }

  return {
    bookingCode,
    requesterName,
    purpose,
    driverName,
    pickupLocation,
    destination,
  };
}
