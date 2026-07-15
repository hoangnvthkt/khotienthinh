type CommandStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface InventoryAuditCommandIdentity {
  commandId: string;
  auditedAt: string;
}

const COMMAND_KEY_PREFIX = 'erp:inventory-audit:post-command:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const memoryCommands = new Map<string, InventoryAuditCommandIdentity>();

const normalizeIdentity = (value: string): string => String(value || '').trim().toLowerCase();

const commandKey = (warehouseId: string, actorId: string): string =>
  COMMAND_KEY_PREFIX
  + encodeURIComponent(normalizeIdentity(actorId))
  + ':'
  + encodeURIComponent(normalizeIdentity(warehouseId));

const browserSessionStorage = (): CommandStorage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const validIdentity = (value: unknown): value is InventoryAuditCommandIdentity => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as InventoryAuditCommandIdentity;
  return UUID_PATTERN.test(candidate.commandId)
    && Number.isFinite(Date.parse(candidate.auditedAt));
};

const parseStoredIdentity = (value: string | null | undefined): InventoryAuditCommandIdentity | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return validIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const getOrCreateInventoryAuditCommand = (
  warehouseId: string,
  actorId: string,
  storage: CommandStorage | null = browserSessionStorage(),
  now: () => string = () => new Date().toISOString(),
): InventoryAuditCommandIdentity => {
  const key = commandKey(warehouseId, actorId);
  let existing = memoryCommands.get(key) ?? null;
  try {
    existing = parseStoredIdentity(storage?.getItem(key)) ?? existing;
  } catch {
    // Continue with the in-memory fallback.
  }
  if (existing && validIdentity(existing)) return existing;

  const identity = {
    commandId: crypto.randomUUID(),
    auditedAt: now(),
  };
  if (!validIdentity(identity)) {
    throw new Error('Không thể tạo thời điểm kiểm kê hợp lệ.');
  }
  memoryCommands.set(key, identity);
  try {
    storage?.setItem(key, JSON.stringify(identity));
  } catch {
    // Some browsers expose sessionStorage while denying individual operations.
  }
  return identity;
};

export const getOrCreateInventoryAuditCommandId = (
  warehouseId: string,
  actorId: string,
  storage: CommandStorage | null = browserSessionStorage(),
): string => getOrCreateInventoryAuditCommand(warehouseId, actorId, storage).commandId;

export const clearInventoryAuditCommandId = (
  warehouseId: string,
  actorId: string,
  confirmedCommandId: string,
  storage: CommandStorage | null = browserSessionStorage(),
): void => {
  const key = commandKey(warehouseId, actorId);
  if (memoryCommands.get(key)?.commandId === confirmedCommandId) memoryCommands.delete(key);
  try {
    if (parseStoredIdentity(storage?.getItem(key))?.commandId === confirmedCommandId) {
      storage?.removeItem(key);
    }
  } catch {
    // The in-memory fallback was already cleared above.
  }
};
