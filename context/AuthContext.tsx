import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import LoadingSpinner from '../components/LoadingSpinner';
import { MOCK_USERS } from '../constants';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { User } from '../types';
import {
  AuthAttemptCoordinator,
  AuthResolutionError,
  authReducer,
  authenticateMockUser,
  createInitialAuthState,
  mapUserPermissionGrantRow,
  parseStoredMockUser,
  resolveCandidateSession,
  serializeMockUser,
  shouldRevalidateInBackground,
  type AuthFailure,
  type AuthProfileGateway,
  type AuthState,
  type AuthStatus,
} from './authState';

export type { AuthFailure, AuthStatus } from './authState';

export interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: AuthFailure | null;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  retry(): Promise<void>;
  refreshProfile(): Promise<User>;
}

interface AuthGateViewProps {
  status: AuthStatus;
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
  anonymousFallback?: React.ReactNode;
  errorFallback?: React.ReactNode;
}

export const AuthGateView: React.FC<AuthGateViewProps> = ({
  status,
  children,
  loadingFallback = null,
  anonymousFallback = null,
  errorFallback = null,
}) => {
  if (status === 'authenticated') return <>{children}</>;
  if (status === 'anonymous') return <>{anonymousFallback}</>;
  if (status === 'error') return <>{errorFallback}</>;
  return <>{loadingFallback}</>;
};

const MOCK_STORAGE_KEY = 'vioo_mock_user';

const loadStoredMockUser = (): User | null => {
  if (isSupabaseConfigured || typeof window === 'undefined') return null;
  try {
    const storedValue = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (!storedValue) return null;
    return parseStoredMockUser(storedValue, MOCK_USERS);
  } catch {
    return null;
  }
};

const authGateway: AuthProfileGateway = {
  verifySession: async (session) => {
    const { data, error } = await supabase.auth.getUser(session.access_token);
    if (error || !data.user) throw error || new Error('Supabase did not return a verified user');
    return { id: data.user.id };
  },
  loadActiveProfileByAuthId: async (authId) => {
    const verifiedUser = { id: authId };
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', verifiedUser.id)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  loadPermissionGrants: async (userId) => {
    const { data, error } = await supabase
      .from('user_permission_grants')
      .select('id,user_id,permission_code,scope_type,scope_id,is_active,granted_by,granted_at,expires_at')
      .eq('user_id', userId)
      .eq('is_active', true);
    if (error) throw error;
    return (data || []).map(mapUserPermissionGrantRow);
  },
  loadSignatureUrl: async (userId) => {
    try {
      const { data, error } = await supabase
        .from('user_signatures')
        .select('image_path')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data?.image_path) return undefined;
      const { data: publicUrlData } = supabase.storage
        .from('workflow-templates')
        .getPublicUrl(data.image_path);
      return publicUrlData?.publicUrl || undefined;
    } catch {
      return undefined;
    }
  },
};

