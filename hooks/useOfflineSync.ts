import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineStore, OfflineMutation } from '../lib/offlineStore';
import { supabase } from '../lib/supabase';

// ══════════════════════════════════════════
//  useOfflineSync — Online/Offline detection + auto-sync
// ══════════════════════════════════════════

interface UseOfflineSyncReturn {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
  syncNow: () => Promise<void>;
  queueMutation: (table: string, operation: 'insert' | 'update' | 'delete', data: any) => Promise<void>;
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(
    localStorage.getItem('vioo_last_sync') || null
  );
  const syncingRef = useRef(false);

  // ═════════ Online/Offline Detection ═════════
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ═════════ Update pending count ═════════
  const updatePendingCount = useCallback(async () => {
    if (offlineStore.isAvailable()) {
      const count = await offlineStore.getQueueCount();
      setPendingCount(count);
    }
  }, []);

  useEffect(() => {
    updatePendingCount();
    const interval = setInterval(updatePendingCount, 5000);
    return () => clearInterval(interval);
  }, [updatePendingCount]);

  // ═════════ Queue a mutation ═════════
  const queueMutation = useCallback(async (
    table: string,
    operation: 'insert' | 'update' | 'delete',
    data: any
  ) => {
    if (!offlineStore.isAvailable()) return;
    await offlineStore.queueMutation({ table, operation, data });
    await updatePendingCount();
  }, [updatePendingCount]);

  // ═════════ Sync Logic ═════════
  const syncNow = useCallback(async () => {
    if (syncingRef.current || !isOnline || !offlineStore.isAvailable()) return;
    
    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const mutations = await offlineStore.getPendingMutations();
      
      // Sort by creation time (oldest first)
      mutations.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      let successCount = 0;
      const MAX_RETRIES = 3;

      for (const mutation of mutations) {
        if (mutation.retryCount >= MAX_RETRIES) {
          console.warn(`Mutation ${mutation.id} exceeded max retries, removing`);
          await offlineStore.removeMutation(mutation.id);
          continue;
        }

        try {
          await executeMutation(mutation);
          await offlineStore.removeMutation(mutation.id);
          successCount++;
        } catch (err) {
          console.error(`Failed to sync mutation ${mutation.id}:`, err);
          await offlineStore.incrementRetry(mutation.id);
        }
      }

      if (successCount > 0) {
        const now = new Date().toISOString();
        setLastSyncAt(now);
        localStorage.setItem('vioo_last_sync', now);
      }

      await updatePendingCount();
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isOnline, updatePendingCount]);

  // ═════════ Auto-sync when coming back online ═════════
  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      // Delay slightly to let network stabilize
      const timer = setTimeout(() => syncNow(), 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, pendingCount, syncNow]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    lastSyncAt,
    syncNow,
    queueMutation,
  };
}

// ═════════ Execute a single mutation against Supabase ═════════
async function executeMutation(mutation: OfflineMutation): Promise<void> {
  const { table, operation, data } = mutation;

  switch (operation) {
    case 'insert': {
      const { error } = await supabase.from(table).upsert(data, { onConflict: 'id' });
      if (error) throw error;
      break;
    }
    case 'update': {
      const { id, ...rest } = data;
      const { error } = await supabase.from(table).update(rest).eq('id', id);
      if (error) throw error;
      break;
    }
    case 'delete': {
      const { error } = await supabase.from(table).delete().eq('id', data.id);
      if (error) throw error;
      break;
    }
  }
}
