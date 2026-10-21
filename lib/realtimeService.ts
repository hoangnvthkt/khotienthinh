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

// Realtime đợt 2 (audit 20/10/2026, H2): 3 bảng ghi nhiều của Kho nhận qua Broadcast theo kênh phạm vi
// (migration 20261025220000_realtime_wms_broadcast.sql). Realtime kiểm quyền một lần lúc vào kênh thay vì
// chạy RLS cho từng người đang nghe ở mỗi thay đổi. Danh sách kênh do RPC wms_realtime_topics_v1 trả theo quyền.
export const WMS_BROADCAST_TABLES = new Set(['transactions', 'activities', 'items']);
const WMS_BROADCAST_TOPIC_PREFIX: Record<string, string> = {
  transactions: 'wms:tx:',
  activities: 'wms:act:',
  items: 'wms:items',
};

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
  private fallbackConnectionId = -1;

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

    // Bảng ghi nhiều của Kho đi Broadcast theo kênh phạm vi (đợt 2); phần còn lại vẫn postgres_changes.
    const broadcastTables = tables.filter(table => WMS_BROADCAST_TABLES.has(table));
    const changeTables = tables.filter(table => !WMS_BROADCAST_TABLES.has(table));

    // Create one combined channel for all critical tables
    const channel = supabase.channel('realtime-all', {
      config: { broadcast: { self: true } }
    });

    // Add listeners for each table
    changeTables.forEach(table => this.listenPostgresChanges(channel, table));
    if (broadcastTables.length > 0) void this.connectBroadcast(broadcastTables, connectionId);

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

  private listenPostgresChanges(channel: RealtimeChannel, table: string) {
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
  }

  /** Lỗi RPC / kênh Broadcast: nghe lại các bảng này bằng postgres_changes (một lần mỗi lượt kết nối). */
  private fallbackToPostgresChanges(tables: string[], connectionId: number, reason: string) {
    if (connectionId !== this.connectionId || this.fallbackConnectionId === connectionId) return;
    this.fallbackConnectionId = connectionId;
    console.warn('[Realtime] Broadcast không dùng được, quay về postgres_changes:', reason);
    const channel = supabase.channel('realtime-wms-fallback');
    tables.forEach(table => this.listenPostgresChanges(channel, table));
    channel.subscribe();
    this.channels.push(channel);
  }

  private async connectBroadcast(tables: string[], connectionId: number) {
    const { data, error } = await supabase.rpc('wms_realtime_topics_v1');
    if (connectionId !== this.connectionId) return;
    if (error || !Array.isArray(data)) {
      this.fallbackToPostgresChanges(tables, connectionId, error?.message || 'no topics');
      return;
    }
    const topics = (data as string[]).filter(topic => tables.some(table => topic.startsWith(WMS_BROADCAST_TOPIC_PREFIX[table])));
    if (topics.length === 0) return; // không có quyền xem bảng nào trong số này → không nghe gì (đúng như RLS)

    try {
      await supabase.realtime.setAuth();
    } catch {
      // setAuth lỗi thì kênh private sẽ báo CHANNEL_ERROR → quay về postgres_changes bên dưới.
    }
    if (connectionId !== this.connectionId) return;

    topics.forEach(topic => {
      const channel = supabase.channel(topic, { config: { private: true } });
      channel.on('broadcast', { event: '*' }, ({ payload }) => {
        const table = typeof payload?.table === 'string' ? payload.table : '';
        if (!WMS_BROADCAST_TABLES.has(table)) return;
        const eventType = payload.eventType as RealtimeEvent['eventType'];
        if (eventType !== 'INSERT' && eventType !== 'UPDATE' && eventType !== 'DELETE') return;
        this.notifyListeners(table, {
          table,
          eventType,
          newRecord: payload.new ?? {},
          oldRecord: payload.old ?? {},
          timestamp: Date.now(),
        });
      });
      channel.subscribe(status => {
        if (connectionId !== this.connectionId) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.fallbackToPostgresChanges(tables, connectionId, `${topic} ${status}`);
        }
      });
      this.channels.push(channel);
    });
    console.log('[Realtime] 📡 Broadcast', topics.length, 'kênh Kho');
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
