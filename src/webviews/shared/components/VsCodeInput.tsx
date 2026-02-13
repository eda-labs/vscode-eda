import type { TextFieldProps } from '@mui/material/TextField';
import { forwardRef, memo } from 'react';
import { FormHelperText, Stack, TextField } from '@mui/material';

export interface VSCodeInputProps extends Omit<TextFieldProps, 'variant' | 'size' | 'error' | 'multiline' | 'rows'> {
  error?: string;
}

export const VSCodeInput = memo(forwardRef<HTMLInputElement, VSCodeInputProps>(
  function VSCodeInput({ error, className, ...props }, ref) {
    return (
      <Stack spacing={0.5} className={className}>
        <TextField
          inputRef={ref}
          variant="outlined"
          size="small"
          error={Boolean(error)}
          {...props}
        />
        {error && (
          <FormHelperText error>
            {error}
          </FormHelperText>
        )}
      </Stack>
    );
  }
));

export interface VSCodeTextAreaProps extends Omit<TextFieldProps, 'variant' | 'size' | 'error' | 'multiline'> {
  error?: string;
}

export const VSCodeTextArea = memo(forwardRef<HTMLTextAreaElement, VSCodeTextAreaProps>(
  function VSCodeTextArea({ error, className, rows = 4, ...props }, ref) {
    return (
      <Stack spacing={0.5} className={className}>
        <TextField
          inputRef={ref}
          variant="outlined"
          size="small"
          multiline
          rows={rows}
          error={Boolean(error)}
          {...props}
        />
        {error && (
          <FormHelperText error>
            {error}
          </FormHelperText>
        )}
      </Stack>
    );
  }
));
