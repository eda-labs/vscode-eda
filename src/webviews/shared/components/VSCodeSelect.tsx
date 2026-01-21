import { SelectHTMLAttributes, forwardRef } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface VSCodeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

export const VSCodeSelect = forwardRef<HTMLSelectElement, VSCodeSelectProps>(
  function VSCodeSelect({ label, error, options, placeholder, className = '', id, ...props }, ref) {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm text-[var(--vscode-foreground)]"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`px-3 py-1.5 bg-[var(--vscode-dropdown-background)] text-[var(--vscode-dropdown-foreground)] border border-[var(--vscode-dropdown-border)] rounded focus:outline-none focus:border-[var(--vscode-focusBorder)] ${error ? 'border-[var(--vscode-inputValidation-errorBorder)]' : ''} ${className}`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map(option => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <span className="text-xs text-[var(--vscode-inputValidation-errorForeground)]">
            {error}
          </span>
        )}
      </div>
    );
  }
);
