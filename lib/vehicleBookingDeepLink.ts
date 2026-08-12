const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const getVehicleBookingDeepLinkId = (params: URLSearchParams): string | null => {
  const bookingId = params.get('booking')?.trim();
  return bookingId && UUID_PATTERN.test(bookingId) ? bookingId : null;
};

export const setVehicleBookingDeepLink = (
  params: URLSearchParams,
  bookingId: string,
): URLSearchParams => {
  const next = new URLSearchParams(params);
  next.set('booking', bookingId);
  return next;
};

export const removeVehicleBookingDeepLink = (params: URLSearchParams): URLSearchParams => {
  const next = new URLSearchParams(params);
  next.delete('booking');
  return next;
};
