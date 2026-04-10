import { supabase, isSupabaseConfigured } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// ══════════════════════════════════════════════════════════════
//  REALTIME SERVICE — Centralized Supabase Realtime Management
// ══════════════════════════════════════════════════════════════

export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RealtimeEvent {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRecord: any;
  oldRecord: any;
  timestamp: number;
}

type RealtimeCallback = (event: RealtimeEvent) => void;
type StatusCallback = (status: RealtimeStatus) => void;

class RealtimeService {
  private channels: RealtimeChannel[] = [];
  private callbacks: Map<string, RealtimeCallback[]> = new Map();
  private statusCallbacks: StatusCallback[] = [];
  private _status: RealtimeStatus = 'disconnected';
  private _lastEventTime: number = 0;
  private _eventCount: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  get status(): RealtimeStatus {
    return this._status;
  }

  get lastEventTime(): number {
    return this._lastEventTime;
  }

  get eventCount(): number {
    return this._eventCount;
  }

  // Subscribe to status changes
  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.push(callback);
    // Immediate status report
    callback(this._status);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter(cb => cb !== callback);
    };
  }

  // Register a callback for a specific table
  on(table: string, callback: RealtimeCallback): () => void {
    if (!this.callbacks.has(table)) {
      this.callbacks.set(table, []);
    }
    this.callbacks.get(table)!.push(callback);
    return () => {
      const cbs = this.callbacks.get(table);
      if (cbs) {
        this.callbacks.set(table, cbs.filter(cb => cb !== callback));
      }
    };
  }

  private setStatus(status: RealtimeStatus) {
    this._status = status;
    this.statusCallbacks.forEach(cb => cb(status));
  }

  private notifyListeners(table: string, event: RealtimeEvent) {
    this._lastEventTime = Date.now();
    this._eventCount++;
    const cbs = this.callbacks.get(table) || [];
    cbs.forEach(cb => cb(event));
    // Also notify wildcard listeners
    const wildcardCbs = this.callbacks.get('*') || [];
    wildcardCbs.forEach(cb => cb(event));
  }

  // Start all realtime subscriptions
  connect(tables: string[]) {
    if (!isSupabaseConfigured) {
      this.setStatus('disconnected');
      return;
    }

    this.disconnect(); // Clean up any existing channels
    this.setStatus('connecting');

    // Create one combined channel for all critical tables
    const channel = supabase.channel('realtime-all', {
      config: { broadcast: { self: true } }
    });

    // Add listeners for each table
    tables.forEach(table => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          const event: RealtimeEvent = {
            table,
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            newRecord: payload.new,
            oldRecord: payload.old,
            timestamp: Date.now(),
          };
          this.notifyListeners(table, event);
        }
      );
    });

    // Track connection status
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        this.setStatus('connected');
        console.log('[Realtime] ✅ Connected to', tables.length, 'tables');
      } else if (status === 'CLOSED') {
        this.setStatus('disconnected');
        this.scheduleReconnect(tables);
      } else if (status === 'CHANNEL_ERROR') {
        this.setStatus('error');
        console.error('[Realtime] ❌ Channel error');
        this.scheduleReconnect(tables);
      }
    });

    this.channels.push(channel);
  }

  private scheduleReconnect(tables: string[]) {
    if (this.reconnectTimer) return;
    console.log('[Realtime] 🔄 Reconnecting in 5s...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(tables);
    }, 5000);
  }

  // Disconnect all channels
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.channels.forEach(channel => {
      supabase.removeChannel(channel);
    });
    this.channels = [];
    this.setStatus('disconnected');
  }

  // Reset all state
  reset() {
    this.disconnect();
    this.callbacks.clear();
    this.statusCallbacks = [];
    this._eventCount = 0;
    this._lastEventTime = 0;
  }
}

// Singleton instance
export const realtimeService = new RealtimeService();