const toAuthFailure = (error: unknown): AuthFailure => {
  if (error instanceof AuthResolutionError) return error.failure;
  return {
    code: 'session_verification_failed',
    message: error instanceof Error
      ? error.message
      : 'Không thể xác minh phiên đăng nhập. Vui lòng thử lại.',
    cause: error,
  };
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, undefined, createInitialAuthState);
  const stateRef = useRef<AuthState>(state);
  const attemptsRef = useRef(new AuthAttemptCoordinator());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commitCandidateSession = useCallback(async (
    session: Session,
    attempt: number,
    showLoading = true,
  ): Promise<User> => {
    if (!attemptsRef.current.isCurrent(attempt)) {
      throw new Error('Auth verification was superseded by a newer auth event');
    }
    if (showLoading) dispatch({ type: 'VERIFYING_SESSION', session });
    try {
      const user = await resolveCandidateSession(session, authGateway);
      if (!attemptsRef.current.isCurrent(attempt)) {
        throw new Error('Auth verification was superseded by a newer auth event');
      }
      dispatch({ type: 'AUTHENTICATED', session, user });
      return user;
    } catch (error) {
      if (attemptsRef.current.isCurrent(attempt)) {
        dispatch({ type: 'FAILED', error: toAuthFailure(error) });
      }
      throw error;
    }
  }, []);

  const loadCurrentSession = useCallback(async (): Promise<void> => {
    if (!isSupabaseConfigured) {
      const mockUser = loadStoredMockUser();
      if (mockUser) dispatch({ type: 'AUTHENTICATED', session: null, user: mockUser });
      else dispatch({ type: 'NO_SESSION' });
      return;
    }

    const attempt = attemptsRef.current.begin();
    try {
      const { data, error } = await supabase.auth.getSession();
      if (!attemptsRef.current.isCurrent(attempt)) return;
      if (error) throw error;
      if (!data.session) {
        dispatch({ type: 'NO_SESSION' });
        return;
      }
      await commitCandidateSession(data.session, attempt);
    } catch (error) {
      if (attemptsRef.current.isCurrent(attempt)) {
        dispatch({ type: 'FAILED', error: toAuthFailure(error) });
      }
    }
  }, [commitCandidateSession]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      void loadCurrentSession();
      return undefined;
    }

    const scheduledVerifications = new Set<ReturnType<typeof setTimeout>>();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        attemptsRef.current.begin();
        dispatch({ type: 'NO_SESSION' });
        return;
      }

      if (
        stateRef.current.status === 'authenticated'
        && stateRef.current.session?.access_token === session.access_token
      ) {
        return;
      }

      const attempt = attemptsRef.current.begin();
      const showLoading = !shouldRevalidateInBackground(stateRef.current, session);
      const timeoutId = globalThis.setTimeout(() => {
        scheduledVerifications.delete(timeoutId);
        void commitCandidateSession(session, attempt, showLoading).catch(() => undefined);
      }, 0);
      scheduledVerifications.add(timeoutId);
    });

    void loadCurrentSession();

    return () => {
      attemptsRef.current.begin();
      for (const timeoutId of scheduledVerifications) globalThis.clearTimeout(timeoutId);
      scheduledVerifications.clear();
      subscription.unsubscribe();
    };
  }, [commitCandidateSession, loadCurrentSession]);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new Error('Vui lòng nhập địa chỉ email hợp lệ.');
    }

    if (!isSupabaseConfigured) {
      const mockUser = authenticateMockUser(false, normalizedEmail, password, MOCK_USERS);
      if (!mockUser) throw new Error('Email hoặc mật khẩu không chính xác.');
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(MOCK_STORAGE_KEY, serializeMockUser(mockUser));
      }
      attemptsRef.current.begin();
      dispatch({ type: 'AUTHENTICATED', session: null, user: mockUser });
      return mockUser;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) throw error;
    if (!data.session) throw new Error('Supabase không trả về phiên đăng nhập.');

    const attempt = attemptsRef.current.begin();
    return commitCandidateSession(data.session, attempt);
  }, [commitCandidateSession]);

  const logout = useCallback(async (): Promise<void> => {
    attemptsRef.current.begin();
    dispatch({ type: 'SIGNING_OUT' });
    if (typeof window !== 'undefined') window.localStorage.removeItem(MOCK_STORAGE_KEY);

    try {
      if (isSupabaseConfigured) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }
    } finally {
      attemptsRef.current.begin();
      dispatch({ type: 'NO_SESSION' });
    }
  }, []);

  const retry = useCallback(async (): Promise<void> => {
    await loadCurrentSession();
  }, [loadCurrentSession]);

  const refreshProfile = useCallback(async (): Promise<User> => {
    if (!isSupabaseConfigured) {
      const mockUser = loadStoredMockUser() || stateRef.current.user;
      if (!mockUser) throw new Error('Không có hồ sơ mock đang đăng nhập.');
      dispatch({ type: 'AUTHENTICATED', session: null, user: mockUser });
      return mockUser;
    }

    const session = stateRef.current.session;
    if (!session) throw new Error('Không có phiên đăng nhập để tải lại hồ sơ.');
    const attempt = attemptsRef.current.begin();
    return commitCandidateSession(session, attempt, false);
  }, [commitCandidateSession]);

  const value = useMemo<AuthContextValue>(() => ({
    status: state.status,
    session: state.session,
    user: state.user,
    error: state.error,
    login,
    logout,
    retry,
    refreshProfile,
  }), [login, logout, refreshProfile, retry, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
};

export const AuthRecoveryScreen: React.FC<{
  error: AuthFailure | null;
  retry: () => Promise<void>;
  logout: () => Promise<void>;
}> = ({ error, retry, logout }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
    <div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-8 text-center shadow-xl dark:border-amber-900/60 dark:bg-slate-900">
      <AlertTriangle className="mx-auto mb-4 text-amber-500" size={42} />
      <h1 className="text-xl font-black text-slate-900 dark:text-white">Không thể mở hồ sơ người dùng</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
        {error?.message || 'Phiên đăng nhập chưa liên kết với một hồ sơ đang hoạt động.'}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => void retry()}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
        >
          <RefreshCw size={16} /> Thử lại
        </button>
        <button
          type="button"
          onClick={() => void logout().catch(() => undefined)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
        >
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>
    </div>
  </div>
);

export const AuthenticatedBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, error, retry, logout } = useAuth();
  return (
    <AuthGateView
      status={status}
      loadingFallback={<LoadingSpinner />}
      anonymousFallback={<Navigate to="/login" replace />}
      errorFallback={<AuthRecoveryScreen error={error} retry={retry} logout={logout} />}
    >
      {children}
    </AuthGateView>
  );
};
