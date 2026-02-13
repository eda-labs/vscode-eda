import type { MouseEventHandler, ReactNode } from 'react';
import { Button, IconButton } from '@mui/material';

export interface VSCodeButtonProps {
  variant?: 'primary' | 'secondary' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  children?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

const sizeMap = {
  sm: 'small',
  md: 'medium',
  lg: 'large'
} as const;

export function VSCodeButton({
  variant = 'primary',
  size = 'md',
  className,
  children,
  onClick,
  disabled,
  type = 'button',
  title
}: Readonly<VSCodeButtonProps>) {
  if (variant === 'icon') {
    return (
      <IconButton
        size={sizeMap[size]}
        className={className}
        onClick={onClick}
        disabled={disabled}
        type={type}
        title={title}
      >
        {children}
      </IconButton>
    );
  }

  return (
    <Button
      className={className}
      variant={variant === 'secondary' ? 'outlined' : 'contained'}
      color={variant === 'secondary' ? 'secondary' : 'primary'}
      size={sizeMap[size]}
      disableElevation
      onClick={onClick}
      disabled={disabled}
      type={type}
      title={title}
    >
      {children}
    </Button>
  );
}
