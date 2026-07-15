import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type KeyboardEventHandler,
} from 'react';
import type { DecimalParseFailureCode, DecimalPolicy } from '../../lib/locale/decimal';
import {
  commitLocalizedNumberDraft,
  inspectLocalizedNumberDraft,
  localizedNumberValidationMessage,
  type LocalizedNumberDraftOptions,
  type LocalizedNumberDraftResult,
} from '../../lib/locale/inputDraft';

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  | 'type'
  | 'inputMode'
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'onBlur'
  | 'onKeyDown'
>;

export interface LocalizedNumberInputProps extends NativeInputProps {
  value: string;
  policy: DecimalPolicy;
  allowEmpty?: boolean;
  minimumFractionDigits?: number;
  useGrouping?: boolean;
  onDraftChange: (draft: string, result: LocalizedNumberDraftResult) => void;
  onCommit?: (result: LocalizedNumberDraftResult) => void;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  validationMessage?: string | ((code: DecimalParseFailureCode) => string);
}

const resolveValidationMessage = (
  result: LocalizedNumberDraftResult,
  override?: LocalizedNumberInputProps['validationMessage'],
): string => {
  if (result.ok !== false) return '';
  if (typeof override === 'function') return override(result.code);
  return override ?? localizedNumberValidationMessage(result);
};

export const LocalizedNumberInput = forwardRef<HTMLInputElement, LocalizedNumberInputProps>(
  function LocalizedNumberInput(
    {
      value,
      policy,
      allowEmpty,
      minimumFractionDigits,
      useGrouping,
      onDraftChange,
      onCommit,
      onBlur,
      onKeyDown,
      validationMessage,
      required,
      ...inputProps
    },
    forwardedRef,
  ) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const draftOptions: LocalizedNumberDraftOptions = useMemo(
      () => ({
        allowEmpty: allowEmpty ?? !required,
        minimumFractionDigits,
        useGrouping,
      }),
      [allowEmpty, minimumFractionDigits, required, useGrouping],
    );
    const validation = inspectLocalizedNumberDraft(value, policy, draftOptions);
    const nativeValidationMessage = resolveValidationMessage(validation, validationMessage);

    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    useEffect(() => {
      inputRef.current?.setCustomValidity(nativeValidationMessage);
    }, [nativeValidationMessage]);

    const commit = useCallback(
      (target: HTMLInputElement) => {
        const result = commitLocalizedNumberDraft(value, policy, draftOptions);
        target.setCustomValidity(resolveValidationMessage(result, validationMessage));
        if (result.draft !== value) onDraftChange(result.draft, result);
        onCommit?.(result);
      }, [draftOptions, onCommit, onDraftChange, policy, validationMessage, value],
    );

    return (
      <input
        {...inputProps}
        ref={setRefs}
        type="text"
        inputMode="decimal"
        value={value}
        required={required}
        aria-invalid={validation.ok === false}
        data-validation-code={validation.ok === false ? validation.code : undefined}
        onChange={event => {
          const result = inspectLocalizedNumberDraft(event.currentTarget.value, policy, draftOptions);
          event.currentTarget.setCustomValidity(resolveValidationMessage(result, validationMessage));
          onDraftChange(result.draft, result);
        }}
        onBlur={event => {
          commit(event.currentTarget);
          onBlur?.(event);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            commit(event.currentTarget);
          }
          onKeyDown?.(event);
        }}
      />
    );
  },
);

LocalizedNumberInput.displayName = 'LocalizedNumberInput';

type LocalizedMoneyInputPropsBase = Omit<LocalizedNumberInputProps, 'policy'>;

export type LocalizedMoneyInputProps = LocalizedMoneyInputPropsBase & {
  currency?: string;
  maxFractionDigits?: number;
  min?: number;
  max?: number;
  allowNegative?: boolean;
};

export const LocalizedMoneyInput = forwardRef<HTMLInputElement, LocalizedMoneyInputProps>(
  function LocalizedMoneyInput(
    {
      currency = 'VND',
      maxFractionDigits,
      min,
      max,
      allowNegative = false,
      ...inputProps
    },
    forwardedRef,
  ) {
    const isVnd = currency.toUpperCase() === 'VND';
    const policy: DecimalPolicy = {
      kind: isVnd ? 'vnd' : 'currency',
      maxFractionDigits: maxFractionDigits ?? (isVnd ? 0 : 2),
      min,
      max,
      allowNegative,
    };

    return <LocalizedNumberInput {...inputProps} ref={forwardedRef} policy={policy} />;
  },
);

LocalizedMoneyInput.displayName = 'LocalizedMoneyInput';
