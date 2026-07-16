import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useAuth } from '../context/AuthContext';
import type { AuthStatus } from '../context/authState';
import { isSupabaseConfigured } from '../lib/supabase';
import { userActivityService } from '../lib/userActivityService';
import {
  type TelemetryStopReason,
  userSessionTelemetryLifecycle,
} from '../lib/userSessionTelemetryLifecycle';
import type { User } from '../types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_EVENT_CADENCE = 5;

const isUuid = (value: unknown): value is string => (
  typeof value === 'string' && UUID_PATTERN.test(value)
);

export interface UserSessionTelemetryIdentity {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
}

export interface UserSessionTelemetryService {
  ensureSession(user: User, operationGuard?: () => boolean): Promise<string | null>;
  heartbeat(
    userId: string,
    sessionId?: string | null,
    recordEvent?: boolean,
    operationGuard?: () => boolean,
  ): Promise<void>;
  endSession(
    userId: string,
    eventType?: 'logout' | 'timeout',
    operationGuard?: () => boolean,
  ): Promise<void>;
  clearStoredSessionId(userId: string): void;
}

export interface UserSessionTelemetryEnvironment {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(intervalId: unknown): void;
  addVisibilityListener(handler: () => void): () => void;
  addFocusListener(handler: () => void): () => void;
  isVisible(): boolean;
}

export interface UserSessionTelemetryRuntime {
  start(): Promise<void>;
  stop(reason: TelemetryStopReason): void;
  end(): Promise<void>;
  abandonEnd(): void;
}

const getBrowserEnvironment = (): UserSessionTelemetryEnvironment | null => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return {
    setInterval: (handler, intervalMs) => window.setInterval(handler, intervalMs),
    clearInterval: intervalId => window.clearInterval(intervalId as number),
    addVisibilityListener: (handler) => {
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    addFocusListener: (handler) => {
      window.addEventListener('focus', handler);
      return () => window.removeEventListener('focus', handler);
    },
    isVisible: () => document.visibilityState === 'visible',
  };
};

const isEligibleIdentity = ({ status, session, user }: UserSessionTelemetryIdentity): boolean => (
  status === 'authenticated'
  && isUuid(user?.id)
  && isUuid(user?.authId)
  && isUuid(session?.user?.id)
  && user.authId === session.user.id
);

export const createUserSessionTelemetryRuntime = (
  identity: UserSessionTelemetryIdentity,
  service: UserSessionTelemetryService,
  environment: UserSessionTelemetryEnvironment,
): UserSessionTelemetryRuntime | null => {
  if (!isEligibleIdentity(identity) || !identity.user) return null;
  const activeUser = identity.user;
  let startPromise: Promise<void> | null = null;
  let activeSessionId: string | null = null;
  let intervalId: unknown = null;
  let removeVisibilityListener: (() => void) | null = null;
  let removeFocusListener: (() => void) | null = null;
  let heartbeatCount = 0;
  let stopReason: TelemetryStopReason | null = null;
  let endAbandoned = false;

  const isSessionOperationAllowed = () => (
    !endAbandoned
    && stopReason !== 'remote_auth_loss'
    && stopReason !== 'unmount'
  );
  const isHeartbeatAllowed = () => !endAbandoned && stopReason === null;

  const clearListeners = () => {
    if (intervalId != null) environment.clearInterval(intervalId);
    intervalId = null;
    removeVisibilityListener?.();
    removeVisibilityListener = null;
    removeFocusListener?.();
    removeFocusListener = null;
  };

  const sendHeartbeat = (recordEvent: boolean) => {
    if (!activeSessionId || stopReason) return;
    void service
      .heartbeat(
        activeUser.id,
        activeSessionId,
        recordEvent,
        isHeartbeatAllowed,
      )
      .catch(error => console.warn('User session telemetry heartbeat failed:', error));
  };

  const runtime: UserSessionTelemetryRuntime = {
    start(): Promise<void> {
      if (startPromise) return startPromise;
      startPromise = (async () => {
        const sessionId = await service.ensureSession(
          activeUser,
          isSessionOperationAllowed,
        );
        if (!isUuid(sessionId)) return;
        activeSessionId = sessionId;

        if (stopReason) {
          if (stopReason !== 'local_logout') service.clearStoredSessionId(activeUser.id);
          return;
        }

        await service.heartbeat(
          activeUser.id,
          activeSessionId,
          true,
          isHeartbeatAllowed,
        );
        if (stopReason) {
          if (stopReason !== 'local_logout') service.clearStoredSessionId(activeUser.id);
          return;
        }

        intervalId = environment.setInterval(() => {
          heartbeatCount += 1;
          sendHeartbeat(heartbeatCount % HEARTBEAT_EVENT_CADENCE === 0);
        }, HEARTBEAT_INTERVAL_MS);
        removeVisibilityListener = environment.addVisibilityListener(() => {
          if (environment.isVisible()) sendHeartbeat(false);
        });
        removeFocusListener = environment.addFocusListener(() => sendHeartbeat(false));
      })();
      return startPromise;
    },

    stop(reason: TelemetryStopReason): void {
      clearListeners();
      // Local logout owns the stored UUID until endSession captures it. A later
      // React unmount must not turn that ordered shutdown into remote cleanup.
      // Authoritative remote auth loss is terminal and must cancel local close.
      if (stopReason === 'local_logout' && reason === 'unmount') return;
      stopReason = reason;
      if (reason === 'remote_auth_loss') endAbandoned = true;
      if (reason !== 'local_logout') service.clearStoredSessionId(activeUser.id);
    },

    async end(): Promise<void> {
      try {
        await startPromise;
      } catch {
        // endSession still gets one best-effort chance using a preserved key.
      }
      if (endAbandoned) {
        service.clearStoredSessionId(activeUser.id);
        return;
      }
      await service.endSession(
        activeUser.id,
        'logout',
        isSessionOperationAllowed,
      );
    },

    abandonEnd(): void {
      endAbandoned = true;
      stopReason = 'remote_auth_loss';
      clearListeners();
      service.clearStoredSessionId(activeUser.id);
    },
  };

  return runtime;
};

export const useUserSessionTelemetry = (): void => {
  const { status, session, user } = useAuth();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      userSessionTelemetryLifecycle.handleRemoteAuthLoss(() => {
        userActivityService.clearAllStoredSessionIds();
      });
      return undefined;
    }

    const environment = getBrowserEnvironment();
    if (!environment) return undefined;
    const runtime = createUserSessionTelemetryRuntime(
      { status, session, user },
      userActivityService,
      environment,
    );
    if (!runtime || !user) {
      userSessionTelemetryLifecycle.handleRemoteAuthLoss(() => {
        userActivityService.clearAllStoredSessionIds();
      });
      return undefined;
    }

    const unregister = userSessionTelemetryLifecycle.register({
      userId: user.id,
      stop: reason => runtime.stop(reason),
      end: () => runtime.end(),
      abandonEnd: () => runtime.abandonEnd(),
    });
    void runtime.start().catch(error => {
      // An ensure/resume error is an unknown server state. Keep its UUID so a
      // later logout can close it; do not create a replacement session.
      console.warn('User session telemetry start failed:', error);
    });

    return () => {
      unregister();
      runtime.stop('unmount');
    };
  }, [session?.user.id, status, user?.authId, user?.id]);
};

export const UserSessionTelemetryHost = (): null => {
  useUserSessionTelemetry();
  return null;
};
