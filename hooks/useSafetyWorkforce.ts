import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SafetyRosterFilters,
  SafetySiteWorkforceOptions,
  SafetyWorkerDetailPayload,
  SafetyWorkerRosterPage,
  SafetyWorkforceDashboard,
} from '../types';
import {
  safetyWorkforceApi,
  type SafetyWorkforceRequestScope,
} from '../lib/safetyWorkforceApi';
import { parseSafetyWorkforceError } from '../lib/safetyWorkforceModel';

type SafetyWorkforceParsedError = ReturnType<typeof parseSafetyWorkforceError>;

export interface SafetyResourceState<T> {
  data: T | null;
  loading: boolean;
  error: SafetyWorkforceParsedError | null;
  reload: () => Promise<void>;
}

const hasScope = (scope: SafetyWorkforceRequestScope): boolean => Boolean(
  scope.userId?.trim()
  && scope.projectId?.trim()
  && scope.constructionSiteId?.trim(),
);

const scopeKey = (scope: SafetyWorkforceRequestScope): string => [
  scope.userId,
  scope.projectId,
  scope.constructionSiteId,
].join('|');

function useSafetyResource<T>(
  key: string,
  loader: () => Promise<T>,
  enabled: boolean,
): SafetyResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<SafetyWorkforceParsedError | null>(null);
  const requestVersionRef = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async (): Promise<void> => {
    const version = requestVersionRef.current + 1;
    requestVersionRef.current = version;
    setData(null);
    setError(null);

    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextData = await loaderRef.current();
      if (version === requestVersionRef.current) {
        setData(nextData);
      }
    } catch (nextError) {
      if (version === requestVersionRef.current) {
        setError(parseSafetyWorkforceError(nextError));
      }
    } finally {
      if (version === requestVersionRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, key]);

  useEffect(() => {
    void reload();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [reload]);

  return { data, loading, error, reload };
}

export function useSafetyDashboard(
  scope: SafetyWorkforceRequestScope,
): SafetyResourceState<SafetyWorkforceDashboard> {
  return useSafetyResource(
    `${scopeKey(scope)}|dashboard`,
    () => safetyWorkforceApi.getDashboard(scope),
    hasScope(scope),
  );
}

export function useSafetyRoster(
  scope: SafetyWorkforceRequestScope,
  filters: SafetyRosterFilters,
): SafetyResourceState<SafetyWorkerRosterPage> {
  const key = `${scopeKey(scope)}|roster|${JSON.stringify(filters)}`;
  return useSafetyResource(
    key,
    () => safetyWorkforceApi.listRoster(scope, filters),
    hasScope(scope),
  );
}

export function useSafetyActiveWorkforce(
  scope: SafetyWorkforceRequestScope,
  filters: SafetyRosterFilters,
): SafetyResourceState<SafetyWorkerRosterPage> {
  const activeFilters: SafetyRosterFilters = {
    ...filters,
    assignmentStatus: 'active',
  };
  const key = `${scopeKey(scope)}|active|${JSON.stringify(activeFilters)}`;
  return useSafetyResource(
    key,
    () => safetyWorkforceApi.listRoster(scope, activeFilters),
    hasScope(scope),
  );
}

export function useSafetyWorkerDetail(
  scope: SafetyWorkforceRequestScope,
  membershipId: string | null,
  includeSensitive: boolean,
): SafetyResourceState<SafetyWorkerDetailPayload> {
  const normalizedMembershipId = membershipId?.trim() || '';
  return useSafetyResource(
    `${scopeKey(scope)}|detail|${normalizedMembershipId}|${includeSensitive}`,
    () => safetyWorkforceApi.getDetail(scope, normalizedMembershipId, includeSensitive),
    hasScope(scope) && Boolean(normalizedMembershipId),
  );
}

export function useSafetyWorkforceOptions(
  scope: SafetyWorkforceRequestScope,
  enabled: boolean,
): SafetyResourceState<SafetySiteWorkforceOptions> {
  return useSafetyResource(
    `${scopeKey(scope)}|options`,
    () => safetyWorkforceApi.listOptions(scope),
    enabled && hasScope(scope),
  );
}
