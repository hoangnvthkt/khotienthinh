import type { Session } from '@supabase/supabase-js';
import type { AuthStatus } from '../context/authState';
import type { User } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

export type TelemetryStopReason = 'local_logout' | 'remote_auth_loss' | 'unmount';

export interface ActiveUserSessionTelemetry {
  userId: string;
  stop(reason: TelemetryStopReason): void;
  end(): Promise<void>;
  abandonEnd(): void;
}

export interface PendingTelemetryEnd {
  completion: Promise<void>;
  abandon(): void;
}

interface OwnedPendingTelemetryEnd {
  userId: string;
  handle: PendingTelemetryEnd;
}

export class UserSessionTelemetryLifecycle {
  private active: ActiveUserSessionTelemetry | null = null;
  private pendingLocalEnd: OwnedPendingTelemetryEnd | null = null;

  register(telemetry: ActiveUserSessionTelemetry): () => void {
    this.pendingLocalEnd?.handle.abandon();
    this.active?.stop('unmount');
    this.active = telemetry;
    return () => {
      if (this.active === telemetry) this.active = null;
    };
  }

  stop(reason: TelemetryStopReason): void {
    const telemetry = this.active;
    this.active = null;
    telemetry?.stop(reason);
  }

  stopAndEnd(userId: string): PendingTelemetryEnd {
    if (this.pendingLocalEnd?.userId === userId) {
      return this.pendingLocalEnd.handle;
    }
    this.pendingLocalEnd?.handle.abandon();
    const telemetry = this.active;
    this.active = null;
    telemetry?.stop('local_logout');
    if (telemetry?.userId !== userId) {
      return { completion: Promise.resolve(), abandon: () => undefined };
    }
    let settled = false;
    let abandoned = false;
    const completion = telemetry.end();
    const releasePendingEnd = () => {
      if (this.pendingLocalEnd?.handle === pendingEnd) this.pendingLocalEnd = null;
    };
    const pendingEnd: PendingTelemetryEnd = {
      completion,
      abandon: () => {
        if (settled || abandoned) return;
        abandoned = true;
        releasePendingEnd();
        telemetry.abandonEnd();
      },
    };
    this.pendingLocalEnd = { userId, handle: pendingEnd };
    const clearPendingEnd = () => {
      settled = true;
      releasePendingEnd();
    };
    void pendingEnd.completion.then(clearPendingEnd, clearPendingEnd);
    return pendingEnd;
  }

  handleRemoteAuthLoss(clearAppOwnedStorage: () => void): void {
    const pendingEnd = this.pendingLocalEnd;
    this.pendingLocalEnd = null;
    pendingEnd?.handle.abandon();
    this.stop('remote_auth_loss');
    clearAppOwnedStorage();
  }
}

export const userSessionTelemetryLifecycle = new UserSessionTelemetryLifecycle();

export const shouldEndTelemetrySessionOnServer = (
  status: AuthStatus,
  user: User | null,
  session: Session | null,
  nowMs = Date.now(),
): boolean => (
  status === 'authenticated'
  && isUuid(user?.id)
  && isUuid(user?.authId)
  && isUuid(session?.user?.id)
  && user.authId === session.user.id
  && typeof session.access_token === 'string'
  && session.access_token.length > 0
  && typeof session.expires_at === 'number'
  && session.expires_at * 1000 > nowMs
);

export interface LocalTelemetryLogoutOptions {
  lifecycle: UserSessionTelemetryLifecycle;
  userId: string | null | undefined;
  shouldEndServerSession: boolean;
  telemetryEndTimeoutMs?: number;
  signOut(): Promise<void>;
  clearAppOwnedStorage(): void;
}

export const performLocalTelemetryLogout = async ({
  lifecycle,
  userId,
  shouldEndServerSession,
  telemetryEndTimeoutMs = 2_000,
  signOut,
  clearAppOwnedStorage,
}: LocalTelemetryLogoutOptions): Promise<void> => {
  const pendingEnd = shouldEndServerSession && isUuid(userId)
    ? lifecycle.stopAndEnd(userId)
    : (
      lifecycle.stop('local_logout'),
      { completion: Promise.resolve(), abandon: () => undefined }
    );

  const telemetrySettledBeforeTimeout = await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId) globalThis.clearTimeout(timeoutId);
      resolve(completed);
    };
    timeoutId = globalThis.setTimeout(
      () => finish(false),
      Math.max(0, telemetryEndTimeoutMs),
    );
    void pendingEnd.completion.then(
      () => finish(true),
      () => finish(true),
    );
  });
  if (!telemetrySettledBeforeTimeout) pendingEnd.abandon();

  try {
    // Session telemetry is best effort and bounded; auth signout must proceed
    // even if an ensure/end request is stuck behind a dead network connection.
    await signOut();
  } finally {
    clearAppOwnedStorage();
  }
};
