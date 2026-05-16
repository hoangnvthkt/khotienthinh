import { useCallback, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { getApiErrorMessage, logApiError } from '../lib/apiError';

interface AsyncActionOptions {
  successTitle?: string;
  successMessage?: string;
  errorTitle?: string;
  fallbackError?: string;
  logScope?: string;
  showSuccessToast?: boolean;
  showErrorToast?: boolean;
}

export const useAsyncAction = (options: AsyncActionOptions = {}) => {
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  const run = useCallback(async <T,>(
    action: () => Promise<T> | T,
    overrides: AsyncActionOptions = {}
  ): Promise<T | undefined> => {
    const cfg = { ...options, ...overrides };
    setLoading(true);
    try {
      const result = await action();
      if (cfg.showSuccessToast !== false && cfg.successTitle) {
        toast.success(cfg.successTitle, cfg.successMessage);
      }
      return result;
    } catch (error) {
      logApiError(cfg.logScope || cfg.errorTitle || 'async-action', error);
      if (cfg.showErrorToast !== false) {
        toast.error(
          cfg.errorTitle || 'Thao tác thất bại',
          getApiErrorMessage(error, cfg.fallbackError)
        );
      }
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [options, toast]);

  return { loading, run };
};
