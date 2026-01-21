interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  className?: string;
}

const sizeClasses = {
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8'
};

export function LoadingSpinner({
  size = 'md',
  message,
  className = ''
}: LoadingSpinnerProps) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      <div
        className={`${sizeClasses[size]} border-2 border-[var(--vscode-foreground)] border-t-transparent rounded-full animate-spin`}
      />
      {message && (
        <span className="text-[var(--vscode-foreground)]">{message}</span>
      )}
    </div>
  );
}

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = 'Loading...' }: LoadingOverlayProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[200px]">
      <LoadingSpinner size="lg" message={message} />
    </div>
  );
}
