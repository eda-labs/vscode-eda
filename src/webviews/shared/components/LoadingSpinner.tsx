interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  className?: string;
}

const sizeClasses = {
  sm: 'size-4',
  md: 'size-6',
  lg: 'size-8'
};

export function LoadingSpinner({
  size = 'md',
  message,
  className = ''
}: LoadingSpinnerProps) {
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

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-50">
      <LoadingSpinner size="lg" message={message} />
    </div>
  );
}
