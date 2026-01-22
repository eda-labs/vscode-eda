import type { InputHTMLAttributes} from 'react';
import React, { forwardRef, memo } from 'react';

export interface VSCodeInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const VSCodeInput = memo(forwardRef<HTMLInputElement, VSCodeInputProps>(
  function VSCodeInput({ label, error, className = '', id, ...props }, ref) {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm text-vscode-text-primary"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`px-3 py-1.5 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-sm focus:outline-none focus:border-(--vscode-focusBorder) placeholder:text-(--vscode-input-placeholderForeground) ${error ? 'border-(--vscode-inputValidation-errorBorder)' : ''} ${className}`}
          {...props}
        />
        {error && (
          <span className="text-xs text-status-error">
            {error}
          </span>
        )}
      </div>
    );
  }
));

export interface VSCodeTextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const VSCodeTextArea = memo(forwardRef<HTMLTextAreaElement, VSCodeTextAreaProps>(
  function VSCodeTextArea({ label, error, className = '', id, ...props }, ref) {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm text-vscode-text-primary"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`px-3 py-1.5 bg-vscode-input-bg text-vscode-input-fg border border-vscode-input-border rounded-sm focus:outline-none focus:border-(--vscode-focusBorder) placeholder:text-(--vscode-input-placeholderForeground) resize-y ${error ? 'border-(--vscode-inputValidation-errorBorder)' : ''} ${className}`}
          {...props}
        />
        {error && (
          <span className="text-xs text-status-error">
            {error}
          </span>
        )}
      </div>
    );
  }
));
