import {
  formatViDecimal,
  parseViDecimal,
  type CanonicalDecimalText,
  type DecimalParseFailureCode,
  type DecimalPolicy,
  type ViDecimalFormatOptions,
} from './decimal';

export interface LocalizedNumberDraftOptions {
  allowEmpty?: boolean;
  minimumFractionDigits?: number;
  useGrouping?: boolean;
}

export type LocalizedNumberDraftResult =
  | {
      draft: string;
      ok: true;
      value: number | null;
      canonical: CanonicalDecimalText | null;
    }
  | {
      draft: string;
      ok: false;
      code: DecimalParseFailureCode;
    };

export const inspectLocalizedNumberDraft = (
  input: string,
  policy: DecimalPolicy,
  options: LocalizedNumberDraftOptions = {},
): LocalizedNumberDraftResult => {
  const draft = String(input ?? '');
  if (draft.trim() === '' && options.allowEmpty !== false) {
    return { draft, ok: true, value: null, canonical: null };
  }

  const parsed = parseViDecimal(draft, policy);
  if (parsed.ok === false) return { draft, ok: false, code: parsed.code };
  return { draft, ok: true, value: parsed.value, canonical: parsed.canonical };
};

export const commitLocalizedNumberDraft = (
  input: string,
  policy: DecimalPolicy,
  options: LocalizedNumberDraftOptions = {},
): LocalizedNumberDraftResult => {
  const result = inspectLocalizedNumberDraft(input, policy, options);
  if (result.ok === false || result.canonical === null) return result;

  const requestedMinimum = options.minimumFractionDigits ?? 0;
  const minimumFractionDigits = Math.max(
    0,
    Math.min(requestedMinimum, policy.maxFractionDigits),
  );
  const formatOptions: ViDecimalFormatOptions = {
    minimumFractionDigits,
    maximumFractionDigits: policy.maxFractionDigits,
    useGrouping: options.useGrouping ?? true,
  };

  return {
    ...result,
    draft: formatViDecimal(result.canonical, formatOptions),
  };
};

const VALIDATION_MESSAGES: Record<DecimalParseFailureCode, string> = {
  empty: 'Vui lòng nhập giá trị.',
  invalid: 'Số không đúng định dạng.',
  invalid_grouping: 'Dấu phân tách hàng nghìn không hợp lệ.',
  ambiguous: 'Số có định dạng không rõ ràng.',
  out_of_range: 'Số nằm ngoài phạm vi cho phép.',
  too_many_fraction_digits: 'Số có quá nhiều chữ số thập phân.',
};

export const localizedNumberValidationMessage = (
  result: LocalizedNumberDraftResult,
): string => (result.ok === false ? VALIDATION_MESSAGES[result.code] : '');
