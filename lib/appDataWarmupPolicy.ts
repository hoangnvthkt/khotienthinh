export const getWorkflowWarmupModules = (pathname: string): Array<'workflow-people'> =>
  pathname.startsWith('/wf') ? ['workflow-people'] : [];
