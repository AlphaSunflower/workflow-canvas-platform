import { memo } from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  className?: string;
}

export const Badge = memo<BadgeProps>(({
  children,
  variant = 'default',
  className = '',
}) => {
  return (
    <span className={`badge badge--${variant} ${className}`.trim()}>
      {children}
    </span>
  );
});

Badge.displayName = 'Badge';
