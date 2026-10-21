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
type ResumeCallback = () => void;

// Tab ẩn quá lâu thì ngắt kênh realtime (audit 20/10/2026, mục H2): mỗi tab mở là một kết nối + một bộ
// subscription mà Realtime phải đối chiếu RLS cho MỌI thay đổi; ở 200 người, phần lớn tab đang ẩn.
// Khi tab hiện lại: nối lại và báo onResume để AppContext tải lại dữ liệu đã có (bù sự kiện bỏ lỡ).
export const REALTIME_IDLE_SUSPEND_MS = 5 * 60 * 1000;

class RealtimeService {
  private channels: RealtimeChannel[] = [];
  private callbacks: Map<string, RealtimeCallback[]> = new Map();
  private statusCallbacks: StatusCallback[] = [];
  private resumeCallbacks: ResumeCallback[] = [];
  private _status: RealtimeStatus = 'disconnected';
  private _lastEventTime: number = 0;
  private _eventCount: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private suspendedTables: string[] | null = null;
  private visibilityBound = false;
  private shouldReconnect = false;
  private activeTablesKey = '';
  private connectionId = 0;

  get status(): RealtimeStatus {
    return this._status;
  }

  get lastEventTime(): number {
    return this._lastEventTime;
  }

  get eventCount(): number {
    return this._eventCount;
  }

  /** Đang tạm ngắt vì tab ẩn; nối lại khi tab hiện. */
  get isSuspended(): boolean {
    return this.suspendedTables !== null;
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

  /** Gọi sau khi nối lại từ trạng thái tạm ngắt vì tab ẩn (dữ liệu đã tải có thể cũ). */
  onResume(callback: ResumeCallback): () => void {
    this.resumeCallbacks.push(callback);
    return () => {
      this.resumeCallbacks = this.resumeCallbacks.filter(cb => cb !== callback);
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

  private bindVisibility() {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleVisibilityChange = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      this.scheduleIdleSuspend();
      return;
    }
    this.clearIdleTimer();
    this.resumeIfSuspended();
  };

  private scheduleIdleSuspend() {
    if (this.idleTimer || this.suspendedTables !== null) return;
    if (!this.activeTablesKey) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.suspendForIdle();
    }, REALTIME_IDLE_SUSPEND_MS);
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Tab ẩn quá lâu: đóng kênh nhưng nhớ bảng đang nghe để nối lại. */
  suspendForIdle() {
    if (!this.activeTablesKey || this.suspendedTables !== null) return;
    const tables = this.activeTablesKey.split('|').filter(Boolean);
    this.disconnect();
    this.suspendedTables = tables;
    console.log('[Realtime] ⏸ Tab ẩn, tạm ngắt', tables.length, 'bảng');
  }

  /** Tab hiện lại: nối lại và báo onResume. */
  resumeIfSuspended() {
    const tables = this.suspendedTables;
    if (tables === null) return;
    this.suspendedTables = null;
    this.connect(tables);
    this.resumeCallbacks.forEach(cb => cb());
  }

  // Start all realtime subscriptions
  connect(tables: string[]) {
    if (!isSupabaseConfigured) {
      this.setStatus('disconnected');
      return;
    }

    this.bindVisibility();
    this.suspendedTables = null;

    const nextTablesKey = [...tables].sort().join('|');
    if (this.activeTablesKey === nextTablesKey && (this._status === 'connected' || this._status === 'connecting')) {
      return;
    }

    this.disconnect(); // Clean up any existing channels
    this.shouldReconnect = true;
    this.activeTablesKey = nextTablesKey;
    const connectionId = ++this.connectionId;
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
      if (connectionId !== this.connectionId) return;
      if (status === 'SUBSCRIBED') {
        this.setStatus('connected');
        console.log('[Realtime] ✅ Connected to', tables.length, 'tables');
      } else if (status === 'CLOSED') {
        this.setStatus('disconnected');
        if (this.shouldReconnect) this.scheduleReconnect(tables);
      } else if (status === 'CHANNEL_ERROR') {
        this.setStatus('error');
        console.error('[Realtime] ❌ Channel error');
        if (this.shouldReconnect) this.scheduleReconnect(tables);
      }
    });

    this.channels.push(channel);

    // Đã ẩn sẵn khi nối (mở tab nền): đếm giờ tạm ngắt ngay.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.scheduleIdleSuspend();
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
    this.connectionId++;
    this.shouldReconnect = false;
    this.activeTablesKey = '';
    this.clearIdleTimer();
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
    this.suspendedTables = null;
    this.callbacks.clear();
    this.statusCallbacks = [];
    this.resumeCallbacks = [];
    this._eventCount = 0;
    this._lastEventTime = 0;
  }
}

// Singleton instance
export const realtimeService = new RealtimeService();
