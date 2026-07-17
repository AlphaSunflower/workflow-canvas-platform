import { memo, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
  footer?: ReactNode;
  className?: string;
}

export const Card = memo<CardProps>(({
  children,
  title,
  footer,
  className = '',
}) => {
  return (
    <div className={`card ${className}`.trim()}>
      {title && (
        <div className="card__header">{title}</div>
      )}
      <div className="card__content">{children}</div>
      {footer && (
        <div className="card__footer">{footer}</div>
      )}
    </div>
  );
});

Card.displayName = 'Card';
