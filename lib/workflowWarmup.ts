export const shouldWarmWorkflowData = (pathname: string): boolean =>
  pathname.startsWith('/wf')
  // /da không nạp sẵn lúc mở trang (đo 12/10/2026: tranh băng thông với danh sách dự án); Dự án tự nạp khi cần
  // (danh sách đã hiện, tab Vật tư, form dự án).
  || pathname === '/employee-dashboard'
  || pathname === '/custom-dashboard';
