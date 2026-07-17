import { memo } from 'react';

interface ShortcutPanelProps {
  shortcuts: Array<{ key: string; description: string }>;
  className?: string;
}

export const ShortcutPanel = memo<ShortcutPanelProps>(({
  shortcuts,
  className = '',
}) => {
  return (
    <div className={`shortcut-panel ${className}`.trim()}>
      {shortcuts.map((shortcut, index) => (
        <div key={index} className="shortcut-panel__item">
          <span className="shortcut-panel__key">{shortcut.key}</span>
          <span className="shortcut-panel__desc">{shortcut.description}</span>
        </div>
      ))}
    </div>
  );
});

ShortcutPanel.displayName = 'ShortcutPanel';
