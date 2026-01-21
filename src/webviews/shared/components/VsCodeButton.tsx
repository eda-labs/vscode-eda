import type { ButtonHTMLAttributes} from 'react';
import { forwardRef, memo } from 'react';

export interface VSCodeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  size?: 'sm' | 'md' | 'lg';
}

export const VSCodeButton = memo(forwardRef<HTMLButtonElement, VSCodeButtonProps>(
  function VSCodeButton({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) {
    const baseClasses = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-(--vscode-focusBorder) disabled:opacity-50 disabled:cursor-not-allowed';

    const variantClasses = {
      primary: 'bg-vscode-accent text-vscode-button-fg hover:bg-vscode-accent-hover',
      secondary: 'bg-(--vscode-button-secondaryBackground) text-(--vscode-button-secondaryForeground) hover:bg-(--vscode-button-secondaryHoverBackground)',
      icon: 'bg-transparent text-vscode-text-primary hover:bg-vscode-bg-hover'
    };

    const sizeClasses = {
      sm: variant === 'icon' ? 'p-1' : 'px-2 py-1 text-xs',
      md: variant === 'icon' ? 'p-1.5' : 'px-3 py-1.5 text-sm',
      lg: variant === 'icon' ? 'p-2' : 'px-4 py-2 text-base'
    };

    return (
      <button
        ref={ref}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
));
