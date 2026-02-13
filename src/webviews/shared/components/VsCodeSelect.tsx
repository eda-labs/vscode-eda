import { memo } from 'react';
import { FormControl, FormHelperText, InputLabel, MenuItem, Select } from '@mui/material';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface VSCodeSelectProps {
  label?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export const VSCodeSelect = memo(function VSCodeSelect({
  label,
  error,
  options,
  placeholder,
  value = '',
  onChange,
  disabled,
  id,
  className
}: Readonly<VSCodeSelectProps>) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <FormControl size="small" error={Boolean(error)} fullWidth className={className}>
      {label && <InputLabel id={`${selectId}-label`}>{label}</InputLabel>}
      <Select
        labelId={label ? `${selectId}-label` : undefined}
        id={selectId}
        label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange?.({ target: { value: String(event.target.value) } })}
      >
        {placeholder && (
          <MenuItem value="" disabled>
            {placeholder}
          </MenuItem>
        )}
        {options.map(option => (
          <MenuItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </MenuItem>
        ))}
      </Select>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
});
