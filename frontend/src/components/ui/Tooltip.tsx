import { memo, ReactNode } from 'react';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export const Tooltip = memo<TooltipProps>(({
  content,
  children,
  position = 'top',
  className = '',
}) => {
  return (
    <div className={`tooltip tooltip--${position} ${className}`.trim()}>
      {children}
      <div className="tooltip__content">
        {content}
      </div>
    </div>
  );
});

Tooltip.displayName = 'Tooltip';
