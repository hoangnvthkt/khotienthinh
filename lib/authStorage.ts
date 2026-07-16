export type AppOwnedAuthStorage = Pick<Storage, 'length' | 'key' | 'removeItem'>;

const APP_OWNED_AUTH_KEYS = [
  'vioo_user',
  'vioo_explicit_logout_at',
  'vioo_mock_user',
  'vioo:user-permission-clipboard',
] as const;

const APP_OWNED_AUTH_PREFIXES = ['vioo_user_session_id:'] as const;

const removeSafely = (storage: AppOwnedAuthStorage, key: string): void => {
  try {
    storage.removeItem(key);
  } catch {
    // Storage cleanup is best effort and must not block auth state changes.
  }
};

/**
 * Removes only authentication/authorization state owned by this application.
 * Supabase `sb-*` tokens and device-scoped preferences are intentionally kept.
 */
export const clearAppOwnedAuthStorage = (
  storage: AppOwnedAuthStorage | null | undefined,
): void => {
  if (!storage) return;

  for (const key of APP_OWNED_AUTH_KEYS) removeSafely(storage, key);

  const prefixedKeys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && APP_OWNED_AUTH_PREFIXES.some(prefix => key.startsWith(prefix))) {
        prefixedKeys.push(key);
      }
    }
  } catch {
    return;
  }

  for (const key of prefixedKeys) removeSafely(storage, key);
};
