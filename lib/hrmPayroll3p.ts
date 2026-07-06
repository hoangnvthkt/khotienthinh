export type Hrm3pReviewStatus = 'pending' | 'approved' | 'needs_review';
export type Hrm3pValidationStatus = 'valid' | 'warning' | 'error';

export interface Hrm3pBandSeed {
  code: string;
  groupCode: string;
  p3Coefficient: number;
  kpiPayMultiplier: number;
  sortOrder: number;
}

export interface Hrm3pGradeSeed {
  code: string;
  name: string;
  groupName: string;
  level: number;
  hrmLevelCode: string;
  p1SalaryAmount: number;
  sourceRowNumber: number;
  titles: string[];
}

export interface Hrm3pGradeBandRateSeed {
  gradeCode: string;
  bandCode: string;
  p1SalaryAmount: number;
  p3StandardAmount: number;
  standardTotalAmount: number;
}

export interface Hrm3pMatrixParseResult {
  bands: Hrm3pBandSeed[];
  grades: Hrm3pGradeSeed[];
  rates: Hrm3pGradeBandRateSeed[];
  kpiMultipliers: Record<string, number>;
}

export interface Hrm3pEmployeeSeedRow {
  sourceRowNumber: number;
  employeeCode: string;
  employeeName: string;
  blockCode: string;
  orgUnitCode: string;
  positionName: string;
  levelCode: string;
  gradeCode: string;
  p3BandCode: string;
  p1SalaryAmount: number | null;
  p3StandardAmount: number | null;
  titleAllowanceAmount: number;
  phoneAllowanceAmount: number;
  attractionSupportAmount: number;
  mealSupportAmount: number;
  seniorityAllowanceAmount: number;
  standardTotalIncome: number | null;
  socialInsuranceBaseAmount: number | null;
  reviewStatus: Hrm3pReviewStatus;
  validationStatus: Hrm3pValidationStatus;
  warnings: string[];
  errors: string[];
  rawPayload: Record<string, unknown>;
}

export interface Hrm3pEmployeeSeedParseOptions {
  defaultP3BandCode?: string;
  defaultGradeCode?: string;
}

export interface Hrm3pEmployeeSeedParseResult {
  rows: Hrm3pEmployeeSeedRow[];
  duplicateEmployeeCodes: string[];
}

export interface Hrm3pPayrollInput {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  month: number;
  year: number;
  standardDays: number;
  workingDays: number;
  gradeCode: string;
  p3BandCode: string;
  kpiBandCode?: string;
  recurringAllowances?: {
    title?: number;
    phone?: number;
    attraction?: number;
    meal?: number;
    seniority?: number;
    other?: number;
  };
  periodAdjustments?: {
    bonus?: number;
    deduction?: number;
    tax?: number;
    insurance?: number;
    advance?: number;
    otherDeduction?: number;
  };
  matrix: Hrm3pMatrixParseResult;
}

export interface Hrm3pPayrollResult {
  calculationMode: '3p';
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  month: number;
  year: number;
  workingDays: number;
  standardDays: number;
  gradeCode: string;
  p3BandCode: string;
  kpiBandCode: string;
  kpiMultiplier: number;
  p1Salary: number;
  p3StandardSalary: number;
  p3ActualSalary: number;
  recurringAllowanceTotal: number;
  grossSalary: number;
  netSalary: number;
  payrollComponentSnapshot: Record<string, number>;
  calculationSnapshot: Record<string, unknown>;
}

const cleanText = (value: unknown): string => String(value ?? '').trim();

const stripVietnamese = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

export const normalizePayroll3pKey = (value: unknown): string =>
  stripVietnamese(cleanText(value))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

export const parsePayroll3pMoney = (value: unknown): number | null => {
  const raw = cleanText(value);
  if (!raw || raw === '-') return null;
  const negative = /^\(.+\)$/.test(raw);
  const normalized = raw.replace(/[(),\s]/g, '');
  if (!normalized || normalized === '-') return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
};

