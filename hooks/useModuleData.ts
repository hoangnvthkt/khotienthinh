import { useEffect } from 'react';
import { AppModule, useApp } from '../context/AppContext';

/**
 * Hook to lazy-load module-specific data.
 * Call this in any page that belongs to a module.
 * Data is only fetched once per session (tracked by loadedModulesRef).
 */
export function useModuleData(module: AppModule, enabled = true) {
  const { loadModuleData } = useApp();
  useEffect(() => {
    if (!enabled) return;
    loadModuleData(module);
  }, [enabled, module, loadModuleData]);
}
