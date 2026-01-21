import { ButtonHTMLAttributes, forwardRef, memo } from 'react';

export interface VSCodeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  size?: 'sm' | 'md' | 'lg';
}

export const VSCodeButton = memo(forwardRef<HTMLButtonElement, VSCodeButtonProps>(
  function VSCodeButton({ variant = 'primary', size = 'md', className = '', children, ...props }, ref) {
    const baseClasses = 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--vscode-focusBorder)] disabled:opacity-50 disabled:cursor-not-allowed';

    const variantClasses = {
      primary: 'bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)]',
      secondary: 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]',
      icon: 'bg-transparent text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]'
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
