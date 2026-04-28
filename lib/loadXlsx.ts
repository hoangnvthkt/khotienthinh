type XlsxModule = typeof import('xlsx');

let xlsxPromise: Promise<XlsxModule> | null = null;

export const loadXlsx = (): Promise<XlsxModule> => {
  xlsxPromise ||= import('xlsx');
  return xlsxPromise;
};
