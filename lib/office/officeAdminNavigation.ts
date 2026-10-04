export const officePermissionSettingsPath = (userId?: string): string => {
  const params = new URLSearchParams({ tab: 'users', permissionApp: 'office' });
  if (userId) params.set('userId', userId);
  return `/settings?${params}`;
};

export const readOfficePermissionFocus = (search: string): { userId: string | null } | null => {
  const params = new URLSearchParams(search);
  if (params.get('tab') !== 'users' || params.get('permissionApp') !== 'office') return null;
  return { userId: params.get('userId') || null };
};
