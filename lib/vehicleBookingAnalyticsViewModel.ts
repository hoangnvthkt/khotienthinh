export const formatVehicleBookingRate = (value: number | null): string =>
  value === null
    ? '—'
    : `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)}%`;

export const formatVehicleBookingDistance = (value: number): string =>
  `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value)} km`;

export const formatVehicleBookingVnd = (value: number): string =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
