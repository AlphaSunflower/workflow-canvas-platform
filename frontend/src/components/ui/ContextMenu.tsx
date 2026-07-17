import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import { shouldIgnoreGlobalKeyboardShortcut } from '@/utils';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu = memo<ContextMenuProps>(({ x, y, items, onClose }): JSX.Element => {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [submenuState, setSubmenuState] = useState<{
    itemId: string;
    items: ContextMenuItem[];
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 10;
      }
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 10;
      }

      setPosition({ x: newX, y: newY });
    }
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!submenuRef.current || !submenuRef.current.contains(target))
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (shouldIgnoreGlobalKeyboardShortcut(event)) {
        return;
      }

      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleItemClick = useCallback((item: ContextMenuItem): void => {
    if (item.disabled) {
      return;
    }
    if (item.children && item.children.length > 0) {
      return;
    }
    item.onClick?.();
    onClose();
  }, [onClose]);

  const handleItemEnter = useCallback((item: ContextMenuItem, element: HTMLDivElement, isSubmenuItem = false): void => {
    if (!item.children || item.children.length === 0 || item.disabled) {
      if (!isSubmenuItem) {
        setSubmenuState(null);
      }
      return;
    }

    const rect = element.getBoundingClientRect();
    const submenuWidth = 180;
    const submenuHeight = item.children.length * 36 + 8;
    const opensLeft = rect.right + submenuWidth > window.innerWidth;
    const nextX = opensLeft ? rect.left - submenuWidth - 4 : rect.right + 4;
    const nextY = Math.min(rect.top, Math.max(10, window.innerHeight - submenuHeight - 10));

    setSubmenuState({
      itemId: item.id,
      items: item.children,
      x: nextX,
      y: nextY,
    });
  }, []);

  const renderMenuItem = useCallback((item: ContextMenuItem, index: number, isSubmenuItem = false): React.ReactNode => {
    if (item.divider) {
      return <div key={`divider-${index}`} className="context-menu__divider" />;
    }

    const hasChildren = Boolean(item.children && item.children.length > 0);

    return (
      <div
        key={item.id}
        className={`context-menu__item ${item.disabled ? 'context-menu__item--disabled' : ''} ${item.danger ? 'context-menu__item--danger' : ''}`}
        onClick={() => handleItemClick(item)}
        onMouseEnter={(event) => handleItemEnter(item, event.currentTarget, isSubmenuItem)}
      >
        {item.icon && <span className="context-menu__icon">{item.icon}</span>}
        <span className="context-menu__label">{item.label}</span>
        {item.shortcut && <span className="context-menu__shortcut">{item.shortcut}</span>}
        {hasChildren && <span className="context-menu__item-arrow">›</span>}
      </div>
    );
  }, [handleItemClick, handleItemEnter]);

  return (
    <>
      <div ref={menuRef} className="context-menu animate-scale-in" style={{ left: position.x, top: position.y }}>
        {items.map((item, index) => renderMenuItem(item, index))}
      </div>
      {submenuState && (
        <div
          ref={submenuRef}
          className="context-menu context-menu--submenu animate-scale-in"
          style={{ left: submenuState.x, top: submenuState.y }}
        >
          {submenuState.items.map((item, index) => renderMenuItem(item, index, true))}
        </div>
      )}
    </>
  );
});

ContextMenu.displayName = 'ContextMenu';
