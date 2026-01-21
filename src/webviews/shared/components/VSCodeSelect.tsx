import { SelectHTMLAttributes, forwardRef, memo } from 'react';

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

export const VSCodeSelect = memo(forwardRef<HTMLSelectElement, VSCodeSelectProps>(
  function VSCodeSelect({ label, error, options, placeholder, className = '', id, ...props }, ref) {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label
            htmlFor={selectId}
            className="text-sm text-vscode-text-primary"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`px-3 py-1.5 bg-(--vscode-dropdown-background) text-(--vscode-dropdown-foreground) border border-(--vscode-dropdown-border) rounded focus:outline-none focus:border-(--vscode-focusBorder) ${error ? 'border-(--vscode-inputValidation-errorBorder)' : ''} ${className}`}
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
          <span className="text-xs text-status-error">
            {error}
          </span>
        )}
      </div>
    );
  }
));
