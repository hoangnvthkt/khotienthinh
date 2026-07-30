export type RequestWorkspaceMode =
  | 'DESKTOP_TABLE'
  | 'DESKTOP_MASTER_DETAIL'
  | 'MOBILE_LIST'
  | 'MOBILE_DETAIL';

export const getRequestWorkspaceMode = (width: number, hasSelection: boolean): RequestWorkspaceMode => {
  if (width < 768) return hasSelection ? 'MOBILE_DETAIL' : 'MOBILE_LIST';
  return hasSelection ? 'DESKTOP_MASTER_DETAIL' : 'DESKTOP_TABLE';
};
