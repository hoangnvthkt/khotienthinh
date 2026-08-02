export const shouldWarmWorkflowData = (pathname: string): boolean =>
  pathname.startsWith('/wf')
  || pathname === '/da'
  || pathname.startsWith('/da/')
  || pathname === '/employee-dashboard'
  || pathname === '/custom-dashboard';
