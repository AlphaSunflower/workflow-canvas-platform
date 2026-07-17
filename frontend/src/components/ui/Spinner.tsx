import { memo } from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Spinner = memo<SpinnerProps>(({
  size = 'md',
  className = '',
}) => {
  return (
    <div className={`spinner spinner--${size} ${className}`.trim()} />
  );
});

Spinner.displayName = 'Spinner';
