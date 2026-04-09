// ══════════════════════════════════════════
//  OFFLINE STORE — IndexedDB wrapper for offline-first
//  Uses native IndexedDB API (no external deps)
// ══════════════════════════════════════════

const DB_NAME = 'vioo_offline';
const DB_VERSION = 1;
const STORES = {
  QUEUE: 'mutation_queue',    // Pending mutations to sync
  CACHE: 'data_cache',       // Cached read data
} as const;

export interface OfflineMutation {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: any;
  createdAt: string;
  retryCount: number;
}

// ═════════ IndexedDB Helpers ═════════

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.QUEUE)) {
        db.createObjectStore(STORES.QUEUE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.CACHE)) {
        db.createObjectStore(STORES.CACHE, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then(db => {
    const tx = db.transaction(store, mode);
    return tx.objectStore(store);
  });
}

// ═════════ Mutation Queue ═════════

class OfflineStore {
  /** Add a mutation to the offline queue */
  async queueMutation(mutation: Omit<OfflineMutation, 'id' | 'createdAt' | 'retryCount'>): Promise<void> {
    const store = await transaction(STORES.QUEUE, 'readwrite');
    const item: OfflineMutation = {
      ...mutation,
      id: `mut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };
    return new Promise((resolve, reject) => {
      const req = store.add(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Get all pending mutations */
  async getPendingMutations(): Promise<OfflineMutation[]> {
    const store = await transaction(STORES.QUEUE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /** Remove a mutation after successful sync */
  async removeMutation(id: string): Promise<void> {
    const store = await transaction(STORES.QUEUE, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Update retry count */
  async incrementRetry(id: string): Promise<void> {
    const store = await transaction(STORES.QUEUE, 'readwrite');
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (item) {
          item.retryCount++;
          const putReq = store.put(item);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        } else {
          resolve();
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  /** Clear all mutations (after full sync) */
  async clearQueue(): Promise<void> {
    const store = await transaction(STORES.QUEUE, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Get queue count */
  async getQueueCount(): Promise<number> {
    const store = await transaction(STORES.QUEUE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ═════════ Data Cache ═════════

  /** Cache data for offline read */
  async cacheData(key: string, data: any): Promise<void> {
    const store = await transaction(STORES.CACHE, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ key, data, cachedAt: new Date().toISOString() });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Read cached data */
  async getCachedData<T = any>(key: string): Promise<{ data: T; cachedAt: string } | null> {
    const store = await transaction(STORES.CACHE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Clear all cache */
  async clearCache(): Promise<void> {
    const store = await transaction(STORES.CACHE, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Check if IndexedDB is available */
  isAvailable(): boolean {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }
}

export const offlineStore = new OfflineStore();
