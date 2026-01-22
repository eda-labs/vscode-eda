const SIZE_MD = 'md' as const;

interface LoadingSpinnerProps {
  size?: 'sm' | typeof SIZE_MD | 'lg';
  message?: string;
  className?: string;
}

const sizeClasses = {
  sm: 'size-4',
  [SIZE_MD]: 'size-6',
  lg: 'size-8'
};

export function LoadingSpinner({
  size = SIZE_MD,
  message,
  className = ''
}: Readonly<LoadingSpinnerProps>) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <div
        className={`${sizeClasses[size]} border-2 border-vscode-text-primary border-t-transparent rounded-full animate-spin`}
      />
      {message && (
        <span className="text-vscode-text-primary">{message}</span>
      )}
    </div>
  );
}

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = 'Loading...' }: Readonly<LoadingOverlayProps>) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-50">
      <LoadingSpinner size="lg" message={message} />
    </div>
  );
}
