import { CircularProgress, Stack, Typography } from '@mui/material';

const SIZE_MD = 'md' as const;

interface LoadingSpinnerProps {
  size?: 'sm' | typeof SIZE_MD | 'lg';
  message?: string;
  className?: string;
}

const sizeMap = {
  sm: 16,
  [SIZE_MD]: 24,
  lg: 32
} as const;

export function LoadingSpinner({
  size = SIZE_MD,
  message,
  className = ''
}: Readonly<LoadingSpinnerProps>) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" className={className}>
      <CircularProgress size={sizeMap[size]} />
      {message && (
        <Typography variant="body2" color="text.primary">
          {message}
        </Typography>
      )}
    </Stack>
  );
}

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = 'Loading...' }: Readonly<LoadingOverlayProps>) {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 200, height: '100%' }}>
      <LoadingSpinner size="lg" message={message} />
    </Stack>
  );
}
