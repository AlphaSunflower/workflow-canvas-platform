import React, { memo } from 'react';

interface PropertyPanelProps {
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export const PropertyPanel = memo<PropertyPanelProps>(({
  title = '属性',
  children,
  onClose,
  className = '',
}) => {
  return (
    <div className={`property-panel ${className}`.trim()}>
      <div className="property-panel__header">
        <span>{title}</span>
        {onClose && (
          <button className="icon-btn icon-btn--sm" onClick={onClose}>
            ×
          </button>
        )}
      </div>
      <div className="property-panel__content custom-scrollbar">
        {children}
      </div>
    </div>
  );
});

PropertyPanel.displayName = 'PropertyPanel';
