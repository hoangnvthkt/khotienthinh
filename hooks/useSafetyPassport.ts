import { useCallback, useEffect, useState } from 'react';
import { safetyPassportService } from '../lib/safetyPassportService';
import {
  SafetyCard,
  SafetyPassportContractor,
  SafetyPassportDashboard,
  SafetyProjectAssignment,
  SafetyWorkerProfile,
} from '../types';

const useAsyncData = <T,>(loader: () => Promise<T>, deps: any[], fallback: T) => {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
};

export const useSafetyPassportDashboard = (projectId: string, constructionSiteId?: string | null) =>
  useAsyncData<SafetyPassportDashboard | null>(
    () => safetyPassportService.listDashboard(projectId, constructionSiteId),
    [projectId, constructionSiteId],
    null,
  );

export const useSafetyWorkers = () =>
  useAsyncData<SafetyWorkerProfile[]>(
    () => safetyPassportService.listWorkers(),
    [],
    [],
  );

export const useSafetyWorkerProfile = (workerId?: string | null) =>
  useAsyncData<SafetyWorkerProfile | null>(
    () => workerId ? safetyPassportService.getWorkerProfile(workerId) : Promise.resolve(null),
    [workerId],
    null,
  );

export const useSafetyProjectAssignments = (projectId: string, constructionSiteId?: string | null) =>
  useAsyncData<SafetyProjectAssignment[]>(
    () => safetyPassportService.listProjectAssignments(projectId, constructionSiteId),
    [projectId, constructionSiteId],
    [],
  );

export const useSafetyCards = (projectId: string, constructionSiteId?: string | null) =>
  useAsyncData<SafetyCard[]>(
    () => safetyPassportService.listCards(projectId, constructionSiteId),
    [projectId, constructionSiteId],
    [],
  );

export const useSafetyPassportContractors = () =>
  useAsyncData<SafetyPassportContractor[]>(
    () => safetyPassportService.listContractors(),
    [],
    [],
  );
