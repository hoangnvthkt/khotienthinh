type CommandStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const COMMAND_KEY_PREFIX = 'erp:project-opening-balance:lock-command:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const memoryCommands = new Map<string, string>();

const normalizedScope = (scopeKey: string): string => String(scopeKey || '').trim().toLowerCase();

const commandKey = (scopeKey: string, actorId: string): string =>
  `${COMMAND_KEY_PREFIX}${encodeURIComponent(String(actorId || '').trim().toLowerCase())}:${
    encodeURIComponent(normalizedScope(scopeKey))
  }`;

const browserSessionStorage = (): CommandStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const getOrCreateProjectOpeningBalanceCommandId = (
  scopeKey: string,
  actorId: string,
  storage: CommandStorage | null = browserSessionStorage(),
): string => {
  const key = commandKey(scopeKey, actorId);
  let existing: string | null | undefined = memoryCommands.get(key);
  try {
    existing = storage?.getItem(key) ?? existing;
  } catch {
    // Continue with the in-memory fallback.
  }
  if (existing && UUID_PATTERN.test(existing)) return existing;

  const commandId = crypto.randomUUID();
  memoryCommands.set(key, commandId);
  try {
    storage?.setItem(key, commandId);
  } catch {
    // Some browsers expose sessionStorage while denying individual operations.
  }
  return commandId;
};

export const clearProjectOpeningBalanceCommandId = (
  scopeKey: string,
  actorId: string,
  confirmedCommandId: string,
  storage: CommandStorage | null = browserSessionStorage(),
): void => {
  const key = commandKey(scopeKey, actorId);
  if (memoryCommands.get(key) === confirmedCommandId) memoryCommands.delete(key);
  try {
    if (storage?.getItem(key) === confirmedCommandId) storage.removeItem(key);
  } catch {
    // The in-memory fallback was already cleared above.
  }
};
