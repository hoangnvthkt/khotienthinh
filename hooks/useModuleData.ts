import { useEffect } from 'react';
import { useApp } from '../context/AppContext';

/**
 * Hook to lazy-load module-specific data.
 * Call this in any page that belongs to a module.
 * Data is only fetched once per session (tracked by loadedModulesRef).
 */
export function useModuleData(module: 'hrm' | 'da' | 'ts' | 'ex') {
  const { loadModuleData } = useApp();
  useEffect(() => {
    loadModuleData(module);
  }, [module, loadModuleData]);
}
