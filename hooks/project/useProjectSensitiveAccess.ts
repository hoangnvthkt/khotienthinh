import { useCallback, useEffect, useState } from 'react';
import { projectSensitiveAccessService } from '../../lib/projectSensitiveAccessService';

export type SensitiveAccessState =
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | { status: 'ready'; finance: boolean; contract: boolean };

/** Whether the signed-in user may view this project's finance and contracts. */
export const useProjectSensitiveAccess = (
  projectId: string | undefined,
  constructionSiteId: string | null | undefined,
): SensitiveAccessState => {
  const [state, setState] = useState<SensitiveAccessState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setState({ status: 'loading' });
    projectSensitiveAccessService.getMyAccess(projectId, constructionSiteId)
      .then(access => { if (!cancelled) setState({ status: 'ready', ...access }); })
      .catch(error => {
        if (!cancelled) setState({ status: 'error', message: error?.message || 'Không kiểm tra được quyền xem.', retry });
      });
    return () => { cancelled = true; };
  }, [attempt, constructionSiteId, projectId, retry]);

  return state;
};
