export const toSnake = (s: string) => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
export const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

export const mapKeys = (obj: any, fn: (k: string) => string): any => {
  if (Array.isArray(obj)) return obj.map(v => mapKeys(v, fn));
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), mapKeys(v, fn)]));
  }
  return obj;
};

export const toDb = (obj: any) => mapKeys(obj, toSnake);
export const fromDb = (obj: any) => mapKeys(obj, toCamel);