const parseNumber = (value: unknown): number => {
  const parsed = Number(cleanText(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBandCode = (value: unknown): string => {
  const text = cleanText(value).replace(/^Bậc\s+/i, '').replace(/^Bac\s+/i, '').trim().toUpperCase();
  return /^[ABCD][1-4]$/.test(text) ? text : '';
};

const gradeCodeFromLevel = (levelCode: string): string => {
  const level = Number(levelCode.replace(/\D/g, ''));
  return Number.isFinite(level) && level > 0 ? `E${level}` : '';
};

const statusFor = (warnings: string[], errors: string[]): Hrm3pValidationStatus => {
  if (errors.length > 0) return 'error';
  if (warnings.length > 0) return 'warning';
  return 'valid';
};

const titleListFromMatrixCell = (value: unknown): string[] =>
  cleanText(value)
    .split(/\r?\n/)
    .map(line => line.replace(/^•\s*/, '').trim())
    .filter(Boolean);

export const parseCompensationMatrixRows = (rows: unknown[][]): Hrm3pMatrixParseResult => {
  const bandHeaderIndex = rows.findIndex(row => row.some(cell => normalizeBandCode(cell)));
  if (bandHeaderIndex < 0) {
    throw new Error('Không tìm thấy header bậc P3 trong bảng lương 3P.');
  }

  const bandHeaderRow = rows[bandHeaderIndex] || [];
  const coefficientRow = rows[bandHeaderIndex + 1] || [];
  const bandColumns = bandHeaderRow
    .map((cell, index) => ({ code: normalizeBandCode(cell), index }))
    .filter(item => item.code);

  const kpiMultipliers: Record<string, number> = {};
  for (const row of rows) {
    for (let index = 0; index < row.length - 1; index += 1) {
      const code = normalizeBandCode(row[index]);
      if (!code) continue;
      const multiplier = parseNumber(row[index + 1]);
      if (multiplier > 0 && multiplier < 5) kpiMultipliers[code] = multiplier;
    }
  }

  const bands: Hrm3pBandSeed[] = bandColumns.map((band, index) => ({
    code: band.code,
    groupCode: band.code.slice(0, 1),
    p3Coefficient: parseNumber(coefficientRow[band.index]),
    kpiPayMultiplier: kpiMultipliers[band.code] ?? 1,
    sortOrder: index + 1,
  }));

  const grades: Hrm3pGradeSeed[] = [];
  const rates: Hrm3pGradeBandRateSeed[] = [];
  rows.forEach((row, index) => {
    const gradeCode = cleanText(row[4]).toUpperCase();
    if (!/^E\d+$/.test(gradeCode)) return;
    const level = Number(gradeCode.replace('E', ''));
    const p1SalaryAmount = parsePayroll3pMoney(row[5]) ?? 0;
    const titles = titleListFromMatrixCell(row[2]);
    grades.push({
      code: gradeCode,
      name: gradeCode,
      groupName: cleanText(row[3]),
      level,
      hrmLevelCode: `L${level}`,
      p1SalaryAmount,
      sourceRowNumber: index + 1,
      titles,
    });
    for (const band of bandColumns) {
      const p3StandardAmount = parsePayroll3pMoney(row[band.index]) ?? 0;
      rates.push({
        gradeCode,
        bandCode: band.code,
        p1SalaryAmount,
        p3StandardAmount,
        standardTotalAmount: p1SalaryAmount + p3StandardAmount,
      });
    }
  });

  return { bands, grades, rates, kpiMultipliers };
};

export const parseEmployeeCompensationSeedRows = (
  rows: unknown[][],
  options: Hrm3pEmployeeSeedParseOptions = {},
): Hrm3pEmployeeSeedParseResult => {
  const defaultP3BandCode = options.defaultP3BandCode || 'B3';
  const defaultGradeCode = options.defaultGradeCode || 'E4';
  const dataRows = rows
    .map((row, index) => ({ row, sourceRowNumber: index + 1 }))
    .filter(({ row }) => /^\d+$/.test(cleanText(row[0])) && cleanText(row[1]));

  const codeCounts = dataRows.reduce<Record<string, number>>((acc, { row }) => {
    const code = cleanText(row[1]).toUpperCase();
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});
  const duplicateEmployeeCodes = Object.entries(codeCounts)
    .filter(([, count]) => count > 1)
    .map(([code]) => code)
    .sort();

  const rowsOut = dataRows.map(({ row, sourceRowNumber }): Hrm3pEmployeeSeedRow => {
    const warnings: string[] = [];
    const errors: string[] = [];
    const employeeCode = cleanText(row[1]).toUpperCase();
    const levelCode = cleanText(row[15]).toUpperCase();
    let gradeCode = gradeCodeFromLevel(levelCode);
    let p3BandCode = normalizeBandCode(row[40]);

    if (!gradeCode) {
      gradeCode = defaultGradeCode;
      warnings.push(`Thiếu level, mặc định ${defaultGradeCode}.`);
    }
    if (!p3BandCode) {
      p3BandCode = defaultP3BandCode;
      warnings.push(`Thiếu bậc P3, mặc định ${defaultP3BandCode}.`);
    }
    if (codeCounts[employeeCode] > 1) {
      errors.push(`Mã nhân sự ${employeeCode} bị trùng trong file nguồn.`);
    }

    const p1SalaryAmount = parsePayroll3pMoney(row[32]);
    const p3StandardAmount = parsePayroll3pMoney(row[41]);
    const titleAllowanceAmount = parsePayroll3pMoney(row[33]) ?? 0;
    const phoneAllowanceAmount = parsePayroll3pMoney(row[34]) ?? 0;
    const attractionSupportAmount = parsePayroll3pMoney(row[36]) ?? 0;
    const mealSupportAmount = parsePayroll3pMoney(row[38]) ?? 0;
    const seniorityAllowanceAmount = parsePayroll3pMoney(row[39]) ?? 0;
    const standardTotalIncome = parsePayroll3pMoney(row[42]);
    const socialInsuranceBaseAmount = parsePayroll3pMoney(row[43]);
    const sourceWarning = cleanText(row[47]);
    if (sourceWarning) warnings.push(sourceWarning);

    return {
      sourceRowNumber,
      employeeCode,
      employeeName: cleanText(row[2]),
      blockCode: cleanText(row[12]),
      orgUnitCode: cleanText(row[13]),
      positionName: cleanText(row[14]),
      levelCode,
      gradeCode,
      p3BandCode,
      p1SalaryAmount,
      p3StandardAmount,
      titleAllowanceAmount,
      phoneAllowanceAmount,
      attractionSupportAmount,
      mealSupportAmount,
      seniorityAllowanceAmount,
      standardTotalIncome,
      socialInsuranceBaseAmount,
      reviewStatus: warnings.length > 0 || errors.length > 0 ? 'needs_review' : 'pending',
      validationStatus: statusFor(warnings, errors),
      warnings,
      errors,
      rawPayload: Object.fromEntries(row.map((value, index) => [`c${index}`, value])),
    };
  });

  return { rows: rowsOut, duplicateEmployeeCodes };
};

export const calculatePayroll3p = (input: Hrm3pPayrollInput): Hrm3pPayrollResult => {
  const grade = input.matrix.grades.find(item => item.code === input.gradeCode);
  const rate = input.matrix.rates.find(item => item.gradeCode === input.gradeCode && item.bandCode === input.p3BandCode);
  if (!grade || !rate) {
    throw new Error(`Không tìm thấy ma trận lương 3P cho ${input.gradeCode}/${input.p3BandCode}.`);
  }

  const kpiBandCode = input.kpiBandCode || 'B3';
  const kpiMultiplier = input.matrix.kpiMultipliers[kpiBandCode] ?? 1;
  const allowances = input.recurringAllowances || {};
  const adjustments = input.periodAdjustments || {};
  const recurringAllowanceTotal =
    (allowances.title || 0) +
    (allowances.phone || 0) +
    (allowances.attraction || 0) +
    (allowances.meal || 0) +
    (allowances.seniority || 0) +
    (allowances.other || 0);
  const p1Salary = grade.p1SalaryAmount;
  const p3StandardSalary = rate.p3StandardAmount;
  const p3ActualSalary = Math.round(p3StandardSalary * kpiMultiplier);
  const grossSalary = p1Salary + p3ActualSalary + recurringAllowanceTotal + (adjustments.bonus || 0);
  const totalDeduction =
    (adjustments.deduction || 0) +
    (adjustments.tax || 0) +
    (adjustments.insurance || 0) +
    (adjustments.advance || 0) +
    (adjustments.otherDeduction || 0);
  const netSalary = grossSalary - totalDeduction;

  const payrollComponentSnapshot = {
    P1: p1Salary,
    P3_STANDARD: p3StandardSalary,
    KPI_MULTIPLIER: kpiMultiplier,
    P3_ACTUAL: p3ActualSalary,
    PC_CHUC_DANH: allowances.title || 0,
    PC_DIEN_THOAI: allowances.phone || 0,
    HO_TRO_THU_HUT: allowances.attraction || 0,
    HO_TRO_AN_CA: allowances.meal || 0,
    PC_THAM_NIEN: allowances.seniority || 0,
    PC_KHAC: allowances.other || 0,
  };

  return {
    calculationMode: '3p',
    employeeId: input.employeeId,
    employeeCode: input.employeeCode,
    employeeName: input.employeeName,
    month: input.month,
    year: input.year,
    workingDays: input.workingDays,
    standardDays: input.standardDays,
    gradeCode: input.gradeCode,
    p3BandCode: input.p3BandCode,
    kpiBandCode,
    kpiMultiplier,
    p1Salary,
    p3StandardSalary,
    p3ActualSalary,
    recurringAllowanceTotal,
    grossSalary,
    netSalary,
    payrollComponentSnapshot,
    calculationSnapshot: {
      formula: 'P1 + P3_ACTUAL + PC',
      gradeCode: input.gradeCode,
      p3BandCode: input.p3BandCode,
      kpiBandCode,
      kpiMultiplier,
      components: payrollComponentSnapshot,
      periodAdjustments: adjustments,
    },
  };
};
