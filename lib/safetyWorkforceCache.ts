export type SafetyWorkforceResource =
  | 'dashboard'
  | 'roster'
  | 'active'
  | 'detail'
  | 'options'
  | 'card_lookup';

export interface SafetyWorkforceCacheScope {
  userId: string;
  projectId: string;
  constructionSiteId: string;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const entries = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
let currentActorId: string | null = null;
let cacheGeneration = 0;

export const SAFETY_WORKFORCE_TTL = {
  dashboard: 20_000,
  roster: 45_000,
  active: 30_000,
  detail: 30_000,
  options: 5 * 60_000,
  card_lookup: 30_000,
} as const;

const encode = (value: string): string => encodeURIComponent(value);

const scopePrefix = (scope: SafetyWorkforceCacheScope): string => [
  'safety-workforce-v1',
  encode(scope.userId),
  encode(scope.projectId),
  encode(scope.constructionSiteId),
].join('|');

const stableVariant = (
  variant?: Record<string, string | number | boolean | null | undefined>,
): string => {
  if (!variant) return '{}';
  const sorted = Object.keys(variant)
    .sort()
    .reduce<Record<string, string | number | boolean | null>>((result, key) => {
      const value = variant[key];
      if (value !== undefined) result[key] = value;
      return result;
    }, {});
  return JSON.stringify(sorted);
};

export function buildSafetyWorkforceCacheKey(
  scope: SafetyWorkforceCacheScope,
  resource: SafetyWorkforceResource,
  variant?: Record<string, string | number | boolean | null | undefined>,
): string {
  return `${scopePrefix(scope)}|${resource}|${stableVariant(variant)}`;
}

const deepFreezePlain = <T,>(value: T): T => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;

  if (Array.isArray(value)) {
    value.forEach(deepFreezePlain);
    return Object.freeze(value);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  Object.values(value as Record<string, unknown>).forEach(deepFreezePlain);
  return Object.freeze(value);
};

export function getSafetyWorkforceCached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
  if (cached) entries.delete(key);

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const generationAtStart = cacheGeneration;
  let request: Promise<T>;
  request = Promise.resolve()
    .then(loader)
    .then(value => {
      const immutable = deepFreezePlain(value);
      if (generationAtStart === cacheGeneration) {
        entries.set(key, {
          expiresAt: Date.now() + Math.max(0, ttlMs),
          value: immutable,
        });
      }
      return immutable;
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}

export function invalidateSafetyWorkforceScope(
  scope: SafetyWorkforceCacheScope,
  resources?: SafetyWorkforceResource[],
): void {
  const prefix = `${scopePrefix(scope)}|`;
  const resourcePrefixes = resources?.map(resource => `${prefix}${resource}|`);
  const matches = (key: string) => resourcePrefixes?.length
    ? resourcePrefixes.some(resourcePrefix => key.startsWith(resourcePrefix))
    : key.startsWith(prefix);

  cacheGeneration += 1;
  for (const key of entries.keys()) {
    if (matches(key)) entries.delete(key);
  }
  for (const key of inflight.keys()) {
    if (matches(key)) inflight.delete(key);
  }
}

export function clearSafetyWorkforceCache(): void {
  cacheGeneration += 1;
  entries.clear();
  inflight.clear();
}

export function setSafetyWorkforceCacheActor(userId: string | null): void {
  if (currentActorId === userId) return;
  currentActorId = userId;
  clearSafetyWorkforceCache();
}
