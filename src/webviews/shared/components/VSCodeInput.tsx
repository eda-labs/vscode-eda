import React, { InputHTMLAttributes, forwardRef } from 'react';

export interface VSCodeInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const VSCodeInput = forwardRef<HTMLInputElement, VSCodeInputProps>(
  function VSCodeInput({ label, error, className = '', id, ...props }, ref) {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm text-[var(--vscode-foreground)]"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`px-3 py-1.5 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded focus:outline-none focus:border-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)] ${error ? 'border-[var(--vscode-inputValidation-errorBorder)]' : ''} ${className}`}
          {...props}
        />
        {error && (
          <span className="text-xs text-[var(--vscode-inputValidation-errorForeground)]">
            {error}
          </span>
        )}
      </div>
    );
  }
);

export interface VSCodeTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const VSCodeTextArea = forwardRef<HTMLTextAreaElement, VSCodeTextAreaProps>(
  function VSCodeTextArea({ label, error, className = '', id, ...props }, ref) {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm text-[var(--vscode-foreground)]"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`px-3 py-1.5 bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border)] rounded focus:outline-none focus:border-[var(--vscode-focusBorder)] placeholder:text-[var(--vscode-input-placeholderForeground)] resize-y ${error ? 'border-[var(--vscode-inputValidation-errorBorder)]' : ''} ${className}`}
          {...props}
        />
        {error && (
          <span className="text-xs text-[var(--vscode-inputValidation-errorForeground)]">
            {error}
          </span>
        )}
      </div>
    );
  }
);
